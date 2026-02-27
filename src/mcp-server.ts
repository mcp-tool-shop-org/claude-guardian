import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { getDiskFreeGB, dirSize, bytesToMB, pathExists } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG, THRESHOLDS } from './defaults.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { readState, isStateFresh, type GuardianState } from './state.js';
import { readBudget } from './budget-store.js';
import { Budget } from './budget.js';
import { homedir } from 'os';

/** Create and configure the MCP server with all guardian tools. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'claude-guardian',
      version: '1.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // === guardian_status ===
  server.registerTool('guardian_status', {
    title: 'Guardian Status',
    description:
      'Returns current health status: disk free space, Claude log sizes, and a one-line health banner. ' +
      'Use this to check environment health before or during long tasks.',
  }, async () => {
    // Try reading fresh state from the watch daemon first
    const state = await readState();
    if (state && isStateFresh(state)) {
      return {
        content: [{
          type: 'text' as const,
          text: formatStatus(state),
        }],
      };
    }

    // No daemon — do a live scan with default composite values
    const claudePath = getClaudeProjectsPath();
    const diskFreeGB = await getDiskFreeGB(homedir());
    let claudeLogSizeMB = 0;
    if (await pathExists(claudePath)) {
      claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
    }

    const processes = await findClaudeProcesses();
    const activity = await checkActivitySignals(processes);

    // Without the daemon we can't track process age or composite quiet duration,
    // so we use safe defaults (grace=0, quiet=0) — risk will be ok.
    const hangRisk = assessHangRisk(
      processes, activity, diskFreeGB,
      DEFAULT_CONFIG.hangNoActivitySeconds,
      0, // processAgeSeconds — unknown without daemon
      0, // compositeQuietSeconds — unknown without daemon
    );
    const actions = recommendActions(hangRisk);

    const scan = await scanLogs();

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

    return {
      content: [{
        type: 'text' as const,
        text: formatStatus(liveState) + '\n\n' + formatPreflightReport(scan),
      }],
    };
  });

  // === guardian_preflight_fix ===
  server.registerTool('guardian_preflight_fix', {
    title: 'Guardian Preflight Fix',
    description:
      'Scans Claude project logs and automatically rotates/trims oversized files. ' +
      'Safe and reversible — old logs are gzipped, large files are trimmed to last N lines. ' +
      'Use this when guardian_status shows warnings or before starting intensive work.',
    inputSchema: {
      aggressive: z.boolean().optional().describe(
        'Enable aggressive mode: shorter retention, lower thresholds. Auto-enabled when disk is low.'
      ),
    },
  }, async ({ aggressive }) => {
    const scanBefore = await scanLogs();
    const fixActions = await fixLogs(DEFAULT_CONFIG, aggressive ?? false);
    const scanAfter = await scanLogs();

    const report = formatFixReport(fixActions);
    const bannerBefore = healthBanner(scanBefore);
    const bannerAfter = healthBanner(scanAfter);

    return {
      content: [{
        type: 'text' as const,
        text: `Before: ${bannerBefore}\nAfter:  ${bannerAfter}\n\n${report}`,
      }],
    };
  });

  // === guardian_doctor ===
  server.registerTool('guardian_doctor', {
    title: 'Guardian Doctor',
    description:
      'Generates a full diagnostics bundle (zip) containing system info, log tails, ' +
      'file size reports, and the guardian action journal. Returns the bundle path and a summary report. ' +
      'Use this when something has gone wrong and you need evidence.',
    inputSchema: {
      outputPath: z.string().optional().describe(
        'Custom output path for the zip bundle. Defaults to ~/.claude-guardian/bundle-<timestamp>.zip'
      ),
    },
  }, async ({ outputPath }) => {
    const bundle = await generateBundle(outputPath);
    const report = formatDoctorReport(bundle.summary);

    return {
      content: [{
        type: 'text' as const,
        text: `Bundle saved: ${bundle.zipPath}\n\n${report}`,
      }],
    };
  });

  // === guardian_nudge ===
  server.registerTool('guardian_nudge', {
    title: 'Guardian Nudge',
    description:
      'Deterministic "do the safe things" action. If logs/disk thresholds breached, runs preflight fix. ' +
      'If warn/critical with no bundle yet, captures diagnostics. ' +
      'Returns what changed and what to do next. Never kills processes or restarts.',
  }, async () => {
    // Get current state (daemon or live)
    const state = await readState();
    let effectiveState: GuardianState;

    if (state && isStateFresh(state)) {
      effectiveState = state;
    } else {
      // Build live state
      const claudePath = getClaudeProjectsPath();
      const diskFreeGB = await getDiskFreeGB(homedir());
      let claudeLogSizeMB = 0;
      if (await pathExists(claudePath)) {
        claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
      }
      const processes = await findClaudeProcesses();
      const activity = await checkActivitySignals(processes);
      const hangRisk = assessHangRisk(
        processes, activity, diskFreeGB,
        DEFAULT_CONFIG.hangNoActivitySeconds, 0, 0,
      );
      effectiveState = {
        updatedAt: new Date().toISOString(),
        daemonRunning: false,
        daemonPid: null,
        claudeProcesses: processes,
        activity,
        hangRisk,
        recommendedActions: recommendActions(hangRisk),
        diskFreeGB: Math.round(diskFreeGB * 100) / 100,
        claudeLogSizeMB,
        activeIncident: null,
        processAgeSeconds: 0,
        compositeQuietSeconds: 0,
        budgetSummary: null,
      };
    }

    const actions: string[] = [];

    // 1. Logs/disk threshold check
    if (effectiveState.hangRisk.diskLow || effectiveState.claudeLogSizeMB > DEFAULT_CONFIG.maxProjectLogDirMB) {
      const fixActions = await fixLogs(DEFAULT_CONFIG, effectiveState.hangRisk.diskLow);
      if (fixActions.length > 0) {
        actions.push(`Preflight fix: ${fixActions.length} items repaired`);
      }
    }

    // 2. Bundle capture for active incident without bundle
    if (effectiveState.activeIncident &&
        (effectiveState.hangRisk.level === 'warn' || effectiveState.hangRisk.level === 'critical') &&
        !effectiveState.activeIncident.bundleCaptured) {
      try {
        const bundle = await generateBundle();
        actions.push(`Doctor bundle saved: ${bundle.zipPath}`);
      } catch (err) {
        actions.push(`Doctor bundle failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 3. No-op
    if (actions.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'All clear. No actions needed.',
        }],
      };
    }

    // 4. Operator script
    const script = formatNudgeReport(actions, effectiveState);
    return {
      content: [{
        type: 'text' as const,
        text: script,
      }],
    };
  });

  return server;
}

/** Format the nudge action report with next-step guidance. */
function formatNudgeReport(actions: string[], state: GuardianState): string {
  const lines: string[] = [];
  lines.push('Guardian Nudge — actions taken:');
  for (const a of actions) {
    lines.push(`  - ${a}`);
  }
  lines.push('');

  // Next-step recommendations
  lines.push('Next steps:');
  if (state.hangRisk.level === 'critical') {
    lines.push('  - Risk is CRITICAL: consider restarting Claude Code if no recovery in 2 minutes');
    lines.push('  - Reduce concurrency immediately');
  } else if (state.hangRisk.level === 'warn') {
    lines.push('  - Risk is WARN: reduce concurrency to prevent escalation');
    lines.push('  - Monitor with guardian_status');
  } else {
    lines.push('  - Continue monitoring with guardian_status');
  }

  if (state.budgetSummary) {
    lines.push(`  - Budget cap: ${state.budgetSummary.currentCap}/${state.budgetSummary.baseCap} (${state.budgetSummary.slotsAvailable} available)`);
  }

  return lines.join('\n');
}

