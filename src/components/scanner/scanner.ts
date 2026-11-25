import { DEFAULT_SCANNER_CONFIG, type ScannerConfig } from '../../../shared/scanner';

/** Configuration effective : paramètres globaux (base) surchargés par les réglages propres à ce poste. */
export function getScannerConfig(globalJson?: string): ScannerConfig {
  let g: Partial<ScannerConfig> = {};
  let local: Partial<ScannerConfig> = {};
  try {
    g = globalJson ? JSON.parse(globalJson) : {};
  } catch {
    /* ignoré */
  }
  try {
    local = JSON.parse(localStorage.getItem('ndc-scanner') ?? '{}');
  } catch {
    /* ignoré */
  }
  return { ...DEFAULT_SCANNER_CONFIG, ...g, ...local };
}

export function saveLocalScannerConfig(c: Partial<ScannerConfig>) {
  localStorage.setItem('ndc-scanner', JSON.stringify(c));
  window.dispatchEvent(new Event('ndc:scanner-config'));
}

let audio: AudioContext | null = null;
function tone(freq: number, ms: number, delay = 0) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = freq;
    o.type = 'square';
    g.gain.value = 0.06;
    o.connect(g).connect(audio.destination);
    const t = audio.currentTime + delay / 1000;
    o.start(t);
    o.stop(t + ms / 1000);
  } catch {
    /* audio indisponible */
  }
}
export function beepOk(enabled = true) {
  if (enabled) tone(1400, 90);
}
export function beepError(enabled = true) {
  if (enabled) {
    tone(320, 160);
    tone(240, 220, 200);
  }
}

/** Historique local des 10 dernières lectures (affiché dans la page de test). */
export interface ScanRecord {
  code: string;
  at: number;
  durationMs: number;
  source: 'hid' | 'input' | 'camera' | 'serial';
  format?: string;
  /** fin de lecture détectée : Entrée, Tab ou pause (lecteur sans suffixe) */
  terminator?: 'Enter' | 'Tab' | 'auto';
}
const history: ScanRecord[] = [];
export function pushScanHistory(r: ScanRecord) {
  history.unshift(r);
  history.splice(10);
  window.dispatchEvent(new CustomEvent('ndc:scan', { detail: r }));
}
export const getScanHistory = () => [...history];
