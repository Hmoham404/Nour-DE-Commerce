import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { CUSTOMER_TYPES } from '../lib/format';
import { Button, ErrorBox, Field, Input, Modal, MoneyInput, Select, Textarea, useToast } from '../components/ui';

/** Formulaire client / fournisseur (création et modification). */
export function PartnerForm({ kind, open, onClose, initial, onSaved }: { kind: 'customers' | 'suppliers'; open: boolean; onClose: () => void; initial?: any; onSaved: (id: string) => void }) {
  const isCust = kind === 'customers';
  const blank = isCust
    ? { code: '', name: '', type: 'particulier', price_tier: null, phone: '', email: '', address: '', tax_id: '', credit_limit: 0, opening_balance: 0, payment_terms_days: 0, notes: '' }
    : { code: '', name: '', contact_name: '', phone: '', email: '', address: '', tax_id: '', opening_balance: 0, payment_terms_days: 0, notes: '' };
  const [f, setF] = useState<any>(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { can } = useAuth();
  const fin = can('finance.view', 'credit.override');
  useEffect(() => {
    if (open) {
      setF(initial ? { ...blank, ...initial } : blank);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body: any = { ...f };
      for (const k of ['phone', 'email', 'address', 'tax_id', 'notes', 'contact_name']) if (k in body) body[k] = body[k] || null;
      body.payment_terms_days = Number(body.payment_terms_days) || 0;
      for (const k of ['id', 'balance', 'is_active', 'created_at', 'updated_at', 'created_by', 'legacy_id', 'sales', 'payments', 'unpaid', 'prices', 'credit_exceeded', 'products', 'orders', 'receipts', 'invoices', 'total_purchases', 'total_paid', 'oldest_due', 'products_count']) delete body[k];
      if (!isCust) delete body.type;
      const r = initial?.id ? await api.put(`/api/${kind}/${initial.id}`, body) : await api.post(`/api/${kind}`, body);
      toast.success('Enregistré');
      onSaved(initial?.id ?? r.id);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`${initial?.id ? 'Modifier' : 'Nouveau'} ${isCust ? 'client' : 'fournisseur'}`} size="lg" footer={<><Button variant="outline" onClick={onClose}>Annuler</Button><Button loading={busy} onClick={save}>Enregistrer</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={isCust ? 'Nom ou raison sociale' : 'Raison sociale'} required className="sm:col-span-2">
          <Input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Code" hint="Automatique si vide">
          <Input value={f.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        {isCust ? (
          <>
            <Field label="Type">
              <Select value={f.type} onChange={(e) => set('type', e.target.value)}>
                {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Tarif applicable" hint="Par défaut : selon le type">
              <Select value={f.price_tier ?? ''} onChange={(e) => set('price_tier', e.target.value || null)}>
                <option value="">Selon le type</option>
                {Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </>
        ) : (
          <Field label="Nom du contact">
            <Input value={f.contact_name ?? ''} onChange={(e) => set('contact_name', e.target.value)} />
          </Field>
        )}
        <Field label="Téléphone">
          <Input type="tel" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Matricule fiscal">
          <Input value={f.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} />
        </Field>
        <Field label="Délai de paiement (jours)">
          <Input type="number" min={0} value={f.payment_terms_days} onChange={(e) => set('payment_terms_days', e.target.value)} />
        </Field>
        <Field label="Adresse" className="sm:col-span-2">
          <Input value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
        </Field>
        {(fin || !isCust) && (
          <>
            {isCust && (
              <Field label="Plafond de crédit" hint="0 = pas de plafond">
                <MoneyInput value={f.credit_limit} onChange={(v) => set('credit_limit', v ?? 0)} />
              </Field>
            )}
            <Field label="Solde initial" hint={isCust ? 'Montant dû par le client à la reprise' : 'Montant dû au fournisseur à la reprise'}>
              <MoneyInput value={f.opening_balance} onChange={(v) => set('opening_balance', v ?? 0)} />
            </Field>
          </>
        )}
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={f.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>
    </Modal>
  );
}
