/**
 * TCP/HTTP port readiness probe.
 * Polls a localhost port until it accepts connections, with optional HTTP health check.
 * Zero external dependencies — uses Node built-in `net` and `http`.
 */

import { createConnection } from 'net';
import { get as httpGet } from 'http';

export interface PortProbeOptions {
  port: number;
  host?: string;
  intervalMs?: number;
  timeoutMs?: number;
  /** If set, performs an HTTP GET after TCP connects and checks for 2xx. */
  httpPath?: string;
}

export interface PortProbeResult {
  reachable: boolean;
  elapsedMs: number;
  attempts: number;
  httpStatus?: number;
  error?: string;
}

/** Default probe thresholds. */
export const PROBE_DEFAULTS = {
  host: 'localhost',
  intervalMs: 500,
  timeoutMs: 30000,
  quickTimeoutMs: 3000,
} as const;

/**
 * Probe a TCP port with optional HTTP readiness check.
 * Resolves when the port responds or when the timeout expires. Never throws.
 */
export async function probePort(options: PortProbeOptions): Promise<PortProbeResult> {
  const host = options.host ?? PROBE_DEFAULTS.host;
  const intervalMs = options.intervalMs ?? PROBE_DEFAULTS.intervalMs;
  const timeoutMs = options.timeoutMs ?? PROBE_DEFAULTS.timeoutMs;
  const startTime = Date.now();
  let attempts = 0;

  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    const tcpOk = await tcpCheck(host, options.port, Math.min(intervalMs, timeoutMs - (Date.now() - startTime)));
    if (tcpOk) {
      // TCP connected — optionally verify HTTP
      if (options.httpPath) {
        const httpResult = await httpCheck(host, options.port, options.httpPath);
        return {
          reachable: httpResult.ok,
          elapsedMs: Date.now() - startTime,
          attempts,
          httpStatus: httpResult.status,
          error: httpResult.ok ? undefined : `HTTP ${httpResult.status ?? 'error'}: ${httpResult.error ?? 'non-2xx'}`,
        };
      }
      return { reachable: true, elapsedMs: Date.now() - startTime, attempts };
    }
    // Wait before next attempt (unless we'd exceed timeout)
    const remaining = timeoutMs - (Date.now() - startTime);
    if (remaining > intervalMs) {
      await sleep(intervalMs);
    }
  }

  return {
    reachable: false,
    elapsedMs: Date.now() - startTime,
    attempts,
    error: `Timeout after ${timeoutMs}ms (${attempts} attempts)`,
  };
}

/** Quick TCP-only check: can we connect to host:port? */
function tcpCheck(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/** HTTP GET check: does the server respond with 2xx on the given path? */
function httpCheck(
  host: string, port: number, path: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ ok: false, error: 'HTTP check timed out' });
    }, 5000);

    const req = httpGet({ host, port, path, timeout: 5000 }, (res) => {
      clearTimeout(timer);
      // Drain the response body to prevent memory leaks
      res.resume();
      const status = res.statusCode ?? 0;
      resolve({ ok: status >= 200 && status < 300, status });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });

    req.on('timeout', () => {
      clearTimeout(timer);
      req.destroy();
      resolve({ ok: false, error: 'HTTP request timed out' });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
