import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  scanLogs, fixLogs, formatPreflightReport, formatFixReport, healthBanner,
  cleanStaleSessions,
} from '../src/log-manager.js';
import { dirSize, fileSize, bytesToMB, tailFile, trimFileToLines, gzipFile } from '../src/fs-utils.js';
import type { GuardianConfig, PreflightResult } from '../src/types.js';

// We test against temp dirs to avoid touching real ~/.claude

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'guardian-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ========== fs-utils tests ==========

describe('fs-utils', () => {
  describe('fileSize', () => {
    it('returns size for existing file', async () => {
      const f = join(tempDir, 'test.txt');
      await writeFile(f, 'hello world');
      const size = await fileSize(f);
      expect(size).toBe(11);
    });

    it('returns 0 for non-existent file', async () => {
      const size = await fileSize(join(tempDir, 'nope.txt'));
      expect(size).toBe(0);
    });
  });

  describe('dirSize', () => {
    it('returns total size of directory contents', async () => {
      const sub = join(tempDir, 'sub');
      await mkdir(sub);
      await writeFile(join(tempDir, 'a.txt'), 'aaa');      // 3
      await writeFile(join(sub, 'b.txt'), 'bbbbbb');        // 6
      const size = await dirSize(tempDir);
      expect(size).toBe(9);
    });

    it('returns 0 for non-existent directory', async () => {
      const size = await dirSize(join(tempDir, 'nope'));
      expect(size).toBe(0);
    });
  });

  describe('bytesToMB', () => {
    it('converts bytes to MB', () => {
      expect(bytesToMB(1024 * 1024)).toBe(1);
      expect(bytesToMB(0)).toBe(0);
      expect(bytesToMB(512 * 1024)).toBe(0.5);
    });
  });

  describe('tailFile', () => {
    it('returns last N lines', async () => {
      const f = join(tempDir, 'log.txt');
      await writeFile(f, 'line1\nline2\nline3\nline4\nline5');
      const tail = await tailFile(f, 3);
      expect(tail).toBe('line3\nline4\nline5');
    });

    it('returns all lines if fewer than N', async () => {
      const f = join(tempDir, 'log.txt');
      await writeFile(f, 'only\ntwo');
      const tail = await tailFile(f, 10);
      expect(tail).toBe('only\ntwo');
    });

    it('returns empty string for non-existent file', async () => {
      const tail = await tailFile(join(tempDir, 'nope.txt'), 5);
      expect(tail).toBe('');
    });
  });

  describe('trimFileToLines', () => {
    it('trims file to last N lines', async () => {
      const f = join(tempDir, 'big.log');
      const lines = Array.from({ length: 100 }, (_, i) => `line-${i}`).join('\n');
      await writeFile(f, lines);
      const newSize = await trimFileToLines(f, 10);
      const content = await readFile(f, 'utf-8');
      const resultLines = content.split('\n');
      expect(resultLines.length).toBe(10);
      expect(resultLines[0]).toBe('line-90');
      expect(newSize).toBeGreaterThan(0);
    });

    it('leaves small file unchanged', async () => {
      const f = join(tempDir, 'small.log');
      await writeFile(f, 'one\ntwo\nthree');
      const originalSize = await fileSize(f);
      const newSize = await trimFileToLines(f, 100);
      expect(newSize).toBe(originalSize);
    });
  });

  describe('gzipFile', () => {
    it('compresses file and removes original', async () => {
      const f = join(tempDir, 'data.log');
      // Write enough data to get meaningful compression
      const data = 'x'.repeat(10000) + '\n';
      await writeFile(f, data);
      const originalSize = await fileSize(f);

      const gzPath = await gzipFile(f);

      expect(gzPath).toBe(f + '.gz');
      expect(await fileSize(f)).toBe(0); // original deleted
      const gzSize = await fileSize(gzPath);
      expect(gzSize).toBeGreaterThan(0);
      expect(gzSize).toBeLessThan(originalSize);
    });
  });
});

// ========== log-manager tests (using mocked paths) ==========

// Since scanLogs/fixLogs use getClaudeProjectsPath() which points to real ~/.claude,
// we test the formatting and business logic directly, and do integration-style
// tests with temp dirs for the fs operations.

