import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'http';
import { probePort } from '../src/port-probe.js';

describe('port-probe', () => {
  const servers: Server[] = [];

  function startServer(handler?: (req: any, res: any) => void): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer(handler ?? ((_, res) => {
        res.writeHead(200);
        res.end('ok');
      }));
      servers.push(server);
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        resolve({ server, port: addr.port });
      });
    });
  }

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;
  });

  it('detects a running server immediately', async () => {
    const { port } = await startServer();
    const result = await probePort({ port, host: '127.0.0.1', timeoutMs: 5000 });
    expect(result.reachable).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.elapsedMs).toBeLessThan(2000);
  });

  it('times out when nothing is listening', async () => {
    // Use a port that's almost certainly not in use
    const result = await probePort({ port: 19999, host: '127.0.0.1', timeoutMs: 1500, intervalMs: 500 });
    expect(result.reachable).toBe(false);
    expect(result.error).toContain('Timeout');
    expect(result.attempts).toBeGreaterThanOrEqual(2);
  });

  it('detects a delayed server startup', async () => {
    // Start the server after 600ms
    let port: number;
    const serverPromise = new Promise<void>((resolve) => {
      setTimeout(async () => {
        const s = await startServer();
        port = s.port;
        resolve();
      }, 600);
    });

    // We need to know the port before the server starts, so use a different approach:
    // Start server immediately on a known port, stop it, wait, restart it
    const { server: tempServer, port: knownPort } = await startServer();
    await new Promise<void>((resolve) => tempServer.close(() => resolve()));
    servers.splice(servers.indexOf(tempServer), 1);

    // Start probing while server is down
    const probePromise = probePort({
      port: knownPort,
      host: '127.0.0.1',
      timeoutMs: 5000,
      intervalMs: 300,
    });

    // Restart after 800ms
    await new Promise<void>((resolve) => setTimeout(resolve, 800));
    const { server: restartedServer } = await new Promise<{ server: Server; port: number }>((resolve) => {
      const server = createServer((_, res) => { res.writeHead(200); res.end('ok'); });
      servers.push(server);
      server.listen(knownPort, '127.0.0.1', () => resolve({ server, port: knownPort }));
    });

    const result = await probePromise;
    expect(result.reachable).toBe(true);
    expect(result.attempts).toBeGreaterThan(1);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(700);
  });

  it('checks HTTP path and succeeds on 200', async () => {
    const { port } = await startServer();
    const result = await probePort({ port, host: '127.0.0.1', httpPath: '/', timeoutMs: 5000 });
    expect(result.reachable).toBe(true);
    expect(result.httpStatus).toBe(200);
  });

  it('reports HTTP non-2xx as not reachable', async () => {
    const { port } = await startServer((_, res) => {
      res.writeHead(500);
      res.end('error');
    });
    const result = await probePort({ port, host: '127.0.0.1', httpPath: '/', timeoutMs: 5000 });
    expect(result.reachable).toBe(false);
    expect(result.httpStatus).toBe(500);
    expect(result.error).toContain('500');
  });

  it('returns structured result with all fields', async () => {
    const { port } = await startServer();
    const result = await probePort({ port, host: '127.0.0.1', timeoutMs: 5000 });
    expect(result).toHaveProperty('reachable');
    expect(result).toHaveProperty('elapsedMs');
    expect(result).toHaveProperty('attempts');
    expect(typeof result.reachable).toBe('boolean');
    expect(typeof result.elapsedMs).toBe('number');
    expect(typeof result.attempts).toBe('number');
  });
});
