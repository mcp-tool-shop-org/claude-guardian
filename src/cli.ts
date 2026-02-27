#!/usr/bin/env node

import { Command } from 'commander';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { Watchdog, formatHealthStatus } from './watchdog.js';
import { startMcpServer, formatBanner } from './mcp-server.js';
import { startWatchDaemon } from './watch-daemon.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { readState, isStateFresh, emptyState } from './state.js';
import { getDiskFreeGB, bytesToMB, pathExists, dirSize } from './fs-utils.js';
import { DEFAULT_CONFIG, getClaudeProjectsPath } from './defaults.js';
import { Budget } from './budget.js';
import { readBudget, writeBudget, emptyBudget } from './budget-store.js';
import { homedir } from 'os';
import type { GuardianConfig } from './types.js';
import type { GuardianState } from './state.js';

const program = new Command();

program
  .name('claude-guardian')
  .description('Flight computer for Claude Code — log rotation, watchdog, crash bundles, and MCP self-awareness')
  .version('1.1.0');

// ─── preflight ───
program
  .command('preflight')
  .description('Scan Claude logs and report issues. Use --fix to auto-repair.')
  .option('--fix', 'Automatically rotate/trim/compress oversized logs', false)
  .option('--aggressive', 'Enable aggressive mode: shorter retention, lower thresholds', false)
  .option('--max-log-mb <mb>', 'Max project log directory size in MB', String(DEFAULT_CONFIG.maxProjectLogDirMB))
  .action(async (opts) => {
    const config: GuardianConfig = {
      ...DEFAULT_CONFIG,
      maxProjectLogDirMB: parseInt(opts.maxLogMb, 10),
    };

    console.log('Scanning Claude logs...\n');
    const result = await scanLogs(config);
    console.log(formatPreflightReport(result));
    console.log('\n' + healthBanner(result));

    if (opts.fix) {
      console.log('\nApplying fixes...\n');
      const actions = await fixLogs(config, opts.aggressive);
      console.log(formatFixReport(actions));
    } else if (result.actions.length > 0) {
      console.log('\nRun with --fix to auto-repair issues.');
    }
  });

// ─── doctor ───
program
  .command('doctor')
  .description('Generate a diagnostics bundle (zip) with system info, log tails, and action journal.')
  .option('-o, --out <path>', 'Output path for the zip bundle')
  .action(async (opts) => {
    console.log('Generating diagnostics bundle...\n');
    const bundle = await generateBundle(opts.out);
    console.log(formatDoctorReport(bundle.summary));
    console.log(`\nBundle saved: ${bundle.zipPath}`);
  });

// ─── run ───
program
  .command('run')
  .description('Launch a command with watchdog monitoring. Captures bundles on crash/hang.')
  .argument('<command...>', 'The command to run (e.g., "claude" or "node server.js")')
  .option('--auto-restart', 'Automatically restart on crash/hang', DEFAULT_CONFIG.autoRestart)
  .option('--hang-timeout <seconds>', 'Seconds of inactivity before declaring a hang', String(DEFAULT_CONFIG.hangNoActivitySeconds))
  .option('--max-log-mb <mb>', 'Max project log directory size in MB', String(DEFAULT_CONFIG.maxProjectLogDirMB))
  .action(async (commandParts: string[], opts) => {
    const config: GuardianConfig = {
      maxProjectLogDirMB: parseInt(opts.maxLogMb, 10),
      hangNoActivitySeconds: parseInt(opts.hangTimeout, 10),
      autoRestart: opts.autoRestart,
    };

    // Run preflight first
    console.log('[guardian] Running preflight check...');
    const preflight = await scanLogs(config);
    const banner = healthBanner(preflight);
    console.log(`[guardian] ${banner}`);

    if (preflight.diskFreeWarning) {
      console.log('[guardian] WARNING: Low disk space. Running aggressive log cleanup...');
      const actions = await fixLogs(config, true);
      if (actions.length > 0) {
        console.log(`[guardian] Cleaned up ${actions.length} items.`);
      }
    }

    // Parse command
    const cmd = commandParts[0];
    const args = commandParts.slice(1);

    console.log(`[guardian] Starting: ${commandParts.join(' ')}`);
    console.log(`[guardian] Auto-restart: ${config.autoRestart}`);
    console.log(`[guardian] Hang timeout: ${config.hangNoActivitySeconds}s`);
    console.log('');

    const watchdog = new Watchdog(cmd, args, config, (event, detail) => {
      const timestamp = new Date().toISOString().substring(11, 19);
      switch (event) {
        case 'started':
          console.log(`[guardian ${timestamp}] Started: ${detail}`);
          break;
        case 'hang-detected':
          console.error(`[guardian ${timestamp}] HANG DETECTED: ${detail}`);
          break;
        case 'crash-detected':
          console.error(`[guardian ${timestamp}] CRASH DETECTED: ${detail}`);
          break;
        case 'bundle-created':
          console.log(`[guardian ${timestamp}] ${detail}`);
          break;
        case 'restarting':
          console.log(`[guardian ${timestamp}] ${detail}`);
          break;
        case 'max-restarts':
          console.error(`[guardian ${timestamp}] ${detail}`);
          break;
        case 'stopped':
          console.log(`[guardian ${timestamp}] ${detail}`);
          break;
      }
    });

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n[guardian] Shutting down...');
      watchdog.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    watchdog.start();
  });

