# Claude Guardian Handbook

Field manual for operating Claude Guardian. Covers daily use, incident response, budget management, and diagnostics.

## Daily operations

### Start of session

```bash
claude-guardian status
```

If `risk=ok` and disk is healthy, you're good. If the daemon isn't running:

```bash
claude-guardian watch --verbose &
```

The daemon polls every 2 seconds, tracks hang risk, manages the concurrency budget, and persists state for the MCP server.

### Embed in prompts

Add the guardian to your Claude Code MCP config (`~/.claude.json`):

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

Claude can then call `guardian_status` at any time to check health.

### One-line banner

```bash
claude-guardian status --banner
```

Output: `[guardian] disk=607GB | logs=150MB | procs=2 | cpu=12% | rss=800MB | quiet=0s | risk=ok`

Useful for embedding in shell prompts or session start hooks.

---

## Attention levels

Guardian synthesizes all signals into a single attention level. Check it with `guardian_status` (CLI or MCP).

### `attn=NONE` — All clear

No action needed. The daemon is monitoring in the background.

### `attn=INFO` — Awareness

Something is noteworthy but not urgent. Examples:
- Budget cap is reduced (recovering from a previous warn/critical)
- An incident just closed but is still tracked

**What to do:** Nothing immediate. Continue working normally.

### `attn=WARN` — Elevated risk

Hang risk is elevated, or disk is low. Guardian has detected inactivity or resource pressure.

**What to do:**
1. Call `guardian_nudge` — it will auto-fix what it can (rotate logs, capture bundles)
2. Check `guardian_budget_get` — cap is likely reduced to 2
3. Reduce concurrency: fewer parallel tasks, smaller batches
4. Monitor with `guardian_status` every few minutes

### `attn=CRITICAL` — Immediate action needed

Hang risk is critical. Claude Code may be stuck. No activity for 600+ seconds with low CPU.

**What to do:**
1. Call `guardian_nudge` — captures a diagnostics bundle if one hasn't been taken
2. Call `guardian_recovery_plan` — get exact step-by-step instructions
3. Budget cap is reduced to 1 — stop starting new heavy work
4. If no recovery in 2 minutes, restart Claude Code manually
5. After restart, the budget will recover to cap=4 after 60 seconds of sustained `risk=ok`

---

## Budget and leases

The budget system prevents multiple agents or tasks from dogpiling Claude when it's already stressed.

### How it works

- **Base cap:** 4 concurrent slots
- **Warn cap:** 2 slots (when `risk=warn`)
- **Critical cap:** 1 slot (when `risk=critical`)
- **Hysteresis:** After risk returns to `ok`, the cap stays reduced for 60 seconds before restoring to base

### Acquire before heavy work

```bash
claude-guardian budget acquire 1 --ttl 120 --reason "batch-processing"
```

Or via MCP:
```
guardian_budget_acquire { slots: 1, ttlSeconds: 120, reason: "batch-processing" }
```

If granted, you get a lease ID. If denied, the cap is full — wait or reduce load.

### Release when done

```bash
claude-guardian budget release <lease-id>
```

Or via MCP:
```
guardian_budget_release { leaseId: "<id>" }
```

Leases auto-expire after their TTL, but releasing early frees slots for others immediately.

### Check budget state

```bash
claude-guardian budget show
```

Shows current cap, slots in use, active leases with TTL countdown.

### The contract

The budget is **advisory**. Guardian doesn't block or kill anything. The contract is:
1. Check `guardian_budget_get` before starting heavy work
2. If `slotsAvailable > 0`, call `guardian_budget_acquire`
3. If denied, back off — the system is under pressure
4. Always release when done

Tools and agents that respect this contract prevent cascading failures.

---

## Doctor bundles

When something goes wrong, Guardian captures evidence — not guesses.

### Generate a bundle

```bash
claude-guardian doctor --out ./my-bundle.zip
```

Or via MCP: `guardian_doctor`

### What's in the bundle

| File | Contents |
|------|----------|
| `summary.json` | System info, disk, memory, CPU, preflight results |
| `process.json` | Snapshot of all Claude processes (PID, CPU, memory, handles, uptime) |
| `timeline.json` | Chronological events (journal entries, incidents, state changes) |
| `log-tails/*.txt` | Last 500 lines of each Claude log file |
| `journal.jsonl` | Full guardian action journal |
| `events.jsonl` | Incident log |
| `state.json` | Guardian state at time of capture |

### Attach to issues

When filing a bug report:
1. Run `claude-guardian doctor`
2. Note the bundle path in the output
3. Attach the `.zip` to your GitHub issue
4. The bundle contains no API keys, tokens, or user content — only system metrics, log tails, and guardian's own journal

### Automatic capture

The daemon captures bundles automatically when:
- Risk escalates to `warn` or `critical` (one bundle per incident, deduplicated)
- The watchdog (`claude-guardian run`) detects a hang or crash

Bundle paths are stored in the incident record and shown in `guardian_status`.

---

## Corruption recovery

Guardian handles its own file corruption gracefully:

- **state.json corrupt:** Backed up to `state.json.corrupt.<timestamp>`, state resets to empty. The daemon rebuilds on next poll.
- **budget.json corrupt:** Backed up to `budget.json.corrupt.<timestamp>`, budget resets to defaults (cap=4, no leases).

If you see `[guardian] WARNING: state.json is corrupt` in your console, the backup is in `~/.claude-guardian/`. The guardian continues operating normally after reset.

---

## Quick reference

| Situation | Command |
|-----------|---------|
| Start of session | `claude-guardian status` |
| Background monitoring | `claude-guardian watch` |
| Fix log bloat | `claude-guardian preflight --fix` |
| Something is wrong | `claude-guardian doctor` |
| Check budget | `claude-guardian budget show` |
| MCP: safe auto-fix | `guardian_nudge` |
| MCP: what do I do? | `guardian_recovery_plan` |
