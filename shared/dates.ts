// Africa/Tunis = UTC+1 sans heure d'été (depuis 2009). Les dates sont stockées en UTC 'YYYY-MM-DD HH:MM:SS'.
export const TUNIS_OFFSET_MIN = 60;

export function nowUtcSql(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Date locale (Tunis) du jour 'YYYY-MM-DD'. */
export function todayTunis(d = new Date()): string {
  return new Date(d.getTime() + TUNIS_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

/** Bornes UTC SQL d'un intervalle de dates locales [from, to] inclus. */
export function localRangeToUtc(from: string, to: string): [string, string] {
  const start = new Date(`${from}T00:00:00+01:00`).toISOString().slice(0, 19).replace('T', ' ');
  const end = new Date(`${to}T23:59:59+01:00`).toISOString().slice(0, 19).replace('T', ' ');
  return [start, end];
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'year' | 'custom';

export function periodRange(key: PeriodKey, custom?: { from: string; to: string }): { from: string; to: string } {
  const today = todayTunis();
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'week': {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = dimanche
      const monday = addDays(today, -((dow + 6) % 7));
      return { from: monday, to: today };
    }
    case 'month':
      return { from: today.slice(0, 8) + '01', to: today };
    case 'year':
      return { from: today.slice(0, 5) + '01-01', to: today };
    default:
      return custom ?? { from: today, to: today };
  }
}

/** Affichage d'une date UTC SQL en heure de Tunis. */
export function formatDateTime(utc: string | null | undefined, withTime = true): string {
  if (!utc) return '';
  const iso = utc.length <= 10 ? `${utc}T00:00:00Z` : utc.replace(' ', 'T') + 'Z';
  const d = new Date(new Date(iso).getTime() + (utc.length <= 10 ? 0 : TUNIS_OFFSET_MIN * 60000));
  const s = d.toISOString();
  const date = `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return withTime && utc.length > 10 ? `${date} ${s.slice(11, 16)}` : date;
}
