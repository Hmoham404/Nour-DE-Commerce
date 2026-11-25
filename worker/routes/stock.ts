import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, HttpError, all, first, tx, uuid, body, perm, can, auditStmt, requireAuth, pageParams, stockMoveStmts, defaultWarehouse,
  seqReserve, seqExpr, getSetting, dateRange, zOptStr,
} from '../lib';
import { analyzeBarcode } from '../../shared/barcode';

export const stock = new Hono<AppEnv>();
stock.use('*', requireAuth);

stock.get('/', perm('stock.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const filter = c.req.query('filter') ?? 'all';
  const where = ['p.is_active = 1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(p.name LIKE ? OR p.reference LIKE ? OR EXISTS (SELECT 1 FROM product_barcodes x WHERE x.product_id = p.id AND x.barcode LIKE ?))');
    params.push(like, like, like);
  }
  if (c.req.query('category_id')) {
    where.push('p.category_id = ?');
    params.push(c.req.query('category_id'));
  }
  const having = filter === 'low' ? 'WHERE stock > 0 AND stock <= min_stock' : filter === 'out' ? 'WHERE stock <= 0' : filter === 'over' ? 'WHERE max_stock IS NOT NULL AND stock > max_stock' : '';
  const base = `SELECT * FROM (
    SELECT p.id, p.reference, p.name, p.unit, p.min_stock, p.max_stock, p.avg_cost, c.name AS category_name,
           COALESCE((SELECT SUM(quantity) FROM stock_balances sb WHERE sb.product_id = p.id), 0) AS stock,
           (SELECT barcode FROM product_barcodes pb WHERE pb.product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS barcode,
           (SELECT MIN(expires_at) FROM product_batches b WHERE b.product_id = p.id AND b.remaining_qty > 0) AS next_expiry
      FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE ${where.join(' AND ')}) ${having}`;
  const rows = await all<any>(c.env.DB, `${base} ORDER BY name LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const agg = await first<any>(c.env.DB, `SELECT COUNT(*) AS n, SUM(stock * avg_cost) AS value, SUM(stock) AS units FROM (${base})`, ...params);
  const fin = can(c, 'finance.view');
  return c.json({
    rows: rows.map((r) => ({ ...r, value: fin ? r.stock * r.avg_cost : null, avg_cost: fin ? r.avg_cost : null })),
    total: agg?.n ?? 0,
    total_value: fin ? agg?.value ?? 0 : null,
    total_units: agg?.units ?? 0,
  });
});

stock.get('/movements', perm('stock.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['m.created_at BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(p.name LIKE ? OR p.reference LIKE ? OR m.doc_number LIKE ?)');
    params.push(like, like, like);
  }
  if (c.req.query('type')) {
    where.push('m.type = ?');
    params.push(c.req.query('type'));
  }
  if (c.req.query('product_id')) {
    where.push('m.product_id = ?');
    params.push(c.req.query('product_id'));
  }
  if (c.req.query('direction') === 'in') where.push('m.quantity > 0');
  if (c.req.query('direction') === 'out') where.push('m.quantity < 0');
  const w = where.join(' AND ');
  const rows = await all<any>(
    c.env.DB,
    `SELECT m.*, p.name AS product_name, p.reference, w.name AS warehouse_name, u.full_name AS user_name, b.batch_number
       FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id
       LEFT JOIN users u ON u.id = m.user_id LEFT JOIN product_batches b ON b.id = m.batch_id
      WHERE ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const total = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM stock_movements m JOIN products p ON p.id = m.product_id WHERE ${w}`, ...params);
  const fin = can(c, 'finance.view');
  return c.json({ rows: rows.map((r) => ({ ...r, unit_cost: fin ? r.unit_cost : null })), total: total?.n ?? 0 });
});

/** Ajustements manuels : entrée, sortie, casse, périmé. Toujours motivés et tracés. */
stock.post('/adjust', perm('stock.adjust'), async (c) => {
  const d = await body(
    c,
    z.object({
      product_id: z.string(),
      warehouse_id: z.string().optional(),
      type: z.enum(['ajustement', 'endommage', 'perime', 'retour_client']),
      qty: z.number().int().refine((v) => v !== 0, 'quantité nulle'),
      reason: z.string().trim().min(3, 'Motif obligatoire').max(500),
      batch_id: zOptStr(64),
      batch_number: zOptStr(60),
      expires_at: zOptStr(10),
    }),
  );
  const db = c.env.DB;
  const u = c.get('user');
  const wh = d.warehouse_id ?? (await defaultWarehouse(db));
  const p = await first<any>(db, 'SELECT id, avg_cost, track_batches, supplier_id FROM products WHERE id = ?', d.product_id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  let qty = d.qty;
  if (d.type === 'endommage' || d.type === 'perime') qty = -Math.abs(qty); // toujours une sortie
  if (d.type === 'retour_client') qty = Math.abs(qty);
  const docId = uuid();
  const stmts: D1PreparedStatement[] = [...seqReserve(db, 'STOCK_DOC')];
  let batchId = d.batch_id;
  if (batchId) {
    stmts.push(db.prepare('UPDATE product_batches SET remaining_qty = remaining_qty + ? WHERE id = ? AND product_id = ?').bind(qty, batchId, d.product_id));
  } else if (qty > 0 && (p.track_batches || d.batch_number)) {
    batchId = uuid();
    stmts.push(
      db
        .prepare('INSERT INTO product_batches (id, product_id, warehouse_id, batch_number, supplier_id, expires_at, initial_qty, remaining_qty, unit_cost) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(batchId, d.product_id, wh, d.batch_number || 'AJUST-' + docId.slice(0, 6), p.supplier_id, d.expires_at, qty, qty, p.avg_cost),
    );
  }
  stmts.push(
    ...stockMoveStmts(db, {
      product_id: d.product_id, warehouse_id: wh, type: d.type, qty, unit_cost: p.avg_cost, batch_id: batchId, doc_type: 'stock_doc', doc_id: docId,
      doc_number_sql: seqExpr('STOCK_DOC'), reason: d.reason, user_id: u.id,
    }),
    auditStmt(c, 'stock_adjust', 'stock_movements', docId, null, { ...d, qty }, d.reason),
  );
  await tx(db, stmts);
  const mv = await first<any>(db, 'SELECT doc_number, stock_after FROM stock_movements WHERE doc_id = ?', docId);
  return c.json({ ok: true, doc_number: mv?.doc_number, stock_after: mv?.stock_after });
});

stock.post('/transfer', perm('stock.adjust'), async (c) => {
  const d = await body(c, z.object({ product_id: z.string(), from: z.string(), to: z.string(), qty: z.number().int().min(1), reason: z.string().trim().min(3).max(300) }));
  if (d.from === d.to) throw new HttpError(400, 'SAME_WH', 'Les dépôts doivent être différents.');
  const db = c.env.DB;
  const u = c.get('user');
  const p = await first<any>(db, 'SELECT avg_cost FROM products WHERE id = ?', d.product_id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  const docId = uuid();
  await tx(db, [
    ...seqReserve(db, 'STOCK_DOC'),
    ...stockMoveStmts(db, { product_id: d.product_id, warehouse_id: d.from, type: 'transfert_sortie', qty: -d.qty, unit_cost: p.avg_cost, doc_type: 'transfer', doc_id: docId, doc_number_sql: seqExpr('STOCK_DOC'), reason: d.reason, user_id: u.id }),
    ...stockMoveStmts(db, { product_id: d.product_id, warehouse_id: d.to, type: 'transfert_entree', qty: d.qty, unit_cost: p.avg_cost, doc_type: 'transfer', doc_id: docId, doc_number_sql: seqExpr('STOCK_DOC'), reason: d.reason, user_id: u.id }),
    auditStmt(c, 'stock_transfer', 'stock_movements', docId, null, d, d.reason),
  ]);
  return c.json({ ok: true });
});

stock.get('/batches', perm('stock.view'), async (c) => {
  const days = Number(c.req.query('days') ?? 0);
  const status = c.req.query('status') ?? 'all'; // all | expired | expiring
  const where = ['b.remaining_qty > 0'];
  const params: unknown[] = [];
  if (status === 'expired') where.push(`b.expires_at IS NOT NULL AND b.expires_at < date('now', '+1 hour')`);
  if (status === 'expiring') {
    where.push(`b.expires_at IS NOT NULL AND b.expires_at >= date('now', '+1 hour') AND b.expires_at <= date('now', '+1 hour', '+' || ? || ' days')`);
    params.push(days || 30);
  }
  const rows = await all<any>(
    c.env.DB,
    `SELECT b.*, p.name AS product_name, p.reference, s.name AS supplier_name, w.name AS warehouse_name,
            CAST(julianday(b.expires_at) - julianday(date('now', '+1 hour')) AS INTEGER) AS days_left
       FROM product_batches b JOIN products p ON p.id = b.product_id LEFT JOIN suppliers s ON s.id = b.supplier_id JOIN warehouses w ON w.id = b.warehouse_id
      WHERE ${where.join(' AND ')} ORDER BY b.expires_at IS NULL, b.expires_at LIMIT 1000`,
    ...params,
  );
  return c.json(can(c, 'finance.view') ? rows : rows.map((r) => ({ ...r, unit_cost: null })));
});

stock.get('/alerts', perm('stock.view', 'dashboard.view'), async (c) => {
  const db = c.env.DB;
  const days = Number(await getSetting(db, 'expiry_alert_days', '30'));
  const [low, out, expiring, expired, anomalies] = await Promise.all([
    all(db, `SELECT * FROM (SELECT p.id, p.name, p.reference, p.min_stock, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock FROM products p WHERE p.is_active = 1) WHERE stock > 0 AND stock <= min_stock ORDER BY stock LIMIT 200`),
    all(db, `SELECT * FROM (SELECT p.id, p.name, p.reference, p.min_stock, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock FROM products p WHERE p.is_active = 1) WHERE stock <= 0 ORDER BY name LIMIT 200`),
    all(db, `SELECT b.id, b.batch_number, b.expires_at, b.remaining_qty, p.id AS product_id, p.name, CAST(julianday(b.expires_at) - julianday(date('now','+1 hour')) AS INTEGER) AS days_left FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.remaining_qty > 0 AND b.expires_at >= date('now','+1 hour') AND b.expires_at <= date('now','+1 hour','+' || ? || ' days') ORDER BY b.expires_at LIMIT 200`, days),
    all(db, `SELECT b.id, b.batch_number, b.expires_at, b.remaining_qty, p.id AS product_id, p.name FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.remaining_qty > 0 AND b.expires_at < date('now','+1 hour') ORDER BY b.expires_at LIMIT 200`),
    // anomalie : quantité en lots supérieure au stock global
    all(db, `SELECT p.id, p.name, (SELECT SUM(remaining_qty) FROM product_batches WHERE product_id = p.id) AS batch_qty, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock FROM products p WHERE p.track_batches = 1 AND (SELECT SUM(remaining_qty) FROM product_batches WHERE product_id = p.id) > COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) LIMIT 100`),
  ]);
  return c.json({ low, out, expiring, expired, anomalies, expiry_days: days });
});

stock.get('/low-rotation', perm('stock.view'), async (c) => {
  const db = c.env.DB;
  const days = Number(c.req.query('days') ?? (await getSetting(db, 'low_rotation_days', '60')));
  const rows = await all<any>(
    db,
    `SELECT * FROM (
       SELECT p.id, p.name, p.reference, p.avg_cost, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock,
              (SELECT MAX(s.sale_date) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed') AS last_sale,
              (SELECT COALESCE(SUM(si.qty - si.returned_qty),0) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed' AND s.sale_date >= datetime('now', '-' || ? || ' days')) AS sold_period
         FROM products p WHERE p.is_active = 1)
     WHERE stock > 0 AND (last_sale IS NULL OR last_sale < datetime('now', '-' || ? || ' days')) ORDER BY last_sale IS NOT NULL, last_sale LIMIT 500`,
    days,
    days,
  );
  const fin = can(c, 'finance.view');
  return c.json({ days, rows: rows.map((r) => ({ ...r, value: fin ? r.stock * r.avg_cost : null, avg_cost: fin ? r.avg_cost : null })) });
});

// ───────────── Inventaires ─────────────
export const inventories = new Hono<AppEnv>();
inventories.use('*', requireAuth, perm('inventory.manage', 'inventory.validate'));

inventories.get('/', async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT i.*, w.name AS warehouse_name, u.full_name AS created_by_name, v.full_name AS validated_by_name,
              (SELECT COUNT(*) FROM inventory_items x WHERE x.inventory_id = i.id) AS items_count
         FROM inventories i JOIN warehouses w ON w.id = i.warehouse_id LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users v ON v.id = i.validated_by
        ORDER BY i.created_at DESC LIMIT 200`,
    ),
  ),
);