// ─── watch ───
program
  .command('watch')
  .description('Run background daemon: monitor Claude Code processes, track health, persist state for MCP.')
  .option('--hang-timeout <seconds>', 'Seconds of inactivity before warning', String(DEFAULT_CONFIG.hangNoActivitySeconds))
  .option('--auto-fix', 'Auto-run preflight fixes when disk is low', false)
  .option('--verbose', 'Print every poll cycle', false)
  .action(async (opts) => {
    await startWatchDaemon({
      hangTimeoutSeconds: parseInt(opts.hangTimeout, 10),
      autoFix: opts.autoFix,
      verbose: opts.verbose,
    });
  });

// ─── status ───
program
  .command('status')
  .description('Show current health status: processes, hang risk, disk, logs.')
  .option('--banner', 'Print a single-line banner (for embedding in prompts)', false)
  .action(async (opts) => {
    // Try daemon state first
    const state = await readState();
    if (state && isStateFresh(state)) {
      if (opts.banner) {
        console.log(formatBanner(state));
        return;
      }
      printFullStatus(state);
    } else {
      // No daemon — build a live state snapshot
      const diskFreeGB = await getDiskFreeGB(homedir());
      const claudePath = getClaudeProjectsPath();
      let claudeLogSizeMB = 0;
      if (await pathExists(claudePath)) {
        claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
      }

      const processes = await findClaudeProcesses();
      const activity = await checkActivitySignals(processes);
      const hangRisk = assessHangRisk(
        processes, activity, diskFreeGB,
        DEFAULT_CONFIG.hangNoActivitySeconds,
        0, // processAgeSeconds — unknown without daemon
        0, // compositeQuietSeconds — unknown without daemon
      );
      const actions = recommendActions(hangRisk);

      const liveState: GuardianState = {
        updatedAt: new Date().toISOString(),
        daemonRunning: false,
        daemonPid: null,
        claudeProcesses: processes,
        activity,
        hangRisk,
        recommendedActions: actions,
        diskFreeGB: Math.round(diskFreeGB * 100) / 100,
        claudeLogSizeMB,
        activeIncident: null,
        processAgeSeconds: 0,
        compositeQuietSeconds: 0,
        budgetSummary: null,
      };

      if (opts.banner) {
        console.log(formatBanner(liveState));
        return;
      }
      printFullStatus(liveState);

      // Also show log scan when no daemon
      console.log('');
      const result = await scanLogs();
      console.log(formatPreflightReport(result));
      console.log('\n' + healthBanner(result));
    }
  });

