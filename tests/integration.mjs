// Tests d'intégration de l'API sur une base D1 réelle (locale).
// Prérequis : `npm run dev:api` (wrangler dev sur :8787) avec migrations locales appliquées et admin admin@test.local / Test12345.
// Usage : node tests/integration.mjs [baseUrl]
import assert from 'node:assert/strict';

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
let passed = 0;
const failures = [];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const RUN = Date.now().toString(36).slice(-5);

class Client {
  constructor() {
    this.cookie = '';
  }
  async req(method, path, body, headers = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-ndc': '1', cookie: this.cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }
  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p); }
  async ok(method, p, b) {
    const r = await this.req(method, p, b);
    if (r.status >= 300) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✔', name);
  } catch (e) {
    failures.push([name, e]);
    console.log('  ✘', name, '\n     ', e.message);
  }
}

const admin = new Client();
const ean = (body12) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(body12[11 - i]) * (i % 2 === 0 ? 3 : 1);
  return body12 + ((10 - (s % 10)) % 10);
};
const stockOf = async (id) => (await admin.ok('GET', `/api/products/${id}`)).stock.reduce((s, r) => s + r.quantity, 0);
const ctx = {};

console.log(`\nTests d'intégration — ${BASE}\n`);

await test('santé de l’API', async () => {
  const r = await admin.get('/api/health');
  assert.equal(r.status, 200);
});

await test('connexion refusée avec mauvais mot de passe', async () => {
  const c = new Client();
  const r = await c.post('/api/auth/login', { email: 'admin@test.local', password: 'mauvais' });
  assert.equal(r.status, 401);
});

