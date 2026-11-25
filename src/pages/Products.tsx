import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, BadgePercent, Plus, Tags, Trash2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDebounce, useFetch } from '../lib/hooks';
import { money, pct } from '../lib/format';
import { priceTtc } from '../../shared/pricing';
import { DataTable } from '../components/DataTable';
import { EntitySelect, ExportButtons, fetchAll, SearchBox } from '../components/common';
import { Badge, Button, Field, Input, Modal, MoneyInput, PageHeader, PercentInput, Select, useConfirm, useToast } from '../components/ui';

export default function Products() {
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [stockF, setStockF] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const dq = useDebounce(q);
  const cats = useFetch<any[]>('/api/categories');
  const url = `/api/products${qs({ q: dq, status, stock: stockF, category_id: category, supplier_id: supplier })}`;
  const { data, loading, reload } = useFetch<any>(`${url}&page=${page}&pageSize=25`);
  const fin = can('finance.view');

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const del = async (p: any) => {
    if (!(await confirm({ title: 'Supprimer le produit', danger: true, message: <p>Supprimer définitivement « {p.name} » ? Si le produit a déjà été utilisé dans des documents, la suppression sera refusée : archivez-le plutôt.</p> }))) return;
    try {
      await api.del(`/api/products/${p.id}`);
      toast.success('Produit supprimé');
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };
  const archive = async (p: any) => {
    await api.post(`/api/products/${p.id}/active`, { active: !p.is_active });
    toast.success(p.is_active ? 'Produit archivé' : 'Produit restauré');
    reload();
  };

  const exportCols = [
    { key: 'reference', label: 'Référence' },
    { key: 'barcode', label: 'Code-barres' },
    { key: 'name', label: 'Désignation' },
    { key: 'category_name', label: 'Catégorie' },
    { key: 'brand_name', label: 'Marque' },
    { key: 'supplier_name', label: 'Fournisseur' },
    ...(fin ? [{ key: 'purchase_price', label: "Prix d'achat HT", type: 'money' as const }, { key: 'avg_cost', label: 'CMP HT', type: 'money' as const }] : []),
    { key: 'sale_price', label: 'Prix vente HT', type: 'money' as const },
    { key: 'price_retail', label: 'Prix détaillant HT', type: 'money' as const },
    { key: 'price_wholesale', label: 'Prix grossiste HT', type: 'money' as const },
    { key: 'price_distributor', label: 'Prix distributeur HT', type: 'money' as const },
    { key: 'vat_bp', label: 'TVA %', type: 'percent' as const },
    { key: 'stock', label: 'Stock', type: 'int' as const },
    { key: 'min_stock', label: 'Stock min', type: 'int' as const },
    { key: 'unit', label: 'Unité' },
  ];

  return (
    <div>
      <PageHeader
        title="Produits"
        subtitle={data ? `${data.total} produit(s)` : undefined}
        actions={
          <>
            <ExportButtons filename="catalogue-produits" title="Catalogue" columns={exportCols} getRows={() => fetchAll(url)} />
            {can('products.prices') && (
              <Button variant="outline" icon={<BadgePercent className="size-4" />} onClick={() => setBulk(true)}>
                Prix en masse
              </Button>
            )}
            {selected.size > 0 && (
              <Button variant="outline" icon={<Tags className="size-4" />} onClick={() => nav(`/codes-barres?ids=${[...selected].join(',')}`)}>
                Étiquettes ({selected.size})
              </Button>
            )}
            {can('products.manage') && (
              <Button icon={<Plus className="size-4" />} onClick={() => nav('/produits/nouveau')}>
                Ajouter un produit
              </Button>
            )}
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <SearchBox value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Nom, référence ou code-barres…" className="w-72" />
        <Select className="h-9 w-auto" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))}>
          <option value="">Toutes catégories</option>
          {cats.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.parent_name ? `${c.parent_name} › ` : ''}
              {c.name}
            </option>
          ))}
        </Select>
        <div className="w-56">
          <EntitySelect endpoint="/api/suppliers" value={supplier} onChange={(id) => (setSupplier(id), setPage(1))} placeholder="Tous fournisseurs" />
        </div>
        <Select className="h-9 w-auto" value={stockF} onChange={(e) => (setStockF(e.target.value), setPage(1))}>
          <option value="">Tout stock</option>
          <option value="low">Stock faible</option>
          <option value="out">En rupture</option>
        </Select>
        <Select className="h-9 w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
          <option value="active">Actifs</option>
          <option value="archived">Archivés</option>
          <option value="all">Tous</option>
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
          { key: 'sel', header: '', sortable: false, render: (r) => <input type="checkbox" className="size-4" checked={selected.has(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} /> },
          { key: 'reference', header: 'Référence', render: (r) => <span className="num text-xs">{r.reference}</span> },
          { key: 'name', header: 'Désignation', render: (r) => <span className="font-medium">{r.name}{!r.is_active && <Badge color="gray"> archivé</Badge>}</span> },
          { key: 'barcode', header: 'Code-barres', hideSm: true, render: (r) => <span className="num text-xs">{r.barcode ?? '—'}</span> },
          { key: 'category_name', header: 'Catégorie', hideSm: true },
          ...(fin ? [{ key: 'avg_cost', header: 'CMP HT', align: 'end' as const, hideSm: true, render: (r: any) => money(r.avg_cost, false) }] : []),
          { key: 'sale_price', header: 'Prix TTC', align: 'end', render: (r) => money(priceTtc(r.sale_price, r.vat_bp)) },
          { key: 'vat_bp', header: 'TVA', align: 'end', hideSm: true, render: (r) => pct(r.vat_bp) },
          { key: 'stock', header: 'Stock', align: 'end', render: (r) => <Badge color={r.stock <= 0 ? 'red' : r.stock <= r.min_stock ? 'amber' : 'green'}>{`${r.stock} ${r.unit}`}</Badge> },
          {
            key: 'actions',
            header: '',
            sortable: false,
            render: (r) =>
              can('products.delete') && (
                <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="ghost" title={r.is_active ? 'Archiver' : 'Restaurer'} icon={<Archive className="size-4" />} onClick={() => archive(r)} />
                  <Button size="sm" variant="ghost" title="Supprimer" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => del(r)} />
                </div>
              ),
          },
        ]}
      />
      <BulkPriceModal open={bulk} onClose={() => setBulk(false)} selected={[...selected]} categories={cats.data ?? []} onDone={reload} />
    </div>
  );
}

