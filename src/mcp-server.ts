import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { getDiskFreeGB, dirSize, bytesToMB, pathExists } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG, THRESHOLDS } from './defaults.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { readState, isStateFresh, type GuardianState } from './state.js';
import { homedir } from 'os';

/** Create and configure the MCP server with all guardian tools. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'claude-guardian',
      version: '1.0.0',
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

  return server;
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
      lines.push(`  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB | up ${fmtUptime(p.uptimeSeconds)}`);
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
  }

  parts.push(`quiet=${state.compositeQuietSeconds}s`);
  parts.push(`risk=${state.hangRisk.level}`);

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
