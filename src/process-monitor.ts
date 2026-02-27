import { execFile } from 'child_process';
import { promisify } from 'util';
import pidusage from 'pidusage';
import { stat } from 'fs/promises';
import { getClaudeProjectsPath } from './defaults.js';
import { listFilesRecursive, pathExists } from './fs-utils.js';

const execFileAsync = promisify(execFile);

export interface ClaudeProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryMB: number;
  uptimeSeconds: number;
  commandLine?: string;
}

export interface ActivitySignals {
  /** Seconds since any Claude log file was modified. */
  logLastModifiedSecondsAgo: number;
  /** Which signal sources are active. */
  sources: string[];
}

export type RiskLevel = 'ok' | 'warn' | 'critical';

export interface HangRisk {
  level: RiskLevel;
  noActivitySeconds: number;
  cpuHot: boolean;
  memoryHigh: boolean;
  diskLow: boolean;
  reasons: string[];
}

/** Find PIDs that look like Claude Code processes. */
export async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  const processes: ClaudeProcess[] = [];

  try {
    if (process.platform === 'win32') {
      // Use tasklist + wmic on Windows
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
            // Process may have exited between listing and pidusage
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
      // Unix: use pgrep + ps
      try {
        const { stdout } = await execFileAsync('pgrep', ['-f', 'claude'], { timeout: 5000 });
        const pids = stdout.trim().split('\n').filter(Boolean).map(Number);

        for (const pid of pids) {
          try {
            const usage = await pidusage(pid);

            // Get process name
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
          } catch {
            // Process disappeared
          }
        }
      } catch {
        // pgrep found nothing — that's fine
      }
    }
  } catch {
    // Can't enumerate processes — not fatal
  }

  return processes;
}

/** Check activity signals from Claude's log directory. */
export async function checkActivitySignals(): Promise<ActivitySignals> {
  const claudePath = getClaudeProjectsPath();
  const sources: string[] = [];
  let mostRecentMtime = 0;

  if (await pathExists(claudePath)) {
    sources.push('claude-projects-dir');
    const files = await listFilesRecursive(claudePath);

    // Check the 50 most recently modified files (avoid scanning thousands)
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

  const noActivitySeconds = mostRecentMtime > 0
    ? Math.round((Date.now() - mostRecentMtime) / 1000)
    : -1;

  return {
    logLastModifiedSecondsAgo: noActivitySeconds,
    sources,
  };
}

/** Assess hang risk from process metrics + activity signals. */
export function assessHangRisk(
  processes: ClaudeProcess[],
  activity: ActivitySignals,
  diskFreeGB: number,
  hangThresholdSeconds: number,
): HangRisk {
  const reasons: string[] = [];

  // No activity check
  const noActivitySeconds = activity.logLastModifiedSecondsAgo;
  const noActivity = noActivitySeconds > hangThresholdSeconds;
  if (noActivity) {
    reasons.push(`No log activity for ${noActivitySeconds}s (threshold: ${hangThresholdSeconds}s)`);
  }

  // CPU check: any claude process pegged > 95%
  const cpuHot = processes.some(p => p.cpuPercent > 95);
  if (cpuHot) {
    const hotProcs = processes.filter(p => p.cpuPercent > 95);
    reasons.push(`CPU hot: ${hotProcs.map(p => `PID ${p.pid} at ${p.cpuPercent}%`).join(', ')}`);
  }

  // Memory check: any process > 4GB (heuristic for "something is bloating")
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

  // Compute risk level
  let level: RiskLevel = 'ok';
  if (noActivity && cpuHot) {
    level = 'critical'; // Hot CPU + no output = likely stuck
  } else if (noActivity || diskLow) {
    level = 'warn';
  } else if (cpuHot && memoryHigh) {
    level = 'warn';
  }

  return {
    level,
    noActivitySeconds: noActivitySeconds >= 0 ? noActivitySeconds : 0,
    cpuHot,
    memoryHigh,
    diskLow,
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
