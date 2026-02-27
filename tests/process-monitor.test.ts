import { describe, it, expect } from 'vitest';
import {
  findClaudeProcesses,
  checkActivitySignals,
  assessHangRisk,
  recommendActions,
  type ClaudeProcess,
  type ActivitySignals,
  type HangRisk,
} from '../src/process-monitor.js';

describe('process-monitor', () => {
  describe('findClaudeProcesses', () => {
    it('returns an array (may be empty if no Claude running)', async () => {
      const procs = await findClaudeProcesses();
      expect(Array.isArray(procs)).toBe(true);
      for (const p of procs) {
        expect(p).toHaveProperty('pid');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('cpuPercent');
        expect(p).toHaveProperty('memoryMB');
        expect(p).toHaveProperty('uptimeSeconds');
        expect(typeof p.pid).toBe('number');
        expect(typeof p.cpuPercent).toBe('number');
      }
    });
  });

  describe('checkActivitySignals', () => {
    it('returns activity signals with log mtime and cpuActive', async () => {
      const processes: ClaudeProcess[] = [];
      const signals = await checkActivitySignals(processes);
      expect(signals).toHaveProperty('logLastModifiedSecondsAgo');
      expect(signals).toHaveProperty('cpuActive');
      expect(signals).toHaveProperty('sources');
      expect(Array.isArray(signals.sources)).toBe(true);
      expect(typeof signals.cpuActive).toBe('boolean');
    });

    it('reports cpuActive=true when a process has high CPU', async () => {
      const processes: ClaudeProcess[] = [
        { pid: 1, name: 'claude', cpuPercent: 50, memoryMB: 500, uptimeSeconds: 100 },
      ];
      const signals = await checkActivitySignals(processes);
      expect(signals.cpuActive).toBe(true);
      expect(signals.sources).toContain('cpu');
    });

    it('reports cpuActive=false when all processes have low CPU', async () => {
      const processes: ClaudeProcess[] = [
        { pid: 1, name: 'claude', cpuPercent: 1, memoryMB: 500, uptimeSeconds: 100 },
      ];
      const signals = await checkActivitySignals(processes);
      expect(signals.cpuActive).toBe(false);
      expect(signals.sources).not.toContain('cpu');
    });
  });

  describe('assessHangRisk', () => {
    // Helper: default healthy args
    const healthy = (overrides?: Partial<{
      procs: ClaudeProcess[];
      activity: ActivitySignals;
      diskFreeGB: number;
      hangThreshold: number;
      processAge: number;
      compositeQuiet: number;
    }>) => {
      const o = overrides ?? {};
      return assessHangRisk(
        o.procs ?? [{ pid: 1, name: 'claude', cpuPercent: 20, memoryMB: 500, uptimeSeconds: 3600 }],
        o.activity ?? { logLastModifiedSecondsAgo: 5, cpuActive: true, sources: ['log-mtime', 'cpu'] },
        o.diskFreeGB ?? 100,
        o.hangThreshold ?? 300,
        o.processAge ?? 120,     // past grace
        o.compositeQuiet ?? 0,
      );
    };

    it('returns ok when everything is healthy', () => {
      const risk = healthy();
      expect(risk.level).toBe('ok');
      expect(risk.cpuHot).toBe(false);
      expect(risk.memoryHigh).toBe(false);
      expect(risk.diskLow).toBe(false);
      expect(risk.graceRemainingSeconds).toBe(0);
      expect(risk.reasons).toHaveLength(0);
    });

    it('returns ok during grace window even if quiet', () => {
      const risk = healthy({
        activity: { logLastModifiedSecondsAgo: 600, cpuActive: false, sources: [] },
        processAge: 30,         // within 60s grace
        compositeQuiet: 30,
      });
      expect(risk.level).toBe('ok');
      expect(risk.graceRemainingSeconds).toBe(30);
    });

    it('returns warn only when BOTH log quiet AND CPU low exceed threshold', () => {
      // Log quiet but CPU active → ok
      const risk1 = healthy({
        activity: { logLastModifiedSecondsAgo: 600, cpuActive: true, sources: ['cpu'] },
        compositeQuiet: 0,
      });
      expect(risk1.level).toBe('ok');

      // CPU low but log recent → ok
      const risk2 = healthy({
        activity: { logLastModifiedSecondsAgo: 5, cpuActive: false, sources: ['log-mtime'] },
        compositeQuiet: 0,
      });
      expect(risk2.level).toBe('ok');

      // Both quiet, exceeds threshold → warn
      const risk3 = healthy({
        activity: { logLastModifiedSecondsAgo: 600, cpuActive: false, sources: [] },
        compositeQuiet: 400,
      });
      expect(risk3.level).toBe('warn');
      expect(risk3.noActivitySeconds).toBe(400);
    });

    it('escalates to critical after criticalAfterSeconds beyond warn threshold', () => {
      // compositeQuiet > hangThreshold + criticalAfterSeconds (300 + 600 = 900)
      const risk = healthy({
        activity: { logLastModifiedSecondsAgo: 1000, cpuActive: false, sources: [] },
        compositeQuiet: 950,
      });
      expect(risk.level).toBe('critical');
    });

    it('returns warn when disk is low (even during grace)', () => {
      const risk = healthy({
        diskFreeGB: 3,
        processAge: 10, // within grace
      });
      expect(risk.level).toBe('warn');
      expect(risk.diskLow).toBe(true);
    });

    it('returns warn when CPU hot + memory high', () => {
      const risk = healthy({
        procs: [{ pid: 1, name: 'claude', cpuPercent: 98, memoryMB: 5000, uptimeSeconds: 3600 }],
        activity: { logLastModifiedSecondsAgo: 5, cpuActive: true, sources: ['log-mtime', 'cpu'] },
      });
      expect(risk.level).toBe('warn');
      expect(risk.cpuHot).toBe(true);
      expect(risk.memoryHigh).toBe(true);
    });

    it('includes cpuLowSeconds when CPU is low', () => {
      const risk = healthy({
        activity: { logLastModifiedSecondsAgo: 600, cpuActive: false, sources: [] },
        compositeQuiet: 400,
      });
      expect(risk.cpuLowSeconds).toBe(400);
    });
  });

  describe('recommendActions', () => {
    it('returns empty for ok risk', () => {
      const risk: HangRisk = {
        level: 'ok', noActivitySeconds: 0, cpuLowSeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: [],
      };
      expect(recommendActions(risk)).toHaveLength(0);
    });

    it('recommends preflight_fix for low disk', () => {
      const risk: HangRisk = {
        level: 'warn', noActivitySeconds: 0, cpuLowSeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: true,
        graceRemainingSeconds: 0, reasons: ['Disk low'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('preflight_fix');
    });

    it('recommends doctor + restart for critical', () => {
      const risk: HangRisk = {
        level: 'critical', noActivitySeconds: 950, cpuLowSeconds: 950,
        cpuHot: false, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['No activity for 950s'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('doctor');
      expect(actions).toContain('restart_prompt');
    });

    it('recommends reduce_concurrency for CPU/memory warn', () => {
      const risk: HangRisk = {
        level: 'warn', noActivitySeconds: 0, cpuLowSeconds: 0,
        cpuHot: true, memoryHigh: true, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['CPU hot', 'Memory high'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('reduce_concurrency');
    });
  });
});
