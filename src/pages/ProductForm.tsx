import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Copy, ImagePlus, Plus, RefreshCw, ScanBarcode, Star, Trash2, Wand2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, money, pct, MOVE_TYPES } from '../lib/format';
import { analyzeBarcode } from '../../shared/barcode';
import { marginRates, priceTtc, htFromTtc } from '../../shared/pricing';
import { BarcodeInput } from '../components/scanner/BarcodeInput';
import { CameraScanner } from '../components/scanner/CameraScanner';
import { useBarcodeScanner } from '../components/scanner/useBarcodeScanner';
import { beepError, beepOk } from '../components/scanner/scanner';
import { EntitySelect } from '../components/common';
import { DataTable } from '../components/DataTable';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, Tabs, Textarea, useToast } from '../components/ui';

const EMPTY = {
  reference: '', name: '', description: '', category_id: null, brand_id: null, supplier_id: null, purchase_price: 0, sale_price: 0, price_retail: null, price_wholesale: null,
  price_distributor: null, vat_bp: 1900, unit: 'pièce', packaging: '', units_per_carton: null, min_stock: 0, max_stock: null, track_batches: false, is_favorite: false, photo: null,
  barcodes: [] as any[], initial_stock: 0, initial_batch_number: '', initial_expires_at: '',
};