/** Format full status from state (works for both daemon and live). */
function formatStatus(state: GuardianState): string {
  const lines: string[] = [];

  // Banner line
  lines.push(formatBanner(state));
  lines.push('');

  // Daemon status
  if (state.daemonRunning) {
    lines.push(`Daemon: active (PID ${state.daemonPid})`);
  } else {
    lines.push('Daemon: inactive (run `claude-guardian watch` for continuous monitoring)');
  }
  lines.push('');

  // Process info
  if (state.claudeProcesses.length > 0) {
    lines.push(`Claude processes: ${state.claudeProcesses.length}`);
    for (const p of state.claudeProcesses) {
      let line = `  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB`;
      if (p.handleCount != null) {
        line += ` | handles=${p.handleCount}`;
      }
      line += ` | up ${fmtUptime(p.uptimeSeconds)}`;
      lines.push(line);
    }
  } else {
    lines.push('Claude processes: none detected');
  }
  lines.push('');

  // Composite signals
  lines.push('Signals:');
  lines.push(`  Log activity: ${state.activity.logLastModifiedSecondsAgo >= 0 ? state.activity.logLastModifiedSecondsAgo + 's ago' : 'unknown'}`);
  lines.push(`  CPU active: ${state.activity.cpuActive ? 'yes' : 'no'}`);
  lines.push(`  Sources: ${state.activity.sources.join(', ') || 'none'}`);
  if (state.hangRisk.graceRemainingSeconds > 0) {
    lines.push(`  Grace remaining: ${state.hangRisk.graceRemainingSeconds}s`);
  }
  lines.push(`  Composite quiet: ${state.compositeQuietSeconds}s`);
  lines.push('');

  // Risk
  lines.push(`Hang risk: ${state.hangRisk.level.toUpperCase()}`);
  if (state.hangRisk.reasons.length > 0) {
    for (const r of state.hangRisk.reasons) {
      lines.push(`  - ${r}`);
    }
  }
  lines.push('');

  // Incident
  if (state.activeIncident) {
    const i = state.activeIncident;
    lines.push(`Incident: ${i.id} (${i.peakLevel}) — ${i.reason}`);
    lines.push(`  Started: ${i.startedAt}`);
    lines.push(`  Bundle captured: ${i.bundleCaptured ? 'yes' : 'no'}`);
    if (i.bundlePath) {
      lines.push(`  Bundle: ${i.bundlePath}`);
    }
  } else {
    lines.push('Incident: none');
  }
  lines.push('');

  // Budget
  if (state.budgetSummary) {
    const b = state.budgetSummary;
    lines.push(`Budget: cap=${b.currentCap}/${b.baseCap} | in-use=${b.slotsInUse} | available=${b.slotsAvailable} | leases=${b.activeLeases}`);
    if (b.capSetByRisk) {
      lines.push(`  Reduced by: ${b.capSetByRisk}`);
    }
    if (b.hysteresisRemainingSeconds > 0) {
      lines.push(`  Recovery in: ${b.hysteresisRemainingSeconds}s`);
    }
  } else {
    lines.push('Budget: not initialized');
  }
  lines.push('');

  // Recommended actions
  if (state.recommendedActions.length > 0) {
    lines.push('Recommended actions:');
    for (const a of state.recommendedActions) {
      lines.push(`  - ${a}`);
    }
  }

  return lines.join('\n');
}

