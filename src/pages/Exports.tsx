import { useState } from 'react';
import { Download, FileSpreadsheet, Save } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { exportCsv, exportExcel, type ExportColumn } from '../lib/exporters';
import { fetchAll } from '../components/common';
import { Button, Card, Checkbox, Field, Input, PageHeader, Select, useToast } from '../components/ui';

const DATASETS: Record<string, { label: string; url: string; columns: ExportColumn[] }> = {
  products: {
    label: 'Catalogue produits',
    url: '/api/products?status=all',
    columns: [
      { key: 'reference', label: 'reference' }, { key: 'barcode', label: 'barcode' }, { key: 'name', label: 'name' }, { key: 'category_name', label: 'category' }, { key: 'brand_name', label: 'brand' },
      { key: 'supplier_name', label: 'supplier' }, { key: 'purchase_price', label: 'purchase_price', type: 'money' }, { key: 'sale_price', label: 'sale_price', type: 'money' },
      { key: 'price_retail', label: 'price_retail', type: 'money' }, { key: 'price_wholesale', label: 'price_wholesale', type: 'money' }, { key: 'price_distributor', label: 'price_distributor', type: 'money' },
      { key: 'vat_bp', label: 'vat', type: 'percent' }, { key: 'unit', label: 'unit' }, { key: 'min_stock', label: 'min_stock', type: 'int' }, { key: 'stock', label: 'stock', type: 'int' },
    ],
  },
  customers: {
    label: 'Clients',
    url: '/api/customers?status=all',
    columns: [
      { key: 'code', label: 'code' }, { key: 'name', label: 'name' }, { key: 'type', label: 'type' }, { key: 'phone', label: 'phone' }, { key: 'email', label: 'email' }, { key: 'address', label: 'address' },
      { key: 'tax_id', label: 'tax_id' }, { key: 'credit_limit', label: 'credit_limit', type: 'money' }, { key: 'balance', label: 'balance', type: 'money' },
    ],
  },
  suppliers: {
    label: 'Fournisseurs',
    url: '/api/suppliers?status=all',
    columns: [
      { key: 'code', label: 'code' }, { key: 'name', label: 'name' }, { key: 'contact_name', label: 'contact_name' }, { key: 'phone', label: 'phone' }, { key: 'email', label: 'email' },
      { key: 'address', label: 'address' }, { key: 'tax_id', label: 'tax_id' }, { key: 'balance', label: 'balance', type: 'money' },
    ],
  },
};

/**
 * Exports configurables : choix des colonnes, renommage des en-têtes et séparateur,
 * afin de produire un fichier compatible avec l'ancien logiciel (profil mémorisé dans les paramètres).
 */
export default function Exports() {
  const { settings, reloadSettings, can } = useAuth();
  const toast = useToast();
  const [ds, setDs] = useState<keyof typeof DATASETS>('products');
  const saved = (() => {
    try {
      return JSON.parse(settings[`export_profile_${ds}`] ?? 'null');
    } catch {
      return null;
    }
  })();
  const [profile, setProfile] = useState<any>(null);
  const cur = profile?.ds === ds ? profile : saved ? { ...saved, ds } : { ds, sep: ';', decimal: ',', cols: DATASETS[ds].columns.map((c) => ({ key: c.key, header: c.label, on: true })) };
  const [busy, setBusy] = useState(false);
  const columns = (): ExportColumn[] =>
    cur.cols.filter((c: any) => c.on).map((c: any) => ({ ...DATASETS[ds].columns.find((x) => x.key === c.key)!, label: c.header }));

  const run = async (kind: 'xlsx' | 'csv') => {
    setBusy(true);
    try {
      const rows = await fetchAll(DATASETS[ds].url);
      if (kind === 'xlsx') await exportExcel(`export-${ds}`, columns(), rows);
      else exportCsv(`export-${ds}`, columns(), rows, cur.sep);
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Exports Excel" subtitle="Exports configurables — y compris un format compatible avec l'ancien logiciel" />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Données">
            <Select value={ds} onChange={(e) => (setDs(e.target.value as any), setProfile(null))}>
              {Object.entries(DATASETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Séparateur CSV">
            <Select value={cur.sep} onChange={(e) => setProfile({ ...cur, sep: e.target.value })}>
              <option value=";">Point-virgule ;</option>
              <option value=",">Virgule ,</option>
              <option value={'\t'}>Tabulation</option>
            </Select>
          </Field>
          <Button variant="outline" loading={busy} icon={<FileSpreadsheet className="size-4" />} onClick={() => run('xlsx')}>Excel</Button>
          <Button variant="outline" loading={busy} icon={<Download className="size-4" />} onClick={() => run('csv')}>CSV</Button>
          {can('settings.manage') && (
            <Button icon={<Save className="size-4" />} onClick={async () => {
              await api.put('/api/settings', { [`export_profile_${ds}`]: JSON.stringify(cur) }).catch(() => null);
              await reloadSettings();
              toast.success('Profil d’export enregistré');
            }}>Mémoriser ce profil</Button>
          )}
        </div>
        <table className="mt-4 w-full text-sm">
          <thead className="text-xs text-muted">
            <tr><th className="text-start">Inclure</th><th className="text-start">Champ</th><th className="text-start">Nom de colonne dans le fichier</th></tr>
          </thead>
          <tbody>
            {cur.cols.map((c: any, i: number) => (
              <tr key={c.key} className="border-t border-line">
                <td className="py-1"><Checkbox checked={c.on} onChange={(v) => setProfile({ ...cur, cols: cur.cols.map((x: any, j: number) => (j === i ? { ...x, on: v } : x)) })} label="" /></td>
                <td className="py-1 text-muted">{c.key}</td>
                <td className="py-1"><Input className="h-8" value={c.header} onChange={(e) => setProfile({ ...cur, cols: cur.cols.map((x: any, j: number) => (j === i ? { ...x, header: e.target.value } : x)) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Les montants sont exportés en dinars (3 décimales). La synchronisation directe avec l'ancien logiciel n'est pas activée tant que son nom, sa version et ses formats d'échange ne sont pas connus.
        </p>
      </Card>
    </div>
  );
}
