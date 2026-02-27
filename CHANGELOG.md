# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-02-27

### Added
- SECURITY.md with vulnerability reporting policy and scope
- HANDBOOK.md — field manual for daily ops, incident response, budget management
- CHANGELOG.md (this file)
- SHIP_GATE.md — hard-gate checklist for release readiness
- `GuardianError` structured error type with code, hint, and cause
- MCP tools return structured errors (code + hint), never stack traces
- State/budget file corruption recovery: auto-backup + reset with warning
- CLI `--debug` flag for full stack traces
- Consistent CLI exit codes: 0 ok, 1 user error, 2 runtime error
- `npm run verify` script (test + build + pack)
- Trust model and dangerous actions statement in README

### Changed
- README updated with all 8 MCP tools, `watch` and `budget` commands
- All MCP tool handlers wrapped with error boundaries

## [1.2.0] - 2026-02-27

### Added
- Attention channel: top-level synthesized signal (none/info/warn/critical)
- `computeAttention()` function combining hang risk, budget, disk, incidents
- `guardian_budget_get` MCP tool — view concurrency budget
- `guardian_budget_acquire` MCP tool — request concurrency slots
- `guardian_budget_release` MCP tool — release leases
- `guardian_recovery_plan` MCP tool — step-by-step recovery with exact tool names
- Enhanced doctor bundles: process.json, timeline.json, events.jsonl
- Attention display in `guardian_status` output and banner

## [1.1.0] - 2026-02-27

### Added
- Concurrency budget system (cap transitions: ok=4, warn=2, critical=1)
- Lease-based concurrency control with TTL auto-expiry
- 60-second hysteresis before restoring base cap
- `guardian_nudge` MCP tool — safe auto-remediation
- Handle count signal (Windows/Linux/macOS)
- `budget` CLI command (show/acquire/release)
- Budget info in status banner and full status output

## [1.0.0] - 2026-02-27

### Added
- Composite hang detection (log mtime + CPU activity + grace window)
- Incident state machine (ok → warn → critical lifecycle)
- Bundle deduplication (one per incident)
- `watch` daemon with 2-second polling
- `status` command with `--banner` flag
- `guardian_status` MCP tool with composite signals
- `guardian_preflight_fix` MCP tool
- `guardian_doctor` MCP tool

## [0.2.0] - 2026-02-26

### Added
- Process monitoring via pidusage
- Activity signal detection (log mtime, CPU)
- Hang risk assessment with grace window

## [0.1.0] - 2026-02-26

### Added
- Initial release
- `preflight` command — scan and fix Claude log bloat
- `doctor` command — diagnostics bundle generation
- `run` command — watchdog with hang/crash detection
- MCP server with stdio transport
- Journal-based audit trail
