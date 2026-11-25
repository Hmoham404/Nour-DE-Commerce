-- Nour de Commerce ERP — schéma initial (Cloudflare D1 / SQLite)
-- Conventions :
--   * Identifiants : TEXT UUID (crypto.randomUUID) sauf journaux (INTEGER autoincrément).
--   * Montants : INTEGER en millimes (1 TND = 1000 millimes) → aucun calcul flottant.
--   * Taux (TVA, remises) : INTEGER en points de base (1900 = 19,00 %).
--   * Quantités : INTEGER dans l'unité de base du produit.
--   * Dates : TEXT 'YYYY-MM-DD HH:MM:SS' en UTC (affichage Africa/Tunis).
--   * Codes-barres : TEXT (zéros initiaux conservés).

PRAGMA foreign_keys = ON;

-- ───────────── Paramètres & numérotation ─────────────
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE document_sequences (
  doc_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding INTEGER NOT NULL DEFAULT 5 CHECK (padding BETWEEN 1 AND 10),
  reset_yearly INTEGER NOT NULL DEFAULT 1,
  year INTEGER NOT NULL DEFAULT (CAST(strftime('%Y','now') AS INTEGER))
);

-- ───────────── Utilisateurs, rôles, sessions ─────────────
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  max_discount_bp INTEGER,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- SHA-256 du jeton (le jeton brut n'est jamais stocké)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT,
  user_id TEXT,
  ip TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, created_at);

-- ───────────── Journal d'audit (protégé) ─────────────
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_audit_entity ON audit_logs(entity, entity_id);
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_logs_no_delete BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;

-- ───────────── Référentiels ─────────────
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES categories(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_categories_name ON categories(name, COALESCE(parent_id, ''));

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  address TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── Tiers ─────────────
CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  legacy_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_suppliers_name ON suppliers(name);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'particulier' CHECK (type IN ('particulier','detaillant','grossiste','distributeur')),
  price_tier TEXT CHECK (price_tier IS NULL OR price_tier IN ('particulier','detaillant','grossiste','distributeur')),
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0,       -- 0 = pas de crédit autorisé
  opening_balance INTEGER NOT NULL DEFAULT 0,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  legacy_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_phone ON customers(phone);

-- ───────────── Produits ─────────────
CREATE TABLE products (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  category_id TEXT REFERENCES categories(id),
  brand_id TEXT REFERENCES brands(id),
  supplier_id TEXT REFERENCES suppliers(id),
  purchase_price INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),   -- dernier prix d'achat HT
  avg_cost INTEGER NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),               -- coût moyen pondéré HT
  sale_price INTEGER NOT NULL DEFAULT 0 CHECK (sale_price >= 0),           -- prix particulier HT
  price_retail INTEGER CHECK (price_retail IS NULL OR price_retail >= 0),  -- détaillant HT
  price_wholesale INTEGER CHECK (price_wholesale IS NULL OR price_wholesale >= 0), -- grossiste HT
  price_distributor INTEGER CHECK (price_distributor IS NULL OR price_distributor >= 0),
  vat_bp INTEGER NOT NULL DEFAULT 1900 CHECK (vat_bp BETWEEN 0 AND 10000),
  unit TEXT NOT NULL DEFAULT 'pièce',
  packaging TEXT,
  units_per_carton INTEGER CHECK (units_per_carton IS NULL OR units_per_carton > 0),
  min_stock INTEGER NOT NULL DEFAULT 0,
  max_stock INTEGER,
  track_batches INTEGER NOT NULL DEFAULT 0,
  photo TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  legacy_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_supplier ON products(supplier_id);

CREATE TABLE product_barcodes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL,
  packaging TEXT NOT NULL DEFAULT 'piece',  -- piece | pack | carton
  qty_per_unit INTEGER NOT NULL DEFAULT 1 CHECK (qty_per_unit > 0),
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_barcodes_unique ON product_barcodes(barcode);
CREATE INDEX idx_barcodes_product ON product_barcodes(product_id);

