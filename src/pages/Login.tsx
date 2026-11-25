import { useState } from 'react';
import { Lock, Mail } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button, ErrorBox, Field, Input, Modal } from '../components/ui';
import { LangToggle, ThemeToggle } from '../components/Layout';

export default function Login() {
  const { refresh } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-linear-to-br from-[#071735] via-navy to-[#14306a]">
      <div className="pointer-events-none absolute -end-40 -top-40 size-[520px] rounded-full bg-gold/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -start-40 size-[480px] rounded-full bg-[#2a5bb8]/30 blur-3xl" />
      <div className="relative flex justify-end gap-2 p-3 text-white">
        <div className="rounded-lg bg-white text-navy">
          <LangToggle />
        </div>
        <div className="rounded-lg bg-white text-navy">
          <ThemeToggle />
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center p-4">
        <form onSubmit={submit} className="relative w-full max-w-md overflow-hidden rounded-3xl bg-surface p-6 shadow-2xl shadow-black/40 ring-1 ring-white/10 sm:p-9">
          <div className="absolute inset-x-0 top-0 h-1.5 bg-linear-to-r from-gold via-[#f0cd7a] to-gold" />
          <img src="/logo-sm.png" alt="Nour de Commerce" className="mx-auto mb-2 w-64 max-w-full rounded-lg bg-white p-2" />
          <h1 className="mb-6 text-center text-lg font-semibold text-muted">{t('Connexion')} — ERP</h1>
          <div className="space-y-4">
            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="ps-9" autoFocus />
              </div>
            </Field>
            <Field label="Mot de passe">
              <div className="relative">
                <Lock className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="ps-9" />
              </div>
            </Field>
            <ErrorBox error={error} />
            <Button type="submit" size="lg" className="w-full" loading={busy}>
              {t('Se connecter')}
            </Button>
            <button type="button" className="w-full text-center text-sm text-gold-600 hover:underline" onClick={() => setForgot(true)}>
              {t('Mot de passe oublié ?')}
            </button>
          </div>
        </form>
      </div>
      <p className="relative pb-4 text-center text-xs text-white/60">
        © Nour de Commerce · Developed by <b className="text-gold">GM LAC</b>
      </p>
      <Modal open={forgot} onClose={() => setForgot(false)} title={t('Mot de passe oublié ?')} size="sm">
        <p className="text-sm">
          Pour des raisons de sécurité, il n'y a pas d'inscription publique ni de réinitialisation automatique par email. Demandez à l'administrateur (propriétaire) de
          réinitialiser votre mot de passe depuis <b>Administration → Utilisateurs</b>. Vous devrez le changer à la prochaine connexion.
        </p>
      </Modal>
    </div>
  );
}
