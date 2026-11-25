# Nour-DE-Commerce

ERP commercial pour **Nour de Commerce** (produits alimentaires et d'hygiène). *Developed by GM LAC.*

> Statut : **en développement**. Le backend (API + base de données) est fonctionnel et testé. L'interface web (React, PWA, FR/AR) est en cours de réalisation.

## Architecture

| Couche | Technologie |
|---|---|
| API | Cloudflare Workers + Hono (TypeScript) |
| Base de données | Cloudflare D1 (SQLite) : migrations versionnées dans `migrations/` |
| Interface | React + Vite + Tailwind (en cours), PWA, français / arabe (RTL) |
| Scanner | Honeywell en mode USB HID Keyboard (aucun pilote), caméra en secours |

Principes :
- Montants stockés en **millimes entiers** (1 TND = 1000), donc aucun calcul en virgule flottante.
- Opérations critiques (vente, réception, retour, inventaire, caisse) exécutées dans **une seule transaction atomique**.
- Ventes **idempotentes** : un double clic sur « Valider » ne crée pas deux ventes.
- Stock négatif interdit par la base (trigger), FEFO sur les lots, coût moyen pondéré.
- Journal d'audit et opérations de caisse **non modifiables** (triggers).
- Permissions vérifiées côté serveur pour chaque route (rôles : Administrateur, Magasinier, Caissier, Contrôleur).

## Démarrage local

```bash
npm install
npm run db:migrate:local
node scripts/create-admin.mjs --email admin@exemple.tn --name "Propriétaire" --password "MotDePasse123"
npm run dev:api          # API sur http://127.0.0.1:8799
npm test                 # tests unitaires
npm run test:api         # tests d'intégration (API lancée, admin admin@test.local / Test12345)
```

## Structure

```
migrations/   schéma SQL + données de référence (rôles, numérotation, paramètres)
shared/       logique partagée testée : montants, tarifs/remises, codes-barres, détection scanner, dates
worker/       API (auth, produits, stock, achats, ventes, caisse, finance, rapports, import, sauvegarde)
scripts/      création du premier administrateur
tests/        tests unitaires (Vitest) et d'intégration (API réelle)
```

Aucun identifiant, mot de passe ou clé n'est stocké dans ce dépôt.
