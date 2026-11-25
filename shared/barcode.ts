// Détection et validation des formats de codes-barres. Les codes sont TOUJOURS manipulés comme du texte.

export type BarcodeFormat = 'EAN-13' | 'EAN-8' | 'UPC-A' | 'UPC-E' | 'ITF-14' | 'GS1-128' | 'CODE-128/39' | 'QR/2D' | 'INCONNU';

export interface BarcodeInfo {
  code: string;
  format: BarcodeFormat;
  checksumValid: boolean | null; // null = format sans clé de contrôle vérifiable
  valid: boolean;
}

/** Clé de contrôle GS1 (EAN/UPC/ITF) sur tous les chiffres sauf le dernier. */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

function gs1Valid(code: string): boolean {
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/** Développe un UPC-E (8 chiffres) en UPC-A pour vérifier la clé. */
export function upcEtoUpcA(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0];
  const d = upce.slice(1, 7);
  const check = upce[7];
  let body: string;
  const last = d[5];
  if (last <= '2') body = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') body = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') body = d.slice(0, 4) + '00000' + d[4];
  else body = d.slice(0, 5) + '0000' + last;
  return ns + body + check;
}

export function sanitizeBarcode(raw: string): string {
  // supprime les caractères de contrôle (CR/LF/TAB, préfixes AIM éventuels non imprimables) — conserve les zéros initiaux
  return raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
}

export function analyzeBarcode(raw: string): BarcodeInfo {
  const code = sanitizeBarcode(raw);
  const digits = /^\d+$/.test(code);
  if (!code) return { code, format: 'INCONNU', checksumValid: null, valid: false };
  if (digits && code.length === 13) {
    const ok = gs1Valid(code);
    return { code, format: 'EAN-13', checksumValid: ok, valid: ok };
  }
  if (digits && code.length === 12) {
    const ok = gs1Valid(code);
    return { code, format: 'UPC-A', checksumValid: ok, valid: ok };
  }
  if (digits && code.length === 14) {
    const ok = gs1Valid(code);
    return { code, format: 'ITF-14', checksumValid: ok, valid: ok };
  }
  if (digits && code.length === 8) {
    if (gs1Valid(code)) return { code, format: 'EAN-8', checksumValid: true, valid: true };
    const a = upcEtoUpcA(code);
    if (a && gs1Valid(a)) return { code, format: 'UPC-E', checksumValid: true, valid: true };
    return { code, format: 'EAN-8', checksumValid: false, valid: false };
  }
  if (/^\]C1|^\(\d{2,4}\)/.test(code)) return { code, format: 'GS1-128', checksumValid: null, valid: true };
  if (code.length > 48 || /[^\x20-\x7e]/.test(code)) return { code, format: 'QR/2D', checksumValid: null, valid: true };
  // Code 128 / Code 39 / codes internes : ASCII imprimable
  if (/^[\x20-\x7e]{1,48}$/.test(code)) return { code, format: 'CODE-128/39', checksumValid: null, valid: true };
  return { code, format: 'INCONNU', checksumValid: null, valid: false };
}

/** Génère un EAN-13 interne (préfixe 2xx réservé à l'usage interne / magasin). */
export function generateInternalEan13(seq: number): string {
  const body = ('20' + String(seq).padStart(10, '0')).slice(0, 12);
  return body + gs1CheckDigit(body);
}
