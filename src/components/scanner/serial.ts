// Lecteurs code-barres sur port série (RS232, USB-COM) via Web Serial.
// Une fois un port autorisé, il est rouvert automatiquement à chaque démarrage (application de bureau ou Chrome/Edge)
// et chaque code lu est transmis à l'écran actif (POS, réception, inventaire, fiche produit…).
import { analyzeBarcode } from '../../../shared/barcode';
import { pushScanHistory } from './scanner';

type Status = { connected: number; baud: number; error?: string };
const listeners = new Set<(s: Status) => void>();
const open = new Set<any>();
let status: Status = { connected: 0, baud: getBaud() };

export function getBaud(): number {
  return Number(localStorage.getItem('ndc-serial-baud') ?? 9600) || 9600;
}
export function setBaud(b: number) {
  localStorage.setItem('ndc-serial-baud', String(b));
}
export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;
export const isDesktopApp = () => !!(window as any).ndcDesktop?.isDesktop;

function emit(s: Partial<Status>) {
  status = { ...status, ...s };
  listeners.forEach((l) => l(status));
}
export function onSerialStatus(l: (s: Status) => void) {
  listeners.add(l);
  l(status);
  return () => listeners.delete(l);
}

async function readPort(port: any) {
  if (open.has(port)) return;
  try {
    await port.open({ baudRate: getBaud(), dataBits: 8, stopBits: 1, parity: 'none' });
  } catch (e: any) {
    if (!String(e?.message).includes('already open')) {
      emit({ error: 'Port série occupé ou inaccessible : ' + e.message });
      return;
    }
  }
  open.add(port);
  emit({ connected: open.size, baud: getBaud(), error: undefined });
  const decoder = new TextDecoderStream();
  port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  let buf = '';
  let timer = 0;
  const flush = () => {
    const code = analyzeBarcode(buf).code;
    buf = '';
    if (!code) return;
    pushScanHistory({ code, at: Date.now(), durationMs: 0, source: 'serial', format: analyzeBarcode(code).format, terminator: 'Enter' });
    window.dispatchEvent(new CustomEvent('ndc:serial-scan', { detail: code }));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const ch of value as string) {
        if (ch === '\r' || ch === '\n') {
          if (buf) flush();
        } else buf += ch;
      }
      // lecteur sans suffixe : fin de code après 100 ms de silence
      window.clearTimeout(timer);
      if (buf) timer = window.setTimeout(flush, 100);
    }
  } catch {
    /* lecteur débranché */
  } finally {
    open.delete(port);
    emit({ connected: open.size });
  }
}

/** Rouvre automatiquement les ports déjà autorisés (appelé au démarrage). */
export async function startSerialBridge() {
  if (!serialSupported()) return;
  const nav: any = navigator;
  try {
    for (const p of await nav.serial.getPorts()) readPort(p);
    nav.serial.addEventListener('connect', (e: any) => readPort(e.target ?? e.port));
  } catch {
    /* ignoré */
  }
}

/** Connexion manuelle (bouton). Dans l'application de bureau, le lecteur est choisi automatiquement. */
export async function connectSerialPort() {
  if (!serialSupported()) throw new Error('Port série non disponible : utilisez l’application de bureau Nour de Commerce, ou Chrome / Edge sur ordinateur.');
  const port = await (navigator as any).serial.requestPort();
  await readPort(port);
}

export async function reconnectAll() {
  for (const p of [...open]) {
    try {
      await p.close();
    } catch {
      /* */
    }
    open.delete(p);
  }
  await startSerialBridge();
}
