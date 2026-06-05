# API Google Sheets mutualisee

Le site utilise deja un Web App Apps Script pour `inscription.html`.
L'objectif est de garder cette meme URL et d'ajouter les routes de l'escape game.

URL actuellement configuree dans le site:

```txt
https://script.google.com/macros/s/AKfycbzLLcmDo0bCMj-GYcdLblfkYV9v4aCwr5YB5b-ezbK6u4vgQkRUbWiQXCWJZ-nsVydo/exec
```

Elle est centralisee dans:

```txt
assets/api-config.js
```

## 1. Mettre a jour l'Apps Script existant

1. Ouvrir le Google Sheet deja utilise pour les inscriptions.
2. Aller dans `Extensions` > `Apps Script`.
3. Remplacer le contenu de `Code.gs` par le contenu de `apps-script/Code.gs`.
4. Enregistrer.
5. Executer la fonction `setupSheets`.
6. Accepter les autorisations si Google les redemande.
7. Aller dans `Parametres du projet` > `Proprietes du script`.
8. Ajouter une propriete:
   - Nom: `PRCH_ADMIN_PASSWORD`
   - Valeur: le mot de passe organisateur de ton choix

Le script cree ou reutilise ces onglets:

- `Inscriptions`
- `Escape_Teams`
- `Escape_Progress`

## 2. Redeployer le Web App existant

1. Cliquer sur `Deployer` > `Gerer les deploiements`.
2. Selectionner le deploiement Web App existant.
3. Cliquer sur l'icone crayon.
4. Choisir `Nouvelle version`.
5. Verifier:
   - Executer en tant que: `Moi`
   - Qui a acces: `Tout le monde`
6. Cliquer sur `Deployer`.

L'URL `/exec` doit rester la meme si tu modifies le deploiement existant.

## 3. Tester

### Inscription

1. Ouvrir `inscription.html`.
2. Verifier que la liste des inscrits charge encore.
3. Envoyer une inscription de test.

### Escape game

1. Ouvrir `escape.html`.
2. Verifier que le dashboard affiche `Synchronisation Google Sheets active.`
3. Ouvrir `admin-escape.html`.
4. Charger l'admin avec `PRCH_ADMIN_PASSWORD`.
5. Creer une equipe avec son mot de passe.
6. Ouvrir `rejoindre-equipe.html` et rejoindre cette equipe.
7. Ouvrir une epreuve et la valider.
5. Verifier les onglets `Escape_Teams` et `Escape_Progress`.

## Fonctionnement technique

- Sans parametre `action`, l'API repond au module inscription.
- Avec `action=get`, l'API expose le dashboard public.
- Avec `action=joinTeam`, l'API verifie le mot de passe equipe et renvoie un token local.
- Avec `action=completeChallenge`, l'API exige le token equipe avant d'ecrire la progression.
- Avec `action=adminList`, `action=adminCreateTeam`, `action=adminSetPassword`, `action=adminResetTeam` ou `action=adminDeleteTeam`, l'API exige `PRCH_ADMIN_PASSWORD`.
- Le site reste statique et communique avec Apps Script en JSONP pour les lectures/actions escape.
- Les inscriptions continuent a utiliser `fetch(..., { mode: 'no-cors' })` pour l'envoi du formulaire.
