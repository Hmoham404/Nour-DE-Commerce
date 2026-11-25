import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, HttpError, all, first, tx, uuid, body, perm, can, need, auditStmt, requireAuth, pageParams, zMoney, zBp, zOptStr, stockMoveStmts,
  defaultWarehouse, seqReserve, seqExpr, dateRange,
} from '../lib';
import { computeLine, computeTotals } from '../../shared/pricing';
import { fefoAllocate, batchDecrementStmts } from '../fefo';

export const purchases = new Hono<AppEnv>();
purchases.use('*', requireAuth);

const poItemSchema = z.object({ product_id: z.string(), qty_ordered: z.number().int().min(1), unit_price: zMoney, discount_bp: zBp.default(0), vat_bp: zBp });
const poSchema = z.object({
  supplier_id: z.string().min(1, 'Fournisseur requis'),
  expected_date: zOptStr(10),
  notes: zOptStr(1000),
  status: z.enum(['draft', 'ordered']).default('draft'),
  items: z.array(poItemSchema).min(1, 'Ajoutez au moins un produit').max(500),
});

purchases.get('/orders', perm('purchases.view', 'receipts.manage'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const where = ['1=1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(po.number LIKE ? OR s.name LIKE ?)');
    params.push(like, like);
  }
  if (c.req.query('status')) {
    where.push('po.status = ?');
    params.push(c.req.query('status'));
  }
  const rows = await all(
    c.env.DB,
    `SELECT po.*, s.name AS supplier_name, u.full_name AS created_by_name,
            (SELECT SUM(qty_ordered) FROM purchase_order_items WHERE po_id = po.id) AS qty_ordered,
            (SELECT SUM(qty_received) FROM purchase_order_items WHERE po_id = po.id) AS qty_received
       FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN users u ON u.id = po.created_by
      WHERE ${where.join(' AND ')} ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const t = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE ${where.join(' AND ')}`, ...params);
  return c.json({ rows, total: t?.n ?? 0 });
});

purchases.get('/orders/:id', perm('purchases.view', 'receipts.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const po = await first<any>(db, 'SELECT po.*, s.name AS supplier_name, s.address AS supplier_address, s.tax_id AS supplier_tax_id, s.phone AS supplier_phone FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id = ?', id);
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'Commande introuvable.');
  const items = await all(
    db,
    `SELECT i.*, p.name AS product_name, p.reference, p.track_batches, (SELECT barcode FROM product_barcodes pb WHERE pb.product_id = p.id ORDER BY is_primary DESC LIMIT 1) AS barcode
       FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = ?`,
    id,
  );
  const receipts = await all(db, 'SELECT id, number, received_at, total_ttc FROM goods_receipts WHERE po_id = ? ORDER BY received_at', id);
  return c.json({ ...po, items, receipts });
});

function poStatements(db: D1Database, poId: string, items: z.infer<typeof poItemSchema>[]) {
  return items.map((it) =>
    db
      .prepare('INSERT INTO purchase_order_items (id, po_id, product_id, qty_ordered, unit_price, discount_bp, vat_bp) VALUES (?,?,?,?,?,?,?)')
      .bind(uuid(), poId, it.product_id, it.qty_ordered, it.unit_price, it.discount_bp, it.vat_bp),
  );
}
function poTotals(items: z.infer<typeof poItemSchema>[]) {
  return computeTotals(items.map((i) => computeLine(i.unit_price, i.qty_ordered, i.discount_bp, i.vat_bp)));
}

purchases.post('/orders', perm('purchases.manage'), async (c) => {
  const d = await body(c, poSchema);
  const db = c.env.DB;
  const id = uuid();
  const t = poTotals(d.items);
  await tx(db, [
    ...seqReserve(db, 'PO'),
    db
      .prepare(`INSERT INTO purchase_orders (id, number, supplier_id, status, expected_date, notes, total_ht, total_vat, total_ttc, created_by) VALUES (?, ${seqExpr('PO')}, ?,?,?,?,?,?,?,?)`)
      .bind(id, d.supplier_id, d.status, d.expected_date, d.notes, t.subtotal_ht, t.total_vat, t.total_ttc, c.get('user').id),
    ...poStatements(db, id, d.items),
    auditStmt(c, 'create', 'purchase_orders', id, null, d),
  ]);
  return c.json({ id });
});

