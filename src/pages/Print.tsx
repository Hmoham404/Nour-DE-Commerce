import { useEffect, useRef, useState, type ReactNode } from 'react';
import JsBarcode from 'jsbarcode';
import { TEST_CODES } from './ScannerTestPage';
import { useParams } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dt, money, pct, PAY_METHODS, CUSTOMER_TYPES, MOVE_TYPES } from '../lib/format';
import { amountInWords } from '../../shared/words';
import { Button, ErrorBox, Spinner } from '../components/ui';

/** Application de bureau : impression (directe si activée) ; navigateur : boîte d'impression standard. */
const printDoc = () => ((window as any).ndcDesktop?.print ? (window as any).ndcDesktop.print() : window.print());

/** Page d'impression : A4 (factures, bons, relevés…) ou ticket thermique 80 mm. Enregistrable en PDF via le navigateur. */
export default function Print() {
  const { type, id } = useParams();
  const { settings } = useAuth();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      switch (type) {
        case 'ticket': case 'facture': case 'bl': case 'bl-sans-prix': case 'bon-sortie':
          return api.get(`/api/sales/${id}`);
        case 'avoir': return api.get(`/api/sales/credit-notes/${id}`);
        case 'recu': return api.get(`/api/payments/${id}/detail`);
        case 'devis': return api.get(`/api/quotes/${id}`);
        case 'commande-fournisseur': return api.get(`/api/purchases/orders/${id}`);
        case 'bon-entree': return api.get(`/api/purchases/receipts/${id}`);
        case 'releve-client': return api.get(`/api/customers/${id}/statement`);
        case 'releve-fournisseur': return api.get(`/api/suppliers/${id}/statement`);
        case 'caisse': return api.get(`/api/cash/sessions/${id}`);
        case 'inventaire': return api.get(`/api/inventories/${id}`);
        case 'test-scanner': return { number: 'test' };
        case 'paie': return api.get(`/api/hr/payroll/${id}`);
        default: throw new Error('Type de document inconnu');
      }
    };
    load().then(setData).catch((e) => setError(e.message));
  }, [type, id]);

  useEffect(() => {
    if (!data) return;
    document.title = `${type}-${data.number ?? data.party?.code ?? id}`;
    if (type === 'ticket') document.body.classList.add('print-ticket');
    const t = setTimeout(printDoc, 500);
    return () => clearTimeout(t);
  }, [data, type, id]);

  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!data) return <Spinner />;

  const toolbar = (
    <div className="no-print sticky top-0 z-10 flex justify-center gap-2 border-b bg-white p-2">
      <Button icon={<Printer className="size-4" />} onClick={printDoc}>Imprimer / Enregistrer en PDF</Button>
      <Button variant="outline" icon={<X className="size-4" />} onClick={() => window.close()}>Fermer</Button>
    </div>
  );

  if (type === 'ticket') return <div className="min-h-dvh bg-white text-black">{toolbar}<Ticket s={data} settings={settings} /></div>;

  return (
    <div className="min-h-dvh bg-slate-100 text-black print:bg-white">
      {toolbar}
      <div className="print-area mx-auto my-4 w-[210mm] max-w-full bg-white p-[12mm] shadow print:my-0 print:p-0">
        <Doc type={type!} d={data} settings={settings} />
      </div>
    </div>
  );
}

