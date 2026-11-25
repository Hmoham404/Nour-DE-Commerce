import { Hono } from 'hono';
import { z } from 'zod';
import {
  AppEnv, HttpError, all, first, run, tx, uuid, body, perm, need, auditStmt, clientIp, hashPassword, verifyPassword,
  randomToken, sha256Hex, SESSION_COOKIE, SESSION_DAYS, requireAuth, passwordSchema, getCookie, zBp, zOptStr, pageParams,
} from '../lib';
import { ALL_PERMISSIONS } from '../../shared/permissions';

// ───────────── Authentification (publique) ─────────────
export const authPublic = new Hono<AppEnv>();

authPublic.post('/login', async (c) => {
  const { email, password } = await body(c, z.object({ email: z.string().trim().toLowerCase().email('Email invalide'), password: z.string().min(1).max(200) }));
  const ip = clientIp(c);
  const db = c.env.DB;
  // Protection contre les tentatives abusives : 5 échecs / 15 min par email, 20 par IP
  const fails = await first<{ byEmail: number; byIp: number }>(
    db,
    `SELECT (SELECT COUNT(*) FROM login_attempts WHERE email = ? AND success = 0 AND created_at > datetime('now','-15 minutes')) AS byEmail,
            (SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > datetime('now','-15 minutes')) AS byIp`,
    email,
    ip,
  );
  if ((fails?.byEmail ?? 0) >= 5 || (fails?.byIp ?? 0) >= 20) {
    throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Trop de tentatives échouées. Réessayez dans 15 minutes.');
  }
  const user = await first<any>(db, 'SELECT id, password_hash, is_active, full_name FROM users WHERE email = ?', email);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  const ua = c.req.header('user-agent')?.slice(0, 300) ?? null;
  if (!user || !ok || !user.is_active) {
    await run(db, 'INSERT INTO login_attempts (email, user_id, ip, user_agent, success, reason) VALUES (?,?,?,?,0,?)', email, user?.id ?? null, ip, ua, !user ? 'unknown' : !ok ? 'bad_password' : 'disabled');
    if (user && ok && !user.is_active) throw new HttpError(403, 'ACCOUNT_DISABLED', 'Ce compte est désactivé. Contactez l’administrateur.');
    throw new HttpError(401, 'BAD_CREDENTIALS', 'Email ou mot de passe incorrect.');
  }
  const token = randomToken();
  const sid = await sha256Hex(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  await tx(db, [
    db.prepare('INSERT INTO sessions (id, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)').bind(sid, user.id, ip, ua, expires),
    db.prepare('INSERT INTO login_attempts (email, user_id, ip, user_agent, success) VALUES (?,?,?,?,1)').bind(email, user.id, ip, ua),
    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).bind(user.id),
    db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
  ]);
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  c.header('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure}`);
  return c.json({ ok: true });
});

authPublic.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await run(c.env.DB, 'DELETE FROM sessions WHERE id = ?', await sha256Hex(token));
  c.header('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  return c.json({ ok: true });
});

// ───────────── Compte connecté ─────────────
export const me = new Hono<AppEnv>();
me.use('*', requireAuth);

me.get('/', async (c) => {
  const u = c.get('user');
  return c.json({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role_name,
    role_id: u.role_id,
    max_discount_bp: u.max_discount_bp,
    must_change_password: !!u.must_change_password,
    permissions: [...u.perms],
  });
});

