import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { dt } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { Badge, Button, Field, Modal, PageHeader, Select, Textarea, useToast } from '../components/ui';

export const INV_STATUS: Record<string, [string, string]> = {
  draft: ['Comptage en cours', 'blue'],
  submitted: ['Soumis — à valider', 'amber'],
  validated: ['Validé', 'green'],
  cancelled: ['Annulé', 'gray'],
};

export default function Inventories() {
  const { data, loading } = useFetch<any[]>('/api/inventories');
  const cats = useFetch<any[]>('/api/categories');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ scope: 'empty', notes: '', category_id: '' });
  const nav = useNavigate();
  const toast = useToast();
  const create = async () => {
    try {
      const r = await api.post('/api/inventories', { scope: f.scope, notes: f.notes || null, category_id: f.category_id || null });
      nav(`/inventaires/${r.id}`);
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <div>
      <PageHeader title="Inventaires" subtitle="Comptage rapide par scan, comparaison stock théorique / physique, validation des écarts" actions={<Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nouvel inventaire</Button>} />
      <DataTable
        rows={data}
        loading={loading}
        onRowClick={(r) => nav(`/inventaires/${r.id}`)}
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'created_at', header: 'Créé le', render: (r) => dt(r.created_at) },
          { key: 'warehouse_name', header: 'Dépôt' },
          { key: 'items_count', header: 'Produits', align: 'end' },
          { key: 'created_by_name', header: 'Par', hideSm: true },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={INV_STATUS[r.status][1]}>{INV_STATUS[r.status][0]}</Badge> },
          { key: 'validated_by_name', header: 'Validé par', hideSm: true, render: (r) => r.validated_by_name ? `${r.validated_by_name} · ${dt(r.validated_at)}` : '—' },
        ]}
      />
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvel inventaire" size="sm" footer={<Button onClick={create}>Commencer</Button>}>
        <div className="space-y-3">
          <Field label="Mode">
            <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              <option value="empty">Partiel — seuls les produits scannés sont comptés</option>
              <option value="all">Complet — tous les produits (non scannés = 0)</option>
            </Select>
          </Field>
          {f.scope === 'all' && (
            <Field label="Limiter à une catégorie">
              <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
                <option value="">Toutes</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Notes">
            <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
