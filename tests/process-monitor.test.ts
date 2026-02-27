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
      // Each entry should have the right shape
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
    it('returns activity signals with log mtime', async () => {
      const signals = await checkActivitySignals();
      expect(signals).toHaveProperty('logLastModifiedSecondsAgo');
      expect(signals).toHaveProperty('sources');
      expect(Array.isArray(signals.sources)).toBe(true);
    });
  });

  describe('assessHangRisk', () => {
    it('returns ok when everything is healthy', () => {
      const procs: ClaudeProcess[] = [
        { pid: 1, name: 'claude', cpuPercent: 20, memoryMB: 500, uptimeSeconds: 3600 },
      ];
      const activity: ActivitySignals = { logLastModifiedSecondsAgo: 5, sources: ['claude-projects-dir'] };

      const risk = assessHangRisk(procs, activity, 100, 300);
      expect(risk.level).toBe('ok');
      expect(risk.cpuHot).toBe(false);
      expect(risk.memoryHigh).toBe(false);
      expect(risk.diskLow).toBe(false);
      expect(risk.reasons).toHaveLength(0);
    });

    it('returns warn when no activity exceeds threshold', () => {
      const procs: ClaudeProcess[] = [];
      const activity: ActivitySignals = { logLastModifiedSecondsAgo: 600, sources: [] };

      const risk = assessHangRisk(procs, activity, 50, 300);
      expect(risk.level).toBe('warn');
      expect(risk.noActivitySeconds).toBe(600);
      expect(risk.reasons.length).toBeGreaterThan(0);
    });

    it('returns critical when CPU hot + no activity', () => {
      const procs: ClaudeProcess[] = [
        { pid: 1, name: 'claude', cpuPercent: 98, memoryMB: 500, uptimeSeconds: 3600 },
      ];
      const activity: ActivitySignals = { logLastModifiedSecondsAgo: 600, sources: [] };

      const risk = assessHangRisk(procs, activity, 50, 300);
      expect(risk.level).toBe('critical');
      expect(risk.cpuHot).toBe(true);
      expect(risk.reasons.length).toBeGreaterThanOrEqual(2);
    });

    it('returns warn when disk is low', () => {
      const procs: ClaudeProcess[] = [];
      const activity: ActivitySignals = { logLastModifiedSecondsAgo: 5, sources: [] };

      const risk = assessHangRisk(procs, activity, 3, 300);
      expect(risk.level).toBe('warn');
      expect(risk.diskLow).toBe(true);
    });

    it('returns warn when CPU hot + memory high', () => {
      const procs: ClaudeProcess[] = [
        { pid: 1, name: 'claude', cpuPercent: 98, memoryMB: 5000, uptimeSeconds: 3600 },
      ];
      const activity: ActivitySignals = { logLastModifiedSecondsAgo: 5, sources: [] };

      const risk = assessHangRisk(procs, activity, 50, 300);
      expect(risk.level).toBe('warn');
      expect(risk.cpuHot).toBe(true);
      expect(risk.memoryHigh).toBe(true);
    });
  });

  describe('recommendActions', () => {
    it('returns empty for ok risk', () => {
      const risk: HangRisk = {
        level: 'ok', noActivitySeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: false, reasons: [],
      };
      expect(recommendActions(risk)).toHaveLength(0);
    });

    it('recommends preflight_fix for low disk', () => {
      const risk: HangRisk = {
        level: 'warn', noActivitySeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: true,
        reasons: ['Disk low'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('preflight_fix');
    });

    it('recommends doctor + restart for critical', () => {
      const risk: HangRisk = {
        level: 'critical', noActivitySeconds: 600,
        cpuHot: true, memoryHigh: false, diskLow: false,
        reasons: ['CPU hot', 'No activity'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('doctor');
      expect(actions).toContain('restart_prompt');
    });

    it('recommends reduce_concurrency for CPU/memory warn', () => {
      const risk: HangRisk = {
        level: 'warn', noActivitySeconds: 0,
        cpuHot: true, memoryHigh: true, diskLow: false,
        reasons: ['CPU hot', 'Memory high'],
      };
      const actions = recommendActions(risk);
      expect(actions).toContain('reduce_concurrency');
    });
  });
});
