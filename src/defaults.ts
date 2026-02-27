import type { GuardianConfig } from './types.js';
import { homedir } from 'os';
import { join } from 'path';

/** The 3 user-facing knobs with sane defaults. */
export const DEFAULT_CONFIG: GuardianConfig = {
  maxProjectLogDirMB: 200,
  hangNoActivitySeconds: 300,
  autoRestart: false,
};

/** Hardcoded thresholds — not user-configurable in v1. */
export const THRESHOLDS = {
  /** Disk free below this triggers aggressive mode. */
  diskFreeWarningGB: 5,

  /** Max single file size before trimming. */
  maxFileMB: 25,

  /** How many days of logs to retain during rotation. */
  retainDays: 7,

  /** Tail lines to include in doctor bundle per log file. */
  doctorTailLines: 500,

  /** Watchdog poll interval in ms. */
  watchdogPollMs: 2000,

  /** Restart backoff schedule in ms. */
  restartBackoffMs: [2000, 5000, 15000, 60000],

  /** Max restarts before giving up. */
  maxRestarts: 5,

  /** Grace period after first discovering a PID — risk stays ok. */
  graceWindowSeconds: 60,

  /** CPU below this % counts as "low" for hang detection. */
  cpuLowThreshold: 5,

  /** After warn, escalate to critical after this many additional seconds. */
  criticalAfterSeconds: 600,

  /** Rate limit: min seconds between bundles for the same PID. */
  bundleCooldownSeconds: 300,
} as const;

/** Resolve the Claude projects directory. */
export function getClaudeProjectsPath(): string {
  return join(homedir(), '.claude', 'projects');
}

/** Resolve the guardian data directory. */
export function getGuardianDataPath(): string {
  return join(homedir(), '.claude-guardian');
}

/** Resolve the journal file path. */
export function getJournalPath(): string {
  return join(getGuardianDataPath(), 'journal.jsonl');
}

/** Resolve the archive directory. */
export function getArchivePath(): string {
  return join(getGuardianDataPath(), 'archive');
}
