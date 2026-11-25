# Guide utilisateur — Nour de Commerce ERP

## Se connecter
Ouvrir l'adresse du logiciel, saisir son email et son mot de passe. À la première connexion, un nouveau mot de passe personnel est demandé. Mot de passe oublié : demander à l'administrateur de le réinitialiser.

Langue : boutons **FR** / **عربي** en haut de l'écran (l'arabe s'affiche de droite à gauche). Mode sombre : icône lune.

## Installer l'application (PWA)
- **Android (Chrome)** : menu ⋮ → « Installer l'application ».
- **Windows (Chrome / Edge)** : icône d'installation dans la barre d'adresse.
- **iPhone (Safari)** : bouton Partager → « Sur l'écran d'accueil ».

Sans Internet, l'application affiche un bandeau rouge et **aucune vente ne peut être validée** : une vente n'est jamais affichée comme validée sans confirmation du serveur.

## Caissier
1. **Caisse → Ouvrir la caisse** : choisir la caisse, compter et saisir le fond de caisse.
2. **Point de vente** : scanner les produits (lecteur Honeywell) ou les toucher dans le catalogue.
   - Client : par défaut « client comptoir » ; choisir un client applique automatiquement son tarif (détaillant, grossiste, distributeur ou prix personnalisé) et les remises par quantité.
   - Remise manuelle : limitée par l'administrateur.
   - **F9** payer · **F8** mettre en attente · **F7** reprendre · **F6** facture · **+ / −** quantité de la ligne sélectionnée.
3. **Valider la vente** : espèces (avec monnaie à rendre), carte, chèque, virement, paiement partiel ou différé (client obligatoire, plafond de crédit contrôlé). Un double clic ne crée jamais deux ventes.
4. Imprimer le **ticket** (80 mm) ou la **facture A4**.
5. Fin de journée : **Caisse → Fermer la caisse**, compter les espèces sans regarder le théorique, saisir le montant ; tout écart doit être justifié.

## Magasinier
- **Réceptions → Nouvelle réception** (ou depuis une commande fournisseur) : scanner chaque article, saisir lot et péremption si nécessaire, confirmer. Le stock et le coût moyen sont mis à jour à ce moment.
- **État du stock → Entrée / sortie manuelle** : casse, périmés, ajustements (motif obligatoire).
- **Inventaires** : créer, scanner les articles (le comptage s'incrémente), corriger les quantités, **Soumettre**. Un responsable valide ensuite les écarts.
- **Lots et péremptions**, **Alertes** : produits à surveiller.

## Contrôleur à distance (Moknine)
**Vérification des factures** : factures du jour, en attente, vérifiées, anomalies, annulées, impayées. Ouvrir une facture pour la consulter, télécharger le PDF et commenter. Marquer « vérifiée » ou signaler une anomalie seulement si l'administrateur l'a autorisé.

## Corrections
Rien ne se supprime silencieusement :
- une vente se corrige par **retour** (avoir partiel) ou **annulation** (avoir total, stock restitué, remboursement) ;
- une opération de caisse se corrige par une **contre-opération** ;
- tout est tracé dans le **journal d'audit**.
