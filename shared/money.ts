// Montants en millimes (entiers). 1 TND = 1000 millimes. Aucune arithmétique flottante sur les montants.

/** Convertit une saisie utilisateur ("12,5" / "12.500" / "1 234,750") en millimes. Retourne null si invalide. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/\s| | /g, '').replace(/(TND|DT|د\.ت)$/i, '');
  if (s === '') return null;
  // si à la fois . et , : le dernier est le séparateur décimal
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('');
    if (dec === ',') s = s.replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  const neg = m[1] === '-';
  const int = m[2] === '' ? 0 : Number(m[2]);
  let frac = (m[3] ?? '').padEnd(4, '0');
  // arrondi au millime (demi vers le haut) sur le 4e chiffre
  let millimes = int * 1000 + Number(frac.slice(0, 3));
  if (Number(frac[3]) >= 5) millimes += 1;
  if (!Number.isSafeInteger(millimes)) return null;
  return neg ? -millimes : millimes;
}

/** Formate des millimes en "1 234,500" (3 décimales, dinar tunisien). */
export function formatMoney(millimes: number | null | undefined, withCurrency = true, locale: 'fr' | 'ar' = 'fr'): string {
  const v = Number(millimes ?? 0);
  const neg = v < 0;
  const abs = Math.abs(Math.trunc(v));
  const int = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0');
  const intStr = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const out = `${neg ? '-' : ''}${intStr},${frac}`;
  if (!withCurrency) return out;
  return locale === 'ar' ? `${out} د.ت` : `${out} DT`;
}

/** Millimes → chaîne d'édition "12.500" (pour les champs de formulaire). */
export function toInputMoney(millimes: number | null | undefined): string {
  if (millimes === null || millimes === undefined) return '';
  const neg = millimes < 0;
  const abs = Math.abs(millimes);
  return `${neg ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** Applique un taux en points de base (1900 = 19 %) à un montant, arrondi au millime. */
export function applyBp(amount: number, bp: number): number {
  return roundHalfUp((amount * bp) / 10000);
}

export function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/** "19" / "19,5" % → points de base */
export function parsePercent(input: string | number | null | undefined): number | null {
  const m = parseMoney(input as any);
  if (m === null) return null;
  // parseMoney renvoie *1000 ; un pourcentage a 2 décimales utiles → bp = valeur*100
  return roundHalfUp(m / 10);
}

export function formatPercent(bp: number | null | undefined): string {
  const v = Number(bp ?? 0) / 100;
  return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}
