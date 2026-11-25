import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, CalendarCheck, HandCoins, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { d, money, todayTunis } from '../lib/format';
import { ATTENDANCE_LABELS } from '../../shared/payroll';
import { DataTable } from '../components/DataTable';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, Tabs, Textarea, useConfirm, useToast } from '../components/ui';

export const PAY_TYPES: Record<string, string> = { daily: 'À la journée', weekly: 'À la semaine', monthly: 'Au mois' };
export const STATUS_COLORS: Record<string, string> = { present: 'green', half: 'amber', absent: 'red', leave: 'blue', sick: 'amber', holiday: 'gray' };

export function salaryText(e: any) {
  if (e.daily_rate === null) return '—';
  if (e.pay_type === 'daily') return `${money(e.daily_rate)} / jour`;
  if (e.pay_type === 'weekly') return `${money(e.weekly_salary)} / semaine`;
  return `${money(e.monthly_salary)} / mois`;
}

export default function Personnel() {
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<'list' | 'advances'>('list');
  const [status, setStatus] = useState('active');
  const emps = useFetch<any[]>(`/api/hr/employees?status=${status}`);
  const advances = useFetch<any[]>(tab === 'advances' && can('hr.manage', 'payroll.manage') ? '/api/hr/advances' : null, [tab]);
  const [edit, setEdit] = useState<any | null>(null);
  const [adv, setAdv] = useState<any | null>(null);
  const rows = emps.data ?? [];
  const present = rows.filter((r) => r.today_status === 'present' || r.today_status === 'half').length;

  return (
    <div>
      <PageHeader
        title="Personnel"
        subtitle="Effectif, salaires et avances"
        actions={
          <>
            {can('hr.attendance') && <Button variant="outline" icon={<CalendarCheck className="size-4" />} onClick={() => nav('/pointage')}>Pointage du jour</Button>}
            {can('payroll.manage') && <Button variant="outline" icon={<Wallet className="size-4" />} onClick={() => nav('/paie')}>Paie</Button>}
            {can('hr.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setEdit({ full_name: '', pay_type: 'monthly', daily_rate: 0, weekly_salary: 0, monthly_salary: 0, overtime_hourly_rate: 0, hire_date: todayTunis() })}>Ajouter un employé</Button>}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Effectif actif" value={rows.filter((r) => r.is_active).length} />
        <Stat label="Présents aujourd'hui" value={present} tone="green" />
        <Stat label="Non pointés aujourd'hui" value={rows.filter((r) => r.is_active && !r.today_status).length} tone="amber" />
        {can('hr.manage') && <Stat label="Avances à déduire" value={money(rows.reduce((s, r) => s + (r.pending_advances ?? 0), 0))} tone="red" />}
      </div>
      <Tabs tabs={[['list', 'Effectif'], ...(can('hr.manage', 'payroll.manage') ? ([['advances', 'Avances sur salaire']] as ['advances', string][]) : [])]} value={tab} onChange={setTab} />
      {tab === 'list' ? (
        <>
          <Select className="mb-3 h-9 w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Actifs</option>
            <option value="archived">Archivés</option>
            <option value="all">Tous</option>
          </Select>
          <DataTable
            rows={rows}
            loading={emps.loading}
            columns={[
              { key: 'code', header: 'Code', render: (r) => <span className="num text-xs">{r.code}</span> },
              { key: 'full_name', header: 'Nom', render: (r) => <b>{r.full_name}</b> },
              { key: 'position', header: 'Poste', hideSm: true },
              { key: 'pay_type', header: 'Paie', render: (r) => <Badge color="blue">{PAY_TYPES[r.pay_type]}</Badge> },
              { key: 'salary', header: 'Salaire', align: 'end', render: salaryText },
              { key: 'today_status', header: "Aujourd'hui", render: (r) => (r.today_status ? <Badge color={STATUS_COLORS[r.today_status]}>{ATTENDANCE_LABELS[r.today_status as keyof typeof ATTENDANCE_LABELS]}</Badge> : <span className="text-xs text-muted">non pointé</span>) },
              ...(can('hr.manage') ? [{ key: 'pending_advances', header: 'Avances', align: 'end' as const, hideSm: true, render: (r: any) => (r.pending_advances ? money(r.pending_advances) : '—') }] : []),
              {
                key: 'a',
                header: '',
                sortable: false,
                render: (r) =>
                  can('hr.manage') && (
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" title="Avance" icon={<HandCoins className="size-4" />} onClick={() => setAdv({ employee_id: r.id, name: r.full_name, amount: 0, advance_date: todayTunis(), reason: '', from_cash: false })} />
                      <Button size="sm" variant="ghost" title="Modifier" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r })} />
                      <Button size="sm" variant="ghost" title={r.is_active ? 'Archiver' : 'Restaurer'} icon={<Archive className="size-4" />} onClick={() => api.post(`/api/hr/employees/${r.id}/active`, { active: !r.is_active }).then(emps.reload)} />
                      <Button size="sm" variant="ghost" className="text-red-600" title="Supprimer" icon={<Trash2 className="size-4" />} onClick={async () => {
                        if (!(await confirm({ title: 'Supprimer l’employé', danger: true, message: `Supprimer « ${r.full_name} » et son pointage ? Impossible s'il figure déjà dans une paie (archivez-le).` }))) return;
                        try { await api.del(`/api/hr/employees/${r.id}`); toast.success('Employé supprimé'); emps.reload(); } catch (e: any) { toast.error(e); }
                      }} />
                    </div>
                  ),
              },
            ]}
          />
        </>
      ) : (
        <DataTable
          rows={advances.data}
          loading={advances.loading}
          columns={[
            { key: 'advance_date', header: 'Date', render: (r) => d(r.advance_date) },
            { key: 'full_name', header: 'Employé' },
            { key: 'reason', header: 'Motif' },
            { key: 'amount', header: 'Montant', align: 'end', render: (r) => money(r.amount) },
            { key: 'from_cash', header: 'Versée', render: (r) => (r.from_cash ? 'Caisse' : 'Hors caisse') },
            { key: 'payroll_number', header: 'Déduite sur', render: (r) => r.payroll_number ?? <Badge color="amber">À déduire</Badge> },
            { key: 'x', header: '', sortable: false, render: (r) => !r.payroll_run_id && !r.from_cash && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={() => api.del(`/api/hr/advances/${r.id}`).then(advances.reload).catch(toast.error)} /> },
          ]}
        />
      )}
      <EmployeeModal edit={edit} onClose={() => setEdit(null)} onSaved={emps.reload} />
      <Modal open={!!adv} onClose={() => setAdv(null)} title={`Avance sur salaire — ${adv?.name ?? ''}`} size="sm" footer={<Button disabled={!adv?.amount} onClick={async () => {
        try {
          await api.post('/api/hr/advances', { employee_id: adv.employee_id, amount: adv.amount, advance_date: adv.advance_date, reason: adv.reason || null, from_cash: adv.from_cash });
          toast.success('Avance enregistrée : elle sera déduite automatiquement de la prochaine paie');
          setAdv(null);
          emps.reload();
        } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        {adv && (
          <div className="space-y-3">
            <Field label="Montant"><MoneyInput value={adv.amount} onChange={(v) => setAdv({ ...adv, amount: v ?? 0 })} autoFocus /></Field>
            <Field label="Date"><Input type="date" value={adv.advance_date} onChange={(e) => setAdv({ ...adv, advance_date: e.target.value })} /></Field>
            <Field label="Motif"><Input value={adv.reason} onChange={(e) => setAdv({ ...adv, reason: e.target.value })} /></Field>
            <Checkbox checked={adv.from_cash} onChange={(v) => setAdv({ ...adv, from_cash: v })} label="Versée en espèces depuis ma caisse ouverte" />
          </div>
        )}
      </Modal>
    </div>
  );
}

function EmployeeModal({ edit, onClose, onSaved }: { edit: any | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const cur = f && edit && f.__src === edit ? f : edit ? { ...edit, __src: edit } : null;
  const set = (k: string, v: any) => setF({ ...cur, [k]: v });
  const save = async () => {
    setError(null);
    const body = {
      code: cur.code || '', full_name: cur.full_name, cin: cur.cin || null, phone: cur.phone || null, position: cur.position || null, hire_date: cur.hire_date || null, pay_type: cur.pay_type,
      daily_rate: cur.daily_rate ?? 0, weekly_salary: cur.weekly_salary ?? 0, monthly_salary: cur.monthly_salary ?? 0, overtime_hourly_rate: cur.overtime_hourly_rate ?? 0, notes: cur.notes || null,
    };
    try {
      if (cur.id) await api.put(`/api/hr/employees/${cur.id}`, body);
      else await api.post('/api/hr/employees', body);
      toast.success('Employé enregistré');
      onClose();
      onSaved();
    } catch (e: any) {
      setError(e.message);
    }
  };
  return (
    <Modal open={!!edit} onClose={onClose} title={cur?.id ? 'Modifier l’employé' : 'Nouvel employé'} footer={<Button onClick={save}>Enregistrer</Button>}>
      {cur && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom et prénom" required className="sm:col-span-2"><Input autoFocus value={cur.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
          <Field label="Poste"><Input value={cur.position ?? ''} onChange={(e) => set('position', e.target.value)} placeholder="Magasinier, chauffeur…" /></Field>
          <Field label="Téléphone"><Input value={cur.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="CIN"><Input value={cur.cin ?? ''} onChange={(e) => set('cin', e.target.value)} /></Field>
          <Field label="Date d'embauche"><Input type="date" value={cur.hire_date ?? ''} onChange={(e) => set('hire_date', e.target.value)} /></Field>
          <Field label="Mode de paie" className="sm:col-span-2">
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(PAY_TYPES).map(([k, v]) => (
                <button key={k} type="button" onClick={() => set('pay_type', k)} className={`rounded-xl border-2 py-2.5 text-sm font-semibold ${cur.pay_type === k ? 'border-navy bg-navy text-white dark:border-gold dark:bg-gold dark:text-navy' : 'border-line'}`}>{v}</button>
              ))}
            </div>
          </Field>
          {cur.pay_type === 'daily' && <Field label="Salaire par jour travaillé" required><MoneyInput value={cur.daily_rate} onChange={(v) => set('daily_rate', v ?? 0)} /></Field>}
          {cur.pay_type === 'weekly' && <Field label="Salaire par semaine" required><MoneyInput value={cur.weekly_salary} onChange={(v) => set('weekly_salary', v ?? 0)} /></Field>}
          {cur.pay_type === 'monthly' && <Field label="Salaire mensuel" required><MoneyInput value={cur.monthly_salary} onChange={(v) => set('monthly_salary', v ?? 0)} /></Field>}
          <Field label="Heure supplémentaire (par heure)"><MoneyInput value={cur.overtime_hourly_rate} onChange={(v) => set('overtime_hourly_rate', v ?? 0)} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={cur.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
          <p className="text-xs text-muted sm:col-span-2">
            {cur.pay_type === 'daily' ? 'Payé uniquement pour les jours pointés « présent » (½ pour une demi-journée) et les congés payés.' : 'Salaire fixe, diminué des absences non payées au prorata des jours ouvrés (réglable dans Paramètres).'}
          </p>
          <div className="sm:col-span-2"><ErrorBox error={error} /></div>
        </div>
      )}
    </Modal>
  );
}
