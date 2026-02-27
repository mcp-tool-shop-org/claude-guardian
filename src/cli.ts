#!/usr/bin/env node

import { Command } from 'commander';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { Watchdog, formatHealthStatus } from './watchdog.js';
import { startMcpServer } from './mcp-server.js';
import { DEFAULT_CONFIG } from './defaults.js';
import type { GuardianConfig } from './types.js';

const program = new Command();

program
  .name('claude-guardian')
  .description('Flight computer for Claude Code — log rotation, watchdog, crash bundles, and MCP self-awareness')
  .version('0.1.0');

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

// ─── status ───
program
  .command('status')
  .description('Show current health status (disk, logs, warnings).')
  .action(async () => {
    const result = await scanLogs();
    console.log(formatPreflightReport(result));
    console.log('\n' + healthBanner(result));
  });

// ─── mcp ───
program
  .command('mcp')
  .description('Start the MCP server on stdio. Register in ~/.claude.json for Claude Code integration.')
  .action(async () => {
    await startMcpServer();
  });

program.parse();
