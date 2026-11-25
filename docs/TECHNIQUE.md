# Documentation technique

## Architecture
```
Navigateur / PWA (React 19 + Vite + Tailwind 4)
      │  HTTPS, cookie de session HttpOnly SameSite=Strict
      ▼
Cloudflare Worker « nour-de-commerce-erp » (Hono)
  ├─ /api/*  → routes métier (worker/routes/*.ts), validation Zod, permissions
  └─ /*      → fichiers statiques (dist/), SPA
      │
      ▼
Cloudflare D1 « nour-de-commerce-db » (SQLite managé, Time Travel 7 j en gratuit / 30 j en payant)
```
Choix Cloudflare (demande du client) à la place de Vercel + Supabase du cahier des charges : un seul fournisseur, une seule URL, aucune clé secrète exposée au navigateur (le Worker est le seul à accéder à la base ; il n'existe pas de « service role key »).

**Multi-clients GM LAC** : une base D1 + un Worker par client (isolation totale des données), plutôt qu'une colonne `company_id`.

## Règles d'intégrité
| Règle | Mise en œuvre |
|---|---|
| Montants exacts | INTEGER en millimes ; taux en points de base ; aucun flottant |
| Atomicité | `db.batch()` = transaction : vente + lignes + stock + lots + facture + paiements + caisse + audit, tout ou rien |
| Pas de stock négatif | trigger `stock_no_negative_*` (paramétrable) ; testé en concurrence |
| Idempotence | `sales.idempotency_key UNIQUE`, `goods_receipts.idempotency_key UNIQUE` |
| Numérotation unique | `document_sequences` incrémentée dans la même transaction |
| Pas de double stock achat | stock à la réception ; facture fournisseur sans mouvement ; `purchase_invoices.receipt_id UNIQUE` |
| Audit immuable | triggers interdisant UPDATE/DELETE sur `audit_logs` |
| Caisse immuable | triggers sur `cash_movements` ; aucun mouvement sur session fermée ; une session ouverte par caisse et par utilisateur |
| Lots | FEFO, `remaining_qty >= 0`, vente des périmés bloquée |
| Codes-barres | TEXT, index UNIQUE, zéros conservés, correction AZERTY |

## Sécurité
- Mots de passe : PBKDF2-SHA256, 100 000 itérations, sel aléatoire. Jetons de session aléatoires (256 bits), seul leur SHA-256 est stocké.
- CSRF : cookie SameSite=Strict + en-tête `x-ndc` obligatoire + contrôle d'Origin.
- Injections SQL : requêtes préparées uniquement.
- XSS : rendu React (échappement), aucun `dangerouslySetInnerHTML`.
- Permissions vérifiées sur chaque route ; données financières masquées côté serveur sans `finance.view`.
- Documents (factures, PDF) : rendus à la demande pour un utilisateur connecté ; aucune URL publique.
- Anti-force brute : 5 échecs / 15 min par email, 20 par IP.

## Commandes
```bash
npm install
npm run db:migrate:local && node scripts/create-admin.mjs --email a@b.tn --password "Xxxxxxx1" --keep-password
npm run build && npm run dev:api      # http://127.0.0.1:8799 (API + interface)
npm run dev                           # interface avec rechargement à chaud (proxy /api → 8799)
npm run typecheck
npm test                              # unitaires (Vitest)
npm run test:api                      # intégration API (serveur lancé)
npm run test:e2e                      # navigateur (Playwright, serveur lancé)
npm run deploy                        # production
npm run db:migrate:remote             # migrations production
```
Après `npm run build`, redémarrer `npm run dev:api` (wrangler ne relit pas le dossier dist vidé).

## Environnements
- **Développement** : base D1 locale (`.wrangler/`), aucune donnée réelle.
- **Production** : base D1 distante `nour-de-commerce-db`. Pour un environnement de recette séparé : `wrangler d1 create nour-de-commerce-staging` + section `env.staging` dans `wrangler.jsonc`.
- Aucun secret n'est nécessaire au fonctionnement (pas de clé API) ; `.env.example` documente les variables optionnelles.

## Structure
```
migrations/  SQL versionné      shared/  logique testée (montants, tarifs, codes-barres, scanner, dates)
worker/      API                src/     interface React (pages/, components/, lib/)
tests/       unitaires + API    e2e/     Playwright        scripts/  outils (premier admin)
```

## Extension IA (prévue, non activée)
Un module pourra appeler un modèle de langage via une route `/api/assistant` utilisant les mêmes contrôles de permissions, en lecture seule (KPI, prévisions, réapprovisionnement). Toute écriture (stock, caisse, factures) resterait soumise à validation humaine. Le cœur de l'ERP n'en dépend pas.
