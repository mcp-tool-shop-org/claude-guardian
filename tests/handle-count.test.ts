import { describe, it, expect } from 'vitest';
import { getHandleCount, getHandleCounts, type HandleCountResult } from '../src/handle-count.js';

describe('handle-count', () => {
  it('returns a result for the current process PID', async () => {
    const result = await getHandleCount(process.pid);
    expect(result.pid).toBe(process.pid);
    // On Windows this should succeed; on other platforms it depends
    if (result.count !== null) {
      expect(typeof result.count).toBe('number');
      expect(result.count).toBeGreaterThan(0);
      expect(result.error).toBeNull();
    } else {
      expect(typeof result.error).toBe('string');
    }
  });

  it('returns null count for non-existent PID', async () => {
    const result = await getHandleCount(999999);
    expect(result.pid).toBe(999999);
    expect(result.count).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it('never throws even on invalid PID', async () => {
    // Negative PID — should return null, not throw
    const result = await getHandleCount(-1);
    expect(result.pid).toBe(-1);
    expect(result.count).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it('handles multiple PIDs in parallel', async () => {
    const results = await getHandleCounts([process.pid, 999999]);
    expect(results).toHaveLength(2);
    expect(results[0].pid).toBe(process.pid);
    expect(results[1].pid).toBe(999999);
    expect(results[1].count).toBeNull();
  });

  it('result has correct pid field', async () => {
    const result = await getHandleCount(12345);
    expect(result.pid).toBe(12345);
  });

  it('returns empty array for no PIDs', async () => {
    const results = await getHandleCounts([]);
    expect(results).toHaveLength(0);
  });
});
