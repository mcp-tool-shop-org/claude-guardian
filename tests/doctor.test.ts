import { describe, it, expect } from 'vitest';
import { collectSystemInfo, formatDoctorReport } from '../src/doctor.js';
import type { DoctorSummary } from '../src/doctor.js';
import type { PreflightResult } from '../src/types.js';

describe('doctor', () => {
  describe('collectSystemInfo', () => {
    it('returns valid system information', () => {
      const info = collectSystemInfo(50.5);
      expect(info.platform).toBeTruthy();
      expect(info.release).toBeTruthy();
      expect(info.arch).toBeTruthy();
      expect(info.totalMemoryGB).toBeGreaterThan(0);
      expect(info.freeMemoryGB).toBeGreaterThan(0);
      expect(info.cpuCores).toBeGreaterThan(0);
      expect(info.diskFreeGB).toBe(50.5);
      expect(info.nodeVersion).toMatch(/^v\d+/);
    });
  });

  describe('formatDoctorReport', () => {
    it('formats a complete report', () => {
      const preflightResult: PreflightResult = {
        diskFreeGB: 80,
        diskFreeWarning: false,
        claudeProjectsPath: '/home/user/.claude/projects',
        claudeProjectsSizeMB: 150,
        entries: [],
        actions: [
          { type: 'warning', target: '/a/b', detail: 'Big dir' },
        ],
      };

      const summary: DoctorSummary = {
        timestamp: '2026-02-27T00:00:00.000Z',
        system: {
          platform: 'win32',
          release: '10.0.26300',
          arch: 'x64',
          totalMemoryGB: 32,
          freeMemoryGB: 16,
          cpuModel: 'Test CPU',
          cpuCores: 8,
          diskFreeGB: 80,
          nodeVersion: 'v22.0.0',
        },
        claudeProjects: preflightResult,
        biggestFiles: [
          { path: '/home/.claude/projects/foo/history.jsonl', sizeMB: 45 },
          { path: '/home/.claude/projects/bar/data.json', sizeMB: 12 },
        ],
        journalEntries: 25,
        recentJournal: [
          { timestamp: '2026-02-26T10:00:00Z', action: 'trimmed', detail: 'Trimmed 50MB → 10MB' },
          { timestamp: '2026-02-27T08:00:00Z', action: 'rotated', detail: 'Compressed 30MB → 3MB' },
        ],
      };

      const report = formatDoctorReport(summary);

      expect(report).toContain('Claude Guardian Doctor Report');
      expect(report).toContain('Platform: win32');
      expect(report).toContain('Memory: 16GB free / 32GB total');
      expect(report).toContain('Test CPU (8 cores)');
      expect(report).toContain('Total size: 150MB');
      expect(report).toContain('Issues: 1');
      expect(report).toContain('history.jsonl: 45MB');
      expect(report).toContain('25 entries');
      expect(report).toContain('trimmed');
      expect(report).toContain('rotated');
    });

    it('handles empty state gracefully', () => {
      const summary: DoctorSummary = {
        timestamp: '2026-02-27T00:00:00.000Z',
        system: collectSystemInfo(100),
        claudeProjects: {
          diskFreeGB: 100,
          diskFreeWarning: false,
          claudeProjectsPath: null,
          claudeProjectsSizeMB: 0,
          entries: [],
          actions: [],
        },
        biggestFiles: [],
        journalEntries: 0,
        recentJournal: [],
      };

      const report = formatDoctorReport(summary);
      expect(report).toContain('Total size: 0MB');
      expect(report).toContain('Issues: 0');
      expect(report).toContain('0 entries');
    });
  });
});