purchases.put('/orders/:id', perm('purchases.manage'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, poSchema);
  const db = c.env.DB;
  const po = await first<any>(db, 'SELECT status FROM purchase_orders WHERE id = ?', id);
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'Commande introuvable.');
  if (!['draft', 'ordered'].includes(po.status)) throw new HttpError(409, 'LOCKED', 'Commande déjà (partiellement) reçue : modification impossible.');
  const t = poTotals(d.items);
  await tx(db, [
    db
      .prepare(`UPDATE purchase_orders SET supplier_id=?, status=?, expected_date=?, notes=?, total_ht=?, total_vat=?, total_ttc=?, updated_at=datetime('now') WHERE id=?`)
      .bind(d.supplier_id, d.status, d.expected_date, d.notes, t.subtotal_ht, t.total_vat, t.total_ttc, id),
    db.prepare('DELETE FROM purchase_order_items WHERE po_id = ?').bind(id),
    ...poStatements(db, id, d.items),
    auditStmt(c, 'update', 'purchase_orders', id, null, d),
  ]);
  return c.json({ ok: true });
});

purchases.post('/orders/:id/status', perm('purchases.manage'), async (c) => {
  const id = c.req.param('id');
  const { status } = await body(c, z.object({ status: z.enum(['ordered', 'cancelled', 'received']) }));
  const db = c.env.DB;
  const po = await first<any>(db, 'SELECT status FROM purchase_orders WHERE id = ?', id);
  if (!po) throw new HttpError(404, 'NOT_FOUND', 'Commande introuvable.');
  if (status === 'cancelled' && po.status !== 'draft' && po.status !== 'ordered') throw new HttpError(409, 'LOCKED', 'Une commande déjà reçue ne peut pas être annulée.');
  await tx(db, [db.prepare(`UPDATE purchase_orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id), auditStmt(c, 'status_' + status, 'purchase_orders', id)]);
  return c.json({ ok: true });
});

// ───────────── Réceptions ─────────────
const receiptSchema = z.object({
  idempotency_key: z.string().min(8).max(80),
  supplier_id: z.string().min(1, 'Fournisseur requis'),
  po_id: zOptStr(64),
  warehouse_id: zOptStr(64),
  supplier_doc_ref: zOptStr(80),
  notes: zOptStr(1000),
  extra_costs: zMoney.default(0),
  create_invoice: z.boolean().default(false),
  invoice_supplier_ref: zOptStr(80),
  invoice_due_date: zOptStr(10),
  items: z
    .array(
      z.object({
        product_id: z.string(),
        po_item_id: zOptStr(64),
        qty: z.number().int().min(1).max(1e8),
        unit_price: zMoney.optional(),
        discount_bp: zBp.default(0),
        vat_bp: zBp.optional(),
        batch_number: zOptStr(60),
        expires_at: zOptStr(10),
      }),
    )
    .min(1, 'Ajoutez au moins un produit')
    .max(300),
});

purchases.post('/receipts', perm('receipts.manage'), async (c) => {
  const d = await body(c, receiptSchema);
  const db = c.env.DB;
  const u = c.get('user');
  const existing = await first<any>(db, 'SELECT id, number FROM goods_receipts WHERE idempotency_key = ?', d.idempotency_key);
  if (existing) return c.json({ ...existing, duplicate: true });
  const wh = d.warehouse_id ?? (await defaultWarehouse(db));
  const canPrice = can(c, 'purchases.manage') || can(c, 'finance.view');
  if (d.create_invoice) need(c, 'purchases.manage');

  const productIds = [...new Set(d.items.map((i) => i.product_id))];
  const prods = await all<any>(
    db,
    `SELECT p.id, p.name, p.purchase_price, p.avg_cost, p.vat_bp, p.track_batches, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id), 0) AS stock
       FROM products p WHERE p.id IN (${productIds.map(() => '?').join(',')})`,
    ...productIds,
  );
  const pmap = new Map(prods.map((p) => [p.id, p]));
  const poItems = d.po_id ? await all<any>(db, 'SELECT * FROM purchase_order_items WHERE po_id = ?', d.po_id) : [];
  const poMap = new Map(poItems.map((i) => [i.id, i]));

  const lines = d.items.map((it) => {
    const p = pmap.get(it.product_id);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable dans la réception.');
    if (p.track_batches && !it.batch_number) throw new HttpError(400, 'BATCH_REQUIRED', `Numéro de lot requis pour « ${p.name} ».`);
    const poi = it.po_item_id ? poMap.get(it.po_item_id) : poItems.find((x) => x.product_id === it.product_id);
    const unit = canPrice && it.unit_price !== undefined ? it.unit_price : poi?.unit_price ?? p.purchase_price;
    const vat = it.vat_bp ?? poi?.vat_bp ?? p.vat_bp;
    const disc = canPrice ? it.discount_bp : poi?.discount_bp ?? 0;
    return { ...it, p, poi, unit, vat, disc, amounts: computeLine(unit, it.qty, disc, vat) };
  });
  const totals = computeTotals(lines.map((l) => l.amounts));
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'RECEIPT'),
    db
      .prepare(
        `INSERT INTO goods_receipts (id, number, supplier_id, po_id, warehouse_id, idempotency_key, supplier_doc_ref, notes, total_ht, total_vat, total_ttc, extra_costs, invoiced, created_by)
         VALUES (?, ${seqExpr('RECEIPT')}, ?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(id, d.supplier_id, d.po_id, wh, d.idempotency_key, d.supplier_doc_ref, d.notes, totals.subtotal_ht, totals.total_vat, totals.total_ttc, d.extra_costs, d.create_invoice ? 1 : 0, u.id),
  ];
  // Frais complémentaires répartis au prorata du HT pour le coût de revient
  const stockByProduct = new Map(prods.map((p) => [p.id, Math.max(0, p.stock)]));
  const costByProduct = new Map(prods.map((p) => [p.id, p.avg_cost]));
  for (const l of lines) {
    const extra = totals.subtotal_ht > 0 ? Math.round((d.extra_costs * l.amounts.line_ht) / totals.subtotal_ht) : 0;
    const unitCost = Math.round((l.amounts.line_ht + extra) / l.qty);
    const oldQty = stockByProduct.get(l.product_id)!;
    const oldCost = costByProduct.get(l.product_id)!;
    const newCost = oldQty + l.qty > 0 ? Math.round((oldQty * oldCost + l.qty * unitCost) / (oldQty + l.qty)) : unitCost;
    stockByProduct.set(l.product_id, oldQty + l.qty);
    costByProduct.set(l.product_id, newCost);
    let batchId: string | null = null;
    if (l.batch_number) {
      batchId = uuid();
      stmts.push(
        db
          .prepare('INSERT INTO product_batches (id, product_id, warehouse_id, batch_number, supplier_id, receipt_id, expires_at, initial_qty, remaining_qty, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .bind(batchId, l.product_id, wh, l.batch_number, d.supplier_id, id, l.expires_at, l.qty, l.qty, unitCost),
      );
    }
    stmts.push(
      db
        .prepare('INSERT INTO goods_receipt_items (id, receipt_id, product_id, po_item_id, qty, unit_price, discount_bp, vat_bp, line_ht, line_vat, batch_id, batch_number, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(), id, l.product_id, l.poi?.id ?? null, l.qty, l.unit, l.disc, l.vat, l.amounts.line_ht, l.amounts.line_vat, batchId, l.batch_number, l.expires_at),
      db.prepare(`UPDATE products SET avg_cost = ?, purchase_price = ?, updated_at = datetime('now') WHERE id = ?`).bind(newCost, l.unit, l.product_id),
      ...stockMoveStmts(db, {
        product_id: l.product_id, warehouse_id: wh, type: 'entree_fournisseur', qty: l.qty, unit_cost: unitCost, batch_id: batchId, doc_type: 'receipt', doc_id: id,
        doc_number_sql: seqExpr('RECEIPT'), reason: 'Réception fournisseur', user_id: u.id,
      }),
    );
    if (l.unit !== l.p.purchase_price) {
      stmts.push(db.prepare('INSERT INTO product_price_history (product_id, field, old_value, new_value, user_id, reason) VALUES (?,?,?,?,?,?)').bind(l.product_id, 'purchase_price', l.p.purchase_price, l.unit, u.id, 'Réception fournisseur'));
    }
    if (l.poi) stmts.push(db.prepare('UPDATE purchase_order_items SET qty_received = qty_received + ? WHERE id = ?').bind(l.qty, l.poi.id));
  }
  if (d.po_id) {
    stmts.push(
      db
        .prepare(
          `UPDATE purchase_orders SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM purchase_order_items WHERE po_id = ?1 AND qty_received < qty_ordered) THEN 'received' ELSE 'partial' END,
             updated_at = datetime('now') WHERE id = ?1`,
        )
        .bind(d.po_id),
    );
  }
  if (d.create_invoice) {
    stmts.push(
      ...seqReserve(db, 'PINVOICE'),
      db
        .prepare(
          `INSERT INTO purchase_invoices (id, number, supplier_ref, supplier_id, receipt_id, due_date, total_ht, total_vat, total_ttc, created_by)
           VALUES (?, ${seqExpr('PINVOICE')}, ?,?,?,?,?,?,?,?)`,
        )
        .bind(uuid(), d.invoice_supplier_ref ?? d.supplier_doc_ref, d.supplier_id, id, d.invoice_due_date, totals.subtotal_ht, totals.total_vat, totals.total_ttc + d.extra_costs, u.id),
    );
  }
  stmts.push(auditStmt(c, 'create', 'goods_receipts', id, null, { ...d, totals }));
  await tx(db, stmts);
  const r = await first<any>(db, 'SELECT id, number FROM goods_receipts WHERE id = ?', id);
  return c.json(r);
});

purchases.get('/receipts', perm('purchases.view', 'receipts.manage'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['r.received_at BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(r.number LIKE ? OR s.name LIKE ? OR r.supplier_doc_ref LIKE ?)');
    params.push(like, like, like);
  }
  if (c.req.query('invoiced') === '0') where.push('r.invoiced = 0');
  const rows = await all<any>(
    c.env.DB,
    `SELECT r.*, s.name AS supplier_name, po.number AS po_number, u.full_name AS created_by_name, (SELECT SUM(qty) FROM goods_receipt_items WHERE receipt_id = r.id) AS units
       FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN purchase_orders po ON po.id = r.po_id LEFT JOIN users u ON u.id = r.created_by
      WHERE ${where.join(' AND ')} ORDER BY r.received_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const t = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id WHERE ${where.join(' AND ')}`, ...params);
  const fin = can(c, 'purchases.manage') || can(c, 'finance.view');
  return c.json({ rows: fin ? rows : rows.map((r) => ({ ...r, total_ht: null, total_vat: null, total_ttc: null })), total: t?.n ?? 0 });
});

purchases.get('/receipts/:id', perm('purchases.view', 'receipts.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const r = await first<any>(
    db,
    `SELECT r.*, s.name AS supplier_name, s.address AS supplier_address, s.tax_id AS supplier_tax_id, s.phone AS supplier_phone, w.name AS warehouse_name, u.full_name AS created_by_name,
            (SELECT id FROM purchase_invoices WHERE receipt_id = r.id) AS invoice_id
       FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN users u ON u.id = r.created_by WHERE r.id = ?`,
    id,
  );
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Réception introuvable.');
  const items = await all<any>(db, `SELECT i.*, p.name AS product_name, p.reference, p.unit FROM goods_receipt_items i JOIN products p ON p.id = i.product_id WHERE receipt_id = ?`, id);
  const fin = can(c, 'purchases.manage') || can(c, 'finance.view');
  return c.json({
    ...r,
    ...(fin ? {} : { total_ht: null, total_vat: null, total_ttc: null, extra_costs: null }),
    items: fin ? items : items.map((i) => ({ ...i, unit_price: null, line_ht: null, line_vat: null })),
  });
});

// ───────────── Factures fournisseurs ─────────────
purchases.get('/invoices', perm('purchases.manage', 'finance.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const where = ['1=1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(pi.number LIKE ? OR pi.supplier_ref LIKE ? OR s.name LIKE ?)');
    params.push(like, like, like);
  }
  const st = c.req.query('status');
  if (st === 'open') where.push("pi.status IN ('unpaid','partial')");
  else if (st === 'overdue') where.push("pi.status IN ('unpaid','partial') AND pi.due_date < date('now','+1 hour')");
  else if (st) {
    where.push('pi.status = ?');
    params.push(st);
  }
  if (c.req.query('supplier_id')) {
    where.push('pi.supplier_id = ?');
    params.push(c.req.query('supplier_id'));
  }
  const rows = await all(
    c.env.DB,
    `SELECT pi.*, s.name AS supplier_name, r.number AS receipt_number, pi.total_ttc - pi.amount_paid AS due
       FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id LEFT JOIN goods_receipts r ON r.id = pi.receipt_id
      WHERE ${where.join(' AND ')} ORDER BY pi.invoice_date DESC, pi.created_at DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const t = await first<any>(
    c.env.DB,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN pi.status IN ('unpaid','partial') THEN pi.total_ttc - pi.amount_paid ELSE 0 END) AS due FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id WHERE ${where.join(' AND ')}`,
    ...params,
  );
  return c.json({ rows, total: t?.n ?? 0, total_due: t?.due ?? 0 });
});

