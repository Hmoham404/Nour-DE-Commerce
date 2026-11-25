import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, HttpError, all, first, tx, uuid, body, perm, auditStmt, requireAuth, pageParams, zMoney, zSignedMoney, zOptStr, can } from '../lib';

export const CUSTOMER_BALANCE_SQL = `(c.opening_balance
  + COALESCE((SELECT SUM(total_ttc - credited_amount) FROM sales WHERE customer_id = c.id AND status = 'completed'), 0)
  - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND direction = 'in'), 0)
  + COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND direction = 'out'), 0))`;

export const SUPPLIER_BALANCE_SQL = `(s.opening_balance
  + COALESCE((SELECT SUM(total_ttc) FROM purchase_invoices WHERE supplier_id = s.id AND status <> 'cancelled'), 0)
  - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'supplier' AND party_id = s.id AND direction = 'out'), 0)
  + COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'supplier' AND party_id = s.id AND direction = 'in'), 0)
  - COALESCE((SELECT SUM(total_ttc) FROM supplier_returns WHERE supplier_id = s.id), 0))`;

async function nextCode(db: D1Database, table: 'customers' | 'suppliers', prefix: string) {
  const r = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table}`);
  let n = (r?.n ?? 0) + 1;
  for (;;) {
    const code = prefix + String(n).padStart(5, '0');
    if (!(await first(db, `SELECT 1 FROM ${table} WHERE code = ?`, code))) return code;
    n++;
  }
}

// ───────────── Clients ─────────────
export const customers = new Hono<AppEnv>();
customers.use('*', requireAuth);

const customerSchema = z.object({
  code: z.string().trim().max(30).optional().default(''),
  name: z.string().trim().min(1, 'Nom requis').max(200),
  type: z.enum(['particulier', 'detaillant', 'grossiste', 'distributeur']),
  price_tier: z.enum(['particulier', 'detaillant', 'grossiste', 'distributeur']).nullable().optional(),
  phone: zOptStr(40),
  email: z.string().trim().email('Email invalide').max(120).optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: zOptStr(300),
  tax_id: zOptStr(40),
  credit_limit: zMoney.default(0),
  opening_balance: zSignedMoney.default(0),
  payment_terms_days: z.number().int().min(0).max(365).default(0),
  notes: zOptStr(1000),
});

customers.get('/', perm('customers.view', 'pos.use'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const where = ['1=1'];
  const params: unknown[] = [];
  if (c.req.query('status') !== 'all') where.push('c.is_active = 1');
  if (q) {
    where.push('(c.name LIKE ? OR c.code LIKE ? OR c.phone LIKE ? OR c.tax_id LIKE ?)');
    params.push(like, like, like, like);
  }
  if (c.req.query('type')) {
    where.push('c.type = ?');
    params.push(c.req.query('type'));
  }
  const debtors = c.req.query('debtors') === '1';
  const base = `SELECT * FROM (SELECT c.*, ${CUSTOMER_BALANCE_SQL} AS balance,
      COALESCE((SELECT SUM(total_ttc - credited_amount) FROM sales WHERE customer_id = c.id AND status = 'completed'), 0) AS total_purchases,
      COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND direction = 'in'), 0) AS total_paid,
      (SELECT MIN(due_date) FROM sales WHERE customer_id = c.id AND status = 'completed' AND total_ttc - credited_amount - amount_paid > 0 AND due_date IS NOT NULL) AS oldest_due
      FROM customers c WHERE ${where.join(' AND ')}) ${debtors ? 'WHERE balance > 0' : ''}`;
  const sort = c.req.query('sort') === 'balance' ? 'balance DESC' : 'name';
  const rows = await all(c.env.DB, `${base} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const tot = await first<any>(c.env.DB, `SELECT COUNT(*) AS n, SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS receivables FROM (${base})`, ...params);
  return c.json({ rows, total: tot?.n ?? 0, total_receivables: tot?.receivables ?? 0 });
});

