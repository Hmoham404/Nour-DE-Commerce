import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, HttpError, all, first, tx, uuid, body, perm, can, need, auditStmt, requireAuth, pageParams, zMoney, zSignedMoney, zOptStr, seqReserve, seqExpr,
  dateRange, openSessionFor,
} from '../lib';
import { CUSTOMER_BALANCE_SQL } from './partners';

// ───────────── Caisse ─────────────
export const cash = new Hono<AppEnv>();
cash.use('*', requireAuth);

async function sessionSummary(db: D1Database, sessionId: string) {
  const s = await first<any>(
    db,
    `SELECT cs.*, r.name AS register_name, u.full_name AS user_name, v.full_name AS validated_by_name FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id
       JOIN users u ON u.id = cs.user_id LEFT JOIN users v ON v.id = cs.validated_by WHERE cs.id = ?`,
    sessionId,
  );
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Session introuvable.');
  const byType = await all<any>(db, 'SELECT type, COUNT(*) AS n, SUM(amount) AS total FROM cash_movements WHERE session_id = ? GROUP BY type', sessionId);
  const expected = byType.reduce((acc, r) => acc + r.total, 0);
  const byMethod = await all<any>(
    db,
    `SELECT p.method, p.direction, SUM(p.amount) AS total, COUNT(*) AS n FROM payments p
      WHERE p.created_by = ? AND p.created_at BETWEEN ? AND COALESCE(?, datetime('now')) GROUP BY p.method, p.direction`,
    s.user_id,
    s.opened_at,
    s.closed_at,
  );
  const salesAgg = await first<any>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_ttc),0) AS ttc, COALESCE(SUM(amount_paid),0) AS paid FROM sales WHERE cash_session_id = ? AND status = 'completed'`,
    sessionId,
  );
  return { ...s, by_type: byType, by_method: byMethod, expected_now: expected, sales: salesAgg };
}

cash.get('/current', perm('cash.use', 'pos.use'), async (c) => {
  const db = c.env.DB;
  const s = await openSessionFor(db, c.get('user').id);
  if (!s) return c.json({ session: null, registers: await all(db, 'SELECT r.*, (SELECT u.full_name FROM cash_sessions cs JOIN users u ON u.id = cs.user_id WHERE cs.register_id = r.id AND cs.status = \'open\') AS busy_by FROM cash_registers r WHERE is_active = 1 ORDER BY name') });
  return c.json({ session: await sessionSummary(db, s.id) });
});

cash.post('/open', perm('cash.use'), async (c) => {
  const d = await body(c, z.object({ register_id: z.string(), opening_amount: zMoney }));
  const db = c.env.DB;
  const u = c.get('user');
  const id = uuid();
  await tx(db, [
    ...seqReserve(db, 'CASH_SESSION'),
    db.prepare(`INSERT INTO cash_sessions (id, number, register_id, user_id, opening_amount) VALUES (?, ${seqExpr('CASH_SESSION')}, ?,?,?)`).bind(id, d.register_id, u.id, d.opening_amount),
    db.prepare(`INSERT INTO cash_movements (session_id, type, amount, reason, user_id) VALUES (?, 'opening', ?, 'Fond de caisse initial', ?)`).bind(id, d.opening_amount, u.id),
    auditStmt(c, 'open', 'cash_sessions', id, null, d),
  ]);
  return c.json({ id });
});

/** Décaissement / apport / correction : toujours une nouvelle opération (jamais de suppression). */
cash.post('/movement', perm('cash.use'), async (c) => {
  const d = await body(c, z.object({ type: z.enum(['withdrawal', 'deposit', 'correction']), amount: zSignedMoney.refine((v) => v !== 0, 'montant nul'), reason: z.string().trim().min(3, 'Motif obligatoire').max(300) }));
  const db = c.env.DB;
  const u = c.get('user');
  if (d.type === 'correction') need(c, 'cash.manage');
  const s = await openSessionFor(db, u.id);
  if (!s) throw new HttpError(409, 'NO_CASH_SESSION', 'Aucune caisse ouverte.');
  const amount = d.type === 'withdrawal' ? -Math.abs(d.amount) : d.type === 'deposit' ? Math.abs(d.amount) : d.amount;
  await tx(db, [
    db.prepare('INSERT INTO cash_movements (session_id, type, amount, reason, user_id) VALUES (?,?,?,?,?)').bind(s.id, d.type, amount, d.reason, u.id),
    auditStmt(c, 'cash_' + d.type, 'cash_movements', s.id, null, { amount }, d.reason),
  ]);
  return c.json({ ok: true });
});

cash.post('/close', perm('cash.use'), async (c) => {
  const d = await body(c, z.object({ counted_amount: zMoney, justification: zOptStr(1000) }));
  const db = c.env.DB;
  const u = c.get('user');
  const s = await openSessionFor(db, u.id);
  if (!s) throw new HttpError(409, 'NO_CASH_SESSION', 'Aucune caisse ouverte.');
  const exp = await first<{ n: number }>(db, 'SELECT COALESCE(SUM(amount),0) AS n FROM cash_movements WHERE session_id = ?', s.id);
  const expected = exp?.n ?? 0;
  const diff = d.counted_amount - expected;
  if (diff !== 0 && !d.justification) throw new HttpError(400, 'JUSTIFICATION_REQUIRED', `Écart de caisse de ${diff / 1000} DT : une justification est obligatoire.`);
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE cash_sessions SET status = 'closed', closed_at = datetime('now'), expected_amount = ?, counted_amount = ?, difference = ?, justification = ? WHERE id = ? AND status = 'open'`)
      .bind(expected, d.counted_amount, diff, d.justification, s.id),
    auditStmt(c, 'close', 'cash_sessions', s.id, null, { expected, counted: d.counted_amount, diff }, d.justification),
  ];
  if (diff !== 0) {
    stmts.push(
      db
        .prepare(`INSERT INTO notifications (id, dedupe_key, type, severity, title, message, link, permission) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(uuid(), 'cashdiff-' + s.id, 'cash_difference', 'danger', `Écart de caisse ${s.number}`, `${u.full_name} : écart de ${(diff / 1000).toFixed(3)} DT. ${d.justification ?? ''}`, '/caisse', 'cash.manage'),
    );
  }
  await tx(db, stmts);
  return c.json({ ok: true, id: s.id, expected, difference: diff });
});

cash.post('/sessions/:id/validate', perm('cash.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const s = await first<any>(db, 'SELECT status FROM cash_sessions WHERE id = ?', id);
  if (!s || s.status !== 'closed') throw new HttpError(409, 'NOT_CLOSED', 'Seule une session clôturée peut être validée.');
  await tx(db, [
    db.prepare(`UPDATE cash_sessions SET status = 'validated', validated_by = ?, validated_at = datetime('now') WHERE id = ?`).bind(c.get('user').id, id),
    db.prepare(`UPDATE notifications SET resolved = 1 WHERE dedupe_key = ?`).bind('cashdiff-' + id),
    auditStmt(c, 'validate', 'cash_sessions', id),
  ]);
  return c.json({ ok: true });
});

cash.get('/sessions', perm('cash.use', 'cash.manage'), async (c) => {
  const { fromUtc, toUtc } = dateRange(c);
  const mine = !can(c, 'cash.manage');
  const rows = await all(
    c.env.DB,
    `SELECT cs.*, r.name AS register_name, u.full_name AS user_name, (SELECT COALESCE(SUM(amount),0) FROM cash_movements WHERE session_id = cs.id) AS balance
       FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id JOIN users u ON u.id = cs.user_id
      WHERE (cs.opened_at BETWEEN ? AND ? OR cs.status = 'open') ${mine ? 'AND cs.user_id = ?' : ''} ORDER BY cs.opened_at DESC LIMIT 300`,
    fromUtc,
    toUtc,
    ...(mine ? [c.get('user').id] : []),
  );
  return c.json(rows);
});

cash.get('/sessions/:id', perm('cash.use', 'cash.manage'), async (c) => {
  const db = c.env.DB;
  const s = await sessionSummary(db, c.req.param('id'));
  if (!can(c, 'cash.manage') && s.user_id !== c.get('user').id) throw new HttpError(403, 'FORBIDDEN', 'Accès refusé.');
  const movements = await all(db, 'SELECT m.*, u.full_name AS user_name FROM cash_movements m LEFT JOIN users u ON u.id = m.user_id WHERE session_id = ? ORDER BY m.id', s.id);
  return c.json({ ...s, movements });
});

// ───────────── Règlements ─────────────
export const payments = new Hono<AppEnv>();
payments.use('*', requireAuth);

payments.get('/', perm('payments.manage', 'finance.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['p.payment_date BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(p.number LIKE ? OR cu.name LIKE ? OR s.name LIKE ? OR p.reference LIKE ?)');
    params.push(like, like, like, like);
  }
  for (const f of ['direction', 'party_type', 'method'] as const) {
    if (c.req.query(f)) {
      where.push(`p.${f} = ?`);
      params.push(c.req.query(f));
    }
  }
  const w = where.join(' AND ');
  const rows = await all(
    c.env.DB,
    `SELECT p.*, COALESCE(cu.name, s.name, 'Client comptoir') AS party_name, u.full_name AS created_by_name,
            (SELECT group_concat(COALESCE(sa.number, pi.number), ', ') FROM payment_allocations pa LEFT JOIN sales sa ON sa.id = pa.sale_id LEFT JOIN purchase_invoices pi ON pi.id = pa.purchase_invoice_id WHERE pa.payment_id = p.id) AS documents
       FROM payments p LEFT JOIN customers cu ON p.party_type = 'customer' AND cu.id = p.party_id LEFT JOIN suppliers s ON p.party_type = 'supplier' AND s.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by WHERE ${w} ORDER BY p.payment_date DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const agg = await first<any>(
    c.env.DB,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END) AS total_in, SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END) AS total_out
       FROM payments p LEFT JOIN customers cu ON p.party_type = 'customer' AND cu.id = p.party_id LEFT JOIN suppliers s ON p.party_type = 'supplier' AND s.id = p.party_id WHERE ${w}`,
    ...params,
  );
  return c.json({ rows, total: agg?.n ?? 0, total_in: agg?.total_in ?? 0, total_out: agg?.total_out ?? 0 });
});

const payInput = z.object({
  amount: zMoney.refine((v) => v > 0, 'Montant requis'),
  method: z.enum(['cash', 'card', 'cheque', 'transfer', 'other']),
  reference: zOptStr(80),
  notes: zOptStr(300),
  payment_date: zOptStr(10),
});

/** Règlement client : imputé sur les ventes indiquées ou, à défaut, sur les plus anciennes impayées. */
payments.post('/customer', perm('payments.manage'), async (c) => {
  const d = await body(c, payInput.extend({ customer_id: z.string(), sale_ids: z.array(z.string()).optional() }));
  const db = c.env.DB;
  const u = c.get('user');
  const session = d.method === 'cash' ? await openSessionFor(db, u.id) : null;
  if (d.method === 'cash' && !session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour encaisser en espèces.');
  const open = await all<any>(
    db,
    `SELECT id, number, total_ttc - credited_amount - amount_paid AS due, amount_paid, total_ttc, credited_amount FROM sales
      WHERE customer_id = ? AND status = 'completed' AND total_ttc - credited_amount - amount_paid > 0 ${d.sale_ids?.length ? `AND id IN (${d.sale_ids.map(() => '?').join(',')})` : ''}
      ORDER BY sale_date`,
    d.customer_id,
    ...(d.sale_ids ?? []),
  );
  const pid = uuid();
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'PAYMENT'),
    db
      .prepare(`INSERT INTO payments (id, number, direction, party_type, party_id, amount, method, reference, cash_session_id, payment_date, notes, created_by)
                VALUES (?, ${seqExpr('PAYMENT')}, 'in', 'customer', ?,?,?,?,?, COALESCE(?, datetime('now')), ?, ?)`)
      .bind(pid, d.customer_id, d.amount, d.method, d.reference, session?.id ?? null, d.payment_date ? d.payment_date + ' 12:00:00' : null, d.notes, u.id),
  ];
  let rest = d.amount;
  const allocated: { sale: string; amount: number }[] = [];
  for (const s of open) {
    if (rest <= 0) break;
    const a = Math.min(rest, s.due);
    rest -= a;
    allocated.push({ sale: s.number, amount: a });
    stmts.push(
      db.prepare('INSERT INTO payment_allocations (id, payment_id, sale_id, amount) VALUES (?,?,?,?)').bind(uuid(), pid, s.id, a),
      db.prepare(`UPDATE sales SET amount_paid = amount_paid + ?, payment_status = CASE WHEN total_ttc - credited_amount - amount_paid - ? <= 0 THEN 'paid' ELSE 'partial' END WHERE id = ?`).bind(a, a, s.id),
    );
  }
  if (session) {
    stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'customer_payment', ?, 'payment', ?, ${seqExpr('PAYMENT')}, 'Règlement client', ?)`).bind(session.id, d.amount, pid, u.id));
  }
  stmts.push(auditStmt(c, 'create', 'payments', pid, null, { ...d, allocated, advance: rest }));
  await tx(db, stmts);
  return c.json({ id: pid, allocated, advance: rest });
});

