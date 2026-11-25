-- Données de référence (aucune donnée commerciale fictive).
-- Toutes les valeurs ci-dessous sont modifiables depuis Paramètres et doivent être validées
-- par le propriétaire / son comptable avant utilisation réelle.

INSERT INTO settings (key, value) VALUES
  ('company_name', 'Nour de Commerce'),
  ('company_activity', 'Commerce de produits alimentaires et d''hygiène'),
  ('company_address', ''),
  ('company_city', 'Moknine'),
  ('company_phone', ''),
  ('company_email', ''),
  ('company_tax_id', ''),
  ('company_rc', ''),
  ('currency', 'TND'),
  ('timezone', 'Africa/Tunis'),
  ('default_vat_bp', '1900'),
  ('vat_rates_bp', '[0,700,1300,1900]'),
  ('fiscal_stamp', '1000'),
  ('fiscal_stamp_enabled', '1'),
  ('allow_negative_stock', '0'),
  ('block_expired_sales', '1'),
  ('expiry_alert_days', '30'),
  ('expiry_alert_levels', '[7,15,30,60]'),
  ('default_max_discount_bp', '1000'),
  ('low_rotation_days', '60'),
  ('invoice_footer', 'Merci pour votre confiance.'),
  ('ticket_footer', 'Merci de votre visite !'),
  ('remote_validation_enabled', '0'),
  ('scanner_config', '{"suffix":"Enter","maxInterval":50,"minLength":4,"dedupeMs":250,"sound":true,"idleTimeout":120}');

INSERT INTO document_sequences (doc_type, label, prefix, padding) VALUES
  ('SALE', 'Vente / ticket', 'TK-', 5),
  ('INVOICE', 'Facture de vente', 'FAC-', 5),
  ('CREDIT_NOTE', 'Avoir', 'AV-', 5),
  ('QUOTE', 'Devis', 'DV-', 5),
  ('ORDER', 'Commande client', 'BC-', 5),
  ('PO', 'Commande fournisseur', 'CF-', 5),
  ('RECEIPT', 'Bon de réception', 'BR-', 5),
  ('PINVOICE', 'Facture fournisseur (interne)', 'FF-', 5),
  ('SRETURN', 'Retour fournisseur', 'RF-', 5),
  ('PAYMENT', 'Règlement', 'RG-', 5),
  ('EXPENSE', 'Dépense', 'DEP-', 5),
  ('CASH_SESSION', 'Session de caisse', 'CS-', 5),
  ('INVENTORY', 'Inventaire', 'INV-', 5),
  ('STOCK_DOC', 'Bon d''entrée / sortie de stock', 'BS-', 5);

INSERT INTO roles (id, name, label, is_system) VALUES
  ('role-admin', 'admin', 'Administrateur / Propriétaire', 1),
  ('role-magasinier', 'magasinier', 'Magasinier', 1),
  ('role-caissier', 'caissier', 'Caissier', 1),
  ('role-controleur', 'controleur', 'Contrôleur à distance', 1);

INSERT INTO role_permissions (role_id, permission) VALUES
  ('role-admin', 'dashboard.view'),
  ('role-admin', 'finance.view'),
  ('role-admin', 'products.view'),
  ('role-admin', 'products.manage'),
  ('role-admin', 'products.delete'),
  ('role-admin', 'products.prices'),
  ('role-admin', 'stock.view'),
  ('role-admin', 'stock.adjust'),
  ('role-admin', 'inventory.manage'),
  ('role-admin', 'inventory.validate'),
  ('role-admin', 'suppliers.view'),
  ('role-admin', 'suppliers.manage'),
  ('role-admin', 'purchases.view'),
  ('role-admin', 'purchases.manage'),
  ('role-admin', 'receipts.manage'),
  ('role-admin', 'customers.view'),
  ('role-admin', 'customers.manage'),
  ('role-admin', 'pos.use'),
  ('role-admin', 'sales.view'),
  ('role-admin', 'sales.cancel'),
  ('role-admin', 'returns.manage'),
  ('role-admin', 'quotes.manage'),
  ('role-admin', 'discounts.override'),
  ('role-admin', 'credit.override'),
  ('role-admin', 'invoices.view'),
  ('role-admin', 'invoices.verify'),
  ('role-admin', 'cash.use'),
  ('role-admin', 'cash.manage'),
  ('role-admin', 'payments.manage'),
  ('role-admin', 'expenses.manage'),
  ('role-admin', 'reports.view'),
  ('role-admin', 'import.manage'),
  ('role-admin', 'users.manage'),
  ('role-admin', 'settings.manage'),
  ('role-admin', 'audit.view'),
  ('role-admin', 'backup.manage');

INSERT INTO role_permissions (role_id, permission) VALUES
  ('role-magasinier', 'products.view'), ('role-magasinier', 'stock.view'), ('role-magasinier', 'stock.adjust'),
  ('role-magasinier', 'inventory.manage'), ('role-magasinier', 'receipts.manage'), ('role-magasinier', 'purchases.view'),
  ('role-magasinier', 'suppliers.view'), ('role-magasinier', 'returns.manage'),
  ('role-caissier', 'pos.use'), ('role-caissier', 'products.view'), ('role-caissier', 'customers.view'),
  ('role-caissier', 'customers.manage'), ('role-caissier', 'sales.view'), ('role-caissier', 'invoices.view'),
  ('role-caissier', 'cash.use'), ('role-caissier', 'payments.manage'), ('role-caissier', 'quotes.manage'),
  ('role-controleur', 'dashboard.view'), ('role-controleur', 'sales.view'), ('role-controleur', 'invoices.view'),
  ('role-controleur', 'reports.view'), ('role-controleur', 'stock.view'), ('role-controleur', 'products.view'),
  ('role-controleur', 'customers.view');

INSERT INTO warehouses (id, name, is_default) VALUES ('wh-main', 'Dépôt principal', 1);
INSERT INTO cash_registers (id, name, warehouse_id) VALUES ('reg-1', 'Caisse 1', 'wh-main');

INSERT INTO expense_categories (id, name) VALUES
  ('exp-transport', 'Transport'), ('exp-elec', 'Électricité'), ('exp-eau', 'Eau'), ('exp-loyer', 'Loyer'),
  ('exp-salaires', 'Salaires'), ('exp-maintenance', 'Maintenance'), ('exp-fournitures', 'Fournitures'),
  ('exp-autres', 'Autres dépenses');
