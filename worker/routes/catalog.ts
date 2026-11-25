import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, HttpError, all, first, tx, uuid, body, perm, need, can, auditStmt, requireAuth, zMoney, zBp, zOptStr, pageParams,
  stockMoveStmts, defaultWarehouse, maskFinance, getSetting, run,
} from '../lib';
import { analyzeBarcode, generateInternalEan13 } from '../../shared/barcode';
import { applyBp } from '../../shared/money';

export const products = new Hono<AppEnv>();
products.use('*', requireAuth);

const barcodeSchema = z.object({
  barcode: z.string().transform((s) => analyzeBarcode(s).code).pipe(z.string().min(1, 'code-barres vide').max(64)),
  packaging: z.enum(['piece', 'pack', 'carton']).default('piece'),
  qty_per_unit: z.number().int().min(1).max(100000).default(1),
  is_primary: z.boolean().default(false),
});

const productSchema = z.object({
  reference: z.string().trim().max(60).optional().default(''),
  name: z.string().trim().min(1, 'Désignation requise').max(200),
  description: zOptStr(2000),
  category_id: zOptStr(64),
  brand_id: zOptStr(64),
  supplier_id: zOptStr(64),
  purchase_price: zMoney.default(0),
  sale_price: zMoney,
  price_retail: zMoney.nullable().optional(),
  price_wholesale: zMoney.nullable().optional(),
  price_distributor: zMoney.nullable().optional(),
  vat_bp: zBp.default(1900),
  unit: z.string().trim().min(1).max(30).default('pièce'),
  packaging: zOptStr(60),
  units_per_carton: z.number().int().min(1).nullable().optional(),
  min_stock: z.number().int().min(0).default(0),
  max_stock: z.number().int().min(0).nullable().optional(),
  track_batches: z.boolean().default(false),
  is_favorite: z.boolean().default(false),
  photo: z.string().max(400000).nullable().optional().refine((v) => !v || /^data:image\/(jpeg|png|webp);base64,/.test(v), 'image invalide'),
  barcodes: z.array(barcodeSchema).max(20).default([]),
  // à la création uniquement
  initial_stock: z.number().int().min(0).optional(),
  initial_batch_number: zOptStr(60),
  initial_expires_at: zOptStr(10),
});

const PRODUCT_LIST_SQL = `
  SELECT p.id, p.reference, p.name, p.category_id, c.name AS category_name, p.brand_id, b.name AS brand_name, p.supplier_id, s.name AS supplier_name,
         p.purchase_price, p.avg_cost, p.sale_price, p.price_retail, p.price_wholesale, p.price_distributor, p.vat_bp, p.unit, p.min_stock, p.max_stock,
         p.track_batches, p.is_favorite, p.is_active, p.packaging, p.units_per_carton, p.updated_at, p.created_at,
         COALESCE((SELECT SUM(quantity) FROM stock_balances sb WHERE sb.product_id = p.id), 0) AS stock,
         (SELECT barcode FROM product_barcodes pb WHERE pb.product_id = p.id ORDER BY is_primary DESC, created_at LIMIT 1) AS barcode,
         (SELECT MIN(expires_at) FROM product_batches pbt WHERE pbt.product_id = p.id AND pbt.remaining_qty > 0) AS next_expiry
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN suppliers s ON s.id = p.supplier_id`;

products.get('/', perm('products.view', 'pos.use', 'stock.view', 'receipts.manage'), async (c) => {
  const { pageSize, offset, q, like } = pageParams(c);
  const where: string[] = [];
  const params: unknown[] = [];
  const status = c.req.query('status') ?? 'active';
  if (status === 'active') where.push('p.is_active = 1');
  else if (status === 'archived') where.push('p.is_active = 0');
  if (q) {
    where.push('(p.name LIKE ? OR p.reference LIKE ? OR EXISTS (SELECT 1 FROM product_barcodes x WHERE x.product_id = p.id AND x.barcode LIKE ?))');
    params.push(like, like, like);
  }
  for (const f of ['category_id', 'supplier_id', 'brand_id'] as const) {
    const v = c.req.query(f);
    if (v) {
      where.push(`p.${f} = ?`);
      params.push(v);
    }
  }
  if (c.req.query('favorites') === '1') where.push('p.is_favorite = 1');
  const stockFilter = c.req.query('stock');
  let having = '';
  if (stockFilter === 'low') having = 'WHERE stock > 0 AND stock <= min_stock';
  else if (stockFilter === 'out') having = 'WHERE stock <= 0';
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortMap: Record<string, string> = { name: 'name', reference: 'reference', stock: 'stock', sale_price: 'sale_price', updated_at: 'updated_at' };
  const sort = sortMap[c.req.query('sort') ?? 'name'] ?? 'name';
  const dir = c.req.query('dir') === 'desc' ? 'DESC' : 'ASC';
  const base = `SELECT * FROM (${PRODUCT_LIST_SQL} ${w}) ${having}`;
  const rows = await all(c.env.DB, `${base} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const total = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM (${base})`, ...params);
  return c.json({ rows: maskFinance(c, rows), total: total?.n ?? 0 });
});

