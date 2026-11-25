import { describe, it, expect } from 'vitest';
import { parseMoney, formatMoney, toInputMoney, parsePercent } from '../shared/money';
import { computeLine, computeTotals, findDiscountRule, tierPrice, weightedAverageCost, htFromTtc, marginRates } from '../shared/pricing';
import { analyzeBarcode, gs1CheckDigit, generateInternalEan13 } from '../shared/barcode';
import { ScanBuffer, DEFAULT_SCANNER_CONFIG } from '../shared/scanner';
import { localRangeToUtc, periodRange } from '../shared/dates';

describe('Montants (millimes)', () => {
  it('parse les saisies françaises et décimales', () => {
    expect(parseMoney('12,5')).toBe(12500);
    expect(parseMoney('12.500')).toBe(12500);
    expect(parseMoney('1 234,750')).toBe(1234750);
    expect(parseMoney('1.234,75')).toBe(1234750);
    expect(parseMoney('0,0015')).toBe(2); // arrondi au millime
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-3')).toBe(-3000);
  });
  it('formate avec 3 décimales', () => {
    expect(formatMoney(1234750)).toBe('1 234,750 DT');
    expect(formatMoney(5, false)).toBe('0,005');
    expect(formatMoney(-1500, false)).toBe('-1,500');
    expect(toInputMoney(12500)).toBe('12.500');
  });
  it('pourcentages en points de base', () => {
    expect(parsePercent('19')).toBe(1900);
    expect(parsePercent('7,5')).toBe(750);
  });
  it('évite les erreurs flottantes classiques', () => {
    // 0.1 + 0.2 en millimes
    expect(parseMoney('0.1')! + parseMoney('0.2')!).toBe(parseMoney('0.3'));
  });
});

describe('Tarification et remises', () => {
  const p = { id: 'p1', category_id: 'c1', sale_price: 2000, price_retail: 1800, price_wholesale: 1600, price_distributor: null, vat_bp: 1900 };
  it('applique le tarif selon le type de client', () => {
    expect(tierPrice(p, 'particulier')).toBe(2000);
    expect(tierPrice(p, 'grossiste')).toBe(1600);
    expect(tierPrice(p, 'distributeur')).toBe(2000); // repli
    expect(tierPrice(p, 'grossiste', 1500)).toBe(1500); // tarif personnalisé
  });
  const rules = [
    { id: 'r1', name: '10-49', priority: 10, min_qty: 10, min_amount: 0, discount_bp: 500, is_active: 1 },
    { id: 'r2', name: '50+', priority: 5, min_qty: 50, min_amount: 0, discount_bp: 1000, is_active: 1 },
    { id: 'r3', name: 'inactive', priority: 1, min_qty: 0, min_amount: 0, discount_bp: 9000, is_active: 0 },
    { id: 'r4', name: 'promo passée', priority: 1, min_qty: 0, min_amount: 0, discount_bp: 3000, is_active: 1, ends_at: '2020-01-01' },
  ];
  const ctx = (qty: number) => ({ product: p, customerType: 'particulier' as const, qty, cartAmount: 0, date: '2026-11-25' });
  it('sélectionne la règle selon la quantité et la priorité', () => {
    expect(findDiscountRule(rules, ctx(5))).toBeNull();
    expect(findDiscountRule(rules, ctx(10))?.id).toBe('r1');
    expect(findDiscountRule(rules, ctx(60))?.id).toBe('r2');
  });
  it('calcule HT, TVA, TTC et timbre', () => {
    const l = computeLine(2000, 3, 500, 1900); // 6.000 - 5% = 5.700 ; TVA 19% = 1.083
    expect(l).toEqual({ gross_ht: 6000, discount: 300, line_ht: 5700, line_vat: 1083, line_ttc: 6783 });
    const t = computeTotals([l, computeLine(1000, 1, 0, 700)], 1000);
    expect(t.subtotal_ht).toBe(6700);
    expect(t.total_vat).toBe(1083 + 70);
    expect(t.total_ttc).toBe(6700 + 1153 + 1000);
  });
  it('coût moyen pondéré, HT depuis TTC, marges', () => {
    expect(weightedAverageCost(10, 1000, 10, 2000)).toBe(1500);
    expect(weightedAverageCost(0, 0, 5, 1234)).toBe(1234);
    expect(htFromTtc(1190, 1900)).toBe(1000);
    expect(marginRates(1500, 1000)).toEqual({ margin: 500, markup_bp: 5000, margin_bp: 3333 });
  });
});

