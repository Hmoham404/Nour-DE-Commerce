import { useNavigate } from 'react-router-dom';
import { useFetch } from '../lib/hooks';
import { DataTable } from '../components/DataTable';
import { Badge, Card, PageHeader, Spinner, Stat } from '../components/ui';

export default function Alerts() {
  const { data, loading } = useFetch<any>('/api/stock/alerts');
  const rot = useFetch<any>('/api/stock/low-rotation');
  const nav = useNavigate();
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const go = (r: any) => nav(`/produits/${r.product_id ?? r.id}`);
  return (
    <div>
      <PageHeader title="Alertes" subtitle="Stock minimum, ruptures, péremptions, anomalies de quantité, faible rotation" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Ruptures" value={data.out.length} tone={data.out.length ? 'red' : 'green'} />
        <Stat label="Stock faible" value={data.low.length} tone={data.low.length ? 'amber' : 'green'} />
        <Stat label={`Péremption < ${data.expiry_days} j`} value={data.expiring.length} tone={data.expiring.length ? 'amber' : 'green'} />
        <Stat label="Lots périmés" value={data.expired.length} tone={data.expired.length ? 'red' : 'green'} />
        <Stat label="Anomalies de quantité" value={data.anomalies.length} tone={data.anomalies.length ? 'red' : 'green'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Rupture de stock" padded={false}>
          <DataTable rows={data.out} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'reference', header: 'Référence' }, { key: 'stock', header: 'Stock', align: 'end', render: (r) => <Badge color="red">{String(r.stock)}</Badge> }]} />
        </Card>
        <Card title="Stock inférieur au minimum" padded={false}>
          <DataTable rows={data.low} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'stock', header: 'Stock', align: 'end' }, { key: 'min_stock', header: 'Minimum', align: 'end' }]} />
        </Card>
        <Card title="Péremption proche" padded={false}>
          <DataTable rows={data.expiring} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'batch_number', header: 'Lot' }, { key: 'expires_at', header: 'Péremption' }, { key: 'days_left', header: 'Jours', align: 'end' }, { key: 'remaining_qty', header: 'Qté', align: 'end' }]} />
        </Card>
        <Card title="Lots périmés encore en stock" padded={false}>
          <DataTable rows={data.expired} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'batch_number', header: 'Lot' }, { key: 'expires_at', header: 'Péremption' }, { key: 'remaining_qty', header: 'Qté', align: 'end' }]} />
        </Card>
        <Card title="Anomalies (quantité en lots > stock)" padded={false}>
          <DataTable rows={data.anomalies} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'batch_qty', header: 'Lots', align: 'end' }, { key: 'stock', header: 'Stock', align: 'end' }]} />
        </Card>
        <Card title={`Produits à faible rotation (aucune vente depuis ${rot.data?.days ?? 60} jours)`} padded={false}>
          <DataTable rows={rot.data?.rows} loading={rot.loading} onRowClick={go} columns={[{ key: 'name', header: 'Produit' }, { key: 'stock', header: 'Stock', align: 'end' }, { key: 'last_sale', header: 'Dernière vente', render: (r) => r.last_sale?.slice(0, 10) ?? 'Jamais' }]} />
        </Card>
      </div>
    </div>
  );
}
