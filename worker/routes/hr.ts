import { Hono } from 'hono';
import { z } from 'zod';
import { AppEnv, Ctx, HttpError, all, first, tx, uuid, body, perm, need, auditStmt, requireAuth, zMoney, zOptStr, zDate, seqReserve, seqExpr, getSettings, openSessionFor } from '../lib';
import { computePay, datesBetween, type AttendanceStatus, type PayRules } from '../../shared/payroll';

export const hr = new Hono<AppEnv>();
hr.use('*', requireAuth);

// ───────────── Effectif ─────────────
const employeeSchema = z.object({
  code: z.string().trim().max(20).optional().default(''),
  full_name: z.string().trim().min(2, 'Nom requis').max(120),
  cin: zOptStr(20),
  phone: zOptStr(30),
  position: zOptStr(60),
  hire_date: zOptStr(10),
  pay_type: z.enum(['daily', 'weekly', 'monthly']),
  daily_rate: zMoney.default(0),
  weekly_salary: zMoney.default(0),
  monthly_salary: zMoney.default(0),
  overtime_hourly_rate: zMoney.default(0),
  notes: zOptStr(500),
});

hr.get('/employees', perm('hr.view', 'hr.attendance', 'hr.manage'), async (c) => {
  const status = c.req.query('status') ?? 'active';
  const rows = await all<any>(
    c.env.DB,
    `SELECT e.*,
            (SELECT COALESCE(SUM(amount),0) FROM salary_advances a WHERE a.employee_id = e.id AND a.payroll_run_id IS NULL) AS pending_advances,
            (SELECT status FROM attendance t WHERE t.employee_id = e.id AND t.work_date = date('now','+1 hour')) AS today_status
       FROM employees e ${status === 'all' ? '' : status === 'archived' ? 'WHERE e.is_active = 0' : 'WHERE e.is_active = 1'} ORDER BY e.full_name`,
  );
  const canPay = c.get('user').perms.has('hr.manage') || c.get('user').perms.has('payroll.manage');
  return c.json(canPay ? rows : rows.map((r) => ({ ...r, daily_rate: null, weekly_salary: null, monthly_salary: null, overtime_hourly_rate: null, pending_advances: null })));
});

async function nextEmployeeCode(db: D1Database) {
  const r = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM employees');
  for (let n = (r?.n ?? 0) + 1; ; n++) {
    const code = 'E' + String(n).padStart(4, '0');
    if (!(await first(db, 'SELECT 1 FROM employees WHERE code = ?', code))) return code;
  }
}

