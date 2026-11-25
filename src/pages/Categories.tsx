import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { DataTable } from '../components/DataTable';
import { Button, Card, Field, Input, Modal, PageHeader, Select, useConfirm, useToast } from '../components/ui';

function Editor({ endpoint, title, withParent, rows, onDone }: { endpoint: string; title: string; withParent?: boolean; rows: any[]; onDone: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [edit, setEdit] = useState<any | null>(null);
  const save = async () => {
    try {
      if (edit.id) await api.put(`${endpoint}/${edit.id}`, { name: edit.name, parent_id: edit.parent_id || null });
      else await api.post(endpoint, { name: edit.name, parent_id: edit.parent_id || null });
      toast.success('Enregistré');
      setEdit(null);
      onDone();
    } catch (e: any) {
      toast.error(e);
    }
  };
  const del = async (r: any) => {
    if (!(await confirm({ title: 'Supprimer', danger: true, message: `Supprimer « ${r.name} » ?` }))) return;
    try {
      await api.del(`${endpoint}/${r.id}`);
      onDone();
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <Card title={title} padded={false} actions={can('products.manage') && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ name: '', parent_id: '' })}>Ajouter</Button>}>
      <DataTable
        rows={rows}
        columns={[
          { key: 'name', header: 'Nom', render: (r) => (r.parent_name ? <span><span className="text-muted">{r.parent_name} › </span>{r.name}</span> : <b>{r.name}</b>) },
          { key: 'products_count', header: 'Produits', align: 'end' },
          {
            key: 'a',
            header: '',
            sortable: false,
            render: (r) =>
              can('products.manage') && (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r })} />
                  <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => del(r)} />
                </div>
              ),
          },
        ]}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Modifier' : 'Ajouter'} size="sm" footer={<Button disabled={!edit?.name?.trim()} onClick={save}>Enregistrer</Button>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Nom" required>
              <Input autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            {withParent && (
              <Field label="Catégorie parente (sous-catégorie)">
                <Select value={edit.parent_id ?? ''} onChange={(e) => setEdit({ ...edit, parent_id: e.target.value })}>
                  <option value="">— Aucune (catégorie principale) —</option>
                  {rows.filter((r) => !r.parent_id && r.id !== edit.id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function Categories() {
  const cats = useFetch<any[]>('/api/categories');
  const brands = useFetch<any[]>('/api/brands');
  return (
    <div>
      <PageHeader title="Catégories" subtitle="Catégories, sous-catégories et marques" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Editor endpoint="/api/categories" title="Catégories et sous-catégories" withParent rows={cats.data ?? []} onDone={cats.reload} />
        <Editor endpoint="/api/brands" title="Marques" rows={brands.data ?? []} onDone={brands.reload} />
      </div>
    </div>
  );
}
