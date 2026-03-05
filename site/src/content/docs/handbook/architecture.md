---
title: Architecture
description: Design principles and how the watchdog works.
sidebar:
  order: 5
---

## Design principles

Claude Guardian follows four core principles:

**Evidence over vibes** — Every action writes a journal entry. Crash bundles capture state, not guesses. When you file a bug report, attach a bundle instead of a description.

**Deterministic** — No ML, no heuristics beyond file age and size. The decision table is small enough to read in 60 seconds. Given the same inputs, the guardian always makes the same decision.

**Safe by default** — Rotation compresses with gzip (reversible). Trimming keeps the last N lines (data preserved). No files are deleted in v1. The guardian will never make things worse.

**Boring dependencies** — commander, pidusage, archiver, @modelcontextprotocol/sdk. That's the full list. No frameworks, no build tools beyond TypeScript.

## Hang detection

The watchdog uses composite hang detection with three independent signals:

1. **Log mtime** — when was the last write to stdout/stderr?
2. **CPU activity** — is the child process actually doing work?
3. **Grace window** — short buffer to avoid false positives during legitimate pauses

All three signals must agree before a hang is declared. No single false positive can trigger the alarm.

## Incident state machine

The guardian tracks system health through a state machine:

```
ok → warn → critical
```

Transitions are based on disk pressure, log sizes, and process health. Each transition:

- Logs the event to the journal
- May trigger automatic bundle capture
- Adjusts the concurrency budget cap
- Deduplicates repeated incidents

## Preflight cleaning

The preflight system protects important files:

- `memory/` directories are never touched
- `sessions-index.json` is preserved
- UUID-named files and directories older than 3 days are candidates for cleanup
- Stale session artifacts are the primary cleanup target
