import { readdir, stat, mkdir, rm, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { GuardianConfig, PreflightResult, PreflightAction, ScanEntry } from './types.js';
import { DEFAULT_CONFIG, THRESHOLDS, getClaudeProjectsPath, getArchivePath } from './defaults.js';
import {
  dirSize, fileSize, listFilesRecursive, getDiskFreeGB,
  gzipFile, trimFileToLines, bytesToMB, pathExists, writeJournalEntry,
} from './fs-utils.js';

/** Scan Claude's project logs and return a preflight report. */
export async function scanLogs(config: GuardianConfig = DEFAULT_CONFIG): Promise<PreflightResult> {
  const claudePath = getClaudeProjectsPath();
  const diskFreeGB = await getDiskFreeGB(claudePath);
  const diskFreeWarning = diskFreeGB >= 0 && diskFreeGB < THRESHOLDS.diskFreeWarningGB;

  const result: PreflightResult = {
    diskFreeGB: Math.round(diskFreeGB * 100) / 100,
    diskFreeWarning,
    claudeProjectsPath: null,
    claudeProjectsSizeMB: 0,
    entries: [],
    actions: [],
  };

  if (!await pathExists(claudePath)) {
    return result;
  }

  result.claudeProjectsPath = claudePath;
  const totalSize = await dirSize(claudePath);
  result.claudeProjectsSizeMB = bytesToMB(totalSize);

  // Scan top-level project directories
  try {
    const topEntries = await readdir(claudePath, { withFileTypes: true });
    for (const entry of topEntries) {
      const fullPath = join(claudePath, entry.name);
      if (entry.isDirectory()) {
        const size = await dirSize(fullPath);
        result.entries.push({
          path: fullPath,
          sizeBytes: size,
          sizeMB: bytesToMB(size),
          isFile: false,
        });
      }
    }
  } catch {
    // unreadable
  }

  // Sort by size descending
  result.entries.sort((a, b) => b.sizeBytes - a.sizeBytes);

  // Flag oversized directories
  for (const entry of result.entries) {
    if (entry.sizeMB > config.maxProjectLogDirMB) {
      result.actions.push({
        type: 'warning',
        target: entry.path,
        detail: `Project log dir is ${entry.sizeMB}MB (limit: ${config.maxProjectLogDirMB}MB)`,
      });
    }
  }

  // Count stale sessions per project directory
  const cutoff = Date.now() - THRESHOLDS.staleSessionDays * 24 * 60 * 60 * 1000;
  for (const entry of result.entries) {
    if (entry.isFile) continue;
    try {
      const subEntries = await readdir(entry.path, { withFileTypes: true });
      let staleCount = 0;
      let staleBytes = 0;
      for (const sub of subEntries) {
        if (PROTECTED_NAMES.has(sub.name)) continue;
        const subPath = join(entry.path, sub.name);
        // Match UUID session files and dirs
        const isSessionFile = sub.isFile() && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl(\.gz)?$/i.test(sub.name);
        const isSessionDir = sub.isDirectory() && UUID_RE.test(sub.name);
        if (!isSessionFile && !isSessionDir) continue;
        try {
          const subStat = await stat(subPath);
          if (subStat.mtimeMs < cutoff) {
            staleCount++;
            staleBytes += sub.isFile() ? subStat.size : await dirSize(subPath);
          }
        } catch { /* skip */ }
      }
      if (staleCount > 0) {
        result.actions.push({
          type: 'warning',
          target: entry.path,
          detail: `${staleCount} stale session(s) (${bytesToMB(staleBytes)}MB) older than ${THRESHOLDS.staleSessionDays}d. Run with --fix to clean.`,
        });
      }
    } catch { /* skip */ }
  }

  // Scan for individual oversized files
  const allFiles = await listFilesRecursive(claudePath);
  for (const filePath of allFiles) {
    const size = await fileSize(filePath);
    const sizeMB = bytesToMB(size);
    if (sizeMB > THRESHOLDS.maxFileMB && !filePath.endsWith('.gz')) {
      result.actions.push({
        type: 'warning',
        target: filePath,
        detail: `File is ${sizeMB}MB (limit: ${THRESHOLDS.maxFileMB}MB)`,
      });
    }
  }

  if (diskFreeWarning) {
    result.actions.push({
      type: 'warning',
      target: 'disk',
      detail: `Disk free space is ${result.diskFreeGB}GB (threshold: ${THRESHOLDS.diskFreeWarningGB}GB)`,
    });
  }

  return result;
}

/** Fix issues found in preflight — rotate, trim, and compress. */
export async function fixLogs(
  config: GuardianConfig = DEFAULT_CONFIG,
  aggressive: boolean = false,
): Promise<PreflightAction[]> {
  const claudePath = getClaudeProjectsPath();
  const actions: PreflightAction[] = [];

  if (!await pathExists(claudePath)) {
    return actions;
  }

  const diskFreeGB = await getDiskFreeGB(claudePath);
  const effectiveAggressive = aggressive || (diskFreeGB >= 0 && diskFreeGB < THRESHOLDS.diskFreeWarningGB);

  const allFiles = await listFilesRecursive(claudePath);

  for (const filePath of allFiles) {
    // Skip already compressed files
    if (filePath.endsWith('.gz')) continue;

    const size = await fileSize(filePath);
    const sizeMB = bytesToMB(size);

    // Check file age
    const fileStat = await stat(filePath);
    const ageDays = (Date.now() - fileStat.mtimeMs) / (1000 * 60 * 60 * 24);
    const retainDays = effectiveAggressive ? Math.floor(THRESHOLDS.retainDays / 2) : THRESHOLDS.retainDays;

    // Rotate old files (gzip them)
    if (ageDays > retainDays && sizeMB > 1) {
      try {
        const gzPath = await gzipFile(filePath);
        const newSize = await fileSize(gzPath);
        const action: PreflightAction = {
          type: 'rotated',
          target: filePath,
          detail: `Compressed ${sizeMB}MB → ${bytesToMB(newSize)}MB (${Math.round(ageDays)}d old)`,
          sizeBefore: size,
          sizeAfter: newSize,
        };
        actions.push(action);
        await writeJournalEntry({
          timestamp: new Date().toISOString(),
          action: 'rotated',
          target: filePath,
          detail: action.detail,
          sizeBefore: size,
          sizeAfter: newSize,
        });
      } catch {
        // Skip files we can't compress
      }
      continue;
    }

    // Trim oversized files (keep last N lines)
    if (sizeMB > THRESHOLDS.maxFileMB || (effectiveAggressive && sizeMB > THRESHOLDS.maxFileMB / 2)) {
      // Only trim text-ish files
      if (isTextFile(filePath)) {
        try {
          const keepLines = effectiveAggressive ? 5000 : 10000;
          const newSize = await trimFileToLines(filePath, keepLines);
          const action: PreflightAction = {
            type: 'trimmed',
            target: filePath,
            detail: `Trimmed ${sizeMB}MB → ${bytesToMB(newSize)}MB (kept last ${keepLines} lines)`,
            sizeBefore: size,
            sizeAfter: newSize,
          };
          actions.push(action);
          await writeJournalEntry({
            timestamp: new Date().toISOString(),
            action: 'trimmed',
            target: filePath,
            detail: action.detail,
            sizeBefore: size,
            sizeAfter: newSize,
          });
        } catch {
          // Skip files we can't trim
        }
      }
    }
  }

  // Clean stale session transcripts from each project directory
  try {
    const topEntries = await readdir(claudePath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(claudePath, entry.name);
      const sessionActions = await cleanStaleSessions(fullPath, effectiveAggressive);
      actions.push(...sessionActions);
    }
  } catch {
    // unreadable
  }

  // Check total project dir sizes after per-file fixes
  try {
    const topEntries = await readdir(claudePath, { withFileTypes: true });
    for (const entry of topEntries) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(claudePath, entry.name);
      const size = await dirSize(fullPath);
      const sizeMB = bytesToMB(size);

      if (sizeMB > config.maxProjectLogDirMB) {
        // Archive the whole directory
        const archiveDir = getArchivePath();
        if (!existsSync(archiveDir)) {
          await mkdir(archiveDir, { recursive: true });
        }

        const action: PreflightAction = {
          type: 'warning',
          target: fullPath,
          detail: `Directory still ${sizeMB}MB after trimming (limit: ${config.maxProjectLogDirMB}MB). Manual review recommended.`,
        };
        actions.push(action);
      }
    }
  } catch {
    // unreadable
  }

  return actions;
}

