import { describe, it, expect } from 'vitest';
import { computePay, weekBounds, monthBounds, datesBetween, type AttendanceDay } from '../shared/payroll';

const rules = { daysPerWeek: 6, daysPerMonth: 26, paidStatuses: ['leave', 'holiday'] as any };
const days = (spec: string): AttendanceDay[] =>
  [...spec].map((c) => ({ status: ({ P: 'present', H: 'half', A: 'absent', C: 'leave', M: 'sick', F: 'holiday' } as any)[c] }));

describe('Paie', () => {
  it('journalier : jours présents × taux, demi-journée = moitié, congé payé', () => {
    const e = { pay_type: 'daily' as const, daily_rate: 25000, weekly_salary: 0, monthly_salary: 0, overtime_hourly_rate: 0 };
    expect(computePay(e, days('PPPPPA'), 'week', rules).base).toBe(125000);
    expect(computePay(e, days('PPPPPH'), 'week', rules).base).toBe(137500);
    expect(computePay(e, days('PPPPPC'), 'week', rules).base).toBe(150000);
  });
  it('mensuel : salaire fixe moins les absences au prorata (26 jours)', () => {
    const e = { pay_type: 'monthly' as const, daily_rate: 0, weekly_salary: 0, monthly_salary: 780000, overtime_hourly_rate: 0 };
    expect(computePay(e, days('PPPP'), 'month', rules).base).toBe(780000);
    expect(computePay(e, days('PPA'), 'month', rules).base).toBe(750000); // 780 − 780/26
    expect(computePay(e, days('PPM'), 'month', rules).base).toBe(750000); // maladie non payée par défaut
    expect(computePay(e, days('PPH'), 'month', rules).base).toBe(765000);
    expect(computePay(e, days('PPC'), 'month', rules).base).toBe(780000);
  });
  it('hebdomadaire et conversion de période', () => {
    const e = { pay_type: 'weekly' as const, daily_rate: 0, weekly_salary: 180000, monthly_salary: 0, overtime_hourly_rate: 0 };
    expect(computePay(e, days('PPPPPA'), 'week', rules).base).toBe(150000);
    expect(computePay(e, days(''), 'month', rules).base).toBe(780000); // 180 × 26 / 6
  });
  it('heures supplémentaires, prime, avances, retenues', () => {
    const e = { pay_type: 'daily' as const, daily_rate: 20000, weekly_salary: 0, monthly_salary: 0, overtime_hourly_rate: 3000 };
    const r = computePay(e, [{ status: 'present', overtime_minutes: 90 }, { status: 'present' }], 'week', rules, { bonus: 10000, advances: 15000, deductions: 2000 });
    expect(r.base).toBe(40000);
    expect(r.overtime).toBe(4500);
    expect(r.gross).toBe(54500);
    expect(r.net).toBe(37500);
  });
  it('bornes de semaine et de mois', () => {
    expect(weekBounds('2026-11-25')).toEqual(['2026-11-23', '2026-11-29']);
    expect(monthBounds('2026-02-10')).toEqual(['2026-02-01', '2026-02-28']);
    expect(datesBetween('2026-11-29', '2026-12-01')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
  });
});
