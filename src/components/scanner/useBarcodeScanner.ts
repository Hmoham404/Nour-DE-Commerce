import { useEffect, useRef, useState } from 'react';
import { ScanBuffer } from '../../../shared/scanner';
import { analyzeBarcode } from '../../../shared/barcode';
import { useAuth } from '../../lib/auth';
import { getScannerConfig, pushScanHistory } from './scanner';

/** Le champ actif est-il une zone de saisie que le scanner ne doit PAS intercepter ? */
function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const h = el as HTMLElement;
  if (h.isContentEditable) return true;
  if (h.dataset?.barcodeInput !== undefined) return true; // géré par BarcodeInput lui-même
  const tag = h.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export interface ScanStatus {
  lastCode: string | null;
  lastAt: number | null;
  ok: boolean | null;
  message?: string;
}

/**
 * Écoute globale du lecteur USB HID (mode clavier) lorsque le focus n'est dans aucun champ de saisie.
 * N'intercepte jamais les frappes dans les champs mot de passe, zones de texte ou formulaires.
 * À activer uniquement sur les écrans concernés (POS, réception, inventaire, fiche produit, test).
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const { settings } = useAuth();
  const cb = useRef(onScan);
  cb.current = onScan;
  const [cfgVersion, setCfgVersion] = useState(0);

  useEffect(() => {
    const h = () => setCfgVersion((v) => v + 1);
    window.addEventListener('ndc:scanner-config', h);
    return () => window.removeEventListener('ndc:scanner-config', h);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const config = getScannerConfig(settings.scanner_config);
    const buf = new ScanBuffer(config);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEditable(document.activeElement)) {
        buf.reset();
        return;
      }
      const r = buf.feed(e.key, performance.now());
      if (r.kind === 'scan') {
        e.preventDefault();
        const code = analyzeBarcode(r.event.code).code;
        pushScanHistory({ code, at: Date.now(), durationMs: Math.round(r.event.durationMs), source: 'hid', format: analyzeBarcode(code).format });
        cb.current(code);
      } else if (r.kind === 'duplicate') {
        e.preventDefault();
      } else if (r.kind === 'buffering' && e.key === ' ') {
        e.preventDefault(); // évite le défilement de page pendant un scan
      }
    };
    const timer = config.suffix === 'none'
      ? window.setInterval(() => {
          const r = buf.idle(performance.now());
          if (r?.kind === 'scan') {
            const code = analyzeBarcode(r.event.code).code;
            pushScanHistory({ code, at: Date.now(), durationMs: Math.round(r.event.durationMs), source: 'hid', format: analyzeBarcode(code).format });
            cb.current(code);
          }
        }, 40)
      : 0;
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (timer) clearInterval(timer);
    };
  }, [enabled, settings.scanner_config, cfgVersion]);
}
