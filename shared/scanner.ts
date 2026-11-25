// Logique pure de détection d'un lecteur code-barres en mode USB HID Keyboard (Honeywell et compatibles).
// Le lecteur "tape" les caractères très rapidement (typiquement < 30 ms entre deux touches) puis envoie
// un suffixe (Enter par défaut, Tab possible). Un humain tape beaucoup plus lentement.

export interface ScannerConfig {
  suffix: 'Enter' | 'Tab' | 'none';
  /** délai max (ms) entre deux caractères pour être considéré comme un scan */
  maxInterval: number;
  /** longueur minimale d'un code */
  minLength: number;
  /** fenêtre (ms) d'élimination des doubles événements involontaires (même code) */
  dedupeMs: number;
  /** en mode sans suffixe : délai d'inactivité (ms) qui termine la lecture */
  idleTimeout: number;
  sound: boolean;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  suffix: 'Enter',
  maxInterval: 50,
  minLength: 4,
  dedupeMs: 250,
  idleTimeout: 120,
  sound: true,
};

export type ScanEvent = { code: string; durationMs: number; at: number };

export class ScanBuffer {
  private chars: string[] = [];
  private firstAt = 0;
  private lastAt = 0;
  private lastEmit: { code: string; at: number } | null = null;

  constructor(public config: ScannerConfig) {}

  reset() {
    this.chars = [];
    this.firstAt = 0;
    this.lastAt = 0;
  }

  get pending(): string {
    return this.chars.join('');
  }

  /**
   * Traite une touche. Retourne :
   *  - { kind: 'scan', event } si un scan complet est détecté (le suffixe doit être consommé : preventDefault)
   *  - { kind: 'buffering' } si la touche fait partie d'une saisie rapide en cours
   *  - { kind: 'ignore' } sinon
   */
  feed(key: string, now: number): { kind: 'scan'; event: ScanEvent } | { kind: 'duplicate' } | { kind: 'buffering' } | { kind: 'ignore' } {
    const isSuffix = (this.config.suffix === 'Enter' && key === 'Enter') || (this.config.suffix === 'Tab' && key === 'Tab');
    if (isSuffix) {
      const res = this.complete(now);
      return res ?? { kind: 'ignore' };
    }
    if (key.length !== 1) return { kind: 'ignore' }; // Shift, Control, etc.
    if (this.chars.length > 0 && now - this.lastAt > this.config.maxInterval) {
      // trop lent : on repart d'un nouveau tampon (frappe humaine)
      this.reset();
    }
    if (this.chars.length === 0) this.firstAt = now;
    this.chars.push(key);
    this.lastAt = now;
    return { kind: 'buffering' };
  }

  /** À appeler par un minuteur en mode sans suffixe. */
  idle(now: number) {
    if (this.config.suffix !== 'none') return null;
    if (this.chars.length && now - this.lastAt >= this.config.idleTimeout) return this.complete(now);
    return null;
  }

  private complete(now: number): { kind: 'scan'; event: ScanEvent } | { kind: 'duplicate' } | null {
    const code = this.chars.join('');
    const duration = this.lastAt - this.firstAt;
    const n = this.chars.length;
    const fast = n >= 2 ? duration / (n - 1) <= this.config.maxInterval : false;
    const limit = this.config.suffix === 'none' ? this.config.idleTimeout * 3 : Math.max(this.config.maxInterval * 2, 100);
    const recent = n > 0 && now - this.lastAt <= limit;
    this.reset();
    if (n < this.config.minLength || !fast || !recent) return null;
    if (this.lastEmit && this.lastEmit.code === code && now - this.lastEmit.at < this.config.dedupeMs) {
      return { kind: 'duplicate' };
    }
    this.lastEmit = { code, at: now };
    return { kind: 'scan', event: { code, durationMs: duration, at: now } };
  }
}
