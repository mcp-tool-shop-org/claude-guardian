import { randomUUID } from 'crypto';
import { BUDGET_THRESHOLDS } from './defaults.js';
import type { RiskLevel } from './process-monitor.js';
import type { BudgetData, BudgetLease } from './budget-store.js';

/** Result of an acquire attempt. */
export interface AcquireResult {
  granted: boolean;
  lease: BudgetLease | null;
  reason: string;
  currentCap: number;
  slotsInUse: number;
  slotsAvailable: number;
}

/** Summary for display in status/banner. */
export interface BudgetSummary {
  currentCap: number;
  baseCap: number;
  slotsInUse: number;
  slotsAvailable: number;
  activeLeases: number;
  capSetByRisk: RiskLevel | null;
  okSinceAt: string | null;
  hysteresisRemainingSeconds: number;
}

/** Budget controller — manages cap transitions, leases, TTL expiry. */
export class Budget {
  private data: BudgetData;

  constructor(data: BudgetData) {
    // Deep copy to avoid external mutation
    this.data = JSON.parse(JSON.stringify(data));
  }

  /** Current effective cap. */
  get currentCap(): number {
    return this.data.currentCap;
  }

  /** Slots currently held by active leases. */
  get slotsInUse(): number {
    return this.data.leases.reduce((sum, l) => sum + l.slots, 0);
  }

  /** Slots available for new leases. */
  get slotsAvailable(): number {
    return Math.max(0, this.data.currentCap - this.slotsInUse);
  }

  /**
   * Adjust cap based on current risk level. Returns true if cap changed.
   *
   * Rules:
   *   - ok: restore to baseCap after hysteresisSeconds sustained ok
   *   - warn: cap = warnCap (2)
   *   - critical: cap = criticalCap (1)
   */
  adjustCap(riskLevel: RiskLevel, now: number = Date.now()): boolean {
    const oldCap = this.data.currentCap;

    if (riskLevel === 'critical') {
      this.data.currentCap = BUDGET_THRESHOLDS.criticalCap;
      this.data.okSinceAt = null;
      this.data.capSetByRisk = 'critical';
    } else if (riskLevel === 'warn') {
      this.data.currentCap = BUDGET_THRESHOLDS.warnCap;
      this.data.okSinceAt = null;
      this.data.capSetByRisk = 'warn';
    } else {
      // ok — start or continue hysteresis timer
      if (this.data.okSinceAt === null) {
        this.data.okSinceAt = new Date(now).toISOString();
      }

      const okDuration = (now - new Date(this.data.okSinceAt).getTime()) / 1000;
      if (okDuration >= BUDGET_THRESHOLDS.hysteresisSeconds) {
        this.data.currentCap = this.data.baseCap;
        this.data.capSetByRisk = null;
      }
      // Otherwise cap stays where it is until hysteresis expires
    }

    if (this.data.currentCap !== oldCap) {
      this.data.capChangedAt = new Date(now).toISOString();
      return true;
    }
    return false;
  }

  /** Acquire N slots with a TTL. */
  acquire(n: number, ttlSeconds: number, reason: string): AcquireResult {
    const base = {
      currentCap: this.data.currentCap,
      slotsInUse: this.slotsInUse,
      slotsAvailable: this.slotsAvailable,
    };

    if (n <= 0) {
      return { granted: false, lease: null, reason: 'Slots must be > 0', ...base };
    }

    if (ttlSeconds <= 0) {
      return { granted: false, lease: null, reason: 'TTL must be > 0', ...base };
    }

    if (n > this.slotsAvailable) {
      return {
        granted: false,
        lease: null,
        reason: `Requested ${n} slots but only ${this.slotsAvailable} available (cap=${this.data.currentCap}, in-use=${this.slotsInUse})`,
        ...base,
      };
    }

    const now = new Date();
    const lease: BudgetLease = {
      id: randomUUID().slice(0, 8),
      slots: n,
      reason,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    };

    this.data.leases.push(lease);

    return {
      granted: true,
      lease: { ...lease },
      reason: 'Granted',
      currentCap: this.data.currentCap,
      slotsInUse: this.slotsInUse,
      slotsAvailable: this.slotsAvailable,
    };
  }

  /** Release a lease by ID. Returns true if found and released. */
  release(id: string): boolean {
    const idx = this.data.leases.findIndex(l => l.id === id);
    if (idx === -1) return false;
    this.data.leases.splice(idx, 1);
    return true;
  }

  /** Expire any leases past their TTL. Returns count of expired leases. */
  expireLeases(now: number = Date.now()): number {
    const before = this.data.leases.length;
    this.data.leases = this.data.leases.filter(l => new Date(l.expiresAt).getTime() > now);
    return before - this.data.leases.length;
  }

  /** Summary for display. */
  summarize(now: number = Date.now()): BudgetSummary {
    let hysteresisRemaining = 0;
    if (this.data.okSinceAt && this.data.currentCap < this.data.baseCap) {
      const okDuration = (now - new Date(this.data.okSinceAt).getTime()) / 1000;
      hysteresisRemaining = Math.max(0, Math.round(BUDGET_THRESHOLDS.hysteresisSeconds - okDuration));
    }

    return {
      currentCap: this.data.currentCap,
      baseCap: this.data.baseCap,
      slotsInUse: this.slotsInUse,
      slotsAvailable: this.slotsAvailable,
      activeLeases: this.data.leases.length,
      capSetByRisk: this.data.capSetByRisk,
      okSinceAt: this.data.okSinceAt,
      hysteresisRemainingSeconds: hysteresisRemaining,
    };
  }

  /** Get the raw data for persistence. */
  getData(): BudgetData {
    return JSON.parse(JSON.stringify(this.data));
  }
}