function Header({ settings, title, number, date, right }: { settings: Record<string, string>; title: string; number?: string; date?: string; right?: ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b-2 border-[#0B2149] pb-3">
        <div>
          <img src="/logo-sm.png" alt="Nour de Commerce" className="h-14" />
          <div className="mt-1 text-[11px] leading-snug">
            <div className="font-semibold">{settings.company_name}</div>
            <div>{settings.company_activity}</div>
            <div>{[settings.company_address, settings.company_city].filter(Boolean).join(', ')}</div>
            <div>{[settings.company_phone && `Tél. ${settings.company_phone}`, settings.company_email].filter(Boolean).join(' · ')}</div>
            <div>{[settings.company_tax_id && `MF : ${settings.company_tax_id}`, settings.company_rc && `RC : ${settings.company_rc}`].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="text-end">
          <div className="text-2xl font-bold uppercase text-[#0B2149]">{title}</div>
          {number && <div className="num text-lg font-semibold">N° {number}</div>}
          {date && <div className="text-sm">Date : {date}</div>}
          {right}
        </div>
      </div>
    </>
  );
}

function PartyBox({ title, lines }: { title: string; lines: (string | null | undefined)[] }) {
  return (
    <div className="ms-auto mt-4 w-[48%] rounded border border-slate-400 p-2 text-sm">
      <div className="text-[10px] font-semibold uppercase text-slate-500">{title}</div>
      {lines.filter(Boolean).map((l, i) => <div key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</div>)}
    </div>
  );
}

const th = 'border border-slate-400 bg-[#0B2149] px-2 py-1 text-left text-[11px] font-semibold text-white';
const td = 'border border-slate-300 px-2 py-1 text-[12px]';
const tdn = td + ' num text-right';

function Totals({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <table className="ms-auto mt-3 w-[45%] text-sm">
      <tbody>
        {rows.map(([k, v, b]) => (
          <tr key={k} className={b ? 'bg-[#0B2149] font-bold text-white' : ''}>
            <td className="border border-slate-300 px-2 py-1">{k}</td>
            <td className="num border border-slate-300 px-2 py-1 text-right">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Footer({ settings, sign = true, text }: { settings: Record<string, string>; sign?: boolean; text?: string }) {
  return (
    <>
      {sign && (
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div className="h-24 rounded border border-dashed border-slate-400 p-2 text-slate-500">Cachet et signature du vendeur</div>
          <div className="h-24 rounded border border-dashed border-slate-400 p-2 text-slate-500">Signature du client / réceptionnaire</div>
        </div>
      )}
      <div className="mt-6 border-t border-slate-300 pt-2 text-center text-[10px] text-slate-500">
        {text ?? settings.invoice_footer} · {settings.company_name} · Developed by GM LAC
      </div>
    </>
  );
}

function vatBreakdown(items: any[]) {
  const m = new Map<number, { ht: number; vat: number }>();
  for (const i of items) {
    const x = m.get(i.vat_bp) ?? { ht: 0, vat: 0 };
    x.ht += i.line_ht;
    x.vat += i.line_vat;
    m.set(i.vat_bp, x);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

function TestBarcode({ code, format }: { code: string; format: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, code, { format, height: 70, width: 2.2, fontSize: 18, margin: 8 });
  }, [code, format]);
  return <svg ref={ref} />;
}

function Doc({ type, d, settings }: { type: string; d: any; settings: Record<string, string> }) {
  if (type === 'paie') {
    const period = `${d.period_type === 'week' ? 'Semaine' : 'Mois'} du ${dt(d.period_start)} au ${dt(d.period_end)}`;
    return (
      <div>
        <Header settings={settings} title="État de paie" number={d.number} date={period} />
        <table className="mt-4 w-full border-collapse">
          <thead><tr><th className={th}>Employé</th><th className={th + ' text-right'}>Présents</th><th className={th + ' text-right'}>Absences</th><th className={th + ' text-right'}>Salaire</th><th className={th + ' text-right'}>H. sup.</th><th className={th + ' text-right'}>Prime</th><th className={th + ' text-right'}>Avances</th><th className={th + ' text-right'}>Retenues</th><th className={th + ' text-right'}>Net</th><th className={th}>Signature</th></tr></thead>
          <tbody>
            {d.items.map((i: any) => (
              <tr key={i.id}><td className={td}>{i.full_name}</td><td className={tdn}>{i.days_present}</td><td className={tdn}>{i.days_absent}</td><td className={tdn}>{money(i.base_amount, false)}</td><td className={tdn}>{money(i.overtime_amount, false)}</td><td className={tdn}>{money(i.bonus, false)}</td><td className={tdn}>{money(i.advances, false)}</td><td className={tdn}>{money(i.deductions, false)}</td><td className={tdn + ' font-bold'}>{money(i.net_amount, false)}</td><td className={td + ' w-28'} /></tr>
            ))}
          </tbody>
        </table>
        <Totals rows={[['Total brut', money(d.total_gross)], ['Avances', money(d.total_advances)], ['Retenues', money(d.total_deductions)], ['Net total à payer', money(d.total_net), true]]} />
        <p className="mt-2 text-[11px] text-slate-500">Paie de gestion interne — ne remplace pas les déclarations sociales et fiscales.</p>
        {d.items.map((i: any) => (
          <div key={'r' + i.id} className="mt-8 rounded border border-slate-400 p-4 text-sm" style={{ breakBefore: 'page', breakInside: 'avoid' }}>
            <div className="flex items-start justify-between">
              <img src="/logo-sm.png" alt="" className="h-10" />
              <div className="text-end"><div className="text-lg font-bold text-[#0B2149]">REÇU DE SALAIRE</div><div>{d.number} · {period}</div></div>
            </div>
            <p className="mt-3">Employé : <b>{i.full_name}</b> {i.code && `(${i.code})`} {i.position && `— ${i.position}`} {i.cin && `— CIN ${i.cin}`}</p>
            <table className="mt-2 w-full border-collapse">
              <tbody>
                <tr><td className={td}>Jours présents</td><td className={tdn}>{i.days_present}</td><td className={td}>Absences</td><td className={tdn}>{i.days_absent}</td></tr>
                <tr><td className={td}>Salaire de la période</td><td className={tdn}>{money(i.base_amount)}</td><td className={td}>Heures supplémentaires</td><td className={tdn}>{money(i.overtime_amount)}</td></tr>
                <tr><td className={td}>Prime</td><td className={tdn}>{money(i.bonus)}</td><td className={td}>Avances déduites</td><td className={tdn}>−{money(i.advances)}</td></tr>
                <tr><td className={td}>Retenues</td><td className={tdn}>−{money(i.deductions)}</td><td className={td + ' font-bold'}>NET PAYÉ</td><td className={tdn + ' font-bold'}>{money(i.net_amount)}</td></tr>
              </tbody>
            </table>
            <p className="mt-2">Arrêté à la somme de : <b>{amountInWords(Math.max(0, i.net_amount))}</b>.</p>
            <div className="mt-6 grid grid-cols-2 gap-8"><div className="h-16 border-t border-slate-400 pt-1 text-xs text-slate-500">Signature de l'employeur</div><div className="h-16 border-t border-slate-400 pt-1 text-xs text-slate-500">Signature de l'employé (reçu)</div></div>
          </div>
        ))}
      </div>
    );
  }
  if (type === 'test-scanner') {
    const fmt: Record<string, string> = { 'EAN-13': 'EAN13', 'EAN-13 avec zéros initiaux': 'EAN13', 'EAN-8': 'EAN8', 'UPC-A': 'UPC', 'Code 128 (lettres et tiret)': 'CODE128' };
    return (
      <div>
        <Header settings={settings} title="Feuille de test scanner" date={new Date().toLocaleDateString('fr-FR')} />
        <p className="mt-4 text-sm">Ouvrez <b>Administration → Configuration du scanner</b>, cliquez dans le champ de test puis scannez chaque code. Le numéro affiché doit être <b>exactement</b> celui imprimé sous le code-barres.</p>
        <div className="mt-6 grid grid-cols-2 gap-8">
          {TEST_CODES.map((c) => (
            <div key={c.code} className="rounded border border-slate-300 p-3 text-center" style={{ breakInside: 'avoid' }}>
              <div className="mb-1 text-sm font-semibold">{c.label}</div>
              <TestBarcode code={c.code} format={fmt[c.label]} />
              <div className="mt-1 text-xs">☐ lu correctement</div>
            </div>
          ))}
        </div>
        <Footer settings={settings} sign={false} text="Feuille de test du lecteur code-barres" />
      </div>
    );
  }
  // ───── Facture / BL / bon de sortie (depuis une vente)
  if (['facture', 'bl', 'bl-sans-prix', 'bon-sortie'].includes(type)) {
    const inv = d.invoice;
    const prices = type !== 'bl-sans-prix' && type !== 'bon-sortie';
    const title = type === 'facture' ? (inv?.status === 'cancelled' ? 'Facture (annulée)' : 'Facture') : type === 'bon-sortie' ? 'Bon de sortie de stock' : 'Bon de livraison';
    const number = type === 'facture' ? inv?.number : d.number;
    const due = Math.max(0, d.total_ttc - d.credited_amount - d.amount_paid);
    return (
      <div>
        <Header settings={settings} title={title} number={number} date={dt(type === 'facture' ? inv?.invoice_date : d.sale_date)} right={type === 'facture' && <div className="text-xs">Réf. vente : {d.number}</div>} />
        <PartyBox title="Client" lines={[d.customer_name ?? 'Client comptoir', d.customer_code && `Code : ${d.customer_code}`, d.customer_address, d.customer_phone && `Tél. ${d.customer_phone}`, d.customer_tax_id && `MF : ${d.customer_tax_id}`]} />
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Réf.</th><th className={th}>Désignation</th><th className={th + ' text-right'}>Qté</th>
              {prices && <><th className={th + ' text-right'}>P.U. HT</th><th className={th + ' text-right'}>Remise</th><th className={th + ' text-right'}>TVA</th><th className={th + ' text-right'}>Total HT</th></>}
            </tr>
          </thead>
          <tbody>
            {d.items.map((i: any) => (
              <tr key={i.id}>
                <td className={td}>{i.product_reference}</td><td className={td}>{i.product_name}</td><td className={tdn}>{i.qty} {i.unit}</td>
                {prices && <><td className={tdn}>{money(i.unit_price_ht, false)}</td><td className={tdn}>{i.discount_bp ? pct(i.discount_bp) : ''}</td><td className={tdn}>{pct(i.vat_bp)}</td><td className={tdn}>{money(i.line_ht, false)}</td></>}
              </tr>
            ))}
          </tbody>
        </table>
        {prices && (
          <div className="flex items-start gap-4">
            <table className="mt-3 w-[45%] text-xs">
              <thead><tr><th className={th}>Taux TVA</th><th className={th + ' text-right'}>Base HT</th><th className={th + ' text-right'}>Montant TVA</th></tr></thead>
              <tbody>{vatBreakdown(d.items).map(([r, x]) => <tr key={r}><td className={td}>{pct(r)}</td><td className={tdn}>{money(x.ht, false)}</td><td className={tdn}>{money(x.vat, false)}</td></tr>)}</tbody>
            </table>
            <Totals rows={[
              ['Total brut HT', money(d.gross_ht)],
              ...(d.discount_total ? [['Remises', '−' + money(d.discount_total)] as [string, string]] : []),
              ['Total HT net', money(d.subtotal_ht)],
              ['Total TVA', money(d.total_vat)],
              ...(d.stamp ? [['Timbre fiscal', money(d.stamp)] as [string, string]] : []),
              ['Total TTC', money(d.total_ttc), true],
              ['Montant payé', money(d.amount_paid)],
              ...(d.credited_amount ? [['Avoirs', '−' + money(d.credited_amount)] as [string, string]] : []),
              ['Reste à payer', money(due)],
            ]} />
          </div>
        )}
        {prices && <p className="mt-3 text-sm">Arrêté(e) le présent document à la somme de : <b>{amountInWords(d.total_ttc)}</b>.</p>}
        {d.due_date && due > 0 && <p className="text-sm">Conditions de paiement : échéance le {d.due_date}.</p>}
        {d.payments?.length > 0 && prices && <p className="text-xs text-slate-600">Règlements : {d.payments.map((p: any) => `${PAY_METHODS[p.method]} ${money(p.allocated)} (${p.number})`).join(' · ')}</p>}
        <Footer settings={settings} />
      </div>
    );
  }
  // ───── Avoir
  if (type === 'avoir') {
    return (
      <div>
        <Header settings={settings} title="Avoir" number={d.number} date={dt(d.created_at)} right={<div className="text-xs">Sur vente {d.sale_number}{d.invoice_number ? ` / facture ${d.invoice_number}` : ''}</div>} />
        <PartyBox title="Client" lines={[d.customer_name ?? 'Client comptoir', d.customer_address, d.customer_tax_id && `MF : ${d.customer_tax_id}`]} />
        <p className="mt-3 text-sm">Motif : {d.reason} ({d.kind === 'return' ? 'retour de marchandises' : 'annulation de la vente'})</p>
        <table className="mt-3 w-full border-collapse">
          <thead><tr><th className={th}>Désignation</th><th className={th + ' text-right'}>Qté</th><th className={th + ' text-right'}>P.U. HT</th><th className={th + ' text-right'}>TVA</th><th className={th + ' text-right'}>Total HT</th></tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.id}><td className={td}>{i.product_name}</td><td className={tdn}>{i.qty}</td><td className={tdn}>{money(i.unit_price_ht, false)}</td><td className={tdn}>{pct(i.vat_bp)}</td><td className={tdn}>{money(i.line_ht, false)}</td></tr>)}</tbody>
        </table>
        <Totals rows={[['Total HT', money(d.total_ht)], ['TVA', money(d.total_vat)], ['Total avoir TTC', money(d.total_ttc), true], ['Remboursé en espèces', money(d.refund_amount)]]} />
        <p className="mt-3 text-sm">Montant de l'avoir : <b>{amountInWords(d.total_ttc)}</b>.</p>
        <Footer settings={settings} />
      </div>
    );
  }
  // ───── Reçu de paiement
  if (type === 'recu') {
    return (
      <div>
        <Header settings={settings} title={d.direction === 'in' ? 'Reçu de paiement' : 'Bon de décaissement'} number={d.number} date={dt(d.payment_date)} />
        <div className="mt-6 space-y-2 text-sm">
          <p>{d.direction === 'in' ? 'Reçu de' : 'Payé à'} : <b>{d.party_name ?? 'Client comptoir'}</b> {d.party_code && `(${d.party_code})`}</p>
          <p>La somme de : <b className="num text-lg">{money(d.amount)}</b></p>
          <p>Soit : <b>{amountInWords(d.amount)}</b></p>
          <p>Mode de paiement : {PAY_METHODS[d.method]} {d.reference && `— réf. ${d.reference}`}</p>
          {d.allocations?.length > 0 && <p>En règlement de : {d.allocations.map((a: any) => `${a.invoice_number ?? a.sale_number ?? a.pinvoice_number} (${money(a.amount)})`).join(', ')}</p>}
          {d.balance_after !== undefined && d.balance_after !== null && <p>Solde restant du compte : <b>{money(d.balance_after)}</b></p>}
          <p className="text-xs text-slate-500">Encaissé par {d.created_by_name}</p>
        </div>
        <Footer settings={settings} />
      </div>
    );
  }
  // ───── Devis / commande client
  if (type === 'devis') {
    return (
      <div>
        <Header settings={settings} title={d.kind === 'quote' ? 'Devis' : 'Bon de commande client'} number={d.number} date={dt(d.created_at)} right={d.valid_until && <div className="text-xs">Valable jusqu'au {d.valid_until}</div>} />
        <PartyBox title="Client" lines={[d.customer_display ?? d.customer_name, d.customer_address, d.customer_phone, d.customer_tax_id && `MF : ${d.customer_tax_id}`]} />
        <table className="mt-4 w-full border-collapse">
          <thead><tr><th className={th}>Réf.</th><th className={th}>Désignation</th><th className={th + ' text-right'}>Qté</th><th className={th + ' text-right'}>P.U. HT</th><th className={th + ' text-right'}>Remise</th><th className={th + ' text-right'}>Total HT</th></tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.id}><td className={td}>{i.reference}</td><td className={td}>{i.product_name}</td><td className={tdn}>{i.qty}</td><td className={tdn}>{money(i.unit_price_ht, false)}</td><td className={tdn}>{i.discount_bp ? pct(i.discount_bp) : ''}</td><td className={tdn}>{money(i.line_ht, false)}</td></tr>)}</tbody>
        </table>
        <Totals rows={[['Total HT', money(d.subtotal_ht)], ['TVA', money(d.total_vat)], ['Total TTC', money(d.total_ttc), true]]} />
        {d.notes && <p className="mt-3 text-sm">{d.notes}</p>}
        <Footer settings={settings} />
      </div>
    );
  }
  // ───── Commande fournisseur
  if (type === 'commande-fournisseur') {
    return (
      <div>
        <Header settings={settings} title="Bon de commande fournisseur" number={d.number} date={d.order_date} right={d.expected_date && <div className="text-xs">Livraison souhaitée : {d.expected_date}</div>} />
        <PartyBox title="Fournisseur" lines={[d.supplier_name, d.supplier_address, d.supplier_phone, d.supplier_tax_id && `MF : ${d.supplier_tax_id}`]} />
        <table className="mt-4 w-full border-collapse">
          <thead><tr><th className={th}>Réf.</th><th className={th}>Désignation</th><th className={th + ' text-right'}>Qté</th><th className={th + ' text-right'}>P.U. HT</th><th className={th + ' text-right'}>Total HT</th></tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.id}><td className={td}>{i.reference}</td><td className={td}>{i.product_name}</td><td className={tdn}>{i.qty_ordered}</td><td className={tdn}>{money(i.unit_price, false)}</td><td className={tdn}>{money(Math.round((i.unit_price * i.qty_ordered * (10000 - i.discount_bp)) / 10000), false)}</td></tr>)}</tbody>
        </table>
        <Totals rows={[['Total HT', money(d.total_ht)], ['TVA', money(d.total_vat)], ['Total TTC', money(d.total_ttc), true]]} />
        <Footer settings={settings} text="Merci de mentionner ce numéro de commande sur votre bon de livraison et votre facture." />
      </div>
    );
  }
  // ───── Bon d'entrée (réception)
  if (type === 'bon-entree') {
    return (
      <div>
        <Header settings={settings} title="Bon d'entrée de stock" number={d.number} date={dt(d.received_at)} right={d.supplier_doc_ref && <div className="text-xs">BL fournisseur : {d.supplier_doc_ref}</div>} />
        <PartyBox title="Fournisseur" lines={[d.supplier_name, d.supplier_address, d.supplier_tax_id && `MF : ${d.supplier_tax_id}`]} />
        <table className="mt-4 w-full border-collapse">
          <thead><tr><th className={th}>Réf.</th><th className={th}>Désignation</th><th className={th + ' text-right'}>Qté</th><th className={th}>Lot</th><th className={th}>Péremption</th>{d.total_ttc !== null && <th className={th + ' text-right'}>Total HT</th>}</tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.id}><td className={td}>{i.reference}</td><td className={td}>{i.product_name}</td><td className={tdn}>{i.qty}</td><td className={td}>{i.batch_number}</td><td className={td}>{i.expires_at}</td>{d.total_ttc !== null && <td className={tdn}>{money(i.line_ht, false)}</td>}</tr>)}</tbody>
        </table>
        {d.total_ttc !== null && <Totals rows={[['Total HT', money(d.total_ht)], ['TVA', money(d.total_vat)], ...(d.extra_costs ? [['Frais', money(d.extra_costs)] as [string, string]] : []), ['Total TTC', money(d.total_ttc + d.extra_costs), true]]} />}
        <p className="mt-3 text-xs">Réceptionné par {d.created_by_name} — dépôt {d.warehouse_name}</p>
        <Footer settings={settings} text="Bon d'entrée de stock" />
      </div>
    );
  }
  // ───── Relevés
  if (type === 'releve-client' || type === 'releve-fournisseur') {
    const p = d.party;
    const cust = type === 'releve-client';
    return (
      <div>
        <Header settings={settings} title={cust ? 'Relevé de compte client' : 'Relevé fournisseur'} date={dt(new Date().toISOString().slice(0, 19).replace('T', ' '))} />
        <PartyBox title={cust ? 'Client' : 'Fournisseur'} lines={[p.name, `Code : ${p.code}`, p.address, p.phone, p.tax_id && `MF : ${p.tax_id}`, cust && p.type ? CUSTOMER_TYPES[p.type] : null]} />
        <table className="mt-4 w-full border-collapse">
          <thead><tr><th className={th}>Date</th><th className={th}>Libellé</th><th className={th}>Référence</th><th className={th + ' text-right'}>{cust ? 'Débit' : 'Réglé'}</th><th className={th + ' text-right'}>{cust ? 'Crédit' : 'Dû'}</th><th className={th + ' text-right'}>Solde</th></tr></thead>
          <tbody>{d.lines.map((l: any, i: number) => <tr key={i}><td className={td}>{dt(l.date)}</td><td className={td}>{l.label}</td><td className={td}>{l.ref}</td><td className={tdn}>{l.debit ? money(l.debit, false) : ''}</td><td className={tdn}>{l.credit ? money(l.credit, false) : ''}</td><td className={tdn}>{money(l.balance, false)}</td></tr>)}</tbody>
        </table>
        <Totals rows={[[cust ? 'Solde dû par le client' : 'Solde dû au fournisseur', money(d.balance), true]]} />
        <Footer settings={settings} sign={false} />
      </div>
    );
  }
  // ───── Rapport de caisse
  if (type === 'caisse') {
    const TYPES: Record<string, string> = { opening: 'Fond initial', sale: 'Ventes', customer_payment: 'Règlements clients', supplier_payment: 'Règlements fournisseurs', expense: 'Dépenses', withdrawal: 'Décaissements', deposit: 'Apports', refund: 'Remboursements', correction: 'Corrections' };
    return (
      <div>
        <Header settings={settings} title="Rapport de caisse" number={d.number} date={dt(d.opened_at)} right={<div className="text-xs">{d.register_name} · {d.user_name}</div>} />
        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <p>Ouverture : {dt(d.opened_at)}</p>
            <p>Clôture : {dt(d.closed_at) || 'en cours'}</p>
            <p>Statut : {d.status === 'open' ? 'Ouverte' : d.status === 'closed' ? 'Clôturée' : `Validée par ${d.validated_by_name}`}</p>
            <p>Ventes de la session : {d.sales?.n ?? 0} — {money(d.sales?.ttc)}</p>
          </div>
          <Totals rows={[...(d.by_type ?? []).map((r: any) => [TYPES[r.type] ?? r.type, money(r.total)] as [string, string]), ['Solde théorique', money(d.expected_amount ?? d.expected_now), true], ...(d.counted_amount !== null ? [['Montant déclaré', money(d.counted_amount)] as [string, string], ['Écart', money(d.difference)] as [string, string]] : [])]} />
        </div>
        {d.justification && <p className="mt-2 text-sm">Justification de l'écart : {d.justification}</p>}
        <h3 className="mt-4 font-semibold">Détail des opérations</h3>
        <table className="mt-1 w-full border-collapse">
          <thead><tr><th className={th}>Heure</th><th className={th}>Type</th><th className={th}>Document</th><th className={th}>Motif</th><th className={th + ' text-right'}>Montant</th></tr></thead>
          <tbody>{d.movements.map((m: any) => <tr key={m.id}><td className={td}>{dt(m.created_at)}</td><td className={td}>{TYPES[m.type]}</td><td className={td}>{m.ref_number}</td><td className={td}>{m.reason}</td><td className={tdn}>{money(m.amount, false)}</td></tr>)}</tbody>
        </table>
        <Footer settings={settings} text="Rapport de clôture de caisse" />
      </div>
    );
  }
  // ───── Inventaire
  if (type === 'inventaire') {
    const gaps = d.items.filter((i: any) => i.difference !== 0);
    return (
      <div>
        <Header settings={settings} title="Rapport d'inventaire" number={d.number} date={dt(d.created_at)} right={<div className="text-xs">{d.warehouse_name}</div>} />
        <p className="mt-3 text-sm">{d.items.length} produit(s) comptés · {gaps.length} écart(s){d.items[0]?.value_diff !== null && ` · valeur des écarts ${money(d.items.reduce((s: number, i: any) => s + (i.value_diff ?? 0), 0))}`}</p>
        <table className="mt-3 w-full border-collapse">
          <thead><tr><th className={th}>Réf.</th><th className={th}>Produit</th><th className={th + ' text-right'}>Théorique</th><th className={th + ' text-right'}>Physique</th><th className={th + ' text-right'}>Écart</th></tr></thead>
          <tbody>{d.items.map((i: any) => <tr key={i.product_id} className={i.difference ? 'bg-amber-50' : ''}><td className={td}>{i.reference}</td><td className={td}>{i.name}</td><td className={tdn}>{i.theoretical_qty}</td><td className={tdn}>{i.counted_qty}</td><td className={tdn}>{i.difference > 0 ? '+' : ''}{i.difference}</td></tr>)}</tbody>
        </table>
        <Footer settings={settings} text="Rapport d'inventaire" />
      </div>
    );
  }
  return <p>Document inconnu</p>;
}

