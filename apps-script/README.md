# API Google Sheets

Ce dossier contient le code Apps Script qui sert de source de verite pour :

- les inscriptions,
- les pronostics organisateurs,
- les equipes de l'escape game,
- les mots de passe d'equipe,
- les fragments collectes.

Le script Apps Script ne contient pas la logique OpenAI. L'epreuve 7 passe par `api/agent.php`, deployee sur l'hebergement PHP, puis ce PHP appelle Apps Script pour verifier la session d'equipe et enregistrer le fragment.

## Installation Apps Script

1. Ouvrir le Google Sheets existant.
2. Aller dans `Extensions > Apps Script`.
3. Copier le contenu de `Code.gs`.
4. Executer `setupSheets()` une premiere fois.
5. Dans `Project Settings > Script Properties`, ajouter :

```text
PRCH_ADMIN_PASSWORD=mot-de-passe-admin
```

6. Deployer en application web :

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
```

`PRCH_AGENT_INSTRUCTIONS` doit decrire les criteres exacts de reussite de l'epreuve 7. Tant que ces criteres ne sont pas satisfaits, l'agent doit repondre sans fragment. Quand ils le sont, il renvoie le fragment et `api/agent.php` l'enregistre dans Sheets pour l'equipe connectee.

## Actions escape disponibles

Les pages web utilisent l'endpoint Apps Script en JSONP avec le parametre `action` :

```text
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
