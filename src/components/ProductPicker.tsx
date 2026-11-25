import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDebounce } from '../lib/hooks';
import { money } from '../lib/format';
import { BarcodeScanner } from './scanner/BarcodeScanner';

/** Ajout de produits par scan Honeywell, caméra ou recherche par nom/référence. */
export function ProductPicker({ onPick, showCost, placeholder }: { onPick: (product: any, qty: number) => void; showCost?: boolean; placeholder?: string }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const dq = useDebounce(text, 200);
  useEffect(() => {
    if (dq.trim().length < 2) return setRows([]);
    api.get(`/api/products?q=${encodeURIComponent(dq)}&pageSize=12`).then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [dq]);
  return (
    <div className="relative">
      <BarcodeScanner
        placeholder={placeholder}
        onType={setText}
        onScan={async (code) => {
          const r = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
          if (!r.found) return { ok: false, message: 'Code inconnu' };
          onPick(r.product, r.qty_per_unit);
          setRows([]);
          return { ok: true, message: r.product.name + (r.qty_per_unit > 1 ? ` ×${r.qty_per_unit}` : '') };
        }}
      />
      {rows.length > 0 && (
        <div className="absolute inset-x-0 top-14 z-30 max-h-80 overflow-y-auto rounded-xl border border-line bg-surface shadow-xl">
          {rows.map((p) => (
            <button
              key={p.id}
              className="flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2 text-start text-sm hover:bg-surface-2"
              onClick={() => {
                onPick(p, 1);
                setRows([]);
                setText('');
              }}
            >
              <span className="min-w-0">
                <b className="block truncate">{p.name}</b>
                <span className="text-xs text-muted">
                  {p.reference} · {p.barcode ?? 'sans code'} · stock {p.stock}
                </span>
              </span>
              <span className="num shrink-0 text-xs">{showCost && p.purchase_price !== null ? `achat ${money(p.purchase_price)}` : money(p.sale_price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
