# Guide de branchement du lecteur Honeywell

Le logiciel est compatible avec tous les lecteurs Honeywell fonctionnant en mode **USB HID Keyboard** (émulation clavier). Aucun pilote ni logiciel propriétaire n'est nécessaire.

> Le lecteur photographié chez Nour de Commerce porte une étiquette *ICS identcode systeme ag* : c'est un modèle Honeywell (série Voyager / Hyperion) revendu par un intégrateur suisse. **Le modèle exact et le type de câble (USB ou RS232) restent à confirmer** en lisant l'étiquette sous le lecteur (référence du type `1200g`, `1250g`, `1300g`, `1450g`, `1900g`…).

## 1. Branchement (USB)

1. Brancher le câble USB du lecteur sur l'ordinateur de caisse.
2. Windows le reconnaît automatiquement comme un « Périphérique clavier HID ».
3. Ouvrir le **Bloc-notes** et scanner un produit : le code doit s'afficher puis le curseur doit passer à la ligne.

| Résultat dans le Bloc-notes | Cause | Solution |
|---|---|---|
| `6191234567897` + retour à la ligne | OK | Rien à faire |
| `&é"'(-è_çà…` au lieu des chiffres | Lecteur en clavier US, Windows en AZERTY | Le logiciel corrige automatiquement. Pour corriger à la source : scanner dans le manuel Honeywell le code « Keyboard Country : France » |
| Code affiché mais pas de retour à la ligne | Suffixe désactivé | Scanner le code « Add CR Suffix » du manuel, ou choisir « Aucun suffixe » dans *Configuration du scanner* |
| Rien ne s'affiche | Câble RS232 ou mode USB série | Voir §4 |

## 2. Réglage dans le logiciel

Menu **Administration → Configuration du scanner** :

- **Suffixe** : Entrée (par défaut), Tabulation, ou aucun.
- **Délai max entre caractères** (50 ms par défaut) : distingue le lecteur (très rapide) d'une frappe humaine.
- **Anti-double lecture** (250 ms) : ignore un double événement involontaire du même code ; un nouveau scan volontaire du même produit est bien compté (quantité +1).
- **Signal sonore** : bip aigu = lecture réussie, double bip grave = code inconnu ou erreur.
- Bouton **Appliquer à tous les postes** (administrateur) ; sinon les réglages ne concernent que l'ordinateur utilisé.

L'écran affiche le dernier code reçu, son format (EAN-13, EAN-8, UPC-A, UPC-E, ITF-14, Code 128/39, GS1-128, QR si lecteur 2D), la validité de la clé de contrôle, la durée de lecture et l'historique des 10 dernières lectures.

> En mode USB HID, un navigateur ne peut **pas** savoir si un lecteur est branché : l'indicateur « Scanner prêt » signifie que le logiciel écoute. Seule une lecture réussie prouve que le lecteur fonctionne.

## 3. Où le scanner est actif

| Écran | Effet d'un scan |
|---|---|
| Point de vente | Ajoute le produit au panier (ou +1 / +quantité du carton), tarif du client, alerte stock insuffisant. Le stock n'est déduit qu'à la validation de la vente. |
| Fiche produit → « Scanner le code-barres » | Remplit le champ ; si le code existe déjà, affiche le produit existant (doublon interdit). |
| Réception fournisseur | Ajoute / incrémente la quantité reçue ; saisie du lot et de la péremption. |
| Inventaire rapide | Chaque scan incrémente la quantité comptée. |
| Retours / Documents | Scanner le n° du ticket ou de la facture. |
| Page de test | Diagnostic. |

Le scanner n'intercepte jamais les frappes dans les champs mot de passe, zones de texte ou formulaires non concernés.

## 4. Lecteur RS232 (prise série) ou sans lecteur

- **RS232** : utiliser un adaptateur USB-série, puis le bouton **Connecter un lecteur série (Web Serial)** de la page de test (Chrome ou Edge, ordinateur). Si le navigateur ne convient pas, un petit connecteur local pourra être fourni après identification du modèle.
- **Téléphone / tablette** : bouton **Caméra** sur tous les écrans de scan.

## 5. Protocole de test physique avant livraison

À réaliser sur place, avec le vrai lecteur, et à cocher :

| # | Test | Attendu | OK |
|---|---|---|---|
| 1 | Bloc-notes : scanner 3 produits | Code complet + retour à la ligne | ☐ |
| 2 | Page de test : scanner un EAN-13 | « Lecture réussie », format EAN-13, clé valide, durée < 150 ms | ☐ |
| 3 | Scanner un code commençant par 0 | Zéros initiaux conservés | ☐ |
| 4 | Fiche produit : scanner un code déjà utilisé | Message « déjà attribué » + bouton vers le produit | ☐ |
| 5 | POS : scanner 10 produits différents rapidement | 10 lignes, aucun code perdu ou fusionné | ☐ |
| 6 | POS : scanner 5 fois le même produit | Quantité 5 | ☐ |
| 7 | POS : scanner un code absent du catalogue | Double bip + « Code inconnu » | ☐ |
| 8 | POS : scanner pendant la saisie d'une quantité | Le scan n'écrit pas dans le champ quantité | ☐ |
| 9 | POS : scanner un code carton | Quantité = pièces par carton | ☐ |
| 10 | Réception : scanner 20 articles | Quantités correctes, stock mis à jour après confirmation | ☐ |
| 11 | Inventaire : scanner, soumettre, valider | Écarts corrects, stock ajusté | ☐ |
| 12 | Lecteur débranché puis rebranché | Fonctionne sans recharger la page | ☐ |
| 13 | Champ mot de passe actif + scan | Le code n'est pas capturé par le POS | ☐ |
