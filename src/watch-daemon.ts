import { getDiskFreeGB, dirSize, bytesToMB, pathExists, writeJournalEntry } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG, THRESHOLDS } from './defaults.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { writeState, type GuardianState } from './state.js';
import { IncidentTracker } from './incident.js';
import { Budget } from './budget.js';
import { readBudget, writeBudget, emptyBudget } from './budget-store.js';
import { getHandleCounts } from './handle-count.js';
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
  const incidents = new IncidentTracker();

  // Tracking state across polls
  let processFirstSeenAt: number | null = null;
  let compositeQuietSince: number | null = null;

  const log = (msg: string) => {
    const ts = new Date().toISOString().substring(11, 19);
    console.log(`[guardian ${ts}] ${msg}`);
  };

  log('Watch daemon starting...');
  log(`Hang timeout: ${options.hangTimeoutSeconds}s | Auto-fix: ${options.autoFix}`);
  log(`Grace window: ${THRESHOLDS.graceWindowSeconds}s | Critical after: ${THRESHOLDS.criticalAfterSeconds}s`);

  const interval = setInterval(async () => {
    try {
      // Collect signals
      const claudePath = getClaudeProjectsPath();
      const diskFreeGB = await getDiskFreeGB(homedir());
      let claudeLogSizeMB = 0;
      if (await pathExists(claudePath)) {
        claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
      }

      const processes = await findClaudeProcesses();
      const activity = await checkActivitySignals(processes);

      // Track process age (grace window)
      const now = Date.now();
      if (processes.length > 0 && processFirstSeenAt === null) {
        processFirstSeenAt = now;
      } else if (processes.length === 0) {
        processFirstSeenAt = null;
        compositeQuietSince = null;
      }
      const processAgeSeconds = processFirstSeenAt
        ? Math.round((now - processFirstSeenAt) / 1000)
        : 0;

      // Track composite quiet duration
      const logQuiet = activity.logLastModifiedSecondsAgo < 0 ||
        activity.logLastModifiedSecondsAgo > options.hangTimeoutSeconds;
      const cpuLow = !activity.cpuActive;
      const compositeQuiet = logQuiet && cpuLow;

      if (compositeQuiet) {
        if (compositeQuietSince === null) {
          compositeQuietSince = now;
        }
      } else {
        compositeQuietSince = null;
      }
      const compositeQuietSeconds = compositeQuietSince
        ? Math.round((now - compositeQuietSince) / 1000)
        : 0;

      // Assess risk with composite signals
      const hangRisk = assessHangRisk(
        processes, activity, diskFreeGB,
        options.hangTimeoutSeconds,
        processAgeSeconds,
        compositeQuietSeconds,
      );
      const actions = recommendActions(hangRisk);

      // Update incident tracker
      const reason = hangRisk.reasons.join('; ') || 'healthy';
      const incident = incidents.update(hangRisk.level, reason);

      // Bundle capture: exactly once per incident, on first critical
      if (incidents.shouldCaptureBundle(processes.map(p => p.pid))) {
        log('CRITICAL — capturing diagnostics bundle (once per incident)...');
        try {
          const bundle = await generateBundle();
          incidents.markBundleCaptured(bundle.zipPath, processes.map(p => p.pid));
          log(`Bundle saved: ${bundle.zipPath}`);
          await writeJournalEntry({
            timestamp: new Date().toISOString(),
            action: 'auto-bundle',
            target: bundle.zipPath,
            detail: `Incident ${incident?.id}: ${reason}`,
          });
        } catch (err) {
          log(`Failed to create bundle: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Auto-fix on low disk
      if (hangRisk.diskLow && options.autoFix) {
        log('Low disk detected with auto-fix enabled. Running aggressive preflight...');
        const fixActions = await fixLogs(DEFAULT_CONFIG, true);
        if (fixActions.length > 0) {
          log(`Fixed ${fixActions.length} items.`);
        }
      }

      // Budget cap adjustment (read fresh each poll to avoid overwriting CLI changes)
      const budgetData = await readBudget() ?? emptyBudget();
      const budget = new Budget(budgetData);
      budget.expireLeases(now);
      const capChanged = budget.adjustCap(hangRisk.level, now);
      if (capChanged && options.verbose) {
        log(`Budget cap changed to ${budget.currentCap} (risk=${hangRisk.level})`);
      }
      await writeBudget(budget.getData());

      // Handle counts (best-effort, attached to process objects)
      if (processes.length > 0) {
        const handleResults = await getHandleCounts(processes.map(p => p.pid));
        for (const hc of handleResults) {
          const proc = processes.find(p => p.pid === hc.pid);
          if (proc) proc.handleCount = hc.count;
        }
      }

      // Persist state
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
        activeIncident: incidents.getActive(),
        processAgeSeconds,
        compositeQuietSeconds,
        budgetSummary: budget.summarize(now),
      };
      await writeState(state);

      if (options.verbose && processes.length > 0) {
        log(`${processes.length} procs | risk=${hangRisk.level} | grace=${hangRisk.graceRemainingSeconds}s | quiet=${compositeQuietSeconds}s | incident=${incident?.id ?? 'none'}`);
      }
    } catch (err) {
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

  await new Promise(() => {}); // Never resolves
}
