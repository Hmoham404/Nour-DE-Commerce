import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, Boxes, CalendarClock, FileCheck2, HandCoins, Package, PackageX, Receipt, ShoppingBag, TrendingUp, Truck, Wallet } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useFetch, usePeriod } from '../lib/hooks';
import { money, pct, PAY_METHODS } from '../lib/format';
import { qs } from '../lib/api';
import { PeriodFilter } from '../components/common';
import { ErrorBox, PageHeader, Spinner, Stat } from '../components/ui';
import { ChartCard, Donut, MoneyArea, MoneyBars, MoneyLine } from '../components/charts';
import { formatMoney } from '../../shared/money';

const MONTHS_FR = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const MONTHS_AR = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export default function Dashboard() {
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
      <PageHeader title="Tableau de bord" subtitle={t('Vue d’ensemble')} actions={<PeriodFilter value={period} onChange={setPeriod} />} />
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
