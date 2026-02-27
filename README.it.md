<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-guardian/actions"><img src="https://github.com/mcp-tool-shop-org/claude-guardian/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/claude-guardian"><img src="https://img.shields.io/npm/v/@mcptoolshop/claude-guardian" alt="npm" /></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/claude-guardian"><img src="https://img.shields.io/codecov/c/github/mcp-tool-shop-org/claude-guardian" alt="Coverage" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Computer di bordo per Claude Code: rotazione dei log, watchdog, pacchetti di crash e consapevolezza di sé dell'MCP.

Claude Guardian è un livello di affidabilità locale che mantiene le sessioni di Claude Code in buono stato. Rileva problemi di spazio nei log, pressione sul disco e blocchi prima che causino problemi, registra le informazioni quando qualcosa va storto e espone un server MCP in modo che Claude possa monitorare se stesso durante la sessione.

## Cosa fa

| Comando | Scopo |
|---------|---------|
| `preflight` | Scansiona i log del progetto Claude, segnala directory/file di dimensioni eccessive, corregge automaticamente (opzionale). |
| `doctor` | Genera un pacchetto diagnostico (zip) con informazioni sul sistema, ultime righe dei log e registro. |
| `run -- <cmd>` | Esegue qualsiasi comando con monitoraggio watchdog, crea automaticamente un pacchetto in caso di crash/blocco. |
| `status` | Controllo rapido dello stato: spazio libero su disco, dimensioni dei log, avvisi. |
| `watch` | Demone in background: monitoraggio continuo, tracciamento degli incidenti, applicazione dei limiti. |
| `budget` | Visualizza e gestisci il budget di concorrenza (mostra/acquisisci/rilascia). |
| `mcp` | Avvia il server MCP (8 strumenti) per l'auto-monitoraggio di Claude Code. |

## Installazione

```bash
npm install -g claude-guardian
```

Oppure eseguilo direttamente:

```bash
npx claude-guardian preflight
```

## Guida rapida

### Verifica il tuo ambiente

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

### Correzione automatica dei log troppo grandi

```bash
claude-guardian preflight --fix
```

Ruota i vecchi log (gzip), riduce le dimensioni dei file `.jsonl`/`.log` troppo grandi alle ultime N righe. Ogni azione viene registrata in un file di registro per la tracciabilità.

### Genera un report di crash

```bash
claude-guardian doctor --out ./bundle.zip
```

Crea un file zip contenente:
- `summary.json` — informazioni sul sistema, report delle dimensioni dei file, risultati delle verifiche preliminari.
- `log-tails/` — ultime 500 righe di ogni file di log.
- `journal.jsonl` — ogni azione eseguita dal guardian.

### Esegui con watchdog

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

Il watchdog:
1. Esegue il tuo comando come processo figlio.
2. Monitora stdout/stderr per l'attività.
3. Se non c'è attività per `--hang-timeout` secondi → crea un pacchetto diagnostico.
4. Se il processo si blocca → crea un pacchetto, riavvia opzionalmente con un ritardo.

## Server MCP (la vera funzionalità)

Registra il guardian come server MCP locale in modo che Claude possa monitorare se stesso:

Aggiungi a `~/.claude.json`:

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

Quindi Claude può chiamare:

