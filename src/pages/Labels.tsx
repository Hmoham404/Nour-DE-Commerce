import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import { priceTtc } from '../../shared/pricing';
import { analyzeBarcode } from '../../shared/barcode';
import { ProductPicker } from '../components/ProductPicker';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select } from '../components/ui';

function BarcodeSvg({ code, height }: { code: string; height: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const f = analyzeBarcode(code).format;
    const format = f === 'EAN-13' && analyzeBarcode(code).valid ? 'EAN13' : f === 'EAN-8' && analyzeBarcode(code).valid ? 'EAN8' : f === 'UPC-A' && analyzeBarcode(code).valid ? 'UPC' : 'CODE128';
    try {
      JsBarcode(ref.current, code, { format, height, fontSize: 12, margin: 2, width: 1.6, displayValue: true });
    } catch {
      JsBarcode(ref.current, code, { format: 'CODE128', height, fontSize: 12, margin: 2, width: 1.4 });
    }
  }, [code, height]);
  return <svg ref={ref} className="max-w-full" />;
}

/** Génération et impression d'étiquettes code-barres. */
export default function Labels() {
  const [sp] = useSearchParams();
  const [items, setItems] = useState<{ product: any; copies: number }[]>([]);
  const [size, setSize] = useState('50x30');
  const [showPrice, setShowPrice] = useState(true);
  useEffect(() => {
    const ids = sp.get('ids')?.split(',').filter(Boolean) ?? [];
    Promise.all(ids.map((id) => api.get(`/api/products/${id}`))).then((ps) => setItems(ps.map((p) => ({ product: { ...p, barcode: p.barcodes?.[0]?.barcode }, copies: 1 }))));
  }, [sp]);
  const [w, h] = size.split('x').map(Number);
  const labels = items.flatMap((it) => Array.from({ length: it.copies }, () => it.product)).filter((p) => p.barcode);
  return (
    <div>
      <div className="no-print">
        <PageHeader title="Codes-barres" subtitle="Génération et impression d'étiquettes" actions={<Button icon={<Printer className="size-4" />} disabled={!labels.length} onClick={() => window.print()}>Imprimer ({labels.length})</Button>} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Produits" className="lg:col-span-2">
            <ProductPicker onPick={async (p) => {
              const full = p.barcode ? p : { ...p, barcode: (await api.get(`/api/products/${p.id}`)).barcodes?.[0]?.barcode };
              setItems((x) => (x.some((i) => i.product.id === p.id) ? x : [...x, { product: full, copies: 1 }]));
            }} />
            <div className="mt-3 space-y-2">
              {items.map((it, i) => (
                <div key={it.product.id} className="flex items-center gap-2 rounded-lg border border-line p-2 text-sm">
                  <span className="flex-1 truncate">{it.product.name} <span className="num text-muted">{it.product.barcode ?? '(sans code-barres — à générer dans la fiche)'}</span></span>
                  <Input type="number" min={1} max={500} className="h-8 w-20" value={it.copies} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, copies: Math.max(1, Number(e.target.value)) } : x)))} />
                  <button className="text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Format">
            <div className="space-y-3">
              <Field label="Taille d'étiquette (mm)">
                <Select value={size} onChange={(e) => setSize(e.target.value)}>
                  <option value="50x30">50 × 30</option>
                  <option value="40x25">40 × 25</option>
                  <option value="60x40">60 × 40</option>
                  <option value="70x37">70 × 37 (planche A4 3×8)</option>
                </Select>
              </Field>
              <Checkbox checked={showPrice} onChange={setShowPrice} label="Afficher le prix TTC" />
            </div>
          </Card>
        </div>
        <h3 className="mb-2 mt-6 font-semibold">Aperçu</h3>
      </div>
      <div className="print-area flex flex-wrap gap-1">
        {labels.map((p, i) => (
          <div key={i} className="flex flex-col items-center justify-center overflow-hidden border border-dashed border-slate-300 bg-white p-1 text-black" style={{ width: `${w}mm`, height: `${h}mm`, breakInside: 'avoid' }}>
            <div className="w-full truncate text-center text-[9px] font-semibold leading-tight">{p.name}</div>
            <BarcodeSvg code={p.barcode} height={Math.max(20, h * 1.3)} />
            {showPrice && <div className="num text-[11px] font-bold">{money(priceTtc(p.sale_price, p.vat_bp))}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
