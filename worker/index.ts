import { Hono } from 'hono';
import type { AppEnv, Env } from './lib';
import { HttpError, translateDbError } from './lib';
import { authPublic, me, users, roles, settings, warehouses, registers, expenseCategories } from './routes/admin';
import { products, categories, brands, discountRules } from './routes/catalog';
import { stock, inventories } from './routes/stock';
import { customers, suppliers } from './routes/partners';
import { purchases } from './routes/purchases';
import { sales, invoices, quotes } from './routes/sales';
import { cash, payments, expenses } from './routes/finance';
import { dashboard, reports, notifications, audit, search, refreshNotifications } from './routes/reports';
import { importer, backup } from './routes/data';
import { hr } from './routes/hr';
import { demo } from './routes/demo';

const app = new Hono<AppEnv>();

// En-têtes de sécurité
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Frame-Options', 'DENY');
  c.header('Cache-Control', 'no-store');
});

// Protection CSRF : toute requête modifiante doit être JSON et porter l'en-tête applicatif (impossible depuis un formulaire tiers)
app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    if (c.req.header('x-ndc') !== '1') throw new HttpError(403, 'CSRF', 'Requête refusée.');
    const origin = c.req.header('origin');
    if (origin && new URL(origin).host !== new URL(c.req.url).host) throw new HttpError(403, 'CSRF', 'Origine refusée.');
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));
app.route('/api/auth', authPublic);
app.route('/api/me', me);
app.route('/api/users', users);
app.route('/api/roles', roles);
app.route('/api/settings', settings);
app.route('/api/warehouses', warehouses);
app.route('/api/registers', registers);
app.route('/api/expense-categories', expenseCategories);
app.route('/api/products', products);
app.route('/api/categories', categories);
app.route('/api/brands', brands);
app.route('/api/discount-rules', discountRules);
app.route('/api/stock', stock);
app.route('/api/inventories', inventories);
app.route('/api/customers', customers);
app.route('/api/suppliers', suppliers);
app.route('/api/purchases', purchases);
app.route('/api/sales', sales);
app.route('/api/invoices', invoices);
app.route('/api/quotes', quotes);
app.route('/api/cash', cash);
app.route('/api/payments', payments);
app.route('/api/expenses', expenses);
app.route('/api/dashboard', dashboard);
app.route('/api/reports', reports);
app.route('/api/notifications', notifications);
app.route('/api/audit', audit);
app.route('/api/search', search);
app.route('/api/import', importer);
app.route('/api/backup', backup);
app.route('/api/hr', hr);
app.route('/api/demo', demo);

app.all('/api/*', (c) => c.json({ error: 'NOT_FOUND', message: 'Ressource introuvable.' }, 404));

app.onError((err, c) => {
  const e = translateDbError(err);
  if (e instanceof HttpError) {
    return c.json({ error: e.code, message: e.message, details: e.details }, e.status as any);
  }
  console.error('Erreur serveur', err);
  return c.json({ error: 'SERVER_ERROR', message: 'Erreur interne. L’opération n’a pas été enregistrée.' }, 500);
});

// Tout le reste : application React (assets statiques, SPA)
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(refreshNotifications(env.DB));
  },
} satisfies ExportedHandler<Env>;
