-- Personnel : effectif, pointage journalier, avances, paie hebdomadaire / mensuelle.
-- Montants en millimes. Paie simplifiée de gestion (les cotisations CNSS / IRPP éventuelles sont saisies en retenues,
-- à valider avec le comptable ; ce module n'édite pas de bulletin de paie réglementaire).

CREATE TABLE employees (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  cin TEXT,
  phone TEXT,
  position TEXT,                       -- poste : magasinier, caissier, chauffeur…
  hire_date TEXT,
  pay_type TEXT NOT NULL DEFAULT 'monthly' CHECK (pay_type IN ('daily','weekly','monthly')),
  daily_rate INTEGER NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),       -- salaire par jour (paie à la journée)
  weekly_salary INTEGER NOT NULL DEFAULT 0 CHECK (weekly_salary >= 0),
  monthly_salary INTEGER NOT NULL DEFAULT 0 CHECK (monthly_salary >= 0),
  overtime_hourly_rate INTEGER NOT NULL DEFAULT 0 CHECK (overtime_hourly_rate >= 0),
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_employees_name ON employees(full_name);

CREATE TABLE attendance (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,             -- 'YYYY-MM-DD' (date locale Tunis)
  status TEXT NOT NULL CHECK (status IN ('present','half','absent','leave','sick','holiday')),
  check_in TEXT,                       -- 'HH:MM'
  check_out TEXT,
  overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  notes TEXT,
  payroll_run_id TEXT,                 -- renseigné quand la journée a été payée (verrouillage)
  recorded_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX idx_attendance_date ON attendance(work_date);

CREATE TABLE salary_advances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  advance_date TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason TEXT,
  from_cash INTEGER NOT NULL DEFAULT 0,
  payroll_run_id TEXT,                 -- avance déduite sur cette paie
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_advances_employee ON salary_advances(employee_id);

CREATE TABLE payroll_runs (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  period_type TEXT NOT NULL CHECK (period_type IN ('week','month')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','paid','cancelled')),
  total_gross INTEGER NOT NULL DEFAULT 0,
  total_advances INTEGER NOT NULL DEFAULT 0,
  total_deductions INTEGER NOT NULL DEFAULT 0,
  total_net INTEGER NOT NULL DEFAULT 0,
  expense_id TEXT,
  notes TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_by TEXT,
  validated_at TEXT,
  paid_at TEXT
);

CREATE TABLE payroll_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  pay_type TEXT NOT NULL,
  days_present REAL NOT NULL DEFAULT 0,      -- demi-journées comptées 0,5
  days_absent REAL NOT NULL DEFAULT 0,
  days_paid_leave REAL NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  base_amount INTEGER NOT NULL DEFAULT 0,
  overtime_amount INTEGER NOT NULL DEFAULT 0,
  bonus INTEGER NOT NULL DEFAULT 0,
  advances INTEGER NOT NULL DEFAULT 0,
  deductions INTEGER NOT NULL DEFAULT 0,
  net_amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  UNIQUE (run_id, employee_id)
);

INSERT INTO document_sequences (doc_type, label, prefix, padding) VALUES ('PAYROLL', 'Paie', 'PAIE-', 4);
INSERT OR IGNORE INTO expense_categories (id, name) VALUES ('exp-salaires', 'Salaires');

INSERT INTO settings (key, value) VALUES
  ('hr_days_per_week', '6'),
  ('hr_days_per_month', '26'),
  ('hr_paid_leave_statuses', '["leave","holiday"]');

INSERT INTO role_permissions (role_id, permission) VALUES
  ('role-admin', 'hr.view'), ('role-admin', 'hr.attendance'), ('role-admin', 'hr.manage'), ('role-admin', 'payroll.manage'),
  ('role-magasinier', 'hr.attendance');

-- Données d'exemple : traçabilité pour suppression en un clic
CREATE TABLE demo_records (
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (table_name, record_id)
);