/** Recherche par code-barres — utilisée par le scanner dans tous les modules. */
products.get('/lookup/:code', perm('products.view', 'pos.use', 'stock.view', 'receipts.manage', 'inventory.manage'), async (c) => {
  const code = analyzeBarcode(decodeURIComponent(c.req.param('code'))).code;
  const db = c.env.DB;
  let row = await first<any>(
    db,
    `SELECT pb.product_id, pb.qty_per_unit, pb.packaging AS scanned_packaging, pb.barcode FROM product_barcodes pb WHERE pb.barcode = ?`,
    code,
  );
  if (!row) {
    // repli : référence interne
    const p = await first<any>(db, 'SELECT id AS product_id FROM products WHERE reference = ?', code);
    if (p) row = { ...p, qty_per_unit: 1, scanned_packaging: 'piece', barcode: code };
  }
  if (!row) return c.json({ found: false, code, info: analyzeBarcode(code) });
  const product = await first<any>(db, `SELECT * FROM (${PRODUCT_LIST_SQL}) WHERE id = ?`, row.product_id);
  return c.json({ found: true, code, qty_per_unit: row.qty_per_unit, scanned_packaging: row.scanned_packaging, product: maskFinance(c, [product])[0] });
});

products.get('/:id', perm('products.view', 'pos.use', 'stock.view'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const p = await first<any>(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  const [barcodes, stock, batches, history] = await Promise.all([
    all(db, 'SELECT * FROM product_barcodes WHERE product_id = ? ORDER BY is_primary DESC, created_at', id),
    all(db, 'SELECT sb.warehouse_id, w.name AS warehouse_name, sb.quantity FROM stock_balances sb JOIN warehouses w ON w.id = sb.warehouse_id WHERE product_id = ?', id),
    all(db, 'SELECT * FROM product_batches WHERE product_id = ? AND remaining_qty > 0 ORDER BY expires_at IS NULL, expires_at', id),
    can(c, 'finance.view') || can(c, 'products.prices')
      ? all(db, 'SELECT h.*, u.full_name AS user_name FROM product_price_history h LEFT JOIN users u ON u.id = h.user_id WHERE product_id = ? ORDER BY h.id DESC LIMIT 50', id)
      : Promise.resolve([]),
  ]);
  const used = await first<{ n: number }>(db, 'SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) + (SELECT COUNT(*) FROM goods_receipt_items WHERE product_id = ?) AS n', id, id);
  return c.json({ ...maskFinance(c, [p])[0], barcodes, stock, batches, price_history: history, used_in_documents: (used?.n ?? 0) > 0 });
});

async function assertBarcodesFree(db: D1Database, codes: string[], exceptProductId?: string) {
  if (new Set(codes).size !== codes.length) throw new HttpError(409, 'BARCODE_DUPLICATE', 'Le même code-barres apparaît deux fois dans la fiche.');
  for (const code of codes) {
    const ex = await first<any>(db, 'SELECT p.id, p.name, p.reference, p.is_active FROM product_barcodes pb JOIN products p ON p.id = pb.product_id WHERE pb.barcode = ?', code);
    if (ex && ex.id !== exceptProductId) {
      throw new HttpError(409, 'BARCODE_DUPLICATE', `Le code-barres ${code} est déjà attribué au produit « ${ex.name} » (${ex.reference})${ex.is_active ? '' : ' — archivé'}.`, { product: ex });
    }
  }
}

function genReference() {
  return 'P' + Date.now().toString(36).toUpperCase().slice(-6) + Math.floor(Math.random() * 36).toString(36).toUpperCase();
}

products.post('/', perm('products.manage'), async (c) => {
  const d = await body(c, productSchema);
  const db = c.env.DB;
  const u = c.get('user');
  if (!can(c, 'finance.view') && !can(c, 'products.prices') && d.purchase_price) d.purchase_price = 0;
  const reference = d.reference || genReference();
  await assertBarcodesFree(db, d.barcodes.map((b) => b.barcode));
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO products (id, reference, name, description, category_id, brand_id, supplier_id, purchase_price, avg_cost, sale_price, price_retail, price_wholesale,
           price_distributor, vat_bp, unit, packaging, units_per_carton, min_stock, max_stock, track_batches, is_favorite, photo, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, reference, d.name, d.description, d.category_id, d.brand_id, d.supplier_id, d.purchase_price, d.purchase_price, d.sale_price,
        d.price_retail ?? null, d.price_wholesale ?? null, d.price_distributor ?? null, d.vat_bp, d.unit, d.packaging, d.units_per_carton ?? null,
        d.min_stock, d.max_stock ?? null, d.track_batches ? 1 : 0, d.is_favorite ? 1 : 0, d.photo ?? null, u.id,
      ),
    ...d.barcodes.map((b, i) =>
      db
        .prepare('INSERT INTO product_barcodes (id, product_id, barcode, packaging, qty_per_unit, is_primary) VALUES (?,?,?,?,?,?)')
        .bind(uuid(), id, b.barcode, b.packaging, b.qty_per_unit, b.is_primary || i === 0 ? 1 : 0),
    ),
  ];
  if (d.initial_stock && d.initial_stock > 0) {
    if (!can(c, 'stock.adjust')) throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas le droit d'initialiser le stock.");
    const wh = await defaultWarehouse(db);
    let batchId: string | null = null;
    if (d.track_batches || d.initial_batch_number) {
      batchId = uuid();
      stmts.push(
        db
          .prepare('INSERT INTO product_batches (id, product_id, warehouse_id, batch_number, supplier_id, expires_at, initial_qty, remaining_qty, unit_cost) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(batchId, id, wh, d.initial_batch_number || 'INITIAL', d.supplier_id, d.initial_expires_at, d.initial_stock, d.initial_stock, d.purchase_price),
      );
    }
    stmts.push(...stockMoveStmts(db, { product_id: id, warehouse_id: wh, type: 'initial', qty: d.initial_stock, unit_cost: d.purchase_price, batch_id: batchId, doc_type: 'product', doc_id: id, reason: 'Stock initial', user_id: u.id }));
  }
  stmts.push(auditStmt(c, 'create', 'products', id, null, { ...d, photo: d.photo ? '[image]' : null }));
  await tx(db, stmts);
  return c.json({ id, reference });
});

const PRICE_FIELDS = ['purchase_price', 'sale_price', 'price_retail', 'price_wholesale', 'price_distributor', 'vat_bp'] as const;

products.put('/:id', perm('products.manage'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, productSchema);
  const db = c.env.DB;
  const u = c.get('user');
  const old = await first<any>(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  const canPrices = can(c, 'products.prices');
  const canCost = can(c, 'finance.view') || canPrices;
  // Champs de prix : seuls les utilisateurs autorisés peuvent les modifier
  for (const f of PRICE_FIELDS) {
    if (f === 'purchase_price' && !canCost) (d as any)[f] = old[f];
    else if (!canPrices && f !== 'purchase_price' && (d as any)[f] !== undefined && (d as any)[f] !== old[f]) {
      throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas l'autorisation de modifier les prix.");
    }
  }
  await assertBarcodesFree(db, d.barcodes.map((b) => b.barcode), id);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE products SET reference=?, name=?, description=?, category_id=?, brand_id=?, supplier_id=?, purchase_price=?, sale_price=?, price_retail=?,
           price_wholesale=?, price_distributor=?, vat_bp=?, unit=?, packaging=?, units_per_carton=?, min_stock=?, max_stock=?, track_batches=?, is_favorite=?,
           photo=?, updated_at=datetime('now') WHERE id=?`,
      )
      .bind(
        d.reference || old.reference, d.name, d.description, d.category_id, d.brand_id, d.supplier_id, d.purchase_price, d.sale_price, d.price_retail ?? null,
        d.price_wholesale ?? null, d.price_distributor ?? null, d.vat_bp, d.unit, d.packaging, d.units_per_carton ?? null, d.min_stock, d.max_stock ?? null,
        d.track_batches ? 1 : 0, d.is_favorite ? 1 : 0, d.photo === undefined ? old.photo : d.photo, id,
      ),
    db.prepare('DELETE FROM product_barcodes WHERE product_id = ?').bind(id),
    ...d.barcodes.map((b, i) =>
      db
        .prepare('INSERT INTO product_barcodes (id, product_id, barcode, packaging, qty_per_unit, is_primary) VALUES (?,?,?,?,?,?)')
        .bind(uuid(), id, b.barcode, b.packaging, b.qty_per_unit, b.is_primary || i === 0 ? 1 : 0),
    ),
  ];
  for (const f of PRICE_FIELDS) {
    const nv = (d as any)[f] ?? null;
    if (nv !== old[f]) {
      stmts.push(db.prepare('INSERT INTO product_price_history (product_id, field, old_value, new_value, user_id, reason) VALUES (?,?,?,?,?,?)').bind(id, f, old[f], nv, u.id, 'Modification fiche'));
    }
  }
  const { photo: _p, ...oldNoPhoto } = old;
  stmts.push(auditStmt(c, 'update', 'products', id, oldNoPhoto, { ...d, photo: undefined }));
  await tx(db, stmts);
  return c.json({ ok: true });
});

products.post('/:id/duplicate', perm('products.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const p = await first<any>(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  const nid = uuid();
  const ref = (p.reference + '-COPIE-' + Math.floor(Math.random() * 1000)).slice(0, 60);
  await tx(db, [
    db
      .prepare(
        `INSERT INTO products (id, reference, name, description, category_id, brand_id, supplier_id, purchase_price, avg_cost, sale_price, price_retail, price_wholesale,
           price_distributor, vat_bp, unit, packaging, units_per_carton, min_stock, max_stock, track_batches, photo, created_by)
         SELECT ?, ?, name || ' (copie)', description, category_id, brand_id, supplier_id, purchase_price, purchase_price, sale_price, price_retail, price_wholesale,
           price_distributor, vat_bp, unit, packaging, units_per_carton, min_stock, max_stock, track_batches, photo, ? FROM products WHERE id = ?`,
      )
      .bind(nid, ref, c.get('user').id, id),
    auditStmt(c, 'duplicate', 'products', nid, { from: id }, null),
  ]);
  return c.json({ id: nid });
});

products.post('/:id/active', perm('products.delete'), async (c) => {
  const id = c.req.param('id');
  const { active } = await body(c, z.object({ active: z.boolean() }));
  const db = c.env.DB;
  await tx(db, [
    db.prepare(`UPDATE products SET is_active = ?, updated_at = datetime('now') WHERE id = ?`).bind(active ? 1 : 0, id),
    auditStmt(c, active ? 'restore' : 'archive', 'products', id),
  ]);
  return c.json({ ok: true });
});

/** Suppression définitive : uniquement si le produit n'a jamais été utilisé dans un document. Sinon → archivage. */
products.delete('/:id', perm('products.delete'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const p = await first<any>(db, 'SELECT id, reference, name FROM products WHERE id = ?', id);
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
  const used = await first<{ n: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM goods_receipt_items WHERE product_id = ?1)
          + (SELECT COUNT(*) FROM purchase_order_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM quotation_items WHERE product_id = ?1)
          + (SELECT COUNT(*) FROM inventory_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM supplier_return_items WHERE product_id = ?1)
          + (SELECT COUNT(*) FROM stock_movements WHERE product_id = ?1 AND type <> 'initial') AS n`,
    id,
  );
  if ((used?.n ?? 0) > 0) {
    throw new HttpError(409, 'PRODUCT_IN_USE', 'Ce produit est utilisé dans des documents (ventes, achats, inventaires). Il ne peut pas être supprimé : archivez-le à la place.');
  }
  await tx(db, [
    db.prepare('DELETE FROM stock_movements WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM product_batches WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM stock_balances WHERE product_id = ?').bind(id),
    db.prepare('DELETE FROM products WHERE id = ?').bind(id),
    auditStmt(c, 'delete', 'products', id, p, null),
  ]);
  return c.json({ ok: true });
});

