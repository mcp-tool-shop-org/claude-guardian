import { getDiskFreeGB, dirSize, bytesToMB, pathExists, writeJournalEntry } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG, THRESHOLDS } from './defaults.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { writeState, type GuardianState } from './state.js';
import { fixLogs } from './log-manager.js';
import { generateBundle } from './doctor.js';
import { homedir } from 'os';

export interface WatchDaemonOptions {
  hangTimeoutSeconds: number;
  autoFix: boolean;
  verbose: boolean;
}

const DEFAULT_OPTIONS: WatchDaemonOptions = {
  hangTimeoutSeconds: DEFAULT_CONFIG.hangNoActivitySeconds,
  autoFix: false,
  verbose: false,
};

/** Start the watch daemon. Runs forever, polling every 2s. */
export async function startWatchDaemon(opts: Partial<WatchDaemonOptions> = {}): Promise<void> {
  const options = { ...DEFAULT_OPTIONS, ...opts };
  let lastRiskLevel: string = 'ok';
  let bundleCooldownUntil = 0; // Don't spam bundles

  const log = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[guardian ${ts}] ${msg}`);
  };

  log('Watch daemon starting...');
  log(`Hang timeout: ${options.hangTimeoutSeconds}s | Auto-fix: ${options.autoFix}`);

  // Write initial state
  await updateState(options, log);

  const interval = setInterval(async () => {
    try {
      const state = await updateState(options, options.verbose ? log : undefined);

      // React to risk level changes
      if (state.hangRisk.level !== lastRiskLevel) {
        log(`Risk level changed: ${lastRiskLevel} → ${state.hangRisk.level}`);

        if (state.hangRisk.level === 'critical') {
          log('CRITICAL: ' + state.hangRisk.reasons.join('; '));

          // Auto-capture bundle (with cooldown)
          if (Date.now() > bundleCooldownUntil) {
            log('Capturing diagnostics bundle...');
            try {
              const bundle = await generateBundle();
              log(`Bundle saved: ${bundle.zipPath}`);
              await writeJournalEntry({
                timestamp: new Date().toISOString(),
                action: 'auto-bundle',
                target: bundle.zipPath,
                detail: `Critical risk detected: ${state.hangRisk.reasons.join('; ')}`,
              });
              bundleCooldownUntil = Date.now() + 5 * 60 * 1000; // 5 min cooldown
            } catch (err) {
              log(`Failed to create bundle: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        if (state.hangRisk.level === 'warn' && state.hangRisk.diskLow && options.autoFix) {
          log('Low disk detected with auto-fix enabled. Running aggressive preflight...');
          const actions = await fixLogs(DEFAULT_CONFIG, true);
          if (actions.length > 0) {
            log(`Fixed ${actions.length} items.`);
          }
        }

        lastRiskLevel = state.hangRisk.level;
      }
    } catch (err) {
      // Don't let errors crash the daemon
      if (options.verbose) {
        log(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }, THRESHOLDS.watchdogPollMs);

  // Graceful shutdown
  const shutdown = () => {
    log('Shutting down...');
    clearInterval(interval);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {}); // Never resolves
}

/** Run one poll cycle and persist state. */
async function updateState(
  options: WatchDaemonOptions,
  log?: (msg: string) => void,
): Promise<GuardianState> {
  const claudePath = getClaudeProjectsPath();
  const diskFreeGB = await getDiskFreeGB(homedir());

  let claudeLogSizeMB = 0;
  if (await pathExists(claudePath)) {
    claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
  }

  const processes = await findClaudeProcesses();
  const activity = await checkActivitySignals();
  const hangRisk = assessHangRisk(processes, activity, diskFreeGB, options.hangTimeoutSeconds);
  const actions = recommendActions(hangRisk);

  const state: GuardianState = {
    updatedAt: new Date().toISOString(),
    daemonRunning: true,
    daemonPid: process.pid,
    claudeProcesses: processes,
    activity,
    hangRisk,
    recommendedActions: actions,
    diskFreeGB: Math.round(diskFreeGB * 100) / 100,
    claudeLogSizeMB,
  };

  await writeState(state);

  if (log && processes.length > 0) {
    log(`${processes.length} Claude process(es) | risk=${hangRisk.level} | disk=${state.diskFreeGB}GB | logs=${claudeLogSizeMB}MB`);
  }

  return state;
}
