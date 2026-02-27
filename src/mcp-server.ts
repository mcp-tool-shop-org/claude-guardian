import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { getDiskFreeGB, dirSize, bytesToMB, pathExists } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG } from './defaults.js';
import { findClaudeProcesses, checkActivitySignals, assessHangRisk, recommendActions } from './process-monitor.js';
import { readState, isStateFresh } from './state.js';
import { homedir } from 'os';

/** Create and configure the MCP server with all guardian tools. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'claude-guardian',
      version: '0.2.0',
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
          text: formatDaemonStatus(state),
        }],
      };
    }

    // No daemon running — do a live scan
    const claudePath = getClaudeProjectsPath();
    const diskFreeGB = await getDiskFreeGB(homedir());
    let claudeLogSizeMB = 0;
    if (await pathExists(claudePath)) {
      claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
    }

    // Live process detection
    const processes = await findClaudeProcesses();
    const activity = await checkActivitySignals();
    const hangRisk = assessHangRisk(processes, activity, diskFreeGB, DEFAULT_CONFIG.hangNoActivitySeconds);
    const actions = recommendActions(hangRisk);

    const scan = await scanLogs();
    const banner = healthBanner(scan);

    const lines: string[] = [];
    lines.push(banner);
    lines.push('');

    // Process info
    if (processes.length > 0) {
      lines.push(`Claude processes: ${processes.length}`);
      for (const p of processes) {
        lines.push(`  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB | up ${formatUptime(p.uptimeSeconds)}`);
      }
    } else {
      lines.push('Claude processes: none detected');
    }
    lines.push('');

    // Hang risk
    lines.push(`Hang risk: ${hangRisk.level.toUpperCase()}`);
    if (hangRisk.reasons.length > 0) {
      for (const r of hangRisk.reasons) {
        lines.push(`  - ${r}`);
      }
    }
    lines.push('');

    // Activity
    if (activity.logLastModifiedSecondsAgo >= 0) {
      lines.push(`Last log activity: ${activity.logLastModifiedSecondsAgo}s ago`);
    }
    lines.push(`Activity sources: ${activity.sources.join(', ') || 'none'}`);
    lines.push('');

    // Recommended actions
    if (actions.length > 0) {
      lines.push('Recommended actions:');
      for (const a of actions) {
        lines.push(`  - ${a}`);
      }
    }
    lines.push('');

    lines.push(formatPreflightReport(scan));

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n'),
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

/** Format state from the watch daemon into a readable report. */
function formatDaemonStatus(state: import('./state.js').GuardianState): string {
  const lines: string[] = [];

  lines.push(`[guardian] disk=${round(state.diskFreeGB)}GB | logs=${round(state.claudeLogSizeMB)}MB | risk=${state.hangRisk.level} | daemon=active`);
  lines.push('');

  // Process info
  if (state.claudeProcesses.length > 0) {
    lines.push(`Claude processes: ${state.claudeProcesses.length}`);
    for (const p of state.claudeProcesses) {
      lines.push(`  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB | up ${formatUptime(p.uptimeSeconds)}`);
    }
  } else {
    lines.push('Claude processes: none detected');
  }
  lines.push('');

  // Hang risk
  lines.push(`Hang risk: ${state.hangRisk.level.toUpperCase()}`);
  if (state.hangRisk.reasons.length > 0) {
    for (const r of state.hangRisk.reasons) {
      lines.push(`  - ${r}`);
    }
  }
  lines.push('');

  // Activity
  if (state.activity.logLastModifiedSecondsAgo >= 0) {
    lines.push(`Last log activity: ${state.activity.logLastModifiedSecondsAgo}s ago`);
  }
  lines.push(`Activity sources: ${state.activity.sources.join(', ') || 'none'}`);
  lines.push('');

  // Recommended actions
  if (state.recommendedActions.length > 0) {
    lines.push('Recommended actions:');
    for (const a of state.recommendedActions) {
      lines.push(`  - ${a}`);
    }
  }

  lines.push('');
  lines.push(`State updated: ${state.updatedAt}`);

  return lines.join('\n');
}

function formatUptime(seconds: number): string {
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
