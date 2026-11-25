import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Printer, Send, Trash2, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { money } from '../lib/format';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { DataTable } from '../components/DataTable';
import { EntitySelect, openPrint } from '../components/common';
import { Badge, Button, Card, Input, PageHeader, Spinner, Stat, useConfirm, useToast } from '../components/ui';
import { INV_STATUS } from './Inventories';

export default function InventoryDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: inv, loading, reload } = useFetch<any>(`/api/inventories/${id}`);
  const [onlyGaps, setOnlyGaps] = useState(false);
  if (loading && !inv) return <Spinner />;
  if (!inv) return null;
  const draft = inv.status === 'draft';
  const items = onlyGaps ? inv.items.filter((i: any) => i.difference !== 0) : inv.items;
  const gaps = inv.items.filter((i: any) => i.difference !== 0);
  const valueGap = inv.items.reduce((s: number, i: any) => s + (i.value_diff ?? 0), 0);

  const scan = async (code: string) => {
    try {
      const r = await api.post(`/api/inventories/${id}/scan`, { code });
      reload();
      return { ok: true, message: `${r.name} — compté : ${r.counted_qty} (+${r.added})` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  };
  const setCount = async (pid: string, v: number) => {
    await api.put(`/api/inventories/${id}/items/${pid}`, { counted_qty: Math.max(0, v) });
    reload();
  };
  const action = async (path: string, title: string, message: string) => {
    if (!(await confirm({ title, message }))) return;
    try {
      const r = await api.post(`/api/inventories/${id}/${path}`);
      toast.success(path === 'validate' ? `Inventaire validé — ${r.adjusted} ajustement(s) appliqué(s)` : 'OK');
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };

  return (
    <div>
      <PageHeader
        title={`Inventaire ${inv.number}`}
        subtitle={<><Badge color={INV_STATUS[inv.status][1]}>{INV_STATUS[inv.status][0]}</Badge> · {inv.warehouse_name}</>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/inventaires')}>Retour</Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('inventaire', id!)}>Rapport</Button>
            {draft && <Button variant="outline" icon={<XCircle className="size-4" />} onClick={() => action('cancel', 'Annuler l’inventaire', 'Aucun ajustement ne sera appliqué.')}>Annuler</Button>}
            {draft && <Button icon={<Send className="size-4" />} onClick={() => action('submit', 'Soumettre à validation', 'Le stock théorique est figé ; les ajustements seront appliqués après validation par un responsable.')}>Soumettre</Button>}
            {inv.status === 'submitted' && can('inventory.validate') && (
              <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => action('validate', 'Valider les écarts', `${gaps.length} écart(s) seront appliqués au stock en mouvements « ajustement inventaire ».`)}>
                Valider les ajustements
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Produits comptés" value={inv.items.length} />
        <Stat label="Écarts" value={gaps.length} tone={gaps.length ? 'amber' : 'green'} />
        <Stat label="Unités comptées" value={inv.items.reduce((s: number, i: any) => s + i.counted_qty, 0)} />
        {can('finance.view') && <Stat label="Valeur des écarts" value={money(valueGap)} tone={valueGap < 0 ? 'red' : 'green'} />}
      </div>
      {draft && (
        <Card title="Mode inventaire rapide" className="mb-4">
          <BarcodeScanner onScan={scan} placeholder="Scannez chaque article : la quantité comptée s'incrémente automatiquement" />
          <div className="mt-3 flex items-center gap-2">
            <span className="text-sm text-muted">Ajouter sans code-barres :</span>
            <div className="w-72">
              <EntitySelect endpoint="/api/products" value={null} onChange={async (pid) => pid && (await api.post(`/api/inventories/${id}/scan`, { product_id: pid, qty: 1 }), reload())} placeholder="Choisir un produit" />
            </div>
          </div>
        </Card>
      )}
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Afficher uniquement les écarts
      </label>
      <DataTable
        rows={items}
        rowKey={(r) => r.product_id}
        clientPageSize={100}
        columns={[
          { key: 'reference', header: 'Référence', hideSm: true },
          { key: 'name', header: 'Produit' },
          { key: 'theoretical_qty', header: 'Théorique', align: 'end' },
          {
            key: 'counted_qty',
            header: 'Physique',
            align: 'end',
            render: (r) => (draft ? <Input type="number" min={0} className="ms-auto h-8 w-24 text-end" defaultValue={r.counted_qty} key={r.counted_qty} onBlur={(e) => Number(e.target.value) !== r.counted_qty && setCount(r.product_id, Number(e.target.value))} /> : r.counted_qty),
          },
          { key: 'difference', header: 'Écart', align: 'end', render: (r) => <b className={r.difference === 0 ? 'text-muted' : r.difference > 0 ? 'text-green-600' : 'text-red-600'}>{r.difference > 0 ? '+' : ''}{r.difference}</b> },
          ...(can('finance.view') ? [{ key: 'value_diff', header: 'Valeur écart', align: 'end' as const, hideSm: true, render: (r: any) => money(r.value_diff) }] : []),
          { key: 'scanned_count', header: 'Scans', align: 'end', hideSm: true },
          { key: 'x', header: '', sortable: false, render: (r) => draft && <button className="text-red-600" onClick={() => api.del(`/api/inventories/${id}/items/${r.product_id}`).then(reload)}><Trash2 className="size-4" /></button> },
        ]}
      />
    </div>
  );
}
