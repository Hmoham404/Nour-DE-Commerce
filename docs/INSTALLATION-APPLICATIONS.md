# Installer Nour de Commerce sur ordinateur et téléphone

Les trois versions affichent le même logiciel en ligne, toujours à jour (aucune mise à jour à installer) :

| Version | Pour qui | Installation |
|---|---|---|
| **Application Windows (.exe)** | Poste de caisse, magasin | `Nour-de-Commerce-Setup-1.0.0.exe` |
| **Application Android (.apk)** | Téléphone / tablette (propriétaire à Moknine, magasinier) | `Nour-de-Commerce.apk` |
| **PWA** | Tout appareil (Android, iPhone, Windows, Mac) | depuis le navigateur |

## 1. Windows (.exe)
1. Double-cliquer sur `Nour-de-Commerce-Setup-1.0.0.exe`.
2. Windows peut afficher « Windows a protégé votre ordinateur » (l'installateur n'est pas encore signé par un certificat payant) : cliquer **Informations complémentaires → Exécuter quand même**.
3. Choisir le dossier, terminer : l'icône **Nour de Commerce** apparaît sur le Bureau.

Avantages par rapport au navigateur :
- **lecteurs code-barres série / RS232 / USB-COM connectés automatiquement** (Honeywell reconnu en priorité) ; les lecteurs USB « clavier » fonctionnent de toute façon ;
- menu **Scanner et impression → Impression directe des tickets** : impression sans fenêtre de dialogue sur l'imprimante par défaut ;
- F2 = point de vente, F11 = plein écran, Ctrl + / Ctrl − = taille du texte ;
- écran clair en cas de coupure Internet, nouvel essai automatique.

Recompiler l'installateur : `cd desktop && npm install && npm run dist` (fichier dans `desktop/release/`).

## 2. Android (.apk)
1. Copier `Nour-de-Commerce.apk` sur le téléphone (câble, WhatsApp, Google Drive…).
2. L'ouvrir ; Android demande d'autoriser l'installation depuis cette source : accepter.
3. L'application s'ouvre en plein écran (Android 7 minimum).

Le scan se fait avec le bouton **Caméra** ; un lecteur Bluetooth en mode clavier fonctionne aussi.

**Fichiers de signature** (`signing.keystore`, `signing-key-info-A-GARDER-SECRET.txt`) : ils servent à publier les futures mises à jour de l'APK et à mettre l'application sur Google Play (`Nour-de-Commerce-PlayStore.aab`). À conserver précieusement et hors de GitHub. Le fichier `public/.well-known/assetlinks.json` doit rester en ligne : il permet l'affichage plein écran.

## 3. PWA (sans fichier)
- **Android / Windows (Chrome, Edge)** : ouvrir l'adresse du logiciel → menu → « Installer l'application ».
- **iPhone (Safari)** : Partager → « Sur l'écran d'accueil ».
