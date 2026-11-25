import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, HttpError, all, first, tx, uuid, body, perm, auditStmt, requireAuth, stockMoveStmts, defaultWarehouse, run, nowSql } from '../lib';
import { parseMoney, parsePercent } from '../../shared/money';
import { analyzeBarcode } from '../../shared/barcode';

// ───────────── Importation (assistant Excel / CSV) ─────────────
export const importer = new Hono<AppEnv>();
importer.use('*', requireAuth, perm('import.manage'));

const ENTITIES = ['products', 'customers', 'suppliers'] as const;
type Entity = (typeof ENTITIES)[number];

const reqSchema = z.object({
  entity: z.enum(ENTITIES),
  mode: z.enum(['insert', 'upsert']).default('insert'), // upsert = mise à jour des existants (confirmation explicite côté interface)
  dry_run: z.boolean().default(true),
  file_name: z.string().max(200).optional(),
  rows: z.array(z.record(z.string(), z.any())).min(1).max(5000),
});

const str = (v: any) => (v === null || v === undefined ? '' : String(v).trim());
const money = (v: any, field: string, errors: string[]) => {
  if (str(v) === '') return null;
  const m = parseMoney(str(v));
  if (m === null || m < 0) errors.push(`${field} invalide (« ${str(v)} »)`);
  return m;
};
const int = (v: any, field: string, errors: string[]) => {
  if (str(v) === '') return null;
  const n = Number(str(v).replace(',', '.'));
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    errors.push(`${field} doit être un nombre entier (« ${str(v)} »)`);
    return null;
  }
  return n;
};
const vat = (v: any, errors: string[]) => {
  if (str(v) === '') return null;
  const s = str(v).replace('%', '');
  const bp = parsePercent(Number(s) > 0 && Number(s) < 1 ? String(Number(s) * 100) : s);
  if (bp === null || bp < 0 || bp > 10000) errors.push(`TVA invalide (« ${str(v)} »)`);
  return bp;
};
const CUSTOMER_TYPES: Record<string, string> = { particulier: 'particulier', detaillant: 'detaillant', détaillant: 'detaillant', grossiste: 'grossiste', distributeur: 'distributeur' };

interface Analysed {
  row: number;
  errors: string[];
  warnings: string[];
  action: 'insert' | 'update' | 'skip';
  existing_id?: string;
  data: any;
}

