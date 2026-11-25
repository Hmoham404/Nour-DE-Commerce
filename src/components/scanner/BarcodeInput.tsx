import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { analyzeBarcode } from '../../../shared/barcode';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { cx } from '../ui';
import { getScannerConfig, pushScanHistory } from './scanner';

export interface BarcodeInputHandle {
  focus: () => void;
}

/**
 * Champ de scan : reçoit la saisie du lecteur Honeywell (USB HID) ou une saisie manuelle de secours.
 * Validé par le suffixe configuré (Entrée / Tab). Le tampon est vidé après chaque lecture.
 * Si `onType` est fourni, le texte est aussi transmis pour la recherche par nom.
 */
export const BarcodeInput = forwardRef<BarcodeInputHandle, {
  onSubmit: (code: string) => void;
  onType?: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  flash?: 'ok' | 'err' | null;
}>(({ onSubmit, onType, placeholder = 'Scanner ou rechercher un produit…', autoFocus, className, flash }, ref) => {
  const { settings } = useAuth();
  const { t } = useI18n();
  const inp = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const timing = useRef<{ first: number; last: number; n: number }>({ first: 0, last: 0, n: 0 });
  useImperativeHandle(ref, () => ({ focus: () => inp.current?.focus() }));

  const submit = () => {
    const code = analyzeBarcode(value).code;
    if (!code) return;
    const tm = timing.current;
    const avg = tm.n > 1 ? (tm.last - tm.first) / (tm.n - 1) : 999;
    const cfg = getScannerConfig(settings.scanner_config);
    pushScanHistory({ code, at: Date.now(), durationMs: Math.round(tm.last - tm.first), source: avg <= cfg.maxInterval ? 'hid' : 'input', format: analyzeBarcode(code).format });
    setValue('');
    onType?.('');
    timing.current = { first: 0, last: 0, n: 0 };
    onSubmit(code);
  };

  return (
    <div className={cx('relative', className)}>
      <ScanLine className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-gold" />
      <input
        ref={inp}
        data-barcode-input=""
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        inputMode="search"
        value={value}
        placeholder={t(placeholder)}
        className={cx(
          'h-12 w-full rounded-xl border-2 border-gold/60 bg-surface ps-11 pe-3 text-base outline-none focus:border-gold focus:ring-4 focus:ring-gold/20',
          flash === 'ok' && 'flash-ok border-green-500',
          flash === 'err' && 'flash-err border-red-500',
        )}
        onKeyDown={(e) => {
          const cfg = getScannerConfig(settings.scanner_config);
          const now = performance.now();
          if (e.key.length === 1) {
            const tm = timing.current;
            if (!tm.n || now - tm.last > 1000) timing.current = { first: now, last: now, n: 1 };
            else timing.current = { ...tm, last: now, n: tm.n + 1 };
          }
          if (e.key === 'Enter' || (cfg.suffix === 'Tab' && e.key === 'Tab' && value)) {
            e.preventDefault();
            submit();
          }
        }}
        onChange={(e) => {
          setValue(e.target.value);
          onType?.(e.target.value);
        }}
      />
    </div>
  );
});
