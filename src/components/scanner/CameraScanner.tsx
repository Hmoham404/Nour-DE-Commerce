import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui';
import { useI18n } from '../../lib/i18n';
import { pushScanHistory } from './scanner';
import { analyzeBarcode } from '../../../shared/barcode';

/** Lecture par la caméra du téléphone / de la tablette (solution de secours). */
export function CameraScanner({ open, onClose, onScan, continuous = false }: { open: boolean; onClose: () => void; onScan: (code: string) => void; continuous?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    let lastAt = 0;
    let lastCode = '';
    setError(null);
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current!, (result) => {
          if (!result || cancelled) return;
          const code = analyzeBarcode(result.getText()).code;
          const now = Date.now();
          if (code === lastCode && now - lastAt < 1500) return; // anti-doublon caméra
          lastCode = code;
          lastAt = now;
          setLast(code);
          try {
            navigator.vibrate?.(60);
          } catch {
            /* */
          }
          pushScanHistory({ code, at: now, durationMs: 0, source: 'camera', format: analyzeBarcode(code).format });
          onScan(code);
          if (!continuous) onClose();
        });
        if (cancelled) controls.stop();
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? "Accès à la caméra refusé. Autorisez la caméra dans le navigateur." : "Caméra indisponible sur cet appareil (HTTPS requis).");
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('Caméra')} size="md">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <div className="space-y-2">
          <video ref={video} className="aspect-video w-full rounded-xl bg-black object-cover" muted playsInline />
          <p className="text-center text-sm text-muted">Placez le code-barres dans le cadre. {last && <b className="num text-green-600">✓ {last}</b>}</p>
        </div>
      )}
    </Modal>
  );
}