/** Facture depuis une réception : AUCUN mouvement de stock (déjà fait à la réception). */
purchases.post('/invoices/from-receipt/:rid', perm('purchases.manage'), async (c) => {
  const rid = c.req.param('rid');
  const d = await body(c, z.object({ supplier_ref: zOptStr(80), due_date: zOptStr(10), invoice_date: zOptStr(10), stamp: zMoney.default(0) }));
  const db = c.env.DB;
  const r = await first<any>(db, 'SELECT * FROM goods_receipts WHERE id = ?', rid);
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Réception introuvable.');
  if (r.invoiced) throw new HttpError(409, 'RECEIPT_ALREADY_INVOICED', 'Cette réception est déjà facturée.');
  const id = uuid();
  await tx(db, [
    ...seqReserve(db, 'PINVOICE'),
    db
      .prepare(
        `INSERT INTO purchase_invoices (id, number, supplier_ref, supplier_id, receipt_id, invoice_date, due_date, total_ht, total_vat, stamp, total_ttc, created_by)
         VALUES (?, ${seqExpr('PINVOICE')}, ?,?,?, COALESCE(?, date('now','+1 hour')), ?,?,?,?,?,?)`,
      )
      .bind(id, d.supplier_ref, r.supplier_id, rid, d.invoice_date, d.due_date, r.total_ht, r.total_vat, d.stamp, r.total_ttc + r.extra_costs + d.stamp, c.get('user').id),
    db.prepare('UPDATE goods_receipts SET invoiced = 1 WHERE id = ? AND invoiced = 0').bind(rid),
    auditStmt(c, 'create', 'purchase_invoices', id, null, { receipt: r.number, ...d }),
  ]);
  return c.json({ id });
});

