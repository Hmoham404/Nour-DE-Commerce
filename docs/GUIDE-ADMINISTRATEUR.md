# Guide administrateur

## Premiers réglages (à faire avant l'utilisation réelle)
1. **Paramètres → Entreprise** : raison sociale, adresse, téléphone, matricule fiscal, RC (en-tête des documents).
2. **Paramètres → TVA et timbre** : taux disponibles (0, 7, 13, 19 % par défaut), timbre fiscal (1,000 DT par défaut) — **à faire valider par le comptable**, ainsi que les mentions obligatoires et l'éventuelle facturation électronique.
3. **Paramètres → Numérotation** : préfixes (FAC-, TK-, BR-…) ; numéros uniques, jamais en arrière.
4. **Paramètres → Ventes** : remise maximale sans validation.
5. **Paramètres → Règles de remise** : ex. 10–49 pièces −5 %, 50 et + −10 % (exemples, à définir avec le propriétaire).
6. **Utilisateurs** : créer les comptes (magasinier, caissier, contrôleur) avec un mot de passe provisoire.
7. **Rôles et permissions** : ajuster la matrice. Les permissions sont vérifiées par le serveur, pas seulement masquées à l'écran.
8. **Importation** : reprendre produits, clients, fournisseurs depuis l'ancien logiciel (voir `IMPORT.md`).

## Rôles par défaut
| Rôle | Accès |
|---|---|
| Administrateur / Propriétaire | Tout |
| Magasinier | Produits (lecture), stock, réceptions, inventaires, retours — **sans coûts ni marges** |
| Caissier | POS, clients, factures, sa caisse, règlements, devis |
| Contrôleur à distance | Lecture : tableau de bord, ventes, factures, rapports. Vérification des factures uniquement si la permission « Vérifier / signaler une anomalie » est cochée |

## Sécurité
- Pas d'inscription publique ; comptes créés uniquement par l'administrateur.
- 5 échecs de connexion en 15 min → blocage temporaire du compte (20 par adresse IP).
- Désactiver un compte le déconnecte immédiatement de tous ses appareils.
- Historique des connexions : **Utilisateurs → Historique des connexions**.
- Journal d'audit non modifiable, même par l'administrateur.

## Sauvegardes
Voir `SAUVEGARDE.md`. Télécharger un export complet au moins une fois par semaine (**Administration → Sauvegardes**).
