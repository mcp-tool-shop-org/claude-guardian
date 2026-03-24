# Current Priorities — @mcptoolshop/claude-guardian

## Active work

- Role OS lockdown (this audit). Third repo in org rollout.

## Next up

- None scheduled beyond lockdown.

## Blocked

- Nothing currently blocked.

## Completed recently

- v1.2.0 published (current)
- MCP server with 10 tools operational
- Watch daemon with 2s polling
- Budget system with cooperative leases
- Incident tracking with auto-bundle at critical
- 203 tests passing

## Banned detours

1. **No process management.** Guardian must never start, stop, restart, or kill processes. It monitors and reports.
2. **No network features.** All operations are local. No telemetry, no remote monitoring, no cloud sync.
3. **No enforced quotas.** Budget is cooperative. Do not add enforcement mechanisms that block or throttle processes.
4. **No GUI/dashboard mode.** Guardian is a CLI + MCP server. No web UI, no electron wrapper, no TUI dashboard.
5. **No security scanning.** Guardian monitors health, not vulnerabilities. No CVE checking, no dependency audit, no secret scanning.
6. **No AI-powered analysis.** Hang detection is threshold-based. Recovery plans are deterministic decision trees. No LLM calls, no embeddings, no ML models.

## Must-preserve invariants

These cannot be traded away without explicit human approval:

1. **Hang risk is deterministic.** Same inputs always produce same ok/warn/critical level. No probabilistic or fuzzy assessment.
2. **Budget acquire is binary.** Granted (with lease) or denied (with reason). No partial grants, no "try again" deferral.
3. **Three failure classes remain distinct.** System unhealthy, budget exceeded, and checker failure are never conflated in output.
4. **State writes are atomic.** tmp + rename pattern. Corrupt state is backed up and reset, never silently ignored.
5. **No process killing.** Guardian never sends SIGKILL, SIGTERM, or any signal to any process. Zero exceptions.
6. **Advisory budget is honestly labeled.** Every description of the budget system must state it's cooperative and unenforceable.
7. **MCP errors are structured.** GuardianError with code/message/hint. No stack traces in MCP output. No unstructured stderr.
8. **Machine-consumable outputs are stable.** `hangRisk.level`, `budget.slotsAvailable`, `acquire.granted` are contract surfaces. Changes require version bump + docs update.
9. **Starter-pack, CLI, and docs must remain synchronized.** Changes to MCP tool behavior, health thresholds, or budget semantics require updates to all consuming surfaces.
10. **Log tails in bundles may contain user content.** This must be documented wherever bundles are described. Guardian does not sanitize bundle contents.

## Validation law

- `npm test` runs 203 tests covering all subsystems
- `npm run build` compiles TypeScript with strict mode
- CI runs on push to source paths
- All validation is terminal-based. No browser, no visual verification.
