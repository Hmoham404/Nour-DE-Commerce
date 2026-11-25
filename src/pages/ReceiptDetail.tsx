import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, money, pct } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { openPrint } from '../components/common';
import { Badge, Button, Card, Field, Input, Modal, MoneyInput, PageHeader, Spinner, useToast } from '../components/ui';

export default function ReceiptDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { data: r, loading, reload } = useFetch<any>(`/api/purchases/receipts/${id}`);
  const [inv, setInv] = useState(false);
  const [f, setF] = useState<any>({ supplier_ref: '', due_date: '', stamp: 0 });
  if (loading && !r) return <Spinner />;
  if (!r) return null;
  const fin = r.total_ttc !== null;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Réception ${r.number}`}
        subtitle={`${dt(r.received_at)} · ${r.supplier_name} · ${r.warehouse_name} · ${r.created_by_name ?? ''}`}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/achats/receptions')}>Retour</Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('bon-entree', r.id)}>Bon d'entrée</Button>
            {!r.invoiced && can('purchases.manage') && <Button icon={<FileText className="size-4" />} onClick={() => setInv(true)}>Enregistrer la facture fournisseur</Button>}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {r.invoiced ? <Badge color="green">Facturée</Badge> : <Badge color="amber">À facturer</Badge>}
        {r.supplier_doc_ref && <Badge>{`BL fournisseur ${r.supplier_doc_ref}`}</Badge>}
      </div>
      <DataTable
        rows={r.items}
        columns={[
          { key: 'reference', header: 'Référence', hideSm: true },
          { key: 'product_name', header: 'Produit' },
          { key: 'qty', header: 'Qté', align: 'end' },
          { key: 'returned_qty', header: 'Retourné', align: 'end', hideSm: true },
          { key: 'batch_number', header: 'Lot', render: (x) => x.batch_number ?? '—' },
          { key: 'expires_at', header: 'Péremption', render: (x) => x.expires_at ?? '—' },
          ...(fin ? [
            { key: 'unit_price', header: 'P.U. HT', align: 'end' as const, render: (x: any) => money(x.unit_price, false) },
            { key: 'vat_bp', header: 'TVA', align: 'end' as const, hideSm: true, render: (x: any) => pct(x.vat_bp) },
            { key: 'line_ht', header: 'Total HT', align: 'end' as const, render: (x: any) => money(x.line_ht) },
          ] : []),
        ]}
      />
      {fin && (
        <Card className="ms-auto mt-4 max-w-sm" title="Totaux">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>Total HT</span><span className="num">{money(r.total_ht)}</span></div>
            <div className="flex justify-between"><span>TVA</span><span className="num">{money(r.total_vat)}</span></div>
            {r.extra_costs > 0 && <div className="flex justify-between"><span>Frais</span><span className="num">{money(r.extra_costs)}</span></div>}
            <div className="flex justify-between font-bold"><span>Total TTC</span><span className="num">{money(r.total_ttc + r.extra_costs)}</span></div>
          </div>
        </Card>
      )}
      <Modal open={inv} onClose={() => setInv(false)} title="Facture fournisseur" size="sm" footer={<Button onClick={async () => {
        try {
          await api.post(`/api/purchases/invoices/from-receipt/${id}`, { supplier_ref: f.supplier_ref || null, due_date: f.due_date || null, stamp: f.stamp ?? 0 });
          toast.success('Facture fournisseur enregistrée (aucun mouvement de stock supplémentaire)');
          setInv(false);
          reload();
        } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        <div className="space-y-3">
          <Field label="N° facture fournisseur"><Input value={f.supplier_ref} onChange={(e) => setF({ ...f, supplier_ref: e.target.value })} /></Field>
          <Field label="Échéance"><Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label="Timbre fiscal"><MoneyInput value={f.stamp} onChange={(v) => setF({ ...f, stamp: v ?? 0 })} /></Field>
        </div>
      </Modal>
    </div>
  );
}