customers.get('/:id', perm('customers.view', 'pos.use'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const cu = await first<any>(db, `SELECT c.*, ${CUSTOMER_BALANCE_SQL} AS balance FROM customers c WHERE c.id = ?`, id);
  if (!cu) throw new HttpError(404, 'NOT_FOUND', 'Client introuvable.');
  const [sales, payments, unpaid, prices] = await Promise.all([
    all(db, `SELECT s.id, s.number, s.sale_date, s.total_ttc, s.amount_paid, s.credited_amount, s.payment_status, s.status, s.due_date, i.number AS invoice_number
               FROM sales s LEFT JOIN invoices i ON i.sale_id = s.id WHERE s.customer_id = ? ORDER BY s.sale_date DESC LIMIT 100`, id),
    all(db, `SELECT id, number, payment_date, amount, method, direction, kind, reference FROM payments WHERE party_type = 'customer' AND party_id = ? ORDER BY payment_date DESC LIMIT 100`, id),
    all(db, `SELECT id, number, sale_date, due_date, total_ttc, amount_paid, credited_amount, total_ttc - credited_amount - amount_paid AS due,
                    CASE WHEN due_date IS NOT NULL AND due_date < date('now','+1 hour') THEN 1 ELSE 0 END AS overdue
               FROM sales WHERE customer_id = ? AND status = 'completed' AND total_ttc - credited_amount - amount_paid > 0 ORDER BY sale_date`, id),
    all(db, `SELECT cp.product_id, cp.price_ht, p.name, p.reference, p.sale_price FROM customer_prices cp JOIN products p ON p.id = cp.product_id WHERE cp.customer_id = ? ORDER BY p.name`, id),
  ]);
  return c.json({ ...cu, sales, payments, unpaid, prices, credit_exceeded: cu.credit_limit > 0 && cu.balance > cu.credit_limit });
});

