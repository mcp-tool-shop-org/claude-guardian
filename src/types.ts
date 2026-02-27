/**
 * Guardian configuration — 3 user-facing knobs + hardcoded sane defaults.
 */
export interface GuardianConfig {
  /** Max size in MB for any single project log directory. Default: 200 */
  maxProjectLogDirMB: number;

  /** Seconds of no activity before declaring a hang. Default: 300 */
  hangNoActivitySeconds: number;

  /** Whether to auto-restart after crash/hang. Default: false */
  autoRestart: boolean;
}

/** Result of scanning a single directory or file. */
export interface ScanEntry {
  path: string;
  sizeBytes: number;
  sizeMB: number;
  isFile: boolean;
}

/** Result of a preflight check. */
export interface PreflightResult {
  diskFreeGB: number;
  diskFreeWarning: boolean;
  claudeProjectsPath: string | null;
  claudeProjectsSizeMB: number;
  entries: ScanEntry[];
  actions: PreflightAction[];
}

/** An action taken (or recommended) during preflight. */
export interface PreflightAction {
  type: 'rotated' | 'trimmed' | 'archived' | 'warning';
  target: string;
  detail: string;
  sizeBefore?: number;
  sizeAfter?: number;
}

/** Health status returned by the watchdog / MCP server. */
export interface HealthStatus {
  pid: number | null;
  cpuPercent: number | null;
  memoryMB: number | null;
  diskFreeGB: number;
  claudeLogSizeMB: number;
  lastActivitySecondsAgo: number | null;
  hangDetected: boolean;
  lastBundlePath: string | null;
  uptime: number | null;
}

/** Watchdog state. */
export interface WatchdogState {
  childPid: number | null;
  startTime: number | null;
  lastActivityTime: number;
  restartCount: number;
  lastBundlePath: string | null;
}

/** A line in the guardian action journal (JSONL). */
export interface JournalEntry {
  timestamp: string;
  action: string;
  target?: string;
  detail: string;
  sizeBefore?: number;
  sizeAfter?: number;
}
