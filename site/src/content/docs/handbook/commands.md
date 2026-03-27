---
title: Commands
description: Full CLI reference for claude-guardian.
sidebar:
  order: 2
---

## Command overview

| Command | Purpose |
|---------|---------|
| `preflight` | Scan Claude project logs, report oversized dirs/files, optionally auto-fix |
| `doctor` | Generate a diagnostics bundle (zip) with system info, log tails, journal |
| `run -- <cmd>` | Launch any command with watchdog monitoring, auto-bundle on crash/hang |
| `status` | One-shot health check: disk free, log sizes, warnings |
| `watch` | Background daemon: continuous monitoring, incident tracking, budget enforcement |
| `budget` | View and manage the concurrency budget (show/acquire/release) |
| `mcp` | Start MCP server (10 tools) for Claude Code self-monitoring |

## preflight

Scans `~/.claude/projects/` for oversized log directories and files.

```bash
# Report only
claude-guardian preflight

# Auto-fix: rotate + trim oversized logs
claude-guardian preflight --fix

# Aggressive mode: shorter retention, lower thresholds
claude-guardian preflight --fix --aggressive
```

Rotation compresses old logs with gzip (reversible). Trimming keeps the last N lines of oversized files. No files are deleted.

## doctor

Creates a zip bundle containing:

- `summary.json` — system info, file size report, preflight results
- `log-tails/` — last 500 lines of each log file
- `journal.jsonl` — every action the guardian has ever taken
- `process.json` — snapshot of running Claude processes at bundle time
- `timeline.json` — reconstructed chronological event timeline
- `state.json` — current daemon state (if daemon was running)
- `incidents.jsonl` — incident history (if any)

```bash
claude-guardian doctor
claude-guardian doctor --out ./my-bundle.zip
```

## run

Spawns a child process with watchdog monitoring.

```bash
claude-guardian run -- claude
claude-guardian run --hang-timeout 120 -- node server.js
claude-guardian run --auto-restart -- npm start
```

The watchdog uses three independent signals (log mtime, CPU activity, grace window) to detect hangs. No single false positive can trigger a hang declaration.

## status

Quick one-shot health check.

```bash
claude-guardian status
claude-guardian status --banner
```

Reports disk free space, log sizes, and a summary banner.

## watch

Background daemon for continuous monitoring.

```bash
claude-guardian watch
claude-guardian watch --verbose
claude-guardian watch --auto-fix --hang-timeout 120
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--hang-timeout <seconds>` | `300` | Seconds of inactivity before warning |
| `--auto-fix` | `false` | Auto-run preflight fixes when disk is low |
| `--verbose` | `false` | Print every poll cycle |

Tracks incidents through an ok → warn → critical lifecycle with automatic bundle capture and deduplication. The daemon persists state to `~/.claude-guardian/state.json` every 2 seconds so the MCP server can read it.

## budget

Manage the concurrency budget.

```bash
claude-guardian budget show
claude-guardian budget acquire 2 --reason "build" --ttl 60
claude-guardian budget release <lease-id>
```

Deterministic cap transitions (4 → 2 → 1 slots) prevent dogpiling when under pressure.
