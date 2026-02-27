import { readFile, writeFile, mkdir, rename, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { getBudgetPath, getGuardianDataPath, BUDGET_THRESHOLDS } from './defaults.js';
import { wrapError } from './errors.js';
import type { RiskLevel } from './process-monitor.js';

/** A single concurrency lease. */
export interface BudgetLease {
  id: string;
  slots: number;
  reason: string;
  grantedAt: string;
  expiresAt: string;
}

/** Persisted budget state. */
export interface BudgetData {
  /** Current effective cap (may be reduced from baseCap). */
  currentCap: number;
  /** Base cap (maxTokens). */
  baseCap: number;
  /** Active leases. */
  leases: BudgetLease[];
  /** Risk level that caused current cap reduction (null if at base). */
  capSetByRisk: RiskLevel | null;
  /** When cap was last changed. */
  capChangedAt: string;
  /** When risk last returned to ok (null if not ok). For hysteresis. */
  okSinceAt: string | null;
}

/** Write budget atomically (write to .tmp, then rename). */
export async function writeBudget(data: BudgetData): Promise<void> {
  const dataDir = getGuardianDataPath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  const budgetPath = getBudgetPath();
  const tmpPath = budgetPath + '.tmp';
  const json = JSON.stringify(data, null, 2);

  try {
    await writeFile(tmpPath, json, 'utf-8');
    await rename(tmpPath, budgetPath);
  } catch (err) {
    throw wrapError(err, 'BUDGET_WRITE_FAILED', 'Check disk space and permissions on ~/.claude-guardian/');
  }
}

/**
 * Read the current budget. Returns null if no budget file exists.
 * If the file exists but is corrupt, backs it up and returns null with a warning.
 */
export async function readBudget(): Promise<BudgetData | null> {
  const budgetPath = getBudgetPath();
  let content: string;
  try {
    content = await readFile(budgetPath, 'utf-8');
  } catch {
    return null; // File doesn't exist — normal
  }

  try {
    return JSON.parse(content) as BudgetData;
  } catch (parseErr) {
    // Corrupt budget file — back it up and reset
    const backupPath = budgetPath + '.corrupt.' + Date.now();
    try {
      await copyFile(budgetPath, backupPath);
    } catch {
      // Best-effort backup
    }
    console.error(`[guardian] WARNING: budget.json is corrupt. Backed up to ${backupPath} and resetting.`);
    return null;
  }
}

/** Create an empty/default budget. */
export function emptyBudget(): BudgetData {
  return {
    currentCap: BUDGET_THRESHOLDS.baseCap,
    baseCap: BUDGET_THRESHOLDS.baseCap,
    leases: [],
    capSetByRisk: null,
    capChangedAt: new Date().toISOString(),
    okSinceAt: null,
  };
}
