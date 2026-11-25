// Montant en toutes lettres (français) pour les factures : « Arrêtée la présente facture à la somme de … ».
const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const TENS = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function below100(n: number): string {
  if (n <= 16) return UNITS[n];
  if (n < 20) return 'dix-' + UNITS[n - 10];
  if (n < 70) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    return TENS[t] + (u === 0 ? '' : u === 1 ? ' et un' : '-' + UNITS[u]);
  }
  if (n < 80) return 'soixante' + (n === 71 ? ' et onze' : '-' + below100(n - 60));
  if (n === 80) return 'quatre-vingts';
  return 'quatre-vingt-' + below100(n - 80);
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = '';
  if (h === 1) s = 'cent';
  else if (h > 1) s = UNITS[h] + ' cent' + (r === 0 ? 's' : '');
  if (r) s += (s ? ' ' : '') + below100(r);
  return s || 'zéro';
}

export function numberToWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'zéro';
  const parts: string[] = [];
  const billions = Math.floor(n / 1e9);
  const millions = Math.floor((n % 1e9) / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  if (billions) parts.push(below1000(billions) + ' milliard' + (billions > 1 ? 's' : ''));
  if (millions) parts.push(below1000(millions) + ' million' + (millions > 1 ? 's' : ''));
  if (thousands) parts.push(thousands === 1 ? 'mille' : below1000(thousands).replace(/cents$/, 'cent') + ' mille');
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
}

/** 1234567 millimes → « mille deux cent trente-quatre dinars et cinq cent soixante-sept millimes » */
export function amountInWords(millimes: number): string {
  const d = Math.floor(Math.abs(millimes) / 1000);
  const m = Math.abs(millimes) % 1000;
  let s = `${numberToWords(d)} dinar${d > 1 ? 's' : ''}`;
  if (m) s += ` et ${numberToWords(m)} millime${m > 1 ? 's' : ''}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
