import { Hono } from 'hono';
import { AppEnv, HttpError, all, first, can, need, requireAuth, dateRange, getSetting, run, uuid, pageParams, perm } from '../lib';
import { CUSTOMER_BALANCE_SQL, SUPPLIER_BALANCE_SQL } from './partners';

// Expressions communes (CA = HT net des retours ; les ventes annulées sont exclues)
const SALES_OK = `s.status = 'completed'`;

export const dashboard = new Hono<AppEnv>();
dashboard.use('*', requireAuth, perm('dashboard.view'));

async function periodKpis(db: D1Database, fromUtc: string, toUtc: string, from: string, to: string) {
  const sales = await first<any>(
    db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(subtotal_ht),0) AS ht, COALESCE(SUM(total_ttc),0) AS ttc, COALESCE(SUM(cost_total),0) AS cost, COALESCE(SUM(discount_total),0) AS discounts
       FROM sales s WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ?`,
    fromUtc,
    toUtc,
  );
  const returns = await first<any>(
    db,
    `SELECT COALESCE(SUM(cn.total_ht),0) AS ht, COALESCE(SUM(cn.total_ttc),0) AS ttc, COALESCE(SUM(cn.cost_total),0) AS cost
       FROM credit_notes cn JOIN sales s ON s.id = cn.sale_id WHERE cn.kind = 'return' AND ${SALES_OK} AND cn.created_at BETWEEN ? AND ?`,
    fromUtc,
    toUtc,
  );
  const [purchases, expenses, cashIn, invoices] = await Promise.all([
    first<any>(db, `SELECT COALESCE(SUM(total_ht),0) AS ht, COALESCE(SUM(total_ttc + extra_costs),0) AS ttc FROM goods_receipts WHERE status = 'validated' AND received_at BETWEEN ? AND ?`, fromUtc, toUtc),
    first<any>(db, `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE status = 'validated' AND expense_date BETWEEN ? AND ?`, from, to),
    first<any>(db, `SELECT COALESCE(SUM(CASE WHEN direction='in' AND party_type='customer' THEN amount ELSE 0 END),0) AS cin, COALESCE(SUM(CASE WHEN direction='out' AND party_type='customer' THEN amount ELSE 0 END),0) AS refunds FROM payments WHERE payment_date BETWEEN ? AND ?`, fromUtc, toUtc),
    first<any>(db, `SELECT COUNT(*) AS n FROM invoices WHERE status = 'validated' AND invoice_date BETWEEN ? AND ?`, fromUtc, toUtc),
  ]);
  const revenueHt = sales.ht - returns.ht;
  const cogs = sales.cost - returns.cost;
  const margin = revenueHt - cogs;
  return {
    sales_count: sales.n,
    revenue_ht: revenueHt,
    revenue_ttc: sales.ttc - returns.ttc,
    discounts: sales.discounts,
    cogs,
    gross_margin: margin,
    markup_bp: cogs > 0 ? Math.round((margin * 10000) / cogs) : null,
    margin_rate_bp: revenueHt > 0 ? Math.round((margin * 10000) / revenueHt) : null,
    purchases_ht: purchases.ht,
    purchases_ttc: purchases.ttc,
    expenses: expenses.total,
    result: margin - expenses.total,
    collections: cashIn.cin - cashIn.refunds,
    invoices_count: invoices.n,
  };
}

function utcBounds(from: string, to: string): [string, string] {
  return [
    new Date(`${from}T00:00:00+01:00`).toISOString().slice(0, 19).replace('T', ' '),
    new Date(`${to}T23:59:59+01:00`).toISOString().slice(0, 19).replace('T', ' '),
  ];
}

dashboard.get('/', async (c) => {
  const db = c.env.DB;
  const { from, to, fromUtc, toUtc } = dateRange(c);
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const fin = can(c, 'finance.view');
  const expDays = Number(await getSetting(db, 'expiry_alert_days', '30'));
  const [period, day, month, year] = await Promise.all([
    periodKpis(db, fromUtc, toUtc, from, to),
    periodKpis(db, ...utcBounds(today, today), today, today),
    periodKpis(db, ...utcBounds(today.slice(0, 8) + '01', today), today.slice(0, 8) + '01', today),
    periodKpis(db, ...utcBounds(today.slice(0, 5) + '01-01', today), today.slice(0, 5) + '01-01', today),
  ]);
  const snap = await first<any>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM products WHERE is_active = 1) AS products,
       (SELECT COALESCE(SUM(sb.quantity * p.avg_cost),0) FROM stock_balances sb JOIN products p ON p.id = sb.product_id WHERE sb.quantity > 0) AS stock_value,
       (SELECT COUNT(*) FROM (SELECT p.id, p.min_stock, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS q FROM products p WHERE is_active = 1) WHERE q <= 0) AS out_of_stock,
       (SELECT COUNT(*) FROM (SELECT p.id, p.min_stock, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS q FROM products p WHERE is_active = 1) WHERE q > 0 AND q <= min_stock) AS low_stock,
       (SELECT COUNT(DISTINCT product_id) FROM product_batches WHERE remaining_qty > 0 AND expires_at IS NOT NULL AND expires_at <= date('now','+1 hour','+' || ? || ' days')) AS expiring,
       (SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b ELSE 0 END),0) FROM (SELECT ${CUSTOMER_BALANCE_SQL} AS b FROM customers c)) AS receivables,
       (SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b ELSE 0 END),0) FROM (SELECT ${SUPPLIER_BALANCE_SQL} AS b FROM suppliers s)) AS payables,
       (SELECT COALESCE(SUM(m.amount),0) FROM cash_movements m JOIN cash_sessions cs ON cs.id = m.session_id WHERE cs.status = 'open') AS cash_balance,
       (SELECT COUNT(*) FROM invoices WHERE verification_status = 'pending' AND status = 'validated') AS invoices_pending`,
    expDays,
  );

  const [daily, monthly, byCategory, topProducts, topCustomers, paymentsByMethod, stockFlow] = await Promise.all([
    all<any>(
      db,
      `SELECT date(sale_date, '+1 hour') AS d, COUNT(*) AS n, SUM(subtotal_ht) AS ht, SUM(total_ttc) AS ttc, SUM(subtotal_ht - cost_total) AS margin
         FROM sales s WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ? GROUP BY d ORDER BY d`,
      fromUtc,
      toUtc,
    ),
    all<any>(
      db,
      `WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n < 11),
       months AS (SELECT strftime('%Y-%m', date('now','+1 hour','start of month', '-' || n || ' months')) AS m FROM seq)
       SELECT months.m,
         COALESCE((SELECT SUM(subtotal_ht) FROM sales s WHERE ${SALES_OK} AND strftime('%Y-%m', sale_date, '+1 hour') = months.m),0)
           - COALESCE((SELECT SUM(cn.total_ht) FROM credit_notes cn JOIN sales s ON s.id = cn.sale_id WHERE cn.kind='return' AND ${SALES_OK} AND strftime('%Y-%m', cn.created_at, '+1 hour') = months.m),0) AS revenue,
         COALESCE((SELECT SUM(subtotal_ht - cost_total) FROM sales s WHERE ${SALES_OK} AND strftime('%Y-%m', sale_date, '+1 hour') = months.m),0)
           - COALESCE((SELECT SUM(cn.total_ht - cn.cost_total) FROM credit_notes cn JOIN sales s ON s.id = cn.sale_id WHERE cn.kind='return' AND ${SALES_OK} AND strftime('%Y-%m', cn.created_at, '+1 hour') = months.m),0) AS margin,
         COALESCE((SELECT SUM(total_ht) FROM goods_receipts WHERE status = 'validated' AND strftime('%Y-%m', received_at, '+1 hour') = months.m),0) AS purchases,
         COALESCE((SELECT SUM(amount) FROM expenses WHERE status = 'validated' AND strftime('%Y-%m', expense_date) = months.m),0) AS expenses
       FROM months ORDER BY months.m`,
    ),
    all<any>(
      db,
      `SELECT COALESCE(cat.name, 'Sans catégorie') AS name, SUM(si.line_ht) AS value FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
         LEFT JOIN categories cat ON cat.id = p.category_id WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY 1 ORDER BY value DESC LIMIT 12`,
      fromUtc,
      toUtc,
    ),
    all<any>(
      db,
      `SELECT si.product_id, si.product_name AS name, SUM(si.qty - si.returned_qty) AS qty, SUM(si.line_ht) AS revenue, SUM(si.line_ht - si.unit_cost * si.qty) AS margin
         FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY si.product_id ORDER BY revenue DESC LIMIT 10`,
      fromUtc,
      toUtc,
    ),
    all<any>(
      db,
      `SELECT COALESCE(s.customer_name, 'Clients comptoir') AS name, COUNT(*) AS n, SUM(s.subtotal_ht) AS revenue FROM sales s
        WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY s.customer_id ORDER BY revenue DESC LIMIT 10`,
      fromUtc,
      toUtc,
    ),
    all<any>(db, `SELECT method, SUM(amount) AS value FROM payments WHERE direction = 'in' AND party_type = 'customer' AND payment_date BETWEEN ? AND ? GROUP BY method`, fromUtc, toUtc),
    all<any>(
      db,
      `SELECT date(created_at, '+1 hour') AS d, SUM(quantity * unit_cost) AS delta FROM stock_movements WHERE created_at >= datetime('now', '-90 days') GROUP BY d ORDER BY d DESC`,
    ),
  ]);
  // Valeur du stock reconstituée à rebours depuis la valeur actuelle (approximation au coût enregistré dans chaque mouvement)
  let v = snap.stock_value;
  const stockValue: { d: string; value: number }[] = [];
  for (const r of stockFlow) {
    stockValue.unshift({ d: r.d, value: v });
    v -= r.delta;
  }
  const strip = (k: any) => (fin ? k : { ...k, cogs: null, gross_margin: null, markup_bp: null, margin_rate_bp: null, result: null, purchases_ht: null, purchases_ttc: null, expenses: null });
  return c.json({
    range: { from, to },
    period: strip(period),
    today: strip(day),
    month: strip(month),
    year: strip(year),
    snapshot: fin ? snap : { ...snap, stock_value: null, payables: null },
    charts: {
      daily: fin ? daily : daily.map((d) => ({ ...d, margin: null })),
      monthly: fin ? monthly : monthly.map((m) => ({ ...m, margin: null, purchases: null, expenses: null })),
      by_category: byCategory,
      top_products: fin ? topProducts : topProducts.map((t) => ({ ...t, margin: null })),
      top_customers: topCustomers,
      payments_by_method: paymentsByMethod,
      stock_value: fin ? stockValue : [],
    },
  });
});

