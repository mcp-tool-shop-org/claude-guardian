import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Watchdog, formatHealthStatus } from '../src/watchdog.js';
import type { HealthStatus, GuardianConfig } from '../src/types.js';
import { DEFAULT_CONFIG, THRESHOLDS } from '../src/defaults.js';

describe('Watchdog', () => {
  describe('constructor', () => {
    it('initializes with default config', () => {
      const wd = new Watchdog('echo', ['hello']);
      const state = wd.getState();
      expect(state.childPid).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.restartCount).toBe(0);
      expect(state.lastBundlePath).toBeNull();
    });

    it('accepts custom config', () => {
      const config: GuardianConfig = {
        maxProjectLogDirMB: 100,
        hangNoActivitySeconds: 60,
        autoRestart: true,
      };
      const wd = new Watchdog('echo', ['hello'], config);
      // Just verifying it doesn't throw
      expect(wd).toBeDefined();
    });
  });

  describe('start/stop lifecycle', () => {
    it('starts and stops a simple process', async () => {
      const events: Array<{ type: string; detail: string }> = [];
      const wd = new Watchdog(
        process.platform === 'win32' ? 'cmd' : 'sh',
        process.platform === 'win32' ? ['/c', 'echo hello && timeout /t 5 /nobreak >nul'] : ['-c', 'echo hello && sleep 5'],
        DEFAULT_CONFIG,
        (type, detail) => events.push({ type, detail }),
      );

      wd.start();
      const state = wd.getState();
      expect(state.childPid).not.toBeNull();
      expect(state.startTime).not.toBeNull();

      // Wait a moment for the process to start
      await new Promise(r => setTimeout(r, 500));

      // Stop should kill the child
      wd.stop();

      // Should have started event
      expect(events.some(e => e.type === 'started')).toBe(true);
      expect(events.some(e => e.type === 'stopped')).toBe(true);
    });

    it('detects process exit', async () => {
      const events: Array<{ type: string; detail: string }> = [];
      const wd = new Watchdog(
        process.platform === 'win32' ? 'cmd' : 'sh',
        process.platform === 'win32' ? ['/c', 'echo quick'] : ['-c', 'echo quick'],
        { ...DEFAULT_CONFIG, autoRestart: false },
        (type, detail) => events.push({ type, detail }),
      );

      wd.start();

      // Wait for the process to exit
      await new Promise(r => setTimeout(r, 2000));

      // Should have detected the exit
      expect(events.some(e => e.type === 'crash-detected')).toBe(true);

      wd.stop();
    });
  });

  describe('getHealth', () => {
    it('returns health status without running process', async () => {
      const wd = new Watchdog('echo', ['test']);
      const health = await wd.getHealth();

      expect(health.pid).toBeNull();
      expect(health.cpuPercent).toBeNull();
      expect(health.memoryMB).toBeNull();
      expect(health.diskFreeGB).toBeDefined();
      expect(health.claudeLogSizeMB).toBeDefined();
      expect(health.hangDetected).toBe(false);
      expect(health.lastBundlePath).toBeNull();
    });
  });
});

describe('formatHealthStatus', () => {
  it('formats running process status', () => {
    const health: HealthStatus = {
      pid: 12345,
      cpuPercent: 15.5,
      memoryMB: 256.3,
      diskFreeGB: 80.5,
      claudeLogSizeMB: 150,
      lastActivitySecondsAgo: 30,
      hangDetected: false,
      lastBundlePath: null,
      uptime: 3600,
    };

    const output = formatHealthStatus(health);
    expect(output).toContain('PID 12345');
    expect(output).toContain('60m 0s');
    expect(output).toContain('CPU: 15.5%');
    expect(output).toContain('Memory: 256.3MB');
    expect(output).toContain('Disk free: 80.5GB');
    expect(output).toContain('Last activity: 30s ago');
    expect(output).not.toContain('HANG DETECTED');
  });

  it('shows hang detection', () => {
    const health: HealthStatus = {
      pid: 99999,
      cpuPercent: 0,
      memoryMB: 100,
      diskFreeGB: 50,
      claudeLogSizeMB: 200,
      lastActivitySecondsAgo: 600,
      hangDetected: true,
      lastBundlePath: '/tmp/bundle.zip',
      uptime: 1200,
    };

    const output = formatHealthStatus(health);
    expect(output).toContain('HANG DETECTED');
    expect(output).toContain('Last bundle: /tmp/bundle.zip');
  });

  it('handles no running process', () => {
    const health: HealthStatus = {
      pid: null,
      cpuPercent: null,
      memoryMB: null,
      diskFreeGB: 100,
      claudeLogSizeMB: 0,
      lastActivitySecondsAgo: null,
      hangDetected: false,
      lastBundlePath: null,
      uptime: null,
    };

    const output = formatHealthStatus(health);
    expect(output).toContain('not running');
  });
});
