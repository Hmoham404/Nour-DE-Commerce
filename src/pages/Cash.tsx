import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, Lock, Printer, Unlock, Wrench } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch, usePeriod } from '../lib/hooks';
import { dt, money, PAY_METHODS } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { openPrint, PeriodFilter } from '../components/common';
import { Badge, Button, Card, Field, Modal, MoneyInput, PageHeader, Select, Spinner, Stat, Tabs, Textarea, useConfirm, useToast } from '../components/ui';

const CASH_TYPES: Record<string, string> = {
  opening: 'Fond initial', sale: 'Vente', customer_payment: 'Règlement client', supplier_payment: 'Règlement fournisseur', expense: 'Dépense',
  withdrawal: 'Décaissement', deposit: 'Apport', refund: 'Remboursement', correction: 'Correction',
};
const SESSION_STATUS: Record<string, [string, string]> = { open: ['Ouverte', 'green'], closed: ['Clôturée', 'amber'], validated: ['Validée', 'blue'] };

export default function Cash() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'current' | 'sessions'>('current');
  return (
    <div>
      <PageHeader title="Caisse" subtitle="Ouverture, opérations, clôture avec contrôle des écarts" />
      <Tabs tabs={[['current', 'Ma caisse'], ['sessions', can('cash.manage') ? 'Toutes les sessions' : 'Mes sessions']]} value={tab} onChange={setTab} />
      {tab === 'current' ? <Current /> : <Sessions />}
    </div>
  );
}

