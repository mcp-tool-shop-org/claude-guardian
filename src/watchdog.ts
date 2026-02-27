import { spawn, type ChildProcess } from 'child_process';
import pidusage from 'pidusage';
import type { GuardianConfig, HealthStatus, WatchdogState } from './types.js';
import { DEFAULT_CONFIG, THRESHOLDS, getClaudeProjectsPath } from './defaults.js';
import { getDiskFreeGB, dirSize, bytesToMB, writeJournalEntry, pathExists } from './fs-utils.js';
import { generateBundle } from './doctor.js';
import { scanLogs } from './log-manager.js';

export type WatchdogEventType =
  | 'started'
  | 'activity'
  | 'hang-detected'
  | 'crash-detected'
  | 'bundle-created'
  | 'restarting'
  | 'max-restarts'
  | 'stopped';

export type WatchdogEventHandler = (event: WatchdogEventType, detail: string) => void;

export class Watchdog {
  private config: GuardianConfig;
  private state: WatchdogState;
  private child: ChildProcess | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onEvent: WatchdogEventHandler;
  private command: string;
  private args: string[];
  private stopped = false;

  constructor(
    command: string,
    args: string[],
    config: GuardianConfig = DEFAULT_CONFIG,
    onEvent?: WatchdogEventHandler,
  ) {
    this.command = command;
    this.args = args;
    this.config = config;
    this.onEvent = onEvent || (() => {});
    this.state = {
      childPid: null,
      startTime: null,
      lastActivityTime: Date.now(),
      restartCount: 0,
      lastBundlePath: null,
    };
  }

  /** Start the child process and begin monitoring. */
  start(): void {
    this.stopped = false;
    this.spawnChild();
    this.startPolling();
    this.onEvent('started', `Watching PID ${this.state.childPid}`);
  }

