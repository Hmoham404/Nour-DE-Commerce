import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { Permission } from '../shared/permissions';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export interface AppUser {
  id: string;
  email: string;
  full_name: string;
  role_id: string;
  role_name: string;
  max_discount_bp: number | null;
  must_change_password: number;
  perms: Set<string>;
  session_id: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: AppUser } };
export type Ctx = Context<AppEnv>;

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const uuid = () => crypto.randomUUID();

export function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ───────────── D1 helpers ─────────────
export async function all<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}
export async function first<T = any>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}
export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

/** Exécute une liste d'instructions dans UNE transaction atomique (D1 batch = tout ou rien). */
export async function tx(db: D1Database, stmts: D1PreparedStatement[]) {
  if (!stmts.length) return [];
  try {
    return await db.batch(stmts);
  } catch (e) {
    throw translateDbError(e);
  }
}

export function translateDbError(e: unknown): Error {
  const msg = String((e as any)?.message ?? e);
  if (e instanceof HttpError) return e;
  if (msg.includes('STOCK_INSUFFISANT')) return new HttpError(409, 'STOCK_INSUFFISANT', 'Stock insuffisant pour au moins un produit. Opération annulée.');
  if (msg.includes('CAISSE_FERMEE')) return new HttpError(409, 'CAISSE_FERMEE', 'La session de caisse est fermée.');
  if (msg.includes('CASH_IMMUTABLE')) return new HttpError(409, 'CASH_IMMUTABLE', 'Une opération de caisse validée ne peut pas être modifiée : utilisez une contre-opération.');
  if (msg.includes('AUDIT_IMMUTABLE')) return new HttpError(403, 'AUDIT_IMMUTABLE', "Le journal d'audit est protégé.");
  if (msg.includes('product_barcodes.barcode')) return new HttpError(409, 'BARCODE_DUPLICATE', 'Ce code-barres est déjà attribué à un autre produit.');
  if (msg.includes('products.reference')) return new HttpError(409, 'REFERENCE_DUPLICATE', 'Cette référence produit existe déjà.');
  if (msg.includes('customers.code') || msg.includes('suppliers.code')) return new HttpError(409, 'CODE_DUPLICATE', 'Ce code existe déjà.');
  if (msg.includes('users.email')) return new HttpError(409, 'EMAIL_DUPLICATE', 'Cet email est déjà utilisé.');
  if (msg.includes('idx_one_open_session')) return new HttpError(409, 'SESSION_ALREADY_OPEN', 'Une session de caisse est déjà ouverte (pour cette caisse ou cet utilisateur).');
  if (msg.includes('purchase_invoices.receipt_id')) return new HttpError(409, 'RECEIPT_ALREADY_INVOICED', 'Cette réception est déjà facturée.');
  if (msg.includes('remaining_qty')) return new HttpError(409, 'LOT_INSUFFISANT', 'Quantité insuffisante dans le lot. Réessayez.');
  if (msg.includes('returned_qty')) return new HttpError(409, 'RETOUR_EXCESSIF', 'La quantité retournée dépasse la quantité vendue.');
  if (msg.includes('amount_paid')) return new HttpError(409, 'PAIEMENT_EXCESSIF', 'Le montant réglé dépasse le montant dû.');
  if (msg.includes('UNIQUE constraint failed')) return new HttpError(409, 'DUPLICATE', 'Un enregistrement identique existe déjà.');
  if (msg.includes('FOREIGN KEY constraint failed')) return new HttpError(409, 'FK', 'Élément lié introuvable ou encore utilisé ailleurs.');
  if (msg.includes('CHECK constraint failed')) return new HttpError(400, 'CHECK', 'Valeur invalide : ' + msg.split('CHECK constraint failed:').pop()?.trim());
  return e instanceof Error ? e : new Error(msg);
}