/** Facture fournisseur directe (frais, historique) — sans mouvement de stock. */
purchases.post('/invoices', perm('purchases.manage'), async (c) => {
  const d = await body(
    c,
    z.object({ supplier_id: z.string(), supplier_ref: zOptStr(80), invoice_date: zOptStr(10), due_date: zOptStr(10), total_ht: zMoney, total_vat: zMoney, stamp: zMoney.default(0), notes: zOptStr(500) }),
  );
  const db = c.env.DB;
  const id = uuid();
  await tx(db, [
    ...seqReserve(db, 'PINVOICE'),
    db
      .prepare(
        `INSERT INTO purchase_invoices (id, number, supplier_ref, supplier_id, invoice_date, due_date, total_ht, total_vat, stamp, total_ttc, notes, created_by)
         VALUES (?, ${seqExpr('PINVOICE')}, ?,?, COALESCE(?, date('now','+1 hour')), ?,?,?,?,?,?,?)`,
      )
      .bind(id, d.supplier_ref, d.supplier_id, d.invoice_date, d.due_date, d.total_ht, d.total_vat, d.stamp, d.total_ht + d.total_vat + d.stamp, d.notes, c.get('user').id),
    auditStmt(c, 'create', 'purchase_invoices', id, null, d),
  ]);
  return c.json({ id });
});

