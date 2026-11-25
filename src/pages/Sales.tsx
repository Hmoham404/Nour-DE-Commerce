import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, money, PAYMENT_STATUS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, PeriodFilter, SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select, Stat } from '../components/ui';

export default function Sales() {
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [pay, setPay] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const url = `/api/sales${qs({ from: period.from, to: period.to, q: dq, status, payment_status: pay })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}&pageSize=25`);
  const cols = [
    { key: 'number', label: 'N° vente' },
    { key: 'invoice_number', label: 'Facture' },
    { key: 'sale_date', label: 'Date', type: 'datetime' as const },
    { key: 'customer_name', label: 'Client' },
    { key: 'cashier', label: 'Vendeur' },
    { key: 'subtotal_ht', label: 'Total HT', type: 'money' as const },
    { key: 'total_vat', label: 'TVA', type: 'money' as const },
    { key: 'total_ttc', label: 'Total TTC', type: 'money' as const },
    { key: 'amount_paid', label: 'Payé', type: 'money' as const },
    { key: 'payment_status', label: 'Paiement' },
    { key: 'status', label: 'Statut' },
  ];
  return (
    <div>
      <PageHeader
        title="Ventes"
        actions={
          <>
            <ExportButtons filename="ventes" title="Ventes" columns={cols} getRows={() => fetchAll(url)} />
            {can('pos.use') && (
              <Button icon={<Plus className="size-4" />} onClick={() => nav('/pos')}>
                Nouvelle vente
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Nombre de ventes" value={data?.total ?? '…'} />
        <Stat label="Total TTC (net)" value={money(data?.sum_ttc)} />
        <Stat label="Encaissé" value={money(data?.sum_paid)} tone="green" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <PeriodFilter value={period} onChange={(p) => (setPeriod(p), setPage(1))} />
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="N° vente, facture, client…" className="w-64" />
        <Select className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous statuts</option>
          <option value="completed">Validées</option>
          <option value="cancelled">Annulées</option>
        </Select>
        <Select className="h-9 w-auto" value={pay} onChange={(e) => setPay(e.target.value)}>
          <option value="">Tous paiements</option>
          <option value="paid">Payées</option>
          <option value="partial">Partielles</option>
          <option value="unpaid">Impayées</option>
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/ventes/${r.id}`)}
        columns={[
          { key: 'number', header: 'N° vente', render: (r) => <b className="num">{r.number}</b> },
          { key: 'invoice_number', header: 'Facture', hideSm: true, render: (r) => r.invoice_number ?? '—' },
          { key: 'sale_date', header: 'Date', render: (r) => dt(r.sale_date) },
          { key: 'customer_name', header: 'Client', render: (r) => r.customer_name ?? <span className="text-muted">Comptoir</span> },
          { key: 'cashier', header: 'Vendeur', hideSm: true },
          { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'payment_status', header: 'Paiement', render: (r) => <Badge color={PAYMENT_STATUS[r.payment_status][1]}>{PAYMENT_STATUS[r.payment_status][0]}</Badge> },
          { key: 'status', header: 'Statut', render: (r) => (r.status === 'cancelled' ? <Badge color="red">Annulée</Badge> : r.credited_amount > 0 ? <Badge color="amber">Retour partiel</Badge> : <Badge color="green">Validée</Badge>) },
        ]}
      />
    </div>
  );
}