function BulkPriceModal({ open, onClose, selected, categories, onDone }: { open: boolean; onClose: () => void; selected: string[]; categories: any[]; onDone: () => void }) {
  const [scope, setScope] = useState<'selected' | 'category' | 'supplier'>(selected.length ? 'selected' : 'category');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState<string | null>(null);
  const [field, setField] = useState('sale_price');
  const [mode, setMode] = useState('percent');
  const [value, setValue] = useState<number | null>(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/products/bulk-price', {
        product_ids: scope === 'selected' ? selected : undefined,
        category_id: scope === 'category' ? category : undefined,
        supplier_id: scope === 'supplier' ? supplier : undefined,
        field,
        mode,
        value: value ?? 0,
        reason,
      });
      toast.success(`${r.updated} prix modifié(s) — historique enregistré`);
      onClose();
      onDone();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Modification des prix en masse" footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button loading={busy} disabled={reason.trim().length < 2} onClick={submit}>Appliquer</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Produits concernés">
          <Select value={scope} onChange={(e) => setScope(e.target.value as any)}>
            <option value="selected" disabled={!selected.length}>Sélection ({selected.length})</option>
            <option value="category">Une catégorie</option>
            <option value="supplier">Un fournisseur</option>
          </Select>
        </Field>
        {scope === 'category' && (
          <Field label="Catégorie">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {scope === 'supplier' && (
          <Field label="Fournisseur">
            <EntitySelect endpoint="/api/suppliers" value={supplier} onChange={setSupplier} />
          </Field>
        )}
        <Field label="Prix à modifier">
          <Select value={field} onChange={(e) => setField(e.target.value)}>
            <option value="sale_price">Prix particulier HT</option>
            <option value="price_retail">Prix détaillant HT</option>
            <option value="price_wholesale">Prix grossiste HT</option>
            <option value="price_distributor">Prix distributeur HT</option>
            <option value="purchase_price">Prix d'achat HT</option>
          </Select>
        </Field>
        <Field label="Type de modification">
          <Select value={mode} onChange={(e) => (setMode(e.target.value), setValue(0))}>
            <option value="percent">Variation en %</option>
            <option value="amount">Variation en montant</option>
            <option value="set">Nouveau prix fixe</option>
          </Select>
        </Field>
        <Field label={mode === 'percent' ? 'Variation (%, négatif = baisse)' : 'Montant (DT)'}>
          {mode === 'percent' ? (
            <Input type="number" step="0.01" value={(value ?? 0) / 100} onChange={(e) => setValue(Math.round(Number(e.target.value) * 100))} />
          ) : (
            <MoneyInput value={value} onChange={setValue} />
          )}
        </Field>
        <Field label="Motif (historique)" required className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex. Hausse fournisseur janvier" />
        </Field>
      </div>
      <PercentInput className="hidden" value={0} onChange={() => {}} />
    </Modal>
  );
}
