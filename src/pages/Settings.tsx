import { useEffect, useState } from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { CUSTOMER_TYPES, money, pct } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { EntitySelect } from '../components/common';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, MoneyInput, PageHeader, PercentInput, Select, Tabs, Textarea, useConfirm, useToast } from '../components/ui';

type Tab = 'company' | 'tax' | 'numbering' | 'stock' | 'sales' | 'discounts' | 'places' | 'printing' | 'hr' | 'demo';

export default function Settings() {
  const { settings, reloadSettings } = useAuth();
  const [tab, setTab] = useState<Tab>('company');
  const [s, setS] = useState<Record<string, string>>(settings);
  const toast = useToast();
  useEffect(() => setS(settings), [settings]);
  const set = (k: string, v: string) => setS((x) => ({ ...x, [k]: v }));
  const save = async (keys: string[]) => {
    try {
      await api.put('/api/settings', Object.fromEntries(keys.map((k) => [k, s[k] ?? ''])));
      await reloadSettings();
      toast.success('Paramètres enregistrés');
    } catch (e: any) {
      toast.error(e);
    }
  };
  const vatRates: number[] = (() => { try { return JSON.parse(s.vat_rates_bp ?? '[]'); } catch { return []; } })();

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Paramètres" subtitle="Les paramètres financiers et fiscaux doivent être validés par le propriétaire / son comptable avant l’utilisation réelle" />
      <Tabs
        tabs={[['company', 'Entreprise'], ['tax', 'TVA et timbre'], ['numbering', 'Numérotation'], ['stock', 'Stock et alertes'], ['sales', 'Ventes'], ['discounts', 'Règles de remise'], ['places', 'Dépôts et caisses'], ['printing', 'Imprimantes'], ['hr', 'Personnel'], ['demo', 'Données d’exemple']]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'company' && (
        <Card actions={<Button icon={<Save className="size-4" />} onClick={() => save(['company_name', 'company_activity', 'company_address', 'company_city', 'company_phone', 'company_email', 'company_tax_id', 'company_rc'])}>Enregistrer</Button>} title="Informations de l'entreprise (en-tête des documents)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Raison sociale"><Input value={s.company_name ?? ''} onChange={(e) => set('company_name', e.target.value)} /></Field>
            <Field label="Activité"><Input value={s.company_activity ?? ''} onChange={(e) => set('company_activity', e.target.value)} /></Field>
            <Field label="Adresse"><Input value={s.company_address ?? ''} onChange={(e) => set('company_address', e.target.value)} /></Field>
            <Field label="Ville"><Input value={s.company_city ?? ''} onChange={(e) => set('company_city', e.target.value)} /></Field>
            <Field label="Téléphone"><Input value={s.company_phone ?? ''} onChange={(e) => set('company_phone', e.target.value)} /></Field>
            <Field label="Email"><Input value={s.company_email ?? ''} onChange={(e) => set('company_email', e.target.value)} /></Field>
            <Field label="Matricule fiscal"><Input value={s.company_tax_id ?? ''} onChange={(e) => set('company_tax_id', e.target.value)} /></Field>
            <Field label="Registre de commerce"><Input value={s.company_rc ?? ''} onChange={(e) => set('company_rc', e.target.value)} /></Field>
            <Field label="Devise"><Input value="TND — dinar tunisien (3 décimales)" disabled /></Field>
            <Field label="Fuseau horaire"><Input value="Africa/Tunis" disabled /></Field>
          </div>
          <p className="mt-3 text-xs text-muted">Le logo Nour de Commerce est intégré à l'application et aux documents.</p>
        </Card>
      )}
      {tab === 'tax' && (
        <Card title="TVA et timbre fiscal" actions={<Button icon={<Save className="size-4" />} onClick={() => save(['default_vat_bp', 'vat_rates_bp', 'fiscal_stamp', 'fiscal_stamp_enabled'])}>Enregistrer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Taux de TVA disponibles (%)" hint="Séparés par des virgules, ex. 0, 7, 13, 19">
              <Input value={vatRates.map((r) => r / 100).join(', ')} onChange={(e) => set('vat_rates_bp', JSON.stringify(e.target.value.split(',').map((x) => Math.round(Number(x.trim().replace(',', '.')) * 100)).filter((x) => Number.isFinite(x) && x >= 0)))} />
            </Field>
            <Field label="Taux par défaut des nouveaux produits">
              <Select value={s.default_vat_bp} onChange={(e) => set('default_vat_bp', e.target.value)}>
                {vatRates.map((r) => <option key={r} value={r}>{pct(r)}</option>)}
              </Select>
            </Field>
            <Field label="Montant du timbre fiscal"><MoneyInput value={Number(s.fiscal_stamp ?? 0)} onChange={(v) => set('fiscal_stamp', String(v ?? 0))} /></Field>
            <div className="pt-6"><Checkbox checked={s.fiscal_stamp_enabled === '1'} onChange={(v) => set('fiscal_stamp_enabled', v ? '1' : '0')} label="Appliquer le timbre fiscal sur les factures de vente" /></div>
          </div>
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">À faire valider par votre comptable : taux applicables, mentions obligatoires, éventuelle facturation électronique (TEIF / El Fatoora).</p>
        </Card>
      )}
      {tab === 'numbering' && <Sequences />}
      {tab === 'stock' && (
        <Card title="Stock, péremption et alertes" actions={<Button icon={<Save className="size-4" />} onClick={() => save(['allow_negative_stock', 'block_expired_sales', 'expiry_alert_days', 'low_rotation_days'])}>Enregistrer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox checked={s.allow_negative_stock === '1'} onChange={(v) => set('allow_negative_stock', v ? '1' : '0')} label="Autoriser le stock négatif (déconseillé)" />
            <Checkbox checked={s.block_expired_sales !== '0'} onChange={(v) => set('block_expired_sales', v ? '1' : '0')} label="Bloquer la vente des produits périmés" />
            <Field label="Alerte de péremption (jours)">
              <Select value={s.expiry_alert_days} onChange={(e) => set('expiry_alert_days', e.target.value)}>
                {['7', '15', '30', '60'].map((d) => <option key={d} value={d}>{d} jours</option>)}
              </Select>
            </Field>
            <Field label="Faible rotation : aucune vente depuis (jours)"><Input type="number" min={7} value={s.low_rotation_days ?? '60'} onChange={(e) => set('low_rotation_days', e.target.value)} /></Field>
          </div>
          <p className="mt-3 text-xs text-muted">Le stock minimum se règle sur chaque fiche produit. Les alertes alimentent le centre de notifications (actualisé toutes les heures et à l'ouverture).</p>
        </Card>
      )}
      {tab === 'sales' && (
        <Card title="Ventes et documents" actions={<Button icon={<Save className="size-4" />} onClick={() => save(['default_max_discount_bp', 'invoice_footer', 'ticket_footer', 'remote_validation_enabled'])}>Enregistrer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Remise maximale par défaut (sans validation)" hint="Modifiable par utilisateur"><PercentInput value={Number(s.default_max_discount_bp ?? 0)} onChange={(v) => set('default_max_discount_bp', String(v))} /></Field>
            <div className="pt-6"><Checkbox checked={s.remote_validation_enabled === '1'} onChange={(v) => set('remote_validation_enabled', v ? '1' : '0')} label="Besoin de validation à distance confirmé par le propriétaire" /></div>
            <Field label="Pied de page des factures" className="sm:col-span-2"><Textarea value={s.invoice_footer ?? ''} onChange={(e) => set('invoice_footer', e.target.value)} /></Field>
            <Field label="Pied de page des tickets" className="sm:col-span-2"><Input value={s.ticket_footer ?? ''} onChange={(e) => set('ticket_footer', e.target.value)} /></Field>
          </div>
        </Card>
      )}
      {tab === 'discounts' && <DiscountRules />}
      {tab === 'hr' && (
        <Card title="Règles de paie" actions={<Button icon={<Save className="size-4" />} onClick={() => save(['hr_days_per_week', 'hr_days_per_month', 'hr_paid_leave_statuses'])}>Enregistrer</Button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jours ouvrés par semaine" hint="Sert au calcul des absences (paie à la semaine)"><Input type="number" min={1} max={7} value={s.hr_days_per_week ?? '6'} onChange={(e) => set('hr_days_per_week', e.target.value)} /></Field>
            <Field label="Jours ouvrés par mois" hint="Une absence = salaire mensuel ÷ ce nombre"><Input type="number" min={20} max={31} value={s.hr_days_per_month ?? '26'} onChange={(e) => set('hr_days_per_month', e.target.value)} /></Field>
            {(() => {
              let paid: string[] = [];
              try { paid = JSON.parse(s.hr_paid_leave_statuses ?? '[]'); } catch { /* */ }
              const toggle = (k: string, v: boolean) => set('hr_paid_leave_statuses', JSON.stringify(v ? [...new Set([...paid, k])] : paid.filter((x) => x !== k)));
              return (
                <div className="space-y-2 sm:col-span-2">
                  <span className="text-xs font-semibold text-muted">Journées payées (en plus de « présent »)</span>
                  <Checkbox checked={paid.includes('leave')} onChange={(v) => toggle('leave', v)} label="Congé payé" />
                  <Checkbox checked={paid.includes('holiday')} onChange={(v) => toggle('holiday', v)} label="Jour férié" />
                  <Checkbox checked={paid.includes('sick')} onChange={(v) => toggle('sick', v)} label="Maladie" />
                </div>
              );
            })()}
          </div>
        </Card>
      )}
      {tab === 'demo' && <DemoData />}
      {tab === 'places' && <Places />}
      {tab === 'printing' && (
        <Card title="Imprimantes">
          <ul className="list-disc space-y-2 ps-5 text-sm">
            <li><b>Factures, devis, bons (A4)</b> : boutons « Imprimer / PDF » → choisissez l'imprimante ou « Enregistrer au format PDF ».</li>
            <li><b>Tickets de caisse (80 mm)</b> : installez le pilote de l'imprimante thermique sous Windows, puis dans la fenêtre d'impression choisissez-la, format de papier 80 mm, marges « aucune ». Cochez « Mémoriser » dans Chrome pour imprimer plus vite.</li>
            <li><b>Étiquettes</b> : menu Codes-barres → format d'étiquette → impression.</li>
            <li>Impression silencieuse sans fenêtre (kiosque) : lancer Chrome avec l'option <code>--kiosk-printing</code> sur le poste de caisse.</li>
          </ul>
        </Card>
      )}
    </div>
  );
}

function DemoData() {
  const { data, reload } = useFetch<any>('/api/demo');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const run = async (load: boolean) => {
    if (!load && !(await confirm({ title: 'Supprimer les exemples', danger: true, message: 'Tous les enregistrements d’exemple seront supprimés. Vos données réelles ne sont pas touchées.' }))) return;
    setBusy(true);
    try {
      if (load) {
        const r = await api.post('/api/demo');
        toast.success(`${r.records} exemples ajoutés : produits, clients, fournisseur, vente, devis, dépense, personnel et pointage`);
      } else {
        const r = await api.del('/api/demo');
        toast.success(r.kept.length ? `Exemples supprimés. Conservés car réutilisés : ${r.kept.join(', ')}` : 'Exemples supprimés');
      }
      reload();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Données d’exemple">
      <p className="text-sm">
        Pour découvrir le logiciel, chargez un jeu d’exemples dans chaque module : 2 catégories, 6 produits avec codes-barres (dont un en rupture et un avec date de péremption), 1 fournisseur, 2 clients,
        1 règle de remise, 1 vente à crédit partiel, 1 devis, 1 dépense, 3 employés (payés au mois, à la journée et à la semaine) avec 6 jours de pointage et une avance.
      </p>
      <p className="mt-2 text-sm text-muted">Tous les exemples contiennent « exemple » dans leur nom. Ils se suppriment en un clic, sans toucher à vos données réelles.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {data?.loaded ? (
          <>
            <Badge color="gold">{`${Object.values(data.counts).reduce((a: number, b: any) => a + b, 0)} exemples chargés`}</Badge>
            <Button variant="danger" loading={busy} icon={<Trash2 className="size-4" />} onClick={() => run(false)}>Supprimer tous les exemples</Button>
          </>
        ) : (
          <Button variant="gold" loading={busy} icon={<Plus className="size-4" />} onClick={() => run(true)}>Ajouter les exemples</Button>
        )}
      </div>
    </Card>
  );
}

function Sequences() {
  const { data, reload } = useFetch<any[]>('/api/settings/sequences');
  const [edit, setEdit] = useState<any | null>(null);
  const toast = useToast();
  return (
    <Card title="Numérotation des documents" padded={false}>
      <DataTable
        rows={data}
        rowKey={(r) => r.doc_type}
        columns={[
          { key: 'label', header: 'Document' },
          { key: 'prefix', header: 'Préfixe' },
          { key: 'example', header: 'Prochain numéro', render: (r) => <span className="num">{r.prefix}{r.reset_yearly ? r.year + '-' : ''}{String(r.next_number).padStart(r.padding, '0')}</span> },
          { key: 'reset_yearly', header: 'Remise à zéro annuelle', render: (r) => (r.reset_yearly ? <Badge color="green">Oui</Badge> : 'Non') },
          { key: 'a', header: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r, reset_yearly: !!r.reset_yearly })} /> },
        ]}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.label} size="sm" footer={<Button onClick={async () => {
        try { await api.put(`/api/settings/sequences/${edit.doc_type}`, { prefix: edit.prefix, padding: Number(edit.padding), reset_yearly: edit.reset_yearly, next_number: Number(edit.next_number) }); setEdit(null); reload(); } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        {edit && (
          <div className="space-y-3">
            <Field label="Préfixe"><Input value={edit.prefix} onChange={(e) => setEdit({ ...edit, prefix: e.target.value })} /></Field>
            <Field label="Nombre de chiffres"><Input type="number" min={1} max={10} value={edit.padding} onChange={(e) => setEdit({ ...edit, padding: e.target.value })} /></Field>
            <Field label="Prochain numéro" hint="Ne peut pas reculer (unicité)"><Input type="number" min={1} value={edit.next_number} onChange={(e) => setEdit({ ...edit, next_number: e.target.value })} /></Field>
            <Checkbox checked={edit.reset_yearly} onChange={(v) => setEdit({ ...edit, reset_yearly: v })} label="Inclure l'année et repartir à 1 chaque année" />
          </div>
        )}
      </Modal>
    </Card>
  );
}

function DiscountRules() {
  const { data, reload } = useFetch<any[]>('/api/discount-rules');
  const cats = useFetch<any[]>('/api/categories');
  const [edit, setEdit] = useState<any | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const blank = { name: '', priority: 10, product_id: null, category_id: null, customer_type: null, min_qty: 0, min_amount: 0, discount_bp: 500, starts_at: '', ends_at: '', is_active: true };
  return (
    <Card title="Règles de remise (configurables — aucune valeur imposée)" padded={false} actions={<Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit(blank)}>Nouvelle règle</Button>}>
      <p className="px-4 pt-3 text-xs text-muted">Priorité : la règle de plus petit numéro s'applique ; à priorité égale, la plus forte remise. Le prix et la remise réellement appliqués sont enregistrés sur chaque ligne de vente.</p>
      <DataTable
        rows={data}
        columns={[
          { key: 'priority', header: 'Priorité', align: 'end' },
          { key: 'name', header: 'Règle', render: (r) => <b>{r.name}</b> },
          { key: 'scope', header: 'Portée', render: (r) => [r.product_name, r.category_name, r.customer_type && CUSTOMER_TYPES[r.customer_type]].filter(Boolean).join(' · ') || 'Tous produits / clients' },
          { key: 'cond', header: 'Conditions', render: (r) => [r.min_qty ? `≥ ${r.min_qty} pièces` : '', r.min_amount ? `≥ ${money(r.min_amount)}` : '', r.starts_at || r.ends_at ? `${r.starts_at ?? '…'} → ${r.ends_at ?? '…'}` : ''].filter(Boolean).join(' · ') || '—' },
          { key: 'discount_bp', header: 'Remise', align: 'end', render: (r) => pct(r.discount_bp) },
          { key: 'is_active', header: '', render: (r) => (r.is_active ? <Badge color="green">Active</Badge> : <Badge>Inactive</Badge>) },
          { key: 'a', header: '', sortable: false, render: (r) => (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => setEdit({ ...r, is_active: !!r.is_active, starts_at: r.starts_at ?? '', ends_at: r.ends_at ?? '' })} />
              <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-4" />} onClick={async () => { if (await confirm({ title: 'Supprimer la règle', danger: true })) { await api.del(`/api/discount-rules/${r.id}`); reload(); } }} />
            </div>
          ) },
        ]}
      />
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Règle de remise" footer={<Button disabled={!edit?.name} onClick={async () => {
        const body = { ...edit, starts_at: edit.starts_at || null, ends_at: edit.ends_at || null, customer_type: edit.customer_type || null, category_id: edit.category_id || null };
        for (const k of ['id', 'product_name', 'category_name', 'created_at', 'created_by']) delete body[k];
        try { edit.id ? await api.put(`/api/discount-rules/${edit.id}`, body) : await api.post('/api/discount-rules', body); setEdit(null); reload(); } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        {edit && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom" required className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ex. Grossistes 50 pièces et plus" /></Field>
            <Field label="Priorité (1 = la plus forte)"><Input type="number" min={1} value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} /></Field>
            <Field label="Remise"><PercentInput value={edit.discount_bp} onChange={(v) => setEdit({ ...edit, discount_bp: v })} /></Field>
            <Field label="Produit (facultatif)"><EntitySelect endpoint="/api/products" value={edit.product_id} label={edit.product_name} onChange={(v) => setEdit({ ...edit, product_id: v })} placeholder="Tous les produits" /></Field>
            <Field label="Catégorie (facultatif)">
              <Select value={edit.category_id ?? ''} onChange={(e) => setEdit({ ...edit, category_id: e.target.value })}>
                <option value="">Toutes</option>
                {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Type de client (facultatif)">
              <Select value={edit.customer_type ?? ''} onChange={(e) => setEdit({ ...edit, customer_type: e.target.value })}>
                <option value="">Tous</option>
                {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Quantité minimale"><Input type="number" min={0} value={edit.min_qty} onChange={(e) => setEdit({ ...edit, min_qty: Number(e.target.value) })} /></Field>
            <Field label="Montant de commande minimal"><MoneyInput value={edit.min_amount} onChange={(v) => setEdit({ ...edit, min_amount: v ?? 0 })} /></Field>
            <Field label="Début de promotion"><Input type="date" value={edit.starts_at} onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })} /></Field>
            <Field label="Fin de promotion"><Input type="date" value={edit.ends_at} onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })} /></Field>
            <Checkbox checked={edit.is_active} onChange={(v) => setEdit({ ...edit, is_active: v })} label="Règle active" />
          </div>
        )}
      </Modal>
    </Card>
  );
}