function Current() {
  const { data, loading, reload } = useFetch<any>('/api/cash/current');
  const detail = useFetch<any>(data?.session ? `/api/cash/sessions/${data.session.id}` : null, [data?.session?.id]);
  const [openForm, setOpenForm] = useState({ register_id: '', amount: 0 as number | null });
  const [mv, setMv] = useState<null | 'withdrawal' | 'deposit' | 'correction'>(null);
  const [close, setClose] = useState(false);
  const toast = useToast();
  const { can } = useAuth();
  if (loading && !data) return <Spinner />;
  const s = data?.session;

  if (!s)
    return (
      <Card title="Ouvrir la caisse" className="max-w-lg">
        <div className="space-y-3">
          <Field label="Caisse">
            <Select value={openForm.register_id} onChange={(e) => setOpenForm({ ...openForm, register_id: e.target.value })}>
              <option value="">— Choisir —</option>
              {data?.registers?.map((r: any) => <option key={r.id} value={r.id} disabled={!!r.busy_by}>{r.name}{r.busy_by ? ` (ouverte par ${r.busy_by})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Fond de caisse initial (compté)"><MoneyInput value={openForm.amount} onChange={(v) => setOpenForm({ ...openForm, amount: v })} /></Field>
          <Button icon={<Unlock className="size-4" />} disabled={!openForm.register_id} onClick={async () => {
            try { await api.post('/api/cash/open', { register_id: openForm.register_id, opening_amount: openForm.amount ?? 0 }); toast.success('Caisse ouverte'); reload(); } catch (e: any) { toast.error(e); }
          }}>Ouvrir la caisse</Button>
        </div>
      </Card>
    );

  const byType = Object.fromEntries((s.by_type ?? []).map((r: any) => [r.type, r.total]));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted">Session <b className="num text-fg">{s.number}</b> · {s.register_name} · ouverte le {dt(s.opened_at)}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<ArrowUpCircle className="size-4" />} onClick={() => setMv('withdrawal')}>Décaissement</Button>
          <Button variant="outline" icon={<ArrowDownCircle className="size-4" />} onClick={() => setMv('deposit')}>Apport</Button>
          {can('cash.manage') && <Button variant="outline" icon={<Wrench className="size-4" />} onClick={() => setMv('correction')}>Correction</Button>}
          <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('caisse', s.id)}>Rapport</Button>
          <Button variant="danger" icon={<Lock className="size-4" />} onClick={() => setClose(true)}>Fermer la caisse</Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solde théorique (espèces)" value={money(s.expected_now)} tone="gold" />
        <Stat label="Fond initial" value={money(s.opening_amount)} />
        <Stat label="Ventes encaissées (espèces)" value={money(byType.sale ?? 0)} tone="green" />
        <Stat label="Sorties (dépenses, décaissements…)" value={money((byType.expense ?? 0) + (byType.withdrawal ?? 0) + (byType.refund ?? 0) + (byType.supplier_payment ?? 0))} tone="red" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Opérations de la session" padded={false} className="lg:col-span-2">
          <DataTable
            rows={detail.data?.movements}
            loading={detail.loading}
            clientPageSize={50}
            columns={[
              { key: 'created_at', header: 'Heure', render: (r) => dt(r.created_at) },
              { key: 'type', header: 'Type', render: (r) => CASH_TYPES[r.type] },
              { key: 'ref_number', header: 'Document', render: (r) => r.ref_number ?? '—' },
              { key: 'reason', header: 'Motif', hideSm: true },
              { key: 'amount', header: 'Montant', align: 'end', render: (r) => <b className={r.amount >= 0 ? 'text-green-600' : 'text-red-600'}>{money(r.amount)}</b> },
            ]}
          />
        </Card>
        <Card title="Encaissements par mode">
          <div className="space-y-1 text-sm">
            {(s.by_method ?? []).map((m: any) => (
              <div key={m.method + m.direction} className="flex justify-between">
                <span>{PAY_METHODS[m.method]} {m.direction === 'out' ? '(sorties)' : ''}</span>
                <span className="num">{money(m.direction === 'out' ? -m.total : m.total)}</span>
              </div>
            ))}
            <p className="pt-2 text-xs text-muted">Seules les espèces entrent dans le solde théorique de la caisse. Le chiffre d'affaires, les encaissements et le solde de caisse sont des notions distinctes.</p>
          </div>
        </Card>
      </div>
      <MovementModal type={mv} onClose={() => setMv(null)} onDone={() => (reload(), detail.reload())} />
      <CloseModal open={close} onClose={() => setClose(false)} expected={s.expected_now} onDone={(id) => (reload(), openPrint('caisse', id))} />
    </div>
  );
}

function MovementModal({ type, onClose, onDone }: { type: null | 'withdrawal' | 'deposit' | 'correction'; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(0);
  const [neg, setNeg] = useState(false);
  const [reason, setReason] = useState('');
  const toast = useToast();
  const titles = { withdrawal: 'Décaissement autorisé', deposit: 'Apport en caisse', correction: 'Contre-opération de correction' };
  return (
    <Modal open={!!type} onClose={onClose} title={type ? titles[type] : ''} size="sm" footer={<Button disabled={!amount || reason.trim().length < 3} onClick={async () => {
      try {
        await api.post('/api/cash/movement', { type, amount: type === 'correction' && neg ? -(amount ?? 0) : amount, reason });
        toast.success('Opération enregistrée');
        setAmount(0); setReason('');
        onClose(); onDone();
      } catch (e: any) { toast.error(e); }
    }}>Enregistrer</Button>}>
      <div className="space-y-3">
        <Field label="Montant"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        {type === 'correction' && (
          <Field label="Sens">
            <Select value={neg ? '1' : '0'} onChange={(e) => setNeg(e.target.value === '1')}>
              <option value="0">+ Ajout</option>
              <option value="1">− Retrait</option>
            </Select>
          </Field>
        )}
        <Field label="Motif" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-xs text-muted">Une opération validée ne peut jamais être supprimée : toute erreur se corrige par une contre-opération tracée.</p>
      </div>
    </Modal>
  );
}

function CloseModal({ open, onClose, expected, onDone }: { open: boolean; onClose: () => void; expected: number; onDone: (id: string) => void }) {
  const [counted, setCounted] = useState<number | null>(null);
  const [just, setJust] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const diff = (counted ?? 0) - expected;
  return (
    <Modal open={open} onClose={onClose} title="Clôture de caisse" size="sm" footer={<Button variant="danger" disabled={counted === null || (diff !== 0 && just.trim().length < 3)} onClick={async () => {
      if (!(await confirm({ title: 'Confirmer la clôture', message: 'Après clôture, aucune opération ne pourra être ajoutée à cette session.' }))) return;
      try {
        const r = await api.post('/api/cash/close', { counted_amount: counted, justification: just || null });
        toast.success(r.difference === 0 ? 'Caisse clôturée sans écart' : `Caisse clôturée — écart ${money(r.difference)}`);
        onClose(); onDone(r.id);
      } catch (e: any) { toast.error(e); }
    }}>Clôturer</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Comptez les espèces présentes dans le tiroir, sans regarder le solde théorique, puis saisissez le montant.</p>
        <Field label="Montant physique compté"><MoneyInput value={counted} onChange={setCounted} allowNull autoFocus className="h-12 text-lg" /></Field>
        {counted !== null && (
          <div className={'rounded-lg p-3 text-sm ' + (diff === 0 ? 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300' : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300')}>
            Théorique : <b className="num">{money(expected)}</b> · Écart : <b className="num">{money(diff)}</b>
          </div>
        )}
        {diff !== 0 && counted !== null && <Field label="Justification de l'écart" required><Textarea value={just} onChange={(e) => setJust(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

function Sessions() {
  const [period, setPeriod] = usePeriod('month');
  const { can } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useFetch<any[]>(`/api/cash/sessions${qs({ from: period.from, to: period.to })}`);
  return (
    <div>
      <div className="mb-3"><PeriodFilter value={period} onChange={setPeriod} /></div>
      <DataTable
        rows={data}
        loading={loading}
        columns={[
          { key: 'number', header: 'Session', render: (r) => <b className="num">{r.number}</b> },
          { key: 'register_name', header: 'Caisse' },
          { key: 'user_name', header: 'Caissier' },
          { key: 'opened_at', header: 'Ouverture', render: (r) => dt(r.opened_at) },
          { key: 'closed_at', header: 'Clôture', hideSm: true, render: (r) => dt(r.closed_at) },
          { key: 'expected_amount', header: 'Théorique', align: 'end', render: (r) => money(r.expected_amount ?? r.balance) },
          { key: 'counted_amount', header: 'Déclaré', align: 'end', hideSm: true, render: (r) => money(r.counted_amount) },
          { key: 'difference', header: 'Écart', align: 'end', render: (r) => (r.difference === null ? '—' : <b className={r.difference === 0 ? 'text-green-600' : 'text-red-600'}>{money(r.difference)}</b>) },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={SESSION_STATUS[r.status][1]}>{SESSION_STATUS[r.status][0]}</Badge> },
          {
            key: 'a', header: '', sortable: false, render: (r) => (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => openPrint('caisse', r.id)} />
                {r.status === 'closed' && can('cash.manage') && <Button size="sm" variant="outline" icon={<CheckCircle2 className="size-4" />} onClick={async () => { try { await api.post(`/api/cash/sessions/${r.id}/validate`); toast.success('Clôture validée'); reload(); } catch (e: any) { toast.error(e); } }}>Valider</Button>}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
