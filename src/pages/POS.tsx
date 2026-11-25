import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, FileText, Minus, PauseCircle, Percent, PlayCircle, Plus, Printer, Star, Trash2, User, Wallet, X } from 'lucide-react';
import { api, ApiError, newKey, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useDebounce, useFetch } from '../lib/hooks';
import { money, CUSTOMER_TYPES, PAY_METHODS, todayTunis } from '../lib/format';
import { computeLine, computeTotals, findDiscountRule, tierPrice, type CustomerType } from '../../shared/pricing';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { EntitySelect, openPrint } from '../components/common';
import { Badge, Button, Field, Input, Modal, MoneyInput, PercentInput, cx, useConfirm, useToast } from '../components/ui';

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
  const { can } = useAuth();
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
  const [editLine, setEditLine] = useState<number | null>(null);
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
        lines.push({ product: { ...p, stock: (p.stock ?? []).reduce((s: number, r: any) => s + r.quantity, 0) }, qty: it.qty, discount_bp: it.discount_bp || null });
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
  const units = cart.reduce((s, l) => s + l.qty, 0);

  const addProduct = useCallback((p: any, qty = 1) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        const n = [...c];
        n[i] = { ...n[i], qty: n[i].qty + qty };
        // la ligne modifiée remonte en haut, bien visible
        const [moved] = n.splice(i, 1);
        return [moved, ...n];
      }
      return [{ product: p, qty, discount_bp: null }, ...c];
    });
  }, []);

  const onScan = async (code: string) => {
    const r = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
    if (!r.found) return { ok: false, message: t('Code inconnu') };
    const already = cart.find((l) => l.product.id === r.product.id)?.qty ?? 0;
    addProduct(r.product, r.qty_per_unit);
    setSearch('');
    const low = already + r.qty_per_unit > r.product.stock;
    return { ok: true, message: `${r.product.name}${r.qty_per_unit > 1 ? ` ×${r.qty_per_unit}` : ''}${low ? ' — ⚠ stock insuffisant' : ''}` };
  };

  const setQty = (i: number, q: number) => setCart((c) => (q <= 0 ? c.filter((_, j) => j !== i) : c.map((l, j) => (j === i ? { ...l, qty: q } : l))));
  const setDisc = (i: number, bp: number | null) => {
    if (bp !== null && bp > ctx.max_discount_bp) {
      toast.warning(`Remise maximale autorisée : ${ctx.max_discount_bp / 100} %.`);
      bp = ctx.max_discount_bp;
    }
    setCart((c) => c.map((l, j) => (j === i ? { ...l, discount_bp: bp } : l)));
  };
  const reset = () => {
    setCart([]);
    setCustomer(null);
    setQuotationId(null);
    setInvoice(false);
    idemKey.current = newKey();
  };
  const clear = async () => {
    if (cart.length && !(await confirm({ title: 'Vider le panier', message: 'Annuler la vente en cours ?', danger: true }))) return;
    reset();
  };
  const hold = async () => {
    if (!cart.length) return;
    const label = customer?.name ?? `Vente ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    await api.post('/api/sales/held', { label, data: { cart: cart.map((l) => ({ product_id: l.product.id, qty: l.qty, discount_bp: l.discount_bp })), customer_id: customer?.id ?? null } });
    toast.success('Vente mise en attente');
    reset();
  };

  // raccourcis clavier
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (payOpen || heldOpen || result || editLine !== null) return;
      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        if (cart.length) setPayOpen(true);
      } else if (e.key === 'F8') {
        e.preventDefault();
        hold();
      } else if (e.key === 'F7') {
        e.preventDefault();
        setHeldOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const noSession = !session.loading && !session.data?.session;

  return (
    <div className="grid h-full gap-3 lg:grid-cols-[1fr_460px]">
      {/* Gauche : scan + catalogue */}
      <div className="flex min-h-0 flex-col gap-3">
        <BarcodeScanner big onScan={onScan} onType={setSearch} enabled={!payOpen && !heldOpen && !result && editLine === null} />
        {noSession && can('cash.use') && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <span className="flex items-center gap-2"><AlertTriangle className="size-4" /> Caisse fermée : ouvrez-la pour encaisser en espèces.</span>
            <Button size="sm" variant="gold" onClick={() => nav('/caisse')}>{t('Ouvrir la caisse')}</Button>
          </div>
        )}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <Chip active={!category && !favorites} onClick={() => (setCategory(''), setFavorites(false))}>{t('Tous')}</Chip>
          <Chip active={favorites} onClick={() => (setFavorites(true), setCategory(''))}><Star className="size-3.5" /> {t('Favoris')}</Chip>
          {cats.data?.filter((c) => !c.parent_id).map((c) => (
            <Chip key={c.id} active={category === c.id} onClick={() => (setCategory(c.id), setFavorites(false))}>{c.name}</Chip>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 xl:grid-cols-4">
          {products.data?.rows.map((p: any) => {
            const price = tierPrice(p, tier, ctx.custom_prices[p.id]);
            return (
              <button key={p.id} onClick={() => addProduct(p)} className="flex flex-col rounded-xl border border-line bg-surface p-3 text-start shadow-sm transition hover:border-gold active:scale-[.98]">
                <span className="line-clamp-2 min-h-10 font-medium">{p.name}</span>
                <span className="num mt-1 text-lg font-bold text-navy dark:text-gold">{money(price + Math.round((price * p.vat_bp) / 10000))}</span>
                <span className={cx('text-xs', p.stock <= 0 ? 'font-semibold text-red-600' : p.stock <= p.min_stock ? 'text-amber-600' : 'text-muted')}>
                  {p.stock <= 0 ? 'Rupture' : `Stock : ${p.stock}`}
                </span>
              </button>
            );
          })}
          {products.data && !products.data.rows.length && <p className="col-span-full p-6 text-center text-sm text-muted">Aucun produit trouvé.</p>}
        </div>
      </div>

      {/* Droite : panier */}
      <div className="flex min-h-[60vh] flex-col rounded-xl border border-line bg-surface shadow-sm lg:min-h-0">
        <div className="border-b border-line p-3">
          <div className="flex items-center gap-2">
            <User className="size-5 text-muted" />
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
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <Badge color="blue">{`Tarif ${CUSTOMER_TYPES[tier]}`}</Badge>
              {customer.balance > 0 && <Badge color="amber">{`Doit déjà ${money(customer.balance)}`}</Badge>}
              {customer.credit_exceeded && <Badge color="red">Plafond de crédit dépassé</Badge>}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!cart.length && (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted">
              <Wallet className="size-10 opacity-40" />
              <p>Scannez un produit avec le lecteur<br />ou touchez un article à gauche.</p>
            </div>
          )}
          {lines.map((l, i) => (
            <div key={l.product.id} className={cx('flex items-center gap-2 border-b border-line px-3 py-2.5', i === 0 && 'bg-gold/10')}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{l.product.name}</div>
                <div className="num text-xs text-muted">
                  {money(l.amounts.line_ttc / l.qty)} / unité{l.disc ? ` · remise ${l.disc / 100} %` : ''}
                </div>
                {l.qty > l.product.stock && <div className="flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="size-3" /> Stock insuffisant ({l.product.stock})</div>}
              </div>
              <div className="flex items-center rounded-lg border border-line">
                <button className="p-2" onClick={() => setQty(i, l.qty - 1)} aria-label="moins"><Minus className="size-4" /></button>
                <button className="num min-w-9 px-1 text-center text-base font-bold" onClick={() => setEditLine(i)} title="Modifier la quantité">{l.qty}</button>
                <button className="p-2" onClick={() => setQty(i, l.qty + 1)} aria-label="plus"><Plus className="size-4" /></button>
              </div>
              <div className="num w-24 text-end font-bold">{money(l.amounts.line_ttc, false)}</div>
              <button className="rounded-md p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => setQty(i, 0)} aria-label={t('Supprimer')}><Trash2 className="size-4" /></button>
            </div>
          ))}
        </div>
        <div className="space-y-2 border-t border-line p-3">
          <div className="flex items-end justify-between">
            <div className="text-sm text-muted">
              {units} article(s)
              {totals.discount_total > 0 && <span> · remises −{money(totals.discount_total)}</span>}
              {stamp > 0 && <span> · timbre {money(stamp)}</span>}
            </div>
            <div className="text-end">
              <div className="text-xs text-muted">{t('Total TTC')}</div>
              <div className="num text-3xl font-extrabold text-navy dark:text-gold">{money(totals.total_ttc)}</div>
            </div>
          </div>
          <Button size="lg" variant="gold" className="h-14 w-full text-xl" disabled={!cart.length} onClick={() => setPayOpen(true)} icon={<Wallet className="size-6" />}>
            PAYER <span className="text-sm font-normal opacity-70">(F9)</span>
          </Button>
          <div className="grid grid-cols-4 gap-1.5 text-xs">
            <SmallAction icon={<X className="size-4" />} label="Vider" onClick={clear} />
            <SmallAction icon={<PauseCircle className="size-4" />} label="En attente" onClick={hold} disabled={!cart.length} />
            <SmallAction icon={<PlayCircle className="size-4" />} label="Reprendre" onClick={() => setHeldOpen(true)} />
            <SmallAction icon={<FileText className="size-4" />} label={invoice ? 'Facture ✓' : 'Facture'} onClick={() => setInvoice((v) => !v)} active={invoice} />
          </div>
        </div>
      </div>

      <LineModal
        line={editLine !== null ? lines[editLine] : null}
        maxDiscount={ctx.max_discount_bp}
        onClose={() => setEditLine(null)}
        onSave={(qty, disc) => {
          if (editLine === null) return;
          setQty(editLine, qty);
          if (qty > 0) setDisc(editLine, disc);
          setEditLine(null);
        }}
      />
      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        total={totals.total_ttc}
        customer={customer}
        hasSession={!!session.data?.session}
        onConfirm={async (payments, due_date, tendered) => {
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
            const paid = payments.reduce((s, p) => s + p.amount, 0);
            setResult({ ...r, change: Math.max(0, tendered - paid) });
            setPayOpen(false);
            reset();
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
          const ls: CartLine[] = [];
          for (const it of d.cart) {
            const p = await api.get(`/api/products/${it.product_id}`);
            ls.push({ product: { ...p, stock: (p.stock ?? []).reduce((s: number, r: any) => s + r.quantity, 0) }, qty: it.qty, discount_bp: it.discount_bp });
          }
          setCart(ls);
          setCustomer(d.customer_id ? await api.get(`/api/customers/${d.customer_id}`) : null);
          await api.del(`/api/sales/held/${h.id}`);
          setHeldOpen(false);
          idemKey.current = newKey();
        }}
      />
      <Modal
        open={!!result}
        onClose={() => setResult(null)}
        title={<span className="flex items-center gap-2 text-green-600"><CheckCircle2 className="size-6" /> {t('Vente validée')}</span>}
        size="sm"
        footer={
          <>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('ticket', result.id)}>Ticket</Button>
            {result?.invoice_id && <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('facture', result.id)}>Facture</Button>}
            <Button variant="gold" size="lg" onClick={() => setResult(null)} autoFocus>Nouvelle vente</Button>
          </>
        }
      >
        {result && (
          <div className="space-y-3 text-center">
            {result.change > 0 ? (
              <div className="rounded-xl bg-green-50 p-4 text-green-800 dark:bg-green-950/40 dark:text-green-300">
                {t('Monnaie à rendre')}
                <div className="num text-4xl font-extrabold">{money(result.change)}</div>
              </div>
            ) : (
              <div className="num text-3xl font-bold">{money(result.total_ttc)}</div>
            )}
            <div className="num text-sm text-muted">{result.number}{result.invoice_number ? ` · ${result.invoice_number}` : ''}</div>
            {result.payment_status !== 'paid' && <Badge color="amber">{`Reste dû : ${money(result.total_ttc - result.amount_paid)}`}</Badge>}
          </div>
        )}
      </Modal>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-sm', active ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy' : 'border-line bg-surface')}>
      {children}
    </button>
  );
}

function SmallAction({ icon, label, onClick, disabled, active }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={cx('flex flex-col items-center gap-0.5 rounded-lg border py-1.5 disabled:opacity-40', active ? 'border-navy bg-navy text-white' : 'border-line hover:bg-surface-2')}>
      {icon}
      {label}
    </button>
  );
}

/** Modifier une ligne : quantité au pavé numérique, remise (si autorisée). */
function LineModal({ line, maxDiscount, onClose, onSave }: { line: any | null; maxDiscount: number; onClose: () => void; onSave: (qty: number, disc: number | null) => void }) {
  const [qty, setQty] = useState('1');
  const [disc, setDisc] = useState<number | null>(null);
  const [showDisc, setShowDisc] = useState(false);
  useEffect(() => {
    if (line) {
      setQty(String(line.qty));
      setDisc(line.discount_bp);
      setShowDisc(!!line.discount_bp);
    }
  }, [line]);
  const press = (k: string) => setQty((q) => (k === '⌫' ? q.slice(0, -1) || '0' : k === 'C' ? '0' : q === '0' ? k : (q + k).slice(0, 6)));
  return (
    <Modal open={!!line} onClose={onClose} title={line?.product.name ?? ''} size="sm" footer={<><Button variant="danger" onClick={() => onSave(0, null)}>Retirer</Button><Button size="lg" onClick={() => onSave(Number(qty) || 0, disc)}>OK</Button></>}>
      <div className="space-y-3">
        <Input autoFocus inputMode="numeric" className="num h-14 text-center text-3xl font-bold" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, '').slice(0, 6) || '0')} onKeyDown={(e) => e.key === 'Enter' && onSave(Number(qty) || 0, disc)} />
        <div className="grid grid-cols-3 gap-2">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'].map((k) => (
            <button key={k} onClick={() => press(k)} className="h-12 rounded-lg border border-line text-xl font-semibold hover:bg-surface-2">{k}</button>
          ))}
        </div>
        {maxDiscount > 0 && (
          <div>
            <button className="flex items-center gap-1 text-sm text-gold-600" onClick={() => setShowDisc((s) => !s)}>
              <Percent className="size-4" /> Remise {showDisc ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </button>
            {showDisc && (
              <div className="mt-2">
                <PercentInput value={disc ?? line?.disc ?? 0} onChange={setDisc} />
                <p className="mt-1 text-xs text-muted">Maximum autorisé : {maxDiscount / 100} %</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function PaymentModal({ open, onClose, total, customer, hasSession, onConfirm }: { open: boolean; onClose: () => void; total: number; customer: any; hasSession: boolean; onConfirm: (p: Pay[], due: string | null, tendered: number) => Promise<void> }) {
  const { t } = useI18n();
  const [method, setMethod] = useState<'cash' | 'card' | 'cheque' | 'credit'>('cash');
  const [tendered, setTendered] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [partial, setPartial] = useState<number | null>(0);
  const [partialMethod, setPartialMethod] = useState('cash');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setMethod('cash');
      setTendered(total);
      setMore(false);
      setPartial(0);
      setDue('');
    }
  }, [open, total]);

  // Montants selon le mode choisi
  const credit = method === 'credit';
  const paid = credit ? Math.min(partial ?? 0, total) : method === 'cash' ? Math.min(tendered ?? 0, total) : total;
  const change = method === 'cash' ? Math.max(0, (tendered ?? 0) - total) : 0;
  const rest = total - paid;
  const payMethod = credit ? partialMethod : method;
  const needsCash = payMethod === 'cash' && paid > 0;
  const blockedCash = needsCash && !hasSession;
  const needCustomer = rest > 0 && !customer;
  const quick = [total, Math.ceil(total / 5000) * 5000, Math.ceil(total / 10000) * 10000, Math.ceil(total / 20000) * 20000, Math.ceil(total / 50000) * 50000].filter((v, i, a) => a.indexOf(v) === i);

  const submit = async () => {
    if (blockedCash || needCustomer || busy) return;
    setBusy(true);
    try {
      await onConfirm(paid > 0 ? [{ method: payMethod, amount: paid }] : [], rest > 0 ? due || null : null, method === 'cash' ? tendered ?? 0 : paid);
    } finally {
      setBusy(false);
    }
  };

  const modes: [typeof method, string][] = [['cash', 'Espèces'], ['card', 'Carte'], ['cheque', 'Chèque'], ['credit', 'À crédit']];
  return (
    <Modal open={open} onClose={onClose} title={<span className="num">{t('Total TTC')} : {money(total)}</span>} footer={
      <>
        <Button variant="outline" onClick={onClose}>{t('Annuler')}</Button>
        <Button variant="gold" size="lg" className="min-w-40" loading={busy} disabled={blockedCash || needCustomer} onClick={submit}>{t('Valider')} (Entrée)</Button>
      </>
    }>
      <div className="space-y-4" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}>
        <div className="grid grid-cols-4 gap-2">
          {modes.map(([k, l]) => (
            <button key={k} onClick={() => setMethod(k)} className={cx('rounded-xl border-2 py-3 font-semibold', method === k ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy' : 'border-line')}>
              {l}
            </button>
          ))}
        </div>
        {method === 'cash' && (
          <>
            <Field label="Montant reçu du client">
              <MoneyInput value={tendered} onChange={setTendered} autoFocus className="h-14 text-2xl" />
            </Field>
            <div className="flex flex-wrap gap-2">
              {quick.map((v) => (
                <button key={v} onClick={() => setTendered(v)} className="num rounded-lg border border-line px-3 py-2 font-medium hover:border-gold">{money(v, false)}</button>
              ))}
            </div>
            <div className="rounded-xl bg-green-50 p-3 text-center dark:bg-green-950/40">
              <div className="text-sm text-muted">{t('Monnaie à rendre')}</div>
              <div className="num text-3xl font-extrabold text-green-700 dark:text-green-300">{money(change)}</div>
            </div>
            {(tendered ?? 0) < total && <p className="text-sm text-amber-700">Montant insuffisant : choisissez « À crédit » pour un paiement partiel.</p>}
          </>
        )}
        {(method === 'card' || method === 'cheque') && <p className="rounded-xl bg-surface-2 p-4 text-center text-lg">Paiement de <b className="num">{money(total)}</b> par {method === 'card' ? 'carte' : 'chèque'}.</p>}
        {credit && (
          <div className="space-y-3 rounded-xl bg-amber-50 p-3 dark:bg-amber-950/30">
            {!customer ? (
              <p className="text-sm font-semibold text-red-600">Choisissez d'abord le client (en haut du panier) pour vendre à crédit.</p>
            ) : (
              <p className="text-sm">Vente à crédit pour <b>{customer.name}</b>.</p>
            )}
            <Field label="Acompte versé maintenant (0 si rien)">
              <MoneyInput value={partial} onChange={setPartial} autoFocus />
            </Field>
            <div className="num text-center">Reste dû : <b className="text-lg">{money(rest)}</b></div>
            <button className="flex items-center gap-1 text-sm text-gold-600" onClick={() => setMore((m) => !m)}>Plus d'options {more ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</button>
            {more && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Mode de l'acompte">
                  <select className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm" value={partialMethod} onChange={(e) => setPartialMethod(e.target.value)}>
                    {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Échéance"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
              </div>
            )}
          </div>
        )}
        {blockedCash && <p className="text-sm font-semibold text-red-600">Caisse fermée : ouvrez-la (menu Caisse) pour encaisser en espèces.</p>}
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
              <div className="text-xs text-muted">{JSON.parse(h.data).cart.length} article(s) · {h.created_by_name}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onResume(h)}>Reprendre</Button>
              <Button size="sm" variant="outline" onClick={() => api.del(`/api/sales/held/${h.id}`).then(held.reload)} icon={<Trash2 className="size-4" />} />
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
