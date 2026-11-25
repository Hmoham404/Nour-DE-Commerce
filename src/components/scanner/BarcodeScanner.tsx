import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ScanBarcode, XCircle } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { Button, cx } from '../ui';
import { BarcodeInput, type BarcodeInputHandle } from './BarcodeInput';
import { CameraScanner } from './CameraScanner';
import { useBarcodeScanner } from './useBarcodeScanner';
import { beepError, beepOk, getScannerConfig } from './scanner';

export type ScanResult = { ok: boolean; message?: string };

/** Indicateur d'état du scanner (ne prétend pas détecter physiquement un lecteur USB HID). */
export function ScannerStatus({ status }: { status: { code: string | null; ok: boolean | null; message?: string; at: number | null } }) {
  const { t } = useI18n();
  if (!status.code)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <ScanBarcode className="size-4 text-gold" /> {t('Scanner prêt')} (USB HID)
      </span>
    );
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', status.ok ? 'text-green-600' : 'text-red-600')}>
      {status.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
      <span className="num">{status.code}</span>
      <span className="truncate">— {status.message ?? (status.ok ? t('Lecture réussie') : t('Code inconnu'))}</span>
    </span>
  );
}

/**
 * Composant réutilisable : champ de scan + écoute globale USB HID + caméra + signaux sonores/visuels.
 * `onScan` doit renvoyer { ok, message } pour déclencher le bon signal.
 */
export function BarcodeScanner({
  onScan,
  onType,
  enabled = true,
  placeholder,
  autoFocus = true,
  refocus = true,
  extra,
}: {
  onScan: (code: string) => Promise<ScanResult> | ScanResult;
  onType?: (text: string) => void;
  enabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  refocus?: boolean;
  extra?: React.ReactNode;
}) {
  const { settings } = useAuth();
  const inputRef = useRef<BarcodeInputHandle>(null);
  const [status, setStatus] = useState<{ code: string | null; ok: boolean | null; message?: string; at: number | null }>({ code: null, ok: null, at: null });
  const [flash, setFlash] = useState<'ok' | 'err' | null>(null);
  const [camera, setCamera] = useState(false);
  const { t } = useI18n();

  const handle = async (code: string) => {
    const sound = getScannerConfig(settings.scanner_config).sound;
    let r: ScanResult;
    try {
      r = await onScan(code);
    } catch (e: any) {
      r = { ok: false, message: e?.message };
    }
    if (r.ok) beepOk(sound);
    else beepError(sound);
    setStatus({ code, ok: r.ok, message: r.message, at: Date.now() });
    setFlash(r.ok ? 'ok' : 'err');
    setTimeout(() => setFlash(null), 600);
    if (refocus) inputRef.current?.focus();
  };

  // lecture lorsque le focus n'est pas dans un champ (ex. après un clic sur le panier)
  useBarcodeScanner(handle, enabled);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <BarcodeInput ref={inputRef} onSubmit={handle} onType={onType} placeholder={placeholder} className="flex-1" flash={flash} />
        <Button variant="outline" className="h-12" onClick={() => setCamera(true)} title={t('Caméra')} icon={<Camera className="size-5" />}>
          <span className="hidden lg:inline">{t('Caméra')}</span>
        </Button>
        {extra}
      </div>
      <ScannerStatus status={status} />
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={handle} continuous />
    </div>
  );
}
