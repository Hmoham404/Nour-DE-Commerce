import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, Ctx, HttpError, all, first, tx, uuid, body, perm, can, need, auditStmt, requireAuth, pageParams, zMoney, zBp, zOptStr, stockMoveStmts,
  defaultWarehouse, seqReserve, seqExpr, dateRange, getSettings, openSessionFor, translateDbError,
} from '../lib';
import { computeLine, computeTotals, findDiscountRule, tierPrice, type CustomerType, type DiscountRule } from '../../shared/pricing';
import { fefoAllocate, batchDecrementStmts, assertNotExpired, type BatchAllocation } from '../fefo';
import { CUSTOMER_BALANCE_SQL } from './partners';

export const sales = new Hono<AppEnv>();
sales.use('*', requireAuth);

const itemInput = z.object({ product_id: z.string(), qty: z.number().int().min(1).max(1e7), discount_bp: zBp.nullable().optional() });
const paymentInput = z.object({ method: z.enum(['cash', 'card', 'cheque', 'transfer', 'other']), amount: zMoney.refine((v) => v > 0, 'montant nul'), reference: zOptStr(80) });

/** Données nécessaires à la tarification côté client (règles + tarifs personnalisés). */
sales.get('/pricing-context', perm('pos.use', 'quotes.manage'), async (c) => {
  const db = c.env.DB;
  const customerId = c.req.query('customer_id');
  const [rules, custom, settings] = await Promise.all([
    all(db, 'SELECT * FROM discount_rules WHERE is_active = 1'),
    customerId ? all(db, 'SELECT product_id, price_ht FROM customer_prices WHERE customer_id = ?', customerId) : Promise.resolve([]),
    getSettings(db),
  ]);
  const u = c.get('user');
  return c.json({
    rules,
    custom_prices: Object.fromEntries(custom.map((r: any) => [r.product_id, r.price_ht])),
    max_discount_bp: can(c, 'discounts.override') ? 10000 : u.max_discount_bp ?? Number(settings.default_max_discount_bp ?? 0),
    fiscal_stamp: settings.fiscal_stamp_enabled === '1' ? Number(settings.fiscal_stamp ?? 0) : 0,
  });
});

interface PricedLine {
  product: any;
  qty: number;
  unit: number;
  discount_bp: number;
  rule_id: string | null;
  amounts: ReturnType<typeof computeLine>;
}

/** Tarification serveur (source de vérité) — identique à la logique partagée utilisée par le POS. */
async function priceItems(c: Ctx, items: z.infer<typeof itemInput>[], customer: any | null) {
  const db = c.env.DB;
  const settings = await getSettings(db);
  const ids = [...new Set(items.map((i) => i.product_id))];
  if (!ids.length) throw new HttpError(400, 'EMPTY', 'Le panier est vide.');
  const prods = await all<any>(db, `SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const pmap = new Map(prods.map((p) => [p.id, p]));
  const rules = await all<DiscountRule>(db, 'SELECT * FROM discount_rules WHERE is_active = 1');
  const custom = customer ? new Map((await all<any>(db, 'SELECT product_id, price_ht FROM customer_prices WHERE customer_id = ?', customer.id)).map((r) => [r.product_id, r.price_ht])) : new Map();
  const tier: CustomerType = (customer?.price_tier ?? customer?.type ?? 'particulier') as CustomerType;
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const u = c.get('user');
  const maxDisc = can(c, 'discounts.override') ? 10000 : u.max_discount_bp ?? Number(settings.default_max_discount_bp ?? 0);
  // montant du panier avant remises (pour les règles basées sur le montant)
  const cartAmount = items.reduce((s, it) => {
    const p = pmap.get(it.product_id);
    return s + (p ? tierPrice(p, tier, custom.get(p.id)) * it.qty : 0);
  }, 0);
  const lines: PricedLine[] = items.map((it) => {
    const p = pmap.get(it.product_id);
    if (!p) throw new HttpError(404, 'NOT_FOUND', 'Produit introuvable.');
    if (!p.is_active) throw new HttpError(409, 'PRODUCT_ARCHIVED', `Le produit « ${p.name} » est archivé.`);
    const unit = tierPrice(p, tier, custom.get(p.id));
    const rule = findDiscountRule(rules, { product: p, customerType: tier, qty: it.qty, cartAmount, date: today });
    let disc = rule?.discount_bp ?? 0;
    if (it.discount_bp !== null && it.discount_bp !== undefined) {
      if (it.discount_bp > disc && it.discount_bp > maxDisc) {
        throw new HttpError(403, 'REMISE_NON_AUTORISEE', `Remise de ${it.discount_bp / 100} % sur « ${p.name} » supérieure à votre limite (${maxDisc / 100} %). Validation d'un responsable requise.`);
      }
      disc = it.discount_bp;
    }
    return { product: p, qty: it.qty, unit, discount_bp: disc, rule_id: it.discount_bp == null ? rule?.id ?? null : null, amounts: computeLine(unit, it.qty, disc, p.vat_bp) };
  });
  return { lines, settings, tier };
}

const saleSchema = z.object({
  idempotency_key: z.string().min(8).max(80),
  customer_id: zOptStr(64),
  items: z.array(itemInput).min(1, 'Le panier est vide').max(300),
  payments: z.array(paymentInput).max(5).default([]),
  create_invoice: z.boolean().default(false),
  due_date: zOptStr(10),
  notes: zOptStr(500),
  quotation_id: zOptStr(64),
});

