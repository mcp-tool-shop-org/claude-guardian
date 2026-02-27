import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeState, readState, isStateFresh, emptyState, type GuardianState } from '../src/state.js';

describe('state', () => {
  describe('emptyState', () => {
    it('creates a valid default state', () => {
      const state = emptyState();
      expect(state.daemonRunning).toBe(false);
      expect(state.daemonPid).toBeNull();
      expect(state.claudeProcesses).toHaveLength(0);
      expect(state.hangRisk.level).toBe('ok');
      expect(state.recommendedActions).toHaveLength(0);
    });
  });

  describe('writeState / readState round-trip', () => {
    it('persists and reads back state', async () => {
      const state: GuardianState = {
        ...emptyState(),
        daemonRunning: true,
        daemonPid: 12345,
        diskFreeGB: 80.5,
        claudeLogSizeMB: 150,
        claudeProcesses: [
          { pid: 999, name: 'claude', cpuPercent: 25, memoryMB: 512, uptimeSeconds: 3600 },
        ],
        hangRisk: {
          level: 'warn',
          noActivitySeconds: 400,
          cpuHot: false,
          memoryHigh: false,
          diskLow: false,
          reasons: ['No activity for 400s'],
        },
        recommendedActions: ['doctor'],
      };

      await writeState(state);
      const read = await readState();

      expect(read).not.toBeNull();
      expect(read!.daemonRunning).toBe(true);
      expect(read!.daemonPid).toBe(12345);
      expect(read!.claudeProcesses).toHaveLength(1);
      expect(read!.claudeProcesses[0].pid).toBe(999);
      expect(read!.hangRisk.level).toBe('warn');
      expect(read!.recommendedActions).toContain('doctor');
    });
  });

  describe('isStateFresh', () => {
    it('returns true for recent state', () => {
      const state = emptyState();
      state.updatedAt = new Date().toISOString();
      expect(isStateFresh(state, 10)).toBe(true);
    });

    it('returns false for old state', () => {
      const state = emptyState();
      state.updatedAt = new Date(Date.now() - 60000).toISOString(); // 60s ago
      expect(isStateFresh(state, 10)).toBe(false);
    });
  });
});
