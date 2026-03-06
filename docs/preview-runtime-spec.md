# Preview Runtime Specification

> Status: **Proposal** | Author: mcp-tool-shop | Date: 2026-03-06

## Overview

The preview system supervises three components that must coordinate during startup:

1. **Process launcher** — spawns the dev server process
2. **Readiness monitor** — confirms the server is accepting requests
3. **Browser controller** — navigates and manages the preview browser

Today these operate independently. The launcher declares success when the process spawns, not when the server is reachable. The browser navigates immediately and can land on `chrome-error://chromewebdata/` if the server isn't ready. Once there, page-level JavaScript cannot escape the error page, leaving the session permanently stuck.

This spec defines the coordination contract between these subsystems.

## Observed Failure Chain

Reproduction (Windows, Astro dev server, py-polyglot handbook):

1. `preview_start` launches `cmd /c cd /d F:\AI\py-polyglot\site && npx astro dev --port 4331`
2. Tool returns `{ success: true }` immediately
3. Browser navigates to `http://localhost:4331/py-polyglot/`
4. Dev server has **not started listening yet** (Astro takes 3-10s to boot)
5. Chrome loads `chrome-error://chromewebdata/`
6. Server finishes booting; `curl localhost:4331` returns 200
7. `preview_eval("window.location.assign('http://localhost:4331/py-polyglot/')")` — **no effect**
8. `preview_eval("window.location.reload()")` — **no effect**
9. `preview_snapshot` returns `[1] RootWebArea` (empty)
10. `preview_logs` returns "No logs yet" (stdout capture broken by `cmd /c` chain)
11. Session is **unrecoverable** without stopping and restarting

The server was healthy the entire time. The preview tool just couldn't reach it.

## Architecture

```
Preview Runtime
│
├── Process Manager
│   ├── spawn process (with cwd)
│   ├── capture stdout/stderr
│   ├── track PID + exit code
│   └── detect process death
│
├── Readiness Monitor
│   ├── poll TCP port (250-500ms interval)
│   ├── optional HTTP GET to confirm response
│   ├── timeout with structured failure
│   └── report readiness state
│
└── Browser Controller
    ├── navigate(url) — transport-level, not JS eval
    ├── reload(ignore_cache?)
    ├── get_state() → browser state enum
    └── detect error pages / disconnection
```

## Browser States

The browser controller must detect and report the current state:

| State | Meaning |
|-------|---------|
| `target_origin` | Browser is on the expected preview URL |
| `chrome_error_page` | Navigation failed, stuck on `chrome-error://` |
| `about_blank` | Browser hasn't navigated yet |
| `wrong_origin` | Browser is on an unexpected URL |
| `disconnected` | Tab crashed or connection lost |
| `unknown` | State cannot be determined |

Example response:

```json
{
  "browser_state": "chrome_error_page",
  "current_url": "chrome-error://chromewebdata/",
  "recoverable": true,
  "suggested_action": "preview_navigate"
}
```

## Preview Session State Machine

```
idle
  ↓
starting_process
  ↓
waiting_for_port ──→ process_failed (process exited before port opened)
  ↓
server_ready
  ↓
navigating_browser ──→ browser_error (navigation failed)
  ↓
ready ──→ server_died (process exited while session active)
```

Transitions:

- `idle → starting_process`: `preview_start` called
- `starting_process → waiting_for_port`: process spawned, PID assigned
- `waiting_for_port → server_ready`: TCP port accepting connections
- `server_ready → navigating_browser`: browser navigation initiated
- `navigating_browser → ready`: browser confirms target page loaded
- Any state → `idle`: `preview_stop` called

## Tool Contract Changes

### preview_start

**Current behavior:** Returns success when process spawns.

**New behavior:** Returns success when server is reachable AND browser has loaded the target page.

Return schema:

```json
{
  "serverId": "uuid",
  "port": 4331,
  "name": "site",
  "state": "ready",
  "browser_state": "target_origin",
  "startup_time_ms": 4200
}
```

Failure:

```json
{
  "serverId": "uuid",
  "port": 4331,
  "name": "site",
  "state": "timeout_waiting_for_server",
  "error": "Server did not respond on port 4331 within 30s",
  "process_alive": true,
  "last_log_lines": ["[vite] optimizing dependencies..."]
}
```

### preview_navigate (NEW)

Transport-level navigation. Works from any browser state including `chrome-error://`.

```
preview_navigate(serverId, url?)
```

- `url` defaults to `http://localhost:<port>/`
- Operates through browser automation layer, not page JS
- Returns new browser state

### preview_reload (NEW)

Transport-level reload. Works from any browser state.

```
preview_reload(serverId, ignore_cache?: boolean)
```

### preview_up (NEW)

Orchestration command that combines start + wait + navigate + verify:

```
preview_up(name)
```

Flow:
1. Launch process
2. Wait for port readiness (poll)
3. Navigate browser
4. If navigation fails, retry (up to 3 attempts)
5. Confirm target page loaded via snapshot
6. Return success with diagnostics

## Launch Configuration Schema

### Current (workaround required on Windows)

```json
{
  "name": "site",
  "runtimeExecutable": "cmd",
  "runtimeArgs": ["/c", "cd", "/d", "F:\\AI\\py-polyglot\\site", "&&", "npx", "astro", "dev", "--port", "4331"],
  "port": 4331
}
```

Problems:
- `cmd /c` interferes with stdout/stderr capture
- Quoting is fragile
- Process trees are messier (cmd.exe → node)
- Termination is less reliable

### Proposed (with cwd)

```json
{
  "name": "site",
  "cwd": "F:\\AI\\py-polyglot\\site",
  "runtimeExecutable": "npx",
  "runtimeArgs": ["astro", "dev", "--port", "4331"],
  "port": 4331
}
```

New field: `cwd` (string, optional) — working directory for the spawned process.

## Logging Model

`preview_logs` must distinguish between these states:

| State | Message |
|-------|---------|
| Process never started | `"process_not_started"` |
| Process started, no output yet | `"no_output_yet"` (with uptime) |
| Stdout capture failed | `"capture_failed"` (with reason) |
| Process exited | `"process_exited"` (with exit code) |
| Process running normally | Returns log lines with timestamps |

Log retention: last 200 lines, timestamped.

## Recovery Behavior

If browser navigation fails on initial load:

```
while server_ready AND retries < 3:
    wait 1s
    navigate(target_url)
    if browser_state == target_origin:
        return success
return failure with diagnostics
```

This handles the common case where the dev server boots slower than the browser navigates.

## Implementation Phases

| Phase | Scope | Impact |
|-------|-------|--------|
| 1 | Readiness polling before returning success | Eliminates ~90% of startup failures |
| 2 | Transport-level `preview_navigate` / `preview_reload` | Escape hatch from error pages |
| 3 | Auto-retry on initial load failure | Makes race conditions invisible |
| 4 | `cwd` support + improved log capture | Removes Windows workarounds |
| 5 | Browser state reporting | Enables better recovery and tooling |
| 6 | `preview_up` orchestration command | Developer-facing ergonomic endgame |

Priority follows observed pain: Phase 1 alone would have prevented the failure chain documented above.

## Future Extensions

- WebSocket readiness detection (for HMR-enabled servers)
- Port auto-detection (parse stdout for "listening on port X")
- Hot-restart for crashed dev servers
- Multi-tab preview sessions
- Health-check polling during active sessions
