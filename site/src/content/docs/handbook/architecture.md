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

The daemon uses composite hang detection with three independent signals:

1. **Log mtime** — when was the last write to any file in `~/.claude/projects/`?
2. **CPU activity** — is any Claude process above the 5% CPU threshold?
3. **Grace window** — 60-second buffer after first discovering a process, during which risk stays at OK regardless of other signals

Both log mtime and CPU must be quiet beyond the hang threshold (default 300 seconds) before risk escalates to WARN. After an additional 600 seconds at WARN, risk escalates to CRITICAL. No single false positive can trigger the alarm.

The `run` command watchdog monitors stdout/stderr of its child process specifically, while the `watch` daemon monitors all Claude processes system-wide.

## Incident state machine

The daemon tracks system health through a state machine:

```
ok → warn → critical → ok (closes incident)
```

Transitions are based on composite hang detection signals, disk pressure, and resource usage. Each transition:

- Logs the event to the journal and to `incidents.jsonl`
- May trigger automatic bundle capture (once per incident, on first critical, with per-PID rate limiting at 300-second cooldown)
- Adjusts the concurrency budget cap (4 → 2 → 1 slots)
- Deduplicates repeated incidents (an incident stays open until risk returns to OK)

The attention system layers on top: it combines hang risk, budget state, and active incidents into a single urgency level (none/info/warn/critical) with concrete recommended MCP tool calls.

## Reliability hardening

Guardian is built for continuous daily use:

- **Async mutexes** -- `withStateLock` and `withBudgetLock` serialize concurrent file I/O, preventing TOCTOU races between the daemon and MCP tools
- **Overlap guard** -- daemon polls are protected by a `pollInProgress` flag so slow polls cannot stack
- **Clock skew protection** -- all time deltas clamped with `Math.max(0, ...)` to handle system clock adjustments
- **Reverse-seek tail** -- large log files (>1MB) are tailed by reading chunks from the end, avoiding OOM on 500MB+ logs
- **Corruption recovery** -- corrupt `state.json` or `budget.json` files are backed up and reset with a journal entry for forensics
- **Atomic writes** -- state and budget files are written to `.tmp` then renamed, preventing partial reads

## Preflight cleaning

The preflight system protects important files:

- `memory/` directories are never touched
- `sessions-index.json` is preserved
- UUID-named files and directories older than 3 days are candidates for cleanup
- Stale session artifacts are the primary cleanup target