inventories.post('/', async (c) => {
  const d = await body(c, z.object({ warehouse_id: z.string().optional(), notes: zOptStr(500), scope: z.enum(['empty', 'all']).default('empty'), category_id: zOptStr(64) }));
  const db = c.env.DB;
  const wh = d.warehouse_id ?? (await defaultWarehouse(db));
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'INVENTORY'),
    db.prepare(`INSERT INTO inventories (id, number, warehouse_id, notes, created_by) VALUES (?, ${seqExpr('INVENTORY')}, ?, ?, ?)`).bind(id, wh, d.notes, c.get('user').id),
  ];
  if (d.scope === 'all') {
    stmts.push(
      db
        .prepare(
          `INSERT INTO inventory_items (inventory_id, product_id, theoretical_qty, counted_qty)
           SELECT ?, p.id, COALESCE((SELECT quantity FROM stock_balances WHERE product_id = p.id AND warehouse_id = ?), 0), 0 FROM products p
            WHERE p.is_active = 1 ${d.category_id ? 'AND p.category_id = ?' : ''}`,
        )
        .bind(id, wh, ...(d.category_id ? [d.category_id] : [])),
    );
  }
  stmts.push(auditStmt(c, 'create', 'inventories', id, null, d));
  await tx(db, stmts);
  return c.json({ id });
});

