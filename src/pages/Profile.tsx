import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt } from '../lib/format';
import { Badge, Button, Card, ErrorBox, Field, Input, PageHeader, useToast } from '../components/ui';
import { DataTable } from '../components/DataTable';

function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError('Les deux mots de passe ne correspondent pas.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/me/change-password', { current, next });
      toast.success('Mot de passe modifié. Les autres sessions ont été déconnectées.');
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone?.();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Mot de passe actuel">
        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </Field>
      <Field label="Nouveau mot de passe" hint="8 caractères minimum, avec lettres et chiffres">
        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
      </Field>
      <Field label="Confirmer le nouveau mot de passe">
        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </Field>
      <ErrorBox error={error} />
      <Button type="submit" loading={busy}>
        Enregistrer
      </Button>
    </form>
  );
}

export function ForcePasswordChange() {
  const { refresh, logout, me } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl">
        <img src="/logo-sm.png" alt="Nour de Commerce" className="mx-auto mb-4 w-52 rounded bg-white p-1" />
        <h1 className="mb-1 text-lg font-semibold">Bienvenue {me?.full_name}</h1>
        <p className="mb-4 text-sm text-muted">Pour votre sécurité, choisissez un nouveau mot de passe personnel avant de continuer.</p>
        <PasswordForm onDone={refresh} />
        <button className="mt-4 text-sm text-muted hover:underline" onClick={logout}>
          Déconnexion
        </button>
      </div>
    </div>
  );
}

export default function Profile() {
  const { me } = useAuth();
  const sessions = useFetch<any[]>('/api/me/sessions');
  const toast = useToast();
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Mon profil" subtitle={`${me?.full_name} · ${me?.email} · ${me?.role}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Changer le mot de passe">
          <PasswordForm />
        </Card>
        <Card title="Mes permissions">
          <div className="flex flex-wrap gap-1">
            {me?.permissions.map((p) => (
              <Badge key={p} color="blue">
                {p}
              </Badge>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-4">
        <Card
          title="Sessions actives"
          actions={
            <Button size="sm" variant="outline" onClick={() => api.post('/api/me/sessions/revoke-others').then(() => (toast.success('Autres sessions fermées'), sessions.reload()))}>
              Déconnecter les autres appareils
            </Button>
          }
          padded={false}
        >
          <DataTable
            rows={sessions.data}
            loading={sessions.loading}
            columns={[
              { key: 'user_agent', header: 'Appareil', render: (r) => <span className="line-clamp-1 text-xs">{r.user_agent}</span> },
              { key: 'ip', header: 'IP' },
              { key: 'last_seen_at', header: 'Dernière activité', render: (r) => dt(r.last_seen_at) },
              { key: 'current', header: '', render: (r) => (r.current ? <Badge color="green">Cette session</Badge> : null) },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