/** Format a preflight result as a human-readable report. */
export function formatPreflightReport(result: PreflightResult): string {
  const lines: string[] = [];
  lines.push('=== Claude Guardian Preflight ===');
  lines.push('');

  // Disk
  if (result.diskFreeGB >= 0) {
    const icon = result.diskFreeWarning ? 'WARNING' : 'OK';
    lines.push(`Disk free: ${result.diskFreeGB}GB [${icon}]`);
  } else {
    lines.push('Disk free: unknown');
  }

  // Claude projects
  if (result.claudeProjectsPath) {
    lines.push(`Claude projects: ${result.claudeProjectsPath}`);
    lines.push(`Total size: ${result.claudeProjectsSizeMB}MB`);
    lines.push('');

    if (result.entries.length > 0) {
      lines.push('Project directories (by size):');
      for (const entry of result.entries.slice(0, 10)) {
        const name = entry.path.split(/[/\\]/).pop() || entry.path;
        lines.push(`  ${name}: ${entry.sizeMB}MB`);
      }
      if (result.entries.length > 10) {
        lines.push(`  ... and ${result.entries.length - 10} more`);
      }
    }
  } else {
    lines.push('Claude projects: not found (no ~/.claude/projects)');
  }

  // Actions/warnings
  if (result.actions.length > 0) {
    lines.push('');
    lines.push('Issues found:');
    for (const action of result.actions) {
      lines.push(`  [${action.type.toUpperCase()}] ${action.detail}`);
    }
  } else {
    lines.push('');
    lines.push('No issues found.');
  }

  return lines.join('\n');
}

