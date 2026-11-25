import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '../../shared/money';
import { useI18n } from '../lib/i18n';
import { Empty } from './ui';

// Palette catégorielle validée (ordre fixe, jamais recyclé) — voir skill dataviz / palette de référence.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const isDark = () => document.documentElement.classList.contains('dark');
export const series = (i: number) => (isDark() ? SERIES_DARK : SERIES)[i % 8];
/** série unique : couleur de marque */
export const brand = () => (isDark() ? '#D9A638' : '#0B2149');

const axis = { fontSize: 11, fill: 'var(--muted)' };
const kfmt = (v: number) => {
  const tnd = v / 1000;
  if (Math.abs(tnd) >= 1e6) return (tnd / 1e6).toFixed(1) + ' M';
  if (Math.abs(tnd) >= 1e3) return (tnd / 1e3).toFixed(1) + ' k';
  return tnd.toFixed(0);
};
const tooltipStyle = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)' };
const moneyTip = (v: any) => formatMoney(Number(v ?? 0));

export function ChartCard({ title, children, empty, table }: { title: string; children: ReactNode; empty?: boolean; table?: { label: string; value: string }[] }) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold">{t(title)}</h3>
      {empty ? <Empty /> : <div className="h-64" dir="ltr">{children}</div>}
      {table && !empty && (
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Tableau</summary>
          <table className="mt-1 w-full">
            <tbody>
              {table.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1">{r.label}</td>
                  <td className="num py-1 text-end">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

export function MoneyLine({ data, x, lines }: { data: any[]; x: string; lines: { key: string; name: string }[] }) {
  return (
    <ResponsiveContainer>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={kfmt} tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={moneyTip} contentStyle={tooltipStyle} />
        {lines.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {lines.map((l, i) => (
          <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={lines.length > 1 ? series(i) : brand()} strokeWidth={2} dot={data.length < 20 ? { r: 4 } : false} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function MoneyArea({ data, x, y, name }: { data: any[]; x: string; y: string; name: string }) {
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} />
        <YAxis tickFormatter={kfmt} tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip formatter={moneyTip} contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey={y} name={name} stroke={brand()} fill={brand()} fillOpacity={0.12} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MoneyBars({ data, x, bars, horizontal }: { data: any[]; x: string; bars: { key: string; name: string }[]; horizontal?: boolean }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tickFormatter={kfmt} tick={axis} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey={x} tick={axis} width={120} tickLine={false} axisLine={false} tickFormatter={(s: string) => (s.length > 18 ? s.slice(0, 17) + '…' : s)} />
          </>
        ) : (
          <>
            <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={kfmt} tick={axis} tickLine={false} axisLine={false} width={48} />
          </>
        )}
        <Tooltip formatter={moneyTip} contentStyle={tooltipStyle} cursor={{ fill: 'var(--surface-2)' }} />
        {bars.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={bars.length > 1 ? series(i) : brand()} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Donut : 7 parts maximum, le reste est regroupé dans « Autres ». */
export function Donut({ data, nameKey = 'name', valueKey = 'value', labels }: { data: any[]; nameKey?: string; valueKey?: string; labels?: Record<string, string> }) {
  const sorted = [...data].sort((a, b) => b[valueKey] - a[valueKey]);
  const top = sorted.slice(0, 7).map((d) => ({ name: labels?.[d[nameKey]] ?? d[nameKey], value: Number(d[valueKey]) }));
  const rest = sorted.slice(7).reduce((s, d) => s + Number(d[valueKey]), 0);
  if (rest > 0) top.push({ name: 'Autres', value: rest });
  return (
    <ResponsiveContainer>
      <PieChart>
        <Pie data={top} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={1} stroke="var(--surface)" strokeWidth={2}>
          {top.map((_, i) => (
            <Cell key={i} fill={series(i)} />
          ))}
        </Pie>
        <Tooltip formatter={moneyTip} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} layout="vertical" align="right" verticalAlign="middle" />
      </PieChart>
    </ResponsiveContainer>
  );
}
