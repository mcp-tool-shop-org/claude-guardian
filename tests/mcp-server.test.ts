import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp-server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

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
    it('exposes all 3 guardian tools', async () => {
      const { client, server } = await setupClientServer();

      const tools = await client.listTools();
      const toolNames = tools.tools.map(t => t.name);

      expect(toolNames).toContain('guardian_status');
      expect(toolNames).toContain('guardian_preflight_fix');
      expect(toolNames).toContain('guardian_doctor');
      expect(tools.tools.length).toBe(3);

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
    it('guardian_status returns health info', { timeout: 15000 }, async () => {
      const { client, server } = await setupClientServer();

      const result = await client.callTool({ name: 'guardian_status', arguments: {} });

      expect(result.content).toBeDefined();
      expect(Array.isArray(result.content)).toBe(true);
      const textContent = result.content as Array<{ type: string; text: string }>;
      expect(textContent[0].type).toBe('text');
      expect(textContent[0].text).toContain('[guardian]');
      expect(textContent[0].text).toContain('disk=');
      expect(textContent[0].text).toContain('logs=');

      await server.close();
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
      // Should contain before/after banners
      expect(textContent[0].text).toContain('Before:');
      expect(textContent[0].text).toContain('After:');

      await server.close();
    });
  });
});
