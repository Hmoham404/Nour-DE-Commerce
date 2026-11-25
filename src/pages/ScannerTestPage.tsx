import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Plug, Printer, ScanBarcode, Volume2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { analyzeBarcode } from '../../shared/barcode';
import { DEFAULT_SCANNER_CONFIG, type ScannerConfig } from '../../shared/scanner';
import { BarcodeScanner } from '../components/scanner/BarcodeScanner';
import { beepError, beepOk, getScannerConfig, getScanHistory, pushScanHistory, saveLocalScannerConfig, type ScanRecord } from '../components/scanner/scanner';
import { Badge, Button, Card, Checkbox, Field, Input, PageHeader, Select, useToast } from '../components/ui';

/** Codes de la feuille de test (doivent être relus à l'identique). */
export const TEST_CODES = [
  { code: '6191234567897', label: 'EAN-13' },
  { code: '0012345678905', label: 'EAN-13 avec zéros initiaux' },
  { code: '96385074', label: 'EAN-8' },
  { code: '036000291452', label: 'UPC-A' },
  { code: 'NOUR-TEST-123', label: 'Code 128 (lettres et tiret)' },
];

/** Interprétation en clair d'une lecture, pour le réglage sur place. */
function Diagnostic({ r }: { r: ScanRecord }) {
  const tips: { ok: boolean; text: string }[] = [];
  const expected = TEST_CODES.find((x) => x.code === r.code);
  if (expected) tips.push({ ok: true, text: `Code de la feuille de test reconnu à l'identique (${expected.label}).` });
  if (r.source === 'hid' || r.source === 'input') {
    if (r.terminator === 'Enter') tips.push({ ok: true, text: 'Fin de lecture : touche Entrée envoyée par le lecteur (réglage idéal).' });
    if (r.terminator === 'Tab') tips.push({ ok: true, text: 'Fin de lecture : Tabulation. Fonctionne ; « Entrée » est conseillé (code « Add CR Suffix » du manuel Honeywell).' });
    if (r.terminator === 'auto') tips.push({ ok: true, text: 'Le lecteur n’envoie pas de touche de fin : le logiciel valide automatiquement après une courte pause. Fonctionne ; « Add CR Suffix » est conseillé pour plus de rapidité.' });
    if (r.source === 'input' && r.code.length >= 6) tips.push({ ok: false, text: `Saisie lente (${r.durationMs} ms) : s'il s'agit du lecteur, augmentez « Délai max entre caractères » ci-contre.` });
  }
  if (/^[0-9]+$/.test(r.code) && r.code.length >= 8) {
    const info = analyzeBarcode(r.code);
    if (info.checksumValid === false) tips.push({ ok: false, text: 'Clé de contrôle invalide : code mal imprimé ou caractères mal transmis (vérifier la disposition clavier du lecteur).' });
  }
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {tips.map((t, i) => (
        <li key={i} className={`flex items-start gap-2 ${t.ok ? 'text-green-800 dark:text-green-300' : 'text-amber-800 dark:text-amber-300'}`}>
          {t.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />} {t.text}
        </li>
      ))}
    </ul>
  );
}