/** One-line banner for bug reports. */
export function formatBanner(state: GuardianState): string {
  const parts: string[] = [];
  parts.push(`disk=${round(state.diskFreeGB)}GB`);
  parts.push(`logs=${round(state.claudeLogSizeMB)}MB`);

  if (state.claudeProcesses.length > 0) {
    const totalCpu = state.claudeProcesses.reduce((s, p) => s + p.cpuPercent, 0);
    const totalMem = state.claudeProcesses.reduce((s, p) => s + p.memoryMB, 0);
    parts.push(`procs=${state.claudeProcesses.length}`);
    parts.push(`cpu=${round(totalCpu)}%`);
    parts.push(`rss=${Math.round(totalMem)}MB`);

    // Total handle count (if any process has it)
    const handles = state.claudeProcesses
      .filter(p => p.handleCount != null)
      .reduce((s, p) => s + (p.handleCount ?? 0), 0);
    if (handles > 0) {
      parts.push(`handles=${handles}`);
    }
  }

  parts.push(`quiet=${state.compositeQuietSeconds}s`);
  parts.push(`risk=${state.hangRisk.level}`);

  if (state.budgetSummary) {
    parts.push(`cap=${state.budgetSummary.currentCap}/${state.budgetSummary.baseCap}`);
  }

  if (state.activeIncident) {
    parts.push(`incident=${state.activeIncident.id}`);
  }

  if (state.daemonRunning) {
    parts.push('daemon=on');
  }

  return `[guardian] ${parts.join(' | ')}`;
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

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Start the MCP server on stdio. */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
