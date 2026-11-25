// Liste unique des permissions — utilisée par le backend (contrôle) et le frontend (affichage des menus).
export const PERMISSIONS = {
  'dashboard.view': 'Voir le tableau de bord',
  'finance.view': 'Voir les données financières sensibles (coûts, marges, bénéfices)',
  'products.view': 'Consulter les produits',
  'products.manage': 'Créer / modifier les produits',
  'products.delete': 'Archiver / supprimer les produits',
  'products.prices': 'Modifier les prix (y compris en masse)',
  'stock.view': 'Consulter le stock et les mouvements',
  'stock.adjust': 'Ajuster le stock (entrées/sorties manuelles, casse, périmés)',
  'inventory.manage': 'Réaliser des inventaires',
  'inventory.validate': 'Valider les inventaires (ajustements)',
  'suppliers.view': 'Consulter les fournisseurs',
  'suppliers.manage': 'Gérer les fournisseurs',
  'purchases.view': 'Consulter les achats',
  'purchases.manage': 'Gérer commandes et factures fournisseurs',
  'receipts.manage': 'Réceptionner les marchandises',
  'customers.view': 'Consulter les clients',
  'customers.manage': 'Gérer les clients',
  'pos.use': 'Utiliser le point de vente',
  'sales.view': 'Consulter les ventes',
  'sales.cancel': 'Annuler une vente (avoir)',
  'returns.manage': 'Gérer les retours clients / fournisseurs',
  'quotes.manage': 'Gérer devis et commandes clients',
  'discounts.override': 'Dépasser la remise maximale autorisée',
  'credit.override': 'Dépasser le plafond de crédit client',
  'invoices.view': 'Consulter les factures',
  'invoices.verify': 'Vérifier / signaler une anomalie sur les factures',
  'cash.use': 'Ouvrir / fermer sa caisse',
  'cash.manage': 'Superviser toutes les caisses et valider les clôtures',
  'payments.manage': 'Enregistrer des règlements',
  'expenses.manage': 'Enregistrer des dépenses',
  'reports.view': 'Consulter les rapports',
  'import.manage': 'Importer / exporter des données',
  'users.manage': 'Gérer les utilisateurs et les rôles',
  'settings.manage': 'Gérer les paramètres',
  'audit.view': "Consulter le journal d'audit",
  'backup.manage': 'Sauvegardes',
  'hr.view': 'Consulter le personnel',
  'hr.attendance': 'Saisir le pointage journalier',
  'hr.manage': 'Gérer le personnel (fiches, salaires, avances)',
  'payroll.manage': 'Calculer, valider et payer la paie',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: Record<string, { label: string; permissions: Permission[] }> = {
  admin: { label: 'Administrateur / Propriétaire', permissions: ALL_PERMISSIONS },
  magasinier: {
    label: 'Magasinier',
    permissions: ['products.view', 'stock.view', 'stock.adjust', 'inventory.manage', 'receipts.manage', 'purchases.view', 'suppliers.view', 'returns.manage', 'hr.attendance'],
  },
  caissier: {
    label: 'Caissier',
    permissions: ['pos.use', 'products.view', 'customers.view', 'customers.manage', 'sales.view', 'invoices.view', 'cash.use', 'payments.manage', 'quotes.manage'],
  },
  controleur: {
    label: 'Contrôleur à distance',
    permissions: ['dashboard.view', 'sales.view', 'invoices.view', 'reports.view', 'stock.view', 'products.view', 'customers.view'],
  },
};