await test('protection CSRF (en-tête manquant)', async () => {
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

await test('connexion administrateur + session', async () => {
  const r = await admin.post('/api/auth/login', { email: 'admin@test.local', password: 'Test12345' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = await admin.ok('GET', '/api/me');
  assert.ok(me.permissions.includes('users.manage'));
});

await test('accès refusé sans session', async () => {
  const r = await new Client().get('/api/products');
  assert.equal(r.status, 401);
});

await test('référentiels : catégorie, fournisseur, client grossiste', async () => {
  ctx.cat = (await admin.ok('POST', '/api/categories', { name: 'Hygiène ' + RUN })).id;
  ctx.sup = (await admin.ok('POST', '/api/suppliers', { name: 'Fournisseur Test ' + RUN })).id;
  ctx.cust = (await admin.ok('POST', '/api/customers', { name: 'Grossiste Test ' + RUN, type: 'grossiste', credit_limit: 500000 })).id;
});

ctx.codeA = ean('619' + RUN.replace(/\D/g, '1').padEnd(9, '7').slice(0, 9));
ctx.codeZero = ean('00' + String(Date.now()).slice(-10));

await test('création produit A avec code-barres EAN-13 et stock initial', async () => {
  const r = await admin.ok('POST', '/api/products', {
    name: 'Savon Test ' + RUN, category_id: ctx.cat, supplier_id: ctx.sup, purchase_price: 1000, sale_price: 2000, price_wholesale: 1600, vat_bp: 1900, min_stock: 2,
    barcodes: [{ barcode: ctx.codeA, packaging: 'piece', qty_per_unit: 1, is_primary: true }, { barcode: ctx.codeA + '9', packaging: 'carton', qty_per_unit: 12 }],
    initial_stock: 10,
  });
  ctx.pA = r.id;
  assert.equal(await stockOf(ctx.pA), 10);
});

await test('code-barres en double refusé', async () => {
  const r = await admin.post('/api/products', { name: 'Doublon', sale_price: 1000, barcodes: [{ barcode: ctx.codeA }] });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'BARCODE_DUPLICATE');
});

await test('zéros initiaux conservés + recherche par scan', async () => {
  const r = await admin.ok('POST', '/api/products', { name: 'Produit Zéro ' + RUN, sale_price: 500, barcodes: [{ barcode: ctx.codeZero }] });
  ctx.pZero = r.id;
  const l = await admin.ok('GET', `/api/products/lookup/${ctx.codeZero}`);
  assert.equal(l.found, true);
  assert.equal(l.product.barcode, ctx.codeZero);
  assert.ok(l.product.barcode.startsWith('00'));
  const carton = await admin.ok('GET', `/api/products/lookup/${ctx.codeA}9`);
  assert.equal(carton.qty_per_unit, 12);
  const unknown = await admin.ok('GET', `/api/products/lookup/0000000000000`);
  assert.equal(unknown.found, false);
});

await test('règle de remise 10+ = 5 %', async () => {
  ctx.rule = (await admin.ok('POST', '/api/discount-rules', { name: 'Test 10+ ' + RUN, priority: 1, product_id: ctx.pA, min_qty: 10, discount_bp: 500 })).id;
});

await test('ouverture de caisse', async () => {
  const cur = await admin.ok('GET', '/api/cash/current');
  if (!cur.session) await admin.ok('POST', '/api/cash/open', { register_id: 'reg-1', opening_amount: 50000 });
  const after = await admin.ok('GET', '/api/cash/current');
  assert.ok(after.session);
  ctx.cashBefore = after.session.expected_now;
});

await test('vente comptant + facture : stock, montants, caisse', async () => {
  const key = uid();
  ctx.saleKey = key;
  const total = 3 * 2000 + Math.round(6000 * 0.19); // 7.140
  const settings = await admin.ok('GET', '/api/settings');
  const stamp = settings.fiscal_stamp_enabled === '1' ? Number(settings.fiscal_stamp) : 0;
  const r = await admin.ok('POST', '/api/sales', { idempotency_key: key, items: [{ product_id: ctx.pA, qty: 3 }], payments: [{ method: 'cash', amount: total + stamp }], create_invoice: true });
  ctx.sale1 = r.id;
  assert.equal(r.total_ttc, total + stamp);
  assert.ok(r.invoice_number?.startsWith('FAC-'));
  assert.equal(await stockOf(ctx.pA), 7);
  const cur = await admin.ok('GET', '/api/cash/current');
  assert.equal(cur.session.expected_now - ctx.cashBefore, total + stamp);
});

await test('idempotence : double clic sur Valider → une seule vente', async () => {
  const r = await admin.ok('POST', '/api/sales', { idempotency_key: ctx.saleKey, items: [{ product_id: ctx.pA, qty: 3 }], payments: [], create_invoice: true });
  assert.equal(r.duplicate, true);
  assert.equal(r.id, ctx.sale1);
  assert.equal(await stockOf(ctx.pA), 7);
});

await test('stock insuffisant → refus, aucune écriture partielle', async () => {
  const r = await admin.post('/api/sales', { idempotency_key: uid(), items: [{ product_id: ctx.pZero, qty: 1 }, { product_id: ctx.pA, qty: 100 }], payments: [] , customer_id: ctx.cust });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'STOCK_INSUFFISANT');
  assert.equal(await stockOf(ctx.pA), 7);
});

await test('ventes simultanées par deux utilisateurs : pas de survente', async () => {
  const mk = () => admin.post('/api/sales', { idempotency_key: uid(), customer_id: ctx.cust, items: [{ product_id: ctx.pA, qty: 5 }], payments: [] });
  const [a, b] = await Promise.all([mk(), mk()]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], JSON.stringify([a.body, b.body]));
  assert.equal(await stockOf(ctx.pA), 2);
  ctx.creditSale = (a.status === 200 ? a : b).body.id;
});

await test('tarif grossiste appliqué au client grossiste', async () => {
  const s = await admin.ok('GET', `/api/sales/${ctx.creditSale}`);
  assert.equal(s.items[0].unit_price_ht, 1600);
  assert.equal(s.payment_status, 'unpaid');
});

await test('réception fournisseur avec lot + péremption (CMP mis à jour)', async () => {
  const exp = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const r = await admin.ok('POST', '/api/purchases/receipts', {
    idempotency_key: uid(), supplier_id: ctx.sup, create_invoice: true,
    items: [{ product_id: ctx.pA, qty: 20, unit_price: 1300, vat_bp: 1900, batch_number: 'LOT-' + RUN, expires_at: exp }],
  });
  assert.ok(r.number.startsWith('BR-'));
  assert.equal(await stockOf(ctx.pA), 22);
  const p = await admin.ok('GET', `/api/products/${ctx.pA}`);
  // CMP : (2 × 1000 + 20 × 1300) / 22 = 1272.7 → 1273
  assert.equal(p.avg_cost, 1273);
  assert.equal(p.batches.length, 1);
});

await test('remise selon quantité (10 pièces → 5 %) et paiement partiel', async () => {
  const r = await admin.ok('POST', '/api/sales', { idempotency_key: uid(), customer_id: ctx.cust, items: [{ product_id: ctx.pA, qty: 10 }], payments: [{ method: 'cash', amount: 5000 }] });
  const s = await admin.ok('GET', `/api/sales/${r.id}`);
  assert.equal(s.items[0].discount_bp, 500);
  assert.equal(s.items[0].line_ht, 15200); // 10 × 1.600 − 5 %
  assert.equal(s.payment_status, 'partial');
  ctx.partialSale = r.id;
  assert.equal(await stockOf(ctx.pA), 12);
});

await test('règlement client imputé sur les créances les plus anciennes', async () => {
  const before = await admin.ok('GET', `/api/customers/${ctx.cust}`);
  const r = await admin.ok('POST', '/api/payments/customer', { customer_id: ctx.cust, amount: 3000, method: 'cash' });
  assert.ok(r.allocated.length >= 1);
  const after = await admin.ok('GET', `/api/customers/${ctx.cust}`);
  assert.equal(before.balance - after.balance, 3000);
});

await test('retour client partiel → avoir + remise en stock', async () => {
  const s = await admin.ok('GET', `/api/sales/${ctx.partialSale}`);
  const r = await admin.ok('POST', `/api/sales/${ctx.partialSale}/return`, { items: [{ sale_item_id: s.items[0].id, qty: 2 }], reason: 'Emballage abîmé', restock: true });
  assert.ok(r.number.startsWith('AV-'));
  assert.equal(await stockOf(ctx.pA), 14);
  const tooMuch = await admin.post(`/api/sales/${ctx.partialSale}/return`, { items: [{ sale_item_id: s.items[0].id, qty: 9 }], reason: 'test' });
  assert.equal(tooMuch.status, 409);
});

await test('annulation de vente → avoir, facture annulée, stock restitué, remboursement', async () => {
  const r = await admin.ok('POST', `/api/sales/${ctx.sale1}/cancel`, { reason: 'Erreur de saisie', refund: true });
  assert.ok(r.credit_note.number.startsWith('AV-'));
  assert.equal(await stockOf(ctx.pA), 17);
  const s = await admin.ok('GET', `/api/sales/${ctx.sale1}`);
  assert.equal(s.status, 'cancelled');
  assert.equal(s.invoice.status, 'cancelled');
  const again = await admin.post(`/api/sales/${ctx.sale1}/cancel`, { reason: 'bis' });
  assert.equal(again.status, 409);
});

await test('caissier : permissions et limite de remise', async () => {
  const email = `caissier.${RUN}@test.local`;
  await admin.ok('POST', '/api/users', { email, full_name: 'Caissier Test', role_id: 'role-caissier', password: 'Caisse123', max_discount_bp: 500 });
  const cashier = new Client();
  await cashier.ok('POST', '/api/auth/login', { email, password: 'Caisse123' });
  assert.equal((await cashier.get('/api/users')).status, 403);
  assert.equal((await cashier.get('/api/audit')).status, 403);
  const p = await cashier.ok('GET', `/api/products/${ctx.pA}`);
  assert.equal(p.avg_cost, null, 'le coût doit être masqué');
  await cashier.ok('POST', '/api/cash/open', { register_id: (await admin.ok('POST', '/api/registers', { name: 'Caisse ' + RUN })).id, opening_amount: 0 });
  const r = await cashier.post('/api/sales', { idempotency_key: uid(), items: [{ product_id: ctx.pZero, qty: 1, discount_bp: 2000 }], payments: [] });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'REMISE_NON_AUTORISEE');
  // plafond de crédit : bloquant pour un caissier (l'administrateur dispose de la permission de dépassement)
  const small = (await admin.ok('POST', '/api/customers', { name: 'Petit crédit ' + RUN, type: 'detaillant', credit_limit: 1000 })).id;
  const credit = await cashier.post('/api/sales', { idempotency_key: uid(), customer_id: small, items: [{ product_id: ctx.pZero, qty: 2 }], payments: [] });
  assert.equal(credit.status, 409, JSON.stringify(credit.body));
  assert.equal(credit.body.error, 'PLAFOND_CREDIT');
  const close = await cashier.post('/api/cash/close', { counted_amount: 1000 });
  assert.equal(close.status, 400, 'écart sans justification refusé');
  await cashier.ok('POST', '/api/cash/close', { counted_amount: 1000, justification: 'Test écart' });
});

