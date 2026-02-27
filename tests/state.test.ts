import { describe, it, expect } from 'vitest';
import { writeState, readState, isStateFresh, emptyState, type GuardianState } from '../src/state.js';

describe('state', () => {
  describe('emptyState', () => {
    it('creates a valid default state with all fields', () => {
      const state = emptyState();
      expect(state.daemonRunning).toBe(false);
      expect(state.daemonPid).toBeNull();
      expect(state.claudeProcesses).toHaveLength(0);
      expect(state.hangRisk.level).toBe('ok');
      expect(state.recommendedActions).toHaveLength(0);
      // Phase 1 fields
      expect(state.activeIncident).toBeNull();
      expect(state.processAgeSeconds).toBe(0);
      expect(state.compositeQuietSeconds).toBe(0);
      expect(state.activity.cpuActive).toBe(false);
      expect(state.hangRisk.cpuLowSeconds).toBe(0);
      expect(state.hangRisk.graceRemainingSeconds).toBe(0);
      // Phase 2 fields
      expect(state.budgetSummary).toBeNull();
    });
  });

  describe('writeState / readState round-trip', () => {
    it('persists and reads back state with all fields', async () => {
      const state: GuardianState = {
        ...emptyState(),
        daemonRunning: true,
        daemonPid: 12345,
        diskFreeGB: 80.5,
        claudeLogSizeMB: 150,
        claudeProcesses: [
          { pid: 999, name: 'claude', cpuPercent: 25, memoryMB: 512, uptimeSeconds: 3600 },
        ],
        activity: {
          logLastModifiedSecondsAgo: 5,
          cpuActive: true,
          sources: ['log-mtime', 'cpu'],
        },
        hangRisk: {
          level: 'warn',
          noActivitySeconds: 400,
          cpuLowSeconds: 0,
          cpuHot: false,
          memoryHigh: false,
          diskLow: false,
          graceRemainingSeconds: 0,
          reasons: ['No activity for 400s'],
        },
        recommendedActions: ['doctor'],
        activeIncident: {
          id: 'abc12345',
          startedAt: '2026-01-01T00:00:00.000Z',
          closedAt: null,
          reason: 'No activity for 400s',
          peakLevel: 'warn',
          bundleCaptured: false,
          bundlePath: null,
        },
        processAgeSeconds: 120,
        compositeQuietSeconds: 400,
        budgetSummary: {
          currentCap: 2,
          baseCap: 4,
          slotsInUse: 1,
          slotsAvailable: 1,
          activeLeases: 1,
          capSetByRisk: 'warn',
          okSinceAt: null,
          hysteresisRemainingSeconds: 0,
        },
      };

      await writeState(state);
      const read = await readState();

      expect(read).not.toBeNull();
      expect(read!.daemonRunning).toBe(true);
      expect(read!.daemonPid).toBe(12345);
      expect(read!.claudeProcesses).toHaveLength(1);
      expect(read!.hangRisk.level).toBe('warn');
      expect(read!.recommendedActions).toContain('doctor');
      // Phase 1 round-trip
      expect(read!.activeIncident).not.toBeNull();
      expect(read!.activeIncident!.id).toBe('abc12345');
      expect(read!.activeIncident!.peakLevel).toBe('warn');
      expect(read!.processAgeSeconds).toBe(120);
      expect(read!.compositeQuietSeconds).toBe(400);
      expect(read!.activity.cpuActive).toBe(true);
      expect(read!.hangRisk.cpuLowSeconds).toBe(0);
      expect(read!.hangRisk.graceRemainingSeconds).toBe(0);
      // Phase 2 round-trip
      expect(read!.budgetSummary).not.toBeNull();
      expect(read!.budgetSummary!.currentCap).toBe(2);
      expect(read!.budgetSummary!.capSetByRisk).toBe('warn');
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
      state.updatedAt = new Date(Date.now() - 60000).toISOString();
      expect(isStateFresh(state, 10)).toBe(false);
    });
  });
});
