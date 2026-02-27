<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-guardian/actions"><img src="https://github.com/mcp-tool-shop-org/claude-guardian/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Ordinateur de bord pour Claude Code : rotation des journaux, surveillance, regroupement des erreurs, et auto-évaluation de l'environnement d'exécution (MCP).

Claude Guardian est une couche de fiabilité locale qui maintient les sessions Claude Code en bon état. Il détecte les problèmes de taille des journaux, la saturation du disque et les blocages avant qu'ils ne causent des problèmes, enregistre les informations pertinentes en cas de problème, et expose un serveur MCP afin que Claude puisse s'auto-surveiller pendant les sessions.

## Ce qu'il fait

| Commande | Fonction |
|---------|---------|
| `preflight` | Analyse les journaux du projet Claude, signale les répertoires/fichiers trop volumineux, corrige automatiquement (optionnel). |
| `doctor` | Génère un ensemble de diagnostics (zip) contenant des informations système, les dernières lignes des journaux et un journal. |
| `run -- <cmd>` | Exécute n'importe quelle commande avec surveillance, crée automatiquement un regroupement en cas de plantage/blocage. |
| `status` | Vérification de l'état : espace disque disponible, taille des journaux, avertissements. |
| `watch` | Démon en arrière-plan : surveillance continue, suivi des incidents, application des limites. |
| `budget` | Affiche et gère la limite de concurrence (afficher/acquérir/libérer). |
| `mcp` | Démarre le serveur MCP (8 outils) pour l'auto-surveillance de Claude Code. |

## Installation

```bash
npm install -g claude-guardian
```

Ou exécutez directement :

```bash
npx claude-guardian preflight
```

## Démarrage rapide

### Vérifiez votre environnement

```bash
claude-guardian status
```

```
=== Claude Guardian Preflight ===

Disk free: 607.13GB [OK]
Claude projects: C:\Users\you\.claude\projects
Total size: 1057.14MB

Project directories (by size):
  my-project: 1020.41MB

Issues found:
  [WARNING] Project log dir is 1020.41MB (limit: 200MB)
  [WARNING] File is 33.85MB (limit: 25MB)

[guardian] disk=607.13GB | logs=1057.14MB | issues=2
```

### Corrige automatiquement les problèmes de taille des journaux

```bash
claude-guardian preflight --fix
```

Effectue la rotation des anciens journaux (gzip), réduit la taille des fichiers `.jsonl` et `.log` trop volumineux en ne conservant que les N dernières lignes. Chaque action est enregistrée dans un fichier journal pour la traçabilité.

### Génère un rapport de plantage

```bash
claude-guardian doctor --out ./bundle.zip
```

Crée un fichier zip contenant :
- `summary.json` : informations système, rapport de taille des fichiers, résultats de vérification préliminaire.
- `log-tails/` : les 500 dernières lignes de chaque fichier journal.
- `journal.jsonl` : toutes les actions effectuées par le système de surveillance.

### Exécute avec surveillance

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

La surveillance :
1. Lance votre commande en tant que processus enfant.
2. Surveille la sortie standard (stdout) et la sortie d'erreur (stderr) pour détecter l'activité.
3. Si aucune activité pendant `--hang-timeout` secondes, un ensemble de diagnostics est créé.
4. Si le processus plante, un ensemble est créé, et il peut être redémarré avec un délai progressif.

## Serveur MCP (la véritable fonctionnalité)

Enregistrez le système de surveillance en tant que serveur MCP local afin que Claude puisse s'auto-surveiller :

Ajoutez ceci à `~/.claude.json` :

```json
{
  "mcpServers": {
    "guardian": {
      "command": "npx",
      "args": ["claude-guardian", "mcp"]
    }
  }
}
```

Ensuite, Claude peut appeler :

