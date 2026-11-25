import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { qs } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { DataTable } from '../components/DataTable';
import { ExportButtons } from '../components/common';
import { Badge, PageHeader, Select, Tabs } from '../components/ui';

export default function Batches() {
  const [status, setStatus] = useState<'expiring' | 'expired' | 'all'>('expiring');
  const [days, setDays] = useState(30);
  const nav = useNavigate();
  const { data, loading } = useFetch<any[]>(`/api/stock/batches${qs({ status, days })}`);
  return (
    <div>
      <PageHeader
        title="Lots et péremptions"
        subtitle="FEFO : les lots qui expirent en premier sont vendus en premier. La vente des produits périmés est bloquée."
        actions={
          <ExportButtons
            filename="lots-peremptions"
            columns={[
              { key: 'product_name', label: 'Produit' },
              { key: 'batch_number', label: 'Lot' },
              { key: 'supplier_name', label: 'Fournisseur' },
              { key: 'received_at', label: 'Réception', type: 'date' },
              { key: 'expires_at', label: 'Péremption', type: 'date' },
              { key: 'days_left', label: 'Jours restants', type: 'int' },
              { key: 'remaining_qty', label: 'Quantité', type: 'int' },
              { key: 'location', label: 'Emplacement' },
            ]}
            getRows={() => data ?? []}
          />
        }
      />
      <Tabs tabs={[['expiring', 'Proches de la péremption'], ['expired', 'Périmés'], ['all', 'Tous les lots']]} value={status} onChange={setStatus} />
      {status === 'expiring' && (
        <div className="mb-3 flex items-center gap-2 text-sm">
          Alerte à
          <Select className="h-9 w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 15, 30, 60].map((d) => <option key={d} value={d}>{d} jours</option>)}
          </Select>
        </div>
      )}
      <DataTable
        rows={data}
        loading={loading}
        onRowClick={(r) => nav(`/produits/${r.product_id}`)}
        columns={[
          { key: 'product_name', header: 'Produit' },
          { key: 'batch_number', header: 'Lot' },
          { key: 'supplier_name', header: 'Fournisseur', hideSm: true },
          { key: 'received_at', header: 'Réception', hideSm: true },
          { key: 'expires_at', header: 'Péremption', render: (r) => r.expires_at ?? '—' },
          {
            key: 'days_left',
            header: 'Jours restants',
            align: 'end',
            render: (r) => (r.expires_at === null ? '—' : <Badge color={r.days_left < 0 ? 'red' : r.days_left <= 7 ? 'red' : r.days_left <= 30 ? 'amber' : 'green'}>{r.days_left < 0 ? `Périmé (${-r.days_left} j)` : `${r.days_left} j`}</Badge>),
          },
          { key: 'remaining_qty', header: 'Qté', align: 'end' },
          { key: 'warehouse_name', header: 'Dépôt', hideSm: true },
        ]}
      />
    </div>
  );
}
