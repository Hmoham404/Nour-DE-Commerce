import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { qs } from '../lib/api';
import { useDebounce, useFetch, usePeriod } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { openPrint, PeriodFilter, SearchBox } from '../components/common';
import { Button, PageHeader } from '../components/ui';

/** Bons de livraison : édités à partir des ventes validées (sans prix si souhaité). */
export default function Deliveries() {
  const [period, setPeriod] = usePeriod('week');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { data, loading } = useFetch<any>(`/api/sales${qs({ from: period.from, to: period.to, q: dq, status: 'completed', page })}`);
  return (
    <div>
      <PageHeader title="Bons de livraison" subtitle="Chaque vente validée peut être imprimée en bon de livraison (avec ou sans prix)." />
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <SearchBox value={q} onChange={setQ} className="w-60" />
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/ventes/${r.id}`)}
        columns={[
          { key: 'number', header: 'Vente', render: (r) => <b className="num">{r.number}</b> },
          { key: 'sale_date', header: 'Date', render: (r) => dt(r.sale_date) },
          { key: 'customer_name', header: 'Client', render: (r) => r.customer_name ?? 'Comptoir' },
          { key: 'units', header: 'Articles', align: 'end' },
          { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
          {
            key: 'p',
            header: '',
            sortable: false,
            render: (r) => (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" icon={<Printer className="size-4" />} onClick={(e) => (e.stopPropagation(), openPrint('bl', r.id))}>
                  BL
                </Button>
                <Button size="sm" variant="ghost" onClick={(e) => (e.stopPropagation(), openPrint('bl-sans-prix', r.id))}>
                  sans prix
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