hr.post('/employees', perm('hr.manage'), async (c) => {
  const d = await body(c, employeeSchema);
  const db = c.env.DB;
  const id = uuid();
  const code = d.code || (await nextEmployeeCode(db));
  await tx(db, [
    db
      .prepare(`INSERT INTO employees (id, code, full_name, cin, phone, position, hire_date, pay_type, daily_rate, weekly_salary, monthly_salary, overtime_hourly_rate, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, code, d.full_name, d.cin, d.phone, d.position, d.hire_date, d.pay_type, d.daily_rate, d.weekly_salary, d.monthly_salary, d.overtime_hourly_rate, d.notes, c.get('user').id),
    auditStmt(c, 'create', 'employees', id, null, d),
  ]);
  return c.json({ id, code });
});

hr.put('/employees/:id', perm('hr.manage'), async (c) => {
  const id = c.req.param('id');
  const d = await body(c, employeeSchema);
  const db = c.env.DB;
  const old = await first<any>(db, 'SELECT * FROM employees WHERE id = ?', id);
  if (!old) throw new HttpError(404, 'NOT_FOUND', 'Employé introuvable.');
  await tx(db, [
    db
      .prepare(`UPDATE employees SET code=?, full_name=?, cin=?, phone=?, position=?, hire_date=?, pay_type=?, daily_rate=?, weekly_salary=?, monthly_salary=?, overtime_hourly_rate=?, notes=?, updated_at=datetime('now') WHERE id=?`)
      .bind(d.code || old.code, d.full_name, d.cin, d.phone, d.position, d.hire_date, d.pay_type, d.daily_rate, d.weekly_salary, d.monthly_salary, d.overtime_hourly_rate, d.notes, id),
    auditStmt(c, 'update', 'employees', id, old, d),
  ]);
  return c.json({ ok: true });
});

hr.post('/employees/:id/active', perm('hr.manage'), async (c) => {
  const { active } = await body(c, z.object({ active: z.boolean() }));
  const db = c.env.DB;
  await tx(db, [db.prepare('UPDATE employees SET is_active = ? WHERE id = ?').bind(active ? 1 : 0, c.req.param('id')), auditStmt(c, active ? 'restore' : 'archive', 'employees', c.req.param('id'))]);
  return c.json({ ok: true });
});

hr.delete('/employees/:id', perm('hr.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const used = await first<{ n: number }>(db, 'SELECT (SELECT COUNT(*) FROM payroll_items WHERE employee_id = ?1) + (SELECT COUNT(*) FROM salary_advances WHERE employee_id = ?1 AND from_cash = 1) AS n', id);
  if ((used?.n ?? 0) > 0) throw new HttpError(409, 'IN_USE', 'Cet employé figure déjà dans une paie ou une avance de caisse : archivez-le plutôt.');
  const old = await first(db, 'SELECT * FROM employees WHERE id = ?', id);
  await tx(db, [db.prepare('DELETE FROM employees WHERE id = ?').bind(id), auditStmt(c, 'delete', 'employees', id, old)]);
  return c.json({ ok: true });
});

// ───────────── Pointage ─────────────
hr.get('/attendance', perm('hr.view', 'hr.attendance'), async (c) => {
  const date = c.req.query('date') ?? new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'DATE', 'Date invalide.');
  const rows = await all(
    c.env.DB,
    `SELECT e.id AS employee_id, e.code, e.full_name, e.position, t.status, t.check_in, t.check_out, t.overtime_minutes, t.notes, t.payroll_run_id
       FROM employees e LEFT JOIN attendance t ON t.employee_id = e.id AND t.work_date = ?
      WHERE e.is_active = 1 OR t.id IS NOT NULL ORDER BY e.full_name`,
    date,
  );
  return c.json({ date, rows });
});

const statusEnum = z.enum(['present', 'half', 'absent', 'leave', 'sick', 'holiday']);
hr.put('/attendance', perm('hr.attendance', 'hr.manage'), async (c) => {
  const d = await body(
    c,
    z.object({
      date: zDate,
      entries: z
        .array(
          z.object({
            employee_id: z.string(),
            status: statusEnum.nullable(),
            check_in: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
            check_out: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
            overtime_minutes: z.number().int().min(0).max(1440).default(0),
            notes: zOptStr(200),
          }),
        )
        .max(500),
    }),
  );
  const db = c.env.DB;
  const locked = await all<any>(db, `SELECT employee_id FROM attendance WHERE work_date = ? AND payroll_run_id IS NOT NULL`, d.date);
  const lockedSet = new Set(locked.map((l) => l.employee_id));
  const u = c.get('user');
  const stmts: D1PreparedStatement[] = [];
  let skipped = 0;
  for (const e of d.entries) {
    if (lockedSet.has(e.employee_id)) {
      skipped++;
      continue;
    }
    if (!e.status) {
      stmts.push(db.prepare('DELETE FROM attendance WHERE employee_id = ? AND work_date = ? AND payroll_run_id IS NULL').bind(e.employee_id, d.date));
      continue;
    }
    stmts.push(
      db
        .prepare(
          `INSERT INTO attendance (id, employee_id, work_date, status, check_in, check_out, overtime_minutes, notes, recorded_by) VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(employee_id, work_date) DO UPDATE SET status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out,
             overtime_minutes = excluded.overtime_minutes, notes = excluded.notes, recorded_by = excluded.recorded_by, updated_at = datetime('now')
           WHERE attendance.payroll_run_id IS NULL`,
        )
        .bind(uuid(), e.employee_id, d.date, e.status, e.check_in ?? null, e.check_out ?? null, e.overtime_minutes, e.notes, u.id),
    );
  }
  stmts.push(auditStmt(c, 'attendance', 'attendance', d.date, null, { count: d.entries.length }));
  await tx(db, stmts);
  return c.json({ ok: true, skipped });
});

/** Récapitulatif mensuel : employés × jours. */
hr.get('/attendance/grid', perm('hr.view', 'hr.attendance'), async (c) => {
  const from = c.req.query('from')!;
  const to = c.req.query('to')!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? '')) throw new HttpError(400, 'DATE', 'Période invalide.');
  const db = c.env.DB;
  const [emps, att] = await Promise.all([
    all<any>(db, `SELECT id, code, full_name, position FROM employees WHERE is_active = 1 OR id IN (SELECT employee_id FROM attendance WHERE work_date BETWEEN ? AND ?) ORDER BY full_name`, from, to),
    all<any>(db, `SELECT employee_id, work_date, status, overtime_minutes FROM attendance WHERE work_date BETWEEN ? AND ?`, from, to),
  ]);
  return c.json({ from, to, dates: datesBetween(from, to), employees: emps, attendance: att });
});

// ───────────── Avances sur salaire ─────────────
hr.get('/advances', perm('hr.manage', 'payroll.manage'), async (c) =>
  c.json(
    await all(
      c.env.DB,
      `SELECT a.*, e.full_name, e.code, r.number AS payroll_number FROM salary_advances a JOIN employees e ON e.id = a.employee_id LEFT JOIN payroll_runs r ON r.id = a.payroll_run_id
        ${c.req.query('employee_id') ? 'WHERE a.employee_id = ?' : ''} ORDER BY a.advance_date DESC, a.created_at DESC LIMIT 500`,
      ...(c.req.query('employee_id') ? [c.req.query('employee_id')] : []),
    ),
  ),
);

hr.post('/advances', perm('hr.manage'), async (c) => {
  const d = await body(c, z.object({ employee_id: z.string(), advance_date: zDate, amount: zMoney.refine((v) => v > 0, 'Montant requis'), reason: zOptStr(200), from_cash: z.boolean().default(false) }));
  const db = c.env.DB;
  const u = c.get('user');
  const emp = await first<any>(db, 'SELECT full_name FROM employees WHERE id = ?', d.employee_id);
  if (!emp) throw new HttpError(404, 'NOT_FOUND', 'Employé introuvable.');
  const id = uuid();
  const stmts: D1PreparedStatement[] = [
    db.prepare('INSERT INTO salary_advances (id, employee_id, advance_date, amount, reason, from_cash, created_by) VALUES (?,?,?,?,?,?,?)').bind(id, d.employee_id, d.advance_date, d.amount, d.reason, d.from_cash ? 1 : 0, u.id),
  ];
  if (d.from_cash) {
    const s = await openSessionFor(db, u.id);
    if (!s) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour verser l’avance en espèces.');
    stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, reason, user_id) VALUES (?, 'withdrawal', ?, 'salary_advance', ?, ?, ?)`).bind(s.id, -d.amount, id, `Avance sur salaire — ${emp.full_name}`, u.id));
  }
  stmts.push(auditStmt(c, 'create', 'salary_advances', id, null, d));
  await tx(db, stmts);
  return c.json({ id });
});

