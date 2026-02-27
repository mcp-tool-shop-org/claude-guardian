import { describe, it, expect } from 'vitest';
import { generateRecoveryPlan, formatRecoveryPlan } from '../src/recovery-plan.js';
import { emptyState, computeAttention } from '../src/state.js';

describe('generateRecoveryPlan', () => {
  function makeState(overrides: Record<string, unknown> = {}) {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    Object.assign(state, overrides);
    // Recompute attention from current state
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    return state;
  }

  it('returns healthy when everything is ok', () => {
    const state = makeState();
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('healthy');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('No action needed');
    expect(plan.steps[0].tool).toBeNull();
  });

  it('returns action_needed when risk is warn', () => {
    const state = makeState({
      hangRisk: {
        level: 'warn', noActivitySeconds: 350, cpuLowSeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['No activity for 350s'],
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('action_needed');
    expect(plan.summary).toContain('WARN');
    // Should include nudge and monitoring steps
    const tools = plan.steps.map(s => s.tool).filter(Boolean);
    expect(tools).toContain('guardian_nudge');
    expect(tools).toContain('guardian_status');
  });

  it('returns urgent when risk is critical', () => {
    const state = makeState({
      hangRisk: {
        level: 'critical', noActivitySeconds: 900, cpuLowSeconds: 900,
        cpuHot: false, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['No activity for 900s'],
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('urgent');
    expect(plan.summary).toContain('CRITICAL');
    const tools = plan.steps.map(s => s.tool).filter(Boolean);
    expect(tools).toContain('guardian_nudge');
    expect(tools).toContain('guardian_budget_get');
    expect(tools).toContain('guardian_status');
  });

  it('includes disk fix step when disk is low', () => {
    const state = makeState({
      hangRisk: {
        level: 'warn', noActivitySeconds: 0, cpuLowSeconds: 0,
        cpuHot: false, memoryHigh: false, diskLow: true,
        graceRemainingSeconds: 0, reasons: ['Disk free: 3GB'],
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('action_needed');
    const diskStep = plan.steps.find(s => s.tool === 'guardian_preflight_fix');
    expect(diskStep).toBeDefined();
    expect(diskStep!.detail).toContain('Disk');
  });

  it('includes budget recovering step when cap is reduced but ok', () => {
    const state = makeState({
      budgetSummary: {
        currentCap: 2, baseCap: 4, slotsInUse: 0, slotsAvailable: 2,
        activeLeases: 0, capSetByRisk: 'warn',
        okSinceAt: null, hysteresisRemainingSeconds: 30,
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('healthy');
    const budgetStep = plan.steps.find(s => s.action === 'Budget recovering');
    expect(budgetStep).toBeDefined();
  });

  it('includes bundle not captured step when critical + no bundle', () => {
    const state = makeState({
      hangRisk: {
        level: 'critical', noActivitySeconds: 900, cpuLowSeconds: 900,
        cpuHot: false, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['No activity for 900s'],
      },
      activeIncident: {
        id: 'test123', startedAt: new Date().toISOString(), closedAt: null,
        reason: 'test', peakLevel: 'critical',
        bundleCaptured: false, bundlePath: null,
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    expect(plan.status).toBe('urgent');
    const bundleStep = plan.steps.find(s => s.tool === 'guardian_doctor');
    expect(bundleStep).toBeDefined();
  });

  it('includes concurrency reduction step when cpu hot', () => {
    const state = makeState({
      hangRisk: {
        level: 'warn', noActivitySeconds: 0, cpuLowSeconds: 0,
        cpuHot: true, memoryHigh: false, diskLow: false,
        graceRemainingSeconds: 0, reasons: ['CPU hot'],
      },
    });
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    const cpuStep = plan.steps.find(s => s.detail.includes('CPU'));
    expect(cpuStep).toBeDefined();
  });
});

describe('formatRecoveryPlan', () => {
  it('formats a healthy plan as readable text', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    const plan = generateRecoveryPlan(state);
    const text = formatRecoveryPlan(plan);
    expect(text).toContain('HEALTHY');
    expect(text).toContain('No action needed');
  });

  it('formats an urgent plan with tool names', () => {
    const state = emptyState();
    state.diskFreeGB = 50;
    state.claudeLogSizeMB = 100;
    state.hangRisk = {
      level: 'critical', noActivitySeconds: 900, cpuLowSeconds: 900,
      cpuHot: false, memoryHigh: false, diskLow: false,
      graceRemainingSeconds: 0, reasons: ['No activity'],
    };
    state.attention = computeAttention(state.hangRisk, state.budgetSummary, state.activeIncident);
    const plan = generateRecoveryPlan(state);
    const text = formatRecoveryPlan(plan);
    expect(text).toContain('URGENT');
    expect(text).toContain('[guardian_nudge]');
    expect(text).toContain('[guardian_status]');
  });
});
