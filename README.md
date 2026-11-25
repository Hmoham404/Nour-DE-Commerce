# Nour-DE-Commerce — ERP commercial

ERP web pour **Nour de Commerce** (distribution de produits alimentaires et d'hygiène) : produits, codes-barres Honeywell, stocks et lots, achats, ventes / POS, facturation, caisse, créances, finance, rapports.
*Developed by GM LAC.*

- **Production** : https://nour-de-commerce-erp.lakhalm300.workers.dev
- **Hébergement** : Cloudflare Workers (API + interface) et Cloudflare D1 (base de données), en HTTPS
- **Application installable** (PWA) sur Android, Windows et iOS ; interface en français et en arabe (RTL) ; mode clair ou sombre

## Fonctionnalités

| Domaine | Contenu |
|---|---|
| Catalogue | Fiches complètes, plusieurs codes-barres par produit (pièce, pack, carton), photos, 4 tarifs + prix par client, archivage ou suppression (si jamais utilisé), duplication, prix en masse avec historique, étiquettes |
| Scanner Honeywell | USB HID sans pilote, suffixe Entrée/Tab/aucun, anti-doublon, bips, correction AZERTY, caméra du téléphone, Web Serial, page de test |
| Stock | Mouvements tracés (avant/après), ajustements motivés, alertes, lots FEFO, péremptions, inventaire rapide par scan avec validation, faible rotation |
| Achats | Commandes → réceptions partielles → factures fournisseur → règlements, coût moyen pondéré, frais d'approche, retours |
| Ventes | POS (scan continu, attente/reprise, paiements multiples, différé, monnaie rendue, raccourcis), devis, commandes, factures, BL, avoirs, retours, remises par règles |
| Caisse | Ouverture, décaissements, clôture avec écart justifié, validation, contre-opérations uniquement |
| Finance | CA, encaissements, CMV, marge, taux de marge / de marque, dépenses, résultat estimé, créances, dettes |
| Contrôle | Vérification des factures à distance (Moknine), journal d'audit immuable, historique des connexions |
| Données | Import Excel/CSV en assistant, exports Excel/CSV/PDF configurables, sauvegardes |

## Documentation
- [Guide utilisateur](docs/GUIDE-UTILISATEUR.md)
- [Guide administrateur](docs/GUIDE-ADMINISTRATEUR.md)
- [Branchement du scanner Honeywell et protocole de test](docs/SCANNER-HONEYWELL.md)
- [Importation des produits](docs/IMPORT.md)
- [Sauvegarde et restauration](docs/SAUVEGARDE.md)
- [Documentation technique](docs/TECHNIQUE.md)

## Installation (développement)
```bash
npm install
npm run db:migrate:local
node scripts/create-admin.mjs --email admin@test.local --name "Admin" --password "Test12345" --keep-password
npm run build
npm run dev:api        # http://127.0.0.1:8799
```

## Tests
```bash
npm run typecheck      # TypeScript (interface + API) : 0 erreur
npm test               # 20 tests unitaires : montants, tarifs, remises, codes-barres, simulation du scanner
npm run test:api       # 31 tests d'intégration sur la vraie base : ventes atomiques, idempotence, concurrence, stock, crédit…
npm run test:e2e       # 7 scénarios navigateur (Playwright) : connexion, scan HID, POS, arabe RTL, mobile, 36 pages
```

## Déploiement
```bash
npx wrangler login
npm run db:migrate:remote
npm run deploy
node scripts/create-admin.mjs --email <email> --name "<nom>" --password "<provisoire>" --remote
```
Aucun identifiant, mot de passe ni clé n'est stocké dans ce dépôt.
