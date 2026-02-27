import { readFile, writeFile, mkdir, rename, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getGuardianDataPath } from './defaults.js';
import { GuardianError, wrapError } from './errors.js';
import type { ClaudeProcess, ActivitySignals, HangRisk } from './process-monitor.js';
import type { Incident } from './incident.js';
import type { BudgetSummary } from './budget.js';

export type AttentionLevel = 'none' | 'info' | 'warn' | 'critical';

/** Top-level "pay attention" signal for the agent. */
export interface Attention {
  /** Urgency level. */
  level: AttentionLevel;
  /** When this attention level started. */
  since: string;
  /** Human-readable reason. */
  reason: string;
  /** Concrete MCP-tool-based actions the agent should take. */
  recommendedActions: string[];
  /** Active incident ID (null if none). */
  incidentId: string | null;
}

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
  /** Budget summary (null if budget not initialized). */
  budgetSummary: BudgetSummary | null;
  /** Top-level attention signal for the agent. */
  attention: Attention;
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

  try {
    await writeFile(tmpPath, json, 'utf-8');
    await rename(tmpPath, statePath);
  } catch (err) {
    throw wrapError(err, 'STATE_WRITE_FAILED', 'Check disk space and permissions on ~/.claude-guardian/');
  }
}

/**
 * Read the current state. Returns null if no state file exists.
 * If the file exists but is corrupt, backs it up and returns null with a warning.
 */
export async function readState(): Promise<GuardianState | null> {
  const statePath = getStatePath();
  let content: string;
  try {
    content = await readFile(statePath, 'utf-8');
  } catch {
    return null; // File doesn't exist — normal
  }

  try {
    return JSON.parse(content) as GuardianState;
  } catch (parseErr) {
    // Corrupt state file — back it up and reset
    const backupPath = statePath + '.corrupt.' + Date.now();
    try {
      await copyFile(statePath, backupPath);
    } catch {
      // Best-effort backup
    }
    console.error(`[guardian] WARNING: state.json is corrupt. Backed up to ${backupPath} and resetting.`);
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
    budgetSummary: null,
    attention: { level: 'none', since: new Date().toISOString(), reason: 'All systems healthy', recommendedActions: [], incidentId: null },
  };
}

/**
 * Compute the attention signal from current state.
 * Pass `previousAttention` to preserve `since` when level is unchanged.
 */
export function computeAttention(
  hangRisk: HangRisk,
  budgetSummary: BudgetSummary | null,
  activeIncident: Incident | null,
  previousAttention?: Attention,
): Attention {
  const actions: string[] = [];
  const reasons: string[] = [];
  let level: AttentionLevel = 'none';

  // Hang risk drives the main level
  if (hangRisk.level === 'critical') {
    level = 'critical';
    reasons.push('Hang risk is critical');
    actions.push('Run guardian_nudge to capture diagnostics');
    actions.push('Reduce concurrency — call guardian_budget_get to check cap');
    actions.push('If no recovery in 2 minutes, restart Claude Code');
  } else if (hangRisk.level === 'warn') {
    level = 'warn';
    reasons.push('Hang risk is elevated');
    actions.push('Run guardian_nudge for safe remediation');
    actions.push('Reduce concurrency — call guardian_budget_get to check cap');
    actions.push('Monitor with guardian_status');
  }

  // Disk low escalates to at least warn
  if (hangRisk.diskLow) {
    if (level === 'none') level = 'warn';
    reasons.push('Disk space is low');
    actions.push('Run guardian_preflight_fix to free space');
  }

  // Budget reduction is info level
  if (budgetSummary && budgetSummary.currentCap < budgetSummary.baseCap) {
    if (level === 'none') level = 'info';
    reasons.push(`Budget cap reduced to ${budgetSummary.currentCap}/${budgetSummary.baseCap}`);
    if (!actions.some(a => a.includes('guardian_budget_get'))) {
      actions.push('Call guardian_budget_acquire before heavy work');
    }
  }

  // Active incident at info minimum
  const incidentId = activeIncident?.id ?? null;
  if (activeIncident && level === 'none') {
    level = 'info';
    reasons.push(`Active incident: ${activeIncident.id}`);
  }

  // Preserve `since` if level unchanged
  const since = previousAttention && previousAttention.level === level
    ? previousAttention.since
    : new Date().toISOString();

  return {
    level,
    since,
    reason: reasons.join('; ') || 'All systems healthy',
    recommendedActions: actions,
    incidentId,
  };
}
