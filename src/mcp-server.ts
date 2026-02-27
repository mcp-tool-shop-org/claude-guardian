import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner } from './log-manager.js';
import { generateBundle, formatDoctorReport } from './doctor.js';
import { getDiskFreeGB, dirSize, bytesToMB, pathExists } from './fs-utils.js';
import { getClaudeProjectsPath, DEFAULT_CONFIG } from './defaults.js';
import { homedir } from 'os';
import type { GuardianConfig } from './types.js';

/** Create and configure the MCP server with all guardian tools. */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: 'claude-guardian',
      version: '0.1.0',
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
    const claudePath = getClaudeProjectsPath();
    const diskFreeGB = await getDiskFreeGB(homedir());
    let claudeLogSizeMB = 0;
    if (await pathExists(claudePath)) {
      claudeLogSizeMB = bytesToMB(await dirSize(claudePath));
    }

    const scan = await scanLogs();
    const banner = healthBanner(scan);
    const report = formatPreflightReport(scan);

    return {
      content: [
        {
          type: 'text' as const,
          text: `${banner}\n\n${report}`,
        },
      ],
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
    // First scan
    const scanBefore = await scanLogs();

    // Apply fixes
    const actions = await fixLogs(DEFAULT_CONFIG, aggressive ?? false);

    // Scan again to show the effect
    const scanAfter = await scanLogs();

    const report = formatFixReport(actions);
    const bannerBefore = healthBanner(scanBefore);
    const bannerAfter = healthBanner(scanAfter);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Before: ${bannerBefore}\nAfter:  ${bannerAfter}\n\n${report}`,
        },
      ],
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
      content: [
        {
          type: 'text' as const,
          text: `Bundle saved: ${bundle.zipPath}\n\n${report}`,
        },
      ],
    };
  });

  return server;
}

/** Start the MCP server on stdio. */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
