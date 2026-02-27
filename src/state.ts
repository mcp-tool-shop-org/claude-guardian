import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getGuardianDataPath } from './defaults.js';
import type { ClaudeProcess, ActivitySignals, HangRisk } from './process-monitor.js';
import type { Incident } from './incident.js';

/** Persisted state shared between daemon and MCP server. */
export interface GuardianState {
  /** When this state was last written. */
  updatedAt: string;
  /** Whether the watch daemon is running. */
  daemonRunning: boolean;
  /** Daemon PID (if running). */
  daemonPid: number | null;
  /** Detected Claude Code processes. */
  claudeProcesses: ClaudeProcess[];
  /** Activity signals from log directory + CPU. */
  activity: ActivitySignals;
  /** Current hang risk assessment (composite). */
  hangRisk: HangRisk;
  /** Recommended actions based on current state. */
  recommendedActions: string[];
  /** Disk free in GB. */
  diskFreeGB: number;
  /** Claude log size in MB. */
  claudeLogSizeMB: number;
  /** Active incident (or null if healthy). */
  activeIncident: Incident | null;
  /** Seconds since processes were first discovered (for grace). */
  processAgeSeconds: number;
  /** How long the composite quiet condition has held. */
  compositeQuietSeconds: number;
}

function getStatePath(): string {
  return join(getGuardianDataPath(), 'state.json');
}

/** Write state atomically (write to .tmp, then rename). */
export async function writeState(state: GuardianState): Promise<void> {
  const dataDir = getGuardianDataPath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  const statePath = getStatePath();
  const tmpPath = statePath + '.tmp';
  const json = JSON.stringify(state, null, 2);

  await writeFile(tmpPath, json, 'utf-8');
  await rename(tmpPath, statePath);
}

/** Read the current state. Returns null if no state file exists. */
export async function readState(): Promise<GuardianState | null> {
  const statePath = getStatePath();
  try {
    const content = await readFile(statePath, 'utf-8');
    return JSON.parse(content) as GuardianState;
  } catch {
    return null;
  }
}

/** Check if the persisted state is fresh (written within last N seconds). */
export function isStateFresh(state: GuardianState, maxAgeSeconds: number = 10): boolean {
  const age = (Date.now() - new Date(state.updatedAt).getTime()) / 1000;
  return age < maxAgeSeconds;
}

/** Create an empty/default state. */
export function emptyState(): GuardianState {
  return {
    updatedAt: new Date().toISOString(),
    daemonRunning: false,
    daemonPid: null,
    claudeProcesses: [],
    activity: { logLastModifiedSecondsAgo: -1, cpuActive: false, sources: [] },
    hangRisk: {
      level: 'ok', noActivitySeconds: 0, cpuLowSeconds: 0,
      cpuHot: false, memoryHigh: false, diskLow: false,
      graceRemainingSeconds: 0, reasons: [],
    },
    recommendedActions: [],
    diskFreeGB: -1,
    claudeLogSizeMB: 0,
    activeIncident: null,
    processAgeSeconds: 0,
    compositeQuietSeconds: 0,
  };
}