| Strumento | Cosa restituisce |
|------|----------------|
| `guardian_status` | Spazio su disco, log, processi, rischio di blocco, budget, livello di attenzione. |
| `guardian_preflight_fix` | Esegue la rotazione/riduzione dei log, restituisce il report prima/dopo. |
| `guardian_doctor` | Crea un pacchetto diagnostico (zip), restituisce il percorso e il riepilogo. |
| `guardian_nudge` | Correzione automatica sicura: corregge i log se troppo grandi, crea un pacchetto se necessario. |
| `guardian_budget_get` | Limite di concorrenza corrente, slot in uso, licenze attive. |
| `guardian_budget_acquire` | Richiedi slot di concorrenza (restituisce l'ID della licenza). |
| `guardian_budget_release` | Rilascia una licenza quando hai finito con i lavori pesanti. |
| `guardian_recovery_plan` | Piano di ripristino passo-passo che indica gli strumenti specifici da chiamare. |

Questo permette a Claude di dire: *"Attenzione: livello WARN. Esecuzione di `guardian_nudge`, quindi riduzione della concorrenza."*

## Configurazione

Tre impostazioni (tutto il resto è predefinito):

| Flag | Valore predefinito | Descrizione |
|------|---------|-------------|
| `--max-log-mb` | `200` | Dimensione massima della directory dei log del progetto in MB. |
| `--hang-timeout` | `300` | Secondi di inattività prima di segnalare un blocco. |
| `--auto-restart` | `false` | Riavvio automatico in caso di crash/blocco. |

Inoltre, una protezione aggiuntiva predefinita:
- **Spazio libero su disco < 5GB** → modalità aggressiva abilitata automaticamente (ritenzione più breve, soglie inferiori).

## Modello di fiducia

Claude Guardian è **locale**. Non ha listener di rete, telemetria o dipendenze dal cloud.

**Cosa legge:** `~/.claude/projects/` (file di log, dimensioni, orari di modifica), elenco dei processi (CPU, memoria, uptime, conteggio degli handle per i processi relativi a Claude tramite `pidusage`).

**Cosa scrive:** `~/.claude-guardian/` (file state.json, budget.json, journal.jsonl, e pacchetti di dati). Tutti i file si trovano nella directory home dell'utente.

**Cosa raccoglie nei pacchetti di dati:** Informazioni sul sistema (sistema operativo, CPU, memoria, disco), le ultime 500 righe dei file di log, istantanee dei processi e il registro di eventi di Guardian stesso. Non vengono raccolte chiavi API, token, credenziali o contenuti generati dall'utente.

**Azioni pericolose — cosa Guardian NON farà:**
- Terminare processi o inviare segnali (nessun `SIGKILL`, nessun `SIGTERM`)
- Riavviare Claude Code o qualsiasi altro processo
- Eliminare file (la rotazione avviene tramite compressione gzip, la rimozione avviene mantenendo le ultime N righe)
- Effettuare richieste di rete o inviare dati a server esterni
- Elevare i privilegi o accedere ai dati di altri utenti

Se in futuro venissero aggiunte funzionalità per terminare processi o riavviarli automaticamente, queste saranno attivate solo tramite un'opzione esplicita, documentata qui, e saranno disattivate per impostazione predefinita.

## Principi di progettazione

- **Dati concreti, non impressioni** — ogni azione genera una voce nel registro; i pacchetti di dati catturano lo stato, non supposizioni.
- **Determinismo** — nessun utilizzo di machine learning, nessuna euristica oltre all'età e alla dimensione dei file. Una tabella decisionale che si può leggere in 60 secondi.
- **Sicurezza predefinita** — la rotazione avviene tramite compressione gzip (reversibile), la rimozione avviene mantenendo le ultime N righe (i dati vengono preservati), nessuna eliminazione nella versione 1.
- **Dipendenze semplici** — commander, pidusage, archiver, @modelcontextprotocol/sdk. Niente di più.

## Sviluppo

```bash
npm install
npm run build
npm test
```

## Valutazione

| Categoria | Punteggio | Note |
|----------|-------|-------|
| A. Sicurezza | 10/10 | FILE SECURITY.md, solo locale, nessuna telemetria, nessun servizio cloud |
| B. Gestione degli errori | 10/10 | GuardianError (codice + suggerimento + causa), errori strutturati MCP, codici di uscita |
| C. Documentazione per gli operatori | 10/10 | FILE README, CHANGELOG, HANDBOOK, SHIP_GATE, guida passo passo |
| D. Qualità del codice | 9/10 | CI + test (152), pubblicato su npm, VSIX non disponibile |
| E. Identità | 10/10 | Logo, traduzioni, pagina di presentazione, elenco su npm |
| **Total** | **49/50** | |

## Licenza

MIT

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
