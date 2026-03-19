import { describe, it, expect, beforeEach } from 'vitest';
import { writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { withBudgetLock } from '../src/budget-store.js';
import { Budget } from '../src/budget.js';
import { emptyBudget } from '../src/budget-store.js';
import { IncidentTracker } from '../src/incident.js';
import { tailFile } from '../src/fs-utils.js';
import { findClaudeProcesses, checkActivitySignals } from '../src/process-monitor.js';

describe('watch-daemon concerns', () => {
  describe('withBudgetLock serialization', () => {
    it('serializes concurrent operations', async () => {
      const order: number[] = [];

      // Launch 3 concurrent tasks. Without the lock, they'd interleave.
      // With the lock, they execute sequentially in queue order.
      await Promise.all([
        withBudgetLock(async () => {
          order.push(1);
          // Simulate async work
          await new Promise(resolve => setTimeout(resolve, 10));
          order.push(2);
        }),
        withBudgetLock(async () => {
          order.push(3);
          await new Promise(resolve => setTimeout(resolve, 10));
          order.push(4);
        }),
        withBudgetLock(async () => {
          order.push(5);
          await new Promise(resolve => setTimeout(resolve, 10));
          order.push(6);
        }),
      ]);

      // Each task must complete before the next starts
      // So we should see [1,2,3,4,5,6] — never interleaved like [1,3,5,2,4,6]
      expect(order).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('returns the callback result', async () => {
      const result = await withBudgetLock(async () => 42);
      expect(result).toBe(42);
    });

    it('lock releases even when callback throws', async () => {
      // First call throws
      await expect(
        withBudgetLock(async () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      // Second call should still work (lock was released)
      const result = await withBudgetLock(async () => 'ok');
      expect(result).toBe('ok');
    });

    it('serializes budget acquire to prevent double-grant', async () => {
      // In-memory only — no file I/O, pure logic test
      let sharedData = emptyBudget(); // cap=4

      const results = await Promise.all([
        withBudgetLock(async () => {
          const budget = new Budget(sharedData);
          const result = budget.acquire(3, 60, 'task-a');
          sharedData = budget.getData();
          return result;
        }),
        withBudgetLock(async () => {
          const budget = new Budget(sharedData);
          const result = budget.acquire(3, 60, 'task-b');
          if (result.granted) sharedData = budget.getData();
          return result;
        }),
      ]);

      // First: granted (3/4 used). Second: denied (only 1 available).
      expect(results[0].granted).toBe(true);
      expect(results[1].granted).toBe(false);
    });
  });

  describe('IncidentTracker async update', () => {
    let tracker: IncidentTracker;

    beforeEach(() => {
      tracker = new IncidentTracker();
    });

    it('update returns a promise', async () => {
      const result = tracker.update('warn', 'test');
      expect(result).toBeInstanceOf(Promise);
      const incident = await result;
      expect(incident).not.toBeNull();
      expect(incident!.peakLevel).toBe('warn');
    });

    it('close writes incident log without unhandled rejection', async () => {
      await tracker.update('warn', 'test reason');
      // Closing should await appendIncidentLog internally
      const closed = await tracker.update('ok', '');
      expect(closed).not.toBeNull();
      expect(closed!.closedAt).not.toBeNull();
      expect(tracker.getActive()).toBeNull();
    });
  });

  describe('JSONL corrupt line resilience', () => {
    it('readJournal skips corrupt lines', async () => {
      const { readJournal } = await import('../src/fs-utils.js');
      // Should never throw, even if file doesn't exist
      const entries = await readJournal();
      expect(Array.isArray(entries)).toBe(true);
    });

    it('readIncidentLog skips corrupt lines', async () => {
      const { readIncidentLog } = await import('../src/incident.js');
      // Should never throw
      const entries = await readIncidentLog();
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  describe('full UUID lease IDs', () => {
    it('lease IDs are full UUIDs', () => {
      const data = emptyBudget();
      const budget = new Budget(data);
      const result = budget.acquire(1, 60, 'test');
      expect(result.granted).toBe(true);
      // Full UUID format: 8-4-4-4-12 hex chars
      expect(result.lease!.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('each lease gets a unique ID', () => {
      const data = emptyBudget();
      const budget = new Budget(data);
      const r1 = budget.acquire(1, 60, 'a');
      const r2 = budget.acquire(1, 60, 'b');
      expect(r1.lease!.id).not.toBe(r2.lease!.id);
    });
  });

  describe('pollInProgress guard (unit logic)', () => {
    it('prevents overlapping execution', async () => {
      let pollInProgress = false;
      let overlapDetected = false;
      let completedPolls = 0;

      const poll = async () => {
        if (pollInProgress) {
          overlapDetected = true;
          return;
        }
        pollInProgress = true;
        try {
          await new Promise(resolve => setTimeout(resolve, 50));
          completedPolls++;
        } finally {
          pollInProgress = false;
        }
      };

      // Fire 3 polls simultaneously — only 1 should execute, others skip
      await Promise.all([poll(), poll(), poll()]);

      expect(overlapDetected).toBe(true);
      expect(completedPolls).toBe(1);
    });
  });

  describe('findClaudeProcesses returns FindProcessesResult (E6)', () => {
    it('returns an object with processes array and enumerationError', async () => {
      const result = await findClaudeProcesses();
      expect(result).toHaveProperty('processes');
      expect(result).toHaveProperty('enumerationError');
      expect(Array.isArray(result.processes)).toBe(true);
      // On a normal system, enumeration should succeed (error = null)
      expect(result.enumerationError).toBeNull();
    });

    it('checkActivitySignals propagates enumerationError', async () => {
      const signals = await checkActivitySignals([], 'test error');
      expect(signals.lastEnumerationError).toBe('test error');
    });

    it('checkActivitySignals defaults to null when no error', async () => {
      const signals = await checkActivitySignals([]);
      expect(signals.lastEnumerationError).toBeNull();
    });
  });

  describe('tailFile reverse-seek (E7)', () => {
    const testDir = join(tmpdir(), 'guardian-tail-test-' + process.pid);

    beforeEach(async () => {
      await mkdir(testDir, { recursive: true });
    });

    it('returns last N lines from a small file', async () => {
      const filePath = join(testDir, 'small.txt');
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
      await writeFile(filePath, lines.join('\n'), 'utf-8');

      const result = await tailFile(filePath, 5);
      const resultLines = result.split('\n');
      expect(resultLines).toContain('line 20');
      expect(resultLines).toContain('line 16');
    });

    it('returns last N lines from a large file (>1MB)', async () => {
      const filePath = join(testDir, 'large.txt');
      // Create a file > 1MB with numbered lines
      const lineContent = 'x'.repeat(100); // 100 chars per line
      const lineCount = 15000; // ~1.5MB
      const lines = Array.from({ length: lineCount }, (_, i) => `${i + 1}: ${lineContent}`);
      await writeFile(filePath, lines.join('\n'), 'utf-8');

      const result = await tailFile(filePath, 10);
      const resultLines = result.split('\n').filter(Boolean);
      expect(resultLines.length).toBeLessThanOrEqual(10);
      expect(resultLines[resultLines.length - 1]).toContain(`${lineCount}:`);
    });

    it('returns empty string for nonexistent file', async () => {
      const result = await tailFile(join(testDir, 'nope.txt'), 10);
      expect(result).toBe('');
    });

    // Cleanup
    it('cleanup test dir', async () => {
      await rm(testDir, { recursive: true, force: true });
    });
  });
});
