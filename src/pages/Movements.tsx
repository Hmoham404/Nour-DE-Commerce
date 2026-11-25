import { useState } from 'react';
import { qs } from '../lib/api';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, MOVE_TYPES } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, PeriodFilter, SearchBox } from '../components/common';
import { PageHeader, Select, Tabs } from '../components/ui';

export default function Movements() {
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [direction, setDirection] = useState<'' | 'in' | 'out'>('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const url = `/api/stock/movements${qs({ from: period.from, to: period.to, q: dq, type, direction })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}&pageSize=50`);
  return (
    <div>
      <PageHeader
        title="Mouvements"
        subtitle="Historique complet : chaque entrée et sortie avec stock avant/après, utilisateur et document"
        actions={
          <ExportButtons
            filename="mouvements-stock"
            columns={[
              { key: 'created_at', label: 'Date', type: 'datetime' },
              { key: 'reference', label: 'Référence' },
              { key: 'product_name', label: 'Produit' },
              { key: 'warehouse_name', label: 'Dépôt' },
              { key: 'type', label: 'Type', value: (r) => MOVE_TYPES[r.type] },
              { key: 'quantity', label: 'Quantité', type: 'int' },
              { key: 'stock_before', label: 'Avant', type: 'int' },
              { key: 'stock_after', label: 'Après', type: 'int' },
              { key: 'batch_number', label: 'Lot' },
              { key: 'doc_number', label: 'Document' },
              { key: 'user_name', label: 'Utilisateur' },
              { key: 'reason', label: 'Motif' },
            ]}
            getRows={() => fetchAll(url)}
          />
        }
      />
      <Tabs tabs={[['', 'Tous'], ['in', 'Entrées'], ['out', 'Sorties']]} value={direction} onChange={(v) => (setDirection(v), setPage(1))} />
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Produit ou n° de document" className="w-64" />
        <Select className="h-9 w-auto" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
          <option value="">Tous les types</option>
          {Object.entries(MOVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        pageSize={50}
        onPage={setPage}
        columns={[
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'product_name', header: 'Produit' },
          { key: 'type', header: 'Type', render: (r) => MOVE_TYPES[r.type] ?? r.type },
          { key: 'quantity', header: 'Qté', align: 'end', render: (r) => <b className={r.quantity > 0 ? 'text-green-600' : 'text-red-600'}>{r.quantity > 0 ? '+' : ''}{r.quantity}</b> },
          { key: 'stock_before', header: 'Avant', align: 'end', hideSm: true },
          { key: 'stock_after', header: 'Après', align: 'end' },
          { key: 'doc_number', header: 'Document', hideSm: true },
          { key: 'batch_number', header: 'Lot', hideSm: true, render: (r) => r.batch_number ?? '—' },
          { key: 'user_name', header: 'Utilisateur', hideSm: true },
          { key: 'reason', header: 'Motif', hideSm: true },
        ]}
      />
    </div>
  );
}
