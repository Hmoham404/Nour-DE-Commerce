import { Download } from 'lucide-react';
import { useFetch } from '../lib/hooks';
import { dt } from '../lib/format';
import { Button, Card, PageHeader } from '../components/ui';

export default function Backups() {
  const { data, reload } = useFetch<any>('/api/backup/info');
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Sauvegardes" subtitle={data?.last_backup_at ? `Dernier export manuel : ${dt(data.last_backup_at)}` : 'Aucun export manuel pour l’instant'} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="1. Sauvegarde automatique (Cloudflare D1 Time Travel)">
          <p className="text-sm">
            La base Cloudflare D1 conserve automatiquement l'historique de toutes les modifications : il est possible de la <b>restaurer à n'importe quelle minute des 30 derniers jours</b>, sans action de votre part.
          </p>
          <p className="mt-2 text-xs text-muted">Procédure de restauration (administrateur technique) : voir docs/SAUVEGARDE.md — commande <code>wrangler d1 time-travel restore</code>.</p>
        </Card>
        <Card title="2. Export complet téléchargeable">
          <p className="mb-3 text-sm">Téléchargez une copie complète des données (format JSON) à conserver sur un disque externe ou un cloud personnel. Recommandé : une fois par semaine.</p>
          <a href="/api/backup/download" onClick={() => setTimeout(reload, 3000)}>
            <Button icon={<Download className="size-4" />}>Télécharger la sauvegarde</Button>
          </a>
          <p className="mt-2 text-xs text-muted">Ce fichier contient des données sensibles : conservez-le en lieu sûr.</p>
        </Card>
      </div>
      {data && (
        <Card title="Volume des données" className="mt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(data.counts).filter(([, n]) => (n as number) > 0).map(([t, n]) => (
              <div key={t} className="flex justify-between border-b border-line py-0.5"><span className="text-muted">{t}</span><span className="num">{String(n)}</span></div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
