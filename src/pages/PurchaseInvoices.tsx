import { useState } from 'react';
import { HandCoins, Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useDebounce, useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { EntitySelect, SearchBox } from '../components/common';
import { Badge, Button, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, useConfirm, useToast } from '../components/ui';
import { SupplierPaymentModal } from './SupplierDetail';

export const PI_STATUS: Record<string, [string, string]> = {
  unpaid: ['Impayée', 'red'],
  partial: ['Partielle', 'amber'],
  paid: ['Payée', 'green'],
  cancelled: ['Annulée', 'gray'],
};

export default function PurchaseInvoices() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [pay, setPay] = useState<any | null>(null);
  const dq = useDebounce(q);
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, reload } = useFetch<any>(`/api/purchases/invoices${qs({ q: dq, status, page })}`);
  const [f, setF] = useState<any>({ supplier_id: null, supplier_ref: '', invoice_date: '', due_date: '', total_ht: 0, total_vat: 0, stamp: 0, notes: '' });
  return (
    <div>
      <PageHeader title="Factures fournisseurs" actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>Facture sans réception</Button>} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Factures" value={data?.total ?? '…'} />
        <Stat label="Reste à payer" value={money(data?.total_due)} tone="amber" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={setQ} className="w-60" />
        <Select className="h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="open">À régler</option>
          <option value="overdue">Échues</option>
          <option value="paid">Payées</option>
          <option value="cancelled">Annulées</option>
          <option value="">Toutes</option>
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        columns={[
          { key: 'number', header: 'N° interne', render: (r) => <b className="num">{r.number}</b> },
          { key: 'supplier_ref', header: 'Réf. fournisseur', render: (r) => r.supplier_ref ?? '—' },
          { key: 'supplier_name', header: 'Fournisseur' },
          { key: 'receipt_number', header: 'Réception', hideSm: true, render: (r) => r.receipt_number ?? '—' },
          { key: 'invoice_date', header: 'Date', hideSm: true },
          { key: 'due_date', header: 'Échéance', render: (r) => r.due_date ?? '—' },
          { key: 'total_ttc', header: 'TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'due', header: 'Reste', align: 'end', render: (r) => (r.status === 'cancelled' ? '—' : money(r.due)) },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={PI_STATUS[r.status][1]}>{PI_STATUS[r.status][0]}</Badge> },
          {
            key: 'a',
            header: '',
            sortable: false,
            render: (r) => (
              <div className="flex gap-1">
                {['unpaid', 'partial'].includes(r.status) && <Button size="sm" variant="success" icon={<HandCoins className="size-4" />} onClick={() => setPay(r)}>Régler</Button>}
                {r.status === 'unpaid' && (
                  <Button size="sm" variant="ghost" onClick={async () => {
                    const reason = await confirm({ title: 'Annuler la facture fournisseur', danger: true, reason: 'Motif' });
                    if (!reason) return;
                    try { await api.post(`/api/purchases/invoices/${r.id}/cancel`, { reason }); reload(); } catch (e: any) { toast.error(e); }
                  }}>Annuler</Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <Modal open={create} onClose={() => setCreate(false)} title="Facture fournisseur sans réception (frais, services, reprise historique)" footer={<Button disabled={!f.supplier_id} onClick={async () => {
        try {
          await api.post('/api/purchases/invoices', { ...f, supplier_ref: f.supplier_ref || null, invoice_date: f.invoice_date || null, due_date: f.due_date || null, notes: f.notes || null });
          toast.success('Facture enregistrée');
          setCreate(false);
          reload();
        } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fournisseur" required className="sm:col-span-2"><EntitySelect endpoint="/api/suppliers" value={f.supplier_id} onChange={(v) => setF({ ...f, supplier_id: v })} /></Field>
          <Field label="N° facture fournisseur"><Input value={f.supplier_ref} onChange={(e) => setF({ ...f, supplier_ref: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={f.invoice_date} onChange={(e) => setF({ ...f, invoice_date: e.target.value })} /></Field>
          <Field label="Total HT"><MoneyInput value={f.total_ht} onChange={(v) => setF({ ...f, total_ht: v ?? 0 })} /></Field>
          <Field label="TVA"><MoneyInput value={f.total_vat} onChange={(v) => setF({ ...f, total_vat: v ?? 0 })} /></Field>
          <Field label="Timbre fiscal"><MoneyInput value={f.stamp} onChange={(v) => setF({ ...f, stamp: v ?? 0 })} /></Field>
          <Field label="Échéance"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <div className="num sm:col-span-2 text-end font-bold">TTC : {money(f.total_ht + f.total_vat + f.stamp)}</div>
        </div>
      </Modal>
      {pay && <SupplierPaymentModal open={!!pay} onClose={() => setPay(null)} supplierId={pay.supplier_id} invoiceIds={[pay.id]} defaultAmount={pay.due} onDone={reload} />}
    </div>
  );
}
