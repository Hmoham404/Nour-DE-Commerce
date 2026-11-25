// Export Excel / CSV (SheetJS chargé à la demande) et impression PDF via le navigateur.
import { formatMoney } from '../../shared/money';
import { formatDateTime } from '../../shared/dates';

export interface ExportColumn {
  key: string;
  label: string;
  type?: 'money' | 'int' | 'date' | 'datetime' | 'percent' | 'text';
  value?: (row: any) => unknown;
}

function cell(row: any, c: ExportColumn): string | number {
  const v = c.value ? c.value(row) : row[c.key];
  if (v === null || v === undefined) return '';
  if (c.type === 'money') return Number(v) / 1000; // valeur numérique en TND (3 décimales) pour Excel
  if (c.type === 'percent') return Number(v) / 100;
  if (c.type === 'date') return formatDateTime(String(v), false);
  if (c.type === 'datetime') return formatDateTime(String(v), true);
  return v as any;
}

export async function exportExcel(filename: string, columns: ExportColumn[], rows: any[], sheet = 'Données') {
  const XLSX = await import('xlsx');
  const data = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => cell(r, c)))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, Math.min(40, c.label.length + 4)) }));
  // format 3 décimales pour les montants
  columns.forEach((c, ci) => {
    if (c.type !== 'money') return;
    for (let ri = 1; ri < data.length; ri++) {
      const ref = XLSX.utils.encode_cell({ r: ri, c: ci });
      if (ws[ref] && typeof ws[ref].v === 'number') ws[ref].z = '#,##0.000';
    }
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

export function exportCsv(filename: string, columns: ExportColumn[], rows: any[], sep = ';') {
  const esc = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.label)).join(sep), ...rows.map((r) => columns.map((c) => esc(cell(r, c))).join(sep))];
  download(filename.endsWith('.csv') ? filename : filename + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
}

export function download(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** Lecture d'un fichier Excel/CSV → tableau d'objets (en-têtes = 1re ligne). */
export async function readSpreadsheet(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: false, cellText: true, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // raw:false → les codes-barres restent du texte (zéros initiaux conservés si la cellule est au format texte)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

export async function downloadTemplate(entity: 'products' | 'customers' | 'suppliers') {
  const XLSX = await import('xlsx');
  const templates: Record<string, string[][]> = {
    products: [
      ['reference', 'name', 'barcode', 'category', 'brand', 'supplier', 'purchase_price', 'sale_price', 'price_retail', 'price_wholesale', 'price_distributor', 'vat', 'unit', 'min_stock', 'initial_stock', 'units_per_carton', 'legacy_id'],
      ['SAV-001', 'Savon liquide 500 ml', '6191234567897', 'Hygiène', 'Marque X', 'F00001', '1,200', '1,900', '1,800', '1,650', '', '19', 'pièce', '10', '48', '12', 'ANC-123'],
    ],
    customers: [
      ['code', 'name', 'type', 'phone', 'email', 'address', 'tax_id', 'credit_limit', 'opening_balance', 'payment_terms_days', 'legacy_id'],
      ['C00001', 'Épicerie El Amel', 'detaillant', '73 000 000', '', 'Moknine', '1234567/A/M/000', '2000', '0', '30', ''],
    ],
    suppliers: [
      ['code', 'name', 'contact_name', 'phone', 'email', 'address', 'tax_id', 'opening_balance', 'payment_terms_days', 'legacy_id'],
      ['F00001', 'Distributeur Sahel', 'M. Ali', '73 111 111', '', 'Sousse', '7654321/B/M/000', '0', '30', ''],
    ],
  };
  const ws = XLSX.utils.aoa_to_sheet(templates[entity]);
  // colonnes codes en texte
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Modèle');
  XLSX.writeFile(wb, `modele-import-${entity}.xlsx`);
}

export const moneyText = (v: number) => formatMoney(v, false);
