import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select } from '../components/ui';

export const PO_STATUS: Record<string, [string, string]> = {
  draft: ['Brouillon', 'gray'],
  ordered: ['Commandée', 'blue'],
  partial: ['Reçue partiellement', 'amber'],
  received: ['Reçue', 'green'],
  cancelled: ['Annulée', 'red'],
};

export default function PurchaseOrders() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const { data, loading } = useFetch<any>(`/api/purchases/orders${qs({ q: dq, status, page })}`);
  return (
    <div>
      <PageHeader
        title="Commandes fournisseurs"
        subtitle="Commande → Réception (partielle possible) → Facture fournisseur → Règlement"
        actions={can('purchases.manage') && <Button icon={<Plus className="size-4" />} onClick={() => nav('/achats/commandes/nouvelle')}>Nouvelle commande</Button>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={setQ} className="w-64" />
        <Select className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Tous statuts</option>
          {Object.entries(PO_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/achats/commandes/${r.id}`)}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'order_date', header: 'Date' },
          { key: 'supplier_name', header: 'Fournisseur' },
          { key: 'expected_date', header: 'Livraison prévue', hideSm: true, render: (r) => r.expected_date ?? '—' },
          { key: 'qty', header: 'Reçu / commandé', align: 'end', render: (r) => `${r.qty_received ?? 0} / ${r.qty_ordered ?? 0}` },
          { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={PO_STATUS[r.status][1]}>{PO_STATUS[r.status][0]}</Badge> },
        ]}
      />
    </div>
  );
}