payments.post('/supplier', perm('payments.manage'), async (c) => {
  need(c, 'purchases.manage', 'finance.view');
  const d = await body(c, payInput.extend({ supplier_id: z.string(), invoice_ids: z.array(z.string()).optional() }));
  const db = c.env.DB;
  const u = c.get('user');
  const session = d.method === 'cash' ? await openSessionFor(db, u.id) : null;
  if (d.method === 'cash' && !session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour payer en espèces.');
  const open = await all<any>(
    db,
    `SELECT id, number, total_ttc - amount_paid AS due FROM purchase_invoices WHERE supplier_id = ? AND status IN ('unpaid','partial')
      ${d.invoice_ids?.length ? `AND id IN (${d.invoice_ids.map(() => '?').join(',')})` : ''} ORDER BY COALESCE(due_date, invoice_date), invoice_date`,
    d.supplier_id,
    ...(d.invoice_ids ?? []),
  );
  const pid = uuid();
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'PAYMENT'),
    db
      .prepare(`INSERT INTO payments (id, number, direction, party_type, party_id, amount, method, reference, cash_session_id, payment_date, notes, created_by)
                VALUES (?, ${seqExpr('PAYMENT')}, 'out', 'supplier', ?,?,?,?,?, COALESCE(?, datetime('now')), ?, ?)`)
      .bind(pid, d.supplier_id, d.amount, d.method, d.reference, session?.id ?? null, d.payment_date ? d.payment_date + ' 12:00:00' : null, d.notes, u.id),
  ];
  let rest = d.amount;
  const allocated: { invoice: string; amount: number }[] = [];
  for (const inv of open) {
    if (rest <= 0) break;
    const a = Math.min(rest, inv.due);
    rest -= a;
    allocated.push({ invoice: inv.number, amount: a });
    stmts.push(
      db.prepare('INSERT INTO payment_allocations (id, payment_id, purchase_invoice_id, amount) VALUES (?,?,?,?)').bind(uuid(), pid, inv.id, a),
      db.prepare(`UPDATE purchase_invoices SET amount_paid = amount_paid + ?, status = CASE WHEN total_ttc - amount_paid - ? <= 0 THEN 'paid' ELSE 'partial' END WHERE id = ?`).bind(a, a, inv.id),
    );
  }
  if (session) {
    stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'supplier_payment', ?, 'payment', ?, ${seqExpr('PAYMENT')}, 'Règlement fournisseur', ?)`).bind(session.id, -d.amount, pid, u.id));
  }
  stmts.push(auditStmt(c, 'create', 'payments', pid, null, { ...d, allocated, advance: rest }));
  await tx(db, stmts);
  return c.json({ id: pid, allocated, advance: rest });
});

payments.get('/:id/detail', perm('payments.manage', 'finance.view', 'sales.view'), async (c) => {
  const db = c.env.DB;
  const p = await first<any>(
    db,
    `SELECT p.*, COALESCE(cu.name, s.name) AS party_name, COALESCE(cu.code, s.code) AS party_code, u.full_name AS created_by_name
       FROM payments p LEFT JOIN customers cu ON p.party_type = 'customer' AND cu.id = p.party_id LEFT JOIN suppliers s ON p.party_type = 'supplier' AND s.id = p.party_id
       LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`,
    c.req.param('id'),
  );
  if (!p) throw new HttpError(404, 'NOT_FOUND', 'Règlement introuvable.');
  p.allocations = await all(
    db,
    `SELECT pa.amount, sa.number AS sale_number, i.number AS invoice_number, pi.number AS pinvoice_number
       FROM payment_allocations pa LEFT JOIN sales sa ON sa.id = pa.sale_id LEFT JOIN invoices i ON i.sale_id = sa.id LEFT JOIN purchase_invoices pi ON pi.id = pa.purchase_invoice_id
      WHERE pa.payment_id = ?`,
    p.id,
  );
  if (p.party_type === 'customer' && p.party_id) {
    const b = await first<any>(db, `SELECT ${CUSTOMER_BALANCE_SQL} AS balance FROM customers c WHERE c.id = ?`, p.party_id);
    p.balance_after = b?.balance ?? null;
  }
  return c.json(p);
});

payments.get('/receivables', perm('customers.view', 'finance.view', 'payments.manage'), async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT s.id, s.number, s.sale_date, s.due_date, s.customer_id, cu.name AS customer_name, cu.phone, s.total_ttc, s.amount_paid, s.credited_amount,
            s.total_ttc - s.credited_amount - s.amount_paid AS due,
            CASE WHEN s.due_date IS NOT NULL AND s.due_date < date('now','+1 hour') THEN CAST(julianday(date('now','+1 hour')) - julianday(s.due_date) AS INTEGER) ELSE 0 END AS days_overdue,
            (SELECT number FROM invoices WHERE sale_id = s.id) AS invoice_number
       FROM sales s JOIN customers cu ON cu.id = s.customer_id
      WHERE s.status = 'completed' AND s.total_ttc - s.credited_amount - s.amount_paid > 0 ORDER BY s.due_date IS NULL, s.due_date, s.sale_date`,
  );
  return c.json(rows);
});

