import { useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { Badge, Card, PageHeader, Stat } from '../components/ui';

export default function Payables() {
  const suppliers = useFetch<any>('/api/suppliers?debts=1&sort=balance&pageSize=200');
  const open = useFetch<any>('/api/purchases/invoices?status=open&pageSize=200');
  const nav = useNavigate();
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const overdue = (open.data?.rows ?? []).filter((r: any) => r.due_date && r.due_date < today);
  return (
    <div>
      <PageHeader title="Dettes fournisseurs" subtitle="Montants restant à payer et échéances" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Total dû aux fournisseurs" value={money(suppliers.data?.total_debts)} tone="amber" />
        <Stat label="Factures ouvertes" value={open.data?.total ?? '…'} sub={money(open.data?.total_due)} />
        <Stat label="Factures échues" value={overdue.length} tone={overdue.length ? 'red' : 'green'} sub={money(overdue.reduce((s: number, r: any) => s + r.due, 0))} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable
            rows={open.data?.rows}
            loading={open.loading}
            onRowClick={(r) => nav(`/fournisseurs/${r.supplier_id}`)}
            columns={[
              { key: 'supplier_name', header: 'Fournisseur' },
              { key: 'number', header: 'Facture' },
              { key: 'supplier_ref', header: 'Réf.', hideSm: true },
              { key: 'due_date', header: 'Échéance', render: (r) => (r.due_date ? <span className={r.due_date < today ? 'font-semibold text-red-600' : ''}>{r.due_date}</span> : '—') },
              { key: 'due', header: 'Reste', align: 'end', render: (r) => <b>{money(r.due)}</b> },
              { key: 's', header: '', render: (r) => (r.due_date && r.due_date < today ? <Badge color="red">Échue</Badge> : null) },
            ]}
          />
        </div>
        <Card title="Par fournisseur" padded={false}>
          <DataTable rows={suppliers.data?.rows} loading={suppliers.loading} onRowClick={(r) => nav(`/fournisseurs/${r.id}`)} columns={[{ key: 'name', header: 'Fournisseur' }, { key: 'balance', header: 'Solde', align: 'end', render: (r) => money(r.balance) }]} />
        </Card>
      </div>
    </div>
  );
}