me.post('/change-password', async (c) => {
  const u = c.get('user');
  const { current, next } = await body(c, z.object({ current: z.string().min(1), next: passwordSchema }));
  const row = await first<any>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', u.id);
  if (!row || !(await verifyPassword(current, row.password_hash))) throw new HttpError(400, 'BAD_PASSWORD', 'Mot de passe actuel incorrect.');
  const db = c.env.DB;
  await tx(db, [
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?`).bind(await hashPassword(next), u.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(u.id, u.session_id),
    auditStmt(c, 'password_change', 'users', u.id),
  ]);
  return c.json({ ok: true });
});

me.get('/sessions', async (c) => {
  const u = c.get('user');
  const rows = await all(c.env.DB, 'SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', u.id);
  return c.json(rows.map((r: any) => ({ ...r, current: r.id === u.session_id, id: r.id.slice(0, 12) })));
});

me.post('/sessions/revoke-others', async (c) => {
  const u = c.get('user');
  await run(c.env.DB, 'DELETE FROM sessions WHERE user_id = ? AND id <> ?', u.id, u.session_id);
  return c.json({ ok: true });
});

// ───────────── Utilisateurs ─────────────
export const users = new Hono<AppEnv>();
users.use('*', requireAuth, perm('users.manage'));

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  full_name: z.string().trim().min(2, 'Nom requis').max(120),
  phone: zOptStr(40),
  role_id: z.string().min(1),
  max_discount_bp: zBp.nullable().optional(),
});

users.get('/', async (c) => {
  const rows = await all(
    c.env.DB,
    `SELECT u.id, u.email, u.full_name, u.phone, u.role_id, r.label AS role_label, u.is_active, u.max_discount_bp, u.last_login_at, u.created_at, u.must_change_password
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.full_name`,
  );
  return c.json(rows);
});

users.post('/', async (c) => {
  const data = await body(c, userSchema.extend({ password: passwordSchema }));
  const db = c.env.DB;
  const id = uuid();
  await tx(db, [
    db
      .prepare('INSERT INTO users (id, email, full_name, phone, password_hash, role_id, max_discount_bp, must_change_password, created_by) VALUES (?,?,?,?,?,?,?,1,?)')
      .bind(id, data.email, data.full_name, data.phone, await hashPassword(data.password), data.role_id, data.max_discount_bp ?? null, c.get('user').id),
    auditStmt(c, 'create', 'users', id, null, { ...data, password: undefined }),
  ]);
  return c.json({ id });
});

users.put('/:id', async (c) => {
  const id = c.req.param('id');
  const data = await body(c, userSchema);
  const db = c.env.DB;
  const old = await first<any>(db, 'SELECT email, full_name, phone, role_id, max_discount_bp FROM users WHERE id = ?', id);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Utilisateur introuvable.');
  if (id === c.get('user').id && data.role_id !== old.role_id) throw new HttpError(400, 'SELF_ROLE', 'Vous ne pouvez pas modifier votre propre rôle.');
  await tx(db, [
    db
      .prepare(`UPDATE users SET email=?, full_name=?, phone=?, role_id=?, max_discount_bp=?, updated_at=datetime('now') WHERE id=?`)
      .bind(data.email, data.full_name, data.phone, data.role_id, data.max_discount_bp ?? null, id),
    ...(data.role_id !== old.role_id ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)] : []),
    auditStmt(c, data.role_id !== old.role_id ? 'role_change' : 'update', 'users', id, old, data),
  ]);
  return c.json({ ok: true });
});

users.post('/:id/reset-password', async (c) => {
  const id = c.req.param('id');
  const { password } = await body(c, z.object({ password: passwordSchema }));
  const db = c.env.DB;
  await tx(db, [
    db.prepare(`UPDATE users SET password_hash=?, must_change_password=1, updated_at=datetime('now') WHERE id=?`).bind(await hashPassword(password), id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    auditStmt(c, 'password_reset', 'users', id),
  ]);
  return c.json({ ok: true });
});

users.post('/:id/active', async (c) => {
  const id = c.req.param('id');
  const { active } = await body(c, z.object({ active: z.boolean() }));
  if (id === c.get('user').id) throw new HttpError(400, 'SELF_DISABLE', 'Vous ne pouvez pas désactiver votre propre compte.');
  const db = c.env.DB;
  await tx(db, [
    db.prepare(`UPDATE users SET is_active=?, updated_at=datetime('now') WHERE id=?`).bind(active ? 1 : 0, id),
    ...(active ? [] : [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)]),
    auditStmt(c, active ? 'enable' : 'disable', 'users', id),
  ]);
  return c.json({ ok: true });
});

users.get('/login-history', async (c) => {
  const { pageSize, offset } = pageParams(c);
  const rows = await all(
    c.env.DB,
    `SELECT l.id, l.email, u.full_name, l.ip, l.user_agent, l.success, l.reason, l.created_at FROM login_attempts l LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    pageSize,
    offset,
  );
  const total = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM login_attempts');
  return c.json({ rows, total: total?.n ?? 0 });
});

// ───────────── Rôles & permissions ─────────────
export const roles = new Hono<AppEnv>();
roles.use('*', requireAuth);

roles.get('/', async (c) => {
  need(c, 'users.manage');
  const rs = await all<any>(c.env.DB, `SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS users_count FROM roles r ORDER BY is_system DESC, label`);
  const rp = await all<any>(c.env.DB, 'SELECT role_id, permission FROM role_permissions');
  return c.json(rs.map((r) => ({ ...r, permissions: rp.filter((p) => p.role_id === r.id).map((p) => p.permission) })));
});

roles.post('/', async (c) => {
  need(c, 'users.manage');
  const data = await body(c, z.object({ label: z.string().trim().min(2).max(80), permissions: z.array(z.string()).default([]) }));
  const id = uuid();
  const db = c.env.DB;
  const permsOk = data.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p));
  await tx(db, [
    db.prepare('INSERT INTO roles (id, name, label) VALUES (?,?,?)').bind(id, 'custom-' + id.slice(0, 8), data.label),
    ...permsOk.map((p) => db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)').bind(id, p)),
    auditStmt(c, 'create', 'roles', id, null, data),
  ]);
  return c.json({ id });
});

