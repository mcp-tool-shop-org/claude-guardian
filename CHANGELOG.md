# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-27

First public release.

### Added
- `preflight` command — scan and fix Claude log bloat (rotate, gzip, trim)
- `doctor` command — diagnostics bundle (zip) with system info, log tails, journal
- `run` command — watchdog with hang/crash detection, optional auto-restart
- `watch` daemon — continuous 2-second polling, incident tracking, budget enforcement
- `status` command with `--banner` flag for one-line health summaries
- `budget` CLI command (show/acquire/release) for concurrency management
- Composite hang detection (log mtime + CPU activity + grace window)
- Incident state machine (ok → warn → critical lifecycle)
- Bundle deduplication (one per incident)
- Concurrency budget system (cap transitions: ok=4, warn=2, critical=1)
- Lease-based concurrency control with TTL auto-expiry and 60s hysteresis
- Handle count signal (Windows/Linux/macOS)
- Attention channel: synthesized top-level signal (none/info/warn/critical)
- 8 MCP tools: `guardian_status`, `guardian_preflight_fix`, `guardian_doctor`, `guardian_nudge`, `guardian_budget_get`, `guardian_budget_acquire`, `guardian_budget_release`, `guardian_recovery_plan`
- `GuardianError` structured error type with code, hint, and cause
- MCP tools return structured errors (code + hint), never stack traces
- State/budget file corruption recovery: auto-backup + graceful reset
- CLI `--debug` flag for full stack traces
- Consistent CLI exit codes: 0 ok, 1 user error, 2 runtime error
- `npm run verify` script (test + build + pack)
- SECURITY.md, HANDBOOK.md, SHIP_GATE.md
- Landing page via @mcptoolshop/site-theme
- README translations: ja, zh, es, fr, hi, it, pt-BR