/** Print the full multi-line status from a GuardianState. */
function printFullStatus(state: GuardianState): void {
  if (state.daemonRunning) {
    console.log(`[guardian] daemon=active | pid=${state.daemonPid}`);
  } else {
    console.log('[guardian] daemon=inactive (run `claude-guardian watch` to enable background monitoring)');
  }
  console.log(`[guardian] disk=${state.diskFreeGB}GB | logs=${state.claudeLogSizeMB}MB | risk=${state.hangRisk.level}`);
  console.log('');

  if (state.claudeProcesses.length > 0) {
    console.log(`Claude processes: ${state.claudeProcesses.length}`);
    for (const p of state.claudeProcesses) {
      let line = `  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB`;
      if (p.handleCount != null) {
        line += ` | handles=${p.handleCount}`;
      }
      line += ` | up ${fmtUptime(p.uptimeSeconds)}`;
      console.log(line);
    }
  } else {
    console.log('Claude processes: none detected');
  }
  console.log('');

  // Signals
  console.log('Signals:');
  console.log(`  Log activity: ${state.activity.logLastModifiedSecondsAgo >= 0 ? state.activity.logLastModifiedSecondsAgo + 's ago' : 'unknown'}`);
  console.log(`  CPU active: ${state.activity.cpuActive ? 'yes' : 'no'}`);
  if (state.hangRisk.graceRemainingSeconds > 0) {
    console.log(`  Grace remaining: ${state.hangRisk.graceRemainingSeconds}s`);
  }
  console.log(`  Composite quiet: ${state.compositeQuietSeconds}s`);
  console.log('');

  console.log(`Hang risk: ${state.hangRisk.level.toUpperCase()}`);
  if (state.hangRisk.reasons.length > 0) {
    for (const r of state.hangRisk.reasons) {
      console.log(`  - ${r}`);
    }
  }

  // Incident
  if (state.activeIncident) {
    console.log('');
    console.log(`Incident: ${state.activeIncident.id} (${state.activeIncident.peakLevel}) — ${state.activeIncident.reason}`);
    console.log(`  Started: ${state.activeIncident.startedAt}`);
    console.log(`  Bundle captured: ${state.activeIncident.bundleCaptured ? 'yes' : 'no'}`);
    if (state.activeIncident.bundlePath) {
      console.log(`  Bundle: ${state.activeIncident.bundlePath}`);
    }
  }

  // Budget
  if (state.budgetSummary) {
    console.log('');
    const b = state.budgetSummary;
    console.log(`Budget: cap=${b.currentCap}/${b.baseCap} | in-use=${b.slotsInUse} | available=${b.slotsAvailable}`);
    if (b.capSetByRisk) {
      console.log(`  Reduced by: ${b.capSetByRisk}`);
    }
    if (b.hysteresisRemainingSeconds > 0) {
      console.log(`  Recovery in: ${b.hysteresisRemainingSeconds}s`);
    }
  }

  if (state.recommendedActions.length > 0) {
    console.log('');
    console.log('Recommended:');
    for (const a of state.recommendedActions) {
      console.log(`  - ${a}`);
    }
  }
}

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

// ─── budget ───
const budgetCmd = program
  .command('budget')
  .description('View and manage the concurrency budget.');

budgetCmd
  .command('show', { isDefault: true })
  .description('Show current budget: cap, leases, availability.')
  .action(async () => {
    const data = await readBudget();
    if (!data) {
      console.log('[guardian] No budget state. Start the daemon or run `budget acquire` to initialize.');
      return;
    }
    const budget = new Budget(data);
    budget.expireLeases();
    const s = budget.summarize();

    console.log(`Budget: cap=${s.currentCap}/${s.baseCap} | in-use=${s.slotsInUse} | available=${s.slotsAvailable}`);
    console.log(`Active leases: ${s.activeLeases}`);
    if (s.capSetByRisk) {
      console.log(`Cap reduced by: ${s.capSetByRisk}`);
    }
    if (s.hysteresisRemainingSeconds > 0) {
      console.log(`Recovery in: ${s.hysteresisRemainingSeconds}s`);
    }

    // Show individual leases
    if (data.leases.length > 0) {
      console.log('');
      for (const l of data.leases) {
        const expiresIn = Math.max(0, Math.round((new Date(l.expiresAt).getTime() - Date.now()) / 1000));
        console.log(`  ${l.id}: ${l.slots} slot(s) — "${l.reason}" (expires in ${expiresIn}s)`);
      }
    }
  });

budgetCmd
  .command('acquire')
  .description('Acquire concurrency slots.')
  .argument('<slots>', 'Number of slots to acquire')
  .option('--ttl <seconds>', 'Lease time-to-live in seconds', '60')
  .option('--reason <text>', 'Reason for acquiring', 'manual')
  .action(async (slotsStr: string, opts) => {
    const data = await readBudget() ?? emptyBudget();
    const budget = new Budget(data);
    budget.expireLeases();
    const result = budget.acquire(parseInt(slotsStr, 10), parseInt(opts.ttl, 10), opts.reason);
    await writeBudget(budget.getData());

    if (result.granted) {
      console.log(`Lease granted: ${result.lease!.id} (${result.lease!.slots} slot(s), TTL ${opts.ttl}s)`);
      console.log(`Budget: ${result.slotsInUse}/${result.currentCap} in use`);
    } else {
      console.log(`Denied: ${result.reason}`);
    }
  });

budgetCmd
  .command('release')
  .description('Release a lease by ID.')
  .argument('<id>', 'Lease ID to release')
  .action(async (id: string) => {
    const data = await readBudget();
    if (!data) {
      console.log('[guardian] No budget state.');
      return;
    }
    const budget = new Budget(data);
    const released = budget.release(id);
    await writeBudget(budget.getData());
    console.log(released ? `Lease ${id} released.` : `Lease ${id} not found.`);
  });

// ─── mcp ───
program
  .command('mcp')
  .description('Start the MCP server on stdio. Register in ~/.claude.json for Claude Code integration.')
  .action(async () => {
    await startMcpServer();
  });

program.parse();
