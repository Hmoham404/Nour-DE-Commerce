# Sauvegarde et restauration

## 1. Automatique — Cloudflare D1 Time Travel
La base garde l'historique des 30 derniers jours : restauration possible à la minute près.

```bash
# voir le point de restauration actuel
npx wrangler d1 time-travel info nour-de-commerce-db
# restaurer l'état d'une date/heure (UTC) — ATTENTION : remplace l'état actuel
npx wrangler d1 time-travel restore nour-de-commerce-db --timestamp=2026-11-25T08:00:00Z
```

Procédure conseillée en cas d'incident :
1. Arrêter l'activité (prévenir les caissiers).
2. Faire d'abord un export de l'état actuel (§2), pour pouvoir revenir en arrière.
3. Lancer la restauration à l'heure souhaitée.
4. Vérifier le tableau de bord, le stock et les dernières ventes, puis reprendre l'activité.

## 2. Exports manuels
- **Depuis le logiciel** : Administration → Sauvegardes → *Télécharger la sauvegarde* (JSON complet, hors sessions).
- **En ligne de commande** (dump SQL restaurable) :
  ```bash
  npm run db:backup            # écrit backups/backup.sql
  # restauration dans une base vide :
  npx wrangler d1 execute <base-de-secours> --remote --file backups/backup.sql
  ```

Conserver les sauvegardes hors de l'ordinateur de caisse (disque externe, cloud personnel). Elles contiennent des données sensibles.

## 3. Test de restauration (à faire une fois)
Créer une base de test (`wrangler d1 create nour-test`), y importer `backup.sql` et vérifier le nombre de produits, de ventes et les soldes.
