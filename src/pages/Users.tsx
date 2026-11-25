import { useState } from 'react';
import { KeyRound, Pencil, Plus, Power } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, pct } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { Badge, Button, ErrorBox, Field, Input, Modal, PageHeader, PercentInput, Select, Tabs, useConfirm, useToast } from '../components/ui';

export default function Users() {
  const { me } = useAuth();
  const users = useFetch<any[]>('/api/users');
  const roles = useFetch<any[]>('/api/roles');
  const [tab, setTab] = useState<'users' | 'history'>('users');
  const [page, setPage] = useState(1);
  const history = useFetch<any>(tab === 'history' ? `/api/users/login-history?page=${page}&pageSize=50` : null, [tab, page]);
  const [edit, setEdit] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const save = async () => {
    setError(null);
    try {
      const body = { email: edit.email, full_name: edit.full_name, phone: edit.phone || null, role_id: edit.role_id, max_discount_bp: edit.limit ? edit.max_discount_bp : null };
      if (edit.id) await api.put(`/api/users/${edit.id}`, body);
      else await api.post('/api/users', { ...body, password: edit.password });
      toast.success(edit.id ? 'Utilisateur modifié' : 'Utilisateur créé — il devra changer son mot de passe à la première connexion');
      setEdit(null);
      users.reload();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      <PageHeader title="Utilisateurs" subtitle="Aucune inscription publique : seul l'administrateur crée les comptes" actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit({ email: '', full_name: '', phone: '', role_id: 'role-caissier', password: '', limit: false, max_discount_bp: 500 })}>Nouvel utilisateur</Button>} />
      <Tabs tabs={[['users', 'Comptes'], ['history', 'Historique des connexions']]} value={tab} onChange={setTab} />
      {tab === 'users' ? (
        <DataTable
          rows={users.data}
          loading={users.loading}
          columns={[
            { key: 'full_name', header: 'Nom', render: (r) => <b>{r.full_name}</b> },
            { key: 'email', header: 'Email' },
            { key: 'role_label', header: 'Rôle', render: (r) => <Badge color="blue">{r.role_label}</Badge> },
            { key: 'max_discount_bp', header: 'Remise max', align: 'end', hideSm: true, render: (r) => (r.max_discount_bp === null ? 'Par défaut' : pct(r.max_discount_bp)) },
            { key: 'last_login_at', header: 'Dernière connexion', hideSm: true, render: (r) => dt(r.last_login_at) },
            { key: 'is_active', header: 'Statut', render: (r) => (r.is_active ? <Badge color="green">Actif</Badge> : <Badge color="red">Désactivé</Badge>) },
            {
              key: 'a', header: '', sortable: false, render: (r) => (
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" title="Modifier" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r, limit: r.max_discount_bp !== null, max_discount_bp: r.max_discount_bp ?? 500 })} />
                  <Button size="sm" variant="ghost" title="Réinitialiser le mot de passe" icon={<KeyRound className="size-4" />} onClick={() => (setReset(r), setPwd(''))} />
                  {r.id !== me?.id && (
                    <Button size="sm" variant="ghost" title={r.is_active ? 'Désactiver' : 'Activer'} className={r.is_active ? 'text-red-600' : 'text-green-600'} icon={<Power className="size-4" />} onClick={async () => {
                      if (!(await confirm({ title: r.is_active ? 'Désactiver le compte' : 'Réactiver le compte', danger: r.is_active, message: r.is_active ? 'L’utilisateur sera immédiatement déconnecté de tous ses appareils.' : undefined }))) return;
                      await api.post(`/api/users/${r.id}/active`, { active: !r.is_active });
                      users.reload();
                    }} />
                  )}
                </div>
              ),
            },
          ]}
        />
      ) : (
        <DataTable
          rows={history.data?.rows}
          loading={history.loading}
          total={history.data?.total}
          page={page}
          pageSize={50}
          onPage={setPage}
          columns={[
            { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
            { key: 'email', header: 'Email' },
            { key: 'full_name', header: 'Utilisateur', hideSm: true },
            { key: 'success', header: 'Résultat', render: (r) => (r.success ? <Badge color="green">Réussie</Badge> : <Badge color="red">{`Échec (${r.reason ?? ''})`}</Badge>) },
            { key: 'ip', header: 'IP', hideSm: true },
            { key: 'user_agent', header: 'Appareil', hideSm: true, render: (r) => <span className="line-clamp-1 text-xs">{r.user_agent}</span> },
          ]}
        />
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Modifier l’utilisateur' : 'Nouvel utilisateur'} footer={<Button onClick={save}>Enregistrer</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom complet" required><Input value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
            <Field label="Email (identifiant)" required><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Téléphone"><Input value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Rôle" required>
              <Select value={edit.role_id} onChange={(e) => setEdit({ ...edit, role_id: e.target.value })}>
                {roles.data?.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            </Field>
            {!edit.id && <Field label="Mot de passe provisoire" hint="8 caractères min., lettres et chiffres" required><Input type="text" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>}
            <Field label="Remise maximale autorisée">
              <div className="flex items-center gap-2">
                <Select className="w-40" value={edit.limit ? '1' : '0'} onChange={(e) => setEdit({ ...edit, limit: e.target.value === '1' })}>
                  <option value="0">Valeur par défaut</option>
                  <option value="1">Personnalisée</option>
                </Select>
                {edit.limit && <PercentInput value={edit.max_discount_bp} onChange={(v) => setEdit({ ...edit, max_discount_bp: v })} />}
              </div>
            </Field>
            <div className="sm:col-span-2"><ErrorBox error={error} /></div>
          </div>
        )}
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`Réinitialiser le mot de passe — ${reset?.full_name}`} size="sm" footer={<Button disabled={pwd.length < 8} onClick={async () => {
        try { await api.post(`/api/users/${reset.id}/reset-password`, { password: pwd }); toast.success('Mot de passe réinitialisé — à changer à la prochaine connexion'); setReset(null); } catch (e: any) { toast.error(e); }
      }}>Réinitialiser</Button>}>
        <Field label="Nouveau mot de passe provisoire" hint="Communiquez-le en main propre. L’utilisateur sera déconnecté partout."><Input value={pwd} onChange={(e) => setPwd(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
