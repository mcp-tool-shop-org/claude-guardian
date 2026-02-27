# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** claude-guardian
**Date:** 2026-02-27
**Type tags:** [npm] [mcp] [cli]

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 10/10 | SECURITY.md, trust model, local-only, no telemetry, GuardianError |
| B. Error Handling | 10/10 | GuardianError (code+hint+cause), exit codes, graceful degradation |
| C. Operator Docs | 10/10 | README, CHANGELOG, HANDBOOK, --help, 8 MCP tools documented |
| D. Shipping Hygiene | 9/10 | verify script, engines, lockfile, CI — missing dep-audit job |
| E. Identity (soft) | 10/10 | Logo, translations (7 langs), landing page, metadata |
| **Overall** | **49/50** | |

## Key Gaps

1. No dedicated dep-audit job in CI (npm audit only runs locally)
2. SHIP_GATE.md was in old custom format (not standard Shipcheck template)
3. SCORECARD.md missing (scorecard was inline in README only)

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | Add dep-audit job to CI | 2 min |
| 2 | Replace SHIP_GATE.md with standard template | 5 min |
| 3 | Add SCORECARD.md | 2 min |

## Post-Remediation

| Category | Before | After |
|----------|--------|-------|
| A. Security | 10/10 | 10/10 |
| B. Error Handling | 10/10 | 10/10 |
| C. Operator Docs | 10/10 | 10/10 |
| D. Shipping Hygiene | 9/10 | 10/10 |
| E. Identity (soft) | 10/10 | 10/10 |
| **Overall** | 49/50 | 50/50 |
