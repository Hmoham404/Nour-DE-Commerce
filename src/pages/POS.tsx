import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileText, Minus, PauseCircle, PlayCircle, Plus, Printer, Star, Trash2, User, Wallet, X } from 'lucide-react';
import { api, ApiError, newKey, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useDebounce, useFetch } from '../lib/hooks';
import { money, CUSTOMER_TYPES, PAY_METHODS, todayTunis } from '../lib/format';
import { computeLine, computeTotals, findDiscountRule, tierPrice, type CustomerType } from '../../shared/pricing';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { EntitySelect, openPrint } from '../components/common';
import { Badge, Button, Checkbox, Field, Input, Modal, MoneyInput, PercentInput, Select, cx, useConfirm, useToast } from '../components/ui';

interface CartLine {
  product: any;
  qty: number;
  discount_bp: number | null; // null = règle automatique
}
interface Pay {
  method: string;
  amount: number;
}

export default function POS() {
  const { me, can } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [params] = useSearchParams();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [customer, setCustomer] = useState<any | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [favorites, setFavorites] = useState(false);
  const [ctx, setCtx] = useState<any>({ rules: [], custom_prices: {}, max_discount_bp: 0, fiscal_stamp: 0 });
  const [invoice, setInvoice] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [quotationId, setQuotationId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const idemKey = useRef(newKey());
  const dq = useDebounce(search, 200);

  const session = useFetch<any>('/api/cash/current');
  const cats = useFetch<any[]>('/api/categories');
  const products = useFetch<any>(`/api/products${qs({ q: dq, category_id: category, favorites: favorites ? 1 : '', pageSize: 48 })}`, []);

  useEffect(() => {
    api.get(`/api/sales/pricing-context${qs({ customer_id: customer?.id })}`).then(setCtx).catch(() => {});
  }, [customer?.id]);

  // chargement d'un devis / commande client
  useEffect(() => {
    const qid = params.get('devis');
    if (!qid) return;
    api.get(`/api/quotes/${qid}`).then(async (q) => {
      const lines: CartLine[] = [];
      for (const it of q.items) {
        const p = await api.get(`/api/products/${it.product_id}`);
        const stock = (p.stock ?? []).reduce((s: number, r: any) => s + r.quantity, 0);
        lines.push({ product: { ...p, stock }, qty: it.qty, discount_bp: it.discount_bp || null });
      }
      setCart(lines);
      if (q.customer_id) setCustomer(await api.get(`/api/customers/${q.customer_id}`));
      setQuotationId(q.id);
      toast.info(`${q.number} chargé dans le panier`);
    }).catch((e) => toast.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tier: CustomerType = (customer?.price_tier ?? customer?.type ?? 'particulier') as CustomerType;

  const lines = useMemo(() => {
    const cartAmount = cart.reduce((s, l) => s + tierPrice(l.product, tier, ctx.custom_prices[l.product.id]) * l.qty, 0);
    return cart.map((l) => {
      const unit = tierPrice(l.product, tier, ctx.custom_prices[l.product.id]);
      const rule = findDiscountRule(ctx.rules, { product: l.product, customerType: tier, qty: l.qty, cartAmount, date: todayTunis() });
      const disc = l.discount_bp ?? rule?.discount_bp ?? 0;
      return { ...l, unit, rule, disc, amounts: computeLine(unit, l.qty, disc, l.product.vat_bp) };
    });
  }, [cart, tier, ctx]);
  const stamp = invoice ? ctx.fiscal_stamp : 0;
  const totals = computeTotals(lines.map((l) => l.amounts), stamp);

  const addProduct = useCallback((p: any, qty = 1) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i], qty: n[i].qty + qty };
        setSelected(i);
        return n;
      }
      setSelected(c.length);
      return [...c, { product: p, qty, discount_bp: null }];
    });
  }, []);

  const onScan = async (code: string) => {
    const r = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
    if (!r.found) {
      return { ok: false, message: t('Code inconnu') };
    }
    const already = cart.find((l) => l.product.id === r.product.id)?.qty ?? 0;
    addProduct(r.product, r.qty_per_unit);
    setSearch('');
    const low = already + r.qty_per_unit > r.product.stock;
    return { ok: true, message: `${r.product.name}${r.qty_per_unit > 1 ? ` ×${r.qty_per_unit}` : ''}${low ? ' — ⚠ stock insuffisant' : ''}` };
  };

  const setQty = (i: number, q: number) => setCart((c) => (q <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => (j === i ? { ...l, qty: q } : l))));
  const setDisc = (i: number, bp: number | null) => {
    if (bp !== null && bp > ctx.max_discount_bp) {
      toast.warning(`Remise maximale autorisée : ${ctx.max_discount_bp / 100} %. Au-delà, validation d'un responsable requise.`);
      bp = ctx.max_discount_bp;
    }
    setCart((c) => c.map((l, j) => (j === i ? { ...l, discount_bp: bp } : l)));
  };
  const clear = async () => {
    if (cart.length && !(await confirm({ title: 'Vider le panier', message: 'Annuler la vente en cours ?', danger: true }))) return;
    setCart([]);
    setCustomer(null);
    setQuotationId(null);
    setInvoice(false);
    idemKey.current = newKey();
  };
  const hold = async () => {
    if (!cart.length) return;
    const label = customer?.name ?? `Vente ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    await api.post('/api/sales/held', { label, data: { cart: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, discount_bp: l.discount_bp })), customer_id: customer?.id ?? null } });
    toast.success(t('Mettre en attente') + ' ✓');
    setCart([]);
    setCustomer(null);
    idemKey.current = newKey();
  };

  // raccourcis clavier
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        if (cart.length) setPayOpen(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        hold();
      } else if (e.key === 'F7') {
        e.preventDefault();
        setHeldOpen(true);
      } else if (e.key === 'F6') {
        e.preventDefault();
        setInvoice((v) => !v);
      } else if (selected !== null && cart[selected] && !(document.activeElement instanceof HTMLInputElement)) {
        if (e.key === '+') setQty(selected, cart[selected].qty + 1);
        if (e.key === '-') setQty(selected, cart[selected].qty - 1);
        if (e.key === 'Delete') setQty(selected, 0);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const noSession = !session.loading && !session.data?.session;

  return (
    <div className="grid h-full gap-3 lg:grid-cols-[1fr_440px]">
      {/* Gauche : scan, recherche, catalogue */}
      <div className="flex min-h-0 flex-col gap-3">
        <BarcodeScanner onScan={onScan} onType={setSearch} enabled={!payOpen && !heldOpen && !result} />
        {noSession && can('cash.use') && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4" /> Aucune caisse ouverte : les paiements en espèces sont bloqués.
            </span>
            <Button size="sm" variant="gold" onClick={() => nav('/caisse')}>
              {t('Ouvrir la caisse')}
            </Button>
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button onClick={() => (setCategory(''), setFavorites(false))} className={cx('shrink-0 rounded-full border px-3 py-1 text-sm', !category && !favorites ? 'border-navy bg-navy text-white' : 'border-line bg-surface')}>
            {t('Tous')}
          </button>
          <button onClick={() => (setFavorites(true), setCategory(''))} className={cx('flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-sm', favorites ? 'border-gold bg-gold text-navy' : 'border-line bg-surface')}>
            <Star className="size-3.5" /> {t('Favoris')}
          </button>
          {cats.data
            ?.filter((c) => !c.parent_id)
            .map((c) => (
              <button key={c.id} onClick={() => (setCategory(c.id), setFavorites(false))} className={cx('shrink-0 rounded-full border px-3 py-1 text-sm', category === c.id ? 'border-navy bg-navy text-white' : 'border-line bg-surface')}>
                {c.name}
              </button>
            ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {products.data?.rows.map((p: any) => {
            const price = tierPrice(p, tier, ctx.custom_prices[p.id]);
            return (
              <button key={p.id} onClick={() => addProduct(p)} className="flex flex-col rounded-xl border border-line bg-surface p-2.5 text-start shadow-sm transition hover:border-gold active:scale-[.98]">
                <span className="line-clamp-2 min-h-10 text-sm font-medium">{p.name}</span>
                <span className="num mt-1 text-base font-bold text-navy dark:text-gold">{money(price + Math.round((price * p.vat_bp) / 10000))}</span>
                <span className={cx('text-xs', p.stock <= 0 ? 'text-red-600' : p.stock <= p.min_stock ? 'text-amber-600' : 'text-muted')}>
                  {t('Stock disponible')}: <span className="num">{p.stock}</span>
                </span>
              </button>
            );
          })}
          {products.data && !products.data.rows.length && <p className="col-span-full p-6 text-center text-sm text-muted">Aucun produit trouvé.</p>}
        </div>
      </div>

      {/* Droite : panier */}
      <div className="flex min-h-[60vh] flex-col rounded-xl border border-line bg-surface shadow-sm lg:min-h-0">
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <User className="size-4 text-muted" />
            <EntitySelect
              className="flex-1"
              endpoint="/api/customers"
              value={customer?.id}
              label={customer?.name}
              placeholder="Client comptoir"
              render={(r) => `${r.name} — ${CUSTOMER_TYPES[r.type]}`}
              onChange={async (id) => setCustomer(id ? await api.get(`/api/customers/${id}`) : null)}
            />
          </div>
          {customer && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge color="blue">{CUSTOMER_TYPES[tier]}</Badge>
              <Badge color={customer.balance > 0 ? 'amber' : 'green'}>Solde {money(customer.balance)}</Badge>
              {customer.credit_limit > 0 && <Badge color={customer.credit_exceeded ? 'red' : 'gray'}>Plafond {money(customer.credit_limit)}</Badge>}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cart.length && <p className="p-8 text-center text-sm text-muted">{t('Panier')} vide — scannez un produit (lecteur Honeywell) ou touchez un article.</p>}
          {lines.map((l, i) => (
            <div key={l.product.id} onClick={() => setSelected(i)} className={cx('border-b border-line px-3 py-2', selected === i && 'bg-gold/10')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.product.name}</div>
                  <div className="num text-xs text-muted">
                    {money(l.unit)} HT{l.disc ? ` · −${l.disc / 100} %${l.rule && l.discount_bp === null ? ' (' + l.rule.name + ')' : ''}` : ''}
                  </div>
                  {l.qty > l.product.stock && (
                    <div className="flex items-center gap-1 text-xs text-red-600">
                      <AlertTriangle className="size-3" /> Stock insuffisant ({l.product.stock} dispo)
                    </div>
                  )}
                </div>
                <div className="num shrink-0 text-end text-sm font-bold">{money(l.amounts.line_ttc)}</div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <button className="rounded-md border border-line p-1" onClick={() => setQty(i, l.qty - 1)} aria-label="moins">
                  <Minus className="size-4" />
                </button>
                <input className="num h-8 w-16 rounded-md border border-line bg-surface text-center text-sm" type="number" min={1} value={l.qty} onChange={(e) => setQty(i, Math.max(0, Math.floor(Number(e.target.value))))} />
                <button className="rounded-md border border-line p-1" onClick={() => setQty(i, l.qty + 1)} aria-label="plus">
                  <Plus className="size-4" />
                </button>
                <div className="w-24">
                  <PercentInput value={l.disc} onChange={(bp) => setDisc(i, bp)} title={t('Remise')} className="h-8" />
                </div>
                <button className="ms-auto rounded-md p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => setQty(i, 0)} aria-label={t('Supprimer')}>
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-1 border-t border-line p-3 text-sm">
          <Row label="Sous-total HT" value={money(totals.subtotal_ht)} />
          {totals.discount_total > 0 && <Row label="Remise" value={'−' + money(totals.discount_total)} />}
          <Row label="TVA" value={money(totals.total_vat)} />
          {stamp > 0 && <Row label="Timbre fiscal" value={money(stamp)} />}
          <div className="flex items-center justify-between pt-1 text-xl font-bold text-navy dark:text-gold">
            <span>{t('Total TTC')}</span>
            <span className="num">{money(totals.total_ttc)}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <Checkbox checked={invoice} onChange={setInvoice} label="Générer la facture" />
            <span className="text-[11px] text-muted">F9 payer · F8 attente · F7 reprendre · F6 facture</span>
          </div>
          <div className="grid grid-cols-4 gap-2 pt-2">
            <Button variant="outline" onClick={clear} title={t('Vider le panier')} icon={<X className="size-4" />} />
            <Button variant="outline" onClick={hold} disabled={!cart.length} title={t('Mettre en attente')} icon={<PauseCircle className="size-4" />} />
            <Button variant="outline" onClick={() => setHeldOpen(true)} title={t('Ventes en attente')} icon={<PlayCircle className="size-4" />} />
            <Button variant="outline" onClick={() => nav('/retours')} title={t('Retours clients')} icon={<FileText className="size-4" />} />
          </div>
          <Button size="lg" variant="gold" className="mt-1 w-full text-lg" disabled={!cart.length} onClick={() => setPayOpen(true)} icon={<Wallet className="size-5" />}>
            {t('Valider la vente')} — {money(totals.total_ttc)}
          </Button>
        </div>
      </div>

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        total={totals.total_ttc}
        customer={customer}
        hasSession={!!session.data?.session}
        onConfirm={async (payments, due_date) => {
          try {
            const r = await api.post('/api/sales', {
              idempotency_key: idemKey.current,
              customer_id: customer?.id ?? null,
              items: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, discount_bp: l.discount_bp })),
              payments,
              create_invoice: invoice,
              due_date,
              quotation_id: quotationId,
            });
            // la vente n'est affichée comme validée qu'après confirmation du serveur
            const tendered = payments.reduce((s, p) => s + p.amount, 0);
            setResult({ ...r, change: (payments as any).tendered ? (payments as any).tendered - tendered : 0 });
            setPayOpen(false);
            setCart([]);
            setCustomer(null);
            setQuotationId(null);
            setInvoice(false);
            idemKey.current = newKey();
            session.reload();
            products.reload();
          } catch (e: any) {
            toast.error(e instanceof ApiError ? e.message : String(e));
          }
        }}
      />
      <HeldModal
        open={heldOpen}
        onClose={() => setHeldOpen(false)}
        onResume={async (h) => {
          const d = JSON.parse(h.data);
          const lines: CartLine[] = [];
          for (const it of d.cart) {
            const p = await api.get(`/api/products/${it.product_id}`);
            lines.push({ product: { ...p, stock: (p.stock ?? []).reduce((s: number, r: any) => s + r.quantity, 0) }, qty: it.qty, discount_bp: it.discount_bp });
          }
          setCart(lines);
          setCustomer(d.customer_id ? await api.get(`/api/customers/${d.customer_id}`) : null);
          await api.del(`/api/sales/held/${h.id}`);
          setHeldOpen(false);
          idemKey.current = newKey();
        }}
      />
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={
          <span className="flex items-center gap-2 text-green-600">
            <CheckCircle2 className="size-6" /> {t('Vente validée')}
          </span>
        }
        size="sm"
        footer={
          <>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('ticket', result.id)}>
              Ticket
            </Button>
            {result?.invoice_id && (
              <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('facture', result.id)}>
                Facture A4
              </Button>
            )}
            <Button variant="gold" onClick={() => setResult(null)} autoFocus>
              Nouvelle vente
            </Button>
          </>
        }
      >
        {result && (
          <div className="space-y-2 text-center">
            <div className="num text-2xl font-bold">{result.number}</div>
            {result.invoice_number && <div className="text-sm text-muted">Facture {result.invoice_number}</div>}
            <div className="num text-lg">{money(result.total_ttc)}</div>
            {result.change > 0 && (
              <div className="rounded-xl bg-green-50 p-3 text-green-800 dark:bg-green-950/40 dark:text-green-300">
                {t('Monnaie à rendre')} <div className="num text-3xl font-bold">{money(result.change)}</div>
              </div>
            )}
            {result.payment_status !== 'paid' && <Badge color="amber">Reste dû : {money(result.total_ttc - result.amount_paid)}</Badge>}
          </div>
        )}
      </Modal>
      <span className="hidden">{me?.id}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  return (
    <div className="flex justify-between text-muted">
      <span>{t(label)}</span>
      <span className="num text-fg">{value}</span>
    </div>
  );
}

function PaymentModal({ open, onClose, total, customer, hasSession, onConfirm }: { open: boolean; onClose: () => void; total: number; customer: any; hasSession: boolean; onConfirm: (p: Pay[] & { tendered?: number }, due: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState('cash');
  const [tendered, setTendered] = useState<number | null>(null);
  const [split, setSplit] = useState<Pay[]>([]);
  const [deferred, setDeferred] = useState(false);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setTendered(total);
      setSplit([]);
      setDeferred(false);
      setDue('');
    }
  }, [open, total]);
  const splitSum = split.reduce((s, p) => s + p.amount, 0);
  const remaining = total - splitSum;
  const current = deferred ? 0 : Math.min(tendered ?? 0, remaining);
  const paid = splitSum + current;
  const rest = total - paid;
  const change = !deferred && method === 'cash' && (tendered ?? 0) > remaining ? (tendered ?? 0) - remaining : 0;
  const quick = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 20000) * 20000, Math.ceil(total / 50000) * 50000].filter((v, i, a) => a.indexOf(v) === i);
  const cashBlocked = method === 'cash' && !hasSession && current > 0;
  const needCustomer = rest > 0 && !customer;

  const submit = async () => {
    setBusy(true);
    const pays: Pay[] = [...split];
    if (current > 0) pays.push({ method, amount: current });
    const arr = pays as Pay[] & { tendered?: number };
    arr.tendered = method === 'cash' ? splitSum + (tendered ?? 0) : paid;
    try {
      await onConfirm(arr, rest > 0 ? due || null : null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t('Total TTC')} : ${money(total)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Annuler')}
          </Button>
          <Button variant="gold" size="lg" loading={busy} disabled={cashBlocked || needCustomer} onClick={submit}>
            {t('Valider')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {Object.entries(PAY_METHODS).map(([k, v]) => (
            <button key={k} onClick={() => (setMethod(k), setDeferred(false), setTendered(remaining))} className={cx('rounded-lg border px-2 py-2 text-sm font-medium', method === k && !deferred ? 'border-navy bg-navy text-white' : 'border-line')}>
              {t(v)}
            </button>
          ))}
        </div>
        <Checkbox checked={deferred} onChange={setDeferred} label="Paiement différé" />
        {!deferred && (
          <>
            <Field label={method === 'cash' ? 'Montant reçu' : 'Montant payé'}>
              <MoneyInput value={tendered} onChange={setTendered} autoFocus className="h-12 text-xl" />
            </Field>
            {method === 'cash' && (
              <div className="flex flex-wrap gap-2">
                {quick.map((v) => (
                  <button key={v} onClick={() => setTendered(v)} className="num rounded-lg border border-line px-3 py-1.5 text-sm hover:border-gold">
                    {money(v, false)}
                  </button>
                ))}
              </div>
            )}
            {current > 0 && current < remaining && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSplit((s) => [...s, { method, amount: current }]);
                  setTendered(remaining - current);
                }}
              >
                + Ajouter un autre moyen de paiement pour le reste
              </Button>
            )}
          </>
        )}
        {split.length > 0 && (
          <div className="rounded-lg bg-surface-2 p-2 text-sm">
            {split.map((p, i) => (
              <div key={i} className="flex justify-between">
                <span>{t(PAY_METHODS[p.method])}</span>
                <span className="num">{money(p.amount)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-xs text-muted">{t('Montant payé')}</div>
            <div className="num font-bold">{money(paid)}</div>
          </div>
          <div className={cx('rounded-lg p-2', rest > 0 ? 'bg-amber-50 dark:bg-amber-950/40' : 'bg-surface-2')}>
            <div className="text-xs text-muted">{t('Reste à payer')}</div>
            <div className="num font-bold">{money(rest)}</div>
          </div>
          <div className="rounded-lg bg-green-50 p-2 dark:bg-green-950/40">
            <div className="text-xs text-muted">{t('Monnaie à rendre')}</div>
            <div className="num font-bold text-green-700 dark:text-green-300">{money(change)}</div>
          </div>
        </div>
        {rest > 0 && customer && (
          <Field label="Échéance du reste à payer" hint={customer.payment_terms_days ? `Par défaut : ${customer.payment_terms_days} jours` : undefined}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        )}
        {needCustomer && <p className="text-sm text-red-600">Sélectionnez un client pour un paiement différé ou partiel.</p>}
        {cashBlocked && <p className="text-sm text-red-600">Ouvrez votre caisse (menu Caisse) pour encaisser en espèces.</p>}
      </div>
    </Modal>
  );
}

function HeldModal({ open, onClose, onResume }: { open: boolean; onClose: () => void; onResume: (h: any) => Promise<void> }) {
  const held = useFetch<any[]>(open ? '/api/sales/held/list' : null, [open]);
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t('Ventes en attente')}>
      {!held.data?.length && <p className="text-sm text-muted">Aucune vente en attente.</p>}
      <div className="space-y-2">
        {held.data?.map((h) => (
          <div key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2">
            <div className="text-sm">
              <b>{h.label}</b>
              <div className="text-xs text-muted">
                {JSON.parse(h.data).cart.length} article(s) · {h.created_by_name}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onResume(h)}>
                Reprendre
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.del(`/api/sales/held/${h.id}`).then(held.reload)} icon={<Trash2 className="size-4" />} />
            </div>
          </div>
        ))}
      </div>
      <Select className="hidden" />
    </Modal>
  );
}