// ───────────── Dépenses ─────────────
export const expenses = new Hono<AppEnv>();
expenses.use('*', requireAuth);

expenses.get('/', perm('expenses.manage', 'finance.view'), async (c) => {
  const { from, to } = dateRange(c);
  const where = ['e.expense_date BETWEEN ? AND ?'];
  const params: unknown[] = [from, to];
  if (c.req.query('category_id')) {
    where.push('e.category_id = ?');
    params.push(c.req.query('category_id'));
  }
  const rows = await all(
    c.env.DB,
    `SELECT e.*, ec.name AS category_name, u.full_name AS created_by_name FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id LEFT JOIN users u ON u.id = e.created_by
      WHERE ${where.join(' AND ')} ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 1000`,
    ...params,
  );
  const byCat = await all(
    c.env.DB,
    `SELECT ec.name, SUM(e.amount) AS total FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id WHERE ${where.join(' AND ')} AND e.status = 'validated' GROUP BY ec.name ORDER BY total DESC`,
    ...params,
  );
  return c.json({ rows, by_category: byCat });
});

expenses.post('/', perm('expenses.manage'), async (c) => {
  const d = await body(
    c,
    z.object({
      category_id: z.string(),
      amount: zMoney.refine((v) => v > 0, 'Montant requis'),
      expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      description: zOptStr(500),
      payment_method: z.enum(['cash', 'card', 'cheque', 'transfer', 'other']),
      from_cash: z.boolean().default(false),
    }),
  );
  const db = c.env.DB;
  const u = c.get('user');
  const session = d.from_cash ? await openSessionFor(db, u.id) : null;
  if (d.from_cash && !session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour payer depuis la caisse.');
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'EXPENSE'),
    db
      .prepare(`INSERT INTO expenses (id, number, category_id, amount, expense_date, description, payment_method, cash_session_id, created_by) VALUES (?, ${seqExpr('EXPENSE')}, ?,?,?,?,?,?,?)`)
      .bind(id, d.category_id, d.amount, d.expense_date, d.description, d.from_cash ? 'cash' : d.payment_method, session?.id ?? null, u.id),
  ];
  if (session) {
    stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'expense', ?, 'expense', ?, ${seqExpr('EXPENSE')}, ?, ?)`).bind(session.id, -d.amount, id, d.description ?? 'Dépense', u.id));
  }
  stmts.push(auditStmt(c, 'create', 'expenses', id, null, d));
  await tx(db, stmts);
  return c.json({ id });
});

expenses.post('/:id/cancel', perm('expenses.manage'), async (c) => {
  const id = c.req.param('id');
  const { reason } = await body(c, z.object({ reason: z.string().trim().min(3).max(300) }));
  const db = c.env.DB;
  const u = c.get('user');
  const e = await first<any>(db, 'SELECT * FROM expenses WHERE id = ?', id);
  if (!e || e.status !== 'validated') throw new HttpError(409, 'CANNOT_CANCEL', 'Dépense introuvable ou déjà annulée.');
  const stmts: D1PreparedStatement[] = [db.prepare(`UPDATE expenses SET status = 'cancelled' WHERE id = ?`).bind(id)];
  if (e.cash_session_id) {
    // contre-opération dans la caisse ouverte de l'utilisateur
    const s = await openSessionFor(db, u.id);
    if (!s) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour enregistrer la contre-opération.');
    stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'correction', ?, 'expense', ?, ?, ?, ?)`).bind(s.id, e.amount, id, e.number, 'Annulation dépense : ' + reason, u.id));
  }
  stmts.push(auditStmt(c, 'cancel', 'expenses', id, e, null, reason));
  await tx(db, stmts);
  return c.json({ ok: true });
});
