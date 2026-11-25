import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useDebounce, useFetch } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { SearchBox } from '../components/common';
import { Badge, Button, PageHeader } from '../components/ui';

export const QUOTE_STATUS: Record<string, [string, string]> = {
  draft: ['Brouillon', 'gray'],
  sent: ['Envoyé', 'blue'],
  accepted: ['Accepté', 'green'],
  converted: ['Transformé en vente', 'gold'],
  cancelled: ['Annulé', 'red'],
};

export default function Quotes({ kind }: { kind: 'quote' | 'order' }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { data, loading } = useFetch<any[]>(`/api/quotes?kind=${kind}&q=${encodeURIComponent(dq)}`);
  return (
    <div>
      <PageHeader
        title={kind === 'quote' ? 'Devis' : 'Commandes clients'}
        subtitle={kind === 'order' ? 'Bons de commande clients — transformables en vente au point de vente' : 'Devis clients — transformables en commande ou en vente'}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => nav(`/devis/nouveau?kind=${kind}`)}>
            {kind === 'quote' ? 'Nouveau devis' : 'Nouvelle commande'}
          </Button>
        }
      />
      <SearchBox value={q} onChange={setQ} className="mb-3 w-72" />
      <DataTable
        rows={data}
        loading={loading}
        onRowClick={(r) => nav(`/devis/${r.id}`)}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'customer_display', header: 'Client', render: (r) => r.customer_display ?? '—' },
          { key: 'valid_until', header: 'Validité', hideSm: true, render: (r) => r.valid_until ?? '—' },
          { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={QUOTE_STATUS[r.status][1]}>{QUOTE_STATUS[r.status][0]}</Badge> },
          { key: 'sale_number', header: 'Vente', hideSm: true, render: (r) => r.sale_number ?? '—' },
        ]}
      />
    </div>
  );
}
