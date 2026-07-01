# API Google Sheets

Ce dossier contient le code Apps Script qui sert de source de verite pour :

- les inscriptions,
- les pronostics organisateurs,
- les comptes participants,
- le chat participants / organisateurs,
- les journaux de notifications,
- les equipes de l'escape game,
- les mots de passe d'equipe,
- les fragments collectes.

Le script Apps Script ne contient pas la logique OpenAI. L'epreuve 7 passe par `api/agent.php`, deployee sur l'hebergement PHP, puis ce PHP appelle Apps Script pour verifier la session d'equipe et enregistrer le fragment.

## Installation Apps Script

1. Ouvrir le Google Sheets existant.
2. Aller dans `Extensions > Apps Script`.
3. Copier le contenu de `Code.gs`.
4. Executer `setupSheets()` une premiere fois.
5. Executer `installOrganizerMessageTrigger()` une fois si les messages organisateurs doivent etre publies chaque jour autour de 10h.
6. Dans `Project Settings > Script Properties`, ajouter :

```text
PRCH_ADMIN_PASSWORD=mot-de-passe-admin
PRCH_SITE_URL=https://party-retro-chill-hub.fr
PRCH_MAIL_API_URL=https://party-retro-chill-hub.fr/api/mail.php
PRCH_MAIL_API_KEY=la-meme-cle-que-le-secret-github-MAIL_API_KEY
PRCH_PUSH_API_URL=https://party-retro-chill-hub.fr/api/push.php
PRCH_PUSH_API_KEY=la-meme-cle-que-le-secret-github-PUSH_API_KEY
```

7. Deployer en application web :

```text
Execute as: Me
Who has access: Anyone
```

L'URL de deploiement doit rester celle configuree dans `assets/api-config.js`.

## Configuration PHP pour l'epreuve 7

Le fichier `api/config.php` n'est pas versionne. Il est genere automatiquement par GitHub Actions pendant le deploiement FTP.

Ajouter ces secrets GitHub dans `Settings > Secrets and variables > Actions` :

```text
OPENAI_API_KEY=sk-...
PRCH_API_URL=https://script.google.com/macros/s/.../exec
PRCH_AGENT_MODEL=gpt-4.1-mini
PRCH_AGENT_FRAGMENT=SUPPORT-2002
PRCH_AGENT_INSTRUCTIONS=...
MAIL_API_KEY=une-cle-longue-aleatoire
OVH_SMTP_HOST=ssl0.ovh.net
OVH_SMTP_PORT=465
OVH_SMTP_SECURE=ssl
OVH_SMTP_USERNAME=organisateurs@party-retro-chill-hub.fr
OVH_SMTP_PASSWORD=mot-de-passe-de-la-boite-ovh
MAIL_FROM=organisateurs@party-retro-chill-hub.fr
MAIL_FROM_NAME=Organisateurs Party Retro Chill Hub
```

`PRCH_AGENT_INSTRUCTIONS` doit decrire les criteres exacts de reussite de l'epreuve 7. Tant que ces criteres ne sont pas satisfaits, l'agent doit repondre sans fragment. Quand ils le sont, il renvoie le fragment et `api/agent.php` l'enregistre dans Sheets pour l'equipe connectee.

## Envoi de mails OVH

Le fichier `api/mail.php` envoie les emails via la boite OVH `organisateurs@party-retro-chill-hub.fr`. Les identifiants SMTP restent dans `api/config.php`, genere automatiquement au deploiement depuis les secrets GitHub. Les emails ne partent donc pas du compte Google personnel.

L'endpoint exige une cle serveur `MAIL_API_KEY`, a transmettre dans l'en-tete `X-PRCH-Mail-Key`. Ne pas appeler cet endpoint directement depuis une page publique avec cette cle, car elle serait visible dans le navigateur.

## PWA et notifications Push

Le site peut etre installe comme PWA via `manifest.webmanifest` et `service-worker.js`. La page `connexion.html` permet a un participant connecte d'activer ou desactiver les notifications app pour son appareil.