inventories.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const inv = await first<any>(db, 'SELECT i.*, w.name AS warehouse_name FROM inventories i JOIN warehouses w ON w.id = i.warehouse_id WHERE i.id = ?', id);
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Inventaire introuvable.');
  const items = await all<any>(
    db,
    `SELECT it.*, p.name, p.reference, p.unit, p.avg_cost,
            COALESCE((SELECT quantity FROM stock_balances WHERE product_id = it.product_id AND warehouse_id = ?), 0) AS current_qty,
            (SELECT barcode FROM product_barcodes pb WHERE pb.product_id = it.product_id ORDER BY is_primary DESC LIMIT 1) AS barcode
       FROM inventory_items it JOIN products p ON p.id = it.product_id WHERE it.inventory_id = ? ORDER BY it.updated_at DESC`,
    inv.warehouse_id,
    id,
  );
  const fin = can(c, 'finance.view');
  const rows = items.map((it) => {
    const theo = inv.status === 'draft' ? it.current_qty : it.theoretical_qty;
    const diff = it.counted_qty - theo;
    return { ...it, theoretical_qty: theo, difference: diff, value_diff: fin ? diff * it.avg_cost : null, avg_cost: fin ? it.avg_cost : null };
  });
  return c.json({ ...inv, items: rows });
});

