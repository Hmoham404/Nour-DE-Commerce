import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, BadgePercent, Banknote, BarChart3, Bell, Boxes, Building2, CalendarClock, ChevronDown, ClipboardCheck, ClipboardList,
  CreditCard, Database, FileCheck2, FileSpreadsheet, FileText, FolderTree, HandCoins, History, Home, KeyRound, LayoutDashboard, LogOut, Menu, Moon,
  Package, PackageCheck, PackageMinus, PanelLeftClose, PanelLeftOpen, Receipt, RotateCcw, ScanBarcode, Search, Settings, ShieldCheck, ShoppingCart,
  Store, Sun, Truck, Undo2, Upload, User, Users, Wallet, WifiOff, X, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import { useDebounce, useOnline } from '../lib/hooks';
import { dt } from '../lib/format';
import type { Permission } from '../../shared/permissions';
import { FlagFR, FlagTN } from './Flags';
import { cx } from './ui';

interface Item {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission[];
}
interface Group {
  label: string;
  items: Item[];
}

export const MENU: Group[] = [
  { label: 'Accueil', items: [{ to: '/', label: 'Tableau de bord', icon: LayoutDashboard, perm: ['dashboard.view'] }] },
  {
    label: 'Commerce',
    items: [
      { to: '/pos', label: 'Point de vente POS', icon: ShoppingCart, perm: ['pos.use'] },
      { to: '/ventes', label: 'Ventes', icon: Receipt, perm: ['sales.view'] },
      { to: '/commandes', label: 'Commandes clients', icon: ClipboardList, perm: ['quotes.manage'] },
      { to: '/devis', label: 'Devis', icon: FileText, perm: ['quotes.manage'] },
      { to: '/factures', label: 'Factures', icon: FileCheck2, perm: ['invoices.view'] },
      { to: '/livraisons', label: 'Bons de livraison', icon: Truck, perm: ['sales.view'] },
      { to: '/retours', label: 'Retours clients', icon: Undo2, perm: ['returns.manage', 'sales.cancel'] },
    ],
  },
  {
    label: 'Catalogue et stock',
    items: [
      { to: '/produits', label: 'Produits', icon: Package, perm: ['products.view'] },
      { to: '/categories', label: 'Catégories', icon: FolderTree, perm: ['products.view'] },
      { to: '/codes-barres', label: 'Codes-barres', icon: ScanBarcode, perm: ['products.view'] },
      { to: '/stock', label: 'État du stock', icon: Boxes, perm: ['stock.view'] },
      { to: '/stock/mouvements', label: 'Mouvements', icon: ArrowLeftRight, perm: ['stock.view'] },
      { to: '/inventaires', label: 'Inventaires', icon: ClipboardCheck, perm: ['inventory.manage', 'inventory.validate'] },
      { to: '/stock/lots', label: 'Lots et péremptions', icon: CalendarClock, perm: ['stock.view'] },
      { to: '/stock/alertes', label: 'Alertes', icon: AlertTriangle, perm: ['stock.view'] },
    ],
  },
  {
    label: 'Achats',
    items: [
      { to: '/fournisseurs', label: 'Fournisseurs', icon: Building2, perm: ['suppliers.view'] },
      { to: '/achats/commandes', label: 'Commandes fournisseurs', icon: ClipboardList, perm: ['purchases.view'] },
      { to: '/achats/receptions', label: 'Réceptions', icon: PackageCheck, perm: ['receipts.manage', 'purchases.view'] },
      { to: '/achats/factures', label: 'Factures fournisseurs', icon: FileText, perm: ['purchases.manage'] },
      { to: '/achats/retours', label: 'Retours fournisseurs', icon: PackageMinus, perm: ['returns.manage', 'purchases.view'] },
    ],
  },
  {
    label: 'Relations commerciales',
    items: [
      { to: '/clients', label: 'Clients', icon: Users, perm: ['customers.view'] },
      { to: '/creances', label: 'Créances', icon: HandCoins, perm: ['customers.view', 'finance.view'] },
      { to: '/dettes', label: 'Dettes fournisseurs', icon: CreditCard, perm: ['purchases.manage'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { to: '/caisse', label: 'Caisse', icon: Wallet, perm: ['cash.use', 'cash.manage'] },
      { to: '/paiements', label: 'Paiements', icon: Banknote, perm: ['payments.manage', 'finance.view'] },
      { to: '/depenses', label: 'Dépenses', icon: Receipt, perm: ['expenses.manage'] },
      { to: '/rentabilite', label: 'Rentabilité', icon: BadgePercent, perm: ['finance.view'] },
      { to: '/rapports-financiers', label: 'Rapports financiers', icon: BarChart3, perm: ['finance.view'] },
    ],
  },
  {
    label: 'Rapports',
    items: [
      { to: '/rapports', label: 'Statistiques', icon: BarChart3, perm: ['reports.view'] },
      { to: '/exports', label: 'Exports Excel', icon: FileSpreadsheet, perm: ['reports.view', 'import.manage'] },
      { to: '/documents', label: 'Documents PDF', icon: FileText, perm: ['sales.view', 'invoices.view'] },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/utilisateurs', label: 'Utilisateurs', icon: User, perm: ['users.manage'] },
      { to: '/roles', label: 'Rôles et permissions', icon: KeyRound, perm: ['users.manage'] },
      { to: '/verification', label: 'Vérification des factures', icon: ShieldCheck, perm: ['invoices.view'] },
      { to: '/audit', label: "Journal d'audit", icon: History, perm: ['audit.view'] },
      { to: '/import', label: 'Importation / exportation', icon: Upload, perm: ['import.manage'] },
      { to: '/scanner', label: 'Configuration du scanner', icon: ScanBarcode, perm: ['products.view', 'pos.use', 'stock.view'] },
      { to: '/parametres', label: 'Paramètres', icon: Settings, perm: ['settings.manage'] },
      { to: '/sauvegardes', label: 'Sauvegardes', icon: Database, perm: ['backup.manage'] },
    ],
  },
];

/** Menu simplifié (par défaut) : seulement les écrans du quotidien. */
export const SIMPLE_MENU: Item[] = [
  { to: '/', label: 'Accueil', icon: Home, perm: ['dashboard.view'] },
  { to: '/pos', label: 'Vendre (caisse)', icon: ShoppingCart, perm: ['pos.use'] },
  { to: '/produits', label: 'Produits', icon: Package, perm: ['products.view'] },
  { to: '/stock', label: 'Stock', icon: Boxes, perm: ['stock.view'] },
  { to: '/achats/receptions', label: 'Réceptions', icon: PackageCheck, perm: ['receipts.manage', 'purchases.view'] },
  { to: '/inventaires', label: 'Inventaires', icon: ClipboardCheck, perm: ['inventory.manage', 'inventory.validate'] },
  { to: '/ventes', label: 'Ventes', icon: Receipt, perm: ['sales.view'] },
  { to: '/clients', label: 'Clients', icon: Users, perm: ['customers.view'] },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Building2, perm: ['suppliers.view'] },
  { to: '/caisse', label: 'Ma caisse', icon: Wallet, perm: ['cash.use', 'cash.manage'] },
  { to: '/depenses', label: 'Dépenses', icon: Banknote, perm: ['expenses.manage'] },
  { to: '/verification', label: 'Vérification des factures', icon: ShieldCheck, perm: ['invoices.verify'] },
  { to: '/rapports', label: 'Rapports', icon: BarChart3, perm: ['reports.view'] },
  { to: '/parametres', label: 'Paramètres', icon: Settings, perm: ['settings.manage'] },
];

function NavItem({ i, collapsed, onNavigate, big }: { i: Item; collapsed: boolean; onNavigate?: () => void; big?: boolean }) {
  const { t } = useI18n();
  return (
    <NavLink
      to={i.to}
      end={i.to === '/' || i.to === '/stock'}
      onClick={onNavigate}
      title={collapsed ? t(i.label) : undefined}
      className={({ isActive }) =>
        cx(
          'mx-2 flex items-center gap-3 rounded-lg px-3 transition',
          big ? 'py-2.5 text-[15px]' : 'py-2 text-sm',
          isActive ? 'bg-gold font-semibold text-navy' : 'text-white/85 hover:bg-white/10',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <i.icon className={big ? 'size-5 shrink-0' : 'size-[18px] shrink-0'} />
      {!collapsed && <span className="truncate">{t(i.label)}</span>}
    </NavLink>
  );
}

function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can } = useAuth();
  const { t } = useI18n();
  const [full, setFull] = useState(() => localStorage.getItem('ndc-full-menu') === '1');
  useEffect(() => localStorage.setItem('ndc-full-menu', full ? '1' : '0'), [full]);
  return (
    <nav className="flex h-full flex-col bg-navy text-white">
      <div className={cx('flex items-center justify-center bg-white', collapsed ? 'h-16 p-2' : 'h-20 px-4 py-3')}>
        {collapsed ? <img src="/icons/icon-192.png" alt="Nour de Commerce" className="size-10 rounded" /> : <img src="/logo-sm.png" alt="Nour de Commerce" className="max-h-14 w-auto" />}
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {!full && SIMPLE_MENU.filter((i) => can(...i.perm)).map((i) => <NavItem key={i.to} i={i} collapsed={collapsed} onNavigate={onNavigate} big />)}
        {full && MENU.map((g) => {
          const items = g.items.filter((i) => can(...i.perm));
          if (!items.length) return null;
          return (
            <div key={g.label} className="mb-1">
              {!collapsed && <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-gold/90">{t(g.label)}</div>}
              {items.map((i) => <NavItem key={i.to} i={i} collapsed={collapsed} onNavigate={onNavigate} />)}
            </div>
          );
        })}
      </div>
      <button onClick={() => setFull((f) => !f)} className="m-2 flex items-center justify-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:bg-white/10" title={t(full ? 'Menu simplifié' : 'Afficher tout le menu')}>
        <Menu className="size-4" />
        {!collapsed && t(full ? 'Menu simplifié' : 'Afficher tout le menu')}
      </button>
    </nav>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const nav = useNavigate();
  const { t } = useI18n();
  useEffect(() => {
    if (dq.trim().length < 2) return setRes([]);
    api.get(`/api/search?q=${encodeURIComponent(dq)}`).then(setRes).catch(() => setRes([]));
  }, [dq]);
  const labels: Record<string, string> = { product: 'Produit', customer: 'Client', supplier: 'Fournisseur', sale: 'Vente' };
  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={t('Recherche globale (produit, client, facture…)')}
        className="h-10 w-full rounded-lg border border-line bg-surface-2 ps-9 pe-3 text-sm outline-none focus:border-gold"
      />
      {open && res.length > 0 && (
        <div className="absolute inset-x-0 top-11 z-40 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          {res.map((r) => (
            <button
              key={r.type + r.id}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-surface-2"
              onMouseDown={() => {
                nav(r.link);
                setQ('');
                setOpen(false);
              }}
            >
              <span className="truncate">
                <b>{r.label}</b> <span className="text-muted">{r.sub}</span>
              </span>
              <span className="text-xs text-gold-600">{t(labels[r.type])}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsBell() {
  const [items, setItems] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { t } = useI18n();
  const load = () => api.get('/api/notifications').then(setItems).catch(() => {});
  useEffect(() => {
    load();
    const i = setInterval(load, 120000);
    return () => clearInterval(i);
  }, []);
  const unread = items.filter((i) => !i.is_read).length;
  const sev: Record<string, string> = { danger: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-blue-500', success: 'bg-green-500' };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 hover:bg-surface-2" aria-label={t('Notifications')}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute -end-0.5 -top-0.5 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-11 z-40 w-[min(92vw,360px)] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <b className="text-sm">{t('Notifications')}</b>
              <button className="text-xs text-gold-600 hover:underline" onClick={() => api.post('/api/notifications/read-all').then(load)}>
                {t('Tout marquer comme lu')}
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {!items.length && <p className="p-4 text-center text-sm text-muted">{t('Aucune notification')}</p>}
              {items.map((n) => (
                <button
                  key={n.id}
                  className={cx('flex w-full gap-2 border-b border-line px-3 py-2 text-start text-sm hover:bg-surface-2', !n.is_read && 'bg-gold/5')}
                  onClick={() => {
                    api.post(`/api/notifications/${n.id}/read`).then(load);
                    setOpen(false);
                    if (n.link) nav(n.link);
                  }}
                >
                  <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', sev[n.severity])} />
                  <span className="min-w-0">
                    <b className="block">{n.title}</b>
                    <span className="block text-muted">{n.message}</span>
                    <span className="text-[11px] text-muted">{dt(n.created_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const nav = useNavigate();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-gold font-bold text-navy">{me?.full_name?.[0]?.toUpperCase()}</span>
        <span className="hidden text-start text-xs leading-tight lg:block">
          <b className="block text-sm">{me?.full_name}</b>
          <span className="text-muted">{me?.role}</span>
        </span>
        <ChevronDown className="hidden size-4 lg:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute end-0 top-12 z-40 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-xl">
            <div className="border-b border-line px-3 py-2 text-xs text-muted">{me?.email}</div>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2" onClick={() => (setOpen(false), nav('/profil'))}>
              <User className="size-4" /> {t('Mon profil')}
            </button>
            <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-surface-2" onClick={logout}>
              <LogOut className="size-4" /> {t('Déconnexion')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function LangToggle({ className }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={cx('flex overflow-hidden rounded-lg border border-line', className)}>
      <button onClick={() => setLang('fr')} className={cx('flex items-center gap-1 px-2 py-1.5 text-xs font-semibold', lang === 'fr' ? 'bg-navy text-white' : 'hover:bg-surface-2')} title="Français">
        <FlagFR className="h-3 w-4.5 rounded-sm" /> FR
      </button>
      <button onClick={() => setLang('ar')} className={cx('flex items-center gap-1 px-2 py-1.5 text-xs font-semibold', lang === 'ar' ? 'bg-navy text-white' : 'hover:bg-surface-2')} title="العربية">
        <FlagTN className="h-3 w-4.5 rounded-sm" /> عربي
      </button>
    </div>
  );
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const { t } = useI18n();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ndc-theme', dark ? 'dark' : 'light');
  }, [dark]);
  return (
    <button onClick={() => setDark((d) => !d)} className="rounded-lg p-2 hover:bg-surface-2" title={t(dark ? 'Mode clair' : 'Mode sombre')}>
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}

export function Layout({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('ndc-collapsed') === '1');
  const [mobile, setMobile] = useState(false);
  const online = useOnline();
  const { t } = useI18n();
  const loc = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => localStorage.setItem('ndc-collapsed', collapsed ? '1' : '0'), [collapsed]);
  useEffect(() => {
    setMobile(false);
    main.current?.scrollTo(0, 0);
  }, [loc.pathname]);
  const fullBleed = loc.pathname === '/pos';

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className={cx('no-print hidden shrink-0 transition-all md:block', collapsed ? 'w-[72px]' : 'w-64')}>
        <Sidebar collapsed={collapsed} />
      </aside>
      {mobile && (
        <div className="no-print fixed inset-0 z-50 flex md:hidden">
          <div className="w-72 shadow-2xl">
            <Sidebar collapsed={false} onNavigate={() => setMobile(false)} />
          </div>
          <div className="flex-1 bg-black/50" onClick={() => setMobile(false)}>
            <button className="m-3 rounded-full bg-white p-2 text-navy" aria-label="Fermer">
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-4">
          <button className="rounded-lg p-2 hover:bg-surface-2 md:hidden" onClick={() => setMobile(true)} aria-label="Menu">
            <Menu className="size-5" />
          </button>
          <button className="hidden rounded-lg p-2 hover:bg-surface-2 md:block" onClick={() => setCollapsed((c) => !c)} aria-label="Menu">
            {collapsed ? <PanelLeftOpen className="size-5 rtl:rotate-180" /> : <PanelLeftClose className="size-5 rtl:rotate-180" />}
          </button>
          <Link to="/" className="md:hidden">
            <Home className="size-5 text-navy dark:text-gold" />
          </Link>
          <div className="hidden flex-1 sm:block">
            <GlobalSearch />
          </div>
          <div className="flex-1 sm:hidden" />
          {!online && (
            <span className="flex items-center gap-1 rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">
              <WifiOff className="size-4" /> <span className="hidden sm:inline">{t('Hors ligne')}</span>
            </span>
          )}
          <LangToggle />
          <ThemeToggle />
          <NotificationsBell />
          <ProfileMenu />
        </header>
        {!online && (
          <div className="no-print bg-red-600 px-4 py-1.5 text-center text-xs font-medium text-white">
            {t('Connexion Internet indisponible')} — aucune opération ne peut être validée tant que le serveur n'est pas joignable.
          </div>
        )}
        <main ref={main} className={cx('flex-1 overflow-y-auto', fullBleed ? 'p-2 sm:p-3' : 'p-3 sm:p-5')}>
          {children ?? <Outlet />}
          {!fullBleed && (
            <footer className="no-print mt-10 flex items-center justify-between border-t border-line pt-3 text-[11px] text-muted">
              <span>© {new Date().getFullYear()} Nour de Commerce</span>
              <span className="flex items-center gap-1">
                <Store className="size-3" /> Developed by <b className="text-gold-600">GM LAC</b>
              </span>
            </footer>
          )}
        </main>
      </div>
      <RotateCcw className="hidden" />
    </div>
  );
}
