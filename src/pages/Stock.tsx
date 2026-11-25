import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { EntitySelect, ExportButtons, fetchAll, SearchBox } from '../components/common';
import { Badge, Button, Field, Input, Modal, PageHeader, Select, Stat, Textarea, useToast } from '../components/ui';

export default function Stock() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState(false);
  const dq = useDebounce(q);
  const nav = useNavigate();
  const { can } = useAuth();
  const url = `/api/stock${qs({ q: dq, filter })}`;
  const { data, loading, reload } = useFetch<any>(`${url}&page=${page}`);
  const fin = can('finance.view');
  return (
    <div>
      <PageHeader
        title="État du stock"
        actions={
          <>
            <ExportButtons
              filename="etat-stock"
              columns={[
                { key: 'reference', label: 'Référence' },
                { key: 'barcode', label: 'Code-barres' },
                { key: 'name', label: 'Produit' },
                { key: 'category_name', label: 'Catégorie' },
                { key: 'stock', label: 'Stock', type: 'int' },
                { key: 'min_stock', label: 'Minimum', type: 'int' },
                ...(fin ? [{ key: 'avg_cost', label: 'CMP', type: 'money' as const }, { key: 'value', label: 'Valeur', type: 'money' as const }] : []),
              ]}
              getRows={() => fetchAll(url)}
            />
            {can('stock.adjust') && (
              <Button icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjust(true)}>
                Entrée / sortie manuelle
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Références" value={data?.total ?? '…'} />
        <Stat label="Unités en stock" value={data?.total_units?.toLocaleString('fr-FR') ?? '…'} />
        {fin && <Stat label="Valeur du stock" value={money(data?.total_value)} tone="gold" />}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Produit, référence, code-barres…" className="w-72" />
        <Select className="h-9 w-auto" value={filter} onChange={(e) => (setFilter(e.target.value), setPage(1))}>
          <option value="all">Tous</option>
          <option value="low">Stock faible</option>
          <option value="out">Rupture</option>
          <option value="over">Au-dessus du maximum</option>
        </Select>
      </div>
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => nav(`/produits/${r.id}`)}
        columns={[
          { key: 'reference', header: 'Référence', render: (r) => <span className="num text-xs">{r.reference}</span> },
          { key: 'name', header: 'Produit' },
          { key: 'category_name', header: 'Catégorie', hideSm: true },
          { key: 'next_expiry', header: 'Proch. péremption', hideSm: true, render: (r) => r.next_expiry ?? '—' },
          { key: 'min_stock', header: 'Min', align: 'end', hideSm: true },
          { key: 'stock', header: 'Stock', align: 'end', render: (r) => <Badge color={r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'}>{`${r.stock} ${r.unit}`}</Badge> },
          ...(fin ? [{ key: 'value', header: 'Valeur', align: 'end' as const, render: (r: any) => money(r.value) }] : []),
        ]}
      />
      <AdjustModal open={adjust} onClose={() => setAdjust(false)} onDone={reload} />
    </div>
  );
}

export function AdjustModal({ open, onClose, onDone, productId }: { open: boolean; onClose: () => void; onDone: () => void; productId?: string }) {
  const [f, setF] = useState<any>({ product_id: productId ?? null, type: 'ajustement', qty: 1, direction: 'in', reason: '', batch_number: '', expires_at: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const qty = f.type === 'ajustement' ? (f.direction === 'in' ? 1 : -1) * Math.abs(f.qty) : Math.abs(f.qty);
      const r = await api.post('/api/stock/adjust', { product_id: f.product_id, type: f.type, qty, reason: f.reason, batch_number: f.batch_number || null, expires_at: f.expires_at || null });
      toast.success(`Mouvement ${r.doc_number} enregistré — stock : ${r.stock_after}`);
      onClose();
      onDone();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Entrée / sortie manuelle de stock" footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button loading={busy} disabled={!f.product_id || f.reason.trim().length < 3 || !f.qty} onClick={submit}>Enregistrer</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Produit" required className="sm:col-span-2">
          <EntitySelect endpoint="/api/products" value={f.product_id} onChange={(v) => setF({ ...f, product_id: v })} render={(r) => `${r.name} (${r.reference})`} />
        </Field>
        <Field label="Type de mouvement">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="ajustement">Ajustement (entrée ou sortie)</option>
            <option value="endommage">Produit endommagé (sortie)</option>
            <option value="perime">Produit périmé (sortie)</option>
            <option value="retour_client">Retour client sans ticket (entrée)</option>
          </Select>
        </Field>
        {f.type === 'ajustement' && (
          <Field label="Sens">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="in">Entrée (+)</option>
              <option value="out">Sortie (−)</option>
            </Select>
          </Field>
        )}
        <Field label="Quantité" required>
          <Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: Number(e.target.value) })} />
        </Field>
        {(f.type === 'ajustement' && f.direction === 'in') || f.type === 'retour_client' ? (
          <>
            <Field label="N° de lot (facultatif)">
              <Input value={f.batch_number} onChange={(e) => setF({ ...f, batch_number: e.target.value })} />
            </Field>
            <Field label="Péremption (facultatif)">
              <Input type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} />
            </Field>
          </>
        ) : null}
        <Field label="Motif" required className="sm:col-span-2">
          <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
