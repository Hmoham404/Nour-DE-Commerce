import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageCheck } from 'lucide-react';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { PeriodFilter, SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select } from '../components/ui';

export default function Receipts() {
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const [invoiced, setInvoiced] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, loading } = useFetch<any>(`/api/purchases/receipts${qs({ from: period.from, to: period.to, q: dq, invoiced, page })}`);
  const fin = can('purchases.manage', 'finance.view');
  return (
    <div>
      <PageHeader
        title="Réceptions"
        subtitle="Le stock est mis à jour uniquement à la validation de la réception"
        actions={can('receipts.manage') && <Button icon={<PackageCheck className="size-4" />} onClick={() => nav('/achats/receptions/nouvelle')}>Nouvelle réception</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={setQ} className="w-60" />
        {fin && (
          <Select className="h-9 w-auto" value={invoiced} onChange={(e) => setInvoiced(e.target.value)}>
            <option value="">Toutes</option>
            <option value="0">Non facturées</option>
          </Select>
        )}
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/achats/receptions/${r.id}`)}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'received_at', header: 'Date', render: (r) => dt(r.received_at) },
          { key: 'supplier_name', header: 'Fournisseur' },
          { key: 'po_number', header: 'Commande', hideSm: true, render: (r) => r.po_number ?? 'Achat direct' },
          { key: 'supplier_doc_ref', header: 'BL fournisseur', hideSm: true, render: (r) => r.supplier_doc_ref ?? '—' },
          { key: 'units', header: 'Unités', align: 'end' },
          ...(fin ? [{ key: 'total_ttc', header: 'Total TTC', align: 'end' as const, render: (r: any) => money(r.total_ttc) }] : []),
          { key: 'invoiced', header: 'Facture', render: (r) => (r.invoiced ? <Badge color="green">Facturée</Badge> : <Badge color="amber">À facturer</Badge>) },
          { key: 'created_by_name', header: 'Par', hideSm: true },
        ]}
      />
    </div>
  );
}
