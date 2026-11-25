import { Hono } from 'hono';
import { AppEnv, HttpError, all, first, tx, uuid, perm, auditStmt, requireAuth, stockMoveStmts, defaultWarehouse, seqReserve, seqExpr } from '../lib';
import { generateInternalEan13 } from '../../shared/barcode';
import { computeLine, computeTotals } from '../../shared/pricing';

/**
 * Données d'exemple : un jeu complet (catégories, produits, clients, fournisseurs, vente, devis, dépense,
 * personnel, pointage) pour découvrir le logiciel. Chaque enregistrement est tracé dans `demo_records`
 * et peut être supprimé en un clic sans toucher aux données réelles.
 */
export const demo = new Hono<AppEnv>();
demo.use('*', requireAuth, perm('settings.manage'));

demo.get('/', async (c) => {
  const rows = await all<any>(c.env.DB, 'SELECT table_name, COUNT(*) AS n FROM demo_records GROUP BY table_name');
  return c.json({ loaded: rows.length > 0, counts: Object.fromEntries(rows.map((r) => [r.table_name, r.n])) });
});

demo.post('/', async (c) => {
  const db = c.env.DB;
  const u = c.get('user');
  if (await first(db, 'SELECT 1 FROM demo_records LIMIT 1')) throw new HttpError(409, 'ALREADY', 'Les exemples sont déjà chargés.');
  const wh = await defaultWarehouse(db);
  const rec: [string, string][] = [];
  const track = (t: string, id: string) => (rec.push([t, id]), id);
  const S: D1PreparedStatement[] = [];
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const addDays = (n: number) => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

  // Catégories, marque, fournisseur, clients
  const catFood = track('categories', uuid());
  const catHyg = track('categories', uuid());
  const brand = track('brands', uuid());
  const sup = track('suppliers', uuid());
  const cGros = track('customers', uuid());
  const cEpi = track('customers', uuid());
  S.push(
    db.prepare('INSERT INTO categories (id, name) VALUES (?,?)').bind(catFood, 'Alimentaire (exemple)'),
    db.prepare('INSERT INTO categories (id, name) VALUES (?,?)').bind(catHyg, 'Hygiène (exemple)'),
    db.prepare('INSERT INTO brands (id, name) VALUES (?,?)').bind(brand, 'Marque Exemple'),
    db.prepare(`INSERT INTO suppliers (id, code, name, contact_name, phone, address, payment_terms_days, created_by) VALUES (?,?,?,?,?,?,?,?)`).bind(sup, 'EX-F01', 'Fournisseur Exemple Sahel', 'M. Exemple', '73 000 001', 'Sousse', 30, u.id),
    db.prepare(`INSERT INTO customers (id, code, name, type, phone, address, credit_limit, payment_terms_days, created_by) VALUES (?,?,?,?,?,?,?,?,?)`).bind(cGros, 'EX-C01', 'Client Exemple Grossiste', 'grossiste', '73 000 002', 'Moknine', 2000000, 30, u.id),
    db.prepare(`INSERT INTO customers (id, code, name, type, phone, address, created_by) VALUES (?,?,?,?,?,?,?)`).bind(cEpi, 'EX-C02', 'Client Exemple Épicerie', 'detaillant', '73 000 003', 'Moknine', u.id),
  );

  // Produits (codes EAN-13 internes valides 20…)
  const P = [
    { name: "Huile d'olive 1 L (exemple)", cat: catFood, buy: 9500, sale: 12500, retail: 12000, gros: 11200, vat: 700, stock: 40, min: 10 },
    { name: 'Pâtes 500 g (exemple)', cat: catFood, buy: 900, sale: 1300, retail: 1200, gros: 1100, vat: 700, stock: 120, min: 30 },
    { name: 'Lait demi-écrémé 1 L (exemple)', cat: catFood, buy: 1250, sale: 1450, retail: 1400, gros: 1350, vat: 700, stock: 8, min: 24, batch: true },
    { name: 'Savon liquide 500 ml (exemple)', cat: catHyg, buy: 2100, sale: 3200, retail: 3000, gros: 2700, vat: 1900, stock: 60, min: 12 },
    { name: 'Shampoing 400 ml (exemple)', cat: catHyg, buy: 3400, sale: 5200, retail: 4900, gros: 4500, vat: 1900, stock: 0, min: 6 },
    { name: 'Détergent 3 L (exemple)', cat: catHyg, buy: 6800, sale: 9900, retail: 9400, gros: 8800, vat: 1900, stock: 25, min: 5 },
  ];
  const prods = P.map((p, i) => ({ ...p, id: track('products', uuid()), code: generateInternalEan13(990100 + i), ref: `EX-P0${i + 1}` }));
  for (const p of prods) {
    S.push(
      db
        .prepare(
          `INSERT INTO products (id, reference, name, category_id, brand_id, supplier_id, purchase_price, avg_cost, sale_price, price_retail, price_wholesale, vat_bp, min_stock, units_per_carton, track_batches, is_favorite, created_by)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(p.id, p.ref, p.name, p.cat, brand, sup, p.buy, p.buy, p.sale, p.retail, p.gros, p.vat, p.min, 12, p.batch ? 1 : 0, 1, u.id),
      db.prepare('INSERT INTO product_barcodes (id, product_id, barcode, is_primary) VALUES (?,?,?,1)').bind(uuid(), p.id, p.code),
    );
    if (p.stock > 0) {
      let batchId: string | null = null;
      if (p.batch) {
        batchId = uuid();
        S.push(db.prepare('INSERT INTO product_batches (id, product_id, warehouse_id, batch_number, supplier_id, expires_at, initial_qty, remaining_qty, unit_cost) VALUES (?,?,?,?,?,?,?,?,?)').bind(batchId, p.id, wh, 'LOT-EX-01', sup, addDays(9), p.stock, p.stock, p.buy));
      }
      S.push(...stockMoveStmts(db, { product_id: p.id, warehouse_id: wh, type: 'initial', qty: p.stock, unit_cost: p.buy, batch_id: batchId, doc_type: 'demo', doc_id: 'demo', reason: 'Stock initial (exemple)', user_id: u.id }));
    }
  }
  const rule = track('discount_rules', uuid());
  S.push(db.prepare(`INSERT INTO discount_rules (id, name, priority, category_id, min_qty, discount_bp, created_by) VALUES (?,?,?,?,?,?,?)`).bind(rule, 'Exemple : 10 pièces et plus −5 % (alimentaire)', 50, catFood, 10, 500, u.id));

  // Une vente à crédit partiel au grossiste (paiement par carte : n'affecte pas la caisse)
  const saleId = track('sales', uuid());
  const items = [
    { p: prods[1], qty: 20 },
    { p: prods[3], qty: 6 },
  ];
  const lines = items.map((i) => ({ ...i, unit: i.p.gros, disc: i.p.cat === catFood && i.qty >= 10 ? 500 : 0 })).map((l) => ({ ...l, a: computeLine(l.unit, l.qty, l.disc, l.p.vat) }));
  const t = computeTotals(lines.map((l) => l.a));
  const paid = Math.round(t.total_ttc / 2);
  S.push(
    ...seqReserve(db, 'SALE'),
    db
      .prepare(
        `INSERT INTO sales (id, number, idempotency_key, customer_id, customer_name, customer_type, warehouse_id, subtotal_ht, gross_ht, discount_total, total_vat, stamp, total_ttc, amount_paid, cost_total, payment_status, due_date, notes, created_by)
         VALUES (?, ${seqExpr('SALE')}, ?,?,?,?,?,?,?,?,?,0,?,?,?, 'partial', ?, ?, ?)`,
      )
      .bind(saleId, 'demo-' + saleId, cGros, 'Client Exemple Grossiste', 'grossiste', wh, t.subtotal_ht, t.gross_ht, t.discount_total, t.total_vat, t.total_ttc, paid, lines.reduce((s, l) => s + l.p.buy * l.qty, 0), addDays(30), 'Vente d’exemple', u.id),
  );
  for (const l of lines) {
    S.push(
      db
        .prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, product_reference, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(uuid(), saleId, l.p.id, l.p.name, l.p.ref, l.qty, l.unit, l.disc, l.p.vat, l.a.line_ht, l.a.line_vat, l.a.line_ttc, l.p.buy),
      ...stockMoveStmts(db, { product_id: l.p.id, warehouse_id: wh, type: 'sortie_vente', qty: -l.qty, unit_cost: l.p.buy, doc_type: 'sale', doc_id: saleId, doc_number_sql: seqExpr('SALE'), reason: 'Vente (exemple)', user_id: u.id }),
    );
  }
  const payId = track('payments', uuid());
  S.push(
    ...seqReserve(db, 'PAYMENT'),
    db.prepare(`INSERT INTO payments (id, number, direction, party_type, party_id, amount, method, created_by) VALUES (?, ${seqExpr('PAYMENT')}, 'in', 'customer', ?, ?, 'card', ?)`).bind(payId, cGros, paid, u.id),
    db.prepare('INSERT INTO payment_allocations (id, payment_id, sale_id, amount) VALUES (?,?,?,?)').bind(uuid(), payId, saleId, paid),
  );

  // Un devis pour l'épicerie
  const quoteId = track('quotations', uuid());
  const ql = [{ p: prods[0], qty: 6 }, { p: prods[5], qty: 4 }].map((l) => ({ ...l, a: computeLine(l.p.retail, l.qty, 0, l.p.vat) }));
  const qt = computeTotals(ql.map((l) => l.a));
  S.push(
    ...seqReserve(db, 'QUOTE'),
    db.prepare(`INSERT INTO quotations (id, number, kind, customer_id, customer_name, status, valid_until, subtotal_ht, total_vat, total_ttc, notes, created_by) VALUES (?, ${seqExpr('QUOTE')}, 'quote', ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`).bind(quoteId, cEpi, 'Client Exemple Épicerie', addDays(15), qt.subtotal_ht, qt.total_vat, qt.total_ttc, 'Devis d’exemple', u.id),
    ...ql.map((l) => db.prepare(`INSERT INTO quotation_items (id, quotation_id, product_id, product_name, qty, unit_price_ht, discount_bp, vat_bp, line_ht, line_vat, line_ttc) VALUES (?,?,?,?,?,?,0,?,?,?,?)`).bind(uuid(), quoteId, l.p.id, l.p.name, l.qty, l.p.retail, l.p.vat, l.a.line_ht, l.a.line_vat, l.a.line_ttc)),
  );

  // Une dépense
  const expId = track('expenses', uuid());
  S.push(...seqReserve(db, 'EXPENSE'), db.prepare(`INSERT INTO expenses (id, number, category_id, amount, expense_date, description, payment_method, created_by) VALUES (?, ${seqExpr('EXPENSE')}, 'exp-transport', 15000, ?, 'Livraison Moknine (exemple)', 'cash', ?)`).bind(expId, today, u.id));

  // Personnel + pointage des 6 derniers jours
  const E = [
    { name: 'Exemple — Ali (magasinier)', pos: 'Magasinier', type: 'monthly', m: 900000, w: 0, d: 0, ot: 5000 },
    { name: 'Exemple — Sami (chauffeur)', pos: 'Chauffeur livreur', type: 'daily', m: 0, w: 0, d: 35000, ot: 5000 },
    { name: 'Exemple — Mouna (vendeuse)', pos: 'Vendeuse', type: 'weekly', m: 0, w: 210000, d: 0, ot: 4000 },
  ];
  const pattern = [
    ['present', 'present', 'present', 'half', 'present', 'present'],
    ['present', 'absent', 'present', 'present', 'present', 'present'],
    ['present', 'present', 'leave', 'present', 'present', 'present'],
  ];
  E.forEach((e, i) => {
    const id = track('employees', uuid());
    S.push(
      db
        .prepare(`INSERT INTO employees (id, code, full_name, position, hire_date, pay_type, daily_rate, weekly_salary, monthly_salary, overtime_hourly_rate, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(id, `EX-E0${i + 1}`, e.name, e.pos, addDays(-400), e.type, e.d, e.w, e.m, e.ot, 'Employé d’exemple', u.id),
    );
    pattern[i].forEach((st, k) => {
      const date = addDays(k - 6);
      S.push(db.prepare(`INSERT INTO attendance (id, employee_id, work_date, status, check_in, check_out, overtime_minutes, recorded_by) VALUES (?,?,?,?,?,?,?,?)`).bind(uuid(), id, date, st, st === 'present' ? '08:00' : null, st === 'present' ? '17:00' : null, k === 4 && i === 0 ? 60 : 0, u.id));
    });
    if (i === 1) S.push(db.prepare('INSERT INTO salary_advances (id, employee_id, advance_date, amount, reason, created_by) VALUES (?,?,?,?,?,?)').bind(track('salary_advances', uuid()), id, addDays(-2), 20000, 'Avance (exemple)', u.id));
  });

  for (const [tbl, id] of rec) S.push(db.prepare('INSERT INTO demo_records (table_name, record_id) VALUES (?,?)').bind(tbl, id));
  S.push(auditStmt(c, 'demo_load', 'demo', null, null, { records: rec.length }));
  for (let i = 0; i < S.length; i += 90) await tx(db, S.slice(i, i + 90));
  return c.json({ ok: true, records: rec.length });
});

/** Suppression des exemples ; ce qui a été réutilisé dans des documents réels est conservé (et signalé). */
demo.delete('/', async (c) => {
  const db = c.env.DB;
  const ids = async (t: string) => (await all<{ record_id: string }>(db, 'SELECT record_id FROM demo_records WHERE table_name = ?', t)).map((r) => r.record_id);
  const kept: string[] = [];
  const done = (t: string, id: string) => db.prepare('DELETE FROM demo_records WHERE table_name = ? AND record_id = ?').bind(t, id);

  // 1. Ventes, paiements, devis, dépenses d'exemple
  for (const s of await ids('sales')) {
    await tx(db, [
      db.prepare('DELETE FROM payment_allocations WHERE sale_id = ?').bind(s),
      db.prepare('DELETE FROM invoice_validations WHERE invoice_id IN (SELECT id FROM invoices WHERE sale_id = ?)').bind(s),
      db.prepare('DELETE FROM credit_note_items WHERE credit_note_id IN (SELECT id FROM credit_notes WHERE sale_id = ?)').bind(s),
      db.prepare('DELETE FROM credit_notes WHERE sale_id = ?').bind(s),
      db.prepare('DELETE FROM invoices WHERE sale_id = ?').bind(s),
      db.prepare('DELETE FROM sale_items WHERE sale_id = ?').bind(s),
      db.prepare('DELETE FROM sales WHERE id = ?').bind(s),
      done('sales', s),
    ]);
  }
  for (const p of await ids('payments')) await tx(db, [db.prepare('DELETE FROM payment_allocations WHERE payment_id = ?').bind(p), db.prepare('DELETE FROM payments WHERE id = ?').bind(p), done('payments', p)]);
  for (const q of await ids('quotations')) await tx(db, [db.prepare('DELETE FROM quotations WHERE id = ?').bind(q), done('quotations', q)]);
  for (const e of await ids('expenses')) {
    const x = await first<any>(db, 'SELECT cash_session_id FROM expenses WHERE id = ?', e);
    if (x?.cash_session_id) kept.push('dépense passée en caisse');
    else await tx(db, [db.prepare('DELETE FROM expenses WHERE id = ?').bind(e), done('expenses', e)]);
  }
  for (const r of await ids('discount_rules')) await tx(db, [db.prepare('DELETE FROM discount_rules WHERE id = ?').bind(r), done('discount_rules', r)]);
  for (const a of await ids('salary_advances')) {
    const x = await first<any>(db, 'SELECT payroll_run_id, from_cash FROM salary_advances WHERE id = ?', a);
    if (x?.payroll_run_id || x?.from_cash) kept.push('avance déjà déduite');
    else await tx(db, [db.prepare('DELETE FROM salary_advances WHERE id = ?').bind(a), done('salary_advances', a)]);
  }

  // 2. Personnel (sauf s'il figure dans une paie)
  for (const e of await ids('employees')) {
    const used = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM payroll_items WHERE employee_id = ?', e);
    if (used?.n) kept.push('employé présent dans une paie');
    else await tx(db, [db.prepare('DELETE FROM salary_advances WHERE employee_id = ? AND from_cash = 0').bind(e), db.prepare('DELETE FROM attendance WHERE employee_id = ?').bind(e), db.prepare('DELETE FROM employees WHERE id = ?').bind(e), done('employees', e)]);
  }

  // 3. Produits (sauf s'ils ont été utilisés dans des documents réels)
  for (const p of await ids('products')) {
    const used = await first<{ n: number }>(
      db,
      `SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM goods_receipt_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM purchase_order_items WHERE product_id = ?1)
            + (SELECT COUNT(*) FROM quotation_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM inventory_items WHERE product_id = ?1) + (SELECT COUNT(*) FROM supplier_return_items WHERE product_id = ?1) AS n`,
      p,
    );
    if (used?.n) {
      kept.push('produit utilisé dans un document');
      await tx(db, [db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').bind(p)]);
      continue;
    }
    await tx(db, [
      db.prepare('DELETE FROM stock_movements WHERE product_id = ?').bind(p),
      db.prepare('DELETE FROM product_batches WHERE product_id = ?').bind(p),
      db.prepare('DELETE FROM stock_balances WHERE product_id = ?').bind(p),
      db.prepare('DELETE FROM customer_prices WHERE product_id = ?').bind(p),
      db.prepare('DELETE FROM discount_rules WHERE product_id = ?').bind(p),
      db.prepare('DELETE FROM products WHERE id = ?').bind(p),
      done('products', p),
    ]);
  }

  // 4. Tiers et référentiels (sauf s'ils sont référencés par des données réelles)
  const tryDelete = async (t: string, id: string, checks: string[]) => {
    for (const q of checks) {
      const r = await first<{ n: number }>(db, q, id);
      if (r?.n) {
        kept.push(`${t} encore utilisé`);
        return;
      }
    }
    await tx(db, [db.prepare(`DELETE FROM ${t} WHERE id = ?`).bind(id), done(t, id)]);
  };
  for (const id of await ids('customers'))
    await tryDelete('customers', id, ['SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?', "SELECT COUNT(*) AS n FROM payments WHERE party_type = 'customer' AND party_id = ?", 'SELECT COUNT(*) AS n FROM quotations WHERE customer_id = ?']);
  for (const id of await ids('suppliers'))
    await tryDelete('suppliers', id, ['SELECT COUNT(*) AS n FROM products WHERE supplier_id = ?', 'SELECT COUNT(*) AS n FROM goods_receipts WHERE supplier_id = ?', 'SELECT COUNT(*) AS n FROM purchase_orders WHERE supplier_id = ?', 'SELECT COUNT(*) AS n FROM purchase_invoices WHERE supplier_id = ?', 'SELECT COUNT(*) AS n FROM product_batches WHERE supplier_id = ?']);
  for (const id of await ids('categories')) await tryDelete('categories', id, ['SELECT COUNT(*) AS n FROM products WHERE category_id = ?', 'SELECT COUNT(*) AS n FROM categories WHERE parent_id = ?']);
  for (const id of await ids('brands')) await tryDelete('brands', id, ['SELECT COUNT(*) AS n FROM products WHERE brand_id = ?']);

  await tx(db, [auditStmt(c, 'demo_delete', 'demo', null, null, { kept })]);
  const left = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM demo_records');
  return c.json({ ok: true, remaining: left?.n ?? 0, kept: [...new Set(kept)] });
});
