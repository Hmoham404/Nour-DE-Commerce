import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Plus, Printer, Wallet, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { d, money, todayTunis } from '../lib/format';
import { monthBounds, weekBounds } from '../../shared/payroll';
import { addDays } from '../../shared/dates';
import { DataTable } from '../components/DataTable';
import { openPrint } from '../components/common';
import { Badge, Button, Card, Checkbox, ErrorBox, Input, Modal, MoneyInput, PageHeader, Spinner, Stat, cx, useConfirm, useToast } from '../components/ui';
import { PAY_TYPES } from './Personnel';

const RUN_STATUS: Record<string, [string, string]> = { draft: ['Brouillon', 'gray'], validated: ['Validée', 'blue'], paid: ['Payée', 'green'], cancelled: ['Annulée', 'red'] };

export default function Paie() {
  const runs = useFetch<any[]>('/api/hr/payroll');
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  if (open) return <RunDetail id={open} onBack={() => (setOpen(null), runs.reload())} />;
  if (create) return <NewRun onCancel={() => setCreate(false)} onCreated={(id) => (setCreate(false), setOpen(id))} />;
  return (
    <div>
      <PageHeader title="Paie" subtitle="Calculée à partir du pointage, par semaine ou par mois" actions={<Button icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>Nouvelle paie</Button>} />
      <DataTable
        rows={runs.data}
        loading={runs.loading}
        onRowClick={(r) => setOpen(r.id)}
        empty="Aucune paie. Cliquez sur « Nouvelle paie »."
        columns={[
          { key: 'number', header: 'N°', render: (r) => <b className="num">{r.number}</b> },
          { key: 'period_type', header: 'Période', render: (r) => <Badge color="blue">{r.period_type === 'week' ? 'Semaine' : 'Mois'}</Badge> },
          { key: 'period_start', header: 'Du', render: (r) => d(r.period_start) },
          { key: 'period_end', header: 'Au', render: (r) => d(r.period_end) },
          { key: 'employees', header: 'Employés', align: 'end' },
          { key: 'total_net', header: 'Net à payer', align: 'end', render: (r) => <b>{money(r.total_net)}</b> },
          { key: 'status', header: 'Statut', render: (r) => <Badge color={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge> },
        ]}
      />
    </div>
  );
}

function NewRun({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [type, setType] = useState<'week' | 'month'>('month');
  const [ref, setRef] = useState(todayTunis());
  const [start, end] = type === 'week' ? weekBounds(ref) : monthBounds(ref);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [over, setOver] = useState<Record<string, { bonus: number; deductions: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setPreview(null);
    api.post('/api/hr/payroll/preview', { period_type: type, period_start: start, period_end: end, overrides: over }).then((r) => setPreview(r.items)).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, start, end, JSON.stringify(over)]);
  const total = (preview ?? []).reduce((s, i) => s + i.net_amount, 0);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/hr/payroll', { period_type: type, period_start: start, period_end: end, overrides: over });
      toast.success('Paie créée en brouillon');
      onCreated(r.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Nouvelle paie" actions={<Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={onCancel}>Retour</Button>} />
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(['week', 'month'] as const).map((t) => (
              <button key={t} onClick={() => setType(t)} className={cx('rounded-xl border-2 px-6 py-2.5 font-semibold', type === t ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy' : 'border-line')}>{t === 'week' ? 'Par semaine' : 'Par mois'}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRef(addDays(start, -1))}>◀</Button>
            {type === 'month' ? <Input type="month" className="h-10 w-auto" value={ref.slice(0, 7)} onChange={(e) => setRef(e.target.value + '-15')} /> : <Input type="date" className="h-10 w-auto" value={ref} onChange={(e) => setRef(e.target.value)} />}
            <Button variant="outline" size="sm" onClick={() => setRef(addDays(end, 1))}>▶</Button>
          </div>
          <div className="text-sm">Période : <b>{d(start)}</b> → <b>{d(end)}</b></div>
        </div>
      </Card>
      <ErrorBox error={error} />
      {!preview ? <Spinner /> : (
        <>
          <DataTable
            rows={preview}
            rowKey={(r) => r.employee_id}
            clientPageSize={100}
            columns={[
              { key: 'full_name', header: 'Employé', render: (r) => <div><b>{r.full_name}</b><div className="text-xs text-muted">{PAY_TYPES[r.pay_type]}</div></div> },
              { key: 'days_present', header: 'Jours présents', align: 'end', render: (r) => `${r.days_present}${r.days_paid_leave ? ` + ${r.days_paid_leave} congé` : ''}` },
              { key: 'days_absent', header: 'Absences', align: 'end', render: (r) => <span className={r.days_absent ? 'text-red-600' : ''}>{r.days_absent}</span> },
              { key: 'base_amount', header: 'Salaire', align: 'end', render: (r) => money(r.base_amount, false) },
              { key: 'overtime_amount', header: 'H. sup.', align: 'end', render: (r) => (r.overtime_amount ? money(r.overtime_amount, false) : '—') },
              { key: 'bonus', header: 'Prime', align: 'end', render: (r) => <div className="w-28"><MoneyInput className="h-8" value={over[r.employee_id]?.bonus ?? 0} onChange={(v) => setOver({ ...over, [r.employee_id]: { bonus: v ?? 0, deductions: over[r.employee_id]?.deductions ?? 0 } })} /></div> },
              { key: 'advances', header: 'Avances', align: 'end', render: (r) => (r.advances ? <span className="text-red-600">−{money(r.advances, false)}</span> : '—') },
              { key: 'deductions', header: 'Retenue', align: 'end', render: (r) => <div className="w-28"><MoneyInput className="h-8" value={over[r.employee_id]?.deductions ?? 0} onChange={(v) => setOver({ ...over, [r.employee_id]: { bonus: over[r.employee_id]?.bonus ?? 0, deductions: v ?? 0 } })} /></div> },
              { key: 'net_amount', header: 'Net à payer', align: 'end', render: (r) => <b className={r.net_amount < 0 ? 'text-red-600' : ''}>{money(r.net_amount)}</b> },
            ]}
            footer={<tr><td colSpan={8} className="px-3 py-2 text-end">Total net</td><td className="num px-3 py-2 text-end">{money(total)}</td></tr>}
          />
          <p className="mt-2 text-xs text-muted">Employés à la journée : seuls les jours pointés sont payés. Pensez à compléter le pointage avant de créer la paie. Paie de gestion interne : cotisations CNSS / IRPP éventuelles à saisir en « retenue » selon votre comptable.</p>
          <div className="mt-4 flex justify-end"><Button size="lg" loading={busy} disabled={!preview.length} onClick={create}>Créer la paie</Button></div>
        </>
      )}
    </div>
  );
}

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: r, reload } = useFetch<any>(`/api/hr/payroll/${id}`);
  const [pay, setPay] = useState(false);
  const [fromCash, setFromCash] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  if (!r) return <Spinner />;
  const act = async (path: string, title: string, message: string, body: any = {}) => {
    if (!(await confirm({ title, message }))) return;
    try {
      await api.post(`/api/hr/payroll/${id}/${path}`, body);
      toast.success('Enregistré');
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <div>
      <PageHeader
        title={`Paie ${r.number}`}
        subtitle={<>{r.period_type === 'week' ? 'Semaine' : 'Mois'} du {d(r.period_start)} au {d(r.period_end)} · <Badge color={RUN_STATUS[r.status][1]}>{RUN_STATUS[r.status][0]}</Badge></>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={onBack}>Retour</Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('paie', id)}>Imprimer (état + reçus)</Button>
            {['draft', 'validated'].includes(r.status) && <Button variant="outline" icon={<XCircle className="size-4" />} onClick={() => act('cancel', 'Annuler la paie', 'Le pointage et les avances seront de nouveau modifiables.')}>Annuler</Button>}
            {r.status === 'draft' && <Button icon={<CheckCircle2 className="size-4" />} onClick={() => act('validate', 'Valider la paie', 'Le pointage de la période sera verrouillé et les avances déduites.')}>Valider</Button>}
            {r.status === 'validated' && <Button variant="success" icon={<Wallet className="size-4" />} onClick={() => setPay(true)}>Payer</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Brut (salaires + h. sup. + primes)" value={money(r.total_gross)} />
        <Stat label="Avances déduites" value={money(r.total_advances)} tone="amber" />
        <Stat label="Retenues" value={money(r.total_deductions)} tone="amber" />
        <Stat label="Net à payer" value={money(r.total_net)} tone="green" />
      </div>
      <DataTable
        rows={r.items}
        clientPageSize={100}
        onRowClick={r.status === 'draft' ? (x) => setEdit({ ...x }) : undefined}
        columns={[
          { key: 'full_name', header: 'Employé', render: (x) => <div><b>{x.full_name}</b><div className="text-xs text-muted">{PAY_TYPES[x.pay_type]}</div></div> },
          { key: 'days_present', header: 'Présents', align: 'end' },
          { key: 'days_absent', header: 'Absences', align: 'end' },
          { key: 'base_amount', header: 'Salaire', align: 'end', render: (x) => money(x.base_amount, false) },
          { key: 'overtime_amount', header: 'H. sup.', align: 'end', render: (x) => money(x.overtime_amount, false) },
          { key: 'bonus', header: 'Prime', align: 'end', render: (x) => money(x.bonus, false) },
          { key: 'advances', header: 'Avances', align: 'end', render: (x) => money(x.advances, false) },
          { key: 'deductions', header: 'Retenues', align: 'end', render: (x) => money(x.deductions, false) },
          { key: 'net_amount', header: 'Net', align: 'end', render: (x) => <b>{money(x.net_amount)}</b> },
        ]}
      />
      {r.status === 'draft' && <p className="mt-2 text-xs text-muted">Cliquez sur une ligne pour ajouter une prime ou une retenue.</p>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.full_name} size="sm" footer={<Button onClick={async () => {
        try { await api.put(`/api/hr/payroll/${id}/items/${edit.employee_id}`, { bonus: edit.bonus, deductions: edit.deductions, notes: edit.notes || null }); setEdit(null); reload(); } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        {edit && (
          <div className="space-y-3">
            <label className="block text-sm">Prime<MoneyInput value={edit.bonus} onChange={(v) => setEdit({ ...edit, bonus: v ?? 0 })} /></label>
            <label className="block text-sm">Retenue (CNSS, retard…)<MoneyInput value={edit.deductions} onChange={(v) => setEdit({ ...edit, deductions: v ?? 0 })} /></label>
            <label className="block text-sm">Note<Input value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
          </div>
        )}
      </Modal>
      <Modal open={pay} onClose={() => setPay(false)} title="Payer les salaires" size="sm" footer={<Button variant="success" onClick={async () => { setPay(false); await act('pay', 'Confirmer le paiement', `${money(r.total_net)} seront enregistrés en dépense « Salaires ».`, { from_cash: fromCash }); }}>Confirmer</Button>}>
        <p className="mb-3 text-sm">Net total : <b className="num">{money(r.total_net)}</b>. Une dépense « Salaires » sera créée.</p>
        <Checkbox checked={fromCash} onChange={setFromCash} label="Payé en espèces depuis ma caisse ouverte" />
      </Modal>
    </div>
  );
}
