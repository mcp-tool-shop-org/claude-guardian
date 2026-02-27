import { describe, it, expect } from 'vitest';
import { writeState, readState, isStateFresh, emptyState, computeAttention, type GuardianState, type Attention } from '../src/state.js';

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
      // Phase 3 fields
      expect(state.attention).toBeDefined();
      expect(state.attention.level).toBe('none');
      expect(state.attention.reason).toBe('All systems healthy');
      expect(state.attention.recommendedActions).toHaveLength(0);
      expect(state.attention.incidentId).toBeNull();
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
        attention: {
          level: 'warn',
          since: '2026-01-01T00:00:00.000Z',
          reason: 'Hang risk is elevated',
          recommendedActions: ['Run guardian_nudge'],
          incidentId: 'abc12345',
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
      // Phase 3 round-trip
      expect(read!.attention).toBeDefined();
      expect(read!.attention.level).toBe('warn');
      expect(read!.attention.reason).toBe('Hang risk is elevated');
      expect(read!.attention.incidentId).toBe('abc12345');
    });
  });

  describe('computeAttention', () => {
    const okRisk = {
      level: 'ok' as const, noActivitySeconds: 0, cpuLowSeconds: 0,
      cpuHot: false, memoryHigh: false, diskLow: false,
      graceRemainingSeconds: 0, reasons: [],
    };
    const warnRisk = {
      ...okRisk, level: 'warn' as const, noActivitySeconds: 350,
      reasons: ['No activity for 350s'],
    };
    const criticalRisk = {
      ...okRisk, level: 'critical' as const, noActivitySeconds: 900,
      reasons: ['No activity for 900s'],
    };
    const diskLowRisk = {
      ...okRisk, level: 'warn' as const, diskLow: true,
      reasons: ['Disk free: 3GB'],
    };

    it('returns none when everything is ok', () => {
      const attn = computeAttention(okRisk, null, null);
      expect(attn.level).toBe('none');
      expect(attn.reason).toBe('All systems healthy');
      expect(attn.recommendedActions).toHaveLength(0);
      expect(attn.incidentId).toBeNull();
    });

    it('returns warn when hang risk is warn', () => {
      const attn = computeAttention(warnRisk, null, null);
      expect(attn.level).toBe('warn');
      expect(attn.reason).toContain('Hang risk is elevated');
      expect(attn.recommendedActions.length).toBeGreaterThan(0);
    });

    it('returns critical when hang risk is critical', () => {
      const attn = computeAttention(criticalRisk, null, null);
      expect(attn.level).toBe('critical');
      expect(attn.reason).toContain('critical');
      expect(attn.recommendedActions).toContain('Run guardian_nudge to capture diagnostics');
    });

    it('returns warn when disk is low', () => {
      const attn = computeAttention(diskLowRisk, null, null);
      expect(attn.level).toBe('warn');
      expect(attn.reason).toContain('Disk space is low');
    });

    it('returns info when budget cap is reduced', () => {
      const budget = {
        currentCap: 2, baseCap: 4, slotsInUse: 0, slotsAvailable: 2,
        activeLeases: 0, capSetByRisk: 'warn' as const,
        okSinceAt: null, hysteresisRemainingSeconds: 30,
      };
      const attn = computeAttention(okRisk, budget, null);
      expect(attn.level).toBe('info');
      expect(attn.reason).toContain('Budget cap reduced');
    });

    it('returns info with incidentId when incident is active and risk is ok', () => {
      const incident = {
        id: 'test123', startedAt: new Date().toISOString(), closedAt: null,
        reason: 'test', peakLevel: 'warn' as const,
        bundleCaptured: false, bundlePath: null,
      };
      const attn = computeAttention(okRisk, null, incident);
      expect(attn.level).toBe('info');
      expect(attn.incidentId).toBe('test123');
    });

    it('preserves since when level unchanged', () => {
      const prev: Attention = {
        level: 'warn',
        since: '2026-01-01T00:00:00.000Z',
        reason: 'old reason',
        recommendedActions: [],
        incidentId: null,
      };
      const attn = computeAttention(warnRisk, null, null, prev);
      expect(attn.level).toBe('warn');
      expect(attn.since).toBe('2026-01-01T00:00:00.000Z');
    });

    it('resets since when level changes', () => {
      const prev: Attention = {
        level: 'none',
        since: '2026-01-01T00:00:00.000Z',
        reason: 'old reason',
        recommendedActions: [],
        incidentId: null,
      };
      const attn = computeAttention(warnRisk, null, null, prev);
      expect(attn.level).toBe('warn');
      expect(attn.since).not.toBe('2026-01-01T00:00:00.000Z');
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
