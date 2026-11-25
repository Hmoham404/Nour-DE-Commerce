import { all, HttpError } from './lib';

export interface BatchAllocation {
  batch_id: string;
  batch_number: string;
  qty: number;
  expires_at: string | null;
}

/**
 * Répartit une sortie de stock sur les lots selon FEFO (First Expired, First Out).
 * Les lots périmés sont exclus si `allowExpired` est faux.
 */
export async function fefoAllocate(db: D1Database, productId: string, warehouseId: string, qty: number, allowExpired: boolean) {
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const batches = await all<any>(
    db,
    `SELECT id, batch_number, remaining_qty, expires_at FROM product_batches
      WHERE product_id = ? AND warehouse_id = ? AND remaining_qty > 0 ORDER BY expires_at IS NULL, expires_at, received_at, created_at`,
    productId,
    warehouseId,
  );
  let need = qty;
  let expiredQty = 0;
  const allocations: BatchAllocation[] = [];
  for (const b of batches) {
    if (need <= 0) break;
    if (b.expires_at && b.expires_at < today && !allowExpired) {
      expiredQty += b.remaining_qty;
      continue;
    }
    const take = Math.min(need, b.remaining_qty);
    allocations.push({ batch_id: b.id, batch_number: b.batch_number, qty: take, expires_at: b.expires_at });
    need -= take;
  }
  return { allocations, unallocated: need, expiredQty, hasBatches: batches.length > 0 };
}

export function batchDecrementStmts(db: D1Database, allocations: BatchAllocation[]): D1PreparedStatement[] {
  return allocations.map((a) => db.prepare('UPDATE product_batches SET remaining_qty = remaining_qty - ? WHERE id = ?').bind(a.qty, a.batch_id));
}

export function assertNotExpired(productName: string, r: { unallocated: number; expiredQty: number }, block: boolean) {
  if (block && r.unallocated > 0 && r.expiredQty > 0) {
    throw new HttpError(409, 'PRODUIT_PERIME', `Vente bloquée : le stock restant de « ${productName} » est périmé (${r.expiredQty} unité(s)).`);
  }
}
