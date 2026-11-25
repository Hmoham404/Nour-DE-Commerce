import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { qs } from '../lib/api';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, money, PAYMENT_STATUS, VERIF_STATUS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, openPrint, PeriodFilter, SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select, Stat } from '../components/ui';

export default function Invoices() {
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const [verification, setVerification] = useState('');
  const [payment, setPayment] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const url = `/api/invoices${qs({ from: period.from, to: period.to, q: dq, verification, payment })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}`);
  const cols = [
    { key: 'number', label: 'Facture' },
    { key: 'invoice_date', label: 'Date', type: 'datetime' as const },
    { key: 'customer_name', label: 'Client' },
    { key: 'total_ht', label: 'HT', type: 'money' as const },
    { key: 'total_vat', label: 'TVA', type: 'money' as const },
    { key: 'stamp', label: 'Timbre', type: 'money' as const },
    { key: 'total_ttc', label: 'TTC', type: 'money' as const },
    { key: 'amount_paid', label: 'Payé', type: 'money' as const },
    { key: 'status', label: 'Statut' },
    { key: 'verification_status', label: 'Vérification' },
  ];
  return (
    <div>
      <PageHeader title="Factures" actions={<ExportButtons filename="factures" columns={cols} getRows={() => fetchAll(url)} />} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Nombre de factures" value={data?.total ?? '…'} />
        <Stat label="Total TTC" value={money(data?.summary?.ttc)} />
        <Stat label="Payé" value={money(data?.summary?.paid)} tone="green" />
        <Stat label="Factures à vérifier" value={data?.summary?.pending ?? 0} tone="amber" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={setQ} className="w-60" placeholder="N° facture, client…" />
        <Select className="h-9 w-auto" value={verification} onChange={(e) => setVerification(e.target.value)}>
          <option value="">Toutes vérifications</option>
          <option value="pending">En attente</option>
          <option value="verified">Vérifiées</option>
          <option value="anomaly">Anomalies</option>
        </Select>
        <Select className="h-9 w-auto" value={payment} onChange={(e) => setPayment(e.target.value)}>
          <option value="">Tous paiements</option>
          <option value="paid">Payées</option>
          <option value="unpaid">Impayées / partielles</option>
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/ventes/${r.sale_id}`)}
        columns={[
          { key: 'number', header: 'Facture', render: (r) => <b className="num">{r.number}</b> },
          { key: 'invoice_date', header: 'Date', render: (r) => dt(r.invoice_date) },
          { key: 'customer_name', header: 'Client', render: (r) => r.customer_name ?? 'Comptoir' },
          { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'payment_status', header: 'Paiement', render: (r) => <Badge color={PAYMENT_STATUS[r.payment_status][1]}>{PAYMENT_STATUS[r.payment_status][0]}</Badge> },
          { key: 'status', header: 'Statut', render: (r) => (r.status === 'cancelled' ? <Badge color="red">Annulée</Badge> : <Badge color="green">Validée</Badge>) },
          { key: 'verification_status', header: 'Vérification', hideSm: true, render: (r) => <Badge color={VERIF_STATUS[r.verification_status][1]}>{VERIF_STATUS[r.verification_status][0]}</Badge> },
          { key: 'p', header: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={(e) => (e.stopPropagation(), openPrint('facture', r.sale_id))} /> },
        ]}
      />
    </div>
  );
}