/** Page de test et de configuration du lecteur code-barres Honeywell. */
export default function ScannerTestPage() {
  const { settings, can, reloadSettings } = useAuth();
  const toast = useToast();
  const [cfg, setCfg] = useState<ScannerConfig>(() => getScannerConfig(settings.scanner_config));
  const [history, setHistory] = useState<ScanRecord[]>(getScanHistory());
  const [last, setLast] = useState<ScanRecord | null>(null);
  const [lookup, setLookup] = useState<any | null>(null);
  const [serial, setSerial] = useState<string | null>(null);
  const port = useRef<any>(null);

  useEffect(() => {
    const h = (e: Event) => {
      const r = (e as CustomEvent).detail as ScanRecord;
      setLast(r);
      setHistory(getScanHistory());
    };
    window.addEventListener('ndc:scan', h);
    return () => window.removeEventListener('ndc:scan', h);
  }, []);

  const apply = (c: ScannerConfig) => {
    setCfg(c);
    saveLocalScannerConfig(c);
  };

  const connectSerial = async () => {
    const nav: any = navigator;
    if (!nav.serial) return toast.error('Web Serial non disponible (Chrome / Edge sur ordinateur, en HTTPS).');
    try {
      const p = await nav.serial.requestPort();
      await p.open({ baudRate: 9600 });
      port.current = p;
      setSerial('Connecté (9600 bauds)');
      const reader = p.readable.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const parts = buf.split(/\r\n|\r|\n/);
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const code = analyzeBarcode(part).code;
          if (code) {
            pushScanHistory({ code, at: Date.now(), durationMs: 0, source: 'serial', format: analyzeBarcode(code).format });
            beepOk(cfg.sound);
          }
        }
      }
    } catch (e: any) {
      setSerial(null);
      if (e?.name !== 'NotFoundError') toast.error('Connexion série impossible : ' + e.message);
    }
  };

  const info = last ? analyzeBarcode(last.code) : null;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Configuration du scanner" subtitle="Lecteur Honeywell — mode USB HID Keyboard (aucun pilote requis)" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Champ de test">
            <BarcodeScanner
              placeholder="Cliquez ici puis scannez un code-barres avec le lecteur"
              onScan={async (code) => {
                try {
                  const r = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
                  setLookup(r);
                  return r.found ? { ok: true, message: r.product.name } : { ok: false, message: 'Code inconnu dans le catalogue' };
                } catch {
                  return { ok: true, message: 'Lecture réussie' };
                }
              }}
            />
            {last && (
              <div className="mt-4 rounded-xl border-2 border-green-500 bg-green-50 p-4 dark:bg-green-950/30">
                <div className="flex items-center gap-2 text-lg font-bold text-green-700 dark:text-green-300"><CheckCircle2 className="size-6" /> Lecture réussie</div>
                <div className="num mt-1 text-2xl font-bold">{last.code}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  <Badge color="blue">{info?.format}</Badge>
                  {info?.checksumValid === true && <Badge color="green">Clé de contrôle valide</Badge>}
                  {info?.checksumValid === false && <Badge color="red">Clé de contrôle invalide</Badge>}
                  <Badge>{`${last.code.length} caractères`}</Badge>
                  <Badge>{last.source === 'hid' ? `Lecteur USB HID · ${last.durationMs} ms` : last.source === 'camera' ? 'Caméra' : last.source === 'serial' ? 'Port série' : 'Saisie manuelle'}</Badge>
                  <Badge>{new Date(last.at).toLocaleTimeString('fr-FR')}</Badge>
                </div>
                {lookup && <div className="mt-2 text-sm">{lookup.found ? <>Produit : <b>{lookup.product.name}</b> · stock {lookup.product.stock}</> : 'Ce code n’existe pas encore dans le catalogue.'}</div>}
                <Diagnostic r={last} />
              </div>
            )}
            {!last && (
              <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">
                Imprimez la <b>feuille de test</b> (bouton à droite) et scannez ses codes un par un : chaque lecture doit afficher « Lecture réussie » avec le bon numéro.
              </p>
            )}
          </Card>
          <Card title="10 dernières lectures" padded={false}>
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-start">Heure</th><th className="px-3 py-2 text-start">Code</th><th className="px-3 py-2 text-start">Format</th><th className="px-3 py-2 text-start">Source</th><th className="px-3 py-2 text-start">Fin</th><th className="px-3 py-2 text-end">Durée</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i} className="border-t border-line"><td className="px-3 py-1.5">{new Date(h.at).toLocaleTimeString('fr-FR')}</td><td className="num px-3 py-1.5">{h.code}</td><td className="px-3 py-1.5">{h.format}</td><td className="px-3 py-1.5">{h.source}</td><td className="px-3 py-1.5">{h.terminator === 'auto' ? 'pause' : h.terminator ?? '—'}</td><td className="num px-3 py-1.5 text-end">{h.durationMs} ms</td></tr>
                ))}
                {!history.length && <tr><td colSpan={6} className="p-4 text-center text-muted">Aucune lecture pour l'instant.</td></tr>}
              </tbody>
            </table>
            <p className="p-3 text-xs text-muted">Test de vitesse : un lecteur USB HID transmet un EAN-13 en général en moins de 150 ms. Une durée élevée indique une saisie manuelle ou un délai inter-caractères trop long.</p>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Feuille de test">
            <p className="mb-2 text-sm">Codes connus (EAN-13, EAN-13 avec zéro initial, EAN-8, UPC-A, Code 128) à imprimer et scanner pour valider le lecteur sur place.</p>
            <Button icon={<Printer className="size-4" />} onClick={() => window.open('/imprimer/test-scanner/1', '_blank', 'noopener')}>Imprimer la feuille de test</Button>
          </Card>
          <Card title="État">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2"><ScanBarcode className="size-5 text-gold" /> Mode : <b>USB HID Keyboard</b></div>
              <p className="text-xs text-muted">En mode clavier, le navigateur ne permet pas de détecter physiquement le branchement du lecteur : l'état « prêt » signifie que l'application écoute les lectures. Seule une lecture réussie confirme le fonctionnement.</p>
              <div className="flex items-center gap-2"><Plug className="size-5" /> Port série : {serial ?? <span className="text-muted">non connecté</span>}</div>
              <Button size="sm" variant="outline" onClick={connectSerial}>Connecter un lecteur série (Web Serial)</Button>
            </div>
          </Card>
          <Card title="Réglages (ce poste)">
            <div className="space-y-3">
              <Field label="Suffixe envoyé par le lecteur">
                <Select value={cfg.suffix} onChange={(e) => apply({ ...cfg, suffix: e.target.value as any })}>
                  <option value="Enter">Entrée (CR) — recommandé</option>
                  <option value="Tab">Tabulation</option>
                  <option value="none">Aucun (détection par délai)</option>
                </Select>
              </Field>
              <Field label="Délai max entre caractères (ms)" hint="Au-delà, la saisie est considérée comme manuelle">
                <Input type="number" min={10} max={300} value={cfg.maxInterval} onChange={(e) => apply({ ...cfg, maxInterval: Number(e.target.value) })} />
              </Field>
              <Field label="Longueur minimale d'un code">
                <Input type="number" min={1} max={20} value={cfg.minLength} onChange={(e) => apply({ ...cfg, minLength: Number(e.target.value) })} />
              </Field>
              <Field label="Anti-double lecture (ms)" hint="Même code relu dans ce délai = ignoré. Les scans répétés volontaires (plus lents) sont comptés.">
                <Input type="number" min={0} max={2000} value={cfg.dedupeMs} onChange={(e) => apply({ ...cfg, dedupeMs: Number(e.target.value) })} />
              </Field>
              {cfg.suffix === 'none' && (
                <Field label="Fin de lecture après inactivité (ms)">
                  <Input type="number" min={40} max={1000} value={cfg.idleTimeout} onChange={(e) => apply({ ...cfg, idleTimeout: Number(e.target.value) })} />
                </Field>
              )}
              <Checkbox checked={cfg.sound} onChange={(v) => apply({ ...cfg, sound: v })} label="Signal sonore" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" icon={<Volume2 className="size-4" />} onClick={() => beepOk(true)}>Bip succès</Button>
                <Button size="sm" variant="outline" icon={<Volume2 className="size-4" />} onClick={() => beepError(true)}>Bip erreur</Button>
                <Button size="sm" variant="ghost" onClick={() => apply({ ...DEFAULT_SCANNER_CONFIG })}>Valeurs par défaut</Button>
              </div>
              {can('settings.manage') && (
                <Button size="sm" onClick={async () => { await api.put('/api/settings', { scanner_config: JSON.stringify(cfg) }); await reloadSettings(); toast.success('Réglages appliqués à tous les postes'); }}>
                  Appliquer à tous les postes
                </Button>
              )}
            </div>
          </Card>
          <Card title="Guide de branchement Honeywell">
            <ol className="list-decimal space-y-1 ps-5 text-sm">
              <li>Branchez le lecteur sur un port USB de l'ordinateur (câble USB, pas RS232).</li>
              <li>Windows l'installe automatiquement comme un clavier : aucun pilote n'est nécessaire.</li>
              <li>Ouvrez le Bloc-notes et scannez un produit : le code doit s'écrire puis passer à la ligne. Sinon, scannez dans le manuel Honeywell le code de configuration « USB Keyboard (PC) » et « Add CR Suffix ».</li>
              <li>Clavier : choisissez la disposition correspondant à Windows (AZERTY France) dans le manuel, sinon les chiffres peuvent sortir en symboles (&amp;é"'…).</li>
              <li>Revenez sur cette page et scannez : « Lecture réussie » doit s'afficher.</li>
              <li>Lecteur RS232 (prise série) : utilisez un adaptateur USB-série et le bouton Web Serial, ou demandez un connecteur local après identification du modèle.</li>
              <li>Sans lecteur (téléphone) : utilisez le bouton « Caméra ».</li>
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}