roles.put('/:id', async (c) => {
  need(c, 'users.manage');
  const id = c.req.param('id');
  const data = await body(c, z.object({ label: z.string().trim().min(2).max(80), permissions: z.array(z.string()) }));
  const db = c.env.DB;
  const role = await first<any>(db, 'SELECT * FROM roles WHERE id = ?', id);
  if (!role) throw new HttpError(404, 'NOT_FOUND', 'Rôle introuvable.');
  let permsOk = [...new Set(data.permissions.filter((p) => (ALL_PERMISSIONS as string[]).includes(p)))];
  if (role.name === 'admin') permsOk = [...ALL_PERMISSIONS]; // le propriétaire garde un accès complet (anti-verrouillage)
  const old = await all<any>(db, 'SELECT permission FROM role_permissions WHERE role_id = ?', id);
  await tx(db, [
    db.prepare('UPDATE roles SET label = ? WHERE id = ?').bind(data.label, id),
    db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(id),
    ...permsOk.map((p) => db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?,?)').bind(id, p)),
    auditStmt(c, 'permissions_change', 'roles', id, old.map((o) => o.permission), permsOk),
  ]);
  return c.json({ ok: true });
});

roles.delete('/:id', async (c) => {
  need(c, 'users.manage');
  const id = c.req.param('id');
  const role = await first<any>(c.env.DB, 'SELECT is_system, (SELECT COUNT(*) FROM users WHERE role_id = roles.id) AS n FROM roles WHERE id = ?', id);
  if (!role) throw new HttpError(404, 'NOT_FOUND', 'Rôle introuvable.');
  if (role.is_system) throw new HttpError(400, 'SYSTEM_ROLE', 'Les rôles système ne peuvent pas être supprimés.');
  if (role.n > 0) throw new HttpError(400, 'ROLE_IN_USE', 'Ce rôle est attribué à des utilisateurs.');
  const db = c.env.DB;
  await tx(db, [db.prepare('DELETE FROM roles WHERE id = ?').bind(id), auditStmt(c, 'delete', 'roles', id)]);
  return c.json({ ok: true });
});

// ───────────── Paramètres ─────────────
export const settings = new Hono<AppEnv>();
settings.use('*', requireAuth);