/** Modification des prix en masse, avec historique. */
products.post('/bulk-price', perm('products.prices'), async (c) => {
  const d = await body(
    c,
    z.object({
      product_ids: z.array(z.string()).max(5000).optional(),
      category_id: z.string().optional(),
      supplier_id: z.string().optional(),
      field: z.enum(['sale_price', 'price_retail', 'price_wholesale', 'price_distributor', 'purchase_price']),
      mode: z.enum(['percent', 'amount', 'set']),
      value: z.number().int().min(-1e9).max(1e9), // percent : bp ; amount/set : millimes
      reason: z.string().trim().min(2, 'Motif requis').max(300),
    }),
  );
  const db = c.env.DB;
  const where: string[] = ['is_active = 1'];
  const params: unknown[] = [];
  if (d.product_ids?.length) {
    where.push(`id IN (${d.product_ids.map(() => '?').join(',')})`);
    params.push(...d.product_ids);
  }
  if (d.category_id) {
    where.push('category_id = ?');
    params.push(d.category_id);
  }
  if (d.supplier_id) {
    where.push('supplier_id = ?');
    params.push(d.supplier_id);
  }
  if (params.length === 0) throw new HttpError(400, 'NO_SCOPE', 'Sélectionnez des produits, une catégorie ou un fournisseur.');
  const rows = await all<any>(db, `SELECT id, ${d.field} AS v, sale_price FROM products WHERE ${where.join(' AND ')}`, ...params);
  const u = c.get('user');
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    const base = r.v ?? r.sale_price;
    const nv = d.mode === 'set' ? d.value : d.mode === 'amount' ? base + d.value : base + applyBp(base, d.value);
    if (nv < 0) throw new HttpError(400, 'NEGATIVE_PRICE', 'Le résultat donnerait un prix négatif.');
    if (nv === r.v) continue;
    stmts.push(db.prepare(`UPDATE products SET ${d.field} = ?, updated_at = datetime('now') WHERE id = ?`).bind(nv, r.id));
    stmts.push(db.prepare('INSERT INTO product_price_history (product_id, field, old_value, new_value, user_id, reason) VALUES (?,?,?,?,?,?)').bind(r.id, d.field, r.v, nv, u.id, d.reason));
  }
  stmts.push(auditStmt(c, 'bulk_price', 'products', null, null, { ...d, count: stmts.length / 2 }, d.reason));
  // D1 limite la taille d'un batch : découpage par paquets (chaque paquet reste atomique)
  for (let i = 0; i < stmts.length; i += 200) await tx(db, stmts.slice(i, i + 200));
  return c.json({ updated: (stmts.length - 1) / 2 });
});

