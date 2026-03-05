---
title: Configuration
description: Knobs, thresholds, and aggressive mode.
sidebar:
  order: 4
---

Claude Guardian ships with sane defaults and exposes only three knobs. Everything else is hardcoded to keep the decision surface small.

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--max-log-mb` | `200` | Max project log directory size in MB |
| `--hang-timeout` | `300` | Seconds of inactivity before declaring a hang |
| `--auto-restart` | `false` | Auto-restart on crash/hang |

## Automatic aggressive mode

When disk free space drops below 5 GB, aggressive mode auto-enables:

- Shorter log retention
- Lower size thresholds for rotation
- More aggressive trimming

This is a hardcoded guardrail that cannot be disabled. If disk is critically low, the guardian protects the system first.

## Concurrency budget

The budget system uses deterministic cap transitions:

| Attention level | Max concurrent slots |
|----------------|---------------------|
| OK | 4 |
| WARN | 2 |
| CRITICAL | 1 |

Leases are time-limited (TTL in seconds) and automatically expire. The budget prevents multiple heavy operations from dogpiling when the system is already under pressure.

## Data locations

All guardian state lives under `~/.claude-guardian/`:

| File | Purpose |
|------|---------|
| `state.json` | Current attention level and incident state |
| `budget.json` | Concurrency leases and cap |
| `journal.jsonl` | Append-only log of every guardian action |
| `bundles/` | Doctor diagnostics bundles (zip files) |