/**
 * Validation d'une vente — UNE transaction atomique :
 * vente + lignes + mouvements de stock (+ lots FEFO) + facture + paiements + mouvement de caisse + audit.
 * Idempotence : la même clé renvoie la vente existante (double clic sur « Valider »).
 */
sales.post('/', perm('pos.use'), async (c) => {
  const d = await body(c, saleSchema);
  const db = c.env.DB;
  const u = c.get('user');
  const dup = await first<any>(db, 'SELECT id, number FROM sales WHERE idempotency_key = ?', d.idempotency_key);
  if (dup) return c.json({ ...(await saleSummary(db, dup.id)), duplicate: true });

  const customer = d.customer_id ? await first<any>(db, `SELECT c.*, ${CUSTOMER_BALANCE_SQL} AS balance FROM customers c WHERE c.id = ?`, d.customer_id) : null;
  if (d.customer_id && !customer) throw new HttpError(404, 'NOT_FOUND', 'Client introuvable.');
  if (d.create_invoice) need(c, 'pos.use');

  // fusion des lignes identiques (scans répétés)
  const merged = new Map<string, z.infer<typeof itemInput>>();
  for (const it of d.items) {
    const k = `${it.product_id}|${it.discount_bp ?? ''}`;
    const ex = merged.get(k);
    if (ex) ex.qty += it.qty;
    else merged.set(k, { ...it });
  }
  const { lines, settings } = await priceItems(c, [...merged.values()], customer);
  const stamp = d.create_invoice && settings.fiscal_stamp_enabled === '1' ? Number(settings.fiscal_stamp ?? 0) : 0;
  const totals = computeTotals(lines.map((l) => l.amounts), stamp);

  const paid = d.payments.reduce((s, p) => s + p.amount, 0);
  if (paid > totals.total_ttc) throw new HttpError(400, 'OVERPAID', 'Le montant encaissé dépasse le total (la monnaie rendue ne doit pas être enregistrée).');
  const due = totals.total_ttc - paid;
  if (due > 0) {
    if (!customer) throw new HttpError(400, 'CUSTOMER_REQUIRED', 'Un paiement différé ou partiel nécessite de sélectionner un client.');
    if (customer.credit_limit > 0 && customer.balance + due > customer.credit_limit && !can(c, 'credit.override')) {
      throw new HttpError(409, 'PLAFOND_CREDIT', `Plafond de crédit dépassé pour ${customer.name} (encours ${customer.balance / 1000} + ${due / 1000} > ${customer.credit_limit / 1000} DT).`);
    }
  }
  const session = await openSessionFor(db, u.id);
  if (d.payments.some((p) => p.method === 'cash') && !session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse avant d’encaisser en espèces.');

  const wh = (session && (await first<any>(db, 'SELECT warehouse_id FROM cash_registers WHERE id = ?', session.register_id))?.warehouse_id) || (await defaultWarehouse(db));
  const blockExpired = settings.block_expired_sales !== '0';
  const id = uuid();
  const stmts: D1PreparedStatement[] = [...seqReserve(db, 'SALE')];
  stmts.push(
    db
      .prepare(
        `INSERT INTO sales (id, number, idempotency_key, customer_id, customer_name, customer_type, warehouse_id, cash_session_id, quotation_id, subtotal_ht, gross_ht, discount_total,
           total_vat, stamp, total_ttc, amount_paid, cost_total, payment_status, due_date, notes, created_by)
         VALUES (?, ${seqExpr('SALE')}, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id, d.idempotency_key, customer?.id ?? null, customer?.name ?? null, customer?.type ?? 'particulier', wh, session?.id ?? null, d.quotation_id,
        totals.subtotal_ht, totals.gross_ht, totals.discount_total, totals.total_vat, stamp, totals.total_ttc, paid,
        lines.reduce((s, l) => s + l.product.avg_cost * l.qty, 0), due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
        due > 0 ? d.due_date ?? (customer?.payment_terms_days ? new Date(Date.now() + customer.payment_terms_days * 86400000).toISOString().slice(0, 10) : null) : null,
        d.notes, u.id,
      ),
  );
  for (const l of lines) {
    let allocations: BatchAllocation[] = [];
    const fefo = await fefoAllocate(db, l.product.id, wh, l.qty, !blockExpired);
    if (fefo.hasBatches) {
      assertNotExpired(l.product.name, fefo, blockExpired);
      allocations = fefo.allocations;
      stmts.push(...batchDecrementStmts(db, allocations));
    }
    const itemId = uuid();
    stmts.push(
      db
        .prepare(
          `INSERT INTO sale_items (id, sale_id, product_id, product_name, product_reference, qty, unit_price_ht, discount_bp, discount_rule_id, vat_bp, line_ht, line_vat, line_ttc, unit_cost, batch_allocations)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          itemId, id, l.product.id, l.product.name, l.product.reference, l.qty, l.unit, l.discount_bp, l.rule_id, l.product.vat_bp, l.amounts.line_ht, l.amounts.line_vat,
          l.amounts.line_ttc, l.product.avg_cost, allocations.length ? JSON.stringify(allocations) : null,
        ),
      ...stockMoveStmts(db, {
        product_id: l.product.id, warehouse_id: wh, type: 'sortie_vente', qty: -l.qty, unit_cost: l.product.avg_cost, batch_id: allocations[0]?.batch_id ?? null,
        doc_type: 'sale', doc_id: id, doc_number_sql: seqExpr('SALE'), reason: 'Vente', user_id: u.id,
      }),
    );
  }
  if (d.create_invoice) {
    const invId = uuid();
    stmts.push(
      ...seqReserve(db, 'INVOICE'),
      db
        .prepare(`INSERT INTO invoices (id, number, sale_id, customer_id, total_ht, total_vat, stamp, total_ttc, created_by) VALUES (?, ${seqExpr('INVOICE')}, ?,?,?,?,?,?,?)`)
        .bind(invId, id, customer?.id ?? null, totals.subtotal_ht, totals.total_vat, stamp, totals.total_ttc, u.id),
      db.prepare(`INSERT INTO invoice_validations (invoice_id, user_id, user_name, action) VALUES (?,?,?,'created')`).bind(invId, u.id, u.full_name),
    );
  }
  for (const p of d.payments) {
    const pid = uuid();
    stmts.push(
      ...seqReserve(db, 'PAYMENT'),
      db
        .prepare(`INSERT INTO payments (id, number, direction, party_type, party_id, amount, method, reference, cash_session_id, created_by) VALUES (?, ${seqExpr('PAYMENT')}, 'in', 'customer', ?,?,?,?,?,?)`)
        .bind(pid, customer?.id ?? null, p.amount, p.method, p.reference, p.method === 'cash' ? session?.id ?? null : null, u.id),
      db.prepare('INSERT INTO payment_allocations (id, payment_id, sale_id, amount) VALUES (?,?,?,?)').bind(uuid(), pid, id, p.amount),
    );
    if (p.method === 'cash' && session) {
      stmts.push(
        db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'sale', ?, 'sale', ?, ${seqExpr('SALE')}, 'Vente', ?)`).bind(session.id, p.amount, id, u.id),
      );
    }
  }
  if (d.quotation_id) stmts.push(db.prepare(`UPDATE quotations SET status = 'converted', sale_id = ?, updated_at = datetime('now') WHERE id = ?`).bind(id, d.quotation_id));
  stmts.push(auditStmt(c, 'create', 'sales', id, null, { customer: customer?.name, items: lines.map((l) => ({ p: l.product.reference, q: l.qty, pu: l.unit, r: l.discount_bp })), totals, payments: d.payments }));

  try {
    await tx(db, stmts);
  } catch (e) {
    // course : la même clé a été validée par une requête concurrente
    const again = await first<any>(db, 'SELECT id FROM sales WHERE idempotency_key = ?', d.idempotency_key);
    if (again) return c.json({ ...(await saleSummary(db, again.id)), duplicate: true });
    throw translateDbError(e);
  }
  return c.json(await saleSummary(db, id));
});

async function saleSummary(db: D1Database, id: string) {
  const s = await first<any>(db, 'SELECT s.id, s.number, s.total_ttc, s.amount_paid, s.payment_status, (SELECT number FROM invoices WHERE sale_id = s.id) AS invoice_number, (SELECT id FROM invoices WHERE sale_id = s.id) AS invoice_id FROM sales s WHERE s.id = ?', id);
  return s;
}

sales.get('/', perm('sales.view'), async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['s.sale_date BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(s.number LIKE ? OR s.customer_name LIKE ? OR i.number LIKE ?)');
    params.push(like, like, like);
  }
  for (const f of ['status', 'payment_status', 'customer_id', 'created_by'] as const) {
    if (c.req.query(f)) {
      where.push(`s.${f} = ?`);
      params.push(c.req.query(f));
    }
  }
  if (!can(c, 'reports.view') && !can(c, 'sales.cancel') && c.get('user').role_name === 'caissier') {
    where.push('s.created_by = ?');
    params.push(c.get('user').id);
  }
  const w = where.join(' AND ');
  const rows = await all<any>(
    c.env.DB,
    `SELECT s.id, s.number, s.sale_date, s.customer_name, s.customer_type, s.total_ttc, s.subtotal_ht, s.total_vat, s.amount_paid, s.credited_amount, s.payment_status, s.status,
            s.discount_total, s.cost_total, i.number AS invoice_number, i.id AS invoice_id, u.full_name AS cashier,
            (SELECT SUM(qty) FROM sale_items WHERE sale_id = s.id) AS units
       FROM sales s LEFT JOIN invoices i ON i.sale_id = s.id LEFT JOIN users u ON u.id = s.created_by
      WHERE ${w} ORDER BY s.sale_date DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const agg = await first<any>(
    c.env.DB,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN s.status = 'completed' THEN s.total_ttc - s.credited_amount ELSE 0 END) AS ttc,
            SUM(CASE WHEN s.status = 'completed' THEN s.amount_paid ELSE 0 END) AS paid
       FROM sales s LEFT JOIN invoices i ON i.sale_id = s.id WHERE ${w}`,
    ...params,
  );
  const fin = can(c, 'finance.view');
  return c.json({ rows: fin ? rows : rows.map((r) => ({ ...r, cost_total: null })), total: agg?.n ?? 0, sum_ttc: agg?.ttc ?? 0, sum_paid: agg?.paid ?? 0 });
});

sales.get('/:id', perm('sales.view', 'invoices.view', 'pos.use'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const s = await first<any>(
    db,
    `SELECT s.*, u.full_name AS cashier, cu.code AS customer_code, cu.address AS customer_address, cu.phone AS customer_phone, cu.tax_id AS customer_tax_id,
            cs.number AS session_number
       FROM sales s LEFT JOIN users u ON u.id = s.created_by LEFT JOIN customers cu ON cu.id = s.customer_id LEFT JOIN cash_sessions cs ON cs.id = s.cash_session_id WHERE s.id = ?`,
    id,
  );
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Vente introuvable.');
  const [items, payments, invoice, creditNotes] = await Promise.all([
    all(db, `SELECT si.*, p.unit FROM sale_items si JOIN products p ON p.id = si.product_id WHERE sale_id = ?`, id),
    all(db, `SELECT p.id, p.number, p.method, p.amount, p.direction, p.kind, p.payment_date, pa.amount AS allocated FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id WHERE pa.sale_id = ? ORDER BY p.payment_date`, id),
    first(db, 'SELECT * FROM invoices WHERE sale_id = ?', id),
    all(db, 'SELECT * FROM credit_notes WHERE sale_id = ? ORDER BY created_at', id),
  ]);
  const fin = can(c, 'finance.view');
  return c.json({
    ...s,
    cost_total: fin ? s.cost_total : null,
    items: fin ? items : items.map((i: any) => ({ ...i, unit_cost: null })),
    payments,
    invoice,
    credit_notes: creditNotes,
    balance_due: Math.max(0, s.total_ttc - s.credited_amount - s.amount_paid),
  });
});

/** Créer la facture d'une vente existante (timbre fiscal ajouté si applicable). */
sales.post('/:id/invoice', perm('pos.use', 'sales.cancel'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const u = c.get('user');
  const s = await first<any>(db, 'SELECT * FROM sales WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Vente introuvable.');
  if (s.status !== 'completed') throw new HttpError(409, 'CANCELLED', 'Vente annulée.');
  if (await first(db, 'SELECT 1 FROM invoices WHERE sale_id = ?', id)) throw new HttpError(409, 'ALREADY_INVOICED', 'Cette vente est déjà facturée.');
  const settings = await getSettings(db);
  const stamp = s.stamp > 0 ? 0 : settings.fiscal_stamp_enabled === '1' ? Number(settings.fiscal_stamp ?? 0) : 0;
  const invId = uuid();
  const newTotal = s.total_ttc + stamp;
  const due = newTotal - s.credited_amount - s.amount_paid;
  await tx(db, [
    db.prepare(`UPDATE sales SET stamp = stamp + ?, total_ttc = ?, payment_status = ? WHERE id = ?`).bind(stamp, newTotal, due <= 0 ? 'paid' : s.amount_paid > 0 ? 'partial' : 'unpaid', id),
    ...seqReserve(db, 'INVOICE'),
    db
      .prepare(`INSERT INTO invoices (id, number, sale_id, customer_id, total_ht, total_vat, stamp, total_ttc, created_by) VALUES (?, ${seqExpr('INVOICE')}, ?,?,?,?,?,?,?)`)
      .bind(invId, id, s.customer_id, s.subtotal_ht, s.total_vat, s.stamp + stamp, newTotal, u.id),
    db.prepare(`INSERT INTO invoice_validations (invoice_id, user_id, user_name, action) VALUES (?,?,?,'created')`).bind(invId, u.id, u.full_name),
    auditStmt(c, 'create', 'invoices', invId, null, { sale: s.number }),
  ]);
  return c.json({ id: invId });
});

async function refundStmts(c: Ctx, sale: any, amount: number, cnNumberSql: string): Promise<D1PreparedStatement[]> {
  const db = c.env.DB;
  const u = c.get('user');
  const session = await openSessionFor(db, u.id);
  if (!session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour rembourser en espèces.');
  const pid = uuid();
  return [
    ...seqReserve(db, 'PAYMENT'),
    db
      .prepare(`INSERT INTO payments (id, number, direction, party_type, party_id, amount, method, cash_session_id, kind, notes, created_by) VALUES (?, ${seqExpr('PAYMENT')}, 'out', 'customer', ?, ?, 'cash', ?, 'refund', ?, ?)`)
      .bind(pid, sale.customer_id, amount, session.id, 'Remboursement vente ' + sale.number, u.id),
    db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'refund', ?, 'credit_note', ?, ${cnNumberSql}, ?, ?)`).bind(session.id, -amount, sale.id, 'Remboursement ' + sale.number, u.id),
  ];
}

function restockStmts(c: Ctx, sale: any, item: any, qty: number, type: 'retour_client' | 'annulation_vente', cnId: string): D1PreparedStatement[] {
  const db = c.env.DB;
  const out: D1PreparedStatement[] = [];
  // restitution dans les lots d'origine (ordre inverse FEFO)
  if (item.batch_allocations) {
    let rest = qty;
    const allocs: BatchAllocation[] = JSON.parse(item.batch_allocations);
    for (const a of allocs.reverse()) {
      if (rest <= 0) break;
      const back = Math.min(rest, a.qty);
      out.push(db.prepare('UPDATE product_batches SET remaining_qty = remaining_qty + ? WHERE id = ?').bind(back, a.batch_id));
      rest -= back;
    }
  }
  out.push(
    ...stockMoveStmts(db, {
      product_id: item.product_id, warehouse_id: sale.warehouse_id, type, qty, unit_cost: item.unit_cost, doc_type: 'credit_note', doc_id: cnId,
      doc_number_sql: seqExpr('CREDIT_NOTE'), reason: type === 'retour_client' ? 'Retour client' : 'Annulation vente ' + sale.number, user_id: c.get('user').id,
    }),
  );
  return out;
}

/** Annulation d'une vente : avoir total + remise en stock + remboursement éventuel. Rien n'est supprimé. */
sales.post('/:id/cancel', perm('sales.cancel'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, z.object({ reason: z.string().trim().min(3, 'Motif obligatoire').max(500), refund: z.boolean().default(true) }));
  const db = c.env.DB;
  const u = c.get('user');
  const s = await first<any>(db, 'SELECT * FROM sales WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Vente introuvable.');
  if (s.status === 'cancelled') throw new HttpError(409, 'ALREADY_CANCELLED', 'Vente déjà annulée.');
  const items = await all<any>(db, 'SELECT * FROM sale_items WHERE sale_id = ?', id);
  const invoice = await first<any>(db, 'SELECT * FROM invoices WHERE sale_id = ?', id);
  const prevRefunds = await first<{ n: number }>(db, 'SELECT COALESCE(SUM(refund_amount),0) AS n FROM credit_notes WHERE sale_id = ?', id);
  const cnId = uuid();
  const stmts: D1PreparedStatement[] = [...seqReserve(db, 'CREDIT_NOTE')];
  let ht = 0, vat = 0, ttc = 0, cost = 0;
  const lineStmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const q = it.qty - it.returned_qty;
    if (q <= 0) continue;
    const lh = Math.round((it.line_ht * q) / it.qty);
    const lv = Math.round((it.line_vat * q) / it.qty);
    ht += lh;
    vat += lv;
    ttc += lh + lv;
    cost += it.unit_cost * q;
    lineStmts.push(
      db
        .prepare('INSERT INTO credit_note_items (id, credit_note_id, sale_item_id, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(), cnId, it.id, it.product_id, it.product_name, q, it.unit_price_ht, it.discount_bp, it.vat_bp, lh, lv, lh + lv, it.unit_cost),
      db.prepare('UPDATE sale_items SET returned_qty = qty WHERE id = ?').bind(it.id),
      ...restockStmts(c, s, it, q, 'annulation_vente', cnId),
    );
  }
  ttc += s.stamp; // le timbre est également annulé
  const refundable = Math.max(0, s.amount_paid - (prevRefunds?.n ?? 0));
  const refund = d.refund ? refundable : 0;
  stmts.push(
    db
      .prepare(
        `INSERT INTO credit_notes (id, number, kind, sale_id, invoice_id, customer_id, reason, total_ht, total_vat, total_ttc, cost_total, refund_amount, created_by)
         VALUES (?, ${seqExpr('CREDIT_NOTE')}, 'cancellation', ?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(cnId, id, invoice?.id ?? null, s.customer_id, d.reason, ht, vat, ttc, cost, refund, u.id),
    ...lineStmts,
    db.prepare(`UPDATE sales SET status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now'), cancel_reason = ? WHERE id = ? AND status = 'completed'`).bind(u.id, d.reason, id),
  );
  if (invoice) {
    stmts.push(
      db.prepare(`UPDATE invoices SET status = 'cancelled' WHERE id = ?`).bind(invoice.id),
      db.prepare(`INSERT INTO invoice_validations (invoice_id, user_id, user_name, action, comment) VALUES (?,?,?,'cancelled',?)`).bind(invoice.id, u.id, u.full_name, d.reason),
    );
  }
  if (refund > 0) stmts.push(...(await refundStmts(c, s, refund, seqExpr('CREDIT_NOTE'))));
  stmts.push(auditStmt(c, 'cancel', 'sales', id, { number: s.number, total: s.total_ttc }, { credit_note: cnId, refund }, d.reason));
  await tx(db, stmts);
  const cn = await first<any>(db, 'SELECT id, number FROM credit_notes WHERE id = ?', cnId);
  return c.json({ ok: true, credit_note: cn, refund });
});

/** Retour client partiel : avoir + remise en stock (optionnelle) + remboursement (optionnel). */
sales.post('/:id/return', perm('returns.manage', 'sales.cancel'), async (c) => {
  const id = c.req.param('id');
  const d = await body(
    c,
    z.object({
      items: z.array(z.object({ sale_item_id: z.string(), qty: z.number().int().min(1) })).min(1),
      reason: z.string().trim().min(3, 'Motif obligatoire').max(500),
      restock: z.boolean().default(true),
      refund_amount: zMoney.default(0),
    }),
  );
  const db = c.env.DB;
  const u = c.get('user');
  const s = await first<any>(db, 'SELECT * FROM sales WHERE id = ?', id);
  if (!s) throw new HttpError(404, 'NOT_FOUND', 'Vente introuvable.');
  if (s.status !== 'completed') throw new HttpError(409, 'CANCELLED', 'Vente annulée.');
  const items = new Map((await all<any>(db, 'SELECT * FROM sale_items WHERE sale_id = ?', id)).map((i) => [i.id, i]));
  const invoice = await first<any>(db, 'SELECT id FROM invoices WHERE sale_id = ?', id);
  const cnId = uuid();
  let ht = 0, vat = 0, cost = 0;
  const lineStmts: D1PreparedStatement[] = [];
  for (const r of d.items) {
    const it = items.get(r.sale_item_id);
    if (!it) throw new HttpError(404, 'NOT_FOUND', 'Ligne de vente introuvable.');
    if (r.qty > it.qty - it.returned_qty) throw new HttpError(409, 'RETOUR_EXCESSIF', `Quantité retournée trop élevée pour « ${it.product_name} » (max ${it.qty - it.returned_qty}).`);
    const lh = Math.round((it.line_ht * r.qty) / it.qty);
    const lv = Math.round((it.line_vat * r.qty) / it.qty);
    ht += lh;
    vat += lv;
    cost += d.restock ? it.unit_cost * r.qty : 0;
    lineStmts.push(
      db
        .prepare('INSERT INTO credit_note_items (id, credit_note_id, sale_item_id, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(), cnId, it.id, it.product_id, it.product_name, r.qty, it.unit_price_ht, it.discount_bp, it.vat_bp, lh, lv, lh + lv, it.unit_cost),
      db.prepare('UPDATE sale_items SET returned_qty = returned_qty + ? WHERE id = ?').bind(r.qty, it.id),
      ...(d.restock ? restockStmts(c, s, it, r.qty, 'retour_client', cnId) : []),
    );
  }
  const ttc = ht + vat;
  if (d.refund_amount > ttc) throw new HttpError(400, 'REFUND_TOO_HIGH', 'Le remboursement dépasse le montant de l’avoir.');
  const newCredited = s.credited_amount + ttc;
  const dueAfter = s.total_ttc - newCredited - s.amount_paid;
  const stmts: D1PreparedStatement[] = [
    ...seqReserve(db, 'CREDIT_NOTE'),
    db
      .prepare(
        `INSERT INTO credit_notes (id, number, kind, sale_id, invoice_id, customer_id, reason, restock, total_ht, total_vat, total_ttc, cost_total, refund_amount, created_by)
         VALUES (?, ${seqExpr('CREDIT_NOTE')}, 'return', ?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(cnId, id, invoice?.id ?? null, s.customer_id, d.reason, d.restock ? 1 : 0, ht, vat, ttc, cost, d.refund_amount, u.id),
    ...lineStmts,
    db.prepare('UPDATE sales SET credited_amount = ?, payment_status = ? WHERE id = ?').bind(newCredited, dueAfter <= 0 ? 'paid' : s.amount_paid > 0 ? 'partial' : 'unpaid', id),
  ];
  if (d.refund_amount > 0) stmts.push(...(await refundStmts(c, s, d.refund_amount, seqExpr('CREDIT_NOTE'))));
  stmts.push(auditStmt(c, 'return', 'sales', id, null, d, d.reason));
  await tx(db, stmts);
  return c.json(await first(db, 'SELECT id, number, total_ttc FROM credit_notes WHERE id = ?', cnId));
});

sales.get('/credit-notes/list', perm('sales.view', 'returns.manage'), async (c) => {
  const { fromUtc, toUtc } = dateRange(c);
  return c.json(
    await all(
      c.env.DB,
      `SELECT cn.*, s.number AS sale_number, i.number AS invoice_number, cu.name AS customer_name, u.full_name AS created_by_name
         FROM credit_notes cn JOIN sales s ON s.id = cn.sale_id LEFT JOIN invoices i ON i.id = cn.invoice_id LEFT JOIN customers cu ON cu.id = cn.customer_id
         LEFT JOIN users u ON u.id = cn.created_by WHERE cn.created_at BETWEEN ? AND ? ORDER BY cn.created_at DESC LIMIT 500`,
      fromUtc,
      toUtc,
    ),
  );
});

sales.get('/credit-notes/:id', perm('sales.view', 'returns.manage', 'invoices.view'), async (c) => {
  const db = c.env.DB;
  const cn = await first<any>(
    db,
    `SELECT cn.*, s.number AS sale_number, i.number AS invoice_number, cu.name AS customer_name, cu.address AS customer_address, cu.tax_id AS customer_tax_id
       FROM credit_notes cn JOIN sales s ON s.id = cn.sale_id LEFT JOIN invoices i ON i.id = cn.invoice_id LEFT JOIN customers cu ON cu.id = cn.customer_id WHERE cn.id = ?`,
    c.req.param('id'),
  );
  if (!cn) throw new HttpError(404, 'NOT_FOUND', 'Avoir introuvable.');
  cn.items = await all(db, 'SELECT * FROM credit_note_items WHERE credit_note_id = ?', cn.id);
  return c.json(cn);
});

// ───────────── Ventes en attente (POS) ─────────────
sales.get('/held/list', perm('pos.use'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT h.*, u.full_name AS created_by_name FROM held_sales h LEFT JOIN users u ON u.id = h.created_by ORDER BY h.created_at DESC LIMIT 50')),
);
sales.post('/held', perm('pos.use'), async (c) => {
  const d = await body(c, z.object({ label: z.string().trim().min(1).max(80), data: z.any() }));
  const id = uuid();
  const json = JSON.stringify(d.data);
  if (json.length > 100000) throw new HttpError(400, 'TOO_BIG', 'Panier trop volumineux.');
  await tx(c.env.DB, [c.env.DB.prepare('INSERT INTO held_sales (id, label, data, created_by) VALUES (?,?,?,?)').bind(id, d.label, json, c.get('user').id)]);
  return c.json({ id });
});
sales.delete('/held/:id', perm('pos.use'), async (c) => {
  await tx(c.env.DB, [c.env.DB.prepare('DELETE FROM held_sales WHERE id = ?').bind(c.req.param('id'))]);
  return c.json({ ok: true });
});

// ───────────── Factures & vérification à distance ─────────────
export const invoices = new Hono<AppEnv>();
invoices.use('*', requireAuth, perm('invoices.view'));

invoices.get('/', async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['i.invoice_date BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(i.number LIKE ? OR s.number LIKE ? OR cu.name LIKE ?)');
    params.push(like, like, like);
  }
  const v = c.req.query('verification');
  if (v) {
    where.push('i.verification_status = ?');
    params.push(v);
  }
  if (c.req.query('status')) {
    where.push('i.status = ?');
    params.push(c.req.query('status'));
  }
  const pay = c.req.query('payment');
  if (pay === 'unpaid') where.push(`s.payment_status <> 'paid'`);
  if (pay === 'paid') where.push(`s.payment_status = 'paid'`);
  const w = where.join(' AND ');
  const rows = await all(
    c.env.DB,
    `SELECT i.*, s.number AS sale_number, s.amount_paid, s.credited_amount, s.payment_status, cu.name AS customer_name, u.full_name AS created_by_name, vu.full_name AS verified_by_name,
            (SELECT COUNT(*) FROM invoice_validations x WHERE x.invoice_id = i.id AND x.action = 'comment') AS comments
       FROM invoices i JOIN sales s ON s.id = i.sale_id LEFT JOIN customers cu ON cu.id = i.customer_id LEFT JOIN users u ON u.id = i.created_by LEFT JOIN users vu ON vu.id = i.verified_by
      WHERE ${w} ORDER BY i.invoice_date DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    offset,
  );
  const agg = await first<any>(
    c.env.DB,
    `SELECT COUNT(*) AS n, SUM(CASE WHEN i.status = 'validated' THEN i.total_ttc ELSE 0 END) AS ttc,
            SUM(CASE WHEN i.status = 'validated' THEN s.amount_paid ELSE 0 END) AS paid,
            SUM(CASE WHEN i.verification_status = 'pending' AND i.status = 'validated' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN i.verification_status = 'anomaly' THEN 1 ELSE 0 END) AS anomalies
       FROM invoices i JOIN sales s ON s.id = i.sale_id LEFT JOIN customers cu ON cu.id = i.customer_id WHERE ${w}`,
    ...params,
  );
  return c.json({ rows, total: agg?.n ?? 0, summary: agg });
});

invoices.get('/:id', async (c) => {
  const db = c.env.DB;
  const inv = await first<any>(db, 'SELECT i.*, u.full_name AS created_by_name FROM invoices i LEFT JOIN users u ON u.id = i.created_by WHERE i.id = ?', c.req.param('id'));
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Facture introuvable.');
  const history = await all(db, 'SELECT * FROM invoice_validations WHERE invoice_id = ? ORDER BY id', inv.id);
  return c.json({ ...inv, history });
});

invoices.post('/:id/review', async (c) => {
  const id = c.req.param('id');
  const d = await body(c, z.object({ action: z.enum(['verified', 'anomaly', 'comment', 'reset']), comment: zOptStr(1000) }));
  const db = c.env.DB;
  const u = c.get('user');
  if (d.action !== 'comment') need(c, 'invoices.verify');
  if (d.action === 'anomaly' && !d.comment) throw new HttpError(400, 'COMMENT_REQUIRED', 'Décrivez l’anomalie constatée.');
  if (d.action === 'comment' && !d.comment) throw new HttpError(400, 'COMMENT_REQUIRED', 'Commentaire vide.');
  const inv = await first<any>(db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw new HttpError(404, 'NOT_FOUND', 'Facture introuvable.');
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO invoice_validations (invoice_id, user_id, user_name, action, comment) VALUES (?,?,?,?,?)').bind(id, u.id, u.full_name, d.action, d.comment),
  ];
  if (d.action !== 'comment') {
    const status = d.action === 'reset' ? 'pending' : d.action;
    stmts.push(db.prepare('UPDATE invoices SET verification_status = ?, verified_by = ?, verified_at = datetime(\'now\') WHERE id = ?').bind(status, u.id, id));
  }
  if (d.action === 'anomaly') {
    stmts.push(
      db
        .prepare(`INSERT OR REPLACE INTO notifications (id, dedupe_key, type, severity, title, message, link, permission) VALUES (?,?,?,?,?,?,?,?)`)
        .bind(uuid(), 'anomaly-' + id, 'invoice_anomaly', 'danger', `Anomalie signalée sur ${inv.number}`, d.comment, `/factures/${inv.sale_id}`, 'invoices.view'),
    );
  }
  stmts.push(auditStmt(c, 'invoice_' + d.action, 'invoices', id, { verification_status: inv.verification_status }, d));
  await tx(db, stmts);
  return c.json({ ok: true });
});

// ───────────── Devis & commandes clients ─────────────
export const quotes = new Hono<AppEnv>();
quotes.use('*', requireAuth);

const quoteSchema = z.object({
  kind: z.enum(['quote', 'order']).default('quote'),
  customer_id: zOptStr(64),
  customer_name: zOptStr(200),
  valid_until: zOptStr(10),
  notes: zOptStr(1000),
  items: z.array(itemInput).min(1, 'Ajoutez au moins un produit').max(300),
});

quotes.get('/', perm('quotes.manage', 'sales.view'), async (c) => {
  const kind = c.req.query('kind') ?? 'quote';
  const { like, q } = pageParams(c);
  return c.json(
    await all(
      c.env.DB,
      `SELECT q.*, COALESCE(cu.name, q.customer_name) AS customer_display, u.full_name AS created_by_name, s.number AS sale_number
         FROM quotations q LEFT JOIN customers cu ON cu.id = q.customer_id LEFT JOIN users u ON u.id = q.created_by LEFT JOIN sales s ON s.id = q.sale_id
        WHERE q.kind = ? ${q ? 'AND (q.number LIKE ? OR cu.name LIKE ? OR q.customer_name LIKE ?)' : ''} ORDER BY q.created_at DESC LIMIT 300`,
      kind,
      ...(q ? [like, like, like] : []),
    ),
  );
});

quotes.get('/:id', perm('quotes.manage', 'sales.view', 'pos.use'), async (c) => {
  const db = c.env.DB;
  const q = await first<any>(
    db,
    `SELECT q.*, cu.name AS customer_display, cu.address AS customer_address, cu.tax_id AS customer_tax_id, cu.phone AS customer_phone, cu.code AS customer_code
       FROM quotations q LEFT JOIN customers cu ON cu.id = q.customer_id WHERE q.id = ?`,
    c.req.param('id'),
  );
  if (!q) throw new HttpError(404, 'NOT_FOUND', 'Document introuvable.');
  q.items = await all(db, 'SELECT qi.*, p.reference, p.unit FROM quotation_items qi JOIN products p ON p.id = qi.product_id WHERE quotation_id = ?', q.id);
  return c.json(q);
});

async function saveQuote(c: Ctx, id: string | null) {
  const d = await body(c, quoteSchema);
  const db = c.env.DB;
  const customer = d.customer_id ? await first<any>(db, 'SELECT * FROM customers WHERE id = ?', d.customer_id) : null;
  const { lines } = await priceItems(c, d.items, customer);
  const t = computeTotals(lines.map((l) => l.amounts));
  const qid = id ?? uuid();
  const seq = d.kind === 'order' ? 'ORDER' : 'QUOTE';
  const stmts: D1PreparedStatement[] = [];
  if (!id) {
    stmts.push(
      ...seqReserve(db, seq),
      db
        .prepare(`INSERT INTO quotations (id, number, kind, customer_id, customer_name, valid_until, subtotal_ht, total_vat, total_ttc, notes, created_by) VALUES (?, ${seqExpr(seq)}, ?,?,?,?,?,?,?,?,?)`)
        .bind(qid, d.kind, d.customer_id, customer?.name ?? d.customer_name, d.valid_until, t.subtotal_ht, t.total_vat, t.total_ttc, d.notes, c.get('user').id),
    );
  } else {
    const old = await first<any>(db, 'SELECT status FROM quotations WHERE id = ?', id);
    if (!old) throw new HttpError(404, 'NOT_FOUND', 'Document introuvable.');
    if (old.status === 'converted') throw new HttpError(409, 'LOCKED', 'Document déjà transformé en vente.');
    stmts.push(
      db
        .prepare(`UPDATE quotations SET customer_id=?, customer_name=?, valid_until=?, subtotal_ht=?, total_vat=?, total_ttc=?, notes=?, updated_at=datetime('now') WHERE id=?`)
        .bind(d.customer_id, customer?.name ?? d.customer_name, d.valid_until, t.subtotal_ht, t.total_vat, t.total_ttc, d.notes, id),
      db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').bind(id),
    );
  }
  for (const l of lines) {
    stmts.push(
      db
        .prepare('INSERT INTO quotation_items (id, quotation_id, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(), qid, l.product.id, l.product.name, l.qty, l.unit, l.discount_bp, l.product.vat_bp, l.amounts.line_ht, l.amounts.line_vat, l.amounts.line_ttc),
    );
  }
  stmts.push(auditStmt(c, id ? 'update' : 'create', 'quotations', qid, null, d));
  await tx(db, stmts);
  return c.json({ id: qid });
}
quotes.post('/', perm('quotes.manage'), (c) => saveQuote(c, null));
quotes.put('/:id', perm('quotes.manage'), (c) => saveQuote(c, c.req.param('id')));
quotes.post('/:id/status', perm('quotes.manage'), async (c) => {
  const { status } = await body(c, z.object({ status: z.enum(['draft', 'sent', 'accepted', 'cancelled']) }));
  const db = c.env.DB;
  const id = c.req.param('id');
  const q = await first<any>(db, 'SELECT status FROM quotations WHERE id = ?', id);
  if (!q) throw new HttpError(404, 'NOT_FOUND', 'Document introuvable.');
  if (q.status === 'converted') throw new HttpError(409, 'LOCKED', 'Document déjà transformé en vente.');
  await tx(db, [db.prepare(`UPDATE quotations SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id), auditStmt(c, 'status_' + status, 'quotations', id)]);
  return c.json({ ok: true });
});
/** Transformer un devis en commande client. */
quotes.post('/:id/to-order', perm('quotes.manage'), async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const q = await first<any>(db, 'SELECT * FROM quotations WHERE id = ?', id);
  if (!q || q.kind !== 'quote') throw new HttpError(404, 'NOT_FOUND', 'Devis introuvable.');
  const nid = uuid();
  await tx(db, [
    ...seqReserve(db, 'ORDER'),
    db
      .prepare(
        `INSERT INTO quotations (id, number, kind, customer_id, customer_name, status, valid_until, subtotal_ht, total_vat, total_ttc, notes, created_by)
         SELECT ?, ${seqExpr('ORDER')}, 'order', customer_id, customer_name, 'accepted', valid_until, subtotal_ht, total_vat, total_ttc, 'Depuis devis ' || number, ? FROM quotations WHERE id = ?`,
      )
      .bind(nid, c.get('user').id, id),
    db
      .prepare(`INSERT INTO quotation_items (id, quotation_id, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc)
                SELECT lower(hex(randomblob(16))), ?, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc FROM quotation_items WHERE quotation_id = ?`)
      .bind(nid, id),
    db.prepare(`UPDATE quotations SET status = 'accepted' WHERE id = ?`).bind(id),
    auditStmt(c, 'to_order', 'quotations', nid, { quote: q.number }, null),
  ]);
  return c.json({ id: nid });
});