await test('inventaire rapide par scan → soumission → validation', async () => {
  const inv = (await admin.ok('POST', '/api/inventories', {})).id;
  for (let i = 0; i < 3; i++) await admin.ok('POST', `/api/inventories/${inv}/scan`, { code: ctx.codeA });
  await admin.ok('POST', `/api/inventories/${inv}/scan`, { code: ctx.codeA + '9' }); // carton = 12
  const d = await admin.ok('GET', `/api/inventories/${inv}`);
  assert.equal(d.items[0].counted_qty, 15);
  assert.equal(d.items[0].difference, 15 - 17);
  await admin.ok('POST', `/api/inventories/${inv}/submit`);
  const v = await admin.ok('POST', `/api/inventories/${inv}/validate`);
  assert.equal(v.adjusted, 1);
  assert.equal(await stockOf(ctx.pA), 15);
});

await test('ajustement manuel (casse) motivé', async () => {
  const r = await admin.ok('POST', '/api/stock/adjust', { product_id: ctx.pA, type: 'endommage', qty: 1, reason: 'Flacon cassé' });
  assert.equal(r.stock_after, 14);
  const m = await admin.ok('GET', `/api/stock/movements?product_id=${ctx.pA}&pageSize=50`);
  assert.ok(m.rows.length >= 6);
  for (const row of m.rows) assert.equal(row.stock_after - row.stock_before, row.quantity);
});

