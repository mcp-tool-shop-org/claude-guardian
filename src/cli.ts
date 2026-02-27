#!/usr/bin/env node

import { Command } from 'commander';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { Watchdog, formatHealthStatus } from './watchdog.js';
import { startMcpServer } from './mcp-server.js';
import { startWatchDaemon } from './watch-daemon.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { readState, isStateFresh } from './state.js';
import { getDiskFreeGB } from './fs-utils.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { homedir } from 'os';
import type { GuardianConfig } from './types.js';

const program = new Command();

program
  .name('claude-guardian')
  .description('Flight computer for Claude Code — log rotation, watchdog, crash bundles, and MCP self-awareness')
  .version('0.2.0');

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
  .action(async () => {
    // Try daemon state first
    const state = await readState();
    if (state && isStateFresh(state)) {
      console.log(`[guardian] daemon=active | pid=${state.daemonPid}`);
      console.log(`[guardian] disk=${state.diskFreeGB}GB | logs=${state.claudeLogSizeMB}MB | risk=${state.hangRisk.level}`);
      console.log('');
      if (state.claudeProcesses.length > 0) {
        console.log(`Claude processes: ${state.claudeProcesses.length}`);
        for (const p of state.claudeProcesses) {
          const uptime = p.uptimeSeconds < 60 ? `${p.uptimeSeconds}s` : `${Math.floor(p.uptimeSeconds / 60)}m`;
          console.log(`  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB | up ${uptime}`);
        }
      } else {
        console.log('Claude processes: none detected');
      }
      console.log('');
      console.log(`Hang risk: ${state.hangRisk.level.toUpperCase()}`);
      if (state.hangRisk.reasons.length > 0) {
        for (const r of state.hangRisk.reasons) {
          console.log(`  - ${r}`);
        }
      }
      if (state.recommendedActions.length > 0) {
        console.log('');
        console.log('Recommended:');
        for (const a of state.recommendedActions) {
          console.log(`  - ${a}`);
        }
      }
    } else {
      // No daemon — do a live scan
      console.log('[guardian] daemon=inactive (run `claude-guardian watch` to enable background monitoring)');
      console.log('');

      const diskFreeGB = await getDiskFreeGB(homedir());
      const processes = await findClaudeProcesses();
      const activity = await checkActivitySignals();
      const hangRisk = assessHangRisk(processes, activity, diskFreeGB, DEFAULT_CONFIG.hangNoActivitySeconds);

      if (processes.length > 0) {
        console.log(`Claude processes: ${processes.length}`);
        for (const p of processes) {
          const uptime = p.uptimeSeconds < 60 ? `${p.uptimeSeconds}s` : `${Math.floor(p.uptimeSeconds / 60)}m`;
          console.log(`  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB | up ${uptime}`);
        }
      } else {
        console.log('Claude processes: none detected');
      }
      console.log('');
      console.log(`Hang risk: ${hangRisk.level.toUpperCase()}`);
      if (hangRisk.reasons.length > 0) {
        for (const r of hangRisk.reasons) {
          console.log(`  - ${r}`);
        }
      }

      console.log('');
      const result = await scanLogs();
      console.log(formatPreflightReport(result));
      console.log('\n' + healthBanner(result));
    }
  });

// ─── mcp ───
program
  .command('mcp')
  .description('Start the MCP server on stdio. Register in ~/.claude.json for Claude Code integration.')
  .action(async () => {
    await startMcpServer();
  });

program.parse();
