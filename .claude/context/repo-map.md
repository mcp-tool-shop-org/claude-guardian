# Repo Map — @mcptoolshop/claude-guardian

## Stack

- Runtime: Node.js >= 18.0.0 (TypeScript, ESM)
- Build: tsc (TypeScript compiler)
- Test framework: Vitest
- Dependencies: @modelcontextprotocol/sdk, commander, pidusage, archiver
- MCP server: stdio transport

## Structure

```
src/
  mcp-server.ts         # MCP server with 10 tools (650+ lines)
  watch-daemon.ts       # Background polling daemon (2s interval)
  process-monitor.ts    # Claude process detection + hang risk assessment
  state.ts              # Atomic state persistence + freshness check
  budget.ts             # Concurrency budget (cap, leases, hysteresis)
  budget-store.ts       # Budget persistence (atomic writes, mutex)
  log-manager.ts        # Log scanning, rotation, trimming, stale cleanup
  incident.ts           # Incident lifecycle + bundle trigger
  doctor.ts             # Diagnostic bundle generation
  recovery-plan.ts      # Deterministic recovery step generation
  port-probe.ts         # TCP + HTTP port readiness check
  project-classify.ts   # Web/desktop/CLI project detection
  watchdog.ts           # Watchdog class (process health tracking)
  handle-count.ts       # OS handle/fd count per process
  fs-utils.ts           # Atomic writes, gzip, tail, trim, journal
  errors.ts             # GuardianError class (code/message/hint)
  defaults.ts           # Config defaults, paths, thresholds
  types.ts              # TypeScript type definitions
  cli.ts                # Commander CLI entry point
test/
  *.test.ts             # 203 test cases (Vitest)
```

## Build commands

| Command | What it does |
|---------|-------------|
| `npm test` | Vitest (203 tests) |
| `npm run build` | `tsc` |
| `npm run verify` | Build + test + help |

## Primary seam: Health checks + budget-system truth

This is the highest-risk seam. Every Claude Code session trusts Guardian's health signals to decide whether to continue, pause, or fix the environment. If health state becomes cosmetic, budget becomes vague, or failure categories blur, operators make bad decisions based on false signals.

**Three distinct failure classes (must never be conflated):**

| Class | Meaning | Example | Signal |
|-------|---------|---------|--------|
| **System unhealthy** | Environment degradation | Disk < 5GB, logs > 200MB, hang detected | `hangRisk.level`, `diskLow`, `claudeLogSizeMB` |
| **Budget exceeded** | Too many concurrent heavy tasks | All slots leased, cap reduced by risk | `budget.slotsAvailable === 0`, `acquire → denied` |
| **Checker failure** | Guardian itself can't determine state | Process enumeration failed, state corrupt | `lastEnumerationError`, state parse failure |

These three must produce distinguishable outputs. A change that merges any two is a contract breach.

**Machine-consumable vs explanatory outputs:**

| Output | Contractual (machine) | Explanatory (human) |
|--------|----------------------|---------------------|
| `hangRisk.level` (ok/warn/critical) | Yes — agents branch on this | No |
| `budget.slotsAvailable` | Yes — agents use this to decide | No |
| `acquire → granted/denied` | Yes — binary contract | No |
| Health banner text | No | Yes — formatted for display |
| Recovery plan steps | Partially — tool names are contractual | Steps are guidance |
| Doctor summary report | No | Yes — human diagnostic |

## Key invariants

| File | Invariant |
|------|-----------|
| `src/process-monitor.ts:assessHangRisk()` | Hang risk is deterministic: same inputs always produce same level. Decision table is explicit. |
| `src/budget.ts:acquire()` | Acquire returns `{granted: true, lease}` or `{granted: false, reason}`. Binary. No "maybe." |
| `src/budget.ts:adjustCap()` | Cap transitions: ok→4 (after 60s hysteresis), warn→2, critical→1. Always clamped 1-4. |
| `src/state.ts:writeState()` | State writes are atomic (tmp + rename). Corrupt state is backed up and reset. |
| `src/state.ts:isStateFresh()` | State is fresh if written < 10 seconds ago. Stale state triggers live re-assessment. |
| `src/errors.ts:GuardianError` | All errors have `{code, message, hint}`. No stack traces in MCP output. |
| `src/mcp-server.ts` | 10 MCP tools. All return structured text. Errors return `isError: true`. |
| `src/watch-daemon.ts` | Polls every 2s. Overlap guard prevents stacking. Never kills processes. |

## Secondary seams

### 1. State freshness (state.ts:140)
State is "fresh" if written < 10s ago. If daemon crashes, state stays fresh for up to 8s with frozen composite counters. MCP tools using stale state may underreport risk.

### 2. Budget advisory nature (budget.ts)
Budget is cooperative — no enforcement mechanism. Agents can ignore denials. Works only when all agents cooperate. This is by design but must be explicitly documented.

### 3. Process enumeration failure (process-monitor.ts:54-121)
If `findClaudeProcesses()` fails (permissions, tools unavailable), error is captured in `lastEnumerationError` but health system sees empty process list and may escalate risk incorrectly.

## Validation law

- `npm test` runs 203 tests covering all subsystems
- `npm run build` compiles TypeScript
- CI runs on push to source paths
- All validation is terminal-based. No browser, no visual verification.
- MCP tools are tested via mock server in test suite.
