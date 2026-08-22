# Solaria Command 🌞 — Guide d'installation complet

Bot Discord pour la ville **Solaria** (serveur Minecraft *Australia*) : liaison de compte,
commandes avec catalogue et prix, validation staff en plusieurs étapes, tickets de
récupération, règlement à rôle-réaction, blacklist, et génération automatique du serveur.

Ce guide part du principe que tu n'as **jamais** installé de bot Discord. Suis les étapes
dans l'ordre, ne saute rien.

---

## Sommaire

1. [Prérequis](#1-prérequis)
2. [Créer l'application Discord (le bot)](#2-créer-lapplication-discord-le-bot)
3. [Inviter le bot sur ton serveur](#3-inviter-le-bot-sur-ton-serveur)
4. [Récupérer les identifiants nécessaires](#4-récupérer-les-identifiants-nécessaires)
5. [Installer le projet sur ton ordinateur](#5-installer-le-projet-sur-ton-ordinateur)
6. [Configurer le fichier .env](#6-configurer-le-fichier-env)
7. [Déployer les commandes et démarrer le bot](#7-déployer-les-commandes-et-démarrer-le-bot)
8. [Premier lancement : /setup](#8-premier-lancement-setup)
9. [Configurer ton catalogue de prix](#9-configurer-ton-catalogue-de-prix)
10. [Configurer ton équipe (rôle Staff)](#10-configurer-ton-équipe-rôle-staff)
11. [Toutes les fonctionnalités et comment elles marchent](#11-toutes-les-fonctionnalités-et-comment-elles-marchent)
12. [Garder le bot allumé 24/7 (hébergement)](#12-garder-le-bot-allumé-247-hébergement)
13. [Problèmes fréquents](#13-problèmes-fréquents)
14. [Structure du projet](#14-structure-du-projet)

---

## 1. Prérequis

- Un compte Discord, et être **propriétaire ou administrateur** du serveur Solaria.
- [Node.js](https://nodejs.org) version 22.5 ou plus, installé sur ton ordinateur.
  Vérifie avec :
  ```
  node -v
  ```
  Si la commande n'est pas reconnue, télécharge et installe Node.js (version "LTS")
  depuis nodejs.org, puis relance ton terminal.
  Le bot utilise le module SQLite intégré à Node.js (`node:sqlite`) : aucune
  compilation native n'est nécessaire, contrairement à d'autres solutions.
- Le fichier `solaria-command.zip` que je t'ai fourni, dézippé quelque part sur ton
  ordinateur (Bureau, Documents, peu importe).

---

## 2. Créer l'application Discord (le bot)

1. Va sur https://discord.com/developers/applications
2. Clique **New Application**, donne-lui un nom (ex : `Solaria Command`), accepte les
   conditions, clique **Create**.
3. Dans le menu de gauche, va dans **Bot**.
4. Clique **Reset Token** (ou **Add Bot** si ce n'est pas déjà fait) → confirme.
5. Clique **Copy** pour copier le token qui apparaît. **Garde-le précieusement, ne le
   partage à personne** (c'est le mot de passe de ton bot). Tu en auras besoin à l'étape 6.
6. Toujours dans **Bot**, descends jusqu'à **Privileged Gateway Intents** et active :
   - ✅ **Server Members Intent**
   - ✅ **Message Content Intent**
   Clique **Save Changes**.

---

## 3. Inviter le bot sur ton serveur

1. Dans le menu de gauche, va dans **OAuth2 → URL Generator**.
2. Dans **Scopes**, coche :
   - ✅ `bot`
   - ✅ `applications.commands`
3. Dans **Bot Permissions** qui apparaît en dessous, coche :
   - ✅ **Administrator**
   (nécessaire car le bot doit pouvoir créer des salons, des rôles et gérer les
   permissions automatiquement lors du `/setup`)
4. En bas, copie l'**URL générée**, colle-la dans ton navigateur, choisis ton serveur
   Solaria, clique **Continuer** puis **Autoriser**.
5. Le bot doit maintenant apparaître (hors ligne, grisé) dans la liste des membres de
   ton serveur.

---

## 4. Récupérer les identifiants nécessaires

Tu as besoin de 3 informations :

**A. Le token du bot** — déjà copié à l'étape 2.5.

**B. L'Application ID (= CLIENT_ID)**
- Sur https://discord.com/developers/applications, ouvre ton application.
- Dans **General Information**, copie **Application ID**.

**C. L'ID de ton serveur (= GUILD_ID)**
- Dans Discord (l'application, pas le site), va dans **Réglages utilisateur ⚙️ → Avancés**
  et active **Mode développeur**.
- Fais un clic droit sur l'icône de ton serveur Solaria dans la barre de gauche →
  **Copier l'identifiant du serveur**.

---

## 5. Installer le projet sur ton ordinateur

Ouvre un terminal (Invite de commandes / PowerShell sur Windows, Terminal sur Mac/Linux),
et déplace-toi dans le dossier dézippé :

```
cd chemin/vers/solaria-command
```

Puis installe les dépendances :

```
npm install
```

Cela peut prendre 1 à 2 minutes. Un dossier `node_modules` apparaît, c'est normal.

---

## 6. Configurer le fichier .env

Dans le dossier du projet, duplique `.env.example` et renomme la copie en `.env`
(ou utilise cette commande) :

```
cp .env.example .env
```

Ouvre `.env` avec un éditeur de texte (Bloc-notes, VS Code...) et remplis les 3 valeurs
récupérées à l'étape 4 :

```
DISCORD_TOKEN=colle_ton_token_ici
CLIENT_ID=colle_ton_application_id_ici
GUILD_ID=colle_ton_id_de_serveur_ici
```

Enregistre le fichier. **Ne partage jamais ce fichier** (surtout le token).

---

## 7. Déployer les commandes et démarrer le bot

Toujours dans le terminal, dans le dossier du projet :

```
npm run deploy
```

Tu dois voir `✅ Commandes déployées avec succès sur le serveur.` Cela enregistre les
commandes slash (`/link`, `/setup`, etc.) sur ton serveur — à refaire uniquement si tu
modifies la liste des commandes dans `src/commands.js`.

Puis démarre le bot :

```
npm start
```

Tu dois voir `✅ Solaria Command connecté en tant que ...`. Le bot passe en ligne sur
Discord. **Laisse ce terminal ouvert** : si tu le fermes, le bot se déconnecte (voir
section 12 pour le faire tourner 24/7).

---

## 8. Premier lancement : /setup

Sur ton serveur Discord, dans n'importe quel salon, tape :

```
/setup
```

(toi seul, en tant qu'admin, dois l'exécuter). Le bot va automatiquement :

- Créer les rôles `Non-vérifié`, `Membre`, `Staff`, `Blacklist`
- Créer les catégories et salons :
  - **📢 Informations** : règlement, annonces, fonctionnement, aide
  - **🛒 Boutique** : catalogue (galerie d'images libre, non gérée par le bot), commandes,
    stocks, historique-achats
  - **💬 Communauté** : suggestions, discussion, signalement, screenshots
  - **🔒 Administration** (visible du staff uniquement) : commandes-a-valider,
    commandes-en-attente, commandes-non-repertoriees, logs
  - **🎫 Tickets** (catégorie vide, les salons de tickets s'y créeront automatiquement)
- Poster le **règlement** dans #règlement avec une réaction ✅ (rôle réaction)
- Poster l'embed **🛒 Commander** dans #commandes

Relancer `/setup` plus tard est **sans danger** : le bot retrouve les salons/rôles/messages
déjà créés au lieu d'en dupliquer.

---

## 9. Configurer ton catalogue de prix

Le catalogue utilisé pour les commandes est une donnée interne, gérée avec la commande
`/catalog` — indépendante du salon #catalogue (qui reste une galerie d'images libre pour
vos visuels).

```
/catalog add item:blé unite:5 prix:5
/catalog add item:bois unite:10 prix:8
/catalog add item:fer unite:5 prix:15
/catalog add item:diamant unite:1 prix:50
```

`unite` = la quantité de référence, `prix` = son prix. Le bot calcule ensuite le prix
proportionnellement à ce que le joueur commande (ex : 60 blé avec la ligne ci-dessus →
60 × 5 ÷ 5 = 60 pièces).

Autres commandes :
```
/catalog list              → voir tout le catalogue
/catalog remove item:blé   → retirer un item
```

---

## 10. Configurer ton équipe (rôle Staff)

Le bot ne devine pas qui fait partie du staff. Va dans **Paramètres du serveur → Rôles**,
ou directement sur le profil de chaque membre de ton équipe, et attribue-lui manuellement
le rôle **Staff** créé par `/setup`. Ce rôle donne accès aux salons d'administration et aux
boutons Accepter/Refuser/Proposer un prix/Marquer comme prête.

---

## 11. Toutes les fonctionnalités et comment elles marchent

### Arrivée d'un membre
- Reçoit automatiquement le rôle `Non-vérifié`.
- Reçoit un message de bienvenue dans #annonces l'invitant à lire le règlement.

### Règlement
- Le joueur réagit ✅ sur le message dans #règlement → reçoit `Membre`, perd
  `Non-vérifié` → débloque tous les autres salons.
- S'il retire sa réaction, il repasse `Non-vérifié` automatiquement.

### Lier son pseudo Minecraft
```
/link <pseudo>     → relie le compte (obligatoire pour commander)
/unlink            → délie le compte
/whoami            → rappelle le pseudo actuellement lié
```

### Commander (tout se passe dans #commandes)
1. Le joueur clique le bouton **🛒 Commander** sous l'embed fixe.
2. Un menu déroulant liste tous les items du catalogue (`/catalog`) + l'option
   **"Autre (non répertorié)"**.
3. **Item du catalogue choisi** → un formulaire demande la quantité → le prix est
   calculé automatiquement → la commande part dans **#commandes-a-valider**.
4. **"Autre" choisi** → un formulaire demande le nom de l'item + la quantité → la
   demande part dans **#commandes-non-repertoriees**. Un membre du staff clique
   **💰 Proposer un prix**, saisit un montant → le joueur reçoit l'offre en MP avec
   Accepter/Refuser. S'il accepte, la commande rejoint #commandes-a-valider comme une
   commande normale. S'il refuse, elle est annulée.

### Validation par le staff
- Dans **#commandes-a-valider** : pseudo en jeu, item, quantité, prix affichés, avec
  deux boutons :
  - **✅ Accepter** → MP au joueur "commande en préparation" → la commande part dans
    **#commandes-en-attente** avec un bouton **📦 Marquer comme prête**.
  - **❌ Refuser** → un formulaire demande une raison (optionnelle) → MP au joueur avec
    cette raison.
- Dans **#commandes-en-attente**, une fois la commande physiquement préparée en jeu, un
  membre du staff clique **📦 Marquer comme prête** → le joueur reçoit un MP avec un
  bouton **🎫 Ouvrir un ticket**.

### Tickets
- Le bouton "Ouvrir un ticket" (reçu en MP, ou via la commande `/ticket` pour un ticket
  libre hors commande) crée un salon privé visible uniquement du joueur et du staff, avec
  le récapitulatif de la commande.
- Le bouton **🔒 Clôturer le ticket** (staff ou le joueur lui-même) marque la commande
  comme terminée, poste un résumé dans **#historique-achats**, note l'action dans
  **#logs**, puis supprime le salon 10 secondes plus tard.

### Suivi de commande
```
/mes-commandes
```
Utilisable dans le serveur **ou en message privé au bot**. Affiche toutes les commandes
du joueur avec leur statut : en attente de prix, à valider, refusée, en préparation,
prête, terminée.

### Blacklist
```
/blacklist add utilisateur:@Pseudo raison:"n'a jamais payé"
/blacklist remove utilisateur:@Pseudo
/blacklist list
```
Un joueur blacklist reçoit un rôle dédié et ne peut plus passer de commande tant qu'il
n'est pas retiré de la liste.

### Notifications automatiques en MP
Le joueur reçoit un message privé à chaque étape clé : offre de prix (item hors
catalogue), acceptation, refus (avec raison), passage en préparation, commande prête.

---

## 12. Garder le bot allumé 24/7 (hébergement)

Tant que `npm start` tourne dans ton terminal, le bot est en ligne. Si tu fermes le
terminal ou éteins ton ordinateur, le bot se déconnecte. Pour qu'il tourne en continu,
héberge-le sur une machine allumée en permanence :

- **VPS** (le plus fiable) : loue un petit serveur Linux (OVH, Hetzner, Contabo...),
  installe Node.js dessus, copie le projet, lance `npm install`, `npm run deploy`, puis
  garde le process actif avec un outil comme `pm2` :
  ```
  npm install -g pm2
  pm2 start src/index.js --name solaria-command
  pm2 save
  ```
- **Hébergeurs de bots Discord** (PebbleHost, Bisecthosting, etc.) : ils fournissent
  souvent un panel type Pterodactyl où tu uploades le zip et configures les variables
  d'environnement (`DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`) directement dans leur
  interface.
- **Railway / Render** : services cloud où tu connectes un dépôt Git contenant le
  projet, tu renseignes les mêmes variables d'environnement dans leur dashboard, et ils
  gèrent le redémarrage automatique.

Dans tous les cas, le fichier `solaria.db` (base SQLite) doit être conservé entre les
redémarrages pour ne pas perdre les liens de compte, commandes et catalogue — vérifie
que ton hébergeur ne réinitialise pas le dossier du projet à chaque déploiement.

---

## 13. Problèmes fréquents

**`npm : command not found`** → Node.js n'est pas installé ou le terminal doit être
redémarré après l'installation.

**Le bot reste hors ligne après `npm start`** → vérifie que `DISCORD_TOKEN` dans `.env`
est correct et complet (pas d'espace avant/après), et que tu as bien cliqué "Reset
Token" puis copié le nouveau token.

**Les commandes slash n'apparaissent pas sur Discord** → relance `npm run deploy`,
attends quelques minutes (Discord met parfois du temps à les afficher), ou fais
`Ctrl+R` dans le client Discord.

**"Missing Permissions" lors du `/setup`** → le bot n'a pas la permission
Administrateur. Retourne à l'étape 3, régénère un lien d'invitation avec Administrator
coché, et ré-invite le bot (ou ajuste ses permissions dans Paramètres du serveur → Rôles
→ Solaria Command).

**`Error: The module '.../better_sqlite3.node' was compiled against a different
Node.js version`** → cette erreur ne devrait plus apparaître avec cette version du
bot, qui utilise le module SQLite intégré à Node.js (`node:sqlite`) au lieu d'un module
externe nécessitant une compilation. Si tu la vois quand même, vérifie que tu utilises
bien le `package.json` fourni dans ce zip (sans dépendance `better-sqlite3`) et que ton
hébergeur utilise Node.js 22.5 ou plus.

**Un joueur ne peut pas commander alors qu'il est vérifié** → il doit d'abord faire
`/link <pseudo>`.

**Je veux repartir de zéro (réinitialiser toutes les données)** → arrête le bot, supprime
les fichiers `solaria.db`, `solaria.db-shm`, `solaria.db-wal` à la racine du projet, puis
relance `npm start`. ⚠️ Cela efface tous les liens de compte, commandes, catalogue et
blacklist enregistrés.

---

## 14. Structure du projet

```
solaria-command/
├── config.json          # rôles/catégories/texte du règlement (modifiable avant /setup)
├── .env                  # tes secrets (jamais à partager)
└── src/
    ├── index.js           # client Discord + dispatcher de toutes les interactions
    ├── deploy-commands.js # enregistrement des slash commands (npm run deploy)
    ├── database.js        # accès SQLite (liens, catalogue, commandes, blacklist, tickets)
    ├── setup.js            # génération automatique des salons/rôles/embeds (/setup)
    ├── orders.js           # tout le workflow de commande
    ├── tickets.js          # création/fermeture des tickets
    └── commands.js         # définitions de toutes les slash commands
```