describe('log-manager formatting', () => {
  describe('formatPreflightReport', () => {
    it('formats a clean report', () => {
      const result: PreflightResult = {
        diskFreeGB: 50.5,
        diskFreeWarning: false,
        claudeProjectsPath: '/home/user/.claude/projects',
        claudeProjectsSizeMB: 45.2,
        entries: [
          { path: '/home/user/.claude/projects/foo', sizeBytes: 30 * 1024 * 1024, sizeMB: 30, isFile: false },
          { path: '/home/user/.claude/projects/bar', sizeBytes: 15 * 1024 * 1024, sizeMB: 15.2, isFile: false },
        ],
        actions: [],
      };

      const report = formatPreflightReport(result);
      expect(report).toContain('Disk free: 50.5GB [OK]');
      expect(report).toContain('Total size: 45.2MB');
      expect(report).toContain('foo: 30MB');
      expect(report).toContain('bar: 15.2MB');
      expect(report).toContain('No issues found.');
    });

    it('formats a warning report', () => {
      const result: PreflightResult = {
        diskFreeGB: 3.2,
        diskFreeWarning: true,
        claudeProjectsPath: '/home/user/.claude/projects',
        claudeProjectsSizeMB: 500,
        entries: [],
        actions: [
          { type: 'warning', target: 'disk', detail: 'Disk free space is 3.2GB (threshold: 5GB)' },
          { type: 'warning', target: '/some/path', detail: 'Project log dir is 350MB (limit: 200MB)' },
        ],
      };

      const report = formatPreflightReport(result);
      expect(report).toContain('Disk free: 3.2GB [WARNING]');
      expect(report).toContain('[WARNING] Disk free space is 3.2GB');
      expect(report).toContain('[WARNING] Project log dir is 350MB');
    });

    it('handles missing claude projects', () => {
      const result: PreflightResult = {
        diskFreeGB: 100,
        diskFreeWarning: false,
        claudeProjectsPath: null,
        claudeProjectsSizeMB: 0,
        entries: [],
        actions: [],
      };

      const report = formatPreflightReport(result);
      expect(report).toContain('not found');
    });
  });

  describe('formatFixReport', () => {
    it('reports no actions needed', () => {
      const report = formatFixReport([]);
      expect(report).toContain('No actions needed');
    });

    it('reports actions with total savings', () => {
      const report = formatFixReport([
        {
          type: 'rotated',
          target: '/a/b.log',
          detail: 'Compressed 50MB → 5MB',
          sizeBefore: 50 * 1024 * 1024,
          sizeAfter: 5 * 1024 * 1024,
        },
        {
          type: 'trimmed',
          target: '/a/c.jsonl',
          detail: 'Trimmed 30MB → 10MB',
          sizeBefore: 30 * 1024 * 1024,
          sizeAfter: 10 * 1024 * 1024,
        },
      ]);
      expect(report).toContain('[ROTATED]');
      expect(report).toContain('[TRIMMED]');
      expect(report).toContain('Total space recovered: 65MB');
    });
  });

  describe('healthBanner', () => {
    it('produces a single-line banner', () => {
      const result: PreflightResult = {
        diskFreeGB: 50,
        diskFreeWarning: false,
        claudeProjectsPath: '/home/.claude/projects',
        claudeProjectsSizeMB: 120,
        entries: [],
        actions: [{ type: 'warning', target: 'x', detail: 'test' }],
      };

      const banner = healthBanner(result);
      expect(banner).toBe('[guardian] disk=50GB | logs=120MB | issues=1');
    });

    it('adds LOW-DISK flag', () => {
      const result: PreflightResult = {
        diskFreeGB: 2.5,
        diskFreeWarning: true,
        claudeProjectsPath: null,
        claudeProjectsSizeMB: 0,
        entries: [],
        actions: [],
      };

      const banner = healthBanner(result);
      expect(banner).toContain('LOW-DISK');
    });
  });
});

// ========== Integration tests with temp file system ==========

