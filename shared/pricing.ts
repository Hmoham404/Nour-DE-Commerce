import { applyBp, roundHalfUp } from './money';

export type CustomerType = 'particulier' | 'detaillant' | 'grossiste' | 'distributeur';

export interface PricedProduct {
  id: string;
  category_id?: string | null;
  sale_price: number;
  price_retail?: number | null;
  price_wholesale?: number | null;
  price_distributor?: number | null;
  vat_bp: number;
}

export interface DiscountRule {
  id: string;
  name: string;
  priority: number;
  product_id?: string | null;
  category_id?: string | null;
  customer_type?: string | null;
  min_qty: number;
  min_amount: number;
  discount_bp: number;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active: number | boolean;
}

/** Prix unitaire HT selon le tarif (type de client), avec repli sur le prix particulier. */
export function tierPrice(p: PricedProduct, tier: CustomerType, customPrice?: number | null): number {
  if (customPrice !== null && customPrice !== undefined) return customPrice;
  const map: Record<CustomerType, number | null | undefined> = {
    particulier: p.sale_price,
    detaillant: p.price_retail,
    grossiste: p.price_wholesale,
    distributeur: p.price_distributor,
  };
  const v = map[tier];
  return v === null || v === undefined ? p.sale_price : v;
}

/**
 * Sélectionne la règle de remise applicable.
 * Ordre : priorité la plus faible d'abord (1 = plus prioritaire) ; à priorité égale, la plus forte remise.
 */
export function findDiscountRule(
  rules: DiscountRule[],
  ctx: { product: PricedProduct; customerType: CustomerType; qty: number; cartAmount: number; date: string },
): DiscountRule | null {
  const candidates = rules.filter((r) => {
    if (!r.is_active) return false;
    if (r.product_id && r.product_id !== ctx.product.id) return false;
    if (r.category_id && r.category_id !== ctx.product.category_id) return false;
    if (r.customer_type && r.customer_type !== ctx.customerType) return false;
    if (ctx.qty < (r.min_qty || 0)) return false;
    if (ctx.cartAmount < (r.min_amount || 0)) return false;
    const d = ctx.date.slice(0, 10);
    if (r.starts_at && d < r.starts_at.slice(0, 10)) return false;
    if (r.ends_at && d > r.ends_at.slice(0, 10)) return false;
    return true;
  });
  candidates.sort((a, b) => a.priority - b.priority || b.discount_bp - a.discount_bp);
  return candidates[0] ?? null;
}

export interface LineAmounts {
  gross_ht: number;
  discount: number;
  line_ht: number;
  line_vat: number;
  line_ttc: number;
}

/** Calcule une ligne : HT brut, remise, HT net, TVA, TTC (millimes, arrondi au millime). */
export function computeLine(unitPriceHt: number, qty: number, discountBp: number, vatBp: number): LineAmounts {
  const gross = unitPriceHt * qty;
  const lineHt = roundHalfUp((gross * (10000 - discountBp)) / 10000);
  const vat = applyBp(lineHt, vatBp);
  return { gross_ht: gross, discount: gross - lineHt, line_ht: lineHt, line_vat: vat, line_ttc: lineHt + vat };
}

export interface Totals {
  gross_ht: number;
  discount_total: number;
  subtotal_ht: number;
  total_vat: number;
  stamp: number;
  total_ttc: number;
}

export function computeTotals(lines: LineAmounts[], stamp = 0): Totals {
  const t = lines.reduce(
    (acc, l) => {
      acc.gross_ht += l.gross_ht;
      acc.discount_total += l.discount;
      acc.subtotal_ht += l.line_ht;
      acc.total_vat += l.line_vat;
      return acc;
    },
    { gross_ht: 0, discount_total: 0, subtotal_ht: 0, total_vat: 0 },
  );
  return { ...t, stamp, total_ttc: t.subtotal_ht + t.total_vat + stamp };
}

export function priceTtc(ht: number, vatBp: number): number {
  return ht + applyBp(ht, vatBp);
}

/** HT à partir d'un TTC saisi. */
export function htFromTtc(ttc: number, vatBp: number): number {
  return roundHalfUp((ttc * 10000) / (10000 + vatBp));
}

/** Taux de marge = marge / coût ; taux de marque = marge / prix de vente. Retourne des bp. */
export function marginRates(saleHt: number, cost: number) {
  const margin = saleHt - cost;
  return {
    margin,
    markup_bp: cost > 0 ? roundHalfUp((margin * 10000) / cost) : null,
    margin_bp: saleHt > 0 ? roundHalfUp((margin * 10000) / saleHt) : null,
  };
}

/** Coût moyen pondéré après une entrée. */
export function weightedAverageCost(oldQty: number, oldCost: number, inQty: number, inCost: number): number {
  const base = Math.max(oldQty, 0);
  if (base + inQty <= 0) return inCost;
  return roundHalfUp((base * oldCost + inQty * inCost) / (base + inQty));
}
