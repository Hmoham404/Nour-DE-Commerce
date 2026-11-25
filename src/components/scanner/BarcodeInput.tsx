import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { analyzeBarcode } from '../../../shared/barcode';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { cx } from '../ui';
import { getScannerConfig, pushScanHistory } from './scanner';

export interface BarcodeInputHandle {
  focus: () => void;
}

export type Terminator = 'Enter' | 'Tab' | 'auto';

/** Le focus est-il sur un champ de saisie légitime (que l'on ne doit pas voler) ? */
function isTypingField(el: Element | null) {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.dataset?.barcodeInput !== undefined) return false;
  if (h.isContentEditable) return true;
  return h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT';
}

/**
 * Champ de scan : reçoit la saisie du lecteur Honeywell (USB HID) ou une saisie manuelle de secours.
 * Robuste quel que soit le réglage du lecteur :
 *  - suffixe Entrée → validation immédiate
 *  - suffixe Tab → validation si la saisie était rapide (lecteur)
 *  - aucun suffixe → validation automatique après une courte pause si la saisie était rapide
 * `keepFocus` : le curseur revient automatiquement dans ce champ après un clic (POS, réception, inventaire),
 * pour qu'aucun scan ne soit perdu.
 */
export const BarcodeInput = forwardRef<BarcodeInputHandle, {
  onSubmit: (code: string, meta: { terminator: Terminator; durationMs: number; fast: boolean }) => void;
  onType?: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  keepFocus?: boolean;
  className?: string;
  flash?: 'ok' | 'err' | null;
}>(({ onSubmit, onType, placeholder = 'Scanner ou rechercher un produit…', autoFocus, keepFocus, className, flash }, ref) => {
  const { settings } = useAuth();
  const { t } = useI18n();
  const inp = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const timing = useRef<{ first: number; last: number; n: number }>({ first: 0, last: 0, n: 0 });
  const idleTimer = useRef<number>(0);
  useImperativeHandle(ref, () => ({ focus: () => inp.current?.focus() }));

  const isFast = () => {
    const tm = timing.current;
    const cfg = getScannerConfig(settings.scanner_config);
    return tm.n >= Math.max(2, cfg.minLength) && (tm.last - tm.first) / (tm.n - 1) <= cfg.maxInterval;
  };

  const submit = (terminator: Terminator) => {
    window.clearTimeout(idleTimer.current);
    const code = analyzeBarcode(valueRef.current).code;
    const tm = timing.current;
    const fast = isFast();
    timing.current = { first: 0, last: 0, n: 0 };
    valueRef.current = '';
    setValue('');
    onType?.('');
    if (!code) return;
    pushScanHistory({ code, at: Date.now(), durationMs: Math.round(tm.last - tm.first), source: fast ? 'hid' : 'input', format: analyzeBarcode(code).format, terminator });
    onSubmit(code, { terminator, durationMs: Math.round(tm.last - tm.first), fast });
  };

  // Retour automatique du curseur dans le champ de scan
  useEffect(() => {
    if (!keepFocus) return;
    const refocus = () =>
      window.setTimeout(() => {
        const a = document.activeElement;
        if (document.querySelector('[role="dialog"], .ndc-modal')) return; // une fenêtre est ouverte
        if (!isTypingField(a) && a !== inp.current) inp.current?.focus({ preventScroll: true });
      }, 0);
    document.addEventListener('click', refocus);
    window.addEventListener('focus', refocus);
    const iv = window.setInterval(refocus, 1500);
    return () => {
      document.removeEventListener('click', refocus);
      window.removeEventListener('focus', refocus);
      window.clearInterval(iv);
    };
  }, [keepFocus]);

  return (
    <div className={cx('relative', className)}>
      <ScanLine className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-gold" />
      <input
        ref={inp}
        data-barcode-input=""
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="search"
        enterKeyHint="go"
        value={value}
        placeholder={t(placeholder)}
        className={cx(
          'h-12 w-full rounded-xl border-2 border-gold/60 bg-surface ps-11 pe-3 text-base outline-none focus:border-gold focus:ring-4 focus:ring-gold/20',
          flash === 'ok' && 'flash-ok border-green-500',
          flash === 'err' && 'flash-err border-red-500',
        )}
        onKeyDown={(e) => {
          const now = performance.now();
          if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            const tm = timing.current;
            if (!tm.n || now - tm.last > 1000) timing.current = { first: now, last: now, n: 1 };
            else timing.current = { ...tm, last: now, n: tm.n + 1 };
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            submit('Enter');
          } else if (e.key === 'Tab' && valueRef.current && isFast()) {
            e.preventDefault(); // le lecteur envoie Tab : on valide sans quitter le champ
            submit('Tab');
          }
        }}
        onChange={(e) => {
          valueRef.current = e.target.value;
          setValue(e.target.value);
          onType?.(e.target.value);
          // Lecteur réglé sans suffixe : validation automatique après une pause, si la saisie était rapide
          window.clearTimeout(idleTimer.current);
          const cfg = getScannerConfig(settings.scanner_config);
          idleTimer.current = window.setTimeout(() => {
            if (valueRef.current && isFast()) submit('auto');
          }, Math.max(cfg.idleTimeout, 150));
        }}
      />
    </div>
  );
});
