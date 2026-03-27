---
title: Getting Started
description: Install claude-guardian and run your first health check.
sidebar:
  order: 1
---

## Install

Install globally via npm:

```bash
npm install -g @mcptoolshop/claude-guardian
```

Or run directly without installing:

```bash
npx @mcptoolshop/claude-guardian preflight
```

## First health check

Run `status` to see how your environment looks:

```bash
claude-guardian status
```

This prints disk free space, total Claude project log size, per-project breakdowns, and any issues found (oversized logs, low disk). The one-line banner at the bottom gives you a quick summary.

## Auto-fix log bloat

If the status report shows warnings about oversized logs, auto-fix them:

```bash
claude-guardian preflight --fix
```

This rotates old logs (gzip compression, reversible) and trims oversized `.jsonl` and `.log` files to their last N lines. Every action is logged to a journal file for traceability.

## Generate a crash report

If something went wrong and you need evidence for a bug report:

```bash
claude-guardian doctor --out ./bundle.zip
```

The bundle contains system info, log file tails, and the guardian's own action journal.

## Run with watchdog

Wrap any command with the watchdog to get automatic hang detection and crash bundles:

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

The watchdog monitors stdout/stderr for activity. If no output appears for the configured timeout, it captures a doctor bundle. If the process crashes, it captures a bundle and optionally restarts with backoff.
