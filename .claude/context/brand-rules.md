# Brand Rules — @mcptoolshop/claude-guardian

## Tone

Operational. Clinical. No reassurance. Guardian reports what it measured, what the thresholds are, and what actions are available. It does not comfort, encourage, or soften.

## Domain language

| Term | Meaning | Never say instead |
|------|---------|-------------------|
| health state | Composite of disk, logs, CPU, memory, hang risk | "health score", "wellness" |
| hang risk | ok / warn / critical — deterministic from signals | "responsiveness", "performance" |
| budget | Cooperative concurrency slots with TTL leases | "quota", "limit", "allowance" |
| lease | A time-bounded claim on budget slots | "reservation", "token" |
| cap | Maximum available slots (1-4, adjusted by risk) | "ceiling", "maximum" |
| preflight | Log scan + optional fix (rotation, trim, cleanup) | "health check", "diagnostic" |
| nudge | Safe remediation: if thresholds breached, fix; if critical, bundle | "auto-fix", "self-heal" |
| bundle | Diagnostic zip (system info, log tails, timeline, processes) | "crash report", "dump" |
| incident | A tracked period of elevated risk with optional bundle | "alert", "event" |
| advisory | A signal that agents should respect but Guardian cannot enforce | "enforced", "required" |

## Forbidden metaphors

- No "healthy/unhealthy" as absolute states. Guardian reports risk levels and measurements, not diagnoses.
- No "self-healing" language. Guardian fixes logs and reports state. It does not heal anything.
- No "intelligent" language. Hang detection is threshold-based. Budget is slot arithmetic. Neither is intelligent.
- No "protection" language. Guardian monitors and reports. It does not protect against anything.
- No "safety net" language. Guardian is a flight computer, not a safety net. It gives you instruments, not guarantees.

## Truth constraints

1. **Risk levels must be deterministic.** Same inputs → same level. No probabilistic language, no "might be hanging."
2. **Budget denial must be binary.** Granted or denied. No "partially granted", no "try again soon."
3. **Failure categories must be distinct.** System unhealthy ≠ budget exceeded ≠ checker failure. If the output doesn't tell you which category, it's broken.
4. **Advisory nature must be stated.** Wherever budget is described, state that it's cooperative and agents can ignore denials. Do not imply enforcement.
5. **Measurements must be current.** If using cached/stale state, say so. Do not present stale data as current.

## Enforcement language bans

1. **No "the system is safe."** Guardian reports measurements. It does not certify safety.
2. **No "everything looks good."** If `hangRisk.level === "ok"`, say "risk: ok." Not "everything looks good."
3. **No "you should be fine."** If budget has slots available, say "2 slots available." Not "you should be fine to proceed."
4. **No "Guardian will handle it."** Guardian reports and recommends. It does not handle problems.
5. **No "don't worry about."** If a signal is below threshold, report the measurement. Don't dismiss it.
6. **No "probably" or "likely" in health output.** Health signals are measurements, not predictions. "Disk: 3.2GB free" not "disk is probably getting low."

## Contamination risks

- **Dashboard UX drift.** The moment Guardian adds progress bars, color-coded health meters, or "status: good" badges, it has become a dashboard instead of an instrument panel.
- **Enforcement pretense drift.** The moment Guardian implies it can prevent heavy work (instead of advising against it), the cooperative contract is broken.
- **Comfort language drift.** The moment Guardian says "no issues detected" instead of "risk: ok, disk: 12.4GB, logs: 45MB", it has started hiding measurements behind reassurance.

## Interaction law

- MCP tool output is structured text: measurements, levels, actions. No markdown tables in MCP output.
- Health banner is one line: `[level] disk:XGB logs:XMB [flags]`
- Error output uses GuardianError: `{code, message, hint}`. No stack traces in MCP.
- `--debug` shows stack traces in CLI only.
- Journal entries are structured JSON (action, detail, timestamp). Never prose.
