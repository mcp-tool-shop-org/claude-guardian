# Product Brief — @mcptoolshop/claude-guardian

## What this is

A local-only flight computer for Claude Code sessions. It monitors health (disk, logs, CPU, memory), rotates logs, manages concurrency budgets, detects hangs, captures diagnostic bundles, and exposes 10 MCP tools so Claude can self-monitor without leaving the session.

## Thesis

Claude Code sessions degrade silently. Disk fills, logs bloat, processes hang, and the operator doesn't know until something breaks. Guardian provides deterministic, machine-consumable health signals so Claude (and the operator) can detect and respond to degradation before it becomes a crisis.

## Target user

- Claude Code sessions that need self-awareness about environment health
- Operators running long or intensive sessions who need automatic log rotation
- Multi-claude setups that need cooperative concurrency budgets
- Any setup where silent environment degradation could cause mysterious failures

## Core value

One MCP call tells you the health state. One budget check tells you if you can start heavy work. One preflight fixes the most common problems. No guessing, no manual investigation, no "why is Claude hanging?"

## Non-goals

- Guardian is not a process manager. It does not start, stop, or restart Claude Code.
- Guardian is not a security tool. It monitors health, not threats.
- Guardian is not a resource allocator. The budget is cooperative, not enforced.
- Guardian is not a logging framework. It rotates and trims existing logs, not create new ones.

## Anti-thesis — what this product must never become

1. **A process killer.** Guardian must never SIGKILL, SIGTERM, or force-stop any process. It reports state and recommends actions. The operator or Claude decides.
2. **A reassuring dashboard.** Health state must remain deterministic and non-cosmetic. "ok" means specific conditions are met. "critical" means specific thresholds are breached. No "probably fine" state.
3. **An enforced quota system.** The budget is cooperative by design — Guardian cannot block processes it doesn't own. This limitation must be stated honestly, not hidden behind enforcement language.
4. **A tool that blurs failure categories.** "System unhealthy" (disk full, logs bloated), "budget exceeded" (too many concurrent heavy tasks), and "checker failure" (Guardian itself can't read processes) are three different failure classes. They must never be conflated.
5. **A tool that softens hard signals for comfort.** If disk is at 2GB free, the output says `diskLow: true`. Not "disk space is getting low, you might want to consider..." The signal is the signal.
6. **A network-connected service.** All operations are local filesystem + local processes. No telemetry, no phone-home, no cloud sync.
7. **A tool whose advisory nature is hidden.** Budget denials are cooperative signals. Agents that ignore denials face no enforcement. This must be documented wherever budget is described — not buried in fine print.
