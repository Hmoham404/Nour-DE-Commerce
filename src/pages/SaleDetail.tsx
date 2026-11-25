import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, FileCheck2, HandCoins, Printer, Truck, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { dt, money, PAY_METHODS, PAYMENT_STATUS, pct, VERIF_STATUS } from '../lib/format';
import { openPrint } from '../components/common';
import { DataTable } from '../components/DataTable';
import { Badge, Button, Card, Checkbox, ErrorBox, Field, Input, Modal, MoneyInput, PageHeader, Select, Spinner, Textarea, useConfirm, useToast } from '../components/ui';

export default function SaleDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: s, loading, error, reload } = useFetch<any>(`/api/sales/${id}`);
  const [returnOpen, setReturnOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  if (loading && !s) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!s) return null;

  const cancel = async () => {
    const reason = await confirm({
      title: 'Annuler la vente',
      danger: true,
      confirmLabel: 'Annuler la vente',
      reason: 'Motif de l’annulation',
      message: (
        <p>
          Un <b>avoir</b> sera créé, le stock restitué{s.amount_paid > 0 ? ' et le montant encaissé remboursé depuis votre caisse' : ''}. La vente et la facture restent consultables (rien n'est supprimé).
        </p>
      ),
    });
    if (!reason) return;
    try {
      const r = await api.post(`/api/sales/${id}/cancel`, { reason, refund: true });
      toast.success(`Vente annulée — avoir ${r.credit_note.number}`);
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };
  const makeInvoice = async () => {
    if (!(await confirm({ title: 'Générer la facture', message: 'Le timbre fiscal sera ajouté au total si applicable.' }))) return;
    try {
      await api.post(`/api/sales/${id}/invoice`);
      toast.success('Facture créée');
      reload();
    } catch (e: any) {
      toast.error(e);
    }
  };
  const due = s.balance_due;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`Vente ${s.number}`}
        subtitle={`${dt(s.sale_date)} · ${s.cashier ?? ''}${s.session_number ? ' · ' + s.session_number : ''}`}
        actions={
          <>
            <Button variant="outline" icon={<ArrowLeft className="size-4 rtl:rotate-180" />} onClick={() => nav(-1)}>
              Retour
            </Button>
            <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('ticket', s.id)}>
              Ticket
            </Button>
            {s.invoice && (
              <Button variant="outline" icon={<Printer className="size-4" />} onClick={() => openPrint('facture', s.id)}>
                Facture
              </Button>
            )}
            <Button variant="outline" icon={<Truck className="size-4" />} onClick={() => openPrint('bl', s.id)}>
              Bon de livraison
            </Button>
            {s.status === 'completed' && !s.invoice && can('pos.use') && (
              <Button variant="outline" icon={<FileCheck2 className="size-4" />} onClick={makeInvoice}>
                Facturer
              </Button>
            )}
            {s.status === 'completed' && due > 0 && s.customer_id && can('payments.manage') && (
              <Button variant="success" icon={<HandCoins className="size-4" />} onClick={() => setPayOpen(true)}>
                Encaisser
              </Button>
            )}
            {s.status === 'completed' && can('returns.manage', 'sales.cancel') && (
              <Button variant="outline" icon={<Undo2 className="size-4" />} onClick={() => setReturnOpen(true)}>
                Retour
              </Button>
            )}
            {s.status === 'completed' && can('sales.cancel') && (
              <Button variant="danger" icon={<Ban className="size-4" />} onClick={cancel}>
                Annuler
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Client">
          <div className="space-y-1 text-sm">
            <div className="font-semibold">{s.customer_name ?? 'Client comptoir'}</div>
            {s.customer_code && <div className="text-muted">{s.customer_code}</div>}
            {s.customer_phone && <div>{s.customer_phone}</div>}
            {s.customer_address && <div>{s.customer_address}</div>}
            {s.customer_tax_id && <div>MF : {s.customer_tax_id}</div>}
            {s.customer_id && (
              <Button size="sm" variant="ghost" onClick={() => nav(`/clients/${s.customer_id}`)}>
                Voir la fiche client →
              </Button>
            )}
          </div>
        </Card>
        <Card title="Statut">
          <div className="flex flex-wrap gap-2">
            {s.status === 'cancelled' ? <Badge color="red">Annulée</Badge> : <Badge color="green">Validée</Badge>}
            <Badge color={PAYMENT_STATUS[s.payment_status][1]}>{PAYMENT_STATUS[s.payment_status][0]}</Badge>
            {s.invoice && <Badge color={VERIF_STATUS[s.invoice.verification_status][1]}>{`Facture ${s.invoice.number} · ${VERIF_STATUS[s.invoice.verification_status][0]}`}</Badge>}
          </div>
          {s.status === 'cancelled' && (
            <p className="mt-2 text-sm text-red-600">
              Annulée le {dt(s.cancelled_at)} — {s.cancel_reason}
            </p>
          )}
          {s.due_date && due > 0 && <p className="mt-2 text-sm">Échéance : {s.due_date}</p>}
        </Card>
        <Card title="Montants">
          <dl className="space-y-1 text-sm">
            <L k="Total HT" v={money(s.subtotal_ht)} />
            {s.discount_total > 0 && <L k="Remises" v={'−' + money(s.discount_total)} />}
            <L k="TVA" v={money(s.total_vat)} />
            {s.stamp > 0 && <L k="Timbre fiscal" v={money(s.stamp)} />}
            <L k="Total TTC" v={<b>{money(s.total_ttc)}</b>} />
            <L k="Payé" v={money(s.amount_paid)} />
            {s.credited_amount > 0 && <L k="Avoirs (retours)" v={'−' + money(s.credited_amount)} />}
            <L k="Reste à payer" v={<b className={due > 0 ? 'text-red-600' : ''}>{money(due)}</b>} />
            {can('finance.view') && s.cost_total !== null && <L k="Marge brute" v={money(s.subtotal_ht - s.cost_total)} />}
          </dl>
        </Card>
      </div>
      <div className="mt-4">
        <DataTable
          rows={s.items}
          columns={[
            { key: 'product_reference', header: 'Référence', hideSm: true },
            { key: 'product_name', header: 'Désignation' },
            { key: 'qty', header: 'Qté', align: 'end' },
            { key: 'returned_qty', header: 'Retourné', align: 'end', hideSm: true, render: (r) => r.returned_qty || '—' },
            { key: 'unit_price_ht', header: 'P.U. HT', align: 'end', render: (r) => money(r.unit_price_ht, false) },
            { key: 'discount_bp', header: 'Remise', align: 'end', render: (r) => (r.discount_bp ? pct(r.discount_bp) : '—') },
            { key: 'vat_bp', header: 'TVA', align: 'end', hideSm: true, render: (r) => pct(r.vat_bp) },
            { key: 'line_ttc', header: 'Total TTC', align: 'end', render: (r) => money(r.line_ttc) },
          ]}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Paiements" padded={false}>
          <DataTable
            rows={s.payments}
            empty="Aucun paiement"
            columns={[
              { key: 'number', header: 'N°' },
              { key: 'payment_date', header: 'Date', render: (r) => dt(r.payment_date) },
              { key: 'method', header: 'Mode', render: (r) => PAY_METHODS[r.method] },
              { key: 'allocated', header: 'Montant', align: 'end', render: (r) => money(r.allocated) },
              { key: 'p', header: '', render: (r) => <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => openPrint('recu', r.id)} /> },
            ]}
          />
        </Card>
        <Card title="Avoirs" padded={false}>
          <DataTable
            rows={s.credit_notes}
            empty="Aucun avoir"
            columns={[
              { key: 'number', header: 'N°' },
              { key: 'kind', header: 'Type', render: (r) => (r.kind === 'return' ? 'Retour' : 'Annulation') },
              { key: 'created_at', header: 'Date', render: (r) => dt(r.created_at) },
              { key: 'total_ttc', header: 'Montant', align: 'end', render: (r) => money(r.total_ttc) },
              { key: 'p', header: '', render: (r) => <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => openPrint('avoir', r.id)} /> },
            ]}
          />
        </Card>
      </div>
      <ReturnModal open={returnOpen} onClose={() => setReturnOpen(false)} sale={s} onDone={reload} />
      <CustomerPaymentModal open={payOpen} onClose={() => setPayOpen(false)} customerId={s.customer_id} saleIds={[s.id]} defaultAmount={due} onDone={reload} />
    </div>
  );
}

