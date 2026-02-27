import { describe, it, expect, beforeEach } from 'vitest';
import { IncidentTracker } from '../src/incident.js';

describe('IncidentTracker', () => {
  let tracker: IncidentTracker;

  beforeEach(() => {
    tracker = new IncidentTracker();
  });

  describe('lifecycle: open → escalate → close', () => {
    it('starts with no active incident', () => {
      expect(tracker.getActive()).toBeNull();
    });

    it('opens an incident on warn', () => {
      const incident = tracker.update('warn', 'No activity for 400s');
      expect(incident).not.toBeNull();
      expect(incident!.peakLevel).toBe('warn');
      expect(incident!.closedAt).toBeNull();
      expect(incident!.bundleCaptured).toBe(false);
    });

    it('escalates to critical on existing incident', () => {
      tracker.update('warn', 'No activity for 400s');
      const escalated = tracker.update('critical', 'No activity for 950s');
      expect(escalated).not.toBeNull();
      expect(escalated!.peakLevel).toBe('critical');
      // Same incident — id should match
      const active = tracker.getActive();
      expect(active).not.toBeNull();
      expect(active!.id).toBe(escalated!.id);
    });

    it('closes incident when risk returns to ok', () => {
      tracker.update('warn', 'No activity for 400s');
      const active = tracker.getActive();
      expect(active).not.toBeNull();

      const closed = tracker.update('ok', '');
      expect(closed).not.toBeNull();
      expect(closed!.closedAt).not.toBeNull();

      // Now no active incident
      expect(tracker.getActive()).toBeNull();
    });

    it('returns null for ok when no incident exists', () => {
      const result = tracker.update('ok', '');
      expect(result).toBeNull();
    });

    it('updates reason on existing incident', () => {
      tracker.update('warn', 'initial reason');
      tracker.update('warn', 'updated reason');
      const active = tracker.getActive();
      expect(active!.reason).toBe('updated reason');
    });
  });

  describe('bundle deduplication', () => {
    it('shouldCaptureBundle returns false with no active incident', () => {
      expect(tracker.shouldCaptureBundle([1000])).toBe(false);
    });

    it('shouldCaptureBundle returns false for warn-level incident', () => {
      tracker.update('warn', 'test');
      expect(tracker.shouldCaptureBundle([1000])).toBe(false);
    });

    it('shouldCaptureBundle returns true once for critical incident', () => {
      tracker.update('warn', 'test');
      tracker.update('critical', 'escalated');

      // First call → true
      expect(tracker.shouldCaptureBundle([1000])).toBe(true);

      // Mark captured
      tracker.markBundleCaptured('/path/to/bundle.zip', [1000]);

      // Second call → false (already captured)
      expect(tracker.shouldCaptureBundle([1000])).toBe(false);
    });

    it('marks bundle path on incident after capture', () => {
      tracker.update('warn', 'test');
      tracker.update('critical', 'escalated');
      tracker.markBundleCaptured('/path/bundle.zip', [1000]);

      const active = tracker.getActive();
      expect(active!.bundleCaptured).toBe(true);
      expect(active!.bundlePath).toBe('/path/bundle.zip');
    });

    it('per-PID rate limiting prevents rapid re-bundles', () => {
      // First incident
      tracker.update('warn', 'first');
      tracker.update('critical', 'first-critical');
      tracker.markBundleCaptured('/bundle1.zip', [1000]);

      // Close and open a new incident
      tracker.update('ok', '');
      tracker.update('warn', 'second');
      tracker.update('critical', 'second-critical');

      // Same PID within cooldown → blocked
      expect(tracker.shouldCaptureBundle([1000])).toBe(false);
    });

    it('different PIDs are not rate-limited by each other', () => {
      tracker.update('warn', 'first');
      tracker.update('critical', 'first-critical');
      tracker.markBundleCaptured('/bundle1.zip', [1000]);

      // Close and open a new incident
      tracker.update('ok', '');
      tracker.update('warn', 'second');
      tracker.update('critical', 'second-critical');

      // Different PID → allowed
      expect(tracker.shouldCaptureBundle([2000])).toBe(true);
    });
  });

  describe('getActive returns a copy', () => {
    it('mutations on returned object do not affect internal state', () => {
      tracker.update('warn', 'test');
      const copy = tracker.getActive()!;
      copy.reason = 'MUTATED';

      const fresh = tracker.getActive()!;
      expect(fresh.reason).toBe('test');
    });
  });
});