// ───────────── Numérotation atomique des documents ─────────────
/** Instructions à placer EN TÊTE de batch pour réserver un numéro (avec remise à zéro annuelle). */
export function seqReserve(db: D1Database, docType: string): D1PreparedStatement[] {
  const year = Number(new Date().toISOString().slice(0, 4));
  return [
    db.prepare(`UPDATE document_sequences SET next_number = 1, year = ? WHERE doc_type = ? AND reset_yearly = 1 AND year <> ?`).bind(year, docType, year),
    db.prepare(`UPDATE document_sequences SET next_number = next_number + 1 WHERE doc_type = ?`).bind(docType),
  ];
}
/** Expression SQL (sous-requête) donnant le numéro réservé. docType est une constante interne. */
export function seqExpr(docType: string): string {
  if (!/^[A-Z_]+$/.test(docType)) throw new Error('docType invalide');
  return `(SELECT prefix || CASE WHEN reset_yearly = 1 THEN year || '-' ELSE '' END || substr('0000000000' || (next_number - 1), -padding, padding) FROM document_sequences WHERE doc_type = '${docType}')`;
}

// ───────────── Paramètres ─────────────
export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
export async function getSetting(db: D1Database, key: string, fallback = ''): Promise<string> {
  const r = await first<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? fallback;
}

// ───────────── Audit ─────────────
export function auditStmt(
  c: Ctx,
  action: string,
  entity: string,
  entityId: string | null,
  oldValue?: unknown,
  newValue?: unknown,
  reason?: string | null,
): D1PreparedStatement {
  const u = c.get('user');
  const clean = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(redact(v)).slice(0, 20000));
  return c.env.DB.prepare(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, old_value, new_value, reason, ip) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(u?.id ?? null, u?.full_name ?? null, action, entity, entityId, clean(oldValue), clean(newValue), reason ?? null, clientIp(c));
}
function redact(v: any): any {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(redact);
  const out: any = {};
  for (const [k, val] of Object.entries(v)) {
    if (/password|token|secret|hash/i.test(k)) continue;
    out[k] = typeof val === 'string' && val.startsWith('data:image') ? '[image]' : redact(val);
  }
  return out;
}

export function clientIp(c: Ctx): string | null {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
}

