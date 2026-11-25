import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, todayTunis } from '../lib/format';
import { computeLine, computeTotals, findDiscountRule, tierPrice, type CustomerType } from '../../shared/pricing';
import { ProductPicker } from '../components/ProductPicker';
import { EntitySelect, openPrint } from '../components/common';
import { Badge, Button, Card, Field, Input, PageHeader, PercentInput, Spinner, Textarea, useToast } from '../components/ui';
import { QUOTE_STATUS } from './Quotes';

export default function QuoteForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = id === 'nouveau';
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [doc, setDoc] = useState<any>({ kind: sp.get('kind') ?? 'quote', status: 'draft', items: [] });
  const [customer, setCustomer] = useState<any | null>(null);
  const [lines, setLines] = useState<{ product: any; qty: number; discount_bp: number | null }[]>([]);
  const [ctx, setCtx] = useState<any>({ rules: [], custom_prices: {} });
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) return;
    api.get(`/api/quotes/${id}`).then(async (q) => {
      setDoc(q);
      const ls = [];
      for (const it of q.items) ls.push({ product: await api.get(`/api/products/${it.product_id}`), qty: it.qty, discount_bp: it.discount_bp || null });
      setLines(ls);
      if (q.customer_id) setCustomer(await api.get(`/api/customers/${q.customer_id}`));
      setLoading(false);
    });
  }, [id, isNew]);
  useEffect(() => {
    api.get(`/api/sales/pricing-context${customer ? '?customer_id=' + customer.id : ''}`).then(setCtx).catch(() => {});
  }, [customer?.id]);

  const tier = (customer?.price_tier ?? customer?.type ?? 'particulier') as CustomerType;
  const priced = useMemo(() => {
    const cartAmount = lines.reduce((s, l) => s + tierPrice(l.product, tier, ctx.custom_prices[l.product.id]) * l.qty, 0);
    return lines.map((l) => {
      const unit = tierPrice(l.product, tier, ctx.custom_prices[l.product.id]);
      const rule = findDiscountRule(ctx.rules, { product: l.product, customerType: tier, qty: l.qty, cartAmount, date: todayTunis() });
      const disc = l.discount_bp ?? rule?.discount_bp ?? 0;
      return { ...l, unit, disc, amounts: computeLine(unit, l.qty, disc, l.product.vat_bp) };
    });
  }, [lines, tier, ctx]);
  const totals = computeTotals(priced.map((p) => p.amounts));
  const locked = doc.status === 'converted';

  const save = async () => {
    setBusy(true);
    try {
      const body = {
        kind: doc.kind,
        customer_id: customer?.id ?? null,
        customer_name: customer ? null : doc.customer_name ?? null,
        valid_until: doc.valid_until || null,
        notes: doc.notes || null,
        items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, discount_bp: l.discount_bp })),
      };
      if (isNew) {
        const r = await api.post('/api/quotes', body);
        toast.success('Document enregistré');
        nav(`/devis/${r.id}`, { replace: true });
        window.location.reload();
      } else {
        await api.put(`/api/quotes/${id}`, body);
        toast.success('Document enregistré');
      }
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status: string) => {
    await api.post(`/api/quotes/${id}/status`, { status });
    setDoc({ ...doc, status });
  };

  if (loading) return <Spinner />;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={isNew ? (doc.kind === 'quote' ? 'Nouveau devis' : 'Nouvelle commande client') : `${doc.kind === 'quote' ? 'Devis' : 'Commande'} ${doc.number}`}
        subtitle={!isNew && <Badge color={QUOTE_STATUS[doc.status][1]}>{QUOTE_STATUS[doc.status][0]}</Badge>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav(doc.kind === 'quote' ? '/devis' : '/commandes')}>
              Retour
            </Button>
            {!isNew && (
              <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('devis', id!)}>
                Imprimer / PDF
              </Button>
            )}
            {!isNew && !locked && doc.status !== 'cancelled' && (
              <>
                {doc.kind === 'quote' && (
                  <Button variant="outline" onClick={async () => {
                    const r = await api.post(`/api/quotes/${id}/to-order`);
                    toast.success('Commande client créée');
                    nav(`/devis/${r.id}`);
                    window.location.reload();
                  }}>
                    → Commande
                  </Button>
                )}
                {doc.status === 'draft' && <Button variant="outline" onClick={() => setStatus('sent')}>Marquer envoyé</Button>}
                <Button variant="outline" onClick={() => setStatus('cancelled')}>Annuler</Button>
                {can('pos.use') && (
                  <Button variant="gold" icon={<ShoppingCart className="size-4" />} onClick={() => nav(`/pos?devis=${id}`)}>
                    Transformer en vente
                  </Button>
                )}
              </>
            )}
          </>
        }
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Client" className="md:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client enregistré">
              <EntitySelect endpoint="/api/customers" value={customer?.id} label={customer?.name} onChange={async (cid) => setCustomer(cid ? await api.get(`/api/customers/${cid}`) : null)} />
            </Field>
            {!customer && (
              <Field label="ou nom du prospect">
                <Input value={doc.customer_name ?? ''} onChange={(e) => setDoc({ ...doc, customer_name: e.target.value })} disabled={locked} />
              </Field>
            )}
            <Field label="Valable jusqu'au">
              <Input type="date" value={doc.valid_until ?? ''} onChange={(e) => setDoc({ ...doc, valid_until: e.target.value })} disabled={locked} />
            </Field>
          </div>
          <Field label="Notes" className="mt-3">
            <Textarea value={doc.notes ?? ''} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} disabled={locked} />
          </Field>
        </Card>
        <Card title="Totaux">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Total HT</span><span className="num">{money(totals.subtotal_ht)}</span></div>
            <div className="flex justify-between"><span>TVA</span><span className="num">{money(totals.total_vat)}</span></div>
            <div className="flex justify-between text-lg font-bold"><span>Total TTC</span><span className="num">{money(totals.total_ttc)}</span></div>
            <p className="pt-2 text-xs text-muted">Prix recalculés par le serveur à l'enregistrement (tarif du client et règles de remise).</p>
          </div>
        </Card>
      </div>
      {!locked && (
        <div className="mt-4">
          <ProductPicker
            onPick={(p, q) =>
              setLines((ls) => {
                const i = ls.findIndex((l) => l.product.id === p.id);
                if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + q } : l));
                return [...ls, { product: p, qty: q, discount_bp: null }];
              })
            }
          />
        </div>
      )}
      <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start">Produit</th>
              <th className="w-24 px-3 py-2 text-end">Qté</th>
              <th className="px-3 py-2 text-end">P.U. HT</th>
              <th className="w-28 px-3 py-2 text-end">Remise</th>
              <th className="px-3 py-2 text-end">Total TTC</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {priced.map((l, i) => (
              <tr key={l.product.id} className="border-t border-line">
                <td className="px-3 py-1.5">{l.product.name}</td>
                <td className="px-3 py-1.5">
                  <Input type="number" min={1} className="h-8 text-end" value={l.qty} disabled={locked} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Math.floor(Number(e.target.value))) } : x)))} />
                </td>
                <td className="num px-3 py-1.5 text-end">{money(l.unit, false)}</td>
                <td className="px-3 py-1.5">
                  <PercentInput value={l.disc} disabled={locked} onChange={(bp) => setLines(lines.map((x, j) => (j === i ? { ...x, discount_bp: bp } : x)))} />
                </td>
                <td className="num px-3 py-1.5 text-end">{money(l.amounts.line_ttc)}</td>
                <td className="px-2">
                  {!locked && (
                    <button className="p-1 text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted">Scannez ou recherchez des produits.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!locked && (
        <div className="mt-4 flex justify-end">
          <Button size="lg" loading={busy} disabled={!lines.length} onClick={save}>
            Enregistrer
          </Button>
        </div>
      )}
    </div>
  );
}