function Places() {
  const wh = useFetch<any[]>('/api/warehouses');
  const reg = useFetch<any[]>('/api/registers');
  const [name, setName] = useState({ wh: '', reg: '' });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Dépôts">
        {wh.data?.map((w) => <div key={w.id} className="border-b border-line py-1.5 text-sm">{w.name} {w.is_default ? <Badge color="gold">Par défaut</Badge> : null}</div>)}
        <div className="mt-3 flex gap-2"><Input value={name.wh} onChange={(e) => setName({ ...name, wh: e.target.value })} placeholder="Nouveau dépôt" /><Button disabled={!name.wh.trim()} onClick={async () => { await api.post('/api/warehouses', { name: name.wh }); setName({ ...name, wh: '' }); wh.reload(); }}>Ajouter</Button></div>
        <p className="mt-2 text-xs text-muted">Les transferts entre dépôts sont disponibles via l'API de stock (option multi-dépôts).</p>
      </Card>
      <Card title="Caisses">
        {reg.data?.map((r) => <div key={r.id} className="border-b border-line py-1.5 text-sm">{r.name}</div>)}
        <div className="mt-3 flex gap-2"><Input value={name.reg} onChange={(e) => setName({ ...name, reg: e.target.value })} placeholder="Nouvelle caisse" /><Button disabled={!name.reg.trim()} onClick={async () => { await api.post('/api/registers', { name: name.reg, warehouse_id: wh.data?.find((w) => w.is_default)?.id }); setName({ ...name, reg: '' }); reg.reload(); }}>Ajouter</Button></div>
      </Card>
    </div>
  );
}
