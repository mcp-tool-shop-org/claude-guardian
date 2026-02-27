import { readFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getGuardianDataPath, THRESHOLDS } from './defaults.js';
import type { RiskLevel } from './process-monitor.js';

/** An active or closed incident. */
export interface Incident {
  id: string;
  startedAt: string;
  closedAt: string | null;
  reason: string;
  peakLevel: RiskLevel;
  bundleCaptured: boolean;
  bundlePath: string | null;
}

/** Mutable incident tracker — one per daemon. */
export class IncidentTracker {
  private active: Incident | null = null;
  /** Per-PID bundle timestamps for rate limiting. */
  private lastBundleAtByPid: Map<number, number> = new Map();

  /** Get the current active incident (or null). */
  getActive(): Incident | null {
    return this.active ? { ...this.active } : null;
  }

  /**
   * Update the tracker with the current risk level.
   * Returns the incident if one is active (may be newly opened or existing).
   */
  update(level: RiskLevel, reason: string): Incident | null {
    if (level === 'ok') {
      // Close any active incident
      if (this.active) {
        this.active.closedAt = new Date().toISOString();
        const closed = { ...this.active };
        this.active = null;
        appendIncidentLog(closed);
        return closed;
      }
      return null;
    }

    if (level === 'warn' || level === 'critical') {
      if (!this.active) {
        // Open new incident
        this.active = {
          id: randomUUID().slice(0, 8),
          startedAt: new Date().toISOString(),
          closedAt: null,
          reason,
          peakLevel: level,
          bundleCaptured: false,
          bundlePath: null,
        };
      } else {
        // Escalate existing
        if (level === 'critical' && this.active.peakLevel !== 'critical') {
          this.active.peakLevel = 'critical';
        }
        // Update reason to latest
        this.active.reason = reason;
      }
      return { ...this.active };
    }

    return this.active ? { ...this.active } : null;
  }

  /**
   * Check if we should capture a bundle for the current incident.
   * Returns true only once per incident, with per-PID rate limiting.
   */
  shouldCaptureBundle(pids: number[]): boolean {
    if (!this.active) return false;
    if (this.active.peakLevel !== 'critical') return false;
    if (this.active.bundleCaptured) return false;

    // Per-PID rate limit
    const now = Date.now();
    const cooldown = THRESHOLDS.bundleCooldownSeconds * 1000;
    for (const pid of pids) {
      const last = this.lastBundleAtByPid.get(pid) ?? 0;
      if (now - last < cooldown) {
        return false; // Still in cooldown for this PID
      }
    }

    return true;
  }

  /** Mark the current incident's bundle as captured. */
  markBundleCaptured(bundlePath: string, pids: number[]): void {
    if (this.active) {
      this.active.bundleCaptured = true;
      this.active.bundlePath = bundlePath;
    }
    const now = Date.now();
    for (const pid of pids) {
      this.lastBundleAtByPid.set(pid, now);
    }
  }
}

/** Append an incident record to incidents.jsonl. */
async function appendIncidentLog(incident: Incident): Promise<void> {
  const dataDir = getGuardianDataPath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  const logPath = join(dataDir, 'incidents.jsonl');
  const line = JSON.stringify(incident) + '\n';
  await appendFile(logPath, line, 'utf-8');
}

/** Read incident history. */
export async function readIncidentLog(lastN?: number): Promise<Incident[]> {
  const logPath = join(getGuardianDataPath(), 'incidents.jsonl');
  try {
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(l => JSON.parse(l) as Incident);
    if (lastN) return entries.slice(-lastN);
    return entries;
  } catch {
    return [];
  }
}
