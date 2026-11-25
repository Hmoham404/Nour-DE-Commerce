import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, HandCoins, Pencil, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, money, PAY_METHODS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, openPrint } from '../components/common';
import { Badge, Button, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, Stat, Tabs, useToast } from '../components/ui';
import { PartnerForm } from './PartnerForm';
import { PI_STATUS } from './PurchaseInvoices';

export default function SupplierDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const fin = can('finance.view', 'purchases.manage');
  const { data: s, loading, reload } = useFetch<any>(`/api/suppliers/${id}`);
  const statement = useFetch<any>(fin ? `/api/suppliers/${id}/statement` : null);
  const [tab, setTab] = useState<'releve' | 'produits' | 'commandes' | 'receptions' | 'factures' | 'reglements'>(fin ? 'releve' : 'produits');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  if (loading && !s) return <Spinner />;
  if (!s) return null;
  const tabs: [typeof tab, string][] = [
    ...(fin ? ([['releve', 'Relevé']] as [typeof tab, string][]) : []),
    ['produits', 'Produits associés'],
    ['commandes', 'Commandes'],
    ['receptions', 'Réceptions'],
    ...(fin ? ([['factures', 'Factures'], ['reglements', 'Règlements']] as [typeof tab, string][]) : []),
  ];
  return (
    <div>
      <PageHeader
        title={s.name}
        subtitle={<><span className="num">{s.code}</span> {s.contact_name && `· ${s.contact_name}`} {s.phone && `· ${s.phone}`}</>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/fournisseurs')}>Retour</Button>
            {fin && <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('releve-fournisseur', s.id)}>Relevé PDF</Button>}
            {can('suppliers.manage') && <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Modifier</Button>}
            {can('payments.manage') && fin && s.balance > 0 && <Button variant="success" icon={<HandCoins className="size-4" />} onClick={() => setPay(true)}>Régler</Button>}
          </>
        }
      />
      {fin && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Reste à payer" value={money(s.balance)} tone={s.balance > 0 ? 'amber' : 'green'} />
          <Stat label="Factures ouvertes" value={s.invoices.filter((i: any) => ['unpaid', 'partial'].includes(i.status)).length} />
          <Stat label="Réceptions non facturées" value={s.receipts.filter((r: any) => !r.invoiced).length} />
          <Stat label="Délai de paiement" value={`${s.payment_terms_days} j`} />
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'releve' && (
        <>
          <div className="mb-2 flex justify-end gap-2">
            <ExportButtons filename={`releve-${s.code}`} columns={[{ key: 'date', label: 'Date', type: 'datetime' }, { key: 'label', label: 'Libellé' }, { key: 'ref', label: 'Référence' }, { key: 'debit', label: 'Débit', type: 'money' }, { key: 'credit', label: 'Crédit', type: 'money' }, { key: 'balance', label: 'Solde', type: 'money' }]} getRows={() => statement.data?.lines ?? []} />
          </div>
          <DataTable rows={statement.data?.lines} loading={statement.loading} rowKey={(r) => r.date + r.ref + r.label} clientPageSize={100} columns={[
            { key: 'date', header: 'Date', render: (r) => dt(r.date) },
            { key: 'label', header: 'Libellé' },
            { key: 'ref', header: 'Référence' },
            { key: 'debit', header: 'Réglé', align: 'end', render: (r) => (r.debit ? money(r.debit, false) : '') },
            { key: 'credit', header: 'Dû', align: 'end', render: (r) => (r.credit ? money(r.credit, false) : '') },
            { key: 'balance', header: 'Solde', align: 'end', render: (r) => <b>{money(r.balance, false)}</b> },
          ]} />
        </>
      )}
      {tab === 'produits' && <DataTable rows={s.products} onRowClick={(r) => nav(`/produits/${r.id}`)} columns={[{ key: 'reference', header: 'Référence' }, { key: 'name', header: 'Produit' }, ...(fin ? [{ key: 'purchase_price', header: "Prix d'achat HT", align: 'end' as const, render: (r: any) => money(r.purchase_price) }] : [])]} />}
      {tab === 'commandes' && <DataTable rows={s.orders} onRowClick={(r) => nav(`/achats/commandes/${r.id}`)} columns={[{ key: 'number', header: 'N°' }, { key: 'order_date', header: 'Date' }, { key: 'status', header: 'Statut' }, { key: 'total_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.total_ttc) }]} />}
      {tab === 'receptions' && <DataTable rows={s.receipts} onRowClick={(r) => nav(`/achats/receptions/${r.id}`)} columns={[{ key: 'number', header: 'N°' }, { key: 'received_at', header: 'Date', render: (r) => dt(r.received_at) }, { key: 'invoiced', header: 'Facturée', render: (r) => (r.invoiced ? <Badge color="green">Oui</Badge> : <Badge color="amber">Non</Badge>) }, ...(fin ? [{ key: 'total_ttc', header: 'Total TTC', align: 'end' as const, render: (r: any) => money(r.total_ttc) }] : [])]} />}
      {tab === 'factures' && <DataTable rows={s.invoices} columns={[{ key: 'number', header: 'N° interne' }, { key: 'supplier_ref', header: 'Réf. fournisseur' }, { key: 'invoice_date', header: 'Date' }, { key: 'due_date', header: 'Échéance' }, { key: 'total_ttc', header: 'TTC', align: 'end', render: (r) => money(r.total_ttc) }, { key: 'amount_paid', header: 'Réglé', align: 'end', render: (r) => money(r.amount_paid) }, { key: 'status', header: 'Statut', render: (r) => <Badge color={PI_STATUS[r.status][1]}>{PI_STATUS[r.status][0]}</Badge> }]} />}
      {tab === 'reglements' && <DataTable rows={s.payments} columns={[{ key: 'number', header: 'N°' }, { key: 'payment_date', header: 'Date', render: (r) => dt(r.payment_date) }, { key: 'method', header: 'Mode', render: (r) => PAY_METHODS[r.method] }, { key: 'reference', header: 'Référence' }, { key: 'amount', header: 'Montant', align: 'end', render: (r) => money(r.amount) }]} />}
      <PartnerForm kind="suppliers" open={edit} onClose={() => setEdit(false)} initial={s} onSaved={() => (reload(), statement.reload())} />
      <SupplierPaymentModal open={pay} onClose={() => setPay(false)} supplierId={s.id} defaultAmount={s.balance} onDone={() => (reload(), statement.reload())} />
    </div>
  );
}

export function SupplierPaymentModal({ open, onClose, supplierId, invoiceIds, defaultAmount, onDone }: { open: boolean; onClose: () => void; supplierId: string; invoiceIds?: string[]; defaultAmount?: number; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(defaultAmount ?? 0);
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/payments/supplier', { supplier_id: supplierId, invoice_ids: invoiceIds, amount, method, reference });
      toast.success('Règlement fournisseur enregistré');
      onClose();
      onDone();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Règlement fournisseur" size="sm" footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button loading={busy} disabled={!amount} onClick={submit}>Enregistrer</Button></>}>
      <div className="space-y-3">
        <Field label="Montant"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Mode de paiement">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Référence (n° chèque, virement…)"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <p className="text-xs text-muted">Imputé sur les factures fournisseur les plus anciennes (ou celles sélectionnées). Un paiement en espèces sort de votre caisse ouverte.</p>
      </div>
    </Modal>
  );
}
