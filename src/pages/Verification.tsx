import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, MessageSquare, Printer, RotateCcw } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch, usePeriod } from '../lib/hooks';
import { dt, money, PAYMENT_STATUS, VERIF_STATUS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { openPrint, PeriodFilter } from '../components/common';
import { Badge, Button, Field, Modal, PageHeader, Spinner, Stat, Tabs, Textarea, useToast } from '../components/ui';

/** Espace sécurisé de vérification des factures à distance (propriétaire / contrôleur depuis Moknine). */
export default function Verification() {
  const [tab, setTab] = useState<'pending' | 'today' | 'verified' | 'anomaly' | 'cancelled' | 'unpaid'>('pending');
  const [period, setPeriod] = usePeriod('month');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const filters: Record<string, any> = {
    pending: { verification: 'pending', status: 'validated' },
    today: { from: today, to: today },
    verified: { verification: 'verified' },
    anomaly: { verification: 'anomaly' },
    cancelled: { status: 'cancelled' },
    unpaid: { payment: 'unpaid', status: 'validated' },
  };
  const f = { from: period.from, to: period.to, ...filters[tab] };
  const { data, loading, reload } = useFetch<any>(`/api/invoices${qs({ ...f, page })}`);
  return (
    <div>
      <PageHeader title="Vérification des factures" subtitle="Accès sécurisé à distance — les liens de factures ne sont jamais publics" actions={tab !== 'today' && <PeriodFilter value={period} onChange={setPeriod} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Factures (sélection)" value={data?.summary?.n ?? '…'} />
        <Stat label="Montant TTC" value={money(data?.summary?.ttc)} />
        <Stat label="Payé" value={money(data?.summary?.paid)} tone="green" />
        <Stat label="Impayé" value={money((data?.summary?.ttc ?? 0) - (data?.summary?.paid ?? 0))} tone="amber" />
      </div>
      <Tabs
        tabs={[['pending', 'En attente de vérification'], ['today', 'Factures du jour'], ['verified', 'Vérifiées'], ['anomaly', 'Anomalies'], ['cancelled', 'Annulées'], ['unpaid', 'Impayées']]}
        value={tab}
        onChange={(t) => (setTab(t), setPage(1))}
      />
      <DataTable
        rows={data?.rows}
        loading={loading}
        total={data?.total}
        page={page}
        onPage={setPage}
        onRowClick={(r) => setOpen(r.id)}
        columns={[
          { key: 'number', header: 'Facture', render: (r) => <b className="num">{r.number}</b> },
          { key: 'invoice_date', header: 'Date', render: (r) => dt(r.invoice_date) },
          { key: 'customer_name', header: 'Client', render: (r) => r.customer_name ?? 'Comptoir' },
          { key: 'created_by_name', header: 'Créée par', hideSm: true },
          { key: 'total_ttc', header: 'TTC', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'payment_status', header: 'Paiement', render: (r) => <Badge color={PAYMENT_STATUS[r.payment_status][1]}>{PAYMENT_STATUS[r.payment_status][0]}</Badge> },
          { key: 'verification_status', header: 'Vérification', render: (r) => (r.status === 'cancelled' ? <Badge color="red">Annulée</Badge> : <Badge color={VERIF_STATUS[r.verification_status][1]}>{VERIF_STATUS[r.verification_status][0]}</Badge>) },
          { key: 'comments', header: '', hideSm: true, render: (r) => (r.comments ? <span className="flex items-center gap-1 text-xs text-muted"><MessageSquare className="size-3" />{r.comments}</span> : null) },
          { key: 'v', header: '', sortable: false, render: () => <Eye className="size-4 text-muted" /> },
        ]}
      />
      {open && <ReviewModal id={open} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}

function ReviewModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { data: inv, reload } = useFetch<any>(`/api/invoices/${id}`);
  const sale = useFetch<any>(inv ? `/api/sales/${inv.sale_id}` : null, [inv?.sale_id]);
  const { can } = useAuth();
  const [comment, setComment] = useState('');
  const toast = useToast();
  const act = async (action: string) => {
    try {
      await api.post(`/api/invoices/${id}/review`, { action, comment: comment || null });
      toast.success('Enregistré');
      setComment('');
      reload();
      onDone();
    } catch (e: any) {
      toast.error(e);
    }
  };
  const ACT: Record<string, string> = { created: 'Création', verified: 'Vérifiée', anomaly: 'Anomalie signalée', comment: 'Commentaire', cancelled: 'Annulée', reset: 'Remise en attente' };
  return (
    <Modal open onClose={onClose} title={inv ? `Facture ${inv.number}` : '…'} size="lg" footer={inv && (
      <>
        <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('facture', inv.sale_id)}>Voir / télécharger le PDF</Button>
        {can('invoices.verify') && inv.status === 'validated' && (
          <>
            {inv.verification_status !== 'pending' && <Button variant="outline" icon={<RotateCcw className="size-4" />} onClick={() => act('reset')}>Remettre en attente</Button>}
            <Button variant="danger" icon={<AlertTriangle className="size-4" />} disabled={comment.trim().length < 3} onClick={() => act('anomaly')}>Signaler une anomalie</Button>
            <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => act('verified')}>Marquer vérifiée</Button>
          </>
        )}
      </>
    )}>
      {!inv || !sale.data ? <Spinner /> : (
        <div className="space-y-4 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <div><span className="text-muted">Client</span><div className="font-semibold">{sale.data.customer_name ?? 'Comptoir'}</div></div>
            <div><span className="text-muted">Créée par</span><div>{inv.created_by_name} · {dt(inv.created_at)}</div></div>
            <div><span className="text-muted">Montant</span><div className="num font-bold">{money(inv.total_ttc)} <span className="font-normal text-muted">(payé {money(sale.data.amount_paid)})</span></div></div>
          </div>
          <table className="w-full">
            <thead className="text-xs text-muted"><tr><th className="text-start">Produit</th><th className="text-end">Qté</th><th className="text-end">P.U. HT</th><th className="text-end">Remise</th><th className="text-end">TTC</th></tr></thead>
            <tbody>
              {sale.data.items.map((i: any) => (
                <tr key={i.id} className="border-t border-line"><td className="py-1">{i.product_name}</td><td className="num text-end">{i.qty}</td><td className="num text-end">{money(i.unit_price_ht, false)}</td><td className="num text-end">{i.discount_bp ? i.discount_bp / 100 + ' %' : '—'}</td><td className="num text-end">{money(i.line_ttc, false)}</td></tr>
              ))}
            </tbody>
          </table>
          <div>
            <h4 className="mb-1 font-semibold">Historique</h4>
            <ul className="space-y-1">
              {inv.history.map((h: any) => (
                <li key={h.id} className="rounded-lg bg-surface-2 px-3 py-1.5">
                  <b>{ACT[h.action]}</b> — {h.user_name} · {dt(h.created_at)}
                  {h.comment && <div className="text-muted">« {h.comment} »</div>}
                </li>
              ))}
            </ul>
          </div>
          <Field label="Commentaire">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Ajouter un commentaire (obligatoire pour signaler une anomalie)" />
          </Field>
          <Button size="sm" variant="outline" disabled={comment.trim().length < 1} onClick={() => act('comment')}>Ajouter le commentaire</Button>
          {!can('invoices.verify') && <p className="text-xs text-muted">Accès en lecture seule. La validation à distance doit être autorisée par l'administrateur (Rôles et permissions → « Vérifier / signaler une anomalie »).</p>}
        </div>
      )}
    </Modal>
  );
}
