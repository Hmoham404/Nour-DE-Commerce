import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, HandCoins, Pencil, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { CUSTOMER_TYPES, dt, money, PAY_METHODS, PAYMENT_STATUS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { EntitySelect, ExportButtons, openPrint } from '../components/common';
import { Badge, Button, Card, MoneyInput, PageHeader, Spinner, Stat, Tabs, useToast } from '../components/ui';
import { PartnerForm } from './PartnerForm';
import { CustomerPaymentModal } from './SaleDetail';

export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { data: c, loading, reload } = useFetch<any>(`/api/customers/${id}`);
  const statement = useFetch<any>(`/api/customers/${id}/statement`);
  const [tab, setTab] = useState<'releve' | 'impayes' | 'ventes' | 'reglements' | 'tarifs'>('releve');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const [newPrice, setNewPrice] = useState<{ product_id: string | null; price: number | null }>({ product_id: null, price: null });
  if (loading && !c) return <Spinner />;
  if (!c) return null;
  const refresh = () => (reload(), statement.reload());

  return (
    <div>
      <PageHeader
        title={c.name}
        subtitle={<><span className="num">{c.code}</span> · {CUSTOMER_TYPES[c.type]} {c.phone && `· ${c.phone}`} {!c.is_active && <Badge color="gray">Archivé</Badge>}</>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/clients')}>Retour</Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('releve-client', c.id)}>Relevé PDF</Button>
            {can('customers.manage') && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Modifier</Button>}
            {can('customers.manage') && <Button variant="outline" onClick={() => api.post(`/api/customers/${id}/active`, { active: !c.is_active }).then(reload)}>{c.is_active ? 'Archiver' : 'Restaurer'}</Button>}
            {can('payments.manage') && c.balance > 0 && <Button variant="success" icon={<HandCoins className="size-4" />} onClick={() => setPay(true)}>Encaisser</Button>}
          </>
        }
      />
      {c.credit_exceeded && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="size-4" /> Plafond de crédit dépassé ({money(c.balance)} &gt; {money(c.credit_limit)}).
        </div>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde dû" value={money(c.balance)} tone={c.balance > 0 ? 'amber' : 'green'} />
        <Stat label="Plafond de crédit" value={c.credit_limit ? money(c.credit_limit) : 'Aucun'} />
        <Stat label="Impayés" value={c.unpaid.length} sub={c.unpaid.some((u: any) => u.overdue) ? 'dont échus' : undefined} tone={c.unpaid.some((u: any) => u.overdue) ? 'red' : 'navy'} />
        <Stat label="Délai de paiement" value={`${c.payment_terms_days} j`} />
      </div>
      <Tabs tabs={[['releve', 'Relevé de compte'], ['impayes', 'Impayés / échéancier'], ['ventes', 'Ventes et factures'], ['reglements', 'Règlements'], ['tarifs', 'Tarifs personnalisés']]} value={tab} onChange={setTab} />
      {tab === 'releve' && (
        <>
          <div className="mb-2 flex justify-end gap-2">
            <ExportButtons
              filename={`releve-${c.code}`}
              columns={[{ key: 'date', label: 'Date', type: 'datetime' }, { key: 'label', label: 'Libellé' }, { key: 'ref', label: 'Référence' }, { key: 'debit', label: 'Débit', type: 'money' }, { key: 'credit', label: 'Crédit', type: 'money' }, { key: 'balance', label: 'Solde', type: 'money' }]}
              getRows={() => statement.data?.lines ?? []}
            />
          </div>
          <DataTable
            rows={statement.data?.lines}
            loading={statement.loading}
            rowKey={(r) => r.date + r.ref + r.label}
            clientPageSize={100}
            columns={[
              { key: 'date', header: 'Date', render: (r) => dt(r.date) },
              { key: 'label', header: 'Libellé' },
              { key: 'ref', header: 'Référence' },
              { key: 'debit', header: 'Débit', align: 'end', render: (r) => (r.debit ? money(r.debit, false) : '') },
              { key: 'credit', header: 'Crédit', align: 'end', render: (r) => (r.credit ? money(r.credit, false) : '') },
              { key: 'balance', header: 'Solde', align: 'end', render: (r) => <b>{money(r.balance, false)}</b> },
            ]}
          />
        </>
      )}
      {tab === 'impayes' && (
        <DataTable
          rows={c.unpaid}
          onRowClick={(r) => nav(`/ventes/${r.id}`)}
          columns={[
            { key: 'number', header: 'Vente' },
            { key: 'sale_date', header: 'Date', render: (r) => dt(r.sale_date) },
            { key: 'due_date', header: 'Échéance', render: (r) => (r.due_date ? <span className={r.overdue ? 'font-semibold text-red-600' : ''}>{r.due_date}</span> : '—') },
            { key: 'total_ttc', header: 'Total', align: 'end', render: (r) => money(r.total_ttc) },
            { key: 'amount_paid', header: 'Payé', align: 'end', render: (r) => money(r.amount_paid) },
            { key: 'due', header: 'Reste dû', align: 'end', render: (r) => <b>{money(r.due)}</b> },
            { key: 'overdue', header: '', render: (r) => (r.overdue ? <Badge color="red">Échue</Badge> : null) },
          ]}
        />
      )}
      {tab === 'ventes' && (
        <DataTable
          rows={c.sales}
          onRowClick={(r) => nav(`/ventes/${r.id}`)}
          columns={[
            { key: 'number', header: 'Vente' },
            { key: 'invoice_number', header: 'Facture', render: (r) => r.invoice_number ?? '—' },
            { key: 'sale_date', header: 'Date', render: (r) => dt(r.sale_date) },
            { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) },
            { key: 'payment_status', header: 'Paiement', render: (r) => <Badge color={PAYMENT_STATUS[r.payment_status][1]}>{PAYMENT_STATUS[r.payment_status][0]}</Badge> },
            { key: 'status', header: 'Statut', render: (r) => (r.status === 'cancelled' ? <Badge color="red">Annulée</Badge> : null) },
          ]}
        />
      )}
      {tab === 'reglements' && (
        <DataTable
          rows={c.payments}
          columns={[
            { key: 'number', header: 'N°' },
            { key: 'payment_date', header: 'Date', render: (r) => dt(r.payment_date) },
            { key: 'method', header: 'Mode', render: (r) => PAY_METHODS[r.method] },
            { key: 'kind', header: 'Type', render: (r) => (r.direction === 'out' ? <Badge color="amber">Remboursement</Badge> : <Badge color="green">Règlement</Badge>) },
            { key: 'amount', header: 'Montant', align: 'end', render: (r) => money(r.amount) },
            { key: 'p', header: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => openPrint('recu', r.id)} /> },
          ]}
        />
      )}
      {tab === 'tarifs' && (
        <Card title="Prix HT spécifiques à ce client (prioritaires sur le tarif du type)">
          {can('products.prices') && (
            <div className="mb-3 flex flex-wrap items-end gap-2">
              <div className="w-72"><EntitySelect endpoint="/api/products" value={newPrice.product_id} onChange={(v) => setNewPrice({ ...newPrice, product_id: v })} placeholder="Produit" /></div>
              <div className="w-40"><MoneyInput value={newPrice.price} onChange={(v) => setNewPrice({ ...newPrice, price: v })} allowNull /></div>
              <Button disabled={!newPrice.product_id || newPrice.price === null} onClick={async () => {
                try {
                  await api.put(`/api/customers/${id}/prices`, { product_id: newPrice.product_id, price_ht: newPrice.price });
                  setNewPrice({ product_id: null, price: null });
                  reload();
                } catch (e: any) { toast.error(e); }
              }}>Ajouter</Button>
            </div>
          )}
          <DataTable
            rows={c.prices}
            rowKey={(r) => r.product_id}
            columns={[
              { key: 'name', header: 'Produit' },
              { key: 'sale_price', header: 'Prix standard HT', align: 'end', render: (r) => money(r.sale_price) },
              { key: 'price_ht', header: 'Prix client HT', align: 'end', render: (r) => <b>{money(r.price_ht)}</b> },
              { key: 'x', header: '', sortable: false, render: (r) => can('products.prices') && <button className="text-red-600" onClick={() => api.put(`/api/customers/${id}/prices`, { product_id: r.product_id, price_ht: null }).then(reload)}><Trash2 className="size-4" /></button> },
            ]}
          />
        </Card>
      )}
      <PartnerForm kind="customers" open={edit} onClose={() => setEdit(false)} initial={c} onSaved={refresh} />
      <CustomerPaymentModal open={pay} onClose={() => setPay(false)} customerId={c.id} defaultAmount={c.balance} onDone={refresh} />
    </div>
  );
}
