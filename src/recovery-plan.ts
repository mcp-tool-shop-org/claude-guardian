import type { GuardianState } from './state.js';

/** A single recovery step. */
export interface RecoveryStep {
  order: number;
  action: string;
  /** MCP tool to call (if applicable). */
  tool: string | null;
  detail: string;
}

/** A deterministic recovery plan. */
export interface RecoveryPlan {
  status: 'healthy' | 'action_needed' | 'urgent';
  summary: string;
  steps: RecoveryStep[];
}

/**
 * Generate a deterministic recovery plan from current state.
 * Never kills processes or auto-restarts — only guides the agent.
 */
export function generateRecoveryPlan(state: GuardianState): RecoveryPlan {
  const steps: RecoveryStep[] = [];
  let order = 1;

  const risk = state.hangRisk;
  const attention = state.attention;

  // === CRITICAL ===
  if (risk.level === 'critical') {
    steps.push({
      order: order++,
      action: 'Capture diagnostics',
      tool: 'guardian_nudge',
      detail: 'Run guardian_nudge immediately to fix logs and capture a diagnostics bundle.',
    });

    steps.push({
      order: order++,
      action: 'Release concurrency',
      tool: 'guardian_budget_get',
      detail: 'Check budget cap with guardian_budget_get. Release any active leases you hold.',
    });

    if (risk.diskLow) {
      steps.push({
        order: order++,
        action: 'Free disk space',
        tool: 'guardian_preflight_fix',
        detail: 'Disk is critically low. Run guardian_preflight_fix with aggressive=true.',
      });
    }

    steps.push({
      order: order++,
      action: 'Verify status',
      tool: 'guardian_status',
      detail: 'Check guardian_status. If risk is still critical after 2 minutes, manual restart is needed.',
    });

    steps.push({
      order: order++,
      action: 'Reduce workload',
      tool: null,
      detail: 'Do not start new heavy tasks. Complete or cancel in-progress work. Wait for recovery.',
    });

    if (state.activeIncident && !state.activeIncident.bundleCaptured) {
      steps.push({
        order: order++,
        action: 'Bundle not yet captured',
        tool: 'guardian_doctor',
        detail: 'If guardian_nudge did not capture a bundle, run guardian_doctor manually for evidence.',
      });
    }

    return {
      status: 'urgent',
      summary: `CRITICAL: ${attention.reason}. Immediate action required.`,
      steps,
    };
  }

  // === WARN ===
  if (risk.level === 'warn') {
    steps.push({
      order: order++,
      action: 'Run safe remediation',
      tool: 'guardian_nudge',
      detail: 'Run guardian_nudge to auto-fix logs and capture diagnostics if needed.',
    });

    if (risk.diskLow) {
      steps.push({
        order: order++,
        action: 'Free disk space',
        tool: 'guardian_preflight_fix',
        detail: 'Disk is low. Run guardian_preflight_fix to rotate and trim logs.',
      });
    }

    if (risk.noActivitySeconds > 0) {
      steps.push({
        order: order++,
        action: 'Check for stuck processes',
        tool: 'guardian_status',
        detail: `No activity for ${risk.noActivitySeconds}s. Check guardian_status for process details.`,
      });
    }

    if (risk.cpuHot || risk.memoryHigh) {
      steps.push({
        order: order++,
        action: 'Reduce concurrency',
        tool: 'guardian_budget_get',
        detail: `${risk.cpuHot ? 'CPU is pegged. ' : ''}${risk.memoryHigh ? 'Memory is high. ' : ''}Check budget and reduce concurrent tasks.`,
      });
    }

    steps.push({
      order: order++,
      action: 'Monitor',
      tool: 'guardian_status',
      detail: 'Continue monitoring with guardian_status. If risk escalates to critical, follow critical plan.',
    });

    return {
      status: 'action_needed',
      summary: `WARN: ${attention.reason}. Take preventive action.`,
      steps,
    };
  }

  // === OK ===
  // Check for info-level conditions
  if (state.budgetSummary && state.budgetSummary.currentCap < state.budgetSummary.baseCap) {
    steps.push({
      order: order++,
      action: 'Budget recovering',
      tool: 'guardian_budget_get',
      detail: `Budget cap is ${state.budgetSummary.currentCap}/${state.budgetSummary.baseCap}. Will auto-restore after sustained healthy period.`,
    });
  }

  if (state.activeIncident) {
    steps.push({
      order: order++,
      action: 'Incident resolving',
      tool: 'guardian_status',
      detail: `Incident ${state.activeIncident.id} is active but risk has returned to ok. Continue monitoring.`,
    });
  }

  if (steps.length === 0) {
    steps.push({
      order: 1,
      action: 'No action needed',
      tool: null,
      detail: 'All systems healthy. Continue normal operations.',
    });
  }

  return {
    status: 'healthy',
    summary: 'System is healthy. ' + (attention.level === 'info' ? attention.reason : 'No issues detected.'),
    steps,
  };
}

/** Format a recovery plan as a human-readable report. */
export function formatRecoveryPlan(plan: RecoveryPlan): string {
  const lines: string[] = [];
  lines.push(`Recovery Plan — ${plan.status.toUpperCase()}`);
  lines.push(plan.summary);
  lines.push('');

  for (const step of plan.steps) {
    lines.push(`${step.order}. ${step.action}${step.tool ? ` [${step.tool}]` : ''}`);
    lines.push(`   ${step.detail}`);
  }

  return lines.join('\n');
}