function L({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="num">{v}</dd>
    </div>
  );
}

export function ReturnModal({ open, onClose, sale, onDone }: { open: boolean; onClose: () => void; sale: any; onDone: () => void }) {
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [refund, setRefund] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const items = (sale?.items ?? []).filter((i: any) => i.qty > i.returned_qty);
  const estimate = items.reduce((s: number, i: any) => s + Math.round((i.line_ttc * (qtys[i.id] ?? 0)) / i.qty), 0);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/sales/${sale.id}/return`, {
        items: Object.entries(qtys).filter(([, q]) => q > 0).map(([sale_item_id, qty]) => ({ sale_item_id, qty })),
        reason,
        restock,
        refund_amount: refund ?? 0,
      });
      toast.success(`Avoir ${r.number} créé`);
      setQtys({});
      setReason('');
      onClose();
      onDone();
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Retour client — ${sale?.number}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button loading={busy} disabled={!estimate || reason.trim().length < 3} onClick={submit}>
            Créer l'avoir
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="text-start">Produit</th>
              <th className="text-end">Vendu</th>
              <th className="text-end">Déjà retourné</th>
              <th className="w-28 text-end">À retourner</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i: any) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-1.5">{i.product_name}</td>
                <td className="num text-end">{i.qty}</td>
                <td className="num text-end">{i.returned_qty}</td>
                <td className="text-end">
                  <Input type="number" min={0} max={i.qty - i.returned_qty} className="h-8 text-end" value={qtys[i.id] ?? 0} onChange={(e) => setQtys({ ...qtys, [i.id]: Math.min(i.qty - i.returned_qty, Math.max(0, Math.floor(Number(e.target.value)))) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="num text-end text-sm">
          Montant estimé de l'avoir : <b>{money(estimate)}</b>
        </div>
        <Field label="Motif" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Checkbox checked={restock} onChange={setRestock} label="Remettre les produits en stock (décocher si endommagés / périmés)" />
        <Field label="Remboursement en espèces (depuis votre caisse)" hint="0 = avoir déduit du solde du client">
          <MoneyInput value={refund} onChange={setRefund} />
        </Field>
      </div>
    </Modal>
  );
}

export function CustomerPaymentModal({ open, onClose, customerId, saleIds, defaultAmount, onDone }: { open: boolean; onClose: () => void; customerId: string; saleIds?: string[]; defaultAmount?: number; onDone: () => void }) {
  const [amount, setAmount] = useState<number | null>(defaultAmount ?? 0);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/payments/customer', { customer_id: customerId, sale_ids: saleIds, amount, method, reference });
      toast.success(`Règlement enregistré${r.advance > 0 ? ` (avance de ${money(r.advance)})` : ''}`);
      onClose();
      onDone();
      openPrint('recu', r.id);
    } catch (e: any) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Encaisser un règlement client"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="success" loading={busy} disabled={!amount} onClick={submit}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Montant">
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Mode de paiement">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(PAY_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence (n° chèque, virement…)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">Le montant est imputé sur {saleIds?.length ? 'la vente sélectionnée' : 'les ventes impayées les plus anciennes'} ; l'excédent reste en avance sur le compte du client.</p>
      </div>
    </Modal>
  );
}