async function resizeImage(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const max = 400;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

export default function ProductForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const isNew = id === 'nouveau';
  const nav = useNavigate();
  const toast = useToast();
  const { can, settings } = useAuth();
  const [p, setP] = useState<any>(() => ({ ...EMPTY, vat_bp: Number(settings.default_vat_bp ?? 1900), barcodes: sp.get('barcode') ? [{ barcode: sp.get('barcode'), packaging: 'piece', qty_per_unit: 1, is_primary: true }] : [] }));
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'fiche' | 'stock' | 'historique'>('fiche');
  const [scanMode, setScanMode] = useState(false);
  const [camera, setCamera] = useState(false);
  const [dup, setDup] = useState<any | null>(null);
  const cats = useFetch<any[]>('/api/categories');
  const brands = useFetch<any[]>('/api/brands');
  const movements = useFetch<any>(!isNew && tab === 'historique' ? `/api/stock/movements?product_id=${id}&from=2000-01-01&to=2100-12-31&pageSize=100` : null, [tab]);
  const editable = can('products.manage');
  const canPrices = can('products.prices') || isNew;
  const fin = can('finance.view');
  const vatRates: number[] = JSON.parse(settings.vat_rates_bp ?? '[0,700,1300,1900]');

  useEffect(() => {
    if (isNew) return;
    api.get(`/api/products/${id}`).then((d) => {
      setP({ ...EMPTY, ...d, track_batches: !!d.track_batches, is_favorite: !!d.is_favorite, barcodes: d.barcodes.map((b: any) => ({ ...b, is_primary: !!b.is_primary })) });
      setLoading(false);
    }).catch((e) => (setError(e.message), setLoading(false)));
  }, [id, isNew]);

  const set = (k: string, v: any) => setP((x: any) => ({ ...x, [k]: v }));

  /** Scan dans la fiche produit : remplit le champ, détecte les doublons. */
  const addBarcode = async (raw: string) => {
    const code = analyzeBarcode(raw).code;
    if (!code) return;
    if (p.barcodes.some((b: any) => b.barcode === code)) {
      beepError();
      return toast.warning('Ce code est déjà dans la fiche.');
    }
    const r = await api.get(`/api/products/lookup/${encodeURIComponent(code)}`);
    if (r.found && r.product.id !== id) {
      beepError();
      setDup(r.product);
      return;
    }
    beepOk();
    const info = analyzeBarcode(code);
    if (info.checksumValid === false) toast.warning(`Clé de contrôle ${info.format} invalide — vérifiez le code.`);
    set('barcodes', [...p.barcodes, { barcode: code, packaging: 'piece', qty_per_unit: 1, is_primary: p.barcodes.length === 0 }]);
    setScanMode(false);
  };
  useBarcodeScanner(addBarcode, scanMode);

  const generate = async () => {
    const r = await api.post('/api/products/generate-barcode');
    set('barcodes', [...p.barcodes, { barcode: r.barcode, packaging: 'piece', qty_per_unit: 1, is_primary: p.barcodes.length === 0 }]);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...p,
        description: p.description || null,
        packaging: p.packaging || null,
        initial_batch_number: p.initial_batch_number || null,
        initial_expires_at: p.initial_expires_at || null,
        initial_stock: isNew ? p.initial_stock || 0 : undefined,
        barcodes: p.barcodes.map((b: any) => ({ barcode: b.barcode, packaging: b.packaging, qty_per_unit: Number(b.qty_per_unit) || 1, is_primary: !!b.is_primary })),
      };
      if (isNew) {
        const r = await api.post('/api/products', body);
        toast.success(`Produit créé (${r.reference})`);
        nav(`/produits/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/products/${id}`, body);
        toast.success('Produit enregistré');
      }
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'BARCODE_DUPLICATE' && e.details?.product) setDup(e.details.product);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  const m = fin && p.sale_price ? marginRates(p.sale_price, p.avg_cost || p.purchase_price) : null;
  const totalStock = (p.stock ?? []).reduce((s: number, r: any) => s + r.quantity, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={isNew ? 'Nouveau produit' : p.name}
        subtitle={!isNew && <span className="num">{p.reference} · stock {totalStock} {p.unit}</span>}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav('/produits')}>
              Retour
            </Button>
            {!isNew && editable && (
              <Button variant="outline" icon={<Copy className="size-4" />} onClick={async () => {
                const r = await api.post(`/api/products/${id}/duplicate`);
                toast.success('Produit dupliqué');
                nav(`/produits/${r.id}`);
                window.location.reload();
              }}>
                Dupliquer
              </Button>
            )}
            {editable && (
              <Button loading={busy} onClick={save}>
                Enregistrer
              </Button>
            )}
          </>
        }
      />
      {!isNew && <Tabs tabs={[['fiche', 'Fiche'], ['stock', 'Stock et lots'], ['historique', 'Mouvements et prix']]} value={tab} onChange={setTab} />}
      <ErrorBox error={error} />
      {tab === 'fiche' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card title="Identification">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Désignation" required className="sm:col-span-2">
                  <Input value={p.name} onChange={(e) => set('name', e.target.value)} disabled={!editable} autoFocus={isNew} />
                </Field>
                <Field label="Référence interne" hint="Laisser vide pour une génération automatique">
                  <Input value={p.reference} onChange={(e) => set('reference', e.target.value)} disabled={!editable} />
                </Field>
                <Field label="Catégorie">
                  <Select value={p.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)} disabled={!editable}>
                    <option value="">—</option>
                    {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.parent_name ? `${c.parent_name} › ` : ''}{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Marque">
                  <Select value={p.brand_id ?? ''} onChange={(e) => set('brand_id', e.target.value || null)} disabled={!editable}>
                    <option value="">—</option>
                    {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Fournisseur principal">
                  <EntitySelect endpoint="/api/suppliers" value={p.supplier_id} onChange={(v) => set('supplier_id', v)} />
                </Field>
                <Field label="Description" className="sm:col-span-2">
                  <Textarea value={p.description ?? ''} onChange={(e) => set('description', e.target.value)} disabled={!editable} />
                </Field>
              </div>
            </Card>
            <Card
              title="Codes-barres"
              actions={
                editable && (
                  <>
                    <Button size="sm" variant={scanMode ? 'gold' : 'outline'} icon={<ScanBarcode className="size-4" />} onClick={() => setScanMode((s) => !s)}>
                      {scanMode ? 'En attente du scan…' : 'Scanner le code-barres'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setCamera(true)}>Caméra</Button>
                    <Button size="sm" variant="outline" icon={<Wand2 className="size-4" />} onClick={generate}>Générer (EAN-13 interne)</Button>
                  </>
                )
              }
            >
              {scanMode && (
                <div className="mb-3">
                  <BarcodeInput onSubmit={addBarcode} autoFocus placeholder="Scannez le produit avec le lecteur Honeywell, ou saisissez le code puis Entrée" />
                </div>
              )}
              <p className="mb-2 text-xs text-muted">Plusieurs codes possibles selon le conditionnement (pièce, pack, carton). Les zéros initiaux sont conservés.</p>
              <div className="space-y-2">
                {p.barcodes.map((b: any, i: number) => (
                  <div key={i} className="grid grid-cols-[1fr_110px_90px_auto_auto] items-center gap-2">
                    <Input className="num" value={b.barcode} disabled={!editable} onChange={(e) => set('barcodes', p.barcodes.map((x: any, j: number) => (j === i ? { ...x, barcode: e.target.value } : x)))} />
                    <Select value={b.packaging} disabled={!editable} onChange={(e) => set('barcodes', p.barcodes.map((x: any, j: number) => (j === i ? { ...x, packaging: e.target.value, qty_per_unit: e.target.value === 'carton' && p.units_per_carton ? p.units_per_carton : x.qty_per_unit } : x)))}>
                      <option value="piece">Pièce</option>
                      <option value="pack">Pack</option>
                      <option value="carton">Carton</option>
                    </Select>
                    <Input type="number" min={1} title="Quantité par scan" value={b.qty_per_unit} disabled={!editable} onChange={(e) => set('barcodes', p.barcodes.map((x: any, j: number) => (j === i ? { ...x, qty_per_unit: Number(e.target.value) } : x)))} />
                    <button title="Code principal" onClick={() => set('barcodes', p.barcodes.map((x: any, j: number) => ({ ...x, is_primary: j === i })))} className={b.is_primary ? 'text-gold' : 'text-muted'}>
                      <Star className="size-5" fill={b.is_primary ? 'currentColor' : 'none'} />
                    </button>
                    {editable && (
                      <button className="text-red-600" onClick={() => set('barcodes', p.barcodes.filter((_: any, j: number) => j !== i))}>
                        <Trash2 className="size-4" />
                      </button>
                    )}
                    <span className="col-span-5 -mt-1 text-[11px] text-muted">{analyzeBarcode(b.barcode).format}{analyzeBarcode(b.barcode).checksumValid === false && <b className="text-red-600"> · clé de contrôle invalide</b>}</span>
                  </div>
                ))}
                {!p.barcodes.length && <p className="text-sm text-muted">Aucun code-barres.</p>}
                {editable && (
                  <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => set('barcodes', [...p.barcodes, { barcode: '', packaging: 'piece', qty_per_unit: 1, is_primary: !p.barcodes.length }])}>
                    Saisie manuelle
                  </Button>
                )}
              </div>
            </Card>
            <Card title="Prix (HT, en dinars — 3 décimales)">
              <div className="grid gap-3 sm:grid-cols-3">
                {(fin || isNew) && (
                  <Field label="Prix d'achat HT">
                    <MoneyInput value={p.purchase_price} onChange={(v) => set('purchase_price', v ?? 0)} disabled={!canPrices && !isNew} />
                  </Field>
                )}
                <Field label="Taux de TVA">
                  <Select value={p.vat_bp} onChange={(e) => set('vat_bp', Number(e.target.value))} disabled={!canPrices}>
                    {vatRates.map((r) => <option key={r} value={r}>{pct(r)}</option>)}
                  </Select>
                </Field>
                <Field label="Prix particulier HT" required>
                  <MoneyInput value={p.sale_price} onChange={(v) => set('sale_price', v ?? 0)} disabled={!canPrices} />
                </Field>
                <Field label="Prix particulier TTC" hint="Saisir le TTC recalcule le HT">
                  <MoneyInput value={priceTtc(p.sale_price, p.vat_bp)} onChange={(v) => set('sale_price', htFromTtc(v ?? 0, p.vat_bp))} disabled={!canPrices} />
                </Field>
                <Field label="Prix détaillant HT" hint="Vide = prix particulier">
                  <MoneyInput allowNull value={p.price_retail} onChange={(v) => set('price_retail', v)} disabled={!canPrices} />
                </Field>
                <Field label="Prix grossiste HT">
                  <MoneyInput allowNull value={p.price_wholesale} onChange={(v) => set('price_wholesale', v)} disabled={!canPrices} />
                </Field>
                <Field label="Prix distributeur HT">
                  <MoneyInput allowNull value={p.price_distributor} onChange={(v) => set('price_distributor', v)} disabled={!canPrices} />
                </Field>
              </div>
              {m && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <Badge color="blue">CMP {money(p.avg_cost || p.purchase_price)}</Badge>
                  <Badge color={m.margin >= 0 ? 'green' : 'red'}>Marge unitaire {money(m.margin)}</Badge>
                  <Badge color="gray">Taux de marge {pct(m.markup_bp)}</Badge>
                  <Badge color="gray">Taux de marque {pct(m.margin_bp)}</Badge>
                </div>
              )}
            </Card>
          </div>
          <div className="space-y-4">
            <Card title="Photo">
              <div className="flex flex-col items-center gap-2">
                {p.photo ? <img src={p.photo} alt="" className="max-h-48 rounded-lg object-contain" /> : <div className="flex h-32 w-full items-center justify-center rounded-lg bg-surface-2 text-muted"><ImagePlus className="size-8" /></div>}
                {editable && (
                  <div className="flex gap-2">
                    <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
                      Choisir…
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && set('photo', await resizeImage(e.target.files[0]))} />
                    </label>
                    {p.photo && <Button size="sm" variant="ghost" onClick={() => set('photo', null)}>Retirer</Button>}
                  </div>
                )}
              </div>
            </Card>
            <Card title="Stock et conditionnement">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Unité">
                  <Select value={p.unit} onChange={(e) => set('unit', e.target.value)} disabled={!editable}>
                    {['pièce', 'kg', 'litre', 'paquet', 'boîte', 'flacon', 'sachet', 'carton'].map((u) => <option key={u}>{u}</option>)}
                  </Select>
                </Field>
                <Field label="Conditionnement">
                  <Input value={p.packaging ?? ''} onChange={(e) => set('packaging', e.target.value)} placeholder="ex. 500 ml" disabled={!editable} />
                </Field>
                <Field label="Pièces par carton">
                  <Input type="number" min={1} value={p.units_per_carton ?? ''} onChange={(e) => set('units_per_carton', e.target.value ? Number(e.target.value) : null)} disabled={!editable} />
                </Field>
                <Field label="Stock minimum">
                  <Input type="number" min={0} value={p.min_stock} onChange={(e) => set('min_stock', Number(e.target.value))} disabled={!editable} />
                </Field>
                <Field label="Stock maximum">
                  <Input type="number" min={0} value={p.max_stock ?? ''} onChange={(e) => set('max_stock', e.target.value ? Number(e.target.value) : null)} disabled={!editable} />
                </Field>
              </div>
              <div className="mt-3 space-y-2">
                <Checkbox checked={p.track_batches} onChange={(v) => set('track_batches', v)} label="Gestion des lots et dates de péremption (FEFO)" />
                <Checkbox checked={p.is_favorite} onChange={(v) => set('is_favorite', v)} label="Produit favori (POS)" />
              </div>
              {isNew && can('stock.adjust') && (
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3">
                  <Field label="Stock initial" className="col-span-2">
                    <Input type="number" min={0} value={p.initial_stock} onChange={(e) => set('initial_stock', Number(e.target.value))} />
                  </Field>
                  {(p.track_batches || p.initial_batch_number) && (
                    <>
                      <Field label="N° de lot">
                        <Input value={p.initial_batch_number} onChange={(e) => set('initial_batch_number', e.target.value)} />
                      </Field>
                      <Field label="Péremption">
                        <Input type="date" value={p.initial_expires_at} onChange={(e) => set('initial_expires_at', e.target.value)} />
                      </Field>
                    </>
                  )}
                </div>
              )}
            </Card>
            {!isNew && (
              <Card title="Informations">
                <div className="space-y-1 text-xs text-muted">
                  <div>Créé le {dt(p.created_at)}</div>
                  <div>Modifié le {dt(p.updated_at)}</div>
                  {p.used_in_documents && <div className="text-amber-600">Utilisé dans des documents : suppression définitive impossible (archivage).</div>}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
      {tab === 'stock' && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Card title="Stock par dépôt" padded={false}>
            <DataTable rows={p.stock} rowKey={(r) => r.warehouse_id} columns={[{ key: 'warehouse_name', header: 'Dépôt' }, { key: 'quantity', header: 'Quantité', align: 'end' }]} />
          </Card>
          <Card title="Lots en stock (FEFO)" padded={false}>
            <DataTable
              rows={p.batches}
              empty="Aucun lot"
              columns={[
                { key: 'batch_number', header: 'Lot' },
                { key: 'expires_at', header: 'Péremption', render: (r) => r.expires_at ?? '—' },
                { key: 'remaining_qty', header: 'Restant', align: 'end' },
                { key: 'received_at', header: 'Réception', hideSm: true },
              ]}
            />
          </Card>
        </div>
      )}
      {tab === 'historique' && (
        <div className="mt-3 space-y-4">
          <Card title="Mouvements de stock" padded={false}>
            <DataTable
              rows={movements.data?.rows}
              loading={movements.loading}
              columns={[
                { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
                { key: 'type', header: 'Type', render: (r) => MOVE_TYPES[r.type] ?? r.type },
                { key: 'quantity', header: 'Qté', align: 'end', render: (r) => <span className={r.quantity > 0 ? 'text-green-600' : 'text-red-600'}>{r.quantity > 0 ? '+' : ''}{r.quantity}</span> },
                { key: 'stock_after', header: 'Stock après', align: 'end' },
                { key: 'doc_number', header: 'Document' },
                { key: 'user_name', header: 'Utilisateur', hideSm: true },
              ]}
            />
          </Card>
          {p.price_history?.length > 0 && (
            <Card title="Historique des prix" padded={false}>
              <DataTable
                rows={p.price_history}
                columns={[
                  { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
                  { key: 'field', header: 'Prix' },
                  { key: 'old_value', header: 'Ancien', align: 'end', render: (r) => (r.field === 'vat_bp' ? pct(r.old_value) : money(r.old_value)) },
                  { key: 'new_value', header: 'Nouveau', align: 'end', render: (r) => (r.field === 'vat_bp' ? pct(r.new_value) : money(r.new_value)) },
                  { key: 'user_name', header: 'Par' },
                  { key: 'reason', header: 'Motif' },
                ]}
              />
            </Card>
          )}
        </div>
      )}
      <CameraScanner open={camera} onClose={() => setCamera(false)} onScan={addBarcode} />
      <Modal open={!!dup} onClose={() => setDup(null)} title="Code-barres déjà utilisé" size="sm" footer={<><Button variant="outline" onClick={() => setDup(null)}>Fermer</Button><Button onClick={() => { nav(`/produits/${dup.id}`); setDup(null); window.location.reload(); }}>Ouvrir ce produit</Button></>}>
        <p className="text-sm">Ce code-barres appartient déjà au produit <b>{dup?.name}</b> ({dup?.reference}). Les doublons sont interdits dans le catalogue.</p>
      </Modal>
      <RefreshCw className="hidden" />
    </div>
  );
}
