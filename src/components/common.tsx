import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Printer, Search } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useDebounce, type Period } from '../lib/hooks';
import { money } from '../lib/format';
import { periodRange, type PeriodKey } from '../../shared/dates';
import { exportCsv, exportExcel, type ExportColumn } from '../lib/exporters';
import { Button, Input, Modal, Select, cx, useToast } from './ui';

export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useI18n();
  const keys: [PeriodKey, string][] = [
    ['today', "Aujourd'hui"],
    ['yesterday', 'Hier'],
    ['week', 'Cette semaine'],
    ['month', 'Ce mois'],
    ['year', 'Cette année'],
    ['custom', 'Période personnalisée'],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className="h-9 w-auto" value={value.key} onChange={(e) => {
        const k = e.target.value as PeriodKey;
        onChange(k === 'custom' ? { ...value, key: k } : { key: k, ...periodRange(k) });
      }}>
        {keys.map(([k, l]) => (
          <option key={k} value={k}>
            {t(l)}
          </option>
        ))}
      </Select>
      {value.key === 'custom' && (
        <>
          <Input type="date" className="h-9 w-auto" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="text-muted">→</span>
          <Input type="date" className="h-9 w-auto" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder = 'Rechercher…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const { t } = useI18n();
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <Input className="h-9 ps-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t(placeholder)} />
    </div>
  );
}

/** Sélecteur asynchrone (clients, fournisseurs, produits) avec recherche. */
export function EntitySelect({
  endpoint,
  value,
  label,
  onChange,
  placeholder = '— Choisir —',
  render = (r: any) => r.name,
  allowEmpty = true,
  className,
}: {
  endpoint: string;
  value: string | null | undefined;
  label?: string | null;
  onChange: (id: string | null, row: any | null) => void;
  placeholder?: string;
  render?: (r: any) => string;
  allowEmpty?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [current, setCurrent] = useState<string | null>(label ?? null);
  const dq = useDebounce(q, 250);
  const { t } = useI18n();
  useEffect(() => setCurrent(label ?? null), [label]);
  useEffect(() => {
    if (!open) return;
    const sep = endpoint.includes('?') ? '&' : '?';
    api.get(`${endpoint}${sep}q=${encodeURIComponent(dq)}&pageSize=30`).then((r) => setRows(Array.isArray(r) ? r : r.rows)).catch(() => setRows([]));
  }, [dq, open, endpoint]);
  useEffect(() => {
    if (value && !current) {
      const sep = endpoint.includes('?') ? '&' : '?';
      api.get(`${endpoint.split('?')[0]}/${value}`).then((r) => setCurrent(render(r))).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cx('relative', className)}>
      <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-full items-center justify-between rounded-lg border border-line bg-surface px-3 text-start text-sm">
        <span className={cx('truncate', !value && 'text-muted')}>{value ? current ?? '…' : t(placeholder)}</span>
        <Search className="size-4 text-muted" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t(placeholder)} size="md">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Rechercher…')} />
        <div className="mt-2 max-h-[55vh] overflow-y-auto">
          {allowEmpty && (
            <button className="w-full rounded-lg px-3 py-2 text-start text-sm text-muted hover:bg-surface-2" onClick={() => (onChange(null, null), setCurrent(null), setOpen(false))}>
              — {t('Aucun')} —
            </button>
          )}
          {rows.map((r) => (
            <button
              key={r.id}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm hover:bg-surface-2"
              onClick={() => {
                onChange(r.id, r);
                setCurrent(render(r));
                setOpen(false);
              }}
            >
              <span className="truncate">{render(r)}</span>
              {r.balance !== undefined && r.balance !== null && <span className="num text-xs text-muted">{money(r.balance)}</span>}
              {r.stock !== undefined && <span className="num text-xs text-muted">stock {r.stock}</span>}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

export function ExportButtons({ filename, columns, getRows, title }: { filename: string; columns: ExportColumn[]; getRows: () => Promise<any[]> | any[]; title?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (kind: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      const rows = await getRows();
      if (kind === 'xlsx') await exportExcel(filename, columns, rows, title);
      else exportCsv(filename, columns, rows);
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" size="sm" loading={busy} icon={<FileSpreadsheet className="size-4" />} onClick={() => run('xlsx')}>
        Excel
      </Button>
      <Button variant="outline" size="sm" icon={<Download className="size-4" />} onClick={() => run('csv')}>
        CSV
      </Button>
      <Button variant="outline" size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>
        PDF
      </Button>
    </>
  );
}

/** Récupère toutes les lignes d'un endpoint paginé (pour les exports). */
export async function fetchAll(url: string): Promise<any[]> {
  const sep = url.includes('?') ? '&' : '?';
  const r = await api.get(`${url}${sep}pageSize=500&page=1`);
  if (Array.isArray(r)) return r;
  let rows = r.rows;
  const total = r.total ?? rows.length;
  for (let p = 2; rows.length < total && p <= 40; p++) {
    const n = await api.get(`${url}${sep}pageSize=500&page=${p}`);
    rows = rows.concat(n.rows);
  }
  return rows;
}

export function openPrint(type: string, id: string) {
  window.open(`/imprimer/${type}/${id}`, '_blank', 'noopener');
}
