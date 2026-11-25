import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, SearchBox } from '../components/common';
import { Button, PageHeader, Stat } from '../components/ui';
import { PartnerForm } from './PartnerForm';

export default function Suppliers() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(false);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const url = `/api/suppliers${qs({ q: dq })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}`);
  const fin = can('finance.view', 'purchases.manage');
  return (
    <div>
      <PageHeader
        title="Fournisseurs"
        actions={
          <>
            <ExportButtons
              filename="fournisseurs"
              columns={[
                { key: 'code', label: 'Code' }, { key: 'name', label: 'Raison sociale' }, { key: 'contact_name', label: 'Contact' }, { key: 'phone', label: 'Téléphone' }, { key: 'email', label: 'Email' },
                { key: 'address', label: 'Adresse' }, { key: 'tax_id', label: 'Matricule fiscal' }, { key: 'payment_terms_days', label: 'Délai (j)', type: 'int' },
                ...(fin ? [{ key: 'total_purchases', label: 'Total achats', type: 'money' as const }, { key: 'total_paid', label: 'Total réglé', type: 'money' as const }, { key: 'balance', label: 'Reste à payer', type: 'money' as const }] : []),
              ]}
              getRows={() => fetchAll(url)}
            />
            {can('suppliers.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setForm(true)}>Nouveau fournisseur</Button>}
          </>
        }
      />
      {fin && (
        <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Stat label="Fournisseurs" value={data?.total ?? '…'} />
          <Stat label="Dettes fournisseurs" value={money(data?.total_debts)} tone="amber" />
        </div>
      )}
      <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} className="mb-3 w-72" />
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/fournisseurs/${r.id}`)}
        columns={[
          { key: 'code', header: 'Code', render: (r) => <span className="num text-xs">{r.code}</span> },
          { key: 'name', header: 'Raison sociale', render: (r) => <b>{r.name}</b> },
          { key: 'contact_name', header: 'Contact', hideSm: true },
          { key: 'phone', header: 'Téléphone', hideSm: true },
          { key: 'products_count', header: 'Produits', align: 'end', hideSm: true },
          ...(fin ? [{ key: 'balance', header: 'Reste à payer', align: 'end' as const, render: (r: any) => <span className={r.balance > 0 ? 'font-semibold text-amber-600' : ''}>{money(r.balance)}</span> }] : []),
        ]}
      />
      <PartnerForm kind="suppliers" open={form} onClose={() => setForm(false)} onSaved={(id) => nav(`/fournisseurs/${id}`)} />
    </div>
  );
}