CREATE TABLE customer_prices (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price_ht INTEGER NOT NULL CHECK (price_ht >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TABLE product_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value INTEGER,
  new_value INTEGER,
  reason TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_price_history_product ON product_price_history(product_id, created_at);

CREATE TABLE discount_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  product_id TEXT REFERENCES products(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  customer_type TEXT,
  min_qty INTEGER NOT NULL DEFAULT 0,
  min_amount INTEGER NOT NULL DEFAULT 0,
  discount_bp INTEGER NOT NULL CHECK (discount_bp BETWEEN 0 AND 10000),
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ───────────── Stocks ─────────────
CREATE TABLE stock_balances (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (product_id, warehouse_id)
);

-- Interdiction des stocks négatifs (sauf si le paramètre allow_negative_stock = '1')
CREATE TRIGGER stock_no_negative_update BEFORE UPDATE OF quantity ON stock_balances
WHEN NEW.quantity < 0 AND COALESCE((SELECT value FROM settings WHERE key = 'allow_negative_stock'), '0') <> '1'
BEGIN SELECT RAISE(ABORT, 'STOCK_INSUFFISANT'); END;
CREATE TRIGGER stock_no_negative_insert BEFORE INSERT ON stock_balances
WHEN NEW.quantity < 0 AND COALESCE((SELECT value FROM settings WHERE key = 'allow_negative_stock'), '0') <> '1'
BEGIN SELECT RAISE(ABORT, 'STOCK_INSUFFISANT'); END;

CREATE TABLE product_batches (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  batch_number TEXT NOT NULL,
  supplier_id TEXT REFERENCES suppliers(id),
  receipt_id TEXT,
  received_at TEXT NOT NULL DEFAULT (date('now')),
  manufactured_at TEXT,
  expires_at TEXT,
  initial_qty INTEGER NOT NULL CHECK (initial_qty >= 0),
  remaining_qty INTEGER NOT NULL CHECK (remaining_qty >= 0),
  unit_cost INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_batches_product ON product_batches(product_id, expires_at);
CREATE INDEX idx_batches_expiry ON product_batches(expires_at) WHERE remaining_qty > 0;

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  type TEXT NOT NULL CHECK (type IN ('initial','entree_fournisseur','sortie_vente','retour_client','retour_fournisseur','ajustement_inventaire','ajustement','endommage','perime','transfert_entree','transfert_sortie','annulation_vente')),
  quantity INTEGER NOT NULL,          -- signé : + entrée / - sortie
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  batch_id TEXT,
  doc_type TEXT,
  doc_id TEXT,
  doc_number TEXT,
  reason TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_movements_product ON stock_movements(product_id, created_at);
CREATE INDEX idx_movements_created ON stock_movements(created_at);
CREATE INDEX idx_movements_doc ON stock_movements(doc_type, doc_id);

CREATE TABLE inventories (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','validated','cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT,
  validated_by TEXT,
  validated_at TEXT
);

CREATE TABLE inventory_items (
  inventory_id TEXT NOT NULL REFERENCES inventories(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  theoretical_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER NOT NULL DEFAULT 0 CHECK (counted_qty >= 0),
  scanned_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (inventory_id, product_id)
);

-- ───────────── Achats ─────────────
CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  order_date TEXT NOT NULL DEFAULT (date('now')),
  expected_date TEXT,
  notes TEXT,
  total_ht INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE purchase_order_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty_ordered INTEGER NOT NULL CHECK (qty_ordered > 0),
  qty_received INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_price INTEGER NOT NULL DEFAULT 0,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  vat_bp INTEGER NOT NULL DEFAULT 1900
);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);

CREATE TABLE goods_receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  po_id TEXT REFERENCES purchase_orders(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  idempotency_key TEXT UNIQUE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  supplier_doc_ref TEXT,
  notes TEXT,
  total_ht INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  extra_costs INTEGER NOT NULL DEFAULT 0,
  invoiced INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receipts_supplier ON goods_receipts(supplier_id);

CREATE TABLE goods_receipt_items (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  po_item_id TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0,
  unit_price INTEGER NOT NULL DEFAULT 0,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  vat_bp INTEGER NOT NULL DEFAULT 1900,
  line_ht INTEGER NOT NULL DEFAULT 0,
  line_vat INTEGER NOT NULL DEFAULT 0,
  batch_id TEXT,
  batch_number TEXT,
  expires_at TEXT,
  CHECK (returned_qty <= qty)
);
CREATE INDEX idx_receipt_items_receipt ON goods_receipt_items(receipt_id);

CREATE TABLE purchase_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_ref TEXT,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  receipt_id TEXT UNIQUE REFERENCES goods_receipts(id),  -- empêche une double facturation / double stock
  invoice_date TEXT NOT NULL DEFAULT (date('now')),
  due_date TEXT,
  total_ht INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  stamp INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','cancelled')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (amount_paid <= total_ttc)
);
CREATE INDEX idx_pinv_supplier ON purchase_invoices(supplier_id);

CREATE TABLE supplier_returns (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  receipt_id TEXT REFERENCES goods_receipts(id),
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  reason TEXT,
  total_ht INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE supplier_return_items (
  id TEXT PRIMARY KEY,
  return_id TEXT NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price INTEGER NOT NULL DEFAULT 0,
  vat_bp INTEGER NOT NULL DEFAULT 0
);

-- ───────────── Caisse ─────────────
CREATE TABLE cash_registers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  warehouse_id TEXT REFERENCES warehouses(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cash_sessions (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  register_id TEXT NOT NULL REFERENCES cash_registers(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','validated')),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  opening_amount INTEGER NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  closed_at TEXT,
  expected_amount INTEGER,
  counted_amount INTEGER,
  difference INTEGER,
  justification TEXT,
  validated_by TEXT,
  validated_at TEXT
);
CREATE UNIQUE INDEX idx_one_open_session_per_register ON cash_sessions(register_id) WHERE status = 'open';
CREATE UNIQUE INDEX idx_one_open_session_per_user ON cash_sessions(user_id) WHERE status = 'open';

CREATE TABLE cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES cash_sessions(id),
  type TEXT NOT NULL CHECK (type IN ('opening','sale','customer_payment','supplier_payment','expense','withdrawal','deposit','refund','correction')),
  amount INTEGER NOT NULL,            -- signé : + entrée / - sortie
  ref_type TEXT,
  ref_id TEXT,
  ref_number TEXT,
  reason TEXT,
  user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cash_movements_session ON cash_movements(session_id);
-- Une opération de caisse validée ne se supprime ni ne se modifie : on passe par une contre-opération.
CREATE TRIGGER cash_movements_no_update BEFORE UPDATE ON cash_movements
BEGIN SELECT RAISE(ABORT, 'CASH_IMMUTABLE'); END;
CREATE TRIGGER cash_movements_no_delete BEFORE DELETE ON cash_movements
BEGIN SELECT RAISE(ABORT, 'CASH_IMMUTABLE'); END;
-- Aucun mouvement sur une session fermée
CREATE TRIGGER cash_movements_session_open BEFORE INSERT ON cash_movements
WHEN (SELECT status FROM cash_sessions WHERE id = NEW.session_id) <> 'open'
BEGIN SELECT RAISE(ABORT, 'CAISSE_FERMEE'); END;

-- ───────────── Ventes ─────────────
CREATE TABLE sales (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  customer_name TEXT,
  customer_type TEXT NOT NULL DEFAULT 'particulier',
  warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
  cash_session_id TEXT REFERENCES cash_sessions(id),
  quotation_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','cancelled')),
  sale_date TEXT NOT NULL DEFAULT (datetime('now')),
  subtotal_ht INTEGER NOT NULL,       -- après remises de ligne
  gross_ht INTEGER NOT NULL,          -- avant remises
  discount_total INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL,
  stamp INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL,
  amount_paid INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  credited_amount INTEGER NOT NULL DEFAULT 0 CHECK (credited_amount >= 0),
  cost_total INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','partial','unpaid')),
  due_date TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_by TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX idx_sales_date ON sales(sale_date);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_user ON sales(created_by);

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_reference TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0,
  unit_price_ht INTEGER NOT NULL,     -- prix réellement appliqué
  discount_bp INTEGER NOT NULL DEFAULT 0,
  discount_rule_id TEXT,
  vat_bp INTEGER NOT NULL,
  line_ht INTEGER NOT NULL,
  line_vat INTEGER NOT NULL,
  line_ttc INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0,
  batch_allocations TEXT,
  CHECK (returned_qty >= 0 AND returned_qty <= qty)
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

CREATE TABLE held_sales (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'quote' CHECK (kind IN ('quote','order')),
  customer_id TEXT REFERENCES customers(id),
  customer_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','converted','cancelled')),
  valid_until TEXT,
  subtotal_ht INTEGER NOT NULL DEFAULT 0,
  total_vat INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sale_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE quotation_items (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_ht INTEGER NOT NULL,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  vat_bp INTEGER NOT NULL,
  line_ht INTEGER NOT NULL,
  line_vat INTEGER NOT NULL,
  line_ttc INTEGER NOT NULL
);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  sale_id TEXT NOT NULL UNIQUE REFERENCES sales(id),
  customer_id TEXT REFERENCES customers(id),
  invoice_date TEXT NOT NULL DEFAULT (datetime('now')),
  total_ht INTEGER NOT NULL,
  total_vat INTEGER NOT NULL,
  stamp INTEGER NOT NULL DEFAULT 0,
  total_ttc INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated','cancelled')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','verified','anomaly')),
  verified_by TEXT,
  verified_at TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invoices_date ON invoices(invoice_date);
CREATE INDEX idx_invoices_verif ON invoices(verification_status);

CREATE TABLE invoice_validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  user_id TEXT,
  user_name TEXT,
  action TEXT NOT NULL CHECK (action IN ('created','verified','anomaly','comment','cancelled','reset')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_invoice_validations ON invoice_validations(invoice_id);

CREATE TABLE credit_notes (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('return','cancellation')),
  sale_id TEXT NOT NULL REFERENCES sales(id),
  invoice_id TEXT REFERENCES invoices(id),
  customer_id TEXT REFERENCES customers(id),
  reason TEXT,
  restock INTEGER NOT NULL DEFAULT 1,
  total_ht INTEGER NOT NULL,
  total_vat INTEGER NOT NULL,
  total_ttc INTEGER NOT NULL,
  cost_total INTEGER NOT NULL DEFAULT 0,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_credit_notes_sale ON credit_notes(sale_id);

CREATE TABLE credit_note_items (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price_ht INTEGER NOT NULL,
  discount_bp INTEGER NOT NULL DEFAULT 0,
  vat_bp INTEGER NOT NULL,
  line_ht INTEGER NOT NULL,
  line_vat INTEGER NOT NULL,
  line_ttc INTEGER NOT NULL,
  unit_cost INTEGER NOT NULL DEFAULT 0
);

-- ───────────── Paiements ─────────────
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','cheque','transfer','other')),
  reference TEXT,
  cash_session_id TEXT REFERENCES cash_sessions(id),
  payment_date TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_party ON payments(party_type, party_id);
CREATE INDEX idx_payments_date ON payments(payment_date);

CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  payment_id TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  sale_id TEXT REFERENCES sales(id),
  purchase_invoice_id TEXT REFERENCES purchase_invoices(id),
  amount INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX idx_alloc_sale ON payment_allocations(sale_id);
CREATE INDEX idx_alloc_pinv ON payment_allocations(purchase_invoice_id);

-- ───────────── Dépenses ─────────────
CREATE TABLE expense_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  category_id TEXT NOT NULL REFERENCES expense_categories(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  expense_date TEXT NOT NULL DEFAULT (date('now')),
  description TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  cash_session_id TEXT REFERENCES cash_sessions(id),
  status TEXT NOT NULL DEFAULT 'validated' CHECK (status IN ('validated','cancelled')),
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

-- ───────────── Notifications & imports ─────────────
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT UNIQUE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','danger','success')),
  title TEXT NOT NULL,
  message TEXT,
  link TEXT,
  permission TEXT,                 -- visible seulement aux utilisateurs ayant cette permission
  is_read INTEGER NOT NULL DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_created ON notifications(created_at);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  file_name TEXT,
  mode TEXT NOT NULL DEFAULT 'insert',
  status TEXT NOT NULL DEFAULT 'completed',
  total_rows INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE import_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  row_num INTEGER,
  message TEXT NOT NULL
);