async function analyse(db: D1Database, entity: Entity, rows: Record<string, any>[], mode: 'insert' | 'upsert'): Promise<Analysed[]> {
  const out: Analysed[] = [];
  const seenKeys = new Set<string>();
  const seenBarcodes = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const errors: string[] = [];
    const warnings: string[] = [];
    let data: any = {};
    let existing: any = null;
    if (entity === 'products') {
      data = {
        reference: str(r.reference),
        name: str(r.name),
        barcode: r.barcode !== undefined && str(r.barcode) !== '' ? analyzeBarcode(str(r.barcode)).code : '',
        category: str(r.category),
        brand: str(r.brand),
        supplier: str(r.supplier),
        purchase_price: money(r.purchase_price, "Prix d'achat", errors) ?? 0,
        sale_price: money(r.sale_price, 'Prix de vente', errors),
        price_retail: money(r.price_retail, 'Prix détaillant', errors),
        price_wholesale: money(r.price_wholesale, 'Prix grossiste', errors),
        price_distributor: money(r.price_distributor, 'Prix distributeur', errors),
        vat_bp: vat(r.vat, errors),
        unit: str(r.unit) || 'pièce',
        min_stock: int(r.min_stock, 'Stock minimum', errors) ?? 0,
        initial_stock: int(r.initial_stock, 'Stock initial', errors),
        units_per_carton: int(r.units_per_carton, 'Pièces par carton', errors),
        legacy_id: str(r.legacy_id) || null,
        description: str(r.description) || null,
      };
      if (!data.name) errors.push('Désignation manquante');
      if (data.sale_price === null) errors.push('Prix de vente manquant');
      if (data.initial_stock !== null && data.initial_stock < 0) errors.push('Stock initial négatif');
      if (data.barcode) {
        const info = analyzeBarcode(data.barcode);
        if (info.checksumValid === false) warnings.push(`Clé de contrôle ${info.format} invalide pour ${data.barcode}`);
        if (seenBarcodes.has(data.barcode)) errors.push(`Code-barres ${data.barcode} en double dans le fichier`);
        seenBarcodes.add(data.barcode);
      }
      const key = data.reference || data.legacy_id || '';
      if (key) {
        if (seenKeys.has(key)) errors.push(`Référence ${key} en double dans le fichier`);
        seenKeys.add(key);
        existing = await first<any>(db, 'SELECT id, name FROM products WHERE reference = ? OR (legacy_id IS NOT NULL AND legacy_id = ?)', data.reference || '\u0000', data.legacy_id ?? '\u0000');
      }
      if (data.barcode) {
        const bc = await first<any>(db, 'SELECT p.id, p.name, p.reference FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.barcode = ?', data.barcode);
        if (bc && bc.id !== existing?.id) {
          if (!existing && mode === 'upsert') existing = bc;
          else if (!existing) errors.push(`Code-barres ${data.barcode} déjà utilisé par « ${bc.name} » (${bc.reference})`);
        }
      }
    } else {
      const isCust = entity === 'customers';
      data = {
        code: str(r.code),
        name: str(r.name),
        phone: str(r.phone) || null,
        email: str(r.email) || null,
        address: str(r.address) || null,
        tax_id: str(r.tax_id) || null,
        opening_balance: str(r.opening_balance) === '' ? 0 : parseMoney(str(r.opening_balance)),
        payment_terms_days: int(r.payment_terms_days, 'Délai de paiement', errors) ?? 0,
        legacy_id: str(r.legacy_id) || null,
      };
      if (data.opening_balance === null) errors.push(`Solde initial invalide (« ${str(r.opening_balance)} »)`);
      if (isCust) {
        const t = CUSTOMER_TYPES[str(r.type).toLowerCase()] ?? 'particulier';
        if (str(r.type) && !CUSTOMER_TYPES[str(r.type).toLowerCase()]) warnings.push(`Type « ${str(r.type)} » inconnu → particulier`);
        data.type = t;
        data.credit_limit = money(r.credit_limit, 'Plafond de crédit', errors) ?? 0;
      } else {
        data.contact_name = str(r.contact_name) || null;
      }
      if (!data.name) errors.push('Nom manquant');
      if (data.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) warnings.push('Email invalide ignoré'), (data.email = null);
      const key = data.code || data.legacy_id;
      if (key) {
        if (seenKeys.has(key)) errors.push(`Code ${key} en double dans le fichier`);
        seenKeys.add(key);
        existing = await first<any>(db, `SELECT id, name FROM ${entity} WHERE code = ? OR (legacy_id IS NOT NULL AND legacy_id = ?)`, data.code || '\u0000', data.legacy_id ?? '\u0000');
      }
      if (!existing && data.name) {
        const sameName = await first<any>(db, `SELECT id, code FROM ${entity} WHERE name = ? COLLATE NOCASE`, data.name);
        if (sameName) warnings.push(`Un enregistrement porte déjà ce nom (${sameName.code}) : doublon possible`);
      }
    }
    const action: Analysed['action'] = errors.length ? 'skip' : existing ? (mode === 'upsert' ? 'update' : 'skip') : 'insert';
    if (existing && mode === 'insert' && !errors.length) warnings.push(`Existe déjà (${existing.name}) → ignoré (mode ajout uniquement)`);
    out.push({ row: i + 2, errors, warnings, action, existing_id: existing?.id, data });
  }
  return out;
}

async function refId(db: D1Database, table: 'categories' | 'brands', name: string, cache: Map<string, string>, stmts: D1PreparedStatement[]) {
  if (!name) return null;
  const k = name.toLowerCase();
  if (cache.has(k)) return cache.get(k)!;
  const ex = await first<any>(db, `SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE ${table === 'categories' ? 'AND parent_id IS NULL' : ''}`, name);
  const id = ex?.id ?? uuid();
  if (!ex) stmts.push(db.prepare(`INSERT INTO ${table} (id, name) VALUES (?, ?)`).bind(id, name));
  cache.set(k, id);
  return id;
}