products.post('/generate-barcode', perm('products.manage'), async (c) => {
  const db = c.env.DB;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = Number(await getSetting(db, 'internal_barcode_seq', '0')) + 1;
    await run(db, `INSERT INTO settings (key, value) VALUES ('internal_barcode_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(cur));
    const code = generateInternalEan13(cur);
    const ex = await first(db, 'SELECT 1 FROM product_barcodes WHERE barcode = ?', code);
    if (!ex) return c.json({ barcode: code });
  }
  throw new HttpError(500, 'GEN_FAILED', 'Impossible de générer un code unique.');
});

// ───────────── Catégories & marques ─────────────
export const categories = new Hono<AppEnv>();
categories.use('*', requireAuth);
categories.get('/', async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT c.*, p.name AS parent_name, (SELECT COUNT(*) FROM products x WHERE x.category_id = c.id AND x.is_active = 1) AS products_count
         FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY COALESCE(p.name, c.name), c.parent_id IS NOT NULL, c.name`,
    ),
  ),
);
categories.post('/', perm('products.manage'), async (c) => {
  const d = await body(c, z.object({ name: z.string().trim().min(1).max(100), parent_id: zOptStr(64) }));
  const id = uuid();
  const db = c.env.DB;
  await tx(db, [db.prepare('INSERT INTO categories (id, name, parent_id) VALUES (?,?,?)').bind(id, d.name, d.parent_id), auditStmt(c, 'create', 'categories', id, null, d)]);
  return c.json({ id });
});
categories.put('/:id', perm('products.manage'), async (c) => {
  const d = await body(c, z.object({ name: z.string().trim().min(1).max(100), parent_id: zOptStr(64) }));
  const id = c.req.param('id');
  if (d.parent_id === id) throw new HttpError(400, 'CYCLE', 'Une catégorie ne peut pas être sa propre parente.');
  const db = c.env.DB;
  await tx(db, [db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE id = ?').bind(d.name, d.parent_id, id), auditStmt(c, 'update', 'categories', id, null, d)]);
  return c.json({ ok: true });
});
categories.delete('/:id', perm('products.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const n = await first<{ n: number }>(db, 'SELECT (SELECT COUNT(*) FROM products WHERE category_id = ?1) + (SELECT COUNT(*) FROM categories WHERE parent_id = ?1) AS n', id);
  if ((n?.n ?? 0) > 0) throw new HttpError(409, 'IN_USE', 'Catégorie utilisée par des produits ou des sous-catégories.');
  await tx(db, [db.prepare('DELETE FROM categories WHERE id = ?').bind(id), auditStmt(c, 'delete', 'categories', id)]);
  return c.json({ ok: true });
});

export const brands = new Hono<AppEnv>();
brands.use('*', requireAuth);
brands.get('/', async (c) => c.json(await all(c.env.DB, `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.id) AS products_count FROM brands b ORDER BY name`)));
brands.post('/', perm('products.manage'), async (c) => {
  const d = await body(c, z.object({ name: z.string().trim().min(1).max(100) }));
  const id = uuid();
  const db = c.env.DB;
  await tx(db, [db.prepare('INSERT INTO brands (id, name) VALUES (?,?)').bind(id, d.name), auditStmt(c, 'create', 'brands', id, null, d)]);
  return c.json({ id });
});
brands.put('/:id', perm('products.manage'), async (c) => {
  const d = await body(c, z.object({ name: z.string().trim().min(1).max(100) }));
  const db = c.env.DB;
  await tx(db, [db.prepare('UPDATE brands SET name = ? WHERE id = ?').bind(d.name, c.req.param('id')), auditStmt(c, 'update', 'brands', c.req.param('id'), null, d)]);
  return c.json({ ok: true });
});
brands.delete('/:id', perm('products.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const n = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM products WHERE brand_id = ?', id);
  if ((n?.n ?? 0) > 0) throw new HttpError(409, 'IN_USE', 'Marque utilisée par des produits.');
  await tx(db, [db.prepare('DELETE FROM brands WHERE id = ?').bind(id), auditStmt(c, 'delete', 'brands', id)]);
  return c.json({ ok: true });
});

// ───────────── Règles de remise ─────────────
export const discountRules = new Hono<AppEnv>();
discountRules.use('*', requireAuth);
const ruleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  priority: z.number().int().min(1).max(1000),
  product_id: zOptStr(64),
  category_id: zOptStr(64),
  customer_type: z.enum(['particulier', 'detaillant', 'grossiste', 'distributeur']).nullable().optional(),
  min_qty: z.number().int().min(0).default(0),
  min_amount: zMoney.default(0),
  discount_bp: zBp,
  starts_at: zOptStr(10),
  ends_at: zOptStr(10),
  is_active: z.boolean().default(true),
});
discountRules.get('/', async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT r.*, p.name AS product_name, c.name AS category_name FROM discount_rules r LEFT JOIN products p ON p.id = r.product_id
        LEFT JOIN categories c ON c.id = r.category_id ORDER BY r.priority, r.name`,
    ),
  ),
);
discountRules.post('/', perm('products.prices'), async (c) => {
  const d = await body(c, ruleSchema);
  const id = uuid();
  const db = c.env.DB;
  await tx(db, [
    db
      .prepare('INSERT INTO discount_rules (id, name, priority, product_id, category_id, customer_type, min_qty, min_amount, discount_bp, starts_at, ends_at, is_active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, d.name, d.priority, d.product_id, d.category_id, d.customer_type ?? null, d.min_qty, d.min_amount, d.discount_bp, d.starts_at, d.ends_at, d.is_active ? 1 : 0, c.get('user').id),
    auditStmt(c, 'create', 'discount_rules', id, null, d),
  ]);
  return c.json({ id });
});
discountRules.put('/:id', perm('products.prices'), async (c) => {
  const d = await body(c, ruleSchema);
  const id = c.req.param('id');
  const db = c.env.DB;
  const old = await first(db, 'SELECT * FROM discount_rules WHERE id = ?', id);
  await tx(db, [
    db
      .prepare('UPDATE discount_rules SET name=?, priority=?, product_id=?, category_id=?, customer_type=?, min_qty=?, min_amount=?, discount_bp=?, starts_at=?, ends_at=?, is_active=? WHERE id=?')
      .bind(d.name, d.priority, d.product_id, d.category_id, d.customer_type ?? null, d.min_qty, d.min_amount, d.discount_bp, d.starts_at, d.ends_at, d.is_active ? 1 : 0, id),
    auditStmt(c, 'update', 'discount_rules', id, old, d),
  ]);
  return c.json({ ok: true });
});
discountRules.delete('/:id', perm('products.prices'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const old = await first(db, 'SELECT * FROM discount_rules WHERE id = ?', id);
  await tx(db, [db.prepare('DELETE FROM discount_rules WHERE id = ?').bind(id), auditStmt(c, 'delete', 'discount_rules', id, old)]);
  return c.json({ ok: true });
});