// ───────────── Centre de rapports ─────────────
export const reports = new Hono<AppEnv>();
reports.use('*', requireAuth, perm('reports.view'));

type Col = { key: string; label: string; type?: 'money' | 'int' | 'date' | 'datetime' | 'percent' | 'text'; finance?: boolean };
type ReportDef = { title: string; columns: Col[]; sql: string; params: (r: ReturnType<typeof dateRange>) => unknown[]; finance?: boolean; perm?: string };

const REPORTS: Record<string, ReportDef> = {
  'sales-daily': {
    title: 'Ventes journalières',
    columns: [{ key: 'd', label: 'Date', type: 'date' }, { key: 'n', label: 'Ventes', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'vat', label: 'TVA', type: 'money' }, { key: 'ttc', label: 'CA TTC', type: 'money' }, { key: 'discounts', label: 'Remises', type: 'money' }, { key: 'margin', label: 'Marge brute', type: 'money', finance: true }],
    sql: `SELECT date(sale_date,'+1 hour') AS d, COUNT(*) AS n, SUM(subtotal_ht) AS ht, SUM(total_vat) AS vat, SUM(total_ttc) AS ttc, SUM(discount_total) AS discounts, SUM(subtotal_ht - cost_total) AS margin
            FROM sales s WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ? GROUP BY d ORDER BY d`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'sales-monthly': {
    title: 'Ventes mensuelles',
    columns: [{ key: 'm', label: 'Mois' }, { key: 'n', label: 'Ventes', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'ttc', label: 'CA TTC', type: 'money' }, { key: 'margin', label: 'Marge brute', type: 'money', finance: true }],
    sql: `SELECT strftime('%Y-%m', sale_date, '+1 hour') AS m, COUNT(*) AS n, SUM(subtotal_ht) AS ht, SUM(total_ttc) AS ttc, SUM(subtotal_ht - cost_total) AS margin
            FROM sales s WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ? GROUP BY m ORDER BY m`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'sales-by-product': {
    title: 'Ventes par produit',
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'qty', label: 'Qté nette', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'cost', label: 'Coût', type: 'money', finance: true }, { key: 'margin', label: 'Marge', type: 'money', finance: true }],
    sql: `SELECT si.product_reference AS reference, si.product_name AS name, SUM(si.qty - si.returned_qty) AS qty,
                 SUM(si.line_ht * (si.qty - si.returned_qty) / si.qty) AS ht, SUM(si.unit_cost * (si.qty - si.returned_qty)) AS cost,
                 SUM(si.line_ht * (si.qty - si.returned_qty) / si.qty - si.unit_cost * (si.qty - si.returned_qty)) AS margin
            FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY si.product_id ORDER BY ht DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'sales-by-category': {
    title: 'Ventes par catégorie',
    columns: [{ key: 'name', label: 'Catégorie' }, { key: 'qty', label: 'Qté', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'margin', label: 'Marge', type: 'money', finance: true }],
    sql: `SELECT COALESCE(c.name,'Sans catégorie') AS name, SUM(si.qty - si.returned_qty) AS qty, SUM(si.line_ht) AS ht, SUM(si.line_ht - si.unit_cost * si.qty) AS margin
            FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id
           WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY 1 ORDER BY ht DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'sales-by-customer': {
    title: 'Ventes par client',
    columns: [{ key: 'name', label: 'Client' }, { key: 'type', label: 'Type' }, { key: 'n', label: 'Ventes', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'ttc', label: 'CA TTC', type: 'money' }, { key: 'paid', label: 'Encaissé', type: 'money' }],
    sql: `SELECT COALESCE(customer_name,'Clients comptoir') AS name, customer_type AS type, COUNT(*) AS n, SUM(subtotal_ht) AS ht, SUM(total_ttc) AS ttc, SUM(amount_paid) AS paid
            FROM sales s WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ? GROUP BY customer_id ORDER BY ht DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'sales-by-user': {
    title: 'Ventes par utilisateur',
    columns: [{ key: 'name', label: 'Utilisateur' }, { key: 'n', label: 'Ventes', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'ttc', label: 'CA TTC', type: 'money' }, { key: 'discounts', label: 'Remises', type: 'money' }],
    sql: `SELECT u.full_name AS name, COUNT(*) AS n, SUM(subtotal_ht) AS ht, SUM(total_ttc) AS ttc, SUM(discount_total) AS discounts
            FROM sales s JOIN users u ON u.id = s.created_by WHERE ${SALES_OK} AND sale_date BETWEEN ? AND ? GROUP BY s.created_by ORDER BY ht DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'purchases-by-supplier': {
    title: 'Achats par fournisseur',
    finance: true,
    columns: [{ key: 'name', label: 'Fournisseur' }, { key: 'n', label: 'Réceptions', type: 'int' }, { key: 'ht', label: 'Total HT', type: 'money' }, { key: 'ttc', label: 'Total TTC', type: 'money' }],
    sql: `SELECT sp.name, COUNT(*) AS n, SUM(r.total_ht) AS ht, SUM(r.total_ttc + r.extra_costs) AS ttc FROM goods_receipts r JOIN suppliers sp ON sp.id = r.supplier_id
           WHERE r.status = 'validated' AND r.received_at BETWEEN ? AND ? GROUP BY r.supplier_id ORDER BY ht DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'margin-by-product': {
    title: 'Marge par produit',
    finance: true,
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'qty', label: 'Qté', type: 'int' }, { key: 'ht', label: 'CA HT', type: 'money' }, { key: 'cost', label: 'CMV', type: 'money' }, { key: 'margin', label: 'Marge', type: 'money' }, { key: 'margin_rate', label: 'Taux de marque', type: 'percent' }],
    sql: `SELECT reference, name, qty, ht, cost, ht - cost AS margin, CASE WHEN ht > 0 THEN (ht - cost) * 10000 / ht END AS margin_rate FROM (
            SELECT si.product_reference AS reference, si.product_name AS name, SUM(si.qty - si.returned_qty) AS qty, SUM(si.line_ht * (si.qty - si.returned_qty) / si.qty) AS ht, SUM(si.unit_cost * (si.qty - si.returned_qty)) AS cost
              FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY si.product_id) ORDER BY margin DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  'stock-valuation': {
    title: 'Valorisation du stock (coût moyen pondéré)',
    finance: true,
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'category', label: 'Catégorie' }, { key: 'stock', label: 'Stock', type: 'int' }, { key: 'avg_cost', label: 'CMP HT', type: 'money' }, { key: 'value', label: 'Valeur', type: 'money' }, { key: 'sale_value', label: 'Valeur de vente HT', type: 'money' }],
    sql: `SELECT p.reference, p.name, c.name AS category, SUM(sb.quantity) AS stock, p.avg_cost, SUM(sb.quantity) * p.avg_cost AS value, SUM(sb.quantity) * p.sale_price AS sale_value
            FROM products p JOIN stock_balances sb ON sb.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 GROUP BY p.id HAVING stock <> 0 ORDER BY value DESC`,
    params: () => [],
  },
  'stock-state': {
    title: 'État du stock',
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'category', label: 'Catégorie' }, { key: 'stock', label: 'Stock', type: 'int' }, { key: 'min_stock', label: 'Minimum', type: 'int' }, { key: 'unit', label: 'Unité' }],
    sql: `SELECT p.reference, p.name, c.name AS category, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock, p.min_stock, p.unit
            FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.is_active = 1 ORDER BY p.name`,
    params: () => [],
  },
  'out-of-stock': {
    title: 'Produits en rupture',
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'stock', label: 'Stock', type: 'int' }, { key: 'min_stock', label: 'Minimum', type: 'int' }, { key: 'supplier', label: 'Fournisseur' }],
    sql: `SELECT * FROM (SELECT p.reference, p.name, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock, p.min_stock, s.name AS supplier
            FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.is_active = 1) WHERE stock <= 0 ORDER BY name`,
    params: () => [],
  },
  expiring: {
    title: 'Produits proches de la péremption',
    columns: [{ key: 'name', label: 'Produit' }, { key: 'batch_number', label: 'Lot' }, { key: 'expires_at', label: 'Péremption', type: 'date' }, { key: 'days_left', label: 'Jours restants', type: 'int' }, { key: 'remaining_qty', label: 'Qté', type: 'int' }],
    sql: `SELECT p.name, b.batch_number, b.expires_at, CAST(julianday(b.expires_at) - julianday(date('now','+1 hour')) AS INTEGER) AS days_left, b.remaining_qty
            FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.remaining_qty > 0 AND b.expires_at IS NOT NULL AND b.expires_at <= date('now','+1 hour','+60 days') ORDER BY b.expires_at`,
    params: () => [],
  },
  'low-rotation': {
    title: 'Produits à faible rotation (60 jours)',
    columns: [{ key: 'reference', label: 'Référence' }, { key: 'name', label: 'Produit' }, { key: 'stock', label: 'Stock', type: 'int' }, { key: 'last_sale', label: 'Dernière vente', type: 'datetime' }],
    sql: `SELECT * FROM (SELECT p.reference, p.name, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS stock,
            (SELECT MAX(s.sale_date) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'completed') AS last_sale FROM products p WHERE p.is_active = 1)
          WHERE stock > 0 AND (last_sale IS NULL OR last_sale < datetime('now','-60 days')) ORDER BY last_sale`,
    params: () => [],
  },
  'inventory-gaps': {
    title: "Écarts d'inventaire",
    columns: [{ key: 'number', label: 'Inventaire' }, { key: 'validated_at', label: 'Validé le', type: 'datetime' }, { key: 'name', label: 'Produit' }, { key: 'theoretical_qty', label: 'Théorique', type: 'int' }, { key: 'counted_qty', label: 'Compté', type: 'int' }, { key: 'gap', label: 'Écart', type: 'int' }, { key: 'value', label: 'Valeur écart', type: 'money', finance: true }],
    sql: `SELECT i.number, i.validated_at, p.name, it.theoretical_qty, it.counted_qty, it.counted_qty - it.theoretical_qty AS gap, (it.counted_qty - it.theoretical_qty) * p.avg_cost AS value
            FROM inventory_items it JOIN inventories i ON i.id = it.inventory_id JOIN products p ON p.id = it.product_id
           WHERE i.status IN ('submitted','validated') AND it.counted_qty <> it.theoretical_qty AND i.created_at BETWEEN ? AND ? ORDER BY i.created_at DESC`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  receivables: {
    title: 'Créances clients',
    columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Client' }, { key: 'phone', label: 'Téléphone' }, { key: 'credit_limit', label: 'Plafond', type: 'money' }, { key: 'balance', label: 'Solde dû', type: 'money' }],
    sql: `SELECT * FROM (SELECT c.code, c.name, c.phone, c.credit_limit, ${CUSTOMER_BALANCE_SQL} AS balance FROM customers c) WHERE balance > 0 ORDER BY balance DESC`,
    params: () => [],
  },
  payables: {
    title: 'Dettes fournisseurs',
    finance: true,
    columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Fournisseur' }, { key: 'phone', label: 'Téléphone' }, { key: 'balance', label: 'Solde dû', type: 'money' }],
    sql: `SELECT * FROM (SELECT s.code, s.name, s.phone, ${SUPPLIER_BALANCE_SQL} AS balance FROM suppliers s) WHERE balance > 0 ORDER BY balance DESC`,
    params: () => [],
  },
  expenses: {
    title: 'Dépenses',
    finance: true,
    columns: [{ key: 'expense_date', label: 'Date', type: 'date' }, { key: 'number', label: 'N°' }, { key: 'category', label: 'Catégorie' }, { key: 'description', label: 'Description' }, { key: 'amount', label: 'Montant', type: 'money' }],
    sql: `SELECT e.expense_date, e.number, ec.name AS category, e.description, e.amount FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
           WHERE e.status = 'validated' AND e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date`,
    params: (r) => [r.from, r.to],
  },
  cash: {
    title: 'Situation de caisse',
    columns: [{ key: 'number', label: 'Session' }, { key: 'register', label: 'Caisse' }, { key: 'user', label: 'Caissier' }, { key: 'opened_at', label: 'Ouverture', type: 'datetime' }, { key: 'closed_at', label: 'Clôture', type: 'datetime' }, { key: 'opening_amount', label: 'Fond initial', type: 'money' }, { key: 'expected_amount', label: 'Théorique', type: 'money' }, { key: 'counted_amount', label: 'Déclaré', type: 'money' }, { key: 'difference', label: 'Écart', type: 'money' }, { key: 'status', label: 'Statut' }],
    sql: `SELECT cs.number, r.name AS register, u.full_name AS user, cs.opened_at, cs.closed_at, cs.opening_amount, cs.expected_amount, cs.counted_amount, cs.difference, cs.status
            FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.register_id JOIN users u ON u.id = cs.user_id WHERE cs.opened_at BETWEEN ? AND ? ORDER BY cs.opened_at`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  movements: {
    title: 'Historique des mouvements de stock',
    columns: [{ key: 'created_at', label: 'Date', type: 'datetime' }, { key: 'name', label: 'Produit' }, { key: 'type', label: 'Type' }, { key: 'quantity', label: 'Qté', type: 'int' }, { key: 'stock_before', label: 'Avant', type: 'int' }, { key: 'stock_after', label: 'Après', type: 'int' }, { key: 'doc_number', label: 'Document' }, { key: 'user', label: 'Utilisateur' }, { key: 'reason', label: 'Motif' }],
    sql: `SELECT m.created_at, p.name, m.type, m.quantity, m.stock_before, m.stock_after, m.doc_number, u.full_name AS user, m.reason FROM stock_movements m JOIN products p ON p.id = m.product_id
            LEFT JOIN users u ON u.id = m.user_id WHERE m.created_at BETWEEN ? AND ? ORDER BY m.id`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
  vat: {
    title: 'TVA collectée par taux',
    finance: true,
    columns: [{ key: 'rate', label: 'Taux', type: 'percent' }, { key: 'ht', label: 'Base HT', type: 'money' }, { key: 'vat', label: 'TVA', type: 'money' }],
    sql: `SELECT si.vat_bp AS rate, SUM(si.line_ht) AS ht, SUM(si.line_vat) AS vat FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE ${SALES_OK} AND s.sale_date BETWEEN ? AND ? GROUP BY si.vat_bp ORDER BY si.vat_bp`,
    params: (r) => [r.fromUtc, r.toUtc],
  },
};

reports.get('/', (c) => c.json(Object.entries(REPORTS).filter(([, r]) => !r.finance || can(c, 'finance.view')).map(([k, r]) => ({ key: k, title: r.title }))));

reports.get('/:key', async (c) => {
  const def = REPORTS[c.req.param('key')];
  if (!def) throw new HttpError(404, 'NOT_FOUND', 'Rapport inconnu.');
  if (def.finance) need(c, 'finance.view');
  const range = dateRange(c);
  const rows = await all<any>(c.env.DB, def.sql + ' LIMIT 20000', ...def.params(range));
  const fin = can(c, 'finance.view');
  const columns = def.columns.filter((col) => !col.finance || fin);
  const intCols = def.columns.filter((col) => col.type === 'money' || col.type === 'percent').map((col) => col.key);
  return c.json({
    title: def.title,
    range,
    columns,
    rows: rows.map((r) => {
      const o: any = {};
      for (const col of columns) o[col.key] = intCols.includes(col.key) && r[col.key] !== null ? Math.round(r[col.key]) : r[col.key];
      return o;
    }),
  });
});

// ───────────── Notifications ─────────────
export async function refreshNotifications(db: D1Database) {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const days = Number(await getSetting(db, 'expiry_alert_days', '30'));
  const q = await first<any>(
    db,
    `SELECT
      (SELECT COUNT(*) FROM (SELECT p.min_stock, COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS q FROM products p WHERE is_active = 1) WHERE q > 0 AND q <= min_stock) AS low,
      (SELECT COUNT(*) FROM (SELECT COALESCE((SELECT SUM(quantity) FROM stock_balances WHERE product_id = p.id),0) AS q FROM products p WHERE is_active = 1) WHERE q <= 0) AS out_,
      (SELECT COUNT(*) FROM product_batches WHERE remaining_qty > 0 AND expires_at IS NOT NULL AND expires_at >= date('now','+1 hour') AND expires_at <= date('now','+1 hour','+' || ? || ' days')) AS expiring,
      (SELECT COUNT(*) FROM product_batches WHERE remaining_qty > 0 AND expires_at IS NOT NULL AND expires_at < date('now','+1 hour')) AS expired,
      (SELECT COUNT(*) FROM sales WHERE status = 'completed' AND total_ttc - credited_amount - amount_paid > 0 AND due_date < date('now','+1 hour')) AS overdue_rec,
      (SELECT COUNT(*) FROM purchase_invoices WHERE status IN ('unpaid','partial') AND due_date < date('now','+1 hour')) AS overdue_pay,
      (SELECT COUNT(*) FROM invoices WHERE verification_status = 'pending' AND status = 'validated') AS pending_inv`,
    days,
  );
  const items: [string, string, string, string, string, string, number][] = [
    ['stock-low', 'warning', 'Stock faible', `${q.low} produit(s) sous le stock minimum`, '/stock/alertes', 'stock.view', q.low],
    ['stock-out', 'danger', 'Rupture de stock', `${q.out_} produit(s) en rupture`, '/stock/alertes', 'stock.view', q.out_],
    ['expiring', 'warning', 'Péremption proche', `${q.expiring} lot(s) périment dans moins de ${days} jours`, '/stock/lots', 'stock.view', q.expiring],
    ['expired', 'danger', 'Produits périmés', `${q.expired} lot(s) périmé(s) encore en stock`, '/stock/lots', 'stock.view', q.expired],
    ['overdue-rec', 'danger', 'Créances échues', `${q.overdue_rec} vente(s) à crédit échue(s)`, '/creances', 'customers.view', q.overdue_rec],
    ['overdue-pay', 'warning', 'Dettes fournisseurs échues', `${q.overdue_pay} facture(s) fournisseur échue(s)`, '/dettes', 'purchases.manage', q.overdue_pay],
    ['invoices-pending', 'info', 'Factures à vérifier', `${q.pending_inv} facture(s) en attente de vérification`, '/verification', 'invoices.verify', q.pending_inv],
  ];
  const stmts: D1PreparedStatement[] = [];
  for (const [key, sev, title, msg, link, perm, n] of items) {
    const dk = `${key}-${today}`;
    if (n > 0) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO notifications (id, dedupe_key, type, severity, title, message, link, permission) VALUES (?,?,?,?,?,?,?,?)
             ON CONFLICT(dedupe_key) DO UPDATE SET message = excluded.message, resolved = 0`,
          )
          .bind(uuid(), dk, key, sev, title, msg, link, perm),
      );
    } else {
      stmts.push(db.prepare('UPDATE notifications SET resolved = 1 WHERE dedupe_key = ?').bind(dk));
    }
  }
  stmts.push(db.prepare(`DELETE FROM notifications WHERE created_at < datetime('now','-60 days')`));
  stmts.push(db.prepare(`INSERT INTO settings (key, value) VALUES ('notif_refreshed_at', datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value`));
  await db.batch(stmts);
}

export const notifications = new Hono<AppEnv>();
notifications.use('*', requireAuth);

notifications.get('/', async (c) => {
  const db = c.env.DB;
  const last = await getSetting(db, 'notif_refreshed_at', '');
  if (!last || Date.now() - Date.parse(last.replace(' ', 'T') + 'Z') > 5 * 60000) await refreshNotifications(db);
  const perms = [...c.get('user').perms];
  const rows = await all(
    db,
    `SELECT * FROM notifications WHERE resolved = 0 AND (permission IS NULL OR permission IN (${perms.map(() => '?').join(',') || "''"})) ORDER BY is_read, created_at DESC LIMIT 50`,
    ...perms,
  );
  return c.json(rows);
});
notifications.post('/:id/read', async (c) => {
  await run(c.env.DB, 'UPDATE notifications SET is_read = 1 WHERE id = ?', c.req.param('id'));
  return c.json({ ok: true });
});
notifications.post('/read-all', async (c) => {
  await run(c.env.DB, 'UPDATE notifications SET is_read = 1 WHERE resolved = 0');
  return c.json({ ok: true });
});

// ───────────── Journal d'audit ─────────────
export const audit = new Hono<AppEnv>();
audit.use('*', requireAuth, perm('audit.view'));
audit.get('/', async (c) => {
  const { pageSize, offset, like, q } = pageParams(c);
  const { fromUtc, toUtc } = dateRange(c);
  const where = ['created_at BETWEEN ? AND ?'];
  const params: unknown[] = [fromUtc, toUtc];
  if (q) {
    where.push('(user_name LIKE ? OR action LIKE ? OR entity LIKE ? OR entity_id LIKE ? OR new_value LIKE ? OR reason LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  if (c.req.query('entity')) {
    where.push('entity = ?');
    params.push(c.req.query('entity'));
  }
  const rows = await all(c.env.DB, `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, pageSize, offset);
  const t = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM audit_logs WHERE ${where.join(' AND ')}`, ...params);
  return c.json({ rows, total: t?.n ?? 0 });
});

// ───────────── Recherche globale ─────────────
export const search = new Hono<AppEnv>();
search.use('*', requireAuth);
search.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const db = c.env.DB;
  const out: any[] = [];
  if (can(c, 'products.view') || can(c, 'pos.use')) {
    const r = await all<any>(db, `SELECT id, name, reference FROM products p WHERE name LIKE ? OR reference LIKE ? OR EXISTS (SELECT 1 FROM product_barcodes b WHERE b.product_id = p.id AND b.barcode = ?) LIMIT 6`, like, like, q);
    out.push(...r.map((x) => ({ type: 'product', id: x.id, label: x.name, sub: x.reference, link: `/produits/${x.id}` })));
  }
  if (can(c, 'customers.view')) {
    const r = await all<any>(db, `SELECT id, name, code, phone FROM customers WHERE name LIKE ? OR code LIKE ? OR phone LIKE ? LIMIT 5`, like, like, like);
    out.push(...r.map((x) => ({ type: 'customer', id: x.id, label: x.name, sub: `${x.code} ${x.phone ?? ''}`, link: `/clients/${x.id}` })));
  }
  if (can(c, 'suppliers.view')) {
    const r = await all<any>(db, `SELECT id, name, code FROM suppliers WHERE name LIKE ? OR code LIKE ? LIMIT 4`, like, like);
    out.push(...r.map((x) => ({ type: 'supplier', id: x.id, label: x.name, sub: x.code, link: `/fournisseurs/${x.id}` })));
  }
  if (can(c, 'sales.view') || can(c, 'invoices.view')) {
    const r = await all<any>(db, `SELECT s.id, s.number, i.number AS inv, s.total_ttc FROM sales s LEFT JOIN invoices i ON i.sale_id = s.id WHERE s.number LIKE ? OR i.number LIKE ? ORDER BY s.sale_date DESC LIMIT 5`, like, like);
    out.push(...r.map((x) => ({ type: 'sale', id: x.id, label: x.inv ?? x.number, sub: x.inv ? x.number : '', link: `/ventes/${x.id}` })));
  }
  return c.json(out);
});
