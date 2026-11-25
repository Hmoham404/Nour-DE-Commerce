import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, Trash2 } from 'lucide-react';
import { api, newKey } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { computeLine, computeTotals } from '../../shared/pricing';
import { ProductPicker } from '../components/ProductPicker';
import { EntitySelect } from '../components/common';
import { Button, Card, Checkbox, ErrorBox, Field, Input, MoneyInput, PageHeader, useConfirm, useToast } from '../components/ui';

/** Réception de marchandises par scan : quantité, lot, péremption ; stock mis à jour à la validation. */
export default function ReceiptForm() {
  const [sp] = useSearchParams();
  const poId = sp.get('po');
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canPrice = can('purchases.manage', 'finance.view');
  const [supplier, setSupplier] = useState<{ id: string | null; name?: string }>({ id: null });
  const [po, setPo] = useState<any | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [docRef, setDocRef] = useState('');
  const [notes, setNotes] = useState('');
  const [extra, setExtra] = useState<number | null>(0);
  const [createInvoice, setCreateInvoice] = useState(canPrice);
  const [invoiceRef, setInvoiceRef] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());

  useEffect(() => {
    if (!poId) return;
    api.get(`/api/purchases/orders/${poId}`).then((d) => {
      setPo(d);
      setSupplier({ id: d.supplier_id, name: d.supplier_name });
      // lignes pré-remplies avec le reliquat, quantité reçue à 0 (à scanner ou saisir)
      setItems(d.items.filter((i: any) => i.qty_received < i.qty_ordered).map((i: any) => ({
        product_id: i.product_id, name: i.product_name, po_item_id: i.id, expected: i.qty_ordered - i.qty_received, qty: 0, unit_price: i.unit_price, discount_bp: i.discount_bp, vat_bp: i.vat_bp, track_batches: !!i.track_batches, batch_number: '', expires_at: '',
      })));
    });
  }, [poId]);

  const add = (p: any, q: number) => {
    setItems((it) => {
      const i = it.findIndex((x) => x.product_id === p.id && !x.batch_number);
      if (i >= 0) return it.map((x, j) => (j === i ? { ...x, qty: x.qty + q } : x));
      return [...it, { product_id: p.id, name: p.name, qty: q, unit_price: p.purchase_price ?? 0, discount_bp: 0, vat_bp: p.vat_bp, track_batches: !!p.track_batches, batch_number: '', expires_at: '' }];
    });
  };
  const set = (i: number, k: string, v: any) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const valid = items.filter((i) => i.qty > 0);
  const totals = computeTotals(valid.map((i) => computeLine(i.unit_price, i.qty, i.discount_bp, i.vat_bp)));

  const submit = async () => {
    const missing = valid.find((i) => i.track_batches && !i.batch_number);
    if (missing) return setError(`Numéro de lot requis pour « ${missing.name} ».`);
    if (!(await confirm({ title: 'Confirmer la réception', message: <p>{valid.reduce((s, i) => s + i.qty, 0)} unité(s) vont entrer en stock. Cette opération met à jour le stock et le coût moyen.</p> }))) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/purchases/receipts', {
        idempotency_key: key.current,
        supplier_id: supplier.id,
        po_id: poId,
        supplier_doc_ref: docRef || null,
        notes: notes || null,
        extra_costs: canPrice ? extra ?? 0 : 0,
        create_invoice: canPrice && createInvoice,
        invoice_supplier_ref: invoiceRef || null,
        invoice_due_date: due || null,
        items: valid.map((i) => ({ product_id: i.product_id, po_item_id: i.po_item_id ?? null, qty: i.qty, unit_price: canPrice ? i.unit_price : undefined, discount_bp: i.discount_bp, vat_bp: i.vat_bp, batch_number: i.batch_number || null, expires_at: i.expires_at || null })),
      });
      toast.success(`Réception ${r.number} validée — stock mis à jour`);
      nav(`/achats/receptions/${r.id}`, { replace: true });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={po ? `Réception de la commande ${po.number}` : 'Nouvelle réception'} actions={<Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav(-1)}>Retour</Button>} />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Fournisseur et document" className="md:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fournisseur" required>
              {po ? <div className="py-2 font-semibold">{supplier.name}</div> : <EntitySelect endpoint="/api/suppliers" value={supplier.id} label={supplier.name} onChange={(id, r) => setSupplier({ id, name: r?.name })} allowEmpty={false} />}
            </Field>
            <Field label="N° bon de livraison fournisseur">
              <Input value={docRef} onChange={(e) => setDocRef(e.target.value)} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
        {canPrice && (
          <Card title="Facturation">
            <div className="space-y-3">
              <Field label="Frais complémentaires (transport…)" hint="Répartis sur le coût de revient">
                <MoneyInput value={extra} onChange={setExtra} />
              </Field>
              <Checkbox checked={createInvoice} onChange={setCreateInvoice} label="Enregistrer la facture fournisseur" />
              {createInvoice && (
                <>
                  <Field label="N° facture fournisseur"><Input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} /></Field>
                  <Field label="Échéance"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
                </>
              )}
              <div className="border-t border-line pt-2 text-sm">
                <div className="flex justify-between"><span>Total HT</span><span className="num">{money(totals.subtotal_ht)}</span></div>
                <div className="flex justify-between font-bold"><span>Total TTC</span><span className="num">{money(totals.total_ttc + (extra ?? 0))}</span></div>
              </div>
            </div>
          </Card>
        )}
      </div>
      <div className="mt-4">
        <ProductPicker showCost={canPrice} onPick={add} placeholder="Scannez chaque produit reçu (lecteur Honeywell) — la quantité s'incrémente" />
      </div>
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start">Produit</th>
              {po && <th className="px-3 py-2 text-end">Attendu</th>}
              <th className="w-24 px-3 py-2 text-end">Reçu</th>
              {canPrice && <th className="w-36 px-3 py-2 text-end">P.U. HT</th>}
              <th className="w-36 px-3 py-2">Lot</th>
              <th className="w-40 px-3 py-2">Péremption</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className={'border-t border-line ' + (po && it.qty !== it.expected ? 'bg-amber-50/50 dark:bg-amber-950/20' : '')}>
                <td className="px-3 py-1.5">{it.name}{it.track_batches && <span className="ms-1 text-xs text-gold-600">(lots)</span>}</td>
                {po && <td className="num px-3 py-1.5 text-end">{it.expected ?? '—'}</td>}
                <td className="px-3 py-1.5"><Input type="number" min={0} className="h-8 text-end" value={it.qty} onChange={(e) => set(i, 'qty', Math.max(0, Number(e.target.value)))} /></td>
                {canPrice && <td className="px-3 py-1.5"><MoneyInput value={it.unit_price} onChange={(v) => set(i, 'unit_price', v ?? 0)} className="h-8" /></td>}
                <td className="px-3 py-1.5"><Input className="h-8" value={it.batch_number} onChange={(e) => set(i, 'batch_number', e.target.value)} placeholder={it.track_batches ? 'obligatoire' : 'facultatif'} /></td>
                <td className="px-3 py-1.5"><Input type="date" className="h-8" value={it.expires_at} onChange={(e) => set(i, 'expires_at', e.target.value)} /></td>
                <td className="px-2"><button className="text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7} className="p-6 text-center text-muted">Scannez les produits reçus.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
      <div className="mt-4 flex justify-end">
        <Button size="lg" variant="gold" icon={<PackageCheck className="size-5" />} loading={busy} disabled={!supplier.id || !valid.length} onClick={submit}>Confirmer la réception</Button>
      </div>
    </div>
  );
}
