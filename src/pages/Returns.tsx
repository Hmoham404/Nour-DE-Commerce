import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Printer, Undo2 } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch, usePeriod } from '../lib/hooks';
import { dt, money } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { openPrint, PeriodFilter } from '../components/common';
import { BarcodeInput } from '../components/scanner/BarcodeInput';
import { Badge, Button, Card, PageHeader, useToast } from '../components/ui';
import { ReturnModal } from './SaleDetail';

export default function Returns() {
  const [period, setPeriod] = usePeriod('month');
  const { data, loading, reload } = useFetch<any[]>(`/api/sales/credit-notes/list${qs({ from: period.from, to: period.to })}`);
  const [sale, setSale] = useState<any | null>(null);
  const toast = useToast();
  const nav = useNavigate();
  const find = async (num: string) => {
    try {
      const r = await api.get(`/api/sales?q=${encodeURIComponent(num)}&from=2000-01-01&to=2100-12-31&pageSize=5`);
      const s = r.rows.find((x: any) => x.number === num || x.invoice_number === num) ?? r.rows[0];
      if (!s) return toast.error('Vente introuvable');
      setSale(await api.get(`/api/sales/${s.id}`));
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <div>
      <PageHeader title="Retours clients" subtitle="Avoirs de retour et d'annulation" />
      <Card title="Nouveau retour" className="mb-4">
        <p className="mb-2 text-sm text-muted">Scannez ou saisissez le numéro du ticket (TK-…) ou de la facture (FAC-…).</p>
        <BarcodeInput onSubmit={find} placeholder="N° de ticket ou de facture" />
      </Card>
      <div className="mb-3">
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      <DataTable
        rows={data}
        loading={loading}
        onRowClick={(r) => nav(`/ventes/${r.sale_id}`)}
        columns={[
          { key: 'number', header: 'Avoir', render: (r) => <b className="num">{r.number}</b> },
          { key: 'kind', header: 'Type', render: (r) => (r.kind === 'return' ? <Badge color="amber">Retour</Badge> : <Badge color="red">Annulation</Badge>) },
          { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
          { key: 'sale_number', header: 'Vente' },
          { key: 'invoice_number', header: 'Facture', hideSm: true, render: (r) => r.invoice_number ?? '—' },
          { key: 'customer_name', header: 'Client', render: (r) => r.customer_name ?? 'Comptoir' },
          { key: 'reason', header: 'Motif', hideSm: true },
          { key: 'total_ttc', header: 'Montant', align: 'end', render: (r) => money(r.total_ttc) },
          { key: 'refund_amount', header: 'Remboursé', align: 'end', hideSm: true, render: (r) => money(r.refund_amount) },
          { key: 'p', header: '', sortable: false, render: (r) => <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={(e) => (e.stopPropagation(), openPrint('avoir', r.id))} /> },
        ]}
      />
      {sale && <ReturnModal open={!!sale} onClose={() => setSale(null)} sale={sale} onDone={reload} />}
      <Undo2 className="hidden" />
    </div>
  );
}