async function assertDraft(db: D1Database, id: string) {
  const inv = await first<any>(db, 'SELECT status FROM inventories WHERE id = ?', id);
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Inventaire introuvable.');
  if (inv.status !== 'draft') throw new HttpError(409, 'NOT_DRAFT', "L'inventaire n'est plus modifiable.");
}

/** Mode inventaire rapide : chaque scan incrémente la quantité comptée. */
inventories.post('/:id/scan', async (c) => {
  const id = c.req.param('id');
  const d = await body(c, z.object({ code: z.string().optional(), product_id: z.string().optional(), qty: z.number().int().min(1).max(100000).optional() }));
  const db = c.env.DB;
  await assertDraft(db, id);
  let productId = d.product_id;
  let qty = d.qty ?? 1;
  if (!productId && d.code) {
    const code = analyzeBarcode(d.code).code;
    const bc = await first<any>(db, 'SELECT product_id, qty_per_unit FROM product_barcodes WHERE barcode = ?', code);
    if (!bc) throw new HttpError(404, 'UNKNOWN_BARCODE', `Code-barres inconnu : ${code}`);
    productId = bc.product_id;
    if (!d.qty) qty = bc.qty_per_unit;
  }
  if (!productId) throw new HttpError(400, 'NO_PRODUCT', 'Produit manquant.');
  await tx(db, [
    db
      .prepare(
        `INSERT INTO inventory_items (inventory_id, product_id, counted_qty, scanned_count) VALUES (?, ?, ?, 1)
         ON CONFLICT(inventory_id, product_id) DO UPDATE SET counted_qty = counted_qty + excluded.counted_qty, scanned_count = scanned_count + 1, updated_at = datetime('now')`,
      )
      .bind(id, productId, qty),
  ]);
  const item = await first<any>(db, 'SELECT it.counted_qty, p.name FROM inventory_items it JOIN products p ON p.id = it.product_id WHERE inventory_id = ? AND product_id = ?', id, productId);
  return c.json({ product_id: productId, name: item?.name, counted_qty: item?.counted_qty, added: qty });
});

