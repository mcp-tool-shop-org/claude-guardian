import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp-server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { writeBudget, emptyBudget } from '../src/budget-store.js';

describe('budget MCP tools', () => {
  async function setupClientServer() {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  describe('guardian_budget_get', () => {
    it('is registered with correct metadata', async () => {
      const { client, server } = await setupClientServer();
      const tools = await client.listTools();
      const tool = tools.tools.find(t => t.name === 'guardian_budget_get');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('concurrency budget');
      await server.close();
    });

    it('returns budget info or not-initialized message', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();
      const result = await client.callTool({ name: 'guardian_budget_get', arguments: {} });
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      // Either shows budget or says not initialized
      const text = textContent[0].text;
      expect(text.includes('Budget:') || text.includes('not initialized')).toBe(true);
      await server.close();
    });
  });

  describe('guardian_budget_acquire', () => {
    it('is registered with correct metadata', async () => {
      const { client, server } = await setupClientServer();
      const tools = await client.listTools();
      const tool = tools.tools.find(t => t.name === 'guardian_budget_acquire');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('Acquire concurrency slots');
      expect(tool!.inputSchema).toBeDefined();
      await server.close();
    });

    it('acquires slots and returns lease info', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();
      const result = await client.callTool({
        name: 'guardian_budget_acquire',
        arguments: { slots: 1, ttlSeconds: 30, reason: 'test-acquire' },
      });
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      expect(textContent[0].text).toContain('Granted');
      expect(textContent[0].text).toContain('lease=');
      await server.close();
    });
  });

  describe('guardian_budget_release', () => {
    it('is registered with correct metadata', async () => {
      const { client, server } = await setupClientServer();
      const tools = await client.listTools();
      const tool = tools.tools.find(t => t.name === 'guardian_budget_release');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('Release a concurrency lease');
      expect(tool!.inputSchema).toBeDefined();
      await server.close();
    });

    it('returns not-found for unknown lease', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();
      const result = await client.callTool({
        name: 'guardian_budget_release',
        arguments: { leaseId: 'nonexistent' },
      });
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      expect(textContent[0].text).toContain('not found');
      await server.close();
    });

    it('acquire then release round-trip works', { timeout: 15000 }, async () => {
      // Reset budget to fresh state to avoid interference from parallel tests
      await writeBudget(emptyBudget());
      const { client, server } = await setupClientServer();

      // Acquire
      const acquireResult = await client.callTool({
        name: 'guardian_budget_acquire',
        arguments: { slots: 1, ttlSeconds: 60, reason: 'round-trip-test' },
      });
      const acquireText = (acquireResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(acquireText).toContain('Granted');

      // Extract lease ID
      const match = acquireText.match(/lease=([a-f0-9]+)/);
      expect(match).not.toBeNull();
      const leaseId = match![1];

      // Release
      const releaseResult = await client.callTool({
        name: 'guardian_budget_release',
        arguments: { leaseId },
      });
      const releaseText = (releaseResult.content as Array<{ type: string; text: string }>)[0].text;
      expect(releaseText).toContain('Released');
      expect(releaseText).toContain(leaseId);

      await server.close();
    });
  });

  describe('guardian_recovery_plan', () => {
    it('is registered with correct metadata', async () => {
      const { client, server } = await setupClientServer();
      const tools = await client.listTools();
      const tool = tools.tools.find(t => t.name === 'guardian_recovery_plan');
      expect(tool).toBeDefined();
      expect(tool!.description).toContain('recovery plan');
      await server.close();
    });

    it('returns a recovery plan', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();
      const result = await client.callTool({ name: 'guardian_recovery_plan', arguments: {} });
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      expect(textContent[0].text).toContain('Recovery Plan');
      // Should contain HEALTHY or ACTION_NEEDED or URGENT
      const text = textContent[0].text;
      expect(text.includes('HEALTHY') || text.includes('ACTION_NEEDED') || text.includes('URGENT')).toBe(true);
      await server.close();
    });
  });
});