hr.delete('/advances/:id', perm('hr.manage'), async (c) => {
  const db = c.env.DB;
  const a = await first<any>(db, 'SELECT * FROM salary_advances WHERE id = ?', c.req.param('id'));
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'Avance introuvable.');
  if (a.payroll_run_id) throw new HttpError(409, 'LOCKED', 'Avance déjà déduite sur une paie.');
  if (a.from_cash) throw new HttpError(409, 'LOCKED', 'Avance versée depuis la caisse : elle ne peut pas être supprimée (la déduire sur la prochaine paie).');
  await tx(db, [db.prepare('DELETE FROM salary_advances WHERE id = ?').bind(a.id), auditStmt(c, 'delete', 'salary_advances', a.id, a)]);
  return c.json({ ok: true });
});

// ───────────── Paie ─────────────
async function payRules(db: D1Database): Promise<PayRules> {
  const s = await getSettings(db);
  let paid: AttendanceStatus[] = ['leave', 'holiday'];
  try {
    paid = JSON.parse(s.hr_paid_leave_statuses ?? '["leave","holiday"]');
  } catch {
    /* défaut */
  }
  return { daysPerWeek: Number(s.hr_days_per_week ?? 6) || 6, daysPerMonth: Number(s.hr_days_per_month ?? 26) || 26, paidStatuses: paid };
}

