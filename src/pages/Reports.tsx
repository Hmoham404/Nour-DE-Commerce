import { useEffect, useState } from 'react';
import { qs } from '../lib/api';
import { useFetch, usePeriod } from '../lib/hooks';
import { d, dt, money, pct } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, PeriodFilter, SearchBox } from '../components/common';
import { Card, PageHeader, cx } from '../components/ui';

const FINANCE_KEYS = ['margin-by-product', 'stock-valuation', 'receivables', 'payables', 'expenses', 'cash', 'vat', 'purchases-by-supplier', 'sales-monthly'];

export default function Reports({ finance }: { finance?: boolean }) {
  const list = useFetch<any[]>('/api/reports');
  const [key, setKey] = useState<string>('');
  const [period, setPeriod] = usePeriod('month');
  const [q, setQ] = useState('');
  const reports = (list.data ?? []).filter((r) => !finance || FINANCE_KEYS.includes(r.key));
  useEffect(() => {
    if (!key && reports.length) setKey(reports[0].key);
  }, [reports, key]);
  const { data, loading } = useFetch<any>(key ? `/api/reports/${key}${qs({ from: period.from, to: period.to })}` : null);
  const fmt = (type: string | undefined, v: any) =>
    v === null || v === undefined ? '—' : type === 'money' ? money(v, false) : type === 'percent' ? pct(v) : type === 'date' ? d(v) : type === 'datetime' ? dt(v) : type === 'int' ? Number(v).toLocaleString('fr-FR') : String(v);
  const rows = (data?.rows ?? []).filter((r: any) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  const sums = (data?.columns ?? []).map((c: any) => (c.type === 'money' ? rows.reduce((s: number, r: any) => s + (r[c.key] ?? 0), 0) : null));

  return (
    <div>
      <PageHeader title={finance ? 'Rapports financiers' : 'Statistiques'} subtitle="Rapports calculés en temps réel sur les données de la base" />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card title="Rapports" padded={false} className="no-print h-fit">
          <div className="p-1">
            {reports.map((r) => (
              <button key={r.key} onClick={() => setKey(r.key)} className={cx('block w-full rounded-lg px-3 py-2 text-start text-sm', key === r.key ? 'bg-navy text-white dark:bg-gold dark:text-navy' : 'hover:bg-surface-2')}>
                {r.title}
              </button>
            ))}
          </div>
        </Card>
        <div className="min-w-0">
          <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <PeriodFilter value={period} onChange={setPeriod} />
              <SearchBox value={q} onChange={setQ} className="w-52" />
            </div>
            <div className="flex gap-2">
              {data && <ExportButtons filename={`${key}-${period.from}-${period.to}`} title={data.title} columns={data.columns} getRows={() => rows} />}
            </div>
          </div>
          <h2 className="mb-2 text-lg font-semibold">
            {data?.title} <span className="text-sm font-normal text-muted">{period.from} → {period.to}</span>
          </h2>
          <DataTable
            rows={rows}
            loading={loading}
            rowKey={(r) => JSON.stringify(r)}
            clientPageSize={50}
            columns={(data?.columns ?? []).map((c: any) => ({ key: c.key, header: c.label, align: ['money', 'int', 'percent'].includes(c.type) ? 'end' : 'start', render: (r: any) => fmt(c.type, r[c.key]) }))}
            footer={
              sums.some((s: any) => s !== null) && rows.length ? (
                <tr>
                  {sums.map((s: any, i: number) => (
                    <td key={i} className="num px-3 py-2 text-end">{i === 0 ? <span className="float-start">Total</span> : s !== null ? money(s, false) : ''}</td>
                  ))}
                </tr>
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