// ───────────── Crypto ─────────────
const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PBKDF2_ITER = 100000;
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return `pbkdf2$${PBKDF2_ITER}$${b64(salt)}$${b64(bits)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltB64, hashB64] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: Number(iterStr) }, key, 256),
  );
  const expected = unb64(hashB64);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Le mot de passe doit contenir des lettres et des chiffres');

// ───────────── Sessions / authentification ─────────────
export const SESSION_COOKIE = 'ndc_session';
export const SESSION_DAYS = 7;

export function getCookie(c: Ctx, name: string): string | null {
  const raw = c.req.header('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function loadUserFromSession(c: Ctx): Promise<AppUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const sid = await sha256Hex(token);
  const row = await first<any>(
    c.env.DB,
    `SELECT s.id AS session_id, s.expires_at, s.last_seen_at, u.id, u.email, u.full_name, u.role_id, u.is_active, u.max_discount_bp,
            u.must_change_password, r.name AS role_name
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN roles r ON r.id = u.role_id WHERE s.id = ?`,
    sid,
  );
  if (!row || !row.is_active || row.expires_at < nowSql()) return null;
  const perms = await all<{ permission: string }>(c.env.DB, 'SELECT permission FROM role_permissions WHERE role_id = ?', row.role_id);
  // rafraîchissement glissant de l'activité (au plus toutes les 5 min)
  if (Date.now() - Date.parse(row.last_seen_at.replace(' ', 'T') + 'Z') > 5 * 60000) {
    c.executionCtx.waitUntil(run(c.env.DB, `UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`, sid));
  }
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_id: row.role_id,
    role_name: row.role_name,
    max_discount_bp: row.max_discount_bp,
    must_change_password: row.must_change_password,
    perms: new Set(perms.map((p) => p.permission)),
    session_id: sid,
  };
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await loadUserFromSession(c);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'Session expirée. Veuillez vous reconnecter.');
  c.set('user', user);
  await next();
};

export function can(c: Ctx, perm: Permission): boolean {
  return c.get('user').perms.has(perm);
}
export function need(c: Ctx, ...perms: Permission[]) {
  if (!perms.some((p) => can(c, p))) throw new HttpError(403, 'FORBIDDEN', "Vous n'avez pas l'autorisation pour cette action.");
}
export const perm =
  (...perms: Permission[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    need(c, ...perms);
    await next();
  };

// ───────────── Validation ─────────────
export async function body<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HttpError(400, 'BAD_JSON', 'Requête invalide.');
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, 'VALIDATION', `${issue.path.join('.') || 'champ'} : ${issue.message}`, r.error.issues);
  }
  return r.data;
}

export const zMoney = z.number().int().min(0).max(1e12);
export const zSignedMoney = z.number().int().min(-1e12).max(1e12);
export const zBp = z.number().int().min(0).max(10000);
export const zQty = z.number().int().min(1).max(1e9);
export const zId = z.string().min(1).max(64);
export const zOptStr = (max = 500) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date invalide (AAAA-MM-JJ)');

/** Pagination & recherche standard. */
export function pageParams(c: Ctx) {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query('pageSize') ?? 25) || 25));
  const q = (c.req.query('q') ?? '').trim();
  return { page, pageSize, offset: (page - 1) * pageSize, q, like: `%${q.replace(/[%_]/g, '')}%` };
}

export function dateRange(c: Ctx): { from: string; to: string; fromUtc: string; toUtc: string } {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('from') ?? '') ? c.req.query('from')! : today.slice(0, 8) + '01';
  const to = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('to') ?? '') ? c.req.query('to')! : today;
  const fromUtc = new Date(`${from}T00:00:00+01:00`).toISOString().slice(0, 19).replace('T', ' ');
  const toUtc = new Date(`${to}T23:59:59+01:00`).toISOString().slice(0, 19).replace('T', ' ');
  return { from, to, fromUtc, toUtc };
}

/** Mise à jour de stock + mouvement, à insérer dans un batch (stock avant/après calculés atomiquement). */
export function stockMoveStmts(
  db: D1Database,
  m: {
    product_id: string;
    warehouse_id: string;
    type: string;
    qty: number; // signé
    unit_cost?: number;
    batch_id?: string | null;
    doc_type?: string | null;
    doc_id?: string | null;
    doc_number_sql?: string | null; // expression SQL ou null
    doc_number?: string | null;
    reason?: string | null;
    user_id: string;
  },
): D1PreparedStatement[] {
  const numberExpr = m.doc_number_sql ?? '?';
  const numberParams = m.doc_number_sql ? [] : [m.doc_number ?? null];
  return [
    db.prepare(`INSERT OR IGNORE INTO stock_balances (product_id, warehouse_id, quantity) VALUES (?, ?, 0)`).bind(m.product_id, m.warehouse_id),
    db
      .prepare(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, stock_before, stock_after, unit_cost, batch_id, doc_type, doc_id, doc_number, reason, user_id)
         SELECT ?, ?, ?, ?, quantity, quantity + ?, ?, ?, ?, ?, ${numberExpr}, ?, ? FROM stock_balances WHERE product_id = ? AND warehouse_id = ?`,
      )
      .bind(
        m.product_id,
        m.warehouse_id,
        m.type,
        m.qty,
        m.qty,
        m.unit_cost ?? 0,
        m.batch_id ?? null,
        m.doc_type ?? null,
        m.doc_id ?? null,
        ...numberParams,
        m.reason ?? null,
        m.user_id,
        m.product_id,
        m.warehouse_id,
      ),
    db
      .prepare(`UPDATE stock_balances SET quantity = quantity + ?, updated_at = datetime('now') WHERE product_id = ? AND warehouse_id = ?`)
      .bind(m.qty, m.product_id, m.warehouse_id),
  ];
}

export async function defaultWarehouse(db: D1Database): Promise<string> {
  const w = await first<{ id: string }>(db, 'SELECT id FROM warehouses WHERE is_default = 1 AND is_active = 1 LIMIT 1');
  if (!w) throw new HttpError(500, 'NO_WAREHOUSE', 'Aucun dépôt par défaut configuré.');
  return w.id;
}

export async function openSessionFor(db: D1Database, userId: string) {
  return first<{ id: string; register_id: string; number: string }>(db, `SELECT id, register_id, number FROM cash_sessions WHERE user_id = ? AND status = 'open'`, userId);
}

/** Masque les champs financiers sensibles si l'utilisateur n'a pas finance.view. */
export function maskFinance<T extends Record<string, any>>(c: Ctx, rows: T[], fields = ['avg_cost', 'purchase_price', 'unit_cost', 'cost_total', 'margin']): T[] {
  if (can(c, 'finance.view')) return rows;
  return rows.map((r) => {
    const o: any = { ...r };
    for (const f of fields) if (f in o) o[f] = null;
    return o;
  });
}
