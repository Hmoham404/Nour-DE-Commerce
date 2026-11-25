// Calcul de paie simplifié (gestion interne). Montants en millimes, jours comptés en demi-journées (entiers).
import { roundHalfUp } from './money';

export type PayType = 'daily' | 'weekly' | 'monthly';
export type PeriodType = 'week' | 'month';
export type AttendanceStatus = 'present' | 'half' | 'absent' | 'leave' | 'sick' | 'holiday';

export const ATTENDANCE_LABELS: Record<AttendanceStatus, string> = {
  present: 'Présent',
  half: 'Demi-journée',
  absent: 'Absent',
  leave: 'Congé payé',
  sick: 'Malade',
  holiday: 'Jour férié',
};

export interface EmployeePay {
  pay_type: PayType;
  daily_rate: number;
  weekly_salary: number;
  monthly_salary: number;
  overtime_hourly_rate: number;
}

export interface AttendanceDay {
  status: AttendanceStatus;
  overtime_minutes?: number;
}

export interface PayRules {
  daysPerWeek: number; // jours ouvrés par semaine (ex. 6)
  daysPerMonth: number; // jours ouvrés par mois (ex. 26)
  paidStatuses: AttendanceStatus[]; // statuts payés en plus de « présent » (ex. congé, férié)
}

export interface PayResult {
  halfDaysPresent: number; // demi-journées travaillées
  halfDaysPaidLeave: number; // demi-journées de congé / férié payées
  halfDaysUnpaid: number; // demi-journées non payées (absence, maladie non payée, demi-journée)
  overtimeMinutes: number;
  base: number;
  overtime: number;
  gross: number; // base + heures sup + prime
  net: number; // gross − avances − retenues
}

export function countAttendance(days: AttendanceDay[], rules: PayRules) {
  let present = 0;
  let paidLeave = 0;
  let unpaid = 0;
  let overtime = 0;
  for (const d of days) {
    overtime += d.overtime_minutes ?? 0;
    if (d.status === 'present') present += 2;
    else if (d.status === 'half') {
      present += 1;
      unpaid += 1;
    } else if (rules.paidStatuses.includes(d.status)) paidLeave += 2;
    else unpaid += 2; // absent, maladie non payée
  }
  return { present, paidLeave, unpaid, overtime };
}

/** Salaire fixe correspondant à la période choisie. */
export function fixedSalaryForPeriod(e: EmployeePay, period: PeriodType, rules: PayRules): number {
  if (e.pay_type === 'monthly') return period === 'month' ? e.monthly_salary : roundHalfUp((e.monthly_salary * rules.daysPerWeek) / rules.daysPerMonth);
  if (e.pay_type === 'weekly') return period === 'week' ? e.weekly_salary : roundHalfUp((e.weekly_salary * rules.daysPerMonth) / rules.daysPerWeek);
  return 0;
}

export function computePay(e: EmployeePay, days: AttendanceDay[], period: PeriodType, rules: PayRules, extra: { bonus?: number; advances?: number; deductions?: number } = {}): PayResult {
  const c = countAttendance(days, rules);
  let base: number;
  if (e.pay_type === 'daily') {
    // payé uniquement pour les jours pointés présents ou en congé payé
    base = roundHalfUp(((c.present + c.paidLeave) * e.daily_rate) / 2);
  } else {
    // salaire fixe moins les absences non payées, au prorata des jours ouvrés de la période
    const fixed = fixedSalaryForPeriod(e, period, rules);
    const expectedHalfDays = 2 * (period === 'week' ? rules.daysPerWeek : rules.daysPerMonth);
    base = Math.max(0, fixed - roundHalfUp((fixed * c.unpaid) / expectedHalfDays));
  }
  const overtime = roundHalfUp((c.overtime * e.overtime_hourly_rate) / 60);
  const gross = base + overtime + (extra.bonus ?? 0);
  return {
    halfDaysPresent: c.present,
    halfDaysPaidLeave: c.paidLeave,
    halfDaysUnpaid: c.unpaid,
    overtimeMinutes: c.overtime,
    base,
    overtime,
    gross,
    net: gross - (extra.advances ?? 0) - (extra.deductions ?? 0),
  };
}

/** Lundi → dimanche de la semaine contenant `date` (YYYY-MM-DD). */
export function weekBounds(date: string): [string, string] {
  const d = new Date(`${date}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  const start = new Date(d.getTime() - dow * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

export function monthBounds(date: string): [string, string] {
  const [y, m] = date.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`];
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
