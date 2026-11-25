import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, Boxes, CalendarClock, FileCheck2, HandCoins, Package, PackageX, Receipt, ShoppingBag, ShoppingCart, TrendingUp, Truck, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useFetch, usePeriod } from '../lib/hooks';
import { money, pct, PAY_METHODS } from '../lib/format';
import { qs } from '../lib/api';
import { PeriodFilter } from '../components/common';
import { Button, ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { ChartCard, Donut, MoneyArea, MoneyBars, MoneyLine } from '../components/charts';
import { formatMoney } from '../../shared/money';

const MONTHS_FR = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MONTHS_AR = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function Dashboard() {
  const [full, setFull] = useState(() => localStorage.getItem('ndc-full-dashboard') === '1');
  const toggle = () => {
    localStorage.setItem('ndc-full-dashboard', full ? '0' : '1');
    setFull(!full);
  };
  return full ? <FullDashboard onToggle={toggle} /> : <SimpleDashboard onToggle={toggle} />;
}

function BigTile({ label, value, sub, tone, icon, onClick }: { label: string; value: string | number; sub?: string; tone: string; icon: React.ReactNode; onClick?: () => void }) {
  const { t } = useI18n();
  return (
    <button onClick={onClick} disabled={!onClick} className={`flex items-center gap-4 rounded-2xl p-5 text-start shadow-sm transition enabled:hover:scale-[1.01] ${tone}`}>
      <div className="rounded-xl bg-white/20 p-3">{icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-medium opacity-90">{t(label)}</div>
        <div className="num truncate text-2xl font-extrabold sm:text-3xl">{value}</div>
        {sub && <div className="text-xs opacity-80">{t(sub)}</div>}
      </div>
    </button>
  );
}

/** Vue simple : l'essentiel de la journée, lisible en 5 secondes. */
function SimpleDashboard({ onToggle }: { onToggle: () => void }) {
  const { me, can } = useAuth();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const week = new Date(Date.now() + 3600000 - 6 * 86400000).toISOString().slice(0, 10);
  const { data, error, reload } = useFetch<any>(`/api/dashboard${qs({ from: week, to: today })}`);
  const alerts = useFetch<any>(can('stock.view') ? '/api/stock/alerts' : null);
  const debtors = useFetch<any>(can('customers.view') ? '/api/customers?debtors=1&sort=balance&pageSize=5' : null);
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.now() + 3600000 - (6 - i) * 86400000).toISOString().slice(0, 10));
  const byDay = new Map((data?.charts.daily ?? []).map((d: any) => [d.d, d.ttc]));
  const dayName = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(lang === 'ar' ? 'ar-TN' : 'fr-FR', { weekday: 'short', day: 'numeric' });
  const toOrder = [...(alerts.data?.out ?? []), ...(alerts.data?.low ?? [])];

  return (
    <div>
      <PageHeader
        title={`${t('Bonjour')} ${me?.full_name?.split(' ')[0] ?? ''}`}
        subtitle={new Date().toLocaleDateString(lang === 'ar' ? 'ar-TN' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={<Button variant="outline" onClick={onToggle}>{t('Tableau de bord complet')}</Button>}
      />
      <ErrorBox error={error} onRetry={reload} />
      {!data ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BigTile label="Ventes du jour" value={money(data.today.revenue_ttc)} sub={`${data.today.sales_count} vente(s)`} tone="bg-navy text-white" icon={<ShoppingBag className="size-7" />} onClick={can('sales.view') ? () => nav('/ventes') : undefined} />
            <BigTile label="Argent encaissé aujourd’hui" value={money(data.today.collections)} tone="bg-green-600 text-white" icon={<Banknote className="size-7" />} />
            <BigTile label="Solde de caisse" value={money(data.snapshot.cash_balance)} sub="Caisses ouvertes" tone="bg-gold text-navy" icon={<Wallet className="size-7" />} onClick={can('cash.use', 'cash.manage') ? () => nav('/caisse') : undefined} />
            <BigTile label="Produits à commander" value={data.snapshot.out_of_stock + data.snapshot.low_stock} sub={`${data.snapshot.out_of_stock} en rupture`} tone={data.snapshot.out_of_stock ? 'bg-red-600 text-white' : 'bg-surface text-fg border border-line'} icon={<PackageX className="size-7" />} onClick={can('stock.view') ? () => nav('/stock/alertes') : undefined} />
          </div>

          <div className="mt-4">
            <h2 className="mb-2 text-sm font-semibold text-muted">{t('Actions rapides')}</h2>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {can('pos.use') && <QuickAction icon={<ShoppingCart className="size-6" />} label="Nouvelle vente" onClick={() => nav('/pos')} />}
              {can('products.manage') && <QuickAction icon={<Package className="size-6" />} label="Ajouter un produit" onClick={() => nav('/produits/nouveau')} />}
              {can('receipts.manage') && <QuickAction icon={<Truck className="size-6" />} label="Recevoir une livraison" onClick={() => nav('/achats/receptions/nouvelle')} />}
              {can('invoices.view') && <QuickAction icon={<FileCheck2 className="size-6" />} label="Factures à vérifier" badge={data.snapshot.invoices_pending} onClick={() => nav('/verification')} />}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <section className="rounded-xl border border-line bg-surface p-4 shadow-sm lg:col-span-1">
              <h3 className="mb-3 text-sm font-semibold">{t('Les 7 derniers jours')}</h3>
              <div className="space-y-1.5">
                {(() => {
                  const max = Math.max(1, ...days.map((d) => Number(byDay.get(d) ?? 0)));
                  return days.map((d) => {
                    const v = Number(byDay.get(d) ?? 0);
                    return (
                      <div key={d} className="grid grid-cols-[64px_1fr_92px] items-center gap-2 text-sm">
                        <span className="text-muted">{dayName(d)}</span>
                        <div className="h-5 rounded bg-surface-2"><div className="h-5 rounded bg-navy dark:bg-gold" style={{ width: `${(v / max) * 100}%` }} title={formatMoney(v)} /></div>
                        <span className="num text-end">{money(v, false)}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
            {can('stock.view') && (
              <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="size-4 text-amber-500" /> {t('Produits à commander')}</h3>
                {!toOrder.length && <p className="text-sm text-muted">Tout est en stock 👍</p>}
                <ul className="divide-y divide-line">
                  {toOrder.slice(0, 6).map((p: any) => (
                    <li key={p.id} className="flex cursor-pointer justify-between py-1.5 text-sm hover:text-gold-600" onClick={() => nav(`/produits/${p.id}`)}>
                      <span className="truncate">{p.name}</span>
                      <span className={`num font-semibold ${p.stock <= 0 ? 'text-red-600' : 'text-amber-600'}`}>{p.stock}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {can('customers.view') && (
              <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><HandCoins className="size-4 text-amber-500" /> {t('Clients qui doivent de l’argent')}</h3>
                {!debtors.data?.rows?.length && <p className="text-sm text-muted">Aucune créance.</p>}
                <ul className="divide-y divide-line">
                  {debtors.data?.rows?.map((c: any) => (
                    <li key={c.id} className="flex cursor-pointer justify-between py-1.5 text-sm hover:text-gold-600" onClick={() => nav(`/clients/${c.id}`)}>
                      <span className="truncate">{c.name}</span>
                      <span className="num font-semibold">{money(c.balance)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QuickAction({ icon, label, onClick, badge }: { icon: React.ReactNode; label: string; onClick: () => void; badge?: number }) {
  const { t } = useI18n();
  return (
    <button onClick={onClick} className="relative flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-4 text-sm font-semibold shadow-sm transition hover:border-gold">
      <span className="text-navy dark:text-gold">{icon}</span>
      {t(label)}
      {!!badge && <span className="absolute end-2 top-2 rounded-full bg-red-600 px-2 text-xs text-white">{badge}</span>}
    </button>
  );
}

function FullDashboard({ onToggle }: { onToggle: () => void }) {
  const [period, setPeriod] = usePeriod('month');
  const { can } = useAuth();
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const fin = can('finance.view');
  const { data, loading, error, reload } = useFetch<any>(`/api/dashboard${qs({ from: period.from, to: period.to })}`);

  const monthLabel = (m: string) => `${(lang === 'ar' ? MONTHS_AR : MONTHS_FR)[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
  const p = data?.period;
  const s = data?.snapshot;
  const c = data?.charts;

  return (
    <div>
      <PageHeader title="Tableau de bord" subtitle={t('Vue d’ensemble')} actions={<><PeriodFilter value={period} onChange={setPeriod} /><Button variant="outline" onClick={onToggle}>{t('Vue simple')}</Button></>} />
      <ErrorBox error={error} onRetry={reload} />
      {!data && loading ? (
        <Spinner />
      ) : data ? (
        <div className={loading ? 'opacity-60 transition' : 'transition'}>
          {/* Chiffre d'affaires ≠ encaissements ≠ bénéfice ≠ solde de caisse : tuiles distinctes et libellées */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Chiffre d'affaires du jour" value={money(data.today.revenue_ht)} sub={`${data.today.sales_count} ${t('Ventes').toLowerCase()} · HT`} icon={<TrendingUp className="size-5" />} />
            <Stat label="Chiffre d'affaires du mois" value={money(data.month.revenue_ht)} sub="HT net des retours" icon={<TrendingUp className="size-5" />} />
            <Stat label="Chiffre d'affaires de l'année" value={money(data.year.revenue_ht)} sub="HT" icon={<TrendingUp className="size-5" />} />
            <Stat label="Chiffre d’affaires (période)" value={money(p.revenue_ht)} sub={`TTC ${money(p.revenue_ttc)}`} tone="gold" icon={<ShoppingBag className="size-5" />} />
            <Stat label="Encaissements" value={money(p.collections)} sub="Argent reçu des clients (période)" tone="green" icon={<Banknote className="size-5" />} />
            {fin && <Stat label="Marge brute" value={money(p.gross_margin)} sub={`${t('Taux de marque')} ${pct(p.margin_rate_bp)} · ${t('Taux de marge')} ${pct(p.markup_bp)}`} tone="green" icon={<TrendingUp className="size-5" />} />}
            {fin && <Stat label="Résultat commercial estimé" value={money(p.result)} sub="Marge brute − dépenses" tone={p.result >= 0 ? 'green' : 'red'} icon={<Receipt className="size-5" />} />}
            {fin && <Stat label="Total des achats" value={money(p.purchases_ht)} sub="Réceptions HT (période)" icon={<Truck className="size-5" />} onClick={() => nav('/achats/receptions')} />}
            {fin && <Stat label="Total des dépenses" value={money(p.expenses)} icon={<Receipt className="size-5" />} onClick={() => nav('/depenses')} />}
            {fin && <Stat label="Valeur du stock" value={money(s.stock_value)} sub="Au coût moyen pondéré" icon={<Boxes className="size-5" />} onClick={() => nav('/stock')} />}
            <Stat label="Solde de caisse" value={money(s.cash_balance)} sub="Caisses ouvertes" tone="navy" icon={<Wallet className="size-5" />} onClick={can('cash.use', 'cash.manage') ? () => nav('/caisse') : undefined} />
            <Stat label="Créances clients" value={money(s.receivables)} tone="amber" icon={<HandCoins className="size-5" />} onClick={() => nav('/creances')} />
            {fin && <Stat label="Dettes fournisseurs" value={money(s.payables)} tone="amber" icon={<HandCoins className="size-5" />} onClick={() => nav('/dettes')} />}
            <Stat label="Nombre de ventes" value={p.sales_count} sub={`${p.invoices_count} ${t('Factures').toLowerCase()}`} icon={<ShoppingBag className="size-5" />} onClick={() => nav('/ventes')} />
            <Stat label="Nombre de produits" value={s.products} icon={<Package className="size-5" />} onClick={() => nav('/produits')} />
            <Stat label="Produits en rupture" value={s.out_of_stock} tone={s.out_of_stock ? 'red' : 'green'} icon={<PackageX className="size-5" />} onClick={() => nav('/stock/alertes')} />
            <Stat label="Stock faible" value={s.low_stock} tone={s.low_stock ? 'amber' : 'green'} icon={<AlertTriangle className="size-5" />} onClick={() => nav('/stock/alertes')} />
            <Stat label="Proches de la péremption" value={s.expiring} tone={s.expiring ? 'amber' : 'green'} icon={<CalendarClock className="size-5" />} onClick={() => nav('/stock/lots')} />
            <Stat label="Factures à vérifier" value={s.invoices_pending} tone={s.invoices_pending ? 'amber' : 'green'} icon={<FileCheck2 className="size-5" />} onClick={() => nav('/verification')} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Évolution quotidienne des ventes"
              empty={!c.daily.length}
              table={c.daily.map((d: any) => ({ label: d.d, value: formatMoney(d.ht) }))}
            >
              <MoneyArea data={c.daily.map((d: any) => ({ ...d, label: d.d.slice(8, 10) + '/' + d.d.slice(5, 7) }))} x="label" y="ht" name={t("Chiffre d'affaires HT")} />
            </ChartCard>
            <ChartCard title="Évolution mensuelle du chiffre d'affaires" empty={!c.monthly.some((m: any) => m.revenue)}>
              <MoneyBars data={c.monthly.map((m: any) => ({ ...m, label: monthLabel(m.m) }))} x="label" bars={[{ key: 'revenue', name: t("Chiffre d'affaires HT") }]} />
            </ChartCard>
            {fin && (
              <ChartCard title="Achats vs ventes" empty={!c.monthly.some((m: any) => m.revenue || m.purchases)}>
                <MoneyBars data={c.monthly.map((m: any) => ({ ...m, label: monthLabel(m.m) }))} x="label" bars={[{ key: 'revenue', name: t('Ventes') }, { key: 'purchases', name: t('Achats') }]} />
              </ChartCard>
            )}
            {fin && (
              <ChartCard title="Évolution de la marge" empty={!c.monthly.some((m: any) => m.margin)}>
                <MoneyLine data={c.monthly.map((m: any) => ({ ...m, label: monthLabel(m.m), result: m.margin - m.expenses }))} x="label" lines={[{ key: 'margin', name: t('Marge brute') }, { key: 'result', name: t('Résultat commercial estimé') }]} />
              </ChartCard>
            )}
            <ChartCard title="Ventes par catégorie" empty={!c.by_category.length} table={c.by_category.map((d: any) => ({ label: d.name, value: formatMoney(d.value) }))}>
              <Donut data={c.by_category} />
            </ChartCard>
            <ChartCard title="Répartition des paiements" empty={!c.payments_by_method.length} table={c.payments_by_method.map((d: any) => ({ label: t(PAY_METHODS[d.method]), value: formatMoney(d.value) }))}>
              <Donut data={c.payments_by_method} nameKey="method" labels={Object.fromEntries(Object.entries(PAY_METHODS).map(([k, v]) => [k, t(v)]))} />
            </ChartCard>
            <ChartCard title="Top 10 produits" empty={!c.top_products.length} table={c.top_products.map((d: any) => ({ label: `${d.name} (${d.qty})`, value: formatMoney(d.revenue) }))}>
              <MoneyBars horizontal data={c.top_products} x="name" bars={[{ key: 'revenue', name: t("Chiffre d'affaires HT") }]} />
            </ChartCard>
            <ChartCard title="Top 10 clients" empty={!c.top_customers.length} table={c.top_customers.map((d: any) => ({ label: d.name, value: formatMoney(d.revenue) }))}>
              <MoneyBars horizontal data={c.top_customers.map((x: any) => ({ ...x, name: x.name === 'Clients comptoir' ? t('Client comptoir') : x.name }))} x="name" bars={[{ key: 'revenue', name: t("Chiffre d'affaires HT") }]} />
            </ChartCard>
            {fin && (
              <ChartCard title="Évolution de la valeur du stock" empty={c.stock_value.length < 2}>
                <MoneyArea data={c.stock_value.map((d: any) => ({ ...d, label: d.d.slice(8, 10) + '/' + d.d.slice(5, 7) }))} x="label" y="value" name={t('Valeur du stock')} />
              </ChartCard>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
