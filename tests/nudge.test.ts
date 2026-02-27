import { describe, it, expect } from 'vitest';
import { createMcpServer } from '../src/mcp-server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

describe('guardian_nudge', () => {
  async function setupClientServer() {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, server };
  }

  it('is registered as the 4th tool', async () => {
    const { client, server } = await setupClientServer();
    const tools = await client.listTools();
    const names = tools.tools.map(t => t.name);
    expect(names).toContain('guardian_nudge');
    expect(tools.tools.length).toBe(4);
    await server.close();
  });

  it('has correct metadata', async () => {
    const { client, server } = await setupClientServer();
    const tools = await client.listTools();
    const nudge = tools.tools.find(t => t.name === 'guardian_nudge');
    expect(nudge).toBeDefined();
    expect(nudge!.description).toContain('safe things');
    await server.close();
  });

  it('executes without error and returns meaningful response', { timeout: 15000 }, async () => {
    const { client, server } = await setupClientServer();
    const result = await client.callTool({ name: 'guardian_nudge', arguments: {} });
    expect(result.content).toBeDefined();
    const textContent = result.content as Array<{ type: string; text: string }>;
    expect(textContent[0].type).toBe('text');
    // Nudge returns either "All clear" (no-op) or "actions taken" (did something)
    const text = textContent[0].text;
    const isNoOp = text.includes('All clear');
    const isAction = text.includes('actions taken');
    expect(isNoOp || isAction).toBe(true);
    await server.close();
  });

  it('returns text content with length > 0', { timeout: 15000 }, async () => {
    const { client, server } = await setupClientServer();
    const result = await client.callTool({ name: 'guardian_nudge', arguments: {} });
    const textContent = result.content as Array<{ type: string; text: string }>;
    expect(textContent[0].type).toBe('text');
    expect(typeof textContent[0].text).toBe('string');
    expect(textContent[0].text.length).toBeGreaterThan(0);
    await server.close();
  });
});
