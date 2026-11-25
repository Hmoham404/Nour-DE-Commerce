import { useEffect, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { PERMISSIONS } from '../../shared/permissions';
import { Button, Input, PageHeader, Spinner, useConfirm, useToast } from '../components/ui';

/** Matrice de permissions personnalisable (appliquée côté interface ET côté serveur). */
export default function Roles() {
  const { data, loading, reload } = useFetch<any[]>('/api/roles');
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [newRole, setNewRole] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  useEffect(() => {
    if (!data) return;
    setMatrix(Object.fromEntries(data.map((r) => [r.id, new Set<string>(r.permissions)])));
    setLabels(Object.fromEntries(data.map((r) => [r.id, r.label])));
    setDirty(false);
  }, [data]);
  if (loading && !data) return <Spinner />;
  const toggle = (rid: string, p: string) => {
    setMatrix((m) => {
      const s = new Set(m[rid]);
      s.has(p) ? s.delete(p) : s.add(p);
      return { ...m, [rid]: s };
    });
    setDirty(true);
  };
  const save = async () => {
    try {
      for (const r of data!) await api.put(`/api/roles/${r.id}`, { label: labels[r.id], permissions: [...matrix[r.id]] });
      toast.success('Permissions enregistrées (les utilisateurs concernés voient les changements à leur prochaine action)');
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title="Rôles et permissions"
        subtitle="Cochez les autorisations de chaque profil. Le rôle Administrateur conserve toujours un accès complet."
        actions={
          <>
            <Input className="h-9 w-48" placeholder="Nouveau rôle…" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
            <Button variant="outline" icon={<Plus className="size-4" />} disabled={newRole.trim().length < 2} onClick={async () => { await api.post('/api/roles', { label: newRole, permissions: [] }); setNewRole(''); reload(); }}>Créer</Button>
            <Button icon={<Save className="size-4" />} disabled={!dirty} onClick={save}>Enregistrer</Button>
          </>
        }
      />
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs">
            <tr>
              <th className="px-3 py-2 text-start">Permission</th>
              {data?.map((r) => (
                <th key={r.id} className="min-w-28 px-2 py-2 text-center">
                  <input className="w-full rounded border border-line bg-surface px-1 text-center text-xs font-semibold" value={labels[r.id] ?? ''} onChange={(e) => (setLabels({ ...labels, [r.id]: e.target.value }), setDirty(true))} />
                  <div className="mt-1 flex items-center justify-center gap-1 font-normal text-muted">
                    {r.users_count} utilisateur(s)
                    {!r.is_system && (
                      <button className="text-red-600" onClick={async () => {
                        if (!(await confirm({ title: 'Supprimer le rôle', danger: true }))) return;
                        try { await api.del(`/api/roles/${r.id}`); reload(); } catch (e: any) { toast.error(e); }
                      }}><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(PERMISSIONS).map(([p, label]) => (
              <tr key={p} className="border-t border-line hover:bg-surface-2">
                <td className="px-3 py-1.5">
                  {label}
                  <div className="text-[11px] text-muted">{p}</div>
                </td>
                {data?.map((r) => (
                  <td key={r.id} className="text-center">
                    <input type="checkbox" className="size-4 accent-[#0B2149]" disabled={r.name === 'admin'} checked={r.name === 'admin' || !!matrix[r.id]?.has(p)} onChange={() => toggle(r.id, p)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