describe('log-manager integration (temp fs)', () => {
  it('detects oversized files in a simulated project dir', async () => {
    // Create a simulated project structure
    const projectDir = join(tempDir, 'project-a');
    await mkdir(projectDir, { recursive: true });

    // Create a 30MB-ish file (above 25MB threshold)
    const bigFile = join(projectDir, 'history.jsonl');
    const bigContent = 'x'.repeat(26 * 1024 * 1024);
    await writeFile(bigFile, bigContent);

    // Create a small file
    const smallFile = join(projectDir, 'config.json');
    await writeFile(smallFile, '{"key": "value"}');

    // Verify the big file is detected
    const size = await fileSize(bigFile);
    expect(bytesToMB(size)).toBeGreaterThan(25);

    const smallSize = await fileSize(smallFile);
    expect(bytesToMB(smallSize)).toBeLessThan(1);
  });

  describe('cleanStaleSessions', () => {
    it('removes stale UUID-named jsonl files', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);

      // Create a stale session file (fake old mtime via utimes)
      const staleFile = join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
      await writeFile(staleFile, '{"data":"old session"}');
      const fourDaysAgo = new Date(Date.now() - 4 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(staleFile, fourDaysAgo, fourDaysAgo);

      // Create a fresh session file
      const freshFile = join(projectDir, '11111111-2222-3333-4444-555555555555.jsonl');
      await writeFile(freshFile, '{"data":"active session"}');

      const actions = await cleanStaleSessions(projectDir);

      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('cleaned');
      expect(actions[0].detail).toContain('stale session transcript');

      // Stale file should be gone, fresh file should remain
      const remaining = await readdir(projectDir);
      expect(remaining).toContain('11111111-2222-3333-4444-555555555555.jsonl');
      expect(remaining).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
    });

    it('removes stale UUID-named directories', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);

      const staleDir = join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
      await mkdir(staleDir);
      await writeFile(join(staleDir, 'data.json'), '{}');
      const fourDaysAgo = new Date(Date.now() - 4 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(staleDir, fourDaysAgo, fourDaysAgo);

      const actions = await cleanStaleSessions(projectDir);

      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('cleaned');
      expect(actions[0].detail).toContain('stale session dir');

      const remaining = await readdir(projectDir);
      expect(remaining).not.toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it('never deletes memory/ or sessions-index.json', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);
      await mkdir(join(projectDir, 'memory'));
      await writeFile(join(projectDir, 'memory', 'MEMORY.md'), '# Memory');
      await writeFile(join(projectDir, 'sessions-index.json'), '{}');

      // Make them old
      const oldDate = new Date(Date.now() - 30 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(join(projectDir, 'memory'), oldDate, oldDate);
      await utimes(join(projectDir, 'sessions-index.json'), oldDate, oldDate);

      const actions = await cleanStaleSessions(projectDir);
      expect(actions.length).toBe(0);

      const remaining = await readdir(projectDir);
      expect(remaining).toContain('memory');
      expect(remaining).toContain('sessions-index.json');
    });

    it('ignores non-UUID files', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);

      await writeFile(join(projectDir, 'config.json'), '{}');
      await writeFile(join(projectDir, 'notes.txt'), 'hello');

      const oldDate = new Date(Date.now() - 30 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(join(projectDir, 'config.json'), oldDate, oldDate);
      await utimes(join(projectDir, 'notes.txt'), oldDate, oldDate);

      const actions = await cleanStaleSessions(projectDir);
      expect(actions.length).toBe(0);
    });

    it('removes stale .jsonl.gz files', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);

      const gzFile = join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl.gz');
      await writeFile(gzFile, 'fake compressed data');
      const oldDate = new Date(Date.now() - 5 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(gzFile, oldDate, oldDate);

      const actions = await cleanStaleSessions(projectDir);

      expect(actions.length).toBe(1);
      expect(actions[0].type).toBe('cleaned');
      const remaining = await readdir(projectDir);
      expect(remaining.length).toBe(0);
    });

    it('aggressive mode uses shorter retention', async () => {
      const projectDir = join(tempDir, 'proj');
      await mkdir(projectDir);

      // File that is 2 days old — would survive normal (3d) but not aggressive (1d)
      const file = join(projectDir, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl');
      await writeFile(file, 'data');
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000);
      const { utimes } = await import('fs/promises');
      await utimes(file, twoDaysAgo, twoDaysAgo);

      // Normal mode: should keep it
      const normalActions = await cleanStaleSessions(projectDir, false);
      expect(normalActions.length).toBe(0);

      // Aggressive mode: should delete it
      const aggressiveActions = await cleanStaleSessions(projectDir, true);
      expect(aggressiveActions.length).toBe(1);
    });
  });

  it('trims and compresses files correctly', async () => {
    // Create a big log file
    const logFile = join(tempDir, 'session.log');
    const lines = Array.from({ length: 50000 }, (_, i) => `[${i}] Log entry at ${new Date().toISOString()}`);
    await writeFile(logFile, lines.join('\n'));

    const originalSize = await fileSize(logFile);
    expect(originalSize).toBeGreaterThan(1024 * 1024); // > 1MB

    // Trim to 1000 lines
    await trimFileToLines(logFile, 1000);
    const trimmedContent = await readFile(logFile, 'utf-8');
    const trimmedLines = trimmedContent.split('\n');
    expect(trimmedLines.length).toBe(1000);
    expect(trimmedLines[0]).toContain('[49000]');
  });
});
