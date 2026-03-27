---
title: MCP Server
description: The 10 tools Claude can call mid-session for self-monitoring.
sidebar:
  order: 3
---

The MCP server is the real unlock. Register claude-guardian as a local MCP server and Claude can self-monitor mid-session — checking health, fixing logs, capturing bundles, and managing concurrency.

## Setup

Add to your `~/.claude.json`:

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

## Tools

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
| `guardian_preview_ready` | Poll a port until the dev server responds (use after `preview_start`) |
| `guardian_preview_recover` | Diagnose stuck preview sessions, classify project type, guide recovery |

## How Claude uses it

With the MCP server registered, Claude can reason about its own health:

1. Call `guardian_status` to check current conditions
2. If attention level is WARN or CRITICAL, call `guardian_nudge` for safe auto-remediation
3. Use `guardian_budget_acquire` before launching heavy parallel work
4. Call `guardian_budget_release` when done to free slots
5. If something goes wrong, call `guardian_doctor` to capture evidence

The `guardian_recovery_plan` tool returns a deterministic step-by-step plan naming exact tools to call. It never auto-restarts or kills processes — it just tells Claude what to do next.

## Nudge behavior

`guardian_nudge` is the "do the safe things" action:

- If logs/disk thresholds are breached → runs preflight fix
- If warn/critical with no bundle yet → captures diagnostics
- Returns what changed and what to do next
- Never kills processes or restarts anything

## Preview reliability

The `guardian_preview_ready` and `guardian_preview_recover` tools solve a common race condition where `preview_start` returns success before the dev server is actually listening, causing the browser to land on `chrome-error://`.

**Workflow:** `preview_start` → `guardian_preview_ready` (wait gate) → `preview_snapshot`

`guardian_preview_ready` accepts a port number, an optional timeout (default 30 seconds), and an optional HTTP path for health checks. It polls every 500ms using TCP connect followed by an optional HTTP GET.

For non-web projects (Tauri, .NET MAUI, CLI tools), `guardian_preview_recover` detects the project type by scanning marker files (tauri.conf.json, .csproj, package.json) and returns "skip preview" guidance with project-appropriate verification commands.