| Outil | Ce qu'il renvoie |
|------|----------------|
| `guardian_status` | Espace disque, journaux, processus, risque de blocage, limite, niveau d'attention. |
| `guardian_preflight_fix` | Effectue la rotation/réduction des journaux, renvoie un rapport avant/après. |
| `guardian_doctor` | Crée un ensemble de diagnostics (zip), renvoie le chemin et un résumé. |
| `guardian_nudge` | Correction automatique sécurisée : corrige les journaux s'ils sont trop volumineux, crée un ensemble si nécessaire. |
| `guardian_budget_get` | Limite de concurrence actuelle, emplacements utilisés, licences actives. |
| `guardian_budget_acquire` | Demande des emplacements de concurrence (renvoie l'ID de la licence). |
| `guardian_budget_release` | Libère une licence une fois le travail intensif terminé. |
| `guardian_recovery_plan` | Plan de récupération étape par étape, indiquant les outils à utiliser. |

Cela permet à Claude de dire : "L'attention est à niveau AVERTISSEMENT. Exécution de `guardian_nudge`, puis réduction de la concurrence."

## Configuration

Trois paramètres (tout le reste est codé en dur avec des valeurs par défaut raisonnables) :

| Paramètre | Valeur par défaut | Description |
|------|---------|-------------|
| `--max-log-mb` | `200` | Taille maximale du répertoire des journaux du projet en Mo. |
| `--hang-timeout` | `300` | Nombre de secondes d'inactivité avant de déclarer un blocage. |
| `--auto-restart` | `false` | Redémarrage automatique en cas de plantage/blocage. |

Plus une règle de sécurité codée en dur :
- **Espace disque disponible < 5 Go** → le mode agressif est activé automatiquement (conservation plus courte, seuils plus bas).

## Modèle de confiance

Claude Guardian est **local uniquement**. Il n'a pas de listener réseau, de télémétrie ni de dépendance au cloud.

**Ce qu'il lit :** `~/.claude/projects/` (fichiers journaux, tailles, dates de modification), liste des processus (utilisation du CPU, mémoire, temps de fonctionnement, nombre de descripteurs pour les processus liés à Claude via `pidusage`).

**Ce qu'il écrit :** `~/.claude-guardian/` (state.json, budget.json, journal.jsonl, doctor bundles). Tous les fichiers se trouvent dans le répertoire personnel de l'utilisateur.

**Ce qu'il collecte dans les rapports :** Informations système (OS, CPU, mémoire, disque), extraits de fichiers journaux (les 500 dernières lignes), instantanés des processus et le propre journal de Guardian. Aucune clé API, aucun jeton, aucune identifiant, ni aucun contenu utilisateur.

**Actions dangereuses — ce que Guardian NE fera PAS :**
- Terminer des processus ou envoyer des signaux (pas de `SIGKILL`, pas de `SIGTERM`)
- Redémarrer Claude Code ou tout autre processus
- Supprimer des fichiers (la rotation se fait par compression gzip, la suppression se limite aux N dernières lignes)
- Effectuer des requêtes réseau ou contacter un serveur central
- Accorder des privilèges supérieurs ou accéder aux données d'autres utilisateurs

Si la terminaison de processus ou le redémarrage automatique étaient un jour ajoutés, cela se ferait via un indicateur d'activation explicite, documenté ici, et serait désactivé par défaut.

## Principes de conception

- **Preuves plutôt que suppositions** — chaque action génère une entrée de journal ; les rapports capturent l'état, et non des conjectures.
- **Déterministe** — pas d'apprentissage automatique, pas d'heuristiques au-delà de l'âge et de la taille des fichiers. Tableau de décision que vous pouvez lire en 60 secondes.
- **Sûr par défaut** — la rotation se fait par compression gzip (réversible), la suppression se limite aux N dernières lignes (les données sont préservées), aucune suppression dans la version 1.
- **Dépendances simples** — commander, pidusage, archiver, @modelcontextprotocol/sdk. C'est tout.

## Développement

```bash
npm install
npm run build
npm test
```

## Licence

MIT

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
