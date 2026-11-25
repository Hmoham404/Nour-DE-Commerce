import { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { dt } from '../lib/format';
import { downloadTemplate, readSpreadsheet } from '../lib/exporters';
import { DataTable } from '../components/DataTable';
import { Badge, Button, Card, Checkbox, PageHeader, Select, Tabs, useConfirm, useToast } from '../components/ui';

type Entity = 'products' | 'customers' | 'suppliers';
const FIELDS: Record<Entity, [string, string, boolean?][]> = {
  products: [
    ['reference', 'Référence'], ['name', 'Désignation', true], ['barcode', 'Code-barres'], ['category', 'Catégorie'], ['brand', 'Marque'], ['supplier', 'Fournisseur (code ou nom)'],
    ['purchase_price', "Prix d'achat HT"], ['sale_price', 'Prix de vente HT', true], ['price_retail', 'Prix détaillant'], ['price_wholesale', 'Prix grossiste'], ['price_distributor', 'Prix distributeur'],
    ['vat', 'TVA (%)'], ['unit', 'Unité'], ['min_stock', 'Stock minimum'], ['initial_stock', 'Stock initial'], ['units_per_carton', 'Pièces par carton'], ['description', 'Description'], ['legacy_id', 'Identifiant ancien logiciel'],
  ],
  customers: [
    ['code', 'Code'], ['name', 'Nom', true], ['type', 'Type'], ['phone', 'Téléphone'], ['email', 'Email'], ['address', 'Adresse'], ['tax_id', 'Matricule fiscal'],
    ['credit_limit', 'Plafond de crédit'], ['opening_balance', 'Solde initial'], ['payment_terms_days', 'Délai de paiement'], ['legacy_id', 'Identifiant ancien logiciel'],
  ],
  suppliers: [
    ['code', 'Code'], ['name', 'Raison sociale', true], ['contact_name', 'Contact'], ['phone', 'Téléphone'], ['email', 'Email'], ['address', 'Adresse'], ['tax_id', 'Matricule fiscal'],
    ['opening_balance', 'Solde initial'], ['payment_terms_days', 'Délai de paiement'], ['legacy_id', 'Identifiant ancien logiciel'],
  ],
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const ALIASES: Record<string, string[]> = {
  reference: ['ref', 'reference', 'code article', 'codearticle', 'referenceinterne'], name: ['name', 'designation', 'libelle', 'nom', 'produit', 'article', 'raisonsociale'],
  barcode: ['barcode', 'codebarre', 'codebarres', 'ean', 'gencod'], category: ['category', 'categorie', 'famille'], brand: ['brand', 'marque'], supplier: ['supplier', 'fournisseur'],
  purchase_price: ['purchaseprice', 'prixachat', 'pa', 'prixachatht'], sale_price: ['saleprice', 'prixvente', 'pv', 'prixventeht', 'prix'], price_retail: ['priceretail', 'prixdetaillant'],
  price_wholesale: ['pricewholesale', 'prixgrossiste', 'prixgros'], price_distributor: ['pricedistributor', 'prixdistributeur'], vat: ['vat', 'tva', 'tauxtva'], unit: ['unit', 'unite'],
  min_stock: ['minstock', 'stockmin', 'stockminimum'], initial_stock: ['initialstock', 'stock', 'quantite', 'qte', 'stockinitial'], units_per_carton: ['unitspercarton', 'colisage', 'piecesparcarton'],
  code: ['code', 'codeclient', 'codefournisseur'], phone: ['phone', 'telephone', 'tel', 'mobile'], email: ['email', 'mail'], address: ['address', 'adresse'], tax_id: ['taxid', 'matriculefiscal', 'mf'],
  credit_limit: ['creditlimit', 'plafond', 'plafondcredit'], opening_balance: ['openingbalance', 'solde', 'soldeinitial'], payment_terms_days: ['paymenttermsdays', 'delai', 'delaipaiement'],
  type: ['type', 'typeclient'], contact_name: ['contactname', 'contact'], legacy_id: ['legacyid', 'id', 'ancienid'], description: ['description'],
};

export default function Import() {
  const [tab, setTab] = useState<'wizard' | 'history'>('wizard');
  const [entity, setEntity] = useState<Entity>('products');
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<{ headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [upsert, setUpsert] = useState(false);
  const [analysis, setAnalysis] = useState<any | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const jobs = useFetch<any[]>(tab === 'history' ? '/api/import/jobs' : null, [tab]);
  const toast = useToast();
  const confirm = useConfirm();
  const step = result ? 5 : analysis ? 4 : sheet ? 3 : 1;

  const load = async (f: File) => {
    try {
      const s = await readSpreadsheet(f);
      if (!s.rows.length) return toast.error('Fichier vide');
      setFile(f);
      setSheet(s);
      setAnalysis(null);
      setResult(null);
      // association automatique des colonnes
      const m: Record<string, string> = {};
      for (const [field] of FIELDS[entity]) {
        const h = s.headers.find((x) => norm(x) === norm(field) || (ALIASES[field] ?? []).includes(norm(x)));
        if (h) m[field] = h;
      }
      setMapping(m);
    } catch (e: any) {
      toast.error('Lecture du fichier impossible : ' + e.message);
    }
  };
  const mapped = useMemo(() => (sheet ? sheet.rows.map((r) => Object.fromEntries(Object.entries(mapping).filter(([, h]) => h).map(([f, h]) => [f, r[h]]))) : []), [sheet, mapping]);

  const analyse = async () => {
    setBusy(true);
    try {
      setAnalysis(await api.post('/api/import', { entity, mode: upsert ? 'upsert' : 'insert', dry_run: true, rows: mapped }));
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    const s = analysis.summary;
    if (!(await confirm({ title: "Confirmer l'importation", message: <p>{s.insert} ajout(s){upsert ? `, ${s.update} mise(s) à jour` : ''}, {s.skip} ligne(s) ignorée(s). {upsert && <b>Les enregistrements existants seront modifiés (le stock n'est jamais écrasé).</b>}</p> }))) return;
    setBusy(true);
    try {
      setResult(await api.post('/api/import', { entity, mode: upsert ? 'upsert' : 'insert', dry_run: false, rows: mapped, file_name: file?.name }));
      toast.success('Importation terminée');
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const reset = () => (setFile(null), setSheet(null), setAnalysis(null), setResult(null));

  return (
    <div>
      <PageHeader title="Importation / exportation" subtitle="Migration depuis l'ancien logiciel : Excel (.xlsx, .xls) ou CSV" />
      <Tabs tabs={[['wizard', 'Assistant d’importation'], ['history', 'Historique des imports']]} value={tab} onChange={setTab} />
      {tab === 'history' ? (
        <DataTable rows={jobs.data} loading={jobs.loading} columns={[
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'entity', header: 'Données' },
          { key: 'file_name', header: 'Fichier' },
          { key: 'mode', header: 'Mode' },
          { key: 'total_rows', header: 'Lignes', align: 'end' },
          { key: 'inserted', header: 'Ajoutées', align: 'end' },
          { key: 'updated', header: 'Mises à jour', align: 'end' },
          { key: 'errors_count', header: 'Erreurs', align: 'end', render: (r) => (r.errors_count ? <Badge color="red">{String(r.errors_count)}</Badge> : '0') },
          { key: 'created_by_name', header: 'Par' },
        ]} />
      ) : (
        <div className="space-y-4">
          <ol className="flex flex-wrap gap-2 text-xs">
            {['1. Fichier', '2. Colonnes', '3. Prévisualisation et contrôles', '4. Confirmation', '5. Rapport'].map((s, i) => (
              <li key={s} className={'rounded-full px-3 py-1 ' + (step > i ? 'bg-navy text-white dark:bg-gold dark:text-navy' : 'bg-surface-2 text-muted')}>{s}</li>
            ))}
          </ol>
          <Card title="1. Fichier">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-semibold text-muted">Données à importer</span>
                <Select value={entity} onChange={(e) => (setEntity(e.target.value as Entity), reset())} className="w-56">
                  <option value="products">Produits, codes-barres, prix, stocks initiaux</option>
                  <option value="customers">Clients et soldes initiaux</option>
                  <option value="suppliers">Fournisseurs et soldes initiaux</option>
                </Select>
              </label>
              <Button variant="outline" icon={<Download className="size-4" />} onClick={() => downloadTemplate(entity)}>Télécharger le modèle Excel</Button>
              <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-navy px-4 text-sm font-medium text-white">
                <FileUp className="size-4" /> {file ? file.name : 'Choisir un fichier…'}
                <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
              </label>
              {sheet && <span className="text-sm text-muted">{sheet.rows.length} ligne(s), {sheet.headers.length} colonne(s)</span>}
            </div>
            <p className="mt-2 text-xs text-muted">Conseil : formatez la colonne des codes-barres en « Texte » dans Excel pour conserver les zéros initiaux. Maximum 5 000 lignes par import.</p>
          </Card>
          {sheet && !result && (
            <Card title="2. Association des colonnes">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FIELDS[entity].map(([f, label, req]) => (
                  <label key={f} className="text-sm">
                    <span className="mb-1 block text-xs font-semibold text-muted">{label}{req && <span className="text-red-500"> *</span>}</span>
                    <Select value={mapping[f] ?? ''} onChange={(e) => (setMapping({ ...mapping, [f]: e.target.value }), setAnalysis(null))}>
                      <option value="">— ignorer —</option>
                      {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-4">
                <Checkbox checked={upsert} onChange={(v) => (setUpsert(v), setAnalysis(null))} label="Mettre à jour les enregistrements existants (même référence / code / identifiant ancien)" />
                <Button loading={busy} disabled={FIELDS[entity].some(([f, , r]) => r && !mapping[f])} onClick={analyse}>Analyser le fichier</Button>
              </div>
            </Card>
          )}
          {analysis && !result && (
            <Card title="3. Prévisualisation, doublons et erreurs" actions={<Button variant="gold" loading={busy} disabled={!analysis.summary.insert && !analysis.summary.update} onClick={run}>4. Confirmer et importer</Button>}>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge color="green">{`${analysis.summary.insert} à ajouter`}</Badge>
                {upsert && <Badge color="blue">{`${analysis.summary.update} à mettre à jour`}</Badge>}
                <Badge color="gray">{`${analysis.summary.skip} ignorée(s)`}</Badge>
                <Badge color="red">{`${analysis.summary.errors} en erreur`}</Badge>
                <Badge color="amber">{`${analysis.summary.warnings} avertissement(s)`}</Badge>
              </div>
              <DataTable
                rows={analysis.rows}
                rowKey={(r) => String(r.row)}
                clientPageSize={50}
                columns={[
                  { key: 'row', header: 'Ligne' },
                  { key: 'action', header: 'Action', render: (r) => <Badge color={r.action === 'insert' ? 'green' : r.action === 'update' ? 'blue' : 'gray'}>{r.action === 'insert' ? 'Ajout' : r.action === 'update' ? 'Mise à jour' : 'Ignorée'}</Badge> },
                  { key: 'name', header: 'Nom', render: (r) => r.data.name },
                  { key: 'ref', header: 'Réf / code', render: (r) => r.data.reference ?? r.data.code },
                  { key: 'msg', header: 'Contrôles', render: (r) => (
                    <div className="text-xs">
                      {r.errors.map((e: string) => <div key={e} className="text-red-600">✘ {e}</div>)}
                      {r.warnings.map((w: string) => <div key={w} className="text-amber-600">⚠ {w}</div>)}
                    </div>
                  ) },
                ]}
              />
            </Card>
          )}
          {result && (
            <Card title="5. Rapport final" actions={<Button variant="outline" onClick={reset}>Nouvel import</Button>}>
              <p className="flex items-center gap-2 text-lg"><CheckCircle2 className="size-6 text-green-600" /> {result.imported} ligne(s) importée(s)</p>
              {result.failures.length > 0 && (
                <div className="mt-3">
                  <p className="flex items-center gap-2 font-semibold text-red-600"><XCircle className="size-5" /> {result.failures.length} ligne(s) non importée(s)</p>
                  <ul className="mt-1 max-h-72 overflow-y-auto text-sm">{result.failures.map((f: any) => <li key={f.row}>Ligne {f.row} : {f.message}</li>)}</ul>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
