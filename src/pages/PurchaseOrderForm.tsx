import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PackageCheck, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dt, money } from '../lib/format';
import { computeLine, computeTotals } from '../../shared/pricing';
import { ProductPicker } from '../components/ProductPicker';
import { EntitySelect, openPrint } from '../components/common';
import { Badge, Button, Card, Field, Input, MoneyInput, PageHeader, PercentInput, Spinner, Textarea, useConfirm, useToast } from '../components/ui';
import { PO_STATUS } from './PurchaseOrders';

export default function PurchaseOrderForm() {
  const { id } = useParams();
  const isNew = id === 'nouvelle';
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useAuth();
  const [po, setPo] = useState<any>({ supplier_id: null, expected_date: '', notes: '', status: 'draft', items: [], receipts: [] });
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isNew) api.get(`/api/purchases/orders/${id}`).then((d) => (setPo(d), setLoading(false)));
  }, [id, isNew]);
  const editable = can('purchases.manage') && ['draft', 'ordered'].includes(po.status) && !po.receipts?.length;
  const lines = po.items.map((i: any) => ({ ...i, amounts: computeLine(i.unit_price, i.qty_ordered, i.discount_bp, i.vat_bp) }));
  const totals = computeTotals(lines.map((l: any) => l.amounts));
  const setItem = (i: number, k: string, v: any) => setPo({ ...po, items: po.items.map((x: any, j: number) => (j === i ? { ...x, [k]: v } : x)) });

  const save = async (status: 'draft' | 'ordered') => {
    setBusy(true);
    try {
      const body = { supplier_id: po.supplier_id, expected_date: po.expected_date || null, notes: po.notes || null, status, items: po.items.map((i: any) => ({ product_id: i.product_id, qty_ordered: i.qty_ordered, unit_price: i.unit_price, discount_bp: i.discount_bp, vat_bp: i.vat_bp })) };
      if (isNew) {
        const r = await api.post('/api/purchases/orders', body);
        nav(`/achats/commandes/${r.id}`, { replace: true });
        window.location.reload();
      } else {
        await api.put(`/api/purchases/orders/${id}`, body);
        setPo({ ...po, status });
        toast.success('Commande enregistrée');
      }
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={isNew ? 'Nouvelle commande fournisseur' : `Commande ${po.number}`}
        subtitle={!isNew && <><Badge color={PO_STATUS[po.status][1]}>{PO_STATUS[po.status][0]}</Badge> · {po.supplier_name}</>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/achats/commandes')}>Retour</Button>
            {!isNew && <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('commande-fournisseur', id!)}>Imprimer</Button>}
            {!isNew && ['ordered', 'partial'].includes(po.status) && can('receipts.manage') && (
              <Button variant="gold" icon={<PackageCheck className="size-4" />} onClick={() => nav(`/achats/receptions/nouvelle?po=${id}`)}>Réceptionner</Button>
            )}
            {!isNew && ['draft', 'ordered'].includes(po.status) && can('purchases.manage') && !po.receipts?.length && (
              <Button variant="outline" onClick={async () => {
                if (!(await confirm({ title: 'Annuler la commande', danger: true }))) return;
                await api.post(`/api/purchases/orders/${id}/status`, { status: 'cancelled' });
                setPo({ ...po, status: 'cancelled' });
              }}>Annuler la commande</Button>
            )}
            {!isNew && po.status === 'partial' && can('purchases.manage') && (
              <Button variant="outline" onClick={async () => { await api.post(`/api/purchases/orders/${id}/status`, { status: 'received' }); setPo({ ...po, status: 'received' }); }}>Clôturer (reliquat abandonné)</Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Fournisseur" className="md:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fournisseur" required>
              {editable || isNew ? <EntitySelect endpoint="/api/suppliers" value={po.supplier_id} label={po.supplier_name} onChange={(v) => setPo({ ...po, supplier_id: v })} allowEmpty={false} /> : <div className="py-2 font-semibold">{po.supplier_name}</div>}
            </Field>
            <Field label="Livraison prévue">
              <Input type="date" value={po.expected_date ?? ''} disabled={!editable && !isNew} onChange={(e) => setPo({ ...po, expected_date: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea value={po.notes ?? ''} disabled={!editable && !isNew} onChange={(e) => setPo({ ...po, notes: e.target.value })} />
            </Field>
          </div>
        </Card>
        <Card title="Totaux">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Total HT</span><span className="num">{money(totals.subtotal_ht)}</span></div>
            <div className="flex justify-between"><span>TVA</span><span className="num">{money(totals.total_vat)}</span></div>
            <div className="flex justify-between text-lg font-bold"><span>Total TTC</span><span className="num">{money(totals.total_ttc)}</span></div>
          </div>
        </Card>
      </div>
      {(editable || isNew) && (
        <div className="mt-4">
          <ProductPicker showCost onPick={(p, q) => {
            const i = po.items.findIndex((x: any) => x.product_id === p.id);
            if (i >= 0) return setItem(i, 'qty_ordered', po.items[i].qty_ordered + q);
            setPo({ ...po, items: [...po.items, { product_id: p.id, product_name: p.name, reference: p.reference, qty_ordered: q, qty_received: 0, unit_price: p.purchase_price ?? 0, discount_bp: 0, vat_bp: p.vat_bp }] });
          }} />
        </div>
      )}
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start">Produit</th>
              <th className="w-24 px-3 py-2 text-end">Qté</th>
              {!isNew && <th className="px-3 py-2 text-end">Reçu</th>}
              <th className="w-36 px-3 py-2 text-end">P.U. HT</th>
              <th className="w-28 px-3 py-2 text-end">Remise</th>
              <th className="px-3 py-2 text-end">Total HT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l: any, i: number) => (
              <tr key={l.product_id} className="border-t border-line">
                <td className="px-3 py-1.5">{l.product_name}</td>
                <td className="px-3 py-1.5">{editable || isNew ? <Input type="number" min={1} className="h-8 text-end" value={l.qty_ordered} onChange={(e) => setItem(i, 'qty_ordered', Math.max(1, Number(e.target.value)))} /> : <span className="num block text-end">{l.qty_ordered}</span>}</td>
                {!isNew && <td className="num px-3 py-1.5 text-end">{l.qty_received}</td>}
                <td className="px-3 py-1.5">{editable || isNew ? <MoneyInput value={l.unit_price} onChange={(v) => setItem(i, 'unit_price', v ?? 0)} className="h-8" /> : <span className="num block text-end">{money(l.unit_price, false)}</span>}</td>
                <td className="px-3 py-1.5">{editable || isNew ? <PercentInput value={l.discount_bp} onChange={(v) => setItem(i, 'discount_bp', v)} className="h-8" /> : <span className="num block text-end">{l.discount_bp / 100} %</span>}</td>
                <td className="num px-3 py-1.5 text-end">{money(l.amounts.line_ht)}</td>
                <td className="px-2">{(editable || isNew) && <button className="text-red-600" onClick={() => setPo({ ...po, items: po.items.filter((_: any, j: number) => j !== i) })}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(editable || isNew) && (
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" loading={busy} disabled={!po.supplier_id || !po.items.length} onClick={() => save('draft')}>Enregistrer le brouillon</Button>
          <Button loading={busy} disabled={!po.supplier_id || !po.items.length} onClick={() => save('ordered')}>Valider la commande</Button>
        </div>
      )}
      {po.receipts?.length > 0 && (
        <Card title="Réceptions liées" className="mt-4">
          {po.receipts.map((r: any) => (
            <button key={r.id} className="block text-sm text-gold-600 hover:underline" onClick={() => nav(`/achats/receptions/${r.id}`)}>{r.number} — {dt(r.received_at)} — {money(r.total_ttc)}</button>
          ))}
        </Card>
      )}
    </div>
  );
}
