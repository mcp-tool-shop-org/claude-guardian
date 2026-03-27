---
title: Beginners Guide
description: New to claude-guardian? Start here for a quick orientation.
sidebar:
  order: 99
---

## What is this tool?

Claude Guardian is a local reliability layer for Claude Code. It monitors your Claude Code sessions for common problems -- log files growing out of control, disk space running low, and processes that stop responding -- and takes safe corrective action before those problems crash your session.

It works in two modes: as a CLI tool you run manually (health checks, log cleanup, crash reports) and as an MCP server that lets Claude monitor itself during a session. When registered as an MCP server, Claude can check its own health, clean up logs, capture diagnostics, and manage concurrency without human intervention.

Guardian never deletes files, never kills processes, and never phones home. Log rotation uses gzip (reversible), trimming keeps the last N lines, and all actions are logged to a journal for auditability.

## Who is this for?

- **Claude Code users** who run long sessions (multi-hour coding, multi-agent workflows) and want automatic protection against log bloat and hangs
- **Multi-Claude operators** running parallel Claude agents who need concurrency budgets to prevent resource dogpiling
- **Anyone filing bug reports** who wants a one-command diagnostics bundle instead of manually collecting logs and system info

You do not need this tool if you run short Claude Code sessions and rarely encounter hangs or disk pressure.

## Prerequisites

- **Node.js 18 or later** -- Guardian is a Node.js CLI tool distributed via npm
- **Claude Code** -- Guardian monitors `~/.claude/projects/` log files, so Claude Code must be installed
- **npm or npx** -- for installation and execution

No additional system dependencies are required. Guardian uses only Node.js built-in modules plus four small dependencies (commander, pidusage, archiver, @modelcontextprotocol/sdk).

## Your first 5 minutes

**1. Install (or use npx)**

```bash
npm install -g @mcptoolshop/claude-guardian
```

**2. Run a health check**

```bash
claude-guardian status
```

This shows disk free space, total Claude log size, per-project breakdowns, and any issues found. The one-line banner at the bottom gives a quick summary.

**3. Fix any warnings**

If the status report shows oversized logs or low disk warnings:

```bash
claude-guardian preflight --fix
```

This rotates old logs (gzip) and trims oversized files. Every action is logged to `~/.claude-guardian/journal.jsonl`.

**4. Register the MCP server**

Add this to your `~/.claude.json` so Claude can self-monitor:

```json
{
  "mcpServers": {
    "guardian": {
      "command": "npx",
      "args": ["@mcptoolshop/claude-guardian", "mcp"]
    }
  }
}
```

**5. Verify it works**

Start a new Claude Code session. Claude now has access to 10 guardian tools. Ask Claude to run `guardian_status` and it will report on its own environment health.

## Common mistakes

**Using the wrong package name.** The npm package is `@mcptoolshop/claude-guardian`, not `claude-guardian`. Install with `npm install -g @mcptoolshop/claude-guardian`.

**Forgetting to register the MCP server.** The CLI and MCP server are separate entry points. Installing the CLI does not automatically give Claude access to guardian tools. You must add the `mcpServers` entry to `~/.claude.json`.

**Running preflight without --fix.** Plain `claude-guardian preflight` only reports issues. Add `--fix` to actually rotate and trim logs.

**Confusing `run` and `watch`.** The `run` command wraps a single child process with watchdog monitoring. The `watch` command is a background daemon that monitors all Claude processes system-wide and persists state for the MCP server. For most users, the MCP server alone is sufficient.

**Budget commands use positional arguments.** The budget acquire command takes a positional slot count: `claude-guardian budget acquire 2`, not `--slots 2`. Similarly, release takes a positional lease ID.

## Next steps

- Read the [Commands](/claude-guardian/handbook/commands/) page for the full CLI reference
- Read the [MCP Server](/claude-guardian/handbook/mcp-server/) page to understand all 10 tools Claude can call
- Read [Configuration](/claude-guardian/handbook/configuration/) if you need to adjust thresholds or understand data locations
- Read [Architecture](/claude-guardian/handbook/architecture/) for details on hang detection and incident tracking
- Read [Security](/claude-guardian/handbook/security/) to understand what Guardian reads, writes, and collects

## Glossary

| Term | Definition |
|------|-----------|
| **Preflight** | A scan of `~/.claude/projects/` that reports oversized logs and disk warnings. With `--fix`, it rotates and trims files. |
| **Doctor bundle** | A zip file containing system info, log tails, process snapshots, timeline, and the guardian journal. Used for bug reports and post-incident analysis. |
| **Watchdog** | The `run` command's child-process monitor. Detects hangs and crashes by monitoring stdout/stderr activity. |
| **Watch daemon** | The `watch` command's background process. Polls every 2 seconds, tracks incidents, adjusts the concurrency budget, and persists state for the MCP server. |
| **Hang risk** | A three-level assessment (ok/warn/critical) based on composite signals: log file modification time, CPU activity, and a grace window after process discovery. |
| **Attention** | A top-level urgency signal (none/info/warn/critical) that combines hang risk, budget state, and active incidents into a single actionable recommendation. |
| **Incident** | A period where hang risk is at warn or critical. Opens automatically, closes when risk returns to ok. Bundle capture happens once per incident on first critical. |
| **Budget** | A concurrency control system with a slot cap (default 4) that automatically reduces under pressure (2 at warn, 1 at critical). Leases are time-limited and auto-expire. |
| **Hysteresis** | After risk returns to ok, the budget cap stays reduced for 60 seconds before restoring to prevent flapping. |
| **Journal** | An append-only JSONL log at `~/.claude-guardian/journal.jsonl` recording every action Guardian takes (rotations, trims, bundle captures, lease expirations). |
| **Nudge** | A safe "do the right thing" action: fix logs if bloated, capture a bundle if risk is elevated, and return guidance on what to do next. Never kills processes. |
| **Grace window** | A 60-second buffer after first discovering a Claude process, during which hang risk stays at ok regardless of other signals. Prevents false alarms during startup. |
