# Workflow: Protect Health & Budget Truth

## Use when

A proposed change touches any of these paths:
- `src/process-monitor.ts` — hang risk assessment, activity signals, process detection
- `src/budget.ts` — cap transitions, lease management, acquire/release semantics
- `src/budget-store.ts` — budget persistence, lock management
- `src/state.ts` — state persistence, freshness check, attention computation
- `src/watch-daemon.ts` — poll cycle, incident triggers, budget adjustments
- `src/mcp-server.ts` — MCP tool implementations, output formatting
- `src/log-manager.ts` — preflight scan/fix thresholds, stale cleanup
- `src/recovery-plan.ts` — recovery step generation
- `src/errors.ts` — error codes, GuardianError shape

## Required chain

1. **Backend Engineer** — implements the change
2. **Test Engineer** — verifies health determinism, budget binary semantics, failure class separation
3. **Critic Reviewer** — reviews against reject criteria below

Add **Security Reviewer** if the change affects what data appears in diagnostic bundles.

## Required review checks

The Critic must verify ALL of the following against evidence (not impression):

- [ ] `assessHangRisk()` remains deterministic: same inputs → same level
- [ ] `Budget.acquire()` remains binary: granted (with lease) or denied (with reason)
- [ ] Three failure classes remain distinguishable in output: system unhealthy vs budget exceeded vs checker failure
- [ ] `writeState()` still uses atomic tmp+rename pattern
- [ ] `isStateFresh()` threshold has not been loosened
- [ ] `GuardianError` still provides `{code, message, hint}` on all MCP error paths
- [ ] No MCP tool exposes stack traces
- [ ] No process-killing code introduced (no SIGKILL, SIGTERM, or similar)
- [ ] Budget advisory nature is documented wherever budget behavior is described
- [ ] `npm test` passes all 203+ tests
- [ ] `npm run build` succeeds

## Reject criteria — automatic reject

A change is **automatically rejected** if it:

1. **Blurs health-state meaning.** Any change that makes `hangRisk.level` non-deterministic (same inputs produce different levels), adds probabilistic language ("might be hanging"), or introduces states between ok/warn/critical without explicit contract update.

2. **Changes budget semantics without synchronized updates.** Any change to cap transitions, lease TTL behavior, acquire/deny logic, or hysteresis timing without corresponding updates to docs, tests, MCP tool descriptions, and recovery-plan guidance.

3. **Hides checker failure inside policy failure.** Any change that conflates "Guardian can't read processes" (checker failure) with "disk is full" (system unhealthy) or "no slots available" (budget exceeded). These are three distinct classes. Merging any two is a contract breach.

4. **Softens hard guard behavior into advisory wording.** Any change that replaces deterministic measurements with qualitative assessments. "disk: 3.2GB" must not become "disk space is getting low." "risk: critical" must not become "the system may need attention."

5. **Weakens deterministic output or exit behavior.** Any change that makes health banner, MCP tool output, or recovery plan non-reproducible for the same input state. Any change that adds randomness, time-dependent display, or conditional omission of measurements.

6. **Introduces UI/UX framing that obscures operational truth.** Any progress bars, color-coded health meters, "status: good" badges, emoji, or dashboard-style formatting in MCP tool output. MCP output is structured text for machines and operators, not a consumer UI.

7. **Adds process control.** Any code that sends signals to processes, modifies process priority, or attempts to start/stop/restart Claude Code or any other process.

8. **Alters health thresholds, budget cap values, or freshness windows** without synchronized updates to defaults, docs, tests, and MCP tool descriptions. These are contract surfaces.

9. **Makes human-facing reassurance stronger while leaving machine-facing semantics unchanged.** A change that preserves the technical behavior (same exit codes, same risk levels) but rewrites human-visible text to feel safer (warmer language, softer framing, vaguer implications) is still a truth regression. Operator understanding must track machine semantics — if the machine says warn, the human text must not say "minor concern."

## Doctrine references

- Health assessment: `src/process-monitor.ts:assessHangRisk()`
- Budget contract: `src/budget.ts:acquire()`, `src/budget.ts:adjustCap()`
- State persistence: `src/state.ts:writeState()`, `src/state.ts:isStateFresh()`
- Error contract: `src/errors.ts:GuardianError`
- MCP tools: `src/mcp-server.ts:createMcpServer()`
- Lockdown doctrine: `role-os-rollout/DOCTRINE.md`
