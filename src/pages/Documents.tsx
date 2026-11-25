import { useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { dt, money } from '../lib/format';
import { openPrint } from '../components/common';
import { BarcodeInput } from '../components/scanner/BarcodeInput';
import { Button, Card, PageHeader, useToast } from '../components/ui';

/** Recherche d'un document par numéro et impression / PDF. */
export default function Documents() {
  const [sale, setSale] = useState<any | null>(null);
  const toast = useToast();
  const find = async (num: string) => {
    try {
      const r = await api.get(`/api/sales?q=${encodeURIComponent(num)}&from=2000-01-01&to=2100-12-31&pageSize=5`);
      const s = r.rows.find((x: any) => x.number === num || x.invoice_number === num) ?? r.rows[0];
      if (!s) return toast.error('Aucun document trouvé pour ce numéro');
      setSale(await api.get(`/api/sales/${s.id}`));
    } catch (e: any) {
      toast.error(e);
    }
  };
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Documents PDF" subtitle="Retrouver un ticket, une facture, un bon de livraison, un avoir ou un reçu" />
      <Card>
        <BarcodeInput onSubmit={find} placeholder="N° de ticket (TK-…) ou de facture (FAC-…), puis Entrée" />
        <p className="mt-2 text-xs text-muted">Pour les autres documents : devis et commandes (menu Commerce), bons de réception (Achats), relevés (fiche client / fournisseur), rapports de caisse (Caisse), inventaires (Inventaires).</p>
      </Card>
      {sale && (
        <Card className="mt-4" title={`${sale.number}${sale.invoice ? ' · ' + sale.invoice.number : ''}`}>
          <p className="mb-3 text-sm text-muted">{dt(sale.sale_date)} · {sale.customer_name ?? 'Client comptoir'} · {money(sale.total_ttc)}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('ticket', sale.id)}>Ticket 80 mm</Button>
            {sale.invoice && <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => openPrint('facture', sale.id)}>Facture A4</Button>}
            <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => openPrint('bl', sale.id)}>Bon de livraison</Button>
            <Button variant="outline" icon={<FileText className="size-4" />} onClick={() => openPrint('bon-sortie', sale.id)}>Bon de sortie de stock</Button>
            {sale.payments.map((p: any) => <Button key={p.id} variant="outline" onClick={() => openPrint('recu', p.id)}>Reçu {p.number}</Button>)}
            {sale.credit_notes.map((c: any) => <Button key={c.id} variant="outline" onClick={() => openPrint('avoir', c.id)}>Avoir {c.number}</Button>)}
          </div>
        </Card>
      )}
    </div>
  );
}
