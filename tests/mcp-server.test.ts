import { describe, it, expect, afterEach } from 'vitest';
import { createMcpServer, formatBanner } from '../src/mcp-server.js';
import { emptyState } from '../src/state.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createServer, type Server } from 'http';

describe('MCP Server', () => {
  async function setupClientServer() {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    return { client, server };
  }

  describe('tool registration', () => {
    it('exposes all 10 guardian tools', async () => {
      const { client, server } = await setupClientServer();

      const tools = await client.listTools();
      const toolNames = tools.tools.map(t => t.name);

      expect(toolNames).toContain('guardian_status');
      expect(toolNames).toContain('guardian_preflight_fix');
      expect(toolNames).toContain('guardian_doctor');
      expect(toolNames).toContain('guardian_nudge');
      expect(toolNames).toContain('guardian_budget_get');
      expect(toolNames).toContain('guardian_budget_acquire');
      expect(toolNames).toContain('guardian_budget_release');
      expect(toolNames).toContain('guardian_recovery_plan');
      expect(toolNames).toContain('guardian_preview_ready');
      expect(toolNames).toContain('guardian_preview_recover');
      expect(tools.tools.length).toBe(10);

      await server.close();
    });

    it('guardian_status has correct metadata', async () => {
      const { client, server } = await setupClientServer();

      const tools = await client.listTools();
      const statusTool = tools.tools.find(t => t.name === 'guardian_status');

      expect(statusTool).toBeDefined();
      expect(statusTool!.description).toContain('health status');

      await server.close();
    });

    it('guardian_preflight_fix accepts aggressive parameter', async () => {
      const { client, server } = await setupClientServer();

      const tools = await client.listTools();
      const fixTool = tools.tools.find(t => t.name === 'guardian_preflight_fix');

      expect(fixTool).toBeDefined();
      expect(fixTool!.inputSchema).toBeDefined();

      await server.close();
    });

    it('guardian_doctor accepts outputPath parameter', async () => {
      const { client, server } = await setupClientServer();

      const tools = await client.listTools();
      const doctorTool = tools.tools.find(t => t.name === 'guardian_doctor');

      expect(doctorTool).toBeDefined();
      expect(doctorTool!.inputSchema).toBeDefined();

      await server.close();
    });
  });

  describe('tool execution', () => {
    it('guardian_status returns composite health info', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();

      const result = await client.callTool({ name: 'guardian_status', arguments: {} });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      // Phase 1: should contain composite signal output
      expect(textContent[0].text).toContain('[guardian]');
      expect(textContent[0].text).toContain('disk=');
      expect(textContent[0].text).toContain('quiet=');
      expect(textContent[0].text).toContain('risk=');
      expect(textContent[0].text).toContain('Hang risk:');
      expect(textContent[0].text).toContain('Incident:');
      expect(textContent[0].text).toContain('Budget:');
      expect(textContent[0].text).toContain('Attention:');

      await server.close();
    });

    it('guardian_preview_ready detects a running server', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();

      // Start a local HTTP server on an ephemeral port
      const httpServer = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
      await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
      const httpPort = (httpServer.address() as { port: number }).port;

      try {
        const result = await client.callTool({
          name: 'guardian_preview_ready',
          arguments: { port: httpPort, timeoutMs: 5000 },
        });

        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toContain('Server is ready');
        expect(text).toContain(String(httpPort));
      } finally {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        await server.close();
      }
    });

    it('guardian_preview_ready reports timeout on closed port', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();

      const result = await client.callTool({
        name: 'guardian_preview_ready',
        arguments: { port: 19998, timeoutMs: 2000 },
      });

      const text = (result.content as Array<{ type: string; text: string }>)[0].text;
      expect(text).toContain('did not respond');
      expect(text).toContain('preview_logs');

      await server.close();
    });

    it('guardian_preview_recover returns skip guidance for non-web project', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();
      const { mkdtemp, writeFile, rm } = await import('fs/promises');
      const { join } = await import('path');
      const { tmpdir } = await import('os');

      const dir = await mkdtemp(join(tmpdir(), 'guardian-test-'));
      await writeFile(join(dir, 'tauri.conf.json'), '{}');

      try {
        const result = await client.callTool({
          name: 'guardian_preview_recover',
          arguments: { port: 3000, projectDir: dir },
        });

        const text = (result.content as Array<{ type: string; text: string }>)[0].text;
        expect(text).toContain('NOT a web project');
        expect(text).toContain('Skip preview_start');
      } finally {
        await rm(dir, { recursive: true, force: true });
        await server.close();
      }
    });

    it('guardian_preflight_fix runs without error', { timeout: 30000 }, async () => {
      const { client, server } = await setupClientServer();

      const result = await client.callTool({
        name: 'guardian_preflight_fix',
        arguments: { aggressive: false },
      });

      expect(result.content).toBeDefined();
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      expect(textContent[0].text).toContain('Before:');
      expect(textContent[0].text).toContain('After:');

      await server.close();
    });
  });
});

describe('formatBanner', () => {
  it('produces a single-line [guardian] banner', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    const banner = formatBanner(state);

    expect(banner).toMatch(/^\[guardian\]/);
    expect(banner).toContain('disk=');
    expect(banner).toContain('logs=');
    expect(banner).toContain('quiet=');
    expect(banner).toContain('risk=ok');
    // Single line
    expect(banner.split('\n')).toHaveLength(1);
  });

  it('includes process stats when processes exist', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.claudeProcesses = [
      { pid: 1, name: 'claude', cpuPercent: 30, memoryMB: 512, uptimeSeconds: 100 },
    ];
    const banner = formatBanner(state);

    expect(banner).toContain('procs=1');
    expect(banner).toContain('cpu=');
    expect(banner).toContain('rss=');
  });

  it('includes incident id when incident is active', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.activeIncident = {
      id: 'abc123',
      startedAt: new Date().toISOString(),
      closedAt: null,
      reason: 'test',
      peakLevel: 'warn',
      bundleCaptured: false,
      bundlePath: null,
    };
    const banner = formatBanner(state);
    expect(banner).toContain('incident=abc123');
  });

  it('includes daemon=on when daemon is running', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.daemonRunning = true;
    state.daemonPid = 9999;
    const banner = formatBanner(state);
    expect(banner).toContain('daemon=on');
  });

  it('includes budget cap when budgetSummary is present', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.budgetSummary = {
      currentCap: 2,
      baseCap: 4,
      slotsInUse: 1,
      slotsAvailable: 1,
      activeLeases: 1,
      capSetByRisk: 'warn',
      okSinceAt: null,
      hysteresisRemainingSeconds: 0,
    };
    const banner = formatBanner(state);
    expect(banner).toContain('cap=2/4');
  });

  it('includes handle count when processes have handles', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.claudeProcesses = [
      { pid: 1, name: 'claude', cpuPercent: 10, memoryMB: 512, uptimeSeconds: 100, handleCount: 150 },
    ];
    const banner = formatBanner(state);
    expect(banner).toContain('handles=150');
  });

  it('includes attn when attention is not none', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.attention = {
      level: 'warn',
      since: new Date().toISOString(),
      reason: 'test warning',
      recommendedActions: [],
      incidentId: null,
    };
    const banner = formatBanner(state);
    expect(banner).toContain('attn=warn');
  });

  it('excludes attn when attention is none', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    const banner = formatBanner(state);
    expect(banner).not.toContain('attn=');
  });
});
