import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { ConfirmProvider, Spinner, ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import Login from './pages/Login';
import { ForcePasswordChange } from './pages/Profile';
import type { Permission } from '../shared/permissions';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const POS = lazy(() => import('./pages/POS'));
const Sales = lazy(() => import('./pages/Sales'));
const SaleDetail = lazy(() => import('./pages/SaleDetail'));
const Quotes = lazy(() => import('./pages/Quotes'));
const QuoteForm = lazy(() => import('./pages/QuoteForm'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Deliveries = lazy(() => import('./pages/Deliveries'));
const Returns = lazy(() => import('./pages/Returns'));
const Products = lazy(() => import('./pages/Products'));
const ProductForm = lazy(() => import('./pages/ProductForm'));
const Categories = lazy(() => import('./pages/Categories'));
const Labels = lazy(() => import('./pages/Labels'));
const Stock = lazy(() => import('./pages/Stock'));
const Movements = lazy(() => import('./pages/Movements'));
const Inventories = lazy(() => import('./pages/Inventories'));
const InventoryDetail = lazy(() => import('./pages/InventoryDetail'));
const Batches = lazy(() => import('./pages/Batches'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const SupplierDetail = lazy(() => import('./pages/SupplierDetail'));
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders'));
const PurchaseOrderForm = lazy(() => import('./pages/PurchaseOrderForm'));
const Receipts = lazy(() => import('./pages/Receipts'));
const ReceiptForm = lazy(() => import('./pages/ReceiptForm'));
const ReceiptDetail = lazy(() => import('./pages/ReceiptDetail'));
const PurchaseInvoices = lazy(() => import('./pages/PurchaseInvoices'));
const SupplierReturns = lazy(() => import('./pages/SupplierReturns'));
const Customers = lazy(() => import('./pages/Customers'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail'));
const Receivables = lazy(() => import('./pages/Receivables'));
const Payables = lazy(() => import('./pages/Payables'));
const Cash = lazy(() => import('./pages/Cash'));
const Payments = lazy(() => import('./pages/Payments'));
const Expenses = lazy(() => import('./pages/Expenses'));
const Profitability = lazy(() => import('./pages/Profitability'));
const Reports = lazy(() => import('./pages/Reports'));
const Exports = lazy(() => import('./pages/Exports'));
const Documents = lazy(() => import('./pages/Documents'));
const Users = lazy(() => import('./pages/Users'));
const Roles = lazy(() => import('./pages/Roles'));
const Verification = lazy(() => import('./pages/Verification'));
const Audit = lazy(() => import('./pages/Audit'));
const Import = lazy(() => import('./pages/Import'));
const ScannerTestPage = lazy(() => import('./pages/ScannerTestPage'));
const Settings = lazy(() => import('./pages/Settings'));
const Backups = lazy(() => import('./pages/Backups'));
const Profile = lazy(() => import('./pages/Profile'));
const Print = lazy(() => import('./pages/Print'));
const Personnel = lazy(() => import('./pages/Personnel'));
const Pointage = lazy(() => import('./pages/Pointage'));
const Paie = lazy(() => import('./pages/Paie'));

function Guard({ perm, children }: { perm: Permission[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perm))
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
        <h2 className="text-lg font-semibold">Accès non autorisé</h2>
        <p className="mt-2 text-sm text-muted">Votre rôle ne permet pas d'accéder à cette page. Contactez l'administrateur.</p>
      </div>
    );
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  if (can('pos.use')) return <Navigate to="/pos" replace />;
  if (can('stock.view')) return <Navigate to="/stock" replace />;
  if (can('invoices.view')) return <Navigate to="/verification" replace />;
  return <Navigate to="/profil" replace />;
}

const R = (path: string, perm: Permission[], el: ReactNode) => <Route key={path} path={path} element={<Guard perm={perm}>{el}</Guard>} />;

function AppRoutes() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Login />;
  if (me.must_change_password) return <ForcePasswordChange />;
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/imprimer/:type/:id" element={<Print />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          {R('/pos', ['pos.use'], <POS />)}
          {R('/ventes', ['sales.view'], <Sales />)}
          {R('/ventes/:id', ['sales.view', 'invoices.view', 'pos.use'], <SaleDetail />)}
          {R('/factures/:id', ['sales.view', 'invoices.view'], <SaleDetail />)}
          {R('/devis', ['quotes.manage'], <Quotes kind="quote" />)}
          {R('/commandes', ['quotes.manage'], <Quotes kind="order" />)}
          {R('/devis/:id', ['quotes.manage'], <QuoteForm />)}
          {R('/factures', ['invoices.view'], <Invoices />)}
          {R('/livraisons', ['sales.view'], <Deliveries />)}
          {R('/retours', ['returns.manage', 'sales.cancel'], <Returns />)}
          {R('/produits', ['products.view'], <Products />)}
          {R('/produits/:id', ['products.view'], <ProductForm />)}
          {R('/categories', ['products.view'], <Categories />)}
          {R('/codes-barres', ['products.view'], <Labels />)}
          {R('/stock', ['stock.view'], <Stock />)}
          {R('/stock/mouvements', ['stock.view'], <Movements />)}
          {R('/stock/lots', ['stock.view'], <Batches />)}
          {R('/stock/alertes', ['stock.view'], <Alerts />)}
          {R('/inventaires', ['inventory.manage', 'inventory.validate'], <Inventories />)}
          {R('/inventaires/:id', ['inventory.manage', 'inventory.validate'], <InventoryDetail />)}
          {R('/fournisseurs', ['suppliers.view'], <Suppliers />)}
          {R('/fournisseurs/:id', ['suppliers.view'], <SupplierDetail />)}
          {R('/achats/commandes', ['purchases.view'], <PurchaseOrders />)}
          {R('/achats/commandes/:id', ['purchases.view', 'receipts.manage'], <PurchaseOrderForm />)}
          {R('/achats/receptions', ['receipts.manage', 'purchases.view'], <Receipts />)}
          {R('/achats/receptions/nouvelle', ['receipts.manage'], <ReceiptForm />)}
          {R('/achats/receptions/:id', ['receipts.manage', 'purchases.view'], <ReceiptDetail />)}
          {R('/achats/factures', ['purchases.manage'], <PurchaseInvoices />)}
          {R('/achats/retours', ['returns.manage', 'purchases.view'], <SupplierReturns />)}
          {R('/clients', ['customers.view'], <Customers />)}
          {R('/clients/:id', ['customers.view'], <CustomerDetail />)}
          {R('/creances', ['customers.view', 'finance.view'], <Receivables />)}
          {R('/dettes', ['purchases.manage'], <Payables />)}
          {R('/caisse', ['cash.use', 'cash.manage'], <Cash />)}
          {R('/paiements', ['payments.manage', 'finance.view'], <Payments />)}
          {R('/depenses', ['expenses.manage'], <Expenses />)}
          {R('/rentabilite', ['finance.view'], <Profitability />)}
          {R('/rapports-financiers', ['finance.view'], <Reports finance />)}
          {R('/rapports', ['reports.view'], <Reports />)}
          {R('/exports', ['reports.view', 'import.manage'], <Exports />)}
          {R('/documents', ['sales.view', 'invoices.view'], <Documents />)}
          {R('/utilisateurs', ['users.manage'], <Users />)}
          {R('/roles', ['users.manage'], <Roles />)}
          {R('/verification', ['invoices.view'], <Verification />)}
          {R('/audit', ['audit.view'], <Audit />)}
          {R('/import', ['import.manage'], <Import />)}
          {R('/scanner', ['products.view', 'pos.use', 'stock.view'], <ScannerTestPage />)}
          {R('/parametres', ['settings.manage'], <Settings />)}
          {R('/sauvegardes', ['backup.manage'], <Backups />)}
          {R('/personnel', ['hr.view', 'hr.manage', 'hr.attendance'], <Personnel />)}
          {R('/pointage', ['hr.attendance', 'hr.view'], <Pointage />)}
          {R('/paie', ['payroll.manage'], <Paie />)}
          <Route path="/profil" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
