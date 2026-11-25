import { qs } from '../lib/api';
import { useFetch, usePeriod } from '../lib/hooks';
import { money, pct } from '../lib/format';
import { PeriodFilter } from '../components/common';
import { Card, PageHeader, Spinner, Stat } from '../components/ui';
import { ChartCard, MoneyBars } from '../components/charts';
import { DataTable } from '../components/DataTable';

/** Suivi financier commercial (pas un logiciel de comptabilité réglementaire). */
export default function Profitability() {
  const [period, setPeriod] = usePeriod('month');
  const { data } = useFetch<any>(`/api/dashboard${qs({ from: period.from, to: period.to })}`);
  const margins = useFetch<any>(`/api/reports/margin-by-product${qs({ from: period.from, to: period.to })}`);
  if (!data) return <Spinner />;
  const p = data.period;
  const s = data.snapshot;
  return (
    <div>
      <PageHeader title="Rentabilité" subtitle="Outil de gestion commerciale — ne remplace pas la comptabilité réglementaire" actions={<PeriodFilter value={period} onChange={setPeriod} />} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Chiffre d'affaires HT" value={money(p.revenue_ht)} sub="Net des retours" />
        <Stat label="Chiffre d'affaires TTC" value={money(p.revenue_ttc)} />
        <Stat label="Total des encaissements" value={money(p.collections)} tone="green" />
        <Stat label="Coût des marchandises vendues" value={money(p.cogs)} sub="Au coût moyen pondéré" />
        <Stat label="Marge brute" value={money(p.gross_margin)} tone="green" />
        <Stat label="Taux de marge" value={pct(p.markup_bp)} sub="Marge / CMV" />
        <Stat label="Taux de marque" value={pct(p.margin_rate_bp)} sub="Marge / CA HT" />
        <Stat label="Dépenses" value={money(p.expenses)} tone="red" />
        <Stat label="Résultat commercial estimé" value={money(p.result)} tone={p.result >= 0 ? 'green' : 'red'} sub="Marge brute − dépenses" />
        <Stat label="Total des achats (HT)" value={money(p.purchases_ht)} sub="≠ coût des produits vendus" />
        <Stat label="Créances clients" value={money(s.receivables)} tone="amber" />
        <Stat label="Dettes fournisseurs" value={money(s.payables)} tone="amber" />
        <Stat label="Solde de trésorerie suivi (caisses ouvertes)" value={money(s.cash_balance)} />
        <Stat label="Valeur du stock" value={money(s.stock_value)} />
      </div>
      <Card className="mt-4" title="Formules utilisées">
        <ul className="list-disc space-y-1 ps-5 text-sm text-muted">
          <li>Marge brute = Chiffre d'affaires HT net − Coût des marchandises vendues (coût moyen pondéré au moment de la vente).</li>
          <li>Taux de marge = Marge brute / Coût des marchandises vendues × 100.</li>
          <li>Taux de marque = Marge brute / Chiffre d'affaires HT net × 100.</li>
          <li>Résultat commercial estimé = Marge brute − Dépenses d'exploitation enregistrées.</li>
          <li>Les achats de la période ne sont pas assimilés au coût des produits vendus. Méthode de valorisation à confirmer avec votre comptable.</li>
        </ul>
      </Card>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Marge et dépenses par mois" empty={!data.charts.monthly.some((m: any) => m.revenue)}>
          <MoneyBars data={data.charts.monthly.map((m: any) => ({ ...m, label: m.m.slice(5) + '/' + m.m.slice(2, 4) }))} x="label" bars={[{ key: 'margin', name: 'Marge brute' }, { key: 'expenses', name: 'Dépenses' }]} />
        </ChartCard>
        <Card title="Marge par produit (période)" padded={false}>
          <DataTable
            rows={margins.data?.rows}
            loading={margins.loading}
            rowKey={(r) => r.reference + r.name}
            clientPageSize={10}
            columns={[
              { key: 'name', header: 'Produit' },
              { key: 'ht', header: 'CA HT', align: 'end', render: (r) => money(r.ht, false) },
              { key: 'margin', header: 'Marge', align: 'end', render: (r) => money(r.margin, false) },
              { key: 'margin_rate', header: 'Marque', align: 'end', render: (r) => pct(r.margin_rate) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