function Ticket({ s, settings }: { s: any; settings: Record<string, string> }) {
  const line = '-'.repeat(42);
  return (
    <div className="ticket mx-auto p-1">
      <style>{'@media print { @page { size: 80mm auto; margin: 2mm; } }'}</style>
      <div className="text-center">
        <img src="/logo-sm.png" alt="" className="mx-auto h-10 grayscale" />
        <div className="font-bold">{settings.company_name}</div>
        <div>{[settings.company_address, settings.company_city].filter(Boolean).join(', ')}</div>
        {settings.company_phone && <div>Tél. {settings.company_phone}</div>}
        {settings.company_tax_id && <div>MF {settings.company_tax_id}</div>}
      </div>
      <div>{line}</div>
      <div>Ticket : {s.number}</div>
      {s.invoice && <div>Facture : {s.invoice.number}</div>}
      <div>Date : {dt(s.sale_date)}</div>
      <div>Caissier : {s.cashier}</div>
      {s.customer_name && <div>Client : {s.customer_name}</div>}
      <div>{line}</div>
      {s.items.map((i: any) => (
        <div key={i.id}>
          <div>{i.product_name}</div>
          <div className="flex justify-between">
            <span>{i.qty} x {money(Math.round(i.line_ttc / i.qty), false)}{i.discount_bp ? ` (-${i.discount_bp / 100}%)` : ''}</span>
            <span>{money(i.line_ttc, false)}</span>
          </div>
        </div>
      ))}
      <div>{line}</div>
      <div className="flex justify-between"><span>Total HT</span><span>{money(s.subtotal_ht, false)}</span></div>
      <div className="flex justify-between"><span>TVA</span><span>{money(s.total_vat, false)}</span></div>
      {s.stamp > 0 && <div className="flex justify-between"><span>Timbre</span><span>{money(s.stamp, false)}</span></div>}
      <div className="flex justify-between text-base font-bold"><span>TOTAL TTC</span><span>{money(s.total_ttc)}</span></div>
      {s.payments.map((p: any) => <div key={p.id} className="flex justify-between"><span>{PAY_METHODS[p.method]}</span><span>{money(p.allocated, false)}</span></div>)}
      {s.total_ttc - s.amount_paid > 0 && <div className="flex justify-between font-bold"><span>Reste à payer</span><span>{money(s.total_ttc - s.amount_paid, false)}</span></div>}
      {s.status === 'cancelled' && <div className="text-center font-bold">*** VENTE ANNULÉE ***</div>}
      <div>{line}</div>
      <div className="text-center">{settings.ticket_footer}</div>
      <div className="text-center text-[10px]">Developed by GM LAC</div>
      <div className="hidden">{MOVE_TYPES.initial}</div>
    </div>
  );
}