await test('numérotation unique des documents', async () => {
  const list = await admin.ok('GET', '/api/sales?pageSize=200&from=2000-01-01&to=2100-01-01');
  const nums = list.rows.map((r) => r.number);
  assert.equal(new Set(nums).size, nums.length);
});

await test('suppression : produit utilisé refusé, produit inutilisé supprimé', async () => {
  assert.equal((await admin.del(`/api/products/${ctx.pA}`)).status, 409);
  const tmp = (await admin.ok('POST', '/api/products', { name: 'À supprimer ' + RUN, sale_price: 100 })).id;
  assert.equal((await admin.del(`/api/products/${tmp}`)).status, 200);
});

await test('import Excel/CSV : analyse (doublons, erreurs) puis import', async () => {
  const rows = [
    { reference: 'IMP-' + RUN + '-1', name: 'Importé 1', barcode: '', sale_price: '1,250', purchase_price: '0.800', vat: '19', initial_stock: '5', category: 'Import ' + RUN },
    { reference: 'IMP-' + RUN + '-1', name: 'Doublon fichier', sale_price: '2' },
    { reference: 'IMP-' + RUN + '-3', name: '', sale_price: 'abc' },
    { reference: 'IMP-' + RUN + '-4', name: 'Code pris', sale_price: '1', barcode: ctx.codeA },
  ];
  const dry = await admin.ok('POST', '/api/import', { entity: 'products', rows, dry_run: true });
  assert.equal(dry.summary.insert, 1);
  assert.equal(dry.summary.errors, 3);
  const real = await admin.ok('POST', '/api/import', { entity: 'products', rows, dry_run: false, file_name: 'test.csv' });
  assert.equal(real.imported, 1);
  const p = await admin.ok('GET', `/api/products?q=IMP-${RUN}-1`);
  assert.equal(p.rows[0].sale_price, 1250);
  assert.equal(p.rows[0].stock, 5);
});

await test('tableau de bord, rapports, alertes, notifications', async () => {
  const d = await admin.ok('GET', '/api/dashboard?from=2000-01-01&to=2100-01-01');
  assert.ok(d.period.revenue_ht > 0);
  assert.equal(d.period.gross_margin, d.period.revenue_ht - d.period.cogs);
  assert.equal(d.charts.monthly.length, 12);
  for (const k of ['sales-daily', 'margin-by-product', 'stock-valuation', 'receivables', 'vat', 'cash']) await admin.ok('GET', `/api/reports/${k}?from=2000-01-01&to=2100-01-01`);
  await admin.ok('GET', '/api/stock/alerts');
  await admin.ok('GET', '/api/notifications');
});

await test('vérification de facture à distance (contrôleur)', async () => {
  const r = await admin.ok('POST', '/api/sales', { idempotency_key: uid(), customer_id: ctx.cust, items: [{ product_id: ctx.pA, qty: 1 }], payments: [], create_invoice: true });
  await admin.ok('POST', `/api/invoices/${r.invoice_id}/review`, { action: 'anomaly', comment: 'Prix à vérifier' });
  const inv = await admin.ok('GET', `/api/invoices/${r.invoice_id}`);
  assert.equal(inv.verification_status, 'anomaly');
  assert.ok(inv.history.some((h) => h.action === 'anomaly'));
  const email = `controle.${RUN}@test.local`;
  await admin.ok('POST', '/api/users', { email, full_name: 'Contrôleur', role_id: 'role-controleur', password: 'Controle123' });
  const ctl = new Client();
  await ctl.ok('POST', '/api/auth/login', { email, password: 'Controle123' });
  assert.equal((await ctl.get('/api/invoices')).status, 200);
  assert.equal((await ctl.post(`/api/invoices/${r.invoice_id}/review`, { action: 'verified' })).status, 403, 'lecture seule par défaut');
  assert.equal((await ctl.post('/api/sales', { idempotency_key: uid(), items: [{ product_id: ctx.pA, qty: 1 }] })).status, 403);
});

