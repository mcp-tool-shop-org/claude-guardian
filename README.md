<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Flight computer for Claude Code — log rotation, watchdog, crash bundles, and MCP self-awareness.

Claude Guardian is a local reliability layer that keeps Claude Code sessions healthy. It detects log bloat, disk pressure, and hangs before they cause problems, captures evidence when things go wrong, and exposes an MCP server so Claude can self-monitor mid-session.

## What it does

| Command | Purpose |
|---------|---------|
| `preflight` | Scan Claude project logs, report oversized dirs/files, optionally auto-fix |
| `doctor` | Generate a diagnostics bundle (zip) with system info, log tails, journal |
| `run -- <cmd>` | Launch any command with watchdog monitoring, auto-bundle on crash/hang |
| `status` | One-shot health check: disk free, log sizes, warnings |
| `watch` | Background daemon: continuous monitoring, incident tracking, budget enforcement |
| `budget` | View and manage the concurrency budget (show/acquire/release) |
| `mcp` | Start MCP server (8 tools) for Claude Code self-monitoring |

## Install

```bash
npm install -g claude-guardian
```

Or run directly:

```bash
npx claude-guardian preflight
```

## Quick start

### Check your environment

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

### Auto-fix log bloat

```bash
claude-guardian preflight --fix
```

Rotates old logs (gzip), trims oversized `.jsonl`/`.log` files to their last N lines. Every action is logged to a journal file for traceability.

### Generate a crash report

```bash
claude-guardian doctor --out ./bundle.zip
```

Creates a zip containing:
- `summary.json` — system info, file size report, preflight results
- `log-tails/` — last 500 lines of each log file
- `journal.jsonl` — every action the guardian has ever taken

### Run with watchdog

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

The watchdog:
1. Spawns your command as a child process
2. Monitors stdout/stderr for activity
3. If no activity for `--hang-timeout` seconds → captures a doctor bundle
4. If the process crashes → captures a bundle, optionally restarts with backoff

## MCP Server (the real unlock)

Register the guardian as a local MCP server so Claude can self-monitor:

Add to `~/.claude.json`:

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

Then Claude can call:

| Tool | What it returns |
|------|----------------|
| `guardian_status` | Disk, logs, processes, hang risk, budget, attention level |
| `guardian_preflight_fix` | Runs log rotation/trimming, returns before/after report |
| `guardian_doctor` | Creates diagnostics bundle (zip), returns path + summary |
| `guardian_nudge` | Safe auto-remediation: fix logs if bloated, capture bundle if needed |
| `guardian_budget_get` | Current concurrency cap, slots in use, active leases |
| `guardian_budget_acquire` | Request concurrency slots (returns lease ID) |
| `guardian_budget_release` | Release a lease when done with heavy work |
| `guardian_recovery_plan` | Step-by-step recovery plan naming exact tools to call |

This lets Claude say: *"Attention is WARN. Running `guardian_nudge`, then reducing concurrency."*

## Configuration

Three knobs (everything else is hardcoded with sane defaults):

| Flag | Default | Description |
|------|---------|-------------|
| `--max-log-mb` | `200` | Max project log directory size in MB |
| `--hang-timeout` | `300` | Seconds of inactivity before declaring a hang |
| `--auto-restart` | `false` | Auto-restart on crash/hang |

Plus one hardcoded guardrail:
- **Disk free < 5GB** → aggressive mode auto-enabled (shorter retention, lower thresholds)

## Trust model

Claude Guardian is **local-only**. It has no network listener, no telemetry, and no cloud dependency.

**What it reads:** `~/.claude/projects/` (log files, sizes, modification times), process list (CPU, memory, uptime, handle counts for Claude-related processes via `pidusage`).

**What it writes:** `~/.claude-guardian/` (state.json, budget.json, journal.jsonl, doctor bundles). All files are under the user's home directory.

**What it collects in bundles:** System info (OS, CPU, memory, disk), log file tails (last 500 lines), process snapshots, and guardian's own journal. No API keys, tokens, credentials, or user content.

**Dangerous actions — what Guardian will NOT do:**
- Kill processes or send signals (no `SIGKILL`, no `SIGTERM`)
- Restart Claude Code or any other process
- Delete files (rotation = gzip, trimming = keep last N lines)
- Make network requests or phone home
- Elevate privileges or access other users' data

If process killing or auto-restart is ever added, it will be behind an explicit opt-in flag, documented here, and off by default.

## Design principles

- **Evidence over vibes** — every action writes a journal entry; crash bundles capture state, not guesses
- **Deterministic** — no ML, no heuristics beyond file age and size. Decision table you can read in 60 seconds
- **Safe by default** — rotation = gzip (reversible), trimming = keep last N lines (data preserved), no deletions in v1
- **Boring dependencies** — commander, pidusage, archiver, @modelcontextprotocol/sdk. That's it.

## Development

```bash
npm install
npm run build
npm test
```

## Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 10/10 | SECURITY.md, local-only, no telemetry, no cloud |
| B. Error Handling | 10/10 | GuardianError (code+hint+cause), structured MCP errors, exit codes |
| C. Operator Docs | 10/10 | README, CHANGELOG, HANDBOOK, SHIP_GATE, walkthrough |
| D. Shipping Hygiene | 9/10 | CI + tests (152), npm published, VSIX n/a |
| E. Identity | 10/10 | Logo, translations, landing page, npm listing |
| **Total** | **49/50** | |

## License

MIT

---

Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