describe('Codes-barres', () => {
  it('valide EAN-13 / EAN-8 / UPC-A / ITF-14', () => {
    expect(analyzeBarcode('6191234567897').format).toBe('EAN-13');
    expect(gs1CheckDigit('619123456789')).toBe(7);
    expect(analyzeBarcode('6191234567897').valid).toBe(true);
    expect(analyzeBarcode('6191234567891').valid).toBe(false);
    expect(analyzeBarcode('96385074').format).toBe('EAN-8');
    expect(analyzeBarcode('036000291452').format).toBe('UPC-A');
    expect(analyzeBarcode('036000291452').valid).toBe(true);
    expect(analyzeBarcode('00012345600012').format).toBe('ITF-14');
  });
  it('conserve les zéros initiaux et nettoie les caractères de contrôle', () => {
    expect(analyzeBarcode('0012345678905\r\n').code).toBe('0012345678905');
    expect(analyzeBarcode('ABC-123').format).toBe('CODE-128/39');
  });
  it('génère des EAN-13 internes valides', () => {
    const c = generateInternalEan13(42);
    expect(c).toHaveLength(13);
    expect(c.startsWith('20')).toBe(true);
    expect(analyzeBarcode(c).valid).toBe(true);
  });
});

describe('Lecteur Honeywell (USB HID simulé)', () => {
  const type = (buf: ScanBuffer, code: string, start: number, interval: number, suffix = 'Enter') => {
    let t = start;
    let last: any = null;
    for (const ch of code) {
      buf.feed(ch, t);
      t += interval;
    }
    last = buf.feed(suffix, t - interval + 5);
    return { res: last, end: t };
  };
  it('détecte un scan rapide terminé par Enter', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG });
    const { res } = type(b, '6191234567897', 1000, 8);
    expect(res.kind).toBe('scan');
    expect(res.event.code).toBe('6191234567897');
  });
  it('ignore la frappe humaine lente', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG });
    const { res } = type(b, '123456', 1000, 180);
    expect(res.kind).toBe('ignore');
  });
  it('élimine un double événement involontaire mais respecte un scan répété volontaire', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, dedupeMs: 250 });
    expect(type(b, '12345678', 1000, 5).res.kind).toBe('scan');
    expect(type(b, '12345678', 1100, 5).res.kind).toBe('duplicate'); // < 250 ms
    expect(type(b, '12345678', 1600, 5).res.kind).toBe('scan'); // scan intentionnel
  });
  it('enchaîne des scans consécutifs rapides de codes différents', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG });
    expect(type(b, '11111111', 1000, 5).res.event.code).toBe('11111111');
    expect(type(b, '22222222', 1060, 5).res.event.code).toBe('22222222');
  });
  it('supporte le suffixe Tab et le mode sans suffixe', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, suffix: 'Tab' });
    expect(type(b, '0001234', 1000, 5, 'Tab').res.event.code).toBe('0001234');
    const n = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, suffix: 'none', idleTimeout: 100 });
    for (const [i, ch] of [...'98765432'].entries()) n.feed(ch, 1000 + i * 5);
    expect(n.idle(1050)).toBeNull();
    expect(n.idle(1200)?.kind).toBe('scan');
  });
  it('rejette les codes trop courts', () => {
    const b = new ScanBuffer({ ...DEFAULT_SCANNER_CONFIG, minLength: 4 });
    expect(type(b, '12', 1000, 5).res.kind).toBe('ignore');
  });
});

describe('Dates Africa/Tunis', () => {
  it('convertit une journée locale en bornes UTC', () => {
    expect(localRangeToUtc('2026-11-25', '2026-11-25')).toEqual(['2026-11-24 23:00:00', '2026-11-25 22:59:59']);
  });
  it('calcule les périodes', () => {
    const r = periodRange('custom', { from: '2026-01-01', to: '2026-01-31' });
    expect(r.from).toBe('2026-01-01');
  });
});