inventories.put('/:id/items/:pid', async (c) => {
  const { id, pid } = c.req.param();
  const d = await body(c, z.object({ counted_qty: z.number().int().min(0) }));
  const db = c.env.DB;
  await assertDraft(db, id);
  await tx(db, [
    db
      .prepare(
        `INSERT INTO inventory_items (inventory_id, product_id, counted_qty) VALUES (?, ?, ?)
         ON CONFLICT(inventory_id, product_id) DO UPDATE SET counted_qty = excluded.counted_qty, updated_at = datetime('now')`,
      )
      .bind(id, pid, d.counted_qty),
  ]);
  return c.json({ ok: true });
});

inventories.delete('/:id/items/:pid', async (c) => {
  const { id, pid } = c.req.param();
  const db = c.env.DB;
  await assertDraft(db, id);
  await tx(db, [db.prepare('DELETE FROM inventory_items WHERE inventory_id = ? AND product_id = ?').bind(id, pid)]);
  return c.json({ ok: true });
});

/** Soumission : fige le stock théorique ; les ajustements attendent la validation d'un responsable. */
inventories.post('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await assertDraft(db, id);
  const inv = await first<any>(db, 'SELECT warehouse_id FROM inventories WHERE id = ?', id);
  await tx(db, [
    db
      .prepare(`UPDATE inventory_items SET theoretical_qty = COALESCE((SELECT quantity FROM stock_balances WHERE product_id = inventory_items.product_id AND warehouse_id = ?), 0) WHERE inventory_id = ?`)
      .bind(inv.warehouse_id, id),
    db.prepare(`UPDATE inventories SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`).bind(id),
    auditStmt(c, 'submit', 'inventories', id),
  ]);
  return c.json({ ok: true });
});

/** Validation : applique les écarts (stock compté − stock actuel) en mouvements d'ajustement, atomiquement. */
inventories.post('/:id/validate', perm('inventory.validate'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const inv = await first<any>(db, 'SELECT * FROM inventories WHERE id = ?', id);
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Inventaire introuvable.');
  if (inv.status !== 'submitted') throw new HttpError(409, 'NOT_SUBMITTED', "L'inventaire doit d'abord être soumis.");
  const items = await all<any>(
    db,
    `SELECT it.product_id, it.counted_qty, p.avg_cost, COALESCE((SELECT quantity FROM stock_balances WHERE product_id = it.product_id AND warehouse_id = ?), 0) AS current_qty
       FROM inventory_items it JOIN products p ON p.id = it.product_id WHERE it.inventory_id = ?`,
    inv.warehouse_id,
    id,
  );
  const u = c.get('user');
  const stmts: D1PreparedStatement[] = [];
  let adjusted = 0;
  for (const it of items) {
    const diff = it.counted_qty - it.current_qty;
    if (diff === 0) continue;
    adjusted++;
    stmts.push(
      ...stockMoveStmts(db, {
        product_id: it.product_id, warehouse_id: inv.warehouse_id, type: 'ajustement_inventaire', qty: diff, unit_cost: it.avg_cost, doc_type: 'inventory',
        doc_id: id, doc_number: inv.number, reason: `Inventaire ${inv.number}`, user_id: u.id,
      }),
    );
  }
  stmts.push(
    db.prepare(`UPDATE inventories SET status = 'validated', validated_by = ?, validated_at = datetime('now') WHERE id = ? AND status = 'submitted'`).bind(u.id, id),
    auditStmt(c, 'validate', 'inventories', id, null, { adjusted }),
  );
  // D1 : un batch volumineux est découpé ; on applique d'abord les ajustements puis le statut (dernier paquet)
  const chunk = 240;
  for (let i = 0; i < stmts.length; i += chunk) await tx(db, stmts.slice(i, i + chunk));
  return c.json({ ok: true, adjusted });
});

inventories.post('/:id/cancel', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const inv = await first<any>(db, 'SELECT status FROM inventories WHERE id = ?', id);
  if (!inv || inv.status === 'validated') throw new HttpError(409, 'CANNOT_CANCEL', 'Inventaire déjà validé ou introuvable.');
  await tx(db, [db.prepare(`UPDATE inventories SET status = 'cancelled' WHERE id = ?`).bind(id), auditStmt(c, 'cancel', 'inventories', id)]);
  return c.json({ ok: true });
});
