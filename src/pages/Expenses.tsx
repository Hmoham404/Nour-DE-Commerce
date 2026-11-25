import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useFetch, usePeriod } from '../lib/hooks';
import { d, money, PAY_METHODS, todayTunis } from '../lib/format';
import { DataTable } from '../components/DataTable';
import { ExportButtons, PeriodFilter } from '../components/common';
import { Badge, Button, Card, Checkbox, Field, Input, Modal, MoneyInput, PageHeader, Select, Textarea, useConfirm, useToast } from '../components/ui';
import { ChartCard, Donut } from '../components/charts';

export default function Expenses() {
  const [period, setPeriod] = usePeriod('month');
  const [cat, setCat] = useState('');
  const { data, loading, reload } = useFetch<any>(`/api/expenses${qs({ from: period.from, to: period.to, category_id: cat })}`);
  const cats = useFetch<any[]>('/api/expense-categories');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ category_id: '', amount: 0, expense_date: todayTunis(), description: '', payment_method: 'cash', from_cash: true });
  const [newCat, setNewCat] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const total = (data?.rows ?? []).filter((r: any) => r.status === 'validated').reduce((s: number, r: any) => s + r.amount, 0);
  return (
    <div>
      <PageHeader
        title="Dépenses"
        actions={
          <>
            <ExportButtons filename="depenses" columns={[{ key: 'expense_date', label: 'Date', type: 'date' }, { key: 'number', label: 'N°' }, { key: 'category_name', label: 'Catégorie' }, { key: 'description', label: 'Description' }, { key: 'payment_method', label: 'Mode', value: (r) => PAY_METHODS[r.payment_method] }, { key: 'amount', label: 'Montant', type: 'money' }, { key: 'status', label: 'Statut' }]} getRows={() => data?.rows ?? []} />
            <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Nouvelle dépense</Button>
          </>
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <PeriodFilter value={period} onChange={setPeriod} />
        <Select className="h-9 w-auto" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Toutes catégories</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DataTable
            rows={data?.rows}
            loading={loading}
            footer={<tr><td colSpan={4} className="px-3 py-2">Total</td><td className="num px-3 py-2 text-end">{money(total)}</td><td /></tr>}
            columns={[
              { key: 'expense_date', header: 'Date', render: (r) => d(r.expense_date) },
              { key: 'category_name', header: 'Catégorie' },
              { key: 'description', header: 'Description' },
              { key: 'payment_method', header: 'Mode', hideSm: true, render: (r) => PAY_METHODS[r.payment_method] + (r.cash_session_id ? ' (caisse)' : '') },
              { key: 'amount', header: 'Montant', align: 'end', render: (r) => <span className={r.status === 'cancelled' ? 'line-through text-muted' : ''}>{money(r.amount)}</span> },
              { key: 'a', header: '', sortable: false, render: (r) => (r.status === 'cancelled' ? <Badge color="gray">Annulée</Badge> : <Button size="sm" variant="ghost" onClick={async () => {
                const reason = await confirm({ title: 'Annuler la dépense', reason: 'Motif', danger: true, message: r.cash_session_id ? 'Une contre-opération sera enregistrée dans votre caisse ouverte.' : undefined });
                if (!reason) return;
                try { await api.post(`/api/expenses/${r.id}/cancel`, { reason }); reload(); } catch (e: any) { toast.error(e); }
              }}>Annuler</Button>) },
            ]}
          />
        </div>
        <div className="space-y-4">
          <ChartCard title="Répartition par catégorie" empty={!data?.by_category?.length}>
            <Donut data={data?.by_category ?? []} valueKey="total" />
          </ChartCard>
          <Card title="Catégories de dépenses">
            <div className="flex gap-2">
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nouvelle catégorie" />
              <Button disabled={!newCat.trim()} onClick={async () => { await api.post('/api/expense-categories', { name: newCat }); setNewCat(''); cats.reload(); }}>Ajouter</Button>
            </div>
          </Card>
        </div>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle dépense" footer={<Button disabled={!f.category_id || !f.amount} onClick={async () => {
        try { await api.post('/api/expenses', { ...f, description: f.description || null }); toast.success('Dépense enregistrée'); setOpen(false); reload(); } catch (e: any) { toast.error(e); }
      }}>Enregistrer</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Catégorie" required>
            <Select value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
              <option value="">—</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Date"><Input type="date" value={f.expense_date} onChange={(e) => setF({ ...f, expense_date: e.target.value })} /></Field>
          <Field label="Montant" required><MoneyInput value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} /></Field>
          <Field label="Mode de paiement">
            <Select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value, from_cash: e.target.value === 'cash' && f.from_cash })}>
              {Object.entries(PAY_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
          {f.payment_method === 'cash' && <Checkbox checked={f.from_cash} onChange={(v) => setF({ ...f, from_cash: v })} label="Payée depuis ma caisse ouverte (sortie de caisse)" />}
        </div>
      </Modal>
    </div>
  );
}
