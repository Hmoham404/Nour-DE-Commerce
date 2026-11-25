import { formatMoney, formatPercent, parseMoney, toInputMoney, parsePercent } from '../../shared/money';
import { formatDateTime, todayTunis } from '../../shared/dates';

export { formatMoney, formatPercent, parseMoney, toInputMoney, parsePercent, formatDateTime, todayTunis };

export const money = (v: number | null | undefined, cur = true) => (v === null || v === undefined ? '—' : formatMoney(v, cur));
export const dt = (v: string | null | undefined) => formatDateTime(v, true) || '—';
export const d = (v: string | null | undefined) => formatDateTime(v, false) || '—';
export const pct = (bp: number | null | undefined) => (bp === null || bp === undefined ? '—' : formatPercent(bp));
export const qty = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('fr-FR'));

export const CUSTOMER_TYPES: Record<string, string> = {
  particulier: 'Particulier',
  detaillant: 'Détaillant',
  grossiste: 'Grossiste',
  distributeur: 'Distributeur',
};
export const PAY_METHODS: Record<string, string> = { cash: 'Espèces', card: 'Carte', cheque: 'Chèque', transfer: 'Virement', other: 'Autre' };
export const MOVE_TYPES: Record<string, string> = {
  initial: 'Stock initial',
  entree_fournisseur: 'Entrée fournisseur',
  sortie_vente: 'Sortie vente',
  retour_client: 'Retour client',
  retour_fournisseur: 'Retour fournisseur',
  ajustement_inventaire: 'Ajustement inventaire',
  ajustement: 'Ajustement',
  endommage: 'Produit endommagé',
  perime: 'Produit périmé',
  transfert_entree: 'Transfert (entrée)',
  transfert_sortie: 'Transfert (sortie)',
  annulation_vente: 'Annulation vente',
};
export const PAYMENT_STATUS: Record<string, [string, string]> = {
  paid: ['Payée', 'green'],
  partial: ['Partielle', 'amber'],
  unpaid: ['Impayée', 'red'],
};
export const VERIF_STATUS: Record<string, [string, string]> = {
  pending: ['En attente', 'amber'],
  verified: ['Vérifiée', 'green'],
  anomaly: ['Anomalie', 'red'],
};