const SETTING_KEYS = [
  'company_name', 'company_activity', 'company_address', 'company_city', 'company_phone', 'company_email', 'company_tax_id', 'company_rc',
  'default_vat_bp', 'vat_rates_bp', 'fiscal_stamp', 'fiscal_stamp_enabled', 'allow_negative_stock', 'block_expired_sales', 'expiry_alert_days',
  'expiry_alert_levels', 'default_max_discount_bp', 'low_rotation_days', 'invoice_footer', 'ticket_footer', 'remote_validation_enabled', 'scanner_config',
  'company_logo',
];

settings.get('/', async (c) => {
  const rows = await all<{ key: string; value: string }>(c.env.DB, 'SELECT key, value FROM settings');
  return c.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

settings.put('/', async (c) => {
  need(c, 'settings.manage');
  const data = await body(c, z.record(z.string(), z.string().max(400000)));
  const db = c.env.DB;
  const keys = Object.keys(data).filter((k) => SETTING_KEYS.includes(k) || /^export_profile_(products|customers|suppliers)$/.test(k));
  if (!keys.length) throw new HttpError(400, 'NO_KEYS', 'Aucun paramètre valide.');
  const old = await all<any>(db, `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`, ...keys);
  await tx(db, [
    ...keys.map((k) =>
      db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).bind(k, data[k]),
    ),
    auditStmt(c, 'update', 'settings', null, Object.fromEntries(old.map((o) => [o.key, o.value])), Object.fromEntries(keys.map((k) => [k, data[k]]))),
  ]);
  return c.json({ ok: true });
});

settings.get('/sequences', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM document_sequences ORDER BY doc_type')));

settings.put('/sequences/:type', async (c) => {
  need(c, 'settings.manage');
  const t = c.req.param('type');
  const d = await body(c, z.object({ prefix: z.string().trim().max(20), padding: z.number().int().min(1).max(10), reset_yearly: z.boolean(), next_number: z.number().int().min(1) }));
  const db = c.env.DB;
  const old = await first<any>(db, 'SELECT * FROM document_sequences WHERE doc_type = ?', t);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Séquence introuvable.');
  if (d.next_number < old.next_number) throw new HttpError(400, 'SEQ_BACKWARD', 'Le prochain numéro ne peut pas être inférieur au numéro actuel (unicité des documents).');
  await tx(db, [
    db.prepare('UPDATE document_sequences SET prefix=?, padding=?, reset_yearly=?, next_number=? WHERE doc_type=?').bind(d.prefix, d.padding, d.reset_yearly ? 1 : 0, d.next_number, t),
    auditStmt(c, 'update', 'document_sequences', t, old, d),
  ]);
  return c.json({ ok: true });
});

// Référentiels simples : dépôts, caisses, catégories de dépenses
const simple = (table: string, cols: string[], permission: 'settings.manage' | 'expenses.manage') => {
  const r = new Hono<AppEnv>();
  r.use('*', requireAuth);
  r.get('/', async (c) => c.json(await all(c.env.DB, `SELECT * FROM ${table} ORDER BY name`)));
  r.post('/', async (c) => {
    need(c, permission);
    const d = await body(c, z.object({ name: z.string().trim().min(1).max(120) }).passthrough());
    const id = uuid();
    const vals = cols.map((k) => (d as any)[k] ?? null);
    const db = c.env.DB;
    await tx(db, [
      db.prepare(`INSERT INTO ${table} (id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`).bind(id, ...vals),
      auditStmt(c, 'create', table, id, null, d),
    ]);
    return c.json({ id });
  });
  r.put('/:id', async (c) => {
    need(c, permission);
    const d = await body(c, z.object({ name: z.string().trim().min(1).max(120) }).passthrough());
    const db = c.env.DB;
    await tx(db, [
      db.prepare(`UPDATE ${table} SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((k) => (d as any)[k] ?? null), c.req.param('id')),
      auditStmt(c, 'update', table, c.req.param('id'), null, d),
    ]);
    return c.json({ ok: true });
  });
  return r;
};
export const warehouses = simple('warehouses', ['name', 'address'], 'settings.manage');
export const registers = simple('cash_registers', ['name', 'warehouse_id'], 'settings.manage');
export const expenseCategories = simple('expense_categories', ['name'], 'expenses.manage');