purchases.post('/invoices/:id/cancel', perm('purchases.manage'), async (c) => {
  const id = c.req.param('id');
  const { reason } = await body(c, z.object({ reason: z.string().trim().min(3).max(300) }));
  const db = c.env.DB;
  const pi = await first<any>(db, 'SELECT * FROM purchase_invoices WHERE id = ?', id);
  if (!pi) throw new HttpError(404, 'NOT_FOUND', 'Facture introuvable.');
  if (pi.amount_paid > 0) throw new HttpError(409, 'HAS_PAYMENTS', 'Facture déjà (partiellement) réglée : annulation impossible.');
  await tx(db, [
    db.prepare(`UPDATE purchase_invoices SET status = 'cancelled' WHERE id = ?`).bind(id),
    ...(pi.receipt_id ? [db.prepare('UPDATE goods_receipts SET invoiced = 0 WHERE id = ?').bind(pi.receipt_id)] : []),
    // libère la contrainte d'unicité réception → facture pour permettre une refacturation
    db.prepare('UPDATE purchase_invoices SET receipt_id = NULL WHERE id = ?').bind(id),
    auditStmt(c, 'cancel', 'purchase_invoices', id, pi, null, reason),
  ]);
  return c.json({ ok: true });
});

// ───────────── Retours fournisseurs ─────────────
purchases.get('/returns', perm('purchases.view', 'returns.manage'), async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT sr.*, s.name AS supplier_name, r.number AS receipt_number, u.full_name AS created_by_name
         FROM supplier_returns sr JOIN suppliers s ON s.id = sr.supplier_id LEFT JOIN goods_receipts r ON r.id = sr.receipt_id LEFT JOIN users u ON u.id = sr.created_by
        ORDER BY sr.created_at DESC LIMIT 300`,
    ),
  ),
);

purchases.post('/returns', perm('returns.manage'), async (c) => {
  const d = await body(
    c,
    z.object({
      supplier_id: z.string(),
      receipt_id: zOptStr(64),
      warehouse_id: zOptStr(64),
      reason: z.string().trim().min(3, 'Motif requis').max(500),
      items: z.array(z.object({ product_id: z.string(), qty: z.number().int().min(1), receipt_item_id: zOptStr(64) })).min(1),
    }),
  );
  const db = c.env.DB;
  const u = c.get('user');
  const wh = d.warehouse_id ?? (await defaultWarehouse(db));
  const id = uuid();
  const stmts: D1PreparedStatement[] = [...seqReserve(db, 'SRETURN')];
  let totalHt = 0;
  let totalTtc = 0;
  const itemStmts: D1PreparedStatement[] = [];
  for (const it of d.items) {
    const p = await first<any>(db, 'SELECT id, name, purchase_price, avg_cost, vat_bp FROM products WHERE id = ?', it.product_id);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
    const ri = it.receipt_item_id ? await first<any>(db, 'SELECT * FROM goods_receipt_items WHERE id = ?', it.receipt_item_id) : null;
    const unit = ri?.unit_price ?? p.purchase_price;
    const vat = ri?.vat_bp ?? p.vat_bp;
    const amt = computeLine(unit, it.qty, ri?.discount_bp ?? 0, vat);
    totalHt += amt.line_ht;
    totalTtc += amt.line_ttc;
    const fefo = await fefoAllocate(db, it.product_id, wh, it.qty, true);
    itemStmts.push(
      db.prepare('INSERT INTO supplier_return_items (id, return_id, product_id, qty, unit_price, vat_bp) VALUES (?,?,?,?,?,?)').bind(uuid(), id, it.product_id, it.qty, unit, vat),
      ...batchDecrementStmts(db, fefo.allocations),
      ...stockMoveStmts(db, {
        product_id: it.product_id, warehouse_id: wh, type: 'retour_fournisseur', qty: -it.qty, unit_cost: p.avg_cost, doc_type: 'supplier_return', doc_id: id,
        doc_number_sql: seqExpr('SRETURN'), reason: d.reason, user_id: u.id,
      }),
    );
    if (ri) itemStmts.push(db.prepare('UPDATE goods_receipt_items SET returned_qty = returned_qty + ? WHERE id = ?').bind(it.qty, ri.id));
  }
  stmts.push(
    db
      .prepare(`INSERT INTO supplier_returns (id, number, supplier_id, receipt_id, warehouse_id, reason, total_ht, total_ttc, created_by) VALUES (?, ${seqExpr('SRETURN')}, ?,?,?,?,?,?,?)`)
      .bind(id, d.supplier_id, d.receipt_id, wh, d.reason, totalHt, totalTtc, u.id),
    ...itemStmts,
    auditStmt(c, 'create', 'supplier_returns', id, null, d, d.reason),
  );
  await tx(db, stmts);
  return c.json({ id });
});