await test('journal d’audit alimenté', async () => {
  const a = await admin.ok('GET', '/api/audit?pageSize=200&from=2000-01-01&to=2100-01-01');
  const actions = new Set(a.rows.map((r) => r.action));
  for (const x of ['create', 'cancel', 'return', 'stock_adjust', 'import']) assert.ok(actions.has(x), 'action manquante : ' + x);
  assert.ok(!JSON.stringify(a.rows).includes('Caisse123'), 'aucun mot de passe dans le journal');
});

await test('personnel : employés, pointage, paie mensuelle et journalière, avance', async () => {
  const m = (await admin.ok('POST', '/api/hr/employees', { full_name: 'Employé Mensuel ' + RUN, pay_type: 'monthly', monthly_salary: 780000 })).id;
  const dly = (await admin.ok('POST', '/api/hr/employees', { full_name: 'Employé Journalier ' + RUN, pay_type: 'daily', daily_rate: 30000, overtime_hourly_rate: 6000 })).id;
  await admin.ok('POST', '/api/hr/advances', { employee_id: dly, advance_date: '2031-03-03', amount: 10000 });
  const days = ['2031-03-03', '2031-03-04', '2031-03-05'];
  const st = { m: ['present', 'absent', 'present'], d: ['present', 'half', 'present'] };
  for (const [i, date] of days.entries()) {
    await admin.ok('PUT', '/api/hr/attendance', { date, entries: [{ employee_id: m, status: st.m[i] }, { employee_id: dly, status: st.d[i], overtime_minutes: i === 0 ? 60 : 0 }] });
  }
  const pv = await admin.ok('POST', '/api/hr/payroll/preview', { period_type: 'month', period_start: '2031-03-01', period_end: '2031-03-31' });
  const pm = pv.items.find((x) => x.employee_id === m);
  const pd = pv.items.find((x) => x.employee_id === dly);
  assert.equal(pm.base_amount, 750000); // 780 − 1 absence (780/26)
  assert.equal(pd.base_amount, 75000); // 2,5 jours × 30
  assert.equal(pd.overtime_amount, 6000);
  assert.equal(pd.net_amount, 75000 + 6000 - 10000);
  const run = (await admin.ok('POST', '/api/hr/payroll', { period_type: 'month', period_start: '2031-03-01', period_end: '2031-03-31', overrides: { [m]: { bonus: 20000 } } })).id;
  const overlap = await admin.post('/api/hr/payroll', { period_type: 'week', period_start: '2031-03-02', period_end: '2031-03-08' });
  assert.equal(overlap.status, 409);
  await admin.ok('POST', `/api/hr/payroll/${run}/validate`);
  const r = await admin.put('/api/hr/attendance', { date: '2031-03-03', entries: [{ employee_id: m, status: 'absent' }] });
  assert.equal(r.body.skipped, 1, 'journée payée verrouillée');
  await admin.ok('POST', `/api/hr/payroll/${run}/pay`, { from_cash: false });
  const detail = await admin.ok('GET', `/api/hr/payroll/${run}`);
  assert.equal(detail.status, 'paid');
  assert.ok(detail.expense_id);
  assert.equal((await admin.del(`/api/hr/employees/${m}`)).status, 409, 'employé payé non supprimable');
});

await test('données d’exemple : ajout puis suppression en un clic', async () => {
  const before = await admin.ok('GET', '/api/demo');
  if (before.loaded) await admin.ok('DELETE', '/api/demo');
  const load = await admin.ok('POST', '/api/demo');
  assert.ok(load.records >= 20);
  const p = await admin.ok('GET', '/api/products?q=(exemple)');
  assert.equal(p.total, 6);
  const del = await admin.ok('DELETE', '/api/demo');
  assert.equal(del.remaining, 0, JSON.stringify(del.kept));
  assert.equal((await admin.ok('GET', '/api/products?q=(exemple)&status=all')).total, 0);
  assert.equal((await admin.ok('GET', '/api/hr/employees?status=all')).filter((e) => e.full_name.startsWith('Exemple')).length, 0);
});

await test('déconnexion', async () => {
  await admin.ok('POST', '/api/auth/logout');
  assert.equal((await admin.get('/api/me')).status, 401);
});

console.log(`\n${passed} réussi(s), ${failures.length} échec(s)\n`);
process.exit(failures.length ? 1 : 0);