importer.post('/', async (c) => {
  const d = await body(c, reqSchema);
  const db = c.env.DB;
  const u = c.get('user');
  const analysed = await analyse(db, d.entity, d.rows, d.mode);
  const summary = {
    total: analysed.length,
    insert: analysed.filter((a) => a.action === 'insert').length,
    update: analysed.filter((a) => a.action === 'update').length,
    skip: analysed.filter((a) => a.action === 'skip').length,
    errors: analysed.filter((a) => a.errors.length).length,
    warnings: analysed.filter((a) => a.warnings.length).length,
  };
  if (d.dry_run) return c.json({ summary, rows: analysed });

  const jobId = uuid();
  const wh = await defaultWarehouse(db);
  const catCache = new Map<string, string>();
  const brandCache = new Map<string, string>();
  const supCache = new Map<string, string | null>();
  let ok = 0;
  const failures: { row: number; message: string }[] = [];
  for (const a of analysed) {
    if (a.action === 'skip') {
      if (a.errors.length) failures.push({ row: a.row, message: a.errors.join(' ; ') });
      continue;
    }
    const stmts: D1PreparedStatement[] = [];
    const x = a.data;
    try {
      if (d.entity === 'products') {
        const catId = await refId(db, 'categories', x.category, catCache, stmts);
        const brandId = await refId(db, 'brands', x.brand, brandCache, stmts);
        let supId: string | null = null;
        if (x.supplier) {
          if (!supCache.has(x.supplier)) {
            const s = await first<any>(db, 'SELECT id FROM suppliers WHERE code = ? OR name = ? COLLATE NOCASE', x.supplier, x.supplier);
            supCache.set(x.supplier, s?.id ?? null);
          }
          supId = supCache.get(x.supplier) ?? null;
        }
        if (a.action === 'insert') {
          const id = uuid();
          const ref = x.reference || 'P' + Date.now().toString(36).toUpperCase().slice(-6) + a.row;
          stmts.push(
            db
              .prepare(
                `INSERT INTO products (id, reference, name, description, category_id, brand_id, supplier_id, purchase_price, avg_cost, sale_price, price_retail, price_wholesale, price_distributor,
                   vat_bp, unit, min_stock, units_per_carton, legacy_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              )
              .bind(id, ref, x.name, x.description, catId, brandId, supId, x.purchase_price, x.purchase_price, x.sale_price, x.price_retail, x.price_wholesale, x.price_distributor, x.vat_bp ?? 1900, x.unit, x.min_stock, x.units_per_carton, x.legacy_id, u.id),
          );
          if (x.barcode) stmts.push(db.prepare('INSERT INTO product_barcodes (id, product_id, barcode, is_primary) VALUES (?,?,?,1)').bind(uuid(), id, x.barcode));
          if (x.initial_stock && x.initial_stock > 0) {
            stmts.push(...stockMoveStmts(db, { product_id: id, warehouse_id: wh, type: 'initial', qty: x.initial_stock, unit_cost: x.purchase_price, doc_type: 'import', doc_id: jobId, reason: 'Import stock initial', user_id: u.id }));
          }
        } else {
          // mise à jour confirmée : le stock n'est JAMAIS écrasé par un import (passer par un inventaire)
          const old = await first<any>(db, 'SELECT * FROM products WHERE id = ?', a.existing_id);
          stmts.push(
            db
              .prepare(
                `UPDATE products SET name=?, description=COALESCE(?, description), category_id=COALESCE(?, category_id), brand_id=COALESCE(?, brand_id), supplier_id=COALESCE(?, supplier_id),
                   purchase_price=?, sale_price=?, price_retail=COALESCE(?, price_retail), price_wholesale=COALESCE(?, price_wholesale), price_distributor=COALESCE(?, price_distributor),
                   vat_bp=COALESCE(?, vat_bp), unit=?, min_stock=?, legacy_id=COALESCE(?, legacy_id), updated_at=datetime('now') WHERE id=?`,
              )
              .bind(x.name, x.description, catId, brandId, supId, x.purchase_price || old.purchase_price, x.sale_price, x.price_retail, x.price_wholesale, x.price_distributor, x.vat_bp, x.unit, x.min_stock, x.legacy_id, a.existing_id),
          );
          for (const f of ['purchase_price', 'sale_price'] as const) {
            const nv = f === 'purchase_price' ? x.purchase_price || old.purchase_price : x.sale_price;
            if (nv !== old[f]) stmts.push(db.prepare('INSERT INTO product_price_history (product_id, field, old_value, new_value, user_id, reason) VALUES (?,?,?,?,?,?)').bind(a.existing_id, f, old[f], nv, u.id, 'Import ' + (d.file_name ?? '')));
          }
          if (x.barcode) stmts.push(db.prepare('INSERT OR IGNORE INTO product_barcodes (id, product_id, barcode, is_primary) VALUES (?,?,?,0)').bind(uuid(), a.existing_id, x.barcode));
        }
      } else {
        const t = d.entity;
        const isCust = t === 'customers';
        if (a.action === 'insert') {
          const code = x.code || (isCust ? 'C' : 'F') + 'I' + Date.now().toString(36).toUpperCase().slice(-5) + a.row;
          stmts.push(
            isCust
              ? db
                  .prepare('INSERT INTO customers (id, code, name, type, phone, email, address, tax_id, credit_limit, opening_balance, payment_terms_days, legacy_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
                  .bind(uuid(), code, x.name, x.type, x.phone, x.email, x.address, x.tax_id, x.credit_limit, x.opening_balance, x.payment_terms_days, x.legacy_id, u.id)
              : db
                  .prepare('INSERT INTO suppliers (id, code, name, contact_name, phone, email, address, tax_id, opening_balance, payment_terms_days, legacy_id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                  .bind(uuid(), code, x.name, x.contact_name, x.phone, x.email, x.address, x.tax_id, x.opening_balance, x.payment_terms_days, x.legacy_id, u.id),
          );
        } else {
          stmts.push(
            db
              .prepare(`UPDATE ${t} SET name=?, phone=COALESCE(?, phone), email=COALESCE(?, email), address=COALESCE(?, address), tax_id=COALESCE(?, tax_id), opening_balance=?, payment_terms_days=?, updated_at=datetime('now') WHERE id=?`)
              .bind(x.name, x.phone, x.email, x.address, x.tax_id, x.opening_balance, x.payment_terms_days, a.existing_id),
          );
        }
      }
      await tx(db, stmts); // chaque ligne est atomique ; une ligne en erreur n'affecte pas les autres
      ok++;
    } catch (e: any) {
      failures.push({ row: a.row, message: e?.message ?? String(e) });
    }
  }
  const jobStmts: D1PreparedStatement[] = [
    db
      .prepare('INSERT INTO import_jobs (id, entity, file_name, mode, total_rows, inserted, updated, skipped, errors_count, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(jobId, d.entity, d.file_name ?? null, d.mode, analysed.length, analysed.filter((a) => a.action === 'insert').length, analysed.filter((a) => a.action === 'update').length, summary.skip, failures.length, u.id),
    ...failures.slice(0, 500).map((f) => db.prepare('INSERT INTO import_errors (job_id, row_num, message) VALUES (?,?,?)').bind(jobId, f.row, f.message.slice(0, 500))),
    db
      .prepare(`INSERT INTO notifications (id, dedupe_key, type, severity, title, message, link, permission) VALUES (?,?,?,?,?,?,?,?)`)
      .bind(uuid(), 'import-' + jobId, 'import_done', failures.length ? 'warning' : 'success', 'Importation terminée', `${ok} ligne(s) importée(s), ${failures.length} erreur(s) — ${d.entity}`, '/import', 'import.manage'),
    auditStmt(c, 'import', d.entity, jobId, null, { file: d.file_name, mode: d.mode, ok, failures: failures.length }),
  ];
  for (let i = 0; i < jobStmts.length; i += 100) await tx(db, jobStmts.slice(i, i + 100));
  return c.json({ job_id: jobId, imported: ok, failures, summary });
});

importer.get('/jobs', async (c) =>
  c.json(await all(c.env.DB, 'SELECT j.*, u.full_name AS created_by_name FROM import_jobs j LEFT JOIN users u ON u.id = j.created_by ORDER BY j.created_at DESC LIMIT 100')),
);
importer.get('/jobs/:id/errors', async (c) => c.json(await all(c.env.DB, 'SELECT * FROM import_errors WHERE job_id = ? ORDER BY row_num', c.req.param('id'))));

// ───────────── Sauvegarde ─────────────
export const backup = new Hono<AppEnv>();
backup.use('*', requireAuth, perm('backup.manage'));

const BACKUP_TABLES = [
  'settings', 'document_sequences', 'roles', 'role_permissions', 'users', 'categories', 'brands', 'warehouses', 'suppliers', 'customers', 'products', 'product_barcodes',
  'customer_prices', 'product_price_history', 'discount_rules', 'stock_balances', 'product_batches', 'stock_movements', 'inventories', 'inventory_items', 'purchase_orders',
  'purchase_order_items', 'goods_receipts', 'goods_receipt_items', 'purchase_invoices', 'supplier_returns', 'supplier_return_items', 'cash_registers', 'cash_sessions',
  'cash_movements', 'sales', 'sale_items', 'held_sales', 'quotations', 'quotation_items', 'invoices', 'invoice_validations', 'credit_notes', 'credit_note_items', 'payments',
  'payment_allocations', 'expense_categories', 'expenses', 'notifications', 'import_jobs', 'import_errors', 'audit_logs',
];

backup.get('/info', async (c) => {
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM ${t}`))?.n ?? 0;
  const last = await first<any>(c.env.DB, `SELECT value FROM settings WHERE key = 'last_backup_at'`);
  return c.json({ counts, last_backup_at: last?.value ?? null });
});

/** Export JSON complet (hors sessions). La restauration de référence se fait via D1 Time Travel (voir documentation). */
backup.get('/download', async (c) => {
  const db = c.env.DB;
  const data: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    data[t] = await all(db, `SELECT * FROM ${t}`);
  }
  await tx(db, [
    db.prepare(`INSERT INTO settings (key, value) VALUES ('last_backup_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(nowSql()),
    auditStmt(c, 'backup_download', 'backup', null),
  ]);
  return new Response(JSON.stringify({ app: 'nour-de-commerce-erp', version: 1, created_at: nowSql(), data }), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="sauvegarde-nour-de-commerce-${nowSql().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
});

void run;
void HttpError;