Les abonnements Push sont stockes dans la feuille `Push_Subscriptions`. Les notifications existantes utilisent deux canaux :

- email via `api/mail.php`, si `notifyByEmail` est actif ;
- notification app via `api/push.php`, si l'utilisateur a abonne son appareil.

Secrets GitHub a ajouter pour le deploiement :

```txt
PUSH_API_KEY=une-cle-serveur-longue
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:organisateurs@party-retro-chill-hub.fr
```

Pour generer les cles VAPID localement :

```powershell
php tools/generate-vapid-keys.php
```

Dans Apps Script, ajouter aussi les proprietes :

```txt
PRCH_PUSH_API_URL=https://party-retro-chill-hub.fr/api/push.php
PRCH_PUSH_API_KEY=la-meme-cle-que-PUSH_API_KEY
```

Si `PRCH_PUSH_API_KEY` n'est pas renseignee, le script essaie `PRCH_MAIL_API_KEY` en secours. En production, une cle dediee est preferable.

Exemple de test apres deploiement :

```bash
curl -X POST https://party-retro-chill-hub.fr/api/mail.php \
  -H "Content-Type: application/json" \
  -H "X-PRCH-Mail-Key: VOTRE_MAIL_API_KEY" \
  -d '{"to":"test@example.com","subject":"Test PRCH","text":"Message envoye depuis la boite OVH."}'
```

## Actions escape disponibles

Les pages web utilisent l'endpoint Apps Script en JSONP avec le parametre `action` :

```text
userRegister
userLogin
userLookupAvatar
requestPasswordReset
resetPassword
validateUserSession
userUpdatePreferences
listParticipants
chatList
chatPost
adminCreateUser
adminNotifySiteUpdate
get
getPredictions
savePrediction
joinTeam
validateSession
completeChallenge
adminList
adminCreateTeam
adminSetPassword
adminResetTeam
adminDeleteTeam
```

Les actions sensibles demandent soit `adminPassword`, soit `team` + `teamToken`.
Les comptes participants utilisent le pseudo comme `username`, avec `password`, `email`, `phone`, `notifyByEmail` et `avatar` a la creation. Ensuite `username` + `userToken` permettent de verifier la session locale.

Pour le rattrapage des personnes deja inscrites ou ayant deja vote, `adminCreateUser` permet de creer un compte sans mot de passe depuis Sheets/API. Le participant choisit ensuite sa photo sur `connexion.html`, utilise "mot de passe oublie", recoit un email via OVH et cree son mot de passe.

Pour le mot de passe oublie, `requestPasswordReset` recoit `identifier` et `resetUrl`, puis envoie un email si un compte actif correspond au pseudo ou a l'adresse mail. Le lien contient un token valable 30 minutes. `resetPassword` recoit ensuite `token` et `password`, met a jour le mot de passe et invalide le token.

Le chat utilise `chatList` et `chatPost`. Les notifications mail partent via `api/mail.php`, jamais via Gmail, si `notifyByEmail` est actif pour le destinataire.
Les messages prives des participants sont toujours adresses au compte special `organisateurs`. Creez donc un compte participant avec le pseudo `organisateurs` pour que les organisateurs puissent lire ces messages et repondre en prive.

Les messages envoyes par le compte `organisateurs` sont programmes pour 10h :

- avant 10h, ils deviennent visibles le jour meme a 10h ;
- a partir de 10h, ils deviennent visibles le lendemain a 10h ;
- les notifications liees a ces messages sont envoyees par `publishScheduledOrganizerMessages()`, via le declencheur installe avec `installOrganizerMessageTrigger()`.

Apps Script execute le declencheur autour de 10h, sans garantir la minute exacte.

`admin-communications.html` permet de :

- precreer un compte sans mot de passe pour une personne deja inscrite ou ayant deja vote ;
- envoyer une notification globale aux participants ayant active les notifications.

Pour precreer un compte, renseigner le pseudo, l'email et le chemin de la photo (`assets/avatar/...jpg`). Le participant choisira ensuite sa photo sur `connexion.html`, puis utilisera "mot de passe oublie" pour definir son mot de passe.