/** Format fix actions as a human-readable report. */
export function formatFixReport(actions: PreflightAction[]): string {
  if (actions.length === 0) {
    return 'No actions needed — logs look healthy.';
  }

  const lines: string[] = [];
  lines.push('=== Claude Guardian Fix Report ===');
  lines.push('');

  let totalSaved = 0;
  for (const action of actions) {
    lines.push(`[${action.type.toUpperCase()}] ${action.detail}`);
    if (action.sizeBefore !== undefined && action.sizeAfter !== undefined) {
      totalSaved += action.sizeBefore - action.sizeAfter;
    }
  }

  if (totalSaved > 0) {
    lines.push('');
    lines.push(`Total space recovered: ${bytesToMB(totalSaved)}MB`);
  }

  return lines.join('\n');
}

/** Generate a one-line health banner. */
export function healthBanner(result: PreflightResult): string {
  const parts: string[] = [];
  parts.push(`disk=${result.diskFreeGB}GB`);
  parts.push(`logs=${result.claudeProjectsSizeMB}MB`);
  parts.push(`issues=${result.actions.length}`);
  if (result.diskFreeWarning) parts.push('LOW-DISK');
  return `[guardian] ${parts.join(' | ')}`;
}

/** UUID pattern matching session IDs (directories and files). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Entries to never delete inside a project directory. */
const PROTECTED_NAMES = new Set(['memory', 'sessions-index.json']);

/**
 * Clean stale session transcripts from a single project directory.
 * Removes UUID-named .jsonl files, .jsonl.gz files, and UUID-named
 * subdirectories older than the configured threshold.
 */
export async function cleanStaleSessions(
  projectDir: string,
  aggressive: boolean = false,
): Promise<PreflightAction[]> {
  const actions: PreflightAction[] = [];
  const retainDays = aggressive
    ? Math.floor(THRESHOLDS.staleSessionDays / 2)
    : THRESHOLDS.staleSessionDays;
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;

  let entries;
  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return actions;
  }

  for (const entry of entries) {
    const name = entry.name;

    // Never touch protected entries
    if (PROTECTED_NAMES.has(name)) continue;

    const fullPath = join(projectDir, name);

    if (entry.isFile()) {
      // Match: <uuid>.jsonl or <uuid>.jsonl.gz
      const match = name.match(/^([0-9a-f-]+)\.jsonl(\.gz)?$/i);
      if (!match) continue;
      const stem = match[1];
      if (!UUID_RE.test(stem)) continue;

      try {
        const fileStat = await stat(fullPath);
        if (fileStat.mtimeMs < cutoff) {
          const size = fileStat.size;
          await unlink(fullPath);
          const action: PreflightAction = {
            type: 'cleaned',
            target: fullPath,
            detail: `Removed stale session transcript ${name} (${bytesToMB(size)}MB, ${Math.round((Date.now() - fileStat.mtimeMs) / 86400000)}d old)`,
            sizeBefore: size,
            sizeAfter: 0,
          };
          actions.push(action);
          await writeJournalEntry({
            timestamp: new Date().toISOString(),
            action: 'cleaned',
            target: fullPath,
            detail: action.detail,
            sizeBefore: size,
            sizeAfter: 0,
          });
        }
      } catch {
        // Skip files we can't stat or delete
      }
    } else if (entry.isDirectory()) {
      // Match UUID-named session directories
      if (!UUID_RE.test(name)) continue;

      try {
        const dirStat = await stat(fullPath);
        if (dirStat.mtimeMs < cutoff) {
          const size = await dirSize(fullPath);
          await rm(fullPath, { recursive: true, force: true });
          const action: PreflightAction = {
            type: 'cleaned',
            target: fullPath,
            detail: `Removed stale session dir ${name} (${bytesToMB(size)}MB, ${Math.round((Date.now() - dirStat.mtimeMs) / 86400000)}d old)`,
            sizeBefore: size,
            sizeAfter: 0,
          };
          actions.push(action);
          await writeJournalEntry({
            timestamp: new Date().toISOString(),
            action: 'cleaned',
            target: fullPath,
            detail: action.detail,
            sizeBefore: size,
            sizeAfter: 0,
          });
        }
      } catch {
        // Skip dirs we can't remove
      }
    }
  }

  return actions;
}

/** Check if a file is likely text-based (safe to trim by lines). */
function isTextFile(filePath: string): boolean {
  const textExtensions = [
    '.log', '.jsonl', '.json', '.txt', '.md',
    '.yaml', '.yml', '.toml', '.csv', '.ndjson',
  ];
  const lower = filePath.toLowerCase();
  return textExtensions.some(ext => lower.endsWith(ext));
}
