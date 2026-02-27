import { execFile } from 'child_process';
import { promisify } from 'util';
import pidusage from 'pidusage';
import { stat } from 'fs/promises';
import { getClaudeProjectsPath, THRESHOLDS } from './defaults.js';
import { listFilesRecursive, pathExists } from './fs-utils.js';

const execFileAsync = promisify(execFile);

export interface ClaudeProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryMB: number;
  uptimeSeconds: number;
  commandLine?: string;
  /** Open handles/FDs (null if unavailable, undefined if not fetched). */
  handleCount?: number | null;
}

export interface ActivitySignals {
  /** Seconds since any Claude log file was modified. */
  logLastModifiedSecondsAgo: number;
  /** Whether CPU is above the "low" threshold for any Claude process. */
  cpuActive: boolean;
  /** Which signal sources detected activity. */
  sources: string[];
}

export type RiskLevel = 'ok' | 'warn' | 'critical';

export interface HangRisk {
  level: RiskLevel;
  /** Seconds since composite "no activity" started (0 if active). */
  noActivitySeconds: number;
  /** Seconds of CPU being low across all processes (0 if CPU active). */
  cpuLowSeconds: number;
  cpuHot: boolean;
  memoryHigh: boolean;
  diskLow: boolean;
  /** Seconds remaining in grace window (0 if grace expired). */
  graceRemainingSeconds: number;
  reasons: string[];
}

/** Find PIDs that look like Claude Code processes. */
export async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  const processes: ClaudeProcess[] = [];

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile', '-Command',
        `Get-Process | Where-Object { $_.ProcessName -match '^claude' } | Select-Object Id, ProcessName, CPU, WorkingSet64 | ConvertTo-Json -Compress`,
      ], { timeout: 5000 });

      if (stdout.trim()) {
        const raw = JSON.parse(stdout.trim());
        const items = Array.isArray(raw) ? raw : [raw];
        for (const item of items) {
          if (!item.Id) continue;
          try {
            const usage = await pidusage(item.Id);
            processes.push({
              pid: item.Id,
              name: item.ProcessName || 'claude',
              cpuPercent: Math.round(usage.cpu * 100) / 100,
              memoryMB: Math.round((usage.memory / (1024 * 1024)) * 100) / 100,
              uptimeSeconds: Math.round(usage.elapsed / 1000),
            });
          } catch {
            processes.push({
              pid: item.Id,
              name: item.ProcessName || 'claude',
              cpuPercent: 0,
              memoryMB: Math.round((item.WorkingSet64 || 0) / (1024 * 1024)),
              uptimeSeconds: 0,
            });
          }
        }
      }
    } else {
      try {
        const { stdout } = await execFileAsync('pgrep', ['-f', 'claude'], { timeout: 5000 });
        const pids = stdout.trim().split('\n').filter(Boolean).map(Number);

        for (const pid of pids) {
          try {
            const usage = await pidusage(pid);
            let name = 'claude';
            try {
              const { stdout: psOut } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm=']);
              name = psOut.trim() || 'claude';
            } catch { /* fallback */ }

            processes.push({
              pid,
              name,
              cpuPercent: Math.round(usage.cpu * 100) / 100,
              memoryMB: Math.round((usage.memory / (1024 * 1024)) * 100) / 100,
              uptimeSeconds: Math.round(usage.elapsed / 1000),
            });
          } catch { /* process disappeared */ }
        }
      } catch { /* pgrep found nothing */ }
    }
  } catch { /* can't enumerate */ }

  return processes;
}

/** Check activity signals from Claude's log directory + process CPU. */
export async function checkActivitySignals(processes: ClaudeProcess[]): Promise<ActivitySignals> {
  const claudePath = getClaudeProjectsPath();
  const sources: string[] = [];
  let mostRecentMtime = 0;

  if (await pathExists(claudePath)) {
    const files = await listFilesRecursive(claudePath);

    const recentFiles: Array<{ path: string; mtime: number }> = [];
    for (const f of files.slice(-200)) {
      try {
        const s = await stat(f);
        recentFiles.push({ path: f, mtime: s.mtimeMs });
      } catch { /* skip */ }
    }

    recentFiles.sort((a, b) => b.mtime - a.mtime);
    if (recentFiles.length > 0) {
      mostRecentMtime = recentFiles[0].mtime;
    }
  }

  const logAge = mostRecentMtime > 0
    ? Math.round((Date.now() - mostRecentMtime) / 1000)
    : -1;

  if (logAge >= 0 && logAge < 300) {
    sources.push('log-mtime');
  }

  // CPU activity: any Claude process above low threshold = active
  const cpuActive = processes.some(p => p.cpuPercent > THRESHOLDS.cpuLowThreshold);
  if (cpuActive) {
    sources.push('cpu');
  }

  return {
    logLastModifiedSecondsAgo: logAge,
    cpuActive,
    sources,
  };
}