  /** Gracefully stop monitoring and kill the child. */
  stop(): void {
    this.stopped = true;
    this.stopPolling();
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM');
    }
    this.onEvent('stopped', 'Watchdog stopped');
  }

  /** Get current health status. */
  async getHealth(): Promise<HealthStatus> {
    const claudePath = getClaudeProjectsPath();
    const diskFreeGB = await getDiskFreeGB(claudePath);
    let claudeLogSizeMB = 0;
    if (await pathExists(claudePath)) {
      claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
    }

    let cpuPercent: number | null = null;
    let memoryMB: number | null = null;

    if (this.state.childPid) {
      try {
        const usage = await pidusage(this.state.childPid);
        cpuPercent = Math.round(usage.cpu * 100) / 100;
        memoryMB = Math.round((usage.memory / (1024 * 1024)) * 100) / 100;
      } catch {
        // Process may have exited
      }
    }

    const now = Date.now();
    const lastActivitySecondsAgo = Math.round((now - this.state.lastActivityTime) / 1000);
    const uptime = this.state.startTime ? Math.round((now - this.state.startTime) / 1000) : null;

    return {
      pid: this.state.childPid,
      cpuPercent,
      memoryMB,
      diskFreeGB: Math.round(diskFreeGB * 100) / 100,
      claudeLogSizeMB,
      lastActivitySecondsAgo,
      hangDetected: lastActivitySecondsAgo > this.config.hangNoActivitySeconds,
      lastBundlePath: this.state.lastBundlePath,
      uptime,
    };
  }

  /** Get the raw watchdog state. */
  getState(): WatchdogState {
    return { ...this.state };
  }

  private spawnChild(): void {
    this.child = spawn(this.command, this.args, {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: true,
    });

    this.state.childPid = this.child.pid || null;
    this.state.startTime = Date.now();
    this.state.lastActivityTime = Date.now();

    // Track stdout/stderr as activity signals
    this.child.stdout?.on('data', (data: Buffer) => {
      this.state.lastActivityTime = Date.now();
      process.stdout.write(data);
    });

    this.child.stderr?.on('data', (data: Buffer) => {
      this.state.lastActivityTime = Date.now();
      process.stderr.write(data);
    });

    // Handle child exit
    this.child.on('exit', (code, signal) => {
      if (this.stopped) return;

      const detail = `Process exited with code=${code} signal=${signal}`;
      this.onEvent('crash-detected', detail);

      this.handleCrash(detail);
    });

    this.child.on('error', (err) => {
      if (this.stopped) return;

      const detail = `Process error: ${err.message}`;
      this.onEvent('crash-detected', detail);
      this.handleCrash(detail);
    });
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.pollCheck();
    }, THRESHOLDS.watchdogPollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async pollCheck(): Promise<void> {
    if (this.stopped || !this.state.childPid) return;

    const now = Date.now();
    const inactiveSec = (now - this.state.lastActivityTime) / 1000;

    // Check for hang
    if (inactiveSec > this.config.hangNoActivitySeconds) {
      this.onEvent('hang-detected', `No activity for ${Math.round(inactiveSec)}s`);

      await this.captureBundle('hang');

      if (this.config.autoRestart) {
        // Kill existing child and restart
        if (this.child && !this.child.killed) {
          this.child.kill('SIGTERM');
        }
        this.state.restartCount++;
        this.onEvent('restarting', `Restart #${this.state.restartCount} (hang recovery)`);
        this.spawnChild();
      }
    }
  }

  private async handleCrash(detail: string): Promise<void> {
    await this.captureBundle('crash');

    await writeJournalEntry({
      timestamp: new Date().toISOString(),
      action: 'crash-detected',
      detail,
    });

    if (this.config.autoRestart && this.state.restartCount < THRESHOLDS.maxRestarts) {
      const backoffIndex = Math.min(this.state.restartCount, THRESHOLDS.restartBackoffMs.length - 1);
      const delay = THRESHOLDS.restartBackoffMs[backoffIndex];

      this.onEvent('restarting', `Restart #${this.state.restartCount + 1} in ${delay}ms`);

      setTimeout(() => {
        if (!this.stopped) {
          this.state.restartCount++;
          this.spawnChild();
        }
      }, delay);
    } else if (this.state.restartCount >= THRESHOLDS.maxRestarts) {
      this.onEvent('max-restarts', `Reached max restarts (${THRESHOLDS.maxRestarts}). Giving up.`);
      this.stop();
    }
  }

  private async captureBundle(reason: string): Promise<void> {
    try {
      const bundle = await generateBundle();
      this.state.lastBundlePath = bundle.zipPath;
      this.onEvent('bundle-created', `Bundle saved: ${bundle.zipPath} (reason: ${reason})`);

      await writeJournalEntry({
        timestamp: new Date().toISOString(),
        action: 'bundle-created',
        target: bundle.zipPath,
        detail: `Diagnostics bundle created (reason: ${reason})`,
      });
    } catch (err) {
      // Don't let bundle creation failure crash the watchdog
      const msg = err instanceof Error ? err.message : String(err);
      this.onEvent('bundle-created', `Failed to create bundle: ${msg}`);
    }
  }
}

/** Format health status as a compact display. */
export function formatHealthStatus(health: HealthStatus): string {
  const lines: string[] = [];
  lines.push('=== Claude Guardian Status ===');
  lines.push('');

  if (health.pid) {
    lines.push(`Process: PID ${health.pid}`);
    if (health.uptime !== null) {
      const mins = Math.floor(health.uptime / 60);
      const secs = health.uptime % 60;
      lines.push(`Uptime: ${mins}m ${secs}s`);
    }
    if (health.cpuPercent !== null) lines.push(`CPU: ${health.cpuPercent}%`);
    if (health.memoryMB !== null) lines.push(`Memory: ${health.memoryMB}MB`);
  } else {
    lines.push('Process: not running');
  }

  lines.push('');
  lines.push(`Disk free: ${health.diskFreeGB}GB`);
  lines.push(`Claude log size: ${health.claudeLogSizeMB}MB`);

  if (health.lastActivitySecondsAgo !== null) {
    lines.push(`Last activity: ${health.lastActivitySecondsAgo}s ago`);
  }

  if (health.hangDetected) {
    lines.push('');
    lines.push('*** HANG DETECTED ***');
  }

  if (health.lastBundlePath) {
    lines.push('');
    lines.push(`Last bundle: ${health.lastBundlePath}`);
  }

  return lines.join('\n');
}
