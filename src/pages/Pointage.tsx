import { useEffect, useMemo, useState } from 'react';
import { CheckCheck, ChevronLeft, ChevronRight, Lock, Save } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { todayTunis } from '../lib/format';
import { ATTENDANCE_LABELS, monthBounds, type AttendanceStatus } from '../../shared/payroll';
import { addDays } from '../../shared/dates';
import { ExportButtons } from '../components/common';
import { Button, Card, Empty, Input, PageHeader, Spinner, Tabs, cx, useToast } from '../components/ui';

const STATUSES: [AttendanceStatus, string, string][] = [
  ['present', 'Présent', 'bg-emerald-600 text-white border-emerald-600'],
  ['half', '½ journée', 'bg-amber-500 text-white border-amber-500'],
  ['absent', 'Absent', 'bg-red-600 text-white border-red-600'],
  ['leave', 'Congé', 'bg-blue-600 text-white border-blue-600'],
  ['sick', 'Malade', 'bg-orange-500 text-white border-orange-500'],
  ['holiday', 'Férié', 'bg-slate-500 text-white border-slate-500'],
];
const LETTER: Record<string, [string, string]> = {
  present: ['P', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'],
  half: ['½', 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'],
  absent: ['A', 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200'],
  leave: ['C', 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200'],
  sick: ['M', 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200'],
  holiday: ['F', 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'],
};

export default function Pointage() {
  const [tab, setTab] = useState<'day' | 'month'>('day');
  return (
    <div>
      <PageHeader title="Pointage" subtitle="Présences journalières du personnel" />
      <Tabs tabs={[['day', 'Pointage du jour'], ['month', 'Récapitulatif du mois']]} value={tab} onChange={setTab} />
      {tab === 'day' ? <Day /> : <Month />}
    </div>
  );
}

function Day() {
  const [date, setDate] = useState(todayTunis());
  const { data, loading, reload } = useFetch<any>(`/api/hr/attendance?date=${date}`);
  const [rows, setRows] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    setRows(data?.rows ?? []);
    setDirty(false);
  }, [data]);
  const set = (i: number, patch: any) => {
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };
  const allPresent = () => {
    setRows((r) => r.map((x) => (x.payroll_run_id || x.status ? x : { ...x, status: 'present', check_in: x.check_in ?? '08:00' })));
    setDirty(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.put('/api/hr/attendance', {
        date,
        entries: rows.filter((x) => !x.payroll_run_id).map((x) => ({ employee_id: x.employee_id, status: x.status ?? null, check_in: x.check_in || null, check_out: x.check_out || null, overtime_minutes: Number(x.overtime_minutes) || 0, notes: x.notes || null })),
      });
      toast.success(`Pointage enregistré${r.skipped ? ` (${r.skipped} journée(s) déjà payée(s) non modifiée(s))` : ''}`);
      reload();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const isToday = date === todayTunis();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" icon={<ChevronLeft className="size-4 rtl:rotate-180" />} onClick={() => setDate(addDays(date, -1))} />
        <Input type="date" className="h-9 w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        <Button variant="outline" size="sm" icon={<ChevronRight className="size-4 rtl:rotate-180" />} onClick={() => setDate(addDays(date, 1))} disabled={isToday} />
        <span className="text-sm text-muted">{new Date(date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <div className="flex-1" />
        <Button variant="outline" icon={<CheckCheck className="size-4" />} onClick={allPresent}>Tous présents</Button>
        <Button icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={save}>Enregistrer</Button>
      </div>
      {loading && !data ? (
        <Spinner />
      ) : !rows.length ? (
        <Card><Empty>Aucun employé actif. Ajoutez le personnel dans le menu Personnel.</Empty></Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.employee_id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3 shadow-sm">
              <div className="min-w-44 flex-1">
                <div className="font-semibold">{r.full_name}</div>
                <div className="text-xs text-muted">{r.position ?? r.code}</div>
              </div>
              {r.payroll_run_id ? (
                <span className="flex items-center gap-1 text-sm text-muted"><Lock className="size-4" /> {ATTENDANCE_LABELS[r.status as AttendanceStatus]} — journée déjà payée</span>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUSES.map(([k, label, cls]) => (
                      <button key={k} onClick={() => set(i, { status: r.status === k ? null : k, check_in: k === 'present' || k === 'half' ? r.check_in ?? '08:00' : null })} className={cx('rounded-lg border-2 px-3 py-1.5 text-sm font-semibold transition', r.status === k ? cls : 'border-line hover:border-navy/40')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {(r.status === 'present' || r.status === 'half') && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <Input type="time" className="h-8 w-24" value={r.check_in ?? ''} onChange={(e) => set(i, { check_in: e.target.value })} title="Arrivée" />
                      <span>→</span>
                      <Input type="time" className="h-8 w-24" value={r.check_out ?? ''} onChange={(e) => set(i, { check_out: e.target.value })} title="Départ" />
                      <Input type="number" min={0} className="h-8 w-20" value={r.overtime_minutes ?? 0} onChange={(e) => set(i, { overtime_minutes: e.target.value })} title="Heures sup. (minutes)" />
                      <span className="text-muted">min sup.</span>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {dirty && <p className="text-sm text-amber-600">Modifications non enregistrées.</p>}
    </div>
  );
}

function Month() {
  const [month, setMonth] = useState(todayTunis().slice(0, 7));
  const [from, to] = monthBounds(month + '-01');
  const { data, loading } = useFetch<any>(`/api/hr/attendance/grid${qs({ from, to })}`);
  const map = useMemo(() => {
    const m = new Map<string, any>();
    for (const a of data?.attendance ?? []) m.set(a.employee_id + a.work_date, a);
    return m;
  }, [data]);
  const totals = (eid: string) => {
    const c: Record<string, number> = {};
    for (const a of data?.attendance ?? []) if (a.employee_id === eid) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  };
  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input type="month" className="h-9 w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(LETTER).map(([k, [l, cls]]) => (
            <span key={k} className="flex items-center gap-1"><span className={cx('rounded px-1.5 font-bold', cls)}>{l}</span>{ATTENDANCE_LABELS[k as AttendanceStatus]}</span>
          ))}
        </div>
        <div className="flex-1" />
        <ExportButtons
          filename={`pointage-${month}`}
          columns={[{ key: 'full_name', label: 'Employé' }, ...(data?.dates ?? []).map((d: string) => ({ key: d, label: d.slice(8) })), { key: 'present', label: 'Présent' }, { key: 'absent', label: 'Absent' }]}
          getRows={() => (data?.employees ?? []).map((e: any) => ({ full_name: e.full_name, ...Object.fromEntries((data.dates as string[]).map((d) => [d, map.get(e.id + d) ? LETTER[map.get(e.id + d).status][0] : ''])), present: totals(e.id).present ?? 0, absent: totals(e.id).absent ?? 0 }))}
        />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line/70 bg-surface">
        <table className="text-xs">
          <thead className="bg-navy/[.035] dark:bg-white/5">
            <tr>
              <th className="sticky start-0 bg-surface px-3 py-2 text-start">Employé</th>
              {data?.dates.map((d: string) => {
                const wd = new Date(d + 'T12:00:00Z').getUTCDay();
                return <th key={d} className={cx('w-7 px-0.5 py-2 text-center font-semibold', wd === 0 && 'text-red-500')}>{d.slice(8)}</th>;
              })}
              <th className="px-2 text-center">P</th>
              <th className="px-2 text-center">A</th>
            </tr>
          </thead>
          <tbody>
            {data?.employees.map((e: any) => {
              const t = totals(e.id);
              return (
                <tr key={e.id} className="border-t border-line/60">
                  <td className="sticky start-0 whitespace-nowrap bg-surface px-3 py-1.5 font-medium">{e.full_name}</td>
                  {data.dates.map((d: string) => {
                    const a = map.get(e.id + d);
                    return <td key={d} className="px-0.5 py-1 text-center">{a ? <span className={cx('inline-block w-6 rounded py-0.5 font-bold', LETTER[a.status][1])}>{LETTER[a.status][0]}</span> : <span className="text-line">·</span>}</td>;
                  })}
                  <td className="num px-2 text-center font-semibold text-emerald-700">{(t.present ?? 0) + (t.half ?? 0) / 2}</td>
                  <td className="num px-2 text-center font-semibold text-red-600">{t.absent ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
