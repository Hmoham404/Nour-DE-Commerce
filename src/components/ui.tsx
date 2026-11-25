import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { parseMoney, toInputMoney } from '../lib/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ───────────── Boutons ─────────────
type Variant = 'primary' | 'gold' | 'outline' | 'ghost' | 'danger' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy text-white hover:bg-navy-700 dark:bg-gold dark:text-navy dark:hover:bg-gold-600',
  gold: 'bg-gold text-navy hover:bg-gold-600',
  outline: 'border border-line bg-surface hover:bg-surface-2 text-fg',
  ghost: 'hover:bg-surface-2 text-fg',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  success: 'bg-green-600 text-white hover:bg-green-700',
};
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }>(
  ({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-sm' : size === 'lg' ? 'h-12 px-5 text-base' : 'h-10 px-4 text-sm',
        VARIANTS[variant],
        className,
      )}
      {...p}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  ),
);

// ───────────── Champs ─────────────
const inputCls = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30 disabled:opacity-60';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cx(inputCls, className)} {...p} />);
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cx(inputCls, 'pe-8', className)} {...p}>
    {children}
  </select>
));
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cx(inputCls, 'h-auto min-h-20 py-2', className)} {...p} />
));

export function Field({ label, hint, error, children, className, required }: { label: string; hint?: string; error?: string | null; children: ReactNode; className?: string; required?: boolean }) {
  const { t } = useI18n();
  return (
    <label className={cx('block', className)}>
      <span className="mb-1 block text-xs font-semibold text-muted">
        {t(label)}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

/** Saisie d'un montant en TND (3 décimales) → valeur en millimes. */
export function MoneyInput({ value, onChange, allowNull, className, ...p }: { value: number | null | undefined; onChange: (v: number | null) => void; allowNull?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(toInputMoney(value ?? (allowNull ? null : 0)));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      setText(toInputMoney(value ?? null));
      last.current = value;
    }
  }, [value]);
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        className={cx(inputCls, 'num pe-10 text-end', className)}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const m = parseMoney(e.target.value);
          const v = e.target.value.trim() === '' ? (allowNull ? null : 0) : m;
          if (v !== null || allowNull) {
            last.current = v ?? undefined;
            onChange(v);
          }
        }}
        onBlur={() => setText(toInputMoney(value ?? null))}
        {...p}
      />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted">DT</span>
    </div>
  );
}

export function PercentInput({ value, onChange, className, ...p }: { value: number; onChange: (bp: number) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className="relative">
      <input
        type="number"
        step="0.01"
        min={0}
        max={100}
        className={cx(inputCls, 'num pe-7 text-end', className)}
        value={value / 100}
        onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))}
        {...p}
      />
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { t } = useI18n();
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm">
      <input type="checkbox" className="size-4 accent-[#0B2149]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {t(label)}
    </label>
  );
}

// ───────────── Présentation ─────────────
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx('rounded-xl border border-line bg-surface shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h3 className="font-semibold">{title}</h3>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

const BADGE: Record<string, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  gold: 'bg-gold/20 text-gold-600',
};
export function Badge({ color = 'gray', children }: { color?: string; children: ReactNode }) {
  const { t } = useI18n();
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE[color] ?? BADGE.gray)}>{typeof children === 'string' ? t(children) : children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy dark:text-white sm:text-2xl">{t(title)}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Spinner({ label = 'Chargement…' }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-muted">
      <Loader2 className="size-5 animate-spin" /> {t(label)}
    </div>
  );
}

export function Empty({ children = 'Aucune donnée' }: { children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="p-8 text-center text-sm text-muted">{typeof children === 'string' ? t(children) : children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <span className="flex items-center gap-2">
        <XCircle className="size-4 shrink-0" /> {error}
      </span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = 'navy', onClick }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'navy' | 'gold' | 'green' | 'red' | 'amber'; onClick?: () => void }) {
  const { t } = useI18n();
  const tones: Record<string, string> = {
    navy: 'bg-navy/10 text-navy dark:bg-white/10 dark:text-white',
    gold: 'bg-gold/15 text-gold-600',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  return (
    <div onClick={onClick} className={cx('flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm', onClick && 'cursor-pointer hover:border-gold')}>
      {icon && <div className={cx('rounded-lg p-2', tones[tone])}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted">{t(label)}</div>
        <div className="num mt-0.5 truncate text-lg font-bold">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted">{typeof sub === 'string' ? t(sub) : sub}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (v: T) => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={cx('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', value === k ? 'border-gold text-navy dark:text-white' : 'border-transparent text-muted hover:text-fg')}
        >
          {t(label)}
        </button>
      ))}
    </div>
  );
}

// ───────────── Fenêtre modale ─────────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  const w = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' }[size];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('flex max-h-[95vh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl', w)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface-2" aria-label="Fermer">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ───────────── Notifications éphémères ─────────────
type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  const icons = { success: <CheckCircle2 className="size-5 text-green-600" />, error: <XCircle className="size-5 text-red-600" />, info: <Info className="size-5 text-blue-600" />, warning: <AlertTriangle className="size-5 text-amber-600" /> };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="pointer-events-auto flex items-start gap-2 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg">
            {icons[i.kind]}
            <span className="flex-1">{i.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => {
  const push = useContext(ToastCtx);
  return {
    success: (t: string) => push('success', t),
    error: (t: string | Error) => push('error', typeof t === 'string' ? t : t.message),
    info: (t: string) => push('info', t),
    warning: (t: string) => push('warning', t),
  };
};

// ───────────── Confirmation ─────────────
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** si défini : demande un motif obligatoire */
  reason?: string;
}
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<string | false>>(async () => false);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: string | false) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const ask = useCallback((o: ConfirmOpts) => new Promise<string | false>((resolve) => {
    setReason('');
    setState({ ...o, resolve });
  }), []);
  const close = (v: string | false) => {
    state?.resolve(v);
    setState(null);
  };
  const { t } = useI18n();
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={t(state?.title ?? '')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>
              {t('Annuler')}
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} disabled={!!state?.reason && reason.trim().length < 3} onClick={() => close(reason.trim() || 'ok')}>
              {t(state?.confirmLabel ?? 'Confirmer')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {state?.message}
          {state?.reason && (
            <Field label={state.reason} required>
              <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);
