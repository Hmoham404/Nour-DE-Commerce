import { useState } from 'react';
import { Printer } from 'lucide-react';
import { qs } from '../lib/api';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, money, PAY_METHODS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, openPrint, PeriodFilter, SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select, Stat } from '../components/ui';

export default function Payments() {
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const url = `/api/payments${qs({ from: period.from, to: period.to, q: dq, direction, method })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}`);
  return (
    <div>
      <PageHeader
        title="Paiements"
        subtitle="Encaissements clients, remboursements et règlements fournisseurs"
        actions={<ExportButtons filename="paiements" columns={[{ key: 'number', label: 'N°' }, { key: 'payment_date', label: 'Date', type: 'datetime' }, { key: 'direction', label: 'Sens', value: (r) => (r.direction === 'in' ? 'Entrée' : 'Sortie') }, { key: 'party_name', label: 'Tiers' }, { key: 'method', label: 'Mode', value: (r) => PAY_METHODS[r.method] }, { key: 'reference', label: 'Référence' }, { key: 'documents', label: 'Documents' }, { key: 'amount', label: 'Montant', type: 'money' }]} getRows={() => fetchAll(url)} />}
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Entrées" value={money(data?.total_in)} tone="green" />
        <Stat label="Sorties" value={money(data?.total_out)} tone="red" />
        <Stat label="Net" value={money((data?.total_in ?? 0) - (data?.total_out ?? 0))} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={setQ} className="w-56" />
        <Select className="h-9 w-auto" value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">Entrées et sorties</option>
          <option value="in">Entrées</option>
          <option value="out">Sorties</option>
        </Select>
        <Select className="h-9 w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">Tous modes</option>
          {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <span className="num">{r.number}</span> },
          { key: 'payment_date', header: 'Date', render: (r) => dt(r.payment_date) },
          { key: 'direction', header: 'Sens', render: (r) => (r.direction === 'in' ? <Badge color="green">Entrée</Badge> : <Badge color="red">Sortie</Badge>) },
          { key: 'party_name', header: 'Tiers' },
          { key: 'method', header: 'Mode', render: (r) => PAY_METHODS[r.method] },
          { key: 'documents', header: 'Documents', hideSm: true },
          { key: 'amount', header: 'Montant', align: 'end', render: (r) => <b>{money(r.amount)}</b> },
          { key: 'p', header: '', sortable: false, render: (r) => r.party_type === 'customer' && <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => openPrint('recu', r.id)} /> },
        ]}
      />
    </div>
  );
}
