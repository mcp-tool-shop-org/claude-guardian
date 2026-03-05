---
title: Security
description: Trust model and data scope.
sidebar:
  order: 6
---

Claude Guardian is **local-only**. It has no network listener, no telemetry, and no cloud dependency.

## What it reads

- `~/.claude/projects/` — log files, sizes, modification times
- Process list — CPU, memory, uptime, handle counts for Claude-related processes (via `pidusage`)

## What it writes

- `~/.claude-guardian/` — state.json, budget.json, journal.jsonl, doctor bundles
- All files are under the user's home directory

## What it collects in bundles

Doctor bundles contain:

- System info (OS, CPU, memory, disk)
- Log file tails (last 500 lines)
- Process snapshots
- Guardian's own journal

Bundles never contain API keys, tokens, credentials, or user content.

## What Guardian will NOT do

- Kill processes or send signals (no SIGKILL, no SIGTERM)
- Restart Claude Code or any other process
- Delete files (rotation = gzip, trimming = keep last N lines)
- Make network requests or phone home
- Elevate privileges or access other users' data

If process killing or auto-restart is ever added, it will be behind an explicit opt-in flag and off by default.

## Error handling

All errors use `GuardianError` with structured fields:

- `code` — machine-readable error code
- `hint` — actionable guidance for the user
- `cause` — upstream error (if any)

MCP tool errors never expose stack traces. The safe output mode strips internal details before returning to the caller.