async function computeItems(c: Ctx, periodType: 'week' | 'month', start: string, end: string, overrides: Record<string, { bonus?: number; deductions?: number; notes?: string | null }> = {}) {
  const db = c.env.DB;
  const rules = await payRules(db);
  const emps = await all<any>(db, `SELECT * FROM employees WHERE is_active = 1 OR id IN (SELECT employee_id FROM attendance WHERE work_date BETWEEN ? AND ?) ORDER BY full_name`, start, end);
  const att = await all<any>(db, `SELECT employee_id, status, overtime_minutes FROM attendance WHERE work_date BETWEEN ? AND ?`, start, end);
  const adv = await all<any>(db, `SELECT employee_id, SUM(amount) AS total FROM salary_advances WHERE payroll_run_id IS NULL AND advance_date <= ? GROUP BY employee_id`, end);
  const advMap = new Map(adv.map((a) => [a.employee_id, a.total]));
  return emps.map((e) => {
    const days = att.filter((a) => a.employee_id === e.id);
    const o = overrides[e.id] ?? {};
    const advances = advMap.get(e.id) ?? 0;
    const r = computePay(e, days, periodType, rules, { bonus: o.bonus ?? 0, advances, deductions: o.deductions ?? 0 });
    return {
      employee_id: e.id,
      code: e.code,
      full_name: e.full_name,
      position: e.position,
      pay_type: e.pay_type,
      days_marked: days.length,
      days_present: r.halfDaysPresent / 2,
      days_absent: r.halfDaysUnpaid / 2,
      days_paid_leave: r.halfDaysPaidLeave / 2,
      overtime_minutes: r.overtimeMinutes,
      base_amount: r.base,
      overtime_amount: r.overtime,
      bonus: o.bonus ?? 0,
      advances,
      deductions: o.deductions ?? 0,
      net_amount: r.net,
      notes: o.notes ?? null,
    };
  });
}

const periodSchema = z.object({ period_type: z.enum(['week', 'month']), period_start: zDate, period_end: zDate });

hr.post('/payroll/preview', perm('payroll.manage'), async (c) => {
  const d = await body(c, periodSchema.extend({ overrides: z.record(z.string(), z.object({ bonus: zMoney.optional(), deductions: zMoney.optional(), notes: zOptStr(200) })).default({}) }));
  if (d.period_end < d.period_start) throw new HttpError(400, 'PERIOD', 'Période invalide.');
  const items = await computeItems(c, d.period_type, d.period_start, d.period_end, d.overrides);
  return c.json({ items, rules: await payRules(c.env.DB) });
});

