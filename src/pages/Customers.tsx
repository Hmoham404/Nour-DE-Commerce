import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch } from '../lib/hooks';
import { CUSTOMER_TYPES, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, fetchAll, SearchBox } from '../components/common';
import { Badge, Button, PageHeader, Select, Stat } from '../components/ui';
import { PartnerForm } from './PartnerForm';

export default function Customers() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(false);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const url = `/api/customers${qs({ q: dq, type })}`;
  const { data, loading } = useFetch<any>(`${url}&page=${page}`);
  return (
    <div>
      <PageHeader
        title="Clients"
        actions={
          <>
            <ExportButtons
              filename="clients"
              columns={[
                { key: 'code', label: 'Code' }, { key: 'name', label: 'Nom' }, { key: 'type', label: 'Type', value: (r) => CUSTOMER_TYPES[r.type] }, { key: 'phone', label: 'Téléphone' },
                { key: 'email', label: 'Email' }, { key: 'address', label: 'Adresse' }, { key: 'tax_id', label: 'Matricule fiscal' }, { key: 'credit_limit', label: 'Plafond', type: 'money' },
                { key: 'total_purchases', label: 'Total achats', type: 'money' }, { key: 'total_paid', label: 'Total payé', type: 'money' }, { key: 'balance', label: 'Solde dû', type: 'money' },
              ]}
              getRows={() => fetchAll(url)}
            />
            {can('customers.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setForm(true)}>Nouveau client</Button>}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Clients" value={data?.total ?? '…'} />
        <Stat label="Créances clients" value={money(data?.total_receivables)} tone="amber" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Nom, code, téléphone, matricule…" className="w-72" />
        <Select className="h-9 w-auto" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Tous types</option>
          {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/clients/${r.id}`)}
        columns={[
          { key: 'code', header: 'Code', render: (r) => <span className="num text-xs">{r.code}</span> },
          { key: 'name', header: 'Nom', render: (r) => <b>{r.name}</b> },
          { key: 'type', header: 'Type', render: (r) => <Badge color="blue">{CUSTOMER_TYPES[r.type]}</Badge> },
          { key: 'phone', header: 'Téléphone', hideSm: true },
          { key: 'total_purchases', header: 'Achats', align: 'end', hideSm: true, render: (r) => money(r.total_purchases) },
          { key: 'balance', header: 'Solde dû', align: 'end', render: (r) => <span className={r.balance > 0 ? (r.credit_limit > 0 && r.balance > r.credit_limit ? 'font-bold text-red-600' : 'font-semibold text-amber-600') : ''}>{money(r.balance)}</span> },
        ]}
      />
      <PartnerForm kind="customers" open={form} onClose={() => setForm(false)} onSaved={(id) => nav(`/clients/${id}`)} />
    </div>
  );
}
