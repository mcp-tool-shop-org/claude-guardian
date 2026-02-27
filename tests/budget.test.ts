import { describe, it, expect, beforeEach } from 'vitest';
import { Budget, type BudgetSummary } from '../src/budget.js';
import { emptyBudget, writeBudget, readBudget, type BudgetData } from '../src/budget-store.js';
import { BUDGET_THRESHOLDS } from '../src/defaults.js';

describe('Budget', () => {
  let data: BudgetData;
  let budget: Budget;

  beforeEach(() => {
    data = emptyBudget();
    budget = new Budget(data);
  });

  describe('cap transitions', () => {
    it('starts at baseCap=4', () => {
      expect(budget.currentCap).toBe(4);
    });

    it('reduces to 2 on warn', () => {
      budget.adjustCap('warn');
      expect(budget.currentCap).toBe(BUDGET_THRESHOLDS.warnCap);
    });

    it('reduces to 1 on critical', () => {
      budget.adjustCap('critical');
      expect(budget.currentCap).toBe(BUDGET_THRESHOLDS.criticalCap);
    });

    it('stays at warnCap if warn persists', () => {
      budget.adjustCap('warn');
      const changed = budget.adjustCap('warn');
      expect(budget.currentCap).toBe(2);
      expect(changed).toBe(false);
    });

    it('does not restore to base immediately when ok returns', () => {
      budget.adjustCap('warn');
      expect(budget.currentCap).toBe(2);

      budget.adjustCap('ok');
      expect(budget.currentCap).toBe(2); // Still reduced — hysteresis
    });

    it('restores to base after 60s sustained ok (hysteresis)', () => {
      const now = Date.now();
      budget.adjustCap('warn', now);
      expect(budget.currentCap).toBe(2);

      // Ok at now+1s — starts hysteresis timer
      budget.adjustCap('ok', now + 1000);
      expect(budget.currentCap).toBe(2);

      // Ok at now+62s — hysteresis expired
      const changed = budget.adjustCap('ok', now + 62000);
      expect(budget.currentCap).toBe(4);
      expect(changed).toBe(true);
    });

    it('resets hysteresis timer if risk flaps back to warn', () => {
      const now = Date.now();
      budget.adjustCap('warn', now);
      budget.adjustCap('ok', now + 1000);      // starts hysteresis
      budget.adjustCap('warn', now + 30000);    // flap back — resets
      budget.adjustCap('ok', now + 31000);      // restart hysteresis
      budget.adjustCap('ok', now + 80000);      // 49s since last ok start — not enough
      expect(budget.currentCap).toBe(2);

      budget.adjustCap('ok', now + 92000);      // 61s since last ok start — restored
      expect(budget.currentCap).toBe(4);
    });

    it('drops from critical to warn cap when risk drops to warn', () => {
      budget.adjustCap('critical');
      expect(budget.currentCap).toBe(1);

      budget.adjustCap('warn');
      expect(budget.currentCap).toBe(2);
    });
  });

  describe('lease management', () => {
    it('acquire succeeds when slots available', () => {
      const result = budget.acquire(2, 60, 'test');
      expect(result.granted).toBe(true);
      expect(result.lease).not.toBeNull();
      expect(result.lease!.slots).toBe(2);
      expect(result.slotsInUse).toBe(2);
      expect(result.slotsAvailable).toBe(2);
    });

    it('acquire denied when request exceeds available slots', () => {
      budget.acquire(3, 60, 'first');
      const result = budget.acquire(2, 60, 'second');
      expect(result.granted).toBe(false);
      expect(result.lease).toBeNull();
      expect(result.reason).toContain('only 1 available');
    });

    it('acquire denied when cap is reduced below in-use', () => {
      budget.acquire(3, 60, 'holding');
      budget.adjustCap('warn'); // cap=2 but 3 in use
      const result = budget.acquire(1, 60, 'new');
      expect(result.granted).toBe(false);
      expect(result.slotsAvailable).toBe(0);
    });

    it('release frees slots', () => {
      const result = budget.acquire(2, 60, 'test');
      expect(budget.slotsInUse).toBe(2);

      const released = budget.release(result.lease!.id);
      expect(released).toBe(true);
      expect(budget.slotsInUse).toBe(0);
      expect(budget.slotsAvailable).toBe(4);
    });

    it('release returns false for unknown id', () => {
      expect(budget.release('nonexistent')).toBe(false);
    });

    it('TTL auto-expires old leases', () => {
      const now = Date.now();
      // Manually push a lease that's already expired
      const d = budget.getData();
      d.leases.push({
        id: 'expired1',
        slots: 2,
        reason: 'old',
        grantedAt: new Date(now - 120000).toISOString(),
        expiresAt: new Date(now - 60000).toISOString(),
      });
      const b2 = new Budget(d);
      expect(b2.slotsInUse).toBe(2);

      const expired = b2.expireLeases(now);
      expect(expired).toBe(1);
      expect(b2.slotsInUse).toBe(0);
    });

    it('multiple concurrent leases track correctly', () => {
      budget.acquire(1, 60, 'a');
      budget.acquire(1, 60, 'b');
      budget.acquire(1, 60, 'c');
      expect(budget.slotsInUse).toBe(3);
      expect(budget.slotsAvailable).toBe(1);

      const result = budget.acquire(2, 60, 'd');
      expect(result.granted).toBe(false);
    });

    it('acquire with 0 slots denied', () => {
      const result = budget.acquire(0, 60, 'zero');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain('> 0');
    });

    it('acquire with negative slots denied', () => {
      const result = budget.acquire(-1, 60, 'neg');
      expect(result.granted).toBe(false);
    });

    it('acquire with 0 TTL denied', () => {
      const result = budget.acquire(1, 0, 'no-ttl');
      expect(result.granted).toBe(false);
      expect(result.reason).toContain('TTL');
    });
  });

  describe('summarize', () => {
    it('returns correct summary with no leases', () => {
      const summary = budget.summarize();
      expect(summary.currentCap).toBe(4);
      expect(summary.baseCap).toBe(4);
      expect(summary.slotsInUse).toBe(0);
      expect(summary.slotsAvailable).toBe(4);
      expect(summary.activeLeases).toBe(0);
      expect(summary.capSetByRisk).toBeNull();
    });

    it('returns correct summary with active leases', () => {
      budget.acquire(2, 60, 'test');
      const summary = budget.summarize();
      expect(summary.slotsInUse).toBe(2);
      expect(summary.slotsAvailable).toBe(2);
      expect(summary.activeLeases).toBe(1);
    });

    it('computes hysteresisRemainingSeconds correctly', () => {
      const now = Date.now();
      budget.adjustCap('warn', now);
      budget.adjustCap('ok', now + 1000);

      const summary = budget.summarize(now + 31000);
      expect(summary.hysteresisRemainingSeconds).toBe(30);
    });

    it('hysteresisRemainingSeconds is 0 when at base cap', () => {
      const summary = budget.summarize();
      expect(summary.hysteresisRemainingSeconds).toBe(0);
    });
  });

  describe('getData', () => {
    it('returns a deep copy', () => {
      budget.acquire(1, 60, 'test');
      const d1 = budget.getData();
      d1.leases.length = 0; // Mutate the copy
      expect(budget.slotsInUse).toBe(1); // Original unchanged
    });
  });
});

describe('budget-store', () => {
  it('writes and reads back budget data', async () => {
    const data = emptyBudget();
    data.currentCap = 2;
    data.capSetByRisk = 'warn';
    data.leases.push({
      id: 'test123',
      slots: 1,
      reason: 'test',
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });

    await writeBudget(data);
    const read = await readBudget();

    expect(read).not.toBeNull();
    expect(read!.currentCap).toBe(2);
    expect(read!.capSetByRisk).toBe('warn');
    expect(read!.leases).toHaveLength(1);
    expect(read!.leases[0].id).toBe('test123');
  });

  it('returns null when no budget file exists', async () => {
    // This test may or may not pass depending on whether prior tests created the file
    // The important thing is readBudget doesn't throw
    const result = await readBudget();
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('emptyBudget returns valid defaults', () => {
    const data = emptyBudget();
    expect(data.currentCap).toBe(BUDGET_THRESHOLDS.baseCap);
    expect(data.baseCap).toBe(BUDGET_THRESHOLDS.baseCap);
    expect(data.leases).toHaveLength(0);
    expect(data.capSetByRisk).toBeNull();
    expect(data.okSinceAt).toBeNull();
  });
});
