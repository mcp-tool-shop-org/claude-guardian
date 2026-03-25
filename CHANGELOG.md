# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-03-25

### Fixed

- CLI version now reads from package.json instead of hardcoded string
- SECURITY.md updated supported versions to include 1.2.x

## [1.2.0] - 2026-03-19

### Added
- `guardian_preview_ready` MCP tool — polls a localhost port until the dev server responds, preventing `chrome-error://` race conditions
- `guardian_preview_recover` MCP tool — diagnoses stuck preview sessions, classifies project type (web vs desktop vs CLI), and returns step-by-step recovery guidance
- TCP/HTTP port readiness probe (`src/port-probe.ts`) — zero-dependency polling with configurable interval, timeout, and optional HTTP health check
- Project type classifier (`src/project-classify.ts`) — detects web-node, web-python, web-static, desktop (Tauri/MAUI/Electron/WPF), and CLI projects from marker files
- Preview readiness step in recovery plan — guides agents to use `guardian_preview_ready` after `preview_start`
- Error codes `PORT_PROBE_FAILED` and `PROJECT_CLASSIFY_FAILED`
- 29 new tests (203 total, up from 174): 6 port probe, 19 project classify, 3 MCP integration, 1 recovery plan

### Changed
- MCP server version bumped to 1.2.0
- Tool count 8 → 10

## [1.1.4] - 2026-03-19

### Added
- Async mutex locks (`withStateLock`, `withBudgetLock`) to serialize concurrent state/budget file I/O
- `pollInProgress` overlap guard in watch daemon to prevent poll stacking
- Clock skew protection with `Math.max(0, ...)` on all time delta calculations
- Reverse-seek `tailFile` for large files (>1MB) — reads 64KB chunks from EOF instead of loading entire file
- Corruption recovery journaling — corrupt `state.json`/`budget.json` files log a `corruption-recovery` event to the action journal
- Process enumeration error tracking — `findClaudeProcesses()` returns `{ processes, enumerationError }` and propagates to `ActivitySignals.lastEnumerationError`
- Daemon uptime and poll count tracking in `GuardianState` (`daemonStartedAt`, `pollCount`)
- Lease expiration journal entries with lease ID, slot count, and reason
- `listFilesWithStats()` single-traversal utility replacing separate `listFilesRecursive` + per-file `stat()` calls
- 7 new tests for enhancements (174 total, up from 167)

### Changed
- `findClaudeProcesses()` returns `FindProcessesResult` object instead of bare array (all 7 call sites updated)
- `expireLeases()` returns `BudgetLease[]` instead of `number` for journal logging
- `IncidentTracker.update()` is now async to properly await incident log writes
- Budget lease IDs use full UUIDs instead of truncated 8-char hex
- Process matching uses `pgrep -x 'claude'` (exact match) instead of `-f` (pattern match)
- Status banner shows daemon uptime and poll count

### Fixed
- TOCTOU race in budget acquire/release between daemon and MCP tools
- Potential unhandled promise rejection in incident log writes
- Redundant file traversals in log scanning and activity signal checking
- UNC path handling in `getDiskFreeGB()` (returns -1 instead of executing with garbage args)
- JSONL readers (`readJournal`, `readIncidentLog`) now skip corrupt lines instead of failing entirely

## [1.1.2] - 2026-02-27

### Added
- Dependency audit job in CI workflow
- Standard SHIP_GATE.md (Shipcheck template with all gates filled)
- SCORECARD.md with pre/post remediation assessment

### Changed
- Scorecard 49/50 → 50/50 (added dep-audit closes D. Shipping Hygiene gap)

## [1.1.1] - 2026-02-27

### Added
- CI workflow with build, test, and code coverage
- Codecov badge and coverage upload
- npm version badge in README
- Quality scorecard in README and landing page (49/50)

### Changed
- Landing page footer standardized to MCP Tool Shop link
- Landing page npm URL corrected to scoped package name
- Updated translations (7 languages)

## [1.1.0] - 2026-02-27

### Added
- Stale session cleanup: `preflight --fix` and `guardian_preflight_fix` now detect and remove
  old UUID-named session transcripts (.jsonl, .jsonl.gz) and session directories
- Configurable retention: sessions older than 3 days are cleaned (1.5 days in aggressive mode)
- Protected entries: `memory/` and `sessions-index.json` are never touched
- Scan-time warning: `preflight` reports stale session count and size before fix
- 6 new tests for session cleanup

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
