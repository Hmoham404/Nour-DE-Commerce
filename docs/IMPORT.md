# Guide d'importation des produits (migration de l'ancien logiciel)

1. Dans l'ancien logiciel, exporter les produits vers **Excel** ou **CSV** (nom du logiciel et format à confirmer avec le propriétaire).
2. **Administration → Importation / exportation** → choisir « Produits » → **Télécharger le modèle Excel** pour voir les colonnes attendues.
3. Choisir le fichier. Les colonnes sont associées automatiquement quand leur nom est reconnu (désignation, prix, code-barres, TVA…) ; corriger l'association si besoin.
4. **Analyser le fichier** : le logiciel affiche pour chaque ligne l'action prévue et les contrôles :
   - doublons dans le fichier (référence, code-barres) ;
   - code-barres déjà utilisé dans le catalogue ;
   - montants ou quantités invalides, désignation ou prix manquant ;
   - clé de contrôle EAN invalide (avertissement).
5. **Confirmer et importer**. Chaque ligne est enregistrée de façon atomique : une ligne en erreur n'empêche pas les autres.
6. Le rapport final liste les lignes non importées ; l'historique reste consultable.

## Règles
- Par défaut, les enregistrements existants sont **ignorés**. La mise à jour (même référence / code / identifiant ancien) doit être cochée explicitement et confirmée.
- Le **stock n'est jamais écrasé** par un import de mise à jour : utiliser un inventaire. Le stock initial n'est appliqué qu'aux nouveaux produits (mouvement « stock initial » tracé).
- Les catégories et marques inconnues sont créées automatiquement ; le fournisseur est recherché par code ou nom.
- Montants acceptés : `1,250` `1.250` `1 250,500`. TVA : `19` ou `19%`.
- Formater la colonne des codes-barres en **Texte** dans Excel pour conserver les zéros initiaux.
- L'identifiant de l'ancien logiciel peut être conservé (colonne `legacy_id`).
- Clients et fournisseurs : même procédure ; le solde initial reprend l'encours à la date de migration.

La migration des **factures historiques** n'est pas automatique : elle sera étudiée après analyse de leur structure.

## Export vers l'ancien logiciel
**Rapports → Exports Excel** : choisir les colonnes, renommer les en-têtes, choisir le séparateur, mémoriser le profil. Aucune synchronisation directe n'est activée tant que le logiciel existant (nom, version, formats, API) n'est pas identifié.
