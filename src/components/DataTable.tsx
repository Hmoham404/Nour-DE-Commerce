import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Empty, Spinner, cx } from './ui';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  align?: 'start' | 'end' | 'center';
  sortable?: boolean;
  className?: string;
  /** masquée sur mobile */
  hideSm?: boolean;
  sortValue?: (row: T) => string | number;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  loading?: boolean;
  rowKey?: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** pagination côté serveur */
  total?: number;
  page?: number;
  pageSize?: number;
  onPage?: (p: number) => void;
  /** pagination côté client si total non fourni */
  clientPageSize?: number;
  footer?: ReactNode;
  empty?: string;
}

export function DataTable<T extends Record<string, any>>({ columns, rows, loading, rowKey, onRowClick, total, page = 1, pageSize = 25, onPage, clientPageSize = 25, footer, empty }: Props<T>) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [cpage, setCpage] = useState(1);
  const server = total !== undefined && !!onPage;

  const sorted = useMemo(() => {
    const r = [...(rows ?? [])];
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      const val = (x: T) => (col?.sortValue ? col.sortValue(x) : x[sort.key]);
      r.sort((a, b) => {
        const va = val(a);
        const vb = val(b);
        if (va === vb) return 0;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        return (va > vb ? 1 : -1) * sort.dir;
      });
    }
    return r;
  }, [rows, sort, columns]);

  const visible = server ? sorted : sorted.slice((cpage - 1) * clientPageSize, cpage * clientPageSize);
  const count = server ? total! : sorted.length;
  const size = server ? pageSize : clientPageSize;
  const cur = server ? page : cpage;
  const pages = Math.max(1, Math.ceil(count / size));
  const go = (p: number) => (server ? onPage!(p) : setCpage(p));

  return (
    <div className="overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_1px_3px_rgba(11,33,73,.06),0_8px_24px_-12px_rgba(11,33,73,.12)]">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-navy/[.035] text-[11px] uppercase tracking-wider text-navy/70 dark:bg-white/5 dark:text-white/60">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cx('whitespace-nowrap px-3 py-2.5 font-semibold', c.align === 'end' ? 'text-end' : c.align === 'center' ? 'text-center' : 'text-start', c.hideSm && 'hidden md:table-cell', c.sortable !== false && 'cursor-pointer select-none')}
                  onClick={() => c.sortable !== false && setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                >
                  <span className="inline-flex items-center gap-1">
                    {t(c.header)}
                    {sort?.key === c.key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && !rows?.length ? (
              <tr>
                <td colSpan={columns.length}>
                  <Spinner />
                </td>
              </tr>
            ) : !visible.length ? (
              <tr>
                <td colSpan={columns.length}>
                  <Empty>{empty ?? 'Aucune donnée'}</Empty>
                </td>
              </tr>
            ) : (
              visible.map((row, i) => (
                <tr
                  key={rowKey ? rowKey(row) : row.id ?? i}
                  onClick={() => onRowClick?.(row)}
                  className={cx('border-t border-line/60 transition-colors even:bg-surface-2/50', onRowClick && 'cursor-pointer hover:bg-gold/[.07]', loading && 'opacity-60')}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-3 py-2', c.align === 'end' ? 'num text-end' : c.align === 'center' ? 'text-center' : 'text-start', c.hideSm && 'hidden md:table-cell', c.className)}>
                      {c.render ? c.render(row) : row[c.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {footer && <tfoot className="border-t-2 border-line bg-surface-2 font-semibold">{footer}</tfoot>}
        </table>
      </div>
      {count > size && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-sm text-muted">
          <span>
            {count.toLocaleString('fr-FR')} · {t('Page')} {cur} {t('sur')} {pages}
          </span>
          <div className="flex gap-1">
            <button disabled={cur <= 1} onClick={() => go(cur - 1)} className="rounded-lg border border-line p-1.5 disabled:opacity-40" aria-label={t('Précédent')}>
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </button>
            <button disabled={cur >= pages} onClick={() => go(cur + 1)} className="rounded-lg border border-line p-1.5 disabled:opacity-40" aria-label={t('Suivant')}>
              <ChevronRight className="size-4 rtl:rotate-180" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