/**
 * Composite hang risk assessment.
 *
 * Three-signal logic:
 *   - Signal A: log mtime quiet for hangThresholdSeconds
 *   - Signal B: CPU low (below cpuLowThreshold) — not doing work
 *   - Grace: first graceWindowSeconds after process discovery → always ok
 *
 * Escalation:
 *   - During grace → ok (no matter what)
 *   - A quiet AND B low for hangThresholdSeconds → warn
 *   - Stays warn for criticalAfterSeconds → critical
 */
export function assessHangRisk(
  processes: ClaudeProcess[],
  activity: ActivitySignals,
  diskFreeGB: number,
  hangThresholdSeconds: number,
  /** Seconds since processes were first discovered (for grace window). */
  processAgeSeconds: number,
  /** How long the composite "quiet+low-cpu" condition has been true. */
  compositeQuietSeconds: number,
): HangRisk {
  const reasons: string[] = [];

  // Grace window
  const graceRemaining = Math.max(0, THRESHOLDS.graceWindowSeconds - processAgeSeconds);
  const inGrace = graceRemaining > 0;

  // Signal A: log quiet
  const logQuiet = activity.logLastModifiedSecondsAgo < 0 ||
    activity.logLastModifiedSecondsAgo > hangThresholdSeconds;

  // Signal B: CPU low across all processes
  const cpuLow = !activity.cpuActive;

  // Composite: both signals quiet
  const compositeQuiet = logQuiet && cpuLow;

  // CPU hot check (separate from hang — this is "pegged, maybe serialization storm")
  const cpuHot = processes.some(p => p.cpuPercent > 95);
  if (cpuHot) {
    const hotProcs = processes.filter(p => p.cpuPercent > 95);
    reasons.push(`CPU hot: ${hotProcs.map(p => `PID ${p.pid} at ${p.cpuPercent}%`).join(', ')}`);
  }

  // Memory high check
  const memoryHigh = processes.some(p => p.memoryMB > 4096);
  if (memoryHigh) {
    const bigProcs = processes.filter(p => p.memoryMB > 4096);
    reasons.push(`High memory: ${bigProcs.map(p => `PID ${p.pid} at ${p.memoryMB}MB`).join(', ')}`);
  }

  // Disk check
  const diskLow = diskFreeGB >= 0 && diskFreeGB < 5;
  if (diskLow) {
    reasons.push(`Disk free: ${diskFreeGB}GB (< 5GB threshold)`);
  }

  // Risk level
  let level: RiskLevel = 'ok';

  if (inGrace) {
    // Grace window: only disk can cause warn, never hang-based escalation
    if (diskLow) {
      level = 'warn';
    }
  } else if (compositeQuiet && compositeQuietSeconds > hangThresholdSeconds) {
    // Both signals quiet beyond threshold
    if (compositeQuietSeconds > hangThresholdSeconds + THRESHOLDS.criticalAfterSeconds) {
      level = 'critical';
      reasons.push(`No activity for ${compositeQuietSeconds}s (logs quiet + CPU low) — critical threshold exceeded`);
    } else {
      level = 'warn';
      reasons.push(`No activity for ${compositeQuietSeconds}s (logs quiet + CPU low)`);
    }
  } else if (diskLow) {
    level = 'warn';
  } else if (cpuHot && memoryHigh) {
    level = 'warn';
  }

  return {
    level,
    noActivitySeconds: compositeQuiet ? compositeQuietSeconds : 0,
    cpuLowSeconds: cpuLow ? compositeQuietSeconds : 0,
    cpuHot,
    memoryHigh,
    diskLow,
    graceRemainingSeconds: graceRemaining,
    reasons,
  };
}

/** Suggest concrete actions based on risk assessment. */
export function recommendActions(risk: HangRisk): string[] {
  const actions: string[] = [];

  if (risk.diskLow) {
    actions.push('preflight_fix');
  }

  if (risk.level === 'critical') {
    actions.push('doctor');
    actions.push('restart_prompt');
  } else if (risk.level === 'warn') {
    if (risk.noActivitySeconds > 0) {
      actions.push('doctor');
    }
    if (risk.cpuHot || risk.memoryHigh) {
      actions.push('reduce_concurrency');
    }
  }

  return actions;
}
