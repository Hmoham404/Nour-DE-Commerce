import { useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons } from '../components/common';
import { Badge, Card, PageHeader, Stat } from '../components/ui';

export default function Receivables() {
  const { data, loading } = useFetch<any[]>('/api/payments/receivables');
  const debtors = useFetch<any>('/api/customers?debtors=1&sort=balance&pageSize=200');
  const nav = useNavigate();
  const total = (data ?? []).reduce((s, r) => s + r.due, 0);
  const overdue = (data ?? []).filter((r) => r.days_overdue > 0);
  const buckets = [
    ['Non échu', (data ?? []).filter((r) => r.days_overdue === 0)],
    ['1–30 j', overdue.filter((r) => r.days_overdue <= 30)],
    ['31–60 j', overdue.filter((r) => r.days_overdue > 30 && r.days_overdue <= 60)],
    ['> 60 j', overdue.filter((r) => r.days_overdue > 60)],
  ] as const;
  return (
    <div>
      <PageHeader
        title="Créances"
        subtitle="Ventes à crédit non soldées, échéancier et clients débiteurs"
        actions={
          <ExportButtons
            filename="creances"
            columns={[{ key: 'customer_name', label: 'Client' }, { key: 'number', label: 'Vente' }, { key: 'invoice_number', label: 'Facture' }, { key: 'sale_date', label: 'Date', type: 'datetime' }, { key: 'due_date', label: 'Échéance', type: 'date' }, { key: 'days_overdue', label: 'Jours de retard', type: 'int' }, { key: 'total_ttc', label: 'Total', type: 'money' }, { key: 'due', label: 'Reste dû', type: 'money' }]}
            getRows={() => data ?? []}
          />
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Total des créances (ventes)" value={money(total)} tone="amber" />
        {buckets.map(([l, rows]) => (
          <Stat key={l} label={l} value={money(rows.reduce((s, r) => s + r.due, 0))} sub={`${rows.length} vente(s)`} tone={l === 'Non échu' ? 'navy' : 'red'} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable
            rows={data}
            loading={loading}
            onRowClick={(r) => nav(`/ventes/${r.id}`)}
            columns={[
              { key: 'customer_name', header: 'Client' },
              { key: 'number', header: 'Vente' },
              { key: 'sale_date', header: 'Date', hideSm: true, render: (r) => dt(r.sale_date) },
              { key: 'due_date', header: 'Échéance', render: (r) => r.due_date ?? '—' },
              { key: 'days_overdue', header: 'Retard', align: 'end', render: (r) => (r.days_overdue ? <Badge color="red">{`${r.days_overdue} j`}</Badge> : <Badge color="green">À jour</Badge>) },
              { key: 'due', header: 'Reste dû', align: 'end', render: (r) => <b>{money(r.due)}</b> },
            ]}
          />
        </div>
        <Card title="Clients débiteurs (solde global)" padded={false}>
          <DataTable
            rows={debtors.data?.rows}
            loading={debtors.loading}
            onRowClick={(r) => nav(`/clients/${r.id}`)}
            columns={[
              { key: 'name', header: 'Client' },
              { key: 'balance', header: 'Solde', align: 'end', render: (r) => <span className={r.credit_limit > 0 && r.balance > r.credit_limit ? 'font-bold text-red-600' : ''}>{money(r.balance)}</span> },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
