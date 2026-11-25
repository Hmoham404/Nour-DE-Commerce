import { useState } from 'react';
import { qs } from '../lib/api';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, PeriodFilter, SearchBox } from '../components/common';
import { Modal, PageHeader, Select } from '../components/ui';

const ENTITIES = ['products', 'sales', 'invoices', 'stock_movements', 'inventories', 'goods_receipts', 'purchase_orders', 'purchase_invoices', 'payments', 'cash_sessions', 'cash_movements', 'expenses', 'customers', 'suppliers', 'users', 'roles', 'settings', 'discount_rules', 'quotations', 'backup'];

export default function Audit() {
  const [period, setPeriod] = usePeriod('week');
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<any | null>(null);
  const dq = useDebounce(q);
  const url = `/api/audit${qs({ from: period.from, to: period.to, q: dq, entity })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}&pageSize=50`);
  const pretty = (s: string | null) => {
    if (!s) return '—';
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };
  return (
    <div>
      <PageHeader
        title="Journal d'audit"
        subtitle="Journal protégé : aucune modification ni suppression possible (y compris par l'administrateur)"
        actions={<ExportButtons filename="journal-audit" columns={[{ key: 'created_at', label: 'Date', type: 'datetime' }, { key: 'user_name', label: 'Utilisateur' }, { key: 'action', label: 'Action' }, { key: 'entity', label: 'Table' }, { key: 'entity_id', label: 'Enregistrement' }, { key: 'reason', label: 'Motif' }, { key: 'ip', label: 'IP' }, { key: 'old_value', label: 'Ancienne valeur' }, { key: 'new_value', label: 'Nouvelle valeur' }]} getRows={() => fetchAll(url)} />}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} className="w-60" />
        <Select className="h-9 w-auto" value={entity} onChange={(e) => (setEntity(e.target.value), setPage(1))}>
          <option value="">Toutes les tables</option>
          {ENTITIES.map((e) => <option key={e}>{e}</option>)}
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        pageSize={50}
        onPage={setPage}
        onRowClick={setDetail}
        columns={[
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'user_name', header: 'Utilisateur' },
          { key: 'action', header: 'Action', render: (r) => <b>{r.action}</b> },
          { key: 'entity', header: 'Table' },
          { key: 'reason', header: 'Motif', hideSm: true },
          { key: 'ip', header: 'IP', hideSm: true },
        ]}
      />
      <Modal open={!!detail} onClose={() => setDetail(null)} title={`${detail?.action} — ${detail?.entity}`} size="lg">
        {detail && (
          <div className="grid gap-3 text-xs md:grid-cols-2">
            <div><b>Ancienne valeur</b><pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-surface-2 p-2">{pretty(detail.old_value)}</pre></div>
            <div><b>Nouvelle valeur</b><pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-surface-2 p-2">{pretty(detail.new_value)}</pre></div>
            <div className="md:col-span-2 text-muted">ID : {detail.entity_id ?? '—'} · {dt(detail.created_at)} · {detail.user_name} · {detail.ip ?? ''}</div>
          </div>
        )}
      </Modal>
    </div>
  );
}