hr.post('/payroll', perm('payroll.manage'), async (c) => {
  const d = await body(c, periodSchema.extend({ notes: zOptStr(300), overrides: z.record(z.string(), z.object({ bonus: zMoney.optional(), deductions: zMoney.optional(), notes: zOptStr(200) })).default({}) }));
  const db = c.env.DB;
  const overlap = await first<any>(db, `SELECT number FROM payroll_runs WHERE status <> 'cancelled' AND period_start <= ? AND period_end >= ?`, d.period_end, d.period_start);
  if (overlap) throw new HttpError(409, 'OVERLAP', `Une paie couvre déjà cette période (${overlap.number}). Annulez-la ou choisissez une autre période.`);
  const items = (await computeItems(c, d.period_type, d.period_start, d.period_end, d.overrides)).filter((i) => i.days_marked > 0 || i.pay_type !== 'daily' || i.advances > 0);
  const id = uuid();
  const sum = (k: 'base_amount' | 'net_amount' | 'advances' | 'deductions') => items.reduce((s, i) => s + i[k], 0);
  const gross = items.reduce((s, i) => s + i.base_amount + i.overtime_amount + i.bonus, 0);
  await tx(db, [
    ...seqReserve(db, 'PAYROLL'),
    db
      .prepare(`INSERT INTO payroll_runs (id, number, period_type, period_start, period_end, total_gross, total_advances, total_deductions, total_net, notes, created_by) VALUES (?, ${seqExpr('PAYROLL')}, ?,?,?,?,?,?,?,?,?)`)
      .bind(id, d.period_type, d.period_start, d.period_end, gross, sum('advances'), sum('deductions'), sum('net_amount'), d.notes, c.get('user').id),
    ...items.map((i) =>
      db
        .prepare(
          `INSERT INTO payroll_items (id, run_id, employee_id, pay_type, days_present, days_absent, days_paid_leave, overtime_minutes, base_amount, overtime_amount, bonus, advances, deductions, net_amount, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(uuid(), id, i.employee_id, i.pay_type, i.days_present, i.days_absent, i.days_paid_leave, i.overtime_minutes, i.base_amount, i.overtime_amount, i.bonus, i.advances, i.deductions, i.net_amount, i.notes),
    ),
    auditStmt(c, 'create', 'payroll_runs', id, null, { ...d, employees: items.length }),
  ]);
  return c.json({ id });
});

hr.get('/payroll', perm('payroll.manage'), async (c) =>
  c.json(await all(c.env.DB, `SELECT r.*, (SELECT COUNT(*) FROM payroll_items i WHERE i.run_id = r.id) AS employees, u.full_name AS created_by_name FROM payroll_runs r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.period_start DESC LIMIT 200`)),
);

hr.get('/payroll/:id', perm('payroll.manage'), async (c) => {
  const db = c.env.DB;
  const r = await first<any>(db, 'SELECT * FROM payroll_runs WHERE id = ?', c.req.param('id'));
  if (!r) throw new HttpError(404, 'NOT_FOUND', 'Paie introuvable.');
  r.items = await all(db, `SELECT i.*, e.full_name, e.code, e.position, e.cin FROM payroll_items i JOIN employees e ON e.id = i.employee_id WHERE i.run_id = ? ORDER BY e.full_name`, r.id);
  return c.json(r);
});

async function recomputeRunTotals(db: D1Database, runId: string) {
  return db
    .prepare(
      `UPDATE payroll_runs SET
         total_gross = (SELECT COALESCE(SUM(base_amount + overtime_amount + bonus),0) FROM payroll_items WHERE run_id = ?1),
         total_advances = (SELECT COALESCE(SUM(advances),0) FROM payroll_items WHERE run_id = ?1),
         total_deductions = (SELECT COALESCE(SUM(deductions),0) FROM payroll_items WHERE run_id = ?1),
         total_net = (SELECT COALESCE(SUM(net_amount),0) FROM payroll_items WHERE run_id = ?1)
       WHERE id = ?1`,
    )
    .bind(runId);
}

hr.put('/payroll/:id/items/:eid', perm('payroll.manage'), async (c) => {
  const { id, eid } = c.req.param();
  const d = await body(c, z.object({ bonus: zMoney, deductions: zMoney, notes: zOptStr(200) }));
  const db = c.env.DB;
  const run = await first<any>(db, 'SELECT status FROM payroll_runs WHERE id = ?', id);
  if (!run || run.status !== 'draft') throw new HttpError(409, 'LOCKED', 'Seule une paie en brouillon peut être modifiée.');
  await tx(db, [
    db
      .prepare(`UPDATE payroll_items SET bonus = ?, deductions = ?, notes = ?, net_amount = base_amount + overtime_amount + ? - advances - ? WHERE run_id = ? AND employee_id = ?`)
      .bind(d.bonus, d.deductions, d.notes, d.bonus, d.deductions, id, eid),
    await recomputeRunTotals(db, id),
  ]);
  return c.json({ ok: true });
});

/** Validation : verrouille le pointage de la période et déduit les avances. */
hr.post('/payroll/:id/validate', perm('payroll.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const r = await first<any>(db, 'SELECT * FROM payroll_runs WHERE id = ?', id);
  if (!r || r.status !== 'draft') throw new HttpError(409, 'LOCKED', 'Paie introuvable ou déjà validée.');
  const neg = await first<any>(db, `SELECT e.full_name FROM payroll_items i JOIN employees e ON e.id = i.employee_id WHERE i.run_id = ? AND i.net_amount < 0`, id);
  if (neg) throw new HttpError(409, 'NEGATIVE', `Le net à payer de ${neg.full_name} est négatif (avances supérieures au salaire). Ajustez la paie.`);
  await tx(db, [
    db.prepare(`UPDATE payroll_runs SET status = 'validated', validated_by = ?, validated_at = datetime('now') WHERE id = ? AND status = 'draft'`).bind(c.get('user').id, id),
    db.prepare(`UPDATE attendance SET payroll_run_id = ? WHERE work_date BETWEEN ? AND ? AND employee_id IN (SELECT employee_id FROM payroll_items WHERE run_id = ?)`).bind(id, r.period_start, r.period_end, id),
    db.prepare(`UPDATE salary_advances SET payroll_run_id = ? WHERE payroll_run_id IS NULL AND advance_date <= ? AND employee_id IN (SELECT employee_id FROM payroll_items WHERE run_id = ? AND advances > 0)`).bind(id, r.period_end, id),
    auditStmt(c, 'validate', 'payroll_runs', id),
  ]);
  return c.json({ ok: true });
});

/** Paiement : enregistre la dépense « Salaires » (depuis la caisse si demandé). */
hr.post('/payroll/:id/pay', perm('payroll.manage'), async (c) => {
  const id = c.req.param('id');
  const { from_cash } = await body(c, z.object({ from_cash: z.boolean().default(false) }));
  const db = c.env.DB;
  const u = c.get('user');
  const r = await first<any>(db, 'SELECT * FROM payroll_runs WHERE id = ?', id);
  if (!r || r.status !== 'validated') throw new HttpError(409, 'NOT_VALIDATED', 'La paie doit être validée avant le paiement.');
  const session = from_cash ? await openSessionFor(db, u.id) : null;
  if (from_cash && !session) throw new HttpError(409, 'NO_CASH_SESSION', 'Ouvrez votre caisse pour payer depuis la caisse.');
  const expId = uuid();
  const stmts: D1PreparedStatement[] = [];
  if (r.total_net > 0) {
    stmts.push(
      ...seqReserve(db, 'EXPENSE'),
      db
        .prepare(`INSERT INTO expenses (id, number, category_id, amount, expense_date, description, payment_method, cash_session_id, created_by) VALUES (?, ${seqExpr('EXPENSE')}, 'exp-salaires', ?, date('now','+1 hour'), ?, ?, ?, ?)`)
        .bind(expId, r.total_net, `Paie ${r.number} (${r.period_start} → ${r.period_end})`, from_cash ? 'cash' : 'transfer', session?.id ?? null, u.id),
    );
    if (session) {
      stmts.push(db.prepare(`INSERT INTO cash_movements (session_id, type, amount, ref_type, ref_id, ref_number, reason, user_id) VALUES (?, 'expense', ?, 'payroll', ?, ?, ?, ?)`).bind(session.id, -r.total_net, id, r.number, 'Paiement des salaires', u.id));
    }
  }
  stmts.push(
    db.prepare(`UPDATE payroll_runs SET status = 'paid', paid_at = datetime('now'), expense_id = ? WHERE id = ? AND status = 'validated'`).bind(r.total_net > 0 ? expId : null, id),
    auditStmt(c, 'pay', 'payroll_runs', id, null, { total: r.total_net, from_cash }),
  );
  await tx(db, stmts);
  return c.json({ ok: true });
});

hr.post('/payroll/:id/cancel', perm('payroll.manage'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const r = await first<any>(db, 'SELECT status FROM payroll_runs WHERE id = ?', id);
  if (!r || !['draft', 'validated'].includes(r.status)) throw new HttpError(409, 'LOCKED', 'Une paie déjà payée ne peut pas être annulée (annulez la dépense associée).');
  await tx(db, [
    db.prepare(`UPDATE payroll_runs SET status = 'cancelled' WHERE id = ?`).bind(id),
    db.prepare('UPDATE attendance SET payroll_run_id = NULL WHERE payroll_run_id = ?').bind(id),
    db.prepare('UPDATE salary_advances SET payroll_run_id = NULL WHERE payroll_run_id = ?').bind(id),
    auditStmt(c, 'cancel', 'payroll_runs', id),
  ]);
  return c.json({ ok: true });
});

void need;
