import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'fr' | 'ar';

// Interface rédigée en français ; traduction arabe (RTL). Les clés absentes restent en français.
const AR: Record<string, string> = {
  // Menu
  Accueil: 'الرئيسية', 'Tableau de bord': 'لوحة القيادة', Commerce: 'التجارة', 'Point de vente POS': 'نقطة البيع', Ventes: 'المبيعات',
  'Commandes clients': 'طلبيات الحرفاء', Devis: 'عروض الأسعار', Factures: 'الفواتير', 'Bons de livraison': 'وصولات التسليم', 'Retours clients': 'مرتجعات الحرفاء',
  'Catalogue et stock': 'الكتالوج والمخزون', Produits: 'المنتجات', Catégories: 'الأصناف', 'Codes-barres': 'الرموز الشريطية', 'État du stock': 'حالة المخزون',
  Mouvements: 'الحركات', Inventaires: 'الجرد', 'Lots et péremptions': 'الدفعات وتواريخ الصلاحية', Alertes: 'التنبيهات', Achats: 'المشتريات',
  Fournisseurs: 'المزودون', 'Commandes fournisseurs': 'طلبيات المزودين', Réceptions: 'الاستلامات', 'Factures fournisseurs': 'فواتير المزودين',
  'Retours fournisseurs': 'مرتجعات المزودين', 'Relations commerciales': 'العلاقات التجارية', Clients: 'الحرفاء', Créances: 'الديون لدى الحرفاء',
  'Dettes fournisseurs': 'ديون المزودين', Finance: 'المالية', Caisse: 'الصندوق', Paiements: 'الدفوعات', Dépenses: 'المصاريف', Rentabilité: 'المردودية',
  'Rapports financiers': 'التقارير المالية', Rapports: 'التقارير', Statistiques: 'الإحصائيات', 'Exports Excel': 'تصدير Excel', 'Documents PDF': 'وثائق PDF',
  Administration: 'الإدارة', Utilisateurs: 'المستخدمون', 'Rôles et permissions': 'الأدوار والصلاحيات', 'Vérification des factures': 'التحقق من الفواتير',
  "Journal d'audit": 'سجل العمليات', 'Importation / exportation': 'الاستيراد / التصدير', 'Configuration du scanner': 'إعداد القارئ', Paramètres: 'الإعدادات',
  Sauvegardes: 'النسخ الاحتياطية', 'Mon profil': 'ملفي الشخصي',
  // Commun
  Rechercher: 'بحث', 'Rechercher…': 'بحث…', 'Recherche globale (produit, client, facture…)': 'بحث شامل (منتج، حريف، فاتورة…)', Ajouter: 'إضافة', Modifier: 'تعديل',
  Supprimer: 'حذف', Enregistrer: 'حفظ', Annuler: 'إلغاء', Fermer: 'إغلاق', Valider: 'تأكيد', Confirmer: 'تأكيد', Retour: 'رجوع', Imprimer: 'طباعة', Exporter: 'تصدير',
  Importer: 'استيراد', Actions: 'إجراءات', Détails: 'التفاصيل', Statut: 'الحالة', Date: 'التاريخ', Total: 'المجموع', Quantité: 'الكمية', Prix: 'السعر',
  Désignation: 'التسمية', Référence: 'المرجع', Client: 'الحريف', Fournisseur: 'المزود', Montant: 'المبلغ', Motif: 'السبب', Notes: 'ملاحظات', Oui: 'نعم', Non: 'لا',
  Chargement: 'جار التحميل', 'Chargement…': 'جار التحميل…', 'Aucune donnée': 'لا توجد بيانات', Précédent: 'السابق', Suivant: 'التالي', Page: 'صفحة', sur: 'من',
  Notifications: 'الإشعارات', 'Tout marquer comme lu': 'تعليم الكل كمقروء', 'Aucune notification': 'لا توجد إشعارات', Déconnexion: 'تسجيل الخروج',
  'Mode sombre': 'الوضع الداكن', 'Mode clair': 'الوضع الفاتح', 'Hors ligne': 'غير متصل', 'Connexion Internet indisponible': 'الإنترنت غير متوفر',
  "Aujourd'hui": 'اليوم', Hier: 'أمس', 'Cette semaine': 'هذا الأسبوع', 'Ce mois': 'هذا الشهر', 'Cette année': 'هذه السنة', 'Période personnalisée': 'فترة مخصصة',
  Du: 'من', Au: 'إلى', Nouveau: 'جديد', Nouvelle: 'جديدة', Tous: 'الكل', Actif: 'نشط', Archivé: 'مؤرشف', Archiver: 'أرشفة', Restaurer: 'استرجاع',
  // Connexion
  Connexion: 'تسجيل الدخول', 'Se connecter': 'دخول', Email: 'البريد الإلكتروني', 'Mot de passe': 'كلمة المرور', 'Mot de passe oublié ?': 'نسيت كلمة المرور؟',
  // Dashboard
  "Chiffre d'affaires du jour": 'رقم معاملات اليوم', "Chiffre d'affaires du mois": 'رقم معاملات الشهر', "Chiffre d'affaires de l'année": 'رقم معاملات السنة',
  "Chiffre d'affaires HT": 'رقم المعاملات دون أداءات', 'Chiffre d’affaires (période)': 'رقم المعاملات (الفترة)', 'Total des achats': 'مجموع المشتريات',
  'Total des dépenses': 'مجموع المصاريف', 'Marge brute': 'الهامش الإجمالي', 'Résultat commercial estimé': 'النتيجة التجارية التقديرية', 'Valeur du stock': 'قيمة المخزون',
  'Nombre de produits': 'عدد المنتجات', 'Produits en rupture': 'منتجات نفدت', 'Stock faible': 'مخزون منخفض', 'Nombre de ventes': 'عدد المبيعات',
  'Nombre de factures': 'عدد الفواتير', 'Créances clients': 'ديون الحرفاء', 'Solde de caisse': 'رصيد الصندوق', 'Proches de la péremption': 'قريبة من انتهاء الصلاحية',
  Encaissements: 'المقبوضات', 'Évolution quotidienne des ventes': 'التطور اليومي للمبيعات', "Évolution mensuelle du chiffre d'affaires": 'التطور الشهري لرقم المعاملات',
  'Achats vs ventes': 'المشتريات مقابل المبيعات', 'Ventes par catégorie': 'المبيعات حسب الصنف', 'Top 10 produits': 'أفضل 10 منتجات', 'Top 10 clients': 'أفضل 10 حرفاء',
  'Évolution de la marge': 'تطور الهامش', 'Répartition des paiements': 'توزيع الدفوعات', 'Évolution de la valeur du stock': 'تطور قيمة المخزون',
  'Factures à vérifier': 'فواتير للتحقق', 'Vue d’ensemble': 'نظرة عامة', Marge: 'الهامش', 'Taux de marque': 'نسبة الهامش', 'Taux de marge': 'نسبة الربح',
  // POS
  Panier: 'السلة', 'Scanner ou rechercher un produit…': 'امسح أو ابحث عن منتج…', 'Sous-total HT': 'المجموع الفرعي دون أداءات', TVA: 'الأداء على القيمة المضافة',
  'Total TTC': 'المجموع بكل الأداءات', 'Montant payé': 'المبلغ المدفوع', 'Reste à payer': 'الباقي للدفع', 'Monnaie à rendre': 'الباقي للإرجاع', Remise: 'التخفيض',
  'Client comptoir': 'حريف عابر', 'Mettre en attente': 'تعليق البيع', 'Ventes en attente': 'مبيعات معلقة', 'Vider le panier': 'إفراغ السلة', Espèces: 'نقدا',
  Carte: 'بطاقة', Chèque: 'صك', Virement: 'تحويل', Autre: 'أخرى', 'Paiement différé': 'دفع مؤجل', 'Générer la facture': 'إصدار فاتورة', 'Valider la vente': 'تأكيد البيع',
  'Vente validée': 'تم تأكيد البيع', 'Stock disponible': 'المخزون المتوفر', Favoris: 'المفضلة', 'Ouvrir la caisse': 'فتح الصندوق', 'Fermer la caisse': 'غلق الصندوق',
  'Lecture réussie': 'قراءة ناجحة', 'Code inconnu': 'رمز غير معروف', 'Scanner prêt': 'القارئ جاهز', Caméra: 'الكاميرا',
  'HT net des retours': 'دون أداءات، صافي المرتجعات', HT: 'دون أداءات', 'Au coût moyen pondéré': 'بالتكلفة المتوسطة المرجحة', 'Caisses ouvertes': 'الصناديق المفتوحة',
  'Argent reçu des clients (période)': 'المبالغ المقبوضة من الحرفاء (الفترة)', 'Réceptions HT (période)': 'الاستلامات دون أداءات (الفترة)', 'Marge brute − dépenses': 'الهامش الإجمالي − المصاريف',
  'Valider la vente —': 'تأكيد البيع —', Tableau: 'جدول', Autres: 'أخرى', Aucun: 'لا شيء', 'Montant reçu': 'المبلغ المستلم', 'Timbre fiscal': 'الطابع الجبائي',
  'Vendre (caisse)': 'البيع (الصندوق)', Stock: 'المخزون', 'Ma caisse': 'صندوقي', 'Afficher tout le menu': 'عرض القائمة الكاملة', 'Menu simplifié': 'قائمة مبسطة',
  'Ventes du jour': 'مبيعات اليوم', 'Argent encaissé aujourd’hui': 'المبالغ المقبوضة اليوم', 'Produits à commander': 'منتجات يجب طلبها',
  'Les 7 derniers jours': 'آخر 7 أيام', 'Tableau de bord complet': 'لوحة القيادة الكاملة', 'Vue simple': 'عرض مبسط', 'Actions rapides': 'إجراءات سريعة',
  'Nouvelle vente': 'بيع جديد', 'Ajouter un produit': 'إضافة منتج', 'Recevoir une livraison': 'استلام بضاعة', 'Clients qui doivent de l’argent': 'حرفاء عليهم ديون',
  'Bonjour': 'مرحبا',
  // Statuts
  Payée: 'مدفوعة', Partielle: 'جزئية', Impayée: 'غير مدفوعة', Annulée: 'ملغاة', Validée: 'مؤكدة', 'En attente': 'في الانتظار', Vérifiée: 'تم التحقق',
  Anomalie: 'خلل', Brouillon: 'مسودة', Ouverte: 'مفتوحة', Clôturée: 'مغلقة',
};

interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  setLang: (l: Lang) => void;
  t: (s: string) => string;
}

const Ctx = createContext<I18n>({ lang: 'fr', dir: 'ltr', setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('ndc-lang') === 'ar' ? 'ar' : 'fr'));
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('ndc-lang', lang);
  }, [lang]);
  const t = (s: string) => (lang === 'ar' ? AR[s] ?? s : s);
  return <Ctx.Provider value={{ lang, dir: lang === 'ar' ? 'rtl' : 'ltr', setLang: setLangState, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
