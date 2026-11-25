import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ProductPicker } from '../components/ProductPicker';
import { EntitySelect } from '../components/common';
import { Button, Field, Input, Modal, PageHeader, Textarea, useToast } from '../components/ui';

export default function SupplierReturns() {
  const { data, loading, reload } = useFetch<any[]>('/api/purchases/returns');
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const fin = can('purchases.manage', 'finance.view');
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/api/purchases/returns', { supplier_id: supplier, reason, items: items.map((i) => ({ product_id: i.product_id, qty: i.qty })) });
      toast.success('Retour fournisseur enregistré — stock diminué');
      setOpen(false);
      setItems([]);
      setReason('');
      reload();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Retours fournisseurs" actions={can('returns.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nouveau retour</Button>} />
      <DataTable
        rows={data}
        loading={loading}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'supplier_name', header: 'Fournisseur' },
          { key: 'receipt_number', header: 'Réception', hideSm: true, render: (r) => r.receipt_number ?? '—' },
          { key: 'reason', header: 'Motif' },
          ...(fin ? [{ key: 'total_ttc', header: 'Montant TTC', align: 'end' as const, render: (r: any) => money(r.total_ttc) }] : []),
          { key: 'created_by_name', header: 'Par', hideSm: true },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Retour fournisseur" size="lg" footer={<Button loading={busy} disabled={!supplier || !items.length || reason.trim().length < 3} onClick={submit}>Valider le retour</Button>}>
        <div className="space-y-3">
          <Field label="Fournisseur" required><EntitySelect endpoint="/api/suppliers" value={supplier} onChange={setSupplier} /></Field>
          <ProductPicker onPick={(p, q) => setItems((x) => (x.some((i) => i.product_id === p.id) ? x.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + q } : i)) : [...x, { product_id: p.id, name: p.name, qty: q }]))} />
          {items.map((it, i) => (
            <div key={it.product_id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{it.name}</span>
              <Input type="number" min={1} className="h-8 w-24" value={it.qty} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} />
              <button className="text-red-600" onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Field label="Motif" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