customers.post('/', perm('customers.manage'), async (c) => {
  const d = await body(c, customerSchema);
  const db = c.env.DB;
  const id = uuid();
  const code = d.code || (await nextCode(db, 'customers', 'C'));
  if (!can(c, 'finance.view') && (d.opening_balance !== 0 || d.credit_limit !== 0)) {
    // le caissier peut créer un client mais pas fixer de crédit / solde initial
    if (!can(c, 'credit.override')) {
      d.opening_balance = 0;
      d.credit_limit = 0;
    }
  }
  await tx(db, [
    db
      .prepare(
        `INSERT INTO customers (id, code, name, type, price_tier, phone, email, address, tax_id, credit_limit, opening_balance, payment_terms_days, notes, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(id, code, d.name, d.type, d.price_tier ?? null, d.phone, d.email, d.address, d.tax_id, d.credit_limit, d.opening_balance, d.payment_terms_days, d.notes, c.get('user').id),
    auditStmt(c, 'create', 'customers', id, null, d),
  ]);
  return c.json({ id, code });
});

customers.put('/:id', perm('customers.manage'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, customerSchema);
  const db = c.env.DB;
  const old = await first<any>(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Client introuvable.');
  if (!can(c, 'finance.view') && !can(c, 'credit.override')) {
    d.credit_limit = old.credit_limit;
    d.opening_balance = old.opening_balance;
  }
  await tx(db, [
    db
      .prepare(
        `UPDATE customers SET code=?, name=?, type=?, price_tier=?, phone=?, email=?, address=?, tax_id=?, credit_limit=?, opening_balance=?, payment_terms_days=?, notes=?,
         updated_at=datetime('now') WHERE id=?`,
      )
      .bind(d.code || old.code, d.name, d.type, d.price_tier ?? null, d.phone, d.email, d.address, d.tax_id, d.credit_limit, d.opening_balance, d.payment_terms_days, d.notes, id),
    auditStmt(c, 'update', 'customers', id, old, d),
  ]);
  return c.json({ ok: true });
});

customers.post('/:id/active', perm('customers.manage'), async (c) => {
  const { active } = await body(c, z.object({ active: z.boolean() }));
  const db = c.env.DB;
  await tx(db, [db.prepare('UPDATE customers SET is_active = ? WHERE id = ?').bind(active ? 1 : 0, c.req.param('id')), auditStmt(c, active ? 'restore' : 'archive', 'customers', c.req.param('id'))]);
  return c.json({ ok: true });
});

customers.put('/:id/prices', perm('products.prices'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, z.object({ product_id: z.string(), price_ht: zMoney.nullable() }));
  const db = c.env.DB;
  await tx(db, [
    d.price_ht === null
      ? db.prepare('DELETE FROM customer_prices WHERE customer_id = ? AND product_id = ?').bind(id, d.product_id)
      : db
          .prepare(`INSERT INTO customer_prices (customer_id, product_id, price_ht) VALUES (?,?,?) ON CONFLICT(customer_id, product_id) DO UPDATE SET price_ht = excluded.price_ht, updated_at = datetime('now')`)
          .bind(id, d.product_id, d.price_ht),
    auditStmt(c, 'custom_price', 'customers', id, null, d),
  ]);
  return c.json({ ok: true });
});

/** Relevé de compte client : écritures chronologiques avec solde progressif. */
customers.get('/:id/statement', perm('customers.view'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const cu = await first<any>(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!cu) throw new HttpError(404, 'NOT_FOUND', 'Client introuvable.');
  const rows = await all<any>(
    db,
    `SELECT sale_date AS date, 'Vente' AS label, number AS ref, total_ttc AS debit, 0 AS credit FROM sales WHERE customer_id = ?1 AND status = 'completed'
     UNION ALL SELECT created_at, 'Avoir (retour)', number, 0, total_ttc FROM credit_notes WHERE customer_id = ?1 AND kind = 'return'
     UNION ALL SELECT payment_date, CASE WHEN direction = 'in' THEN 'Règlement' ELSE 'Remboursement' END, number,
                      CASE WHEN direction = 'out' THEN amount ELSE 0 END, CASE WHEN direction = 'in' THEN amount ELSE 0 END
                 FROM payments WHERE party_type = 'customer' AND party_id = ?1
     ORDER BY 1`,
    id,
  );
  let bal = cu.opening_balance;
  const lines = [{ date: cu.created_at, label: 'Solde initial', ref: '', debit: cu.opening_balance > 0 ? cu.opening_balance : 0, credit: cu.opening_balance < 0 ? -cu.opening_balance : 0, balance: bal }];
  for (const r of rows) {
    bal += r.debit - r.credit;
    lines.push({ ...r, balance: bal });
  }
  return c.json({ party: cu, lines, balance: bal });
});

// ───────────── Fournisseurs ─────────────
export const suppliers = new Hono<AppEnv>();
suppliers.use('*', requireAuth);

const supplierSchema = z.object({
  code: z.string().trim().max(30).optional().default(''),
  name: z.string().trim().min(1, 'Raison sociale requise').max(200),
  contact_name: zOptStr(120),
  phone: zOptStr(40),
  email: z.string().trim().email('Email invalide').max(120).optional().nullable().or(z.literal('')).transform((v) => v || null),
  address: zOptStr(300),
  tax_id: zOptStr(40),
  payment_terms_days: z.number().int().min(0).max(365).default(0),
  opening_balance: zSignedMoney.default(0),
  notes: zOptStr(1000),
});

suppliers.get('/', perm('suppliers.view', 'receipts.manage', 'products.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const where = [c.req.query('status') === 'all' ? '1=1' : 's.is_active = 1'];
  const params: unknown[] = [];
  if (q) {
    where.push('(s.name LIKE ? OR s.code LIKE ? OR s.phone LIKE ? OR s.contact_name LIKE ?)');
    params.push(like, like, like, like);
  }
  const fin = can(c, 'finance.view') || can(c, 'purchases.manage');
  const base = `SELECT * FROM (SELECT s.*, ${SUPPLIER_BALANCE_SQL} AS balance,
      COALESCE((SELECT SUM(total_ttc) FROM purchase_invoices WHERE supplier_id = s.id AND status <> 'cancelled'), 0) AS total_purchases,
      COALESCE((SELECT SUM(amount) FROM payments WHERE party_type = 'supplier' AND party_id = s.id AND direction = 'out'), 0) AS total_paid,
      (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS products_count
      FROM suppliers s WHERE ${where.join(' AND ')}) ${c.req.query('debts') === '1' ? 'WHERE balance > 0' : ''}`;
  const rows = await all<any>(c.env.DB, `${base} ORDER BY ${c.req.query('sort') === 'balance' ? 'balance DESC' : 'name'} LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const tot = await first<any>(c.env.DB, `SELECT COUNT(*) AS n, SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END) AS debts FROM (${base})`, ...params);
  return c.json({
    rows: fin ? rows : rows.map((r) => ({ ...r, balance: null, total_purchases: null, total_paid: null, opening_balance: null })),
    total: tot?.n ?? 0,
    total_debts: fin ? tot?.debts ?? 0 : null,
  });
});

suppliers.get('/:id', perm('suppliers.view'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const s = await first<any>(db, `SELECT s.*, ${SUPPLIER_BALANCE_SQL} AS balance FROM suppliers s WHERE s.id = ?`, id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Fournisseur introuvable.');
  const [products, orders, receipts, invoices, payments] = await Promise.all([
    all(db, `SELECT id, reference, name, purchase_price, sale_price FROM products WHERE supplier_id = ? AND is_active = 1 ORDER BY name LIMIT 500`, id),
    all(db, `SELECT id, number, order_date, status, total_ttc FROM purchase_orders WHERE supplier_id = ? ORDER BY created_at DESC LIMIT 100`, id),
    all(db, `SELECT id, number, received_at, total_ttc, invoiced FROM goods_receipts WHERE supplier_id = ? ORDER BY received_at DESC LIMIT 100`, id),
    all(db, `SELECT id, number, supplier_ref, invoice_date, due_date, total_ttc, amount_paid, status FROM purchase_invoices WHERE supplier_id = ? ORDER BY invoice_date DESC LIMIT 100`, id),
    all(db, `SELECT id, number, payment_date, amount, method, direction, reference FROM payments WHERE party_type = 'supplier' AND party_id = ? ORDER BY payment_date DESC LIMIT 100`, id),
  ]);
  const fin = can(c, 'finance.view') || can(c, 'purchases.manage');
  return c.json({ ...s, balance: fin ? s.balance : null, products, orders, receipts, invoices: fin ? invoices : [], payments: fin ? payments : [] });
});

suppliers.post('/', perm('suppliers.manage'), async (c) => {
  const d = await body(c, supplierSchema);
  const db = c.env.DB;
  const id = uuid();
  const code = d.code || (await nextCode(db, 'suppliers', 'F'));
  await tx(db, [
    db
      .prepare(`INSERT INTO suppliers (id, code, name, contact_name, phone, email, address, tax_id, payment_terms_days, opening_balance, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, code, d.name, d.contact_name, d.phone, d.email, d.address, d.tax_id, d.payment_terms_days, d.opening_balance, d.notes, c.get('user').id),
    auditStmt(c, 'create', 'suppliers', id, null, d),
  ]);
  return c.json({ id, code });
});

suppliers.put('/:id', perm('suppliers.manage'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, supplierSchema);
  const db = c.env.DB;
  const old = await first<any>(db, 'SELECT * FROM suppliers WHERE id = ?', id);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Fournisseur introuvable.');
  await tx(db, [
    db
      .prepare(`UPDATE suppliers SET code=?, name=?, contact_name=?, phone=?, email=?, address=?, tax_id=?, payment_terms_days=?, opening_balance=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .bind(d.code || old.code, d.name, d.contact_name, d.phone, d.email, d.address, d.tax_id, d.payment_terms_days, d.opening_balance, d.notes, id),
    auditStmt(c, 'update', 'suppliers', id, old, d),
  ]);
  return c.json({ ok: true });
});

suppliers.post('/:id/active', perm('suppliers.manage'), async (c) => {
  const { active } = await body(c, z.object({ active: z.boolean() }));
  const db = c.env.DB;
  await tx(db, [db.prepare('UPDATE suppliers SET is_active = ? WHERE id = ?').bind(active ? 1 : 0, c.req.param('id')), auditStmt(c, active ? 'restore' : 'archive', 'suppliers', c.req.param('id'))]);
  return c.json({ ok: true });
});

suppliers.get('/:id/statement', perm('suppliers.view'), async (c) => {
  if (!can(c, 'finance.view') && !can(c, 'purchases.manage')) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé.');
  const id = c.req.param('id');
  const db = c.env.DB;
  const s = await first<any>(db, 'SELECT * FROM suppliers WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Fournisseur introuvable.');
  // du point de vue « dette » : crédit = ce que nous devons, débit = ce que nous avons payé
  const rows = await all<any>(
    db,
    `SELECT invoice_date AS date, 'Facture fournisseur' AS label, number || COALESCE(' / ' || supplier_ref, '') AS ref, 0 AS debit, total_ttc AS credit
       FROM purchase_invoices WHERE supplier_id = ?1 AND status <> 'cancelled'
     UNION ALL SELECT created_at, 'Retour fournisseur', number, total_ttc, 0 FROM supplier_returns WHERE supplier_id = ?1
     UNION ALL SELECT payment_date, CASE WHEN direction = 'out' THEN 'Règlement' ELSE 'Remboursement reçu' END, number,
                      CASE WHEN direction = 'out' THEN amount ELSE 0 END, CASE WHEN direction = 'in' THEN amount ELSE 0 END
                 FROM payments WHERE party_type = 'supplier' AND party_id = ?1
     ORDER BY 1`,
    id,
  );
  let bal = s.opening_balance;
  const lines = [{ date: s.created_at, label: 'Solde initial', ref: '', debit: s.opening_balance < 0 ? -s.opening_balance : 0, credit: s.opening_balance > 0 ? s.opening_balance : 0, balance: bal }];
  for (const r of rows) {
    bal += r.credit - r.debit;
    lines.push({ ...r, balance: bal });
  }
  return c.json({ party: s, lines, balance: bal });
});
