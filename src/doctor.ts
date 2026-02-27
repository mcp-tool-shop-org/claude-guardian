import { mkdir, writeFile, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync, createWriteStream } from 'fs';
import archiver from 'archiver';
import { homedir, platform, release, totalmem, freemem, cpus } from 'os';
import type { PreflightResult } from './types.js';
import { getClaudeProjectsPath, getGuardianDataPath, THRESHOLDS } from './defaults.js';
import {
  dirSize, listFilesRecursive, getDiskFreeGB, bytesToMB,
  tailFile, readJournal, pathExists,
} from './fs-utils.js';
import { scanLogs } from './log-manager.js';
import { findClaudeProcesses, checkActivitySignals, type ClaudeProcess } from './process-monitor.js';
import { getHandleCounts, type HandleCountResult } from './handle-count.js';
import { readState } from './state.js';
import { readIncidentLog, type Incident } from './incident.js';

export interface DoctorBundle {
  /** Path to the generated zip file. */
  zipPath: string;
  /** Summary data included in the bundle. */
  summary: DoctorSummary;
}

export interface DoctorSummary {
  timestamp: string;
  system: SystemInfo;
  claudeProjects: PreflightResult;
  biggestFiles: Array<{ path: string; sizeMB: number }>;
  journalEntries: number;
  recentJournal: Array<{ timestamp: string; action: string; detail: string }>;
  /** Handle/FD counts for Claude processes at bundle time. */
  handleCounts: HandleCountResult[];
  /** Process snapshot at bundle time. */
  processSnapshot: ProcessSnapshot;
  /** Reconstructed timeline of events. */
  timeline: TimelineEvent[];
}

/** Snapshot of running Claude processes at bundle time. */
export interface ProcessSnapshot {
  timestamp: string;
  processes: Array<{
    pid: number;
    name: string;
    cpuPercent: number;
    memoryMB: number;
    uptimeSeconds: number;
    handleCount: number | null;
  }>;
  activitySignals: {
    logLastModifiedSecondsAgo: number;
    cpuActive: boolean;
    sources: string[];
  };
}

/** A single event in the diagnostic timeline. */
export interface TimelineEvent {
  timestamp: string;
  type: 'risk_change' | 'incident_open' | 'incident_close' | 'bundle_captured' | 'fix_applied' | 'budget_change' | 'journal';
  detail: string;
}

export interface SystemInfo {
  platform: string;
  release: string;
  arch: string;
  totalMemoryGB: number;
  freeMemoryGB: number;
  cpuModel: string;
  cpuCores: number;
  diskFreeGB: number;
  nodeVersion: string;
}

/** Collect system information. */
export function collectSystemInfo(diskFreeGB: number): SystemInfo {
  const cpuInfo = cpus();
  return {
    platform: platform(),
    release: release(),
    arch: process.arch,
    totalMemoryGB: Math.round((totalmem() / (1024 ** 3)) * 100) / 100,
    freeMemoryGB: Math.round((freemem() / (1024 ** 3)) * 100) / 100,
    cpuModel: cpuInfo[0]?.model || 'unknown',
    cpuCores: cpuInfo.length,
    diskFreeGB,
    nodeVersion: process.version,
  };
}

/** Generate a full diagnostics bundle. */
export async function generateBundle(outputPath?: string): Promise<DoctorBundle> {
  const dataDir = getGuardianDataPath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const zipPath = outputPath || join(dataDir, `bundle-${timestamp}.zip`);

  // Collect preflight scan
  const claudeProjects = await scanLogs();

  // Collect system info
  const diskFreeGB = await getDiskFreeGB(homedir());
  const systemInfo = collectSystemInfo(diskFreeGB);

  // Find biggest files
  const claudePath = getClaudeProjectsPath();
  const biggestFiles: Array<{ path: string; sizeMB: number }> = [];
  if (await pathExists(claudePath)) {
    const allFiles = await listFilesRecursive(claudePath);
    const fileSizes: Array<{ path: string; sizeMB: number }> = [];
    for (const f of allFiles) {
      const { stat } = await import('fs/promises');
      const s = await stat(f);
      fileSizes.push({ path: f, sizeMB: bytesToMB(s.size) });
    }
    fileSizes.sort((a, b) => b.sizeMB - a.sizeMB);
    biggestFiles.push(...fileSizes.slice(0, 20));
  }

  // Read journal
  const journal = await readJournal();
  const recentJournal = journal.slice(-50).map(e => ({
    timestamp: e.timestamp,
    action: e.action,
    detail: e.detail,
  }));

  // Collect handle counts for running Claude processes
  const processes = await findClaudeProcesses();
  const handleCounts = processes.length > 0
    ? await getHandleCounts(processes.map(p => p.pid))
    : [];

  // Build process snapshot
  const activity = await checkActivitySignals(processes);
  const processSnapshot = buildProcessSnapshot(processes, handleCounts, activity);

  // Build timeline from journal + incidents
  const timeline = await buildTimeline(journal, recentJournal);

  const summary: DoctorSummary = {
    timestamp: new Date().toISOString(),
    system: systemInfo,
    claudeProjects,
    biggestFiles,
    journalEntries: journal.length,
    recentJournal,
    handleCounts,
    processSnapshot,
    timeline,
  };

  // Build the zip
  await createZipBundle(zipPath, summary, claudePath);

  return { zipPath, summary };
}

/** Create the actual zip file with summary + log tails. */
async function createZipBundle(
  zipPath: string,
  summary: DoctorSummary,
  claudePath: string,
): Promise<void> {
  // Ensure parent dir exists
  const parentDir = join(zipPath, '..');
  if (!existsSync(parentDir)) {
    await mkdir(parentDir, { recursive: true });
  }

  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);

    // Add summary.json
    archive.append(JSON.stringify(summary, null, 2), { name: 'summary.json' });

    // Add log tails (async — we queue them as promises)
    const addTails = async () => {
      if (await pathExists(claudePath)) {
        const allFiles = await listFilesRecursive(claudePath);
        // Only tail the biggest files (top 20 by path, to avoid huge bundles)
        const textFiles = allFiles.filter(f =>
          f.endsWith('.log') || f.endsWith('.jsonl') || f.endsWith('.json') || f.endsWith('.txt')
        ).slice(0, 20);

        for (const f of textFiles) {
          const tail = await tailFile(f, THRESHOLDS.doctorTailLines);
          if (tail.length > 0) {
            // Use relative path from claude projects dir
            const relPath = f.replace(claudePath, '').replace(/^[/\\]/, '');
            archive.append(tail, { name: `log-tails/${relPath}` });
          }
        }
      }

      // Add journal if it exists
      const journalPath = join(getGuardianDataPath(), 'journal.jsonl');
      if (await pathExists(journalPath)) {
        const journalContent = await readFile(journalPath, 'utf-8');
        archive.append(journalContent, { name: 'journal.jsonl' });
      }

      // Add process snapshot
      archive.append(JSON.stringify(summary.processSnapshot, null, 2), { name: 'process.json' });

      // Add timeline
      archive.append(JSON.stringify(summary.timeline, null, 2), { name: 'timeline.json' });

      // Add filtered events (journal entries relevant to recent incidents)
      const events = buildEventLines(summary.recentJournal);
      if (events.length > 0) {
        archive.append(events, { name: 'events.jsonl' });
      }

      // Add current state if available
      const statePath = join(getGuardianDataPath(), 'state.json');
      if (await pathExists(statePath)) {
        const stateContent = await readFile(statePath, 'utf-8');
        archive.append(stateContent, { name: 'state.json' });
      }

      // Add incidents log if available
      const incidentsPath = join(getGuardianDataPath(), 'incidents.jsonl');
      if (await pathExists(incidentsPath)) {
        const incidentsContent = await readFile(incidentsPath, 'utf-8');
        archive.append(incidentsContent, { name: 'incidents.jsonl' });
      }

      archive.finalize();
    };

    addTails().catch(reject);
  });
}

/** Build a process snapshot from current processes and handle counts. */
function buildProcessSnapshot(
  processes: ClaudeProcess[],
  handleCounts: HandleCountResult[],
  activity: { logLastModifiedSecondsAgo: number; cpuActive: boolean; sources: string[] },
): ProcessSnapshot {
  const handleMap = new Map(handleCounts.map(h => [h.pid, h.count]));

  return {
    timestamp: new Date().toISOString(),
    processes: processes.map(p => ({
      pid: p.pid,
      name: p.name,
      cpuPercent: p.cpuPercent,
      memoryMB: p.memoryMB,
      uptimeSeconds: p.uptimeSeconds,
      handleCount: handleMap.get(p.pid) ?? null,
    })),
    activitySignals: {
      logLastModifiedSecondsAgo: activity.logLastModifiedSecondsAgo,
      cpuActive: activity.cpuActive,
      sources: activity.sources,
    },
  };
}

/** Build a chronological timeline from journal and incident history. */
async function buildTimeline(
  journal: Array<{ timestamp: string; action: string; detail: string; target?: string }>,
  recentJournal: Array<{ timestamp: string; action: string; detail: string }>,
): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Add journal events
  for (const entry of journal.slice(-100)) {
    let type: TimelineEvent['type'] = 'journal';
    if (entry.action === 'auto-bundle' || entry.action === 'bundle') {
      type = 'bundle_captured';
    } else if (entry.action.includes('fix') || entry.action.includes('rotate') || entry.action.includes('trim')) {
      type = 'fix_applied';
    }
    events.push({
      timestamp: entry.timestamp,
      type,
      detail: `${entry.action}: ${entry.detail}`,
    });
  }

  // Add incident events
  const incidents = await readIncidentLog(20);
  for (const inc of incidents) {
    events.push({
      timestamp: inc.startedAt,
      type: 'incident_open',
      detail: `Incident ${inc.id} opened (${inc.peakLevel}): ${inc.reason}`,
    });
    if (inc.closedAt) {
      events.push({
        timestamp: inc.closedAt,
        type: 'incident_close',
        detail: `Incident ${inc.id} closed`,
      });
    }
    if (inc.bundleCaptured && inc.bundlePath) {
      events.push({
        timestamp: inc.startedAt, // approximate
        type: 'bundle_captured',
        detail: `Bundle for incident ${inc.id}: ${inc.bundlePath}`,
      });
    }
  }

  // Add current state info
  const state = await readState();
  if (state) {
    events.push({
      timestamp: state.updatedAt,
      type: 'risk_change',
      detail: `Current risk: ${state.hangRisk.level} | attention: ${state.attention.level}`,
    });
    if (state.budgetSummary && state.budgetSummary.currentCap < state.budgetSummary.baseCap) {
      events.push({
        timestamp: state.updatedAt,
        type: 'budget_change',
        detail: `Budget cap: ${state.budgetSummary.currentCap}/${state.budgetSummary.baseCap} (reduced by ${state.budgetSummary.capSetByRisk})`,
      });
    }
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return events;
}

/** Build events.jsonl content from recent journal entries. */
function buildEventLines(recentJournal: Array<{ timestamp: string; action: string; detail: string }>): string {
  return recentJournal.map(e => JSON.stringify(e)).join('\n');
}

/** Format a doctor summary as a human-readable report. */
export function formatDoctorReport(summary: DoctorSummary): string {
  const lines: string[] = [];
  lines.push('=== Claude Guardian Doctor Report ===');
  lines.push(`Generated: ${summary.timestamp}`);
  lines.push('');

  // System
  lines.push('System:');
  lines.push(`  Platform: ${summary.system.platform} ${summary.system.release}`);
  lines.push(`  Arch: ${summary.system.arch}`);
  lines.push(`  Memory: ${summary.system.freeMemoryGB}GB free / ${summary.system.totalMemoryGB}GB total`);
  lines.push(`  CPU: ${summary.system.cpuModel} (${summary.system.cpuCores} cores)`);
  lines.push(`  Disk free: ${Math.round(summary.system.diskFreeGB * 100) / 100}GB`);
  lines.push(`  Node: ${summary.system.nodeVersion}`);
  lines.push('');

  // Claude projects
  lines.push('Claude Projects:');
  lines.push(`  Total size: ${summary.claudeProjects.claudeProjectsSizeMB}MB`);
  lines.push(`  Issues: ${summary.claudeProjects.actions.length}`);
  lines.push('');

  // Biggest files
  if (summary.biggestFiles.length > 0) {
    lines.push('Biggest files:');
    for (const f of summary.biggestFiles.slice(0, 10)) {
      const name = basename(f.path);
      lines.push(`  ${name}: ${f.sizeMB}MB`);
    }
    lines.push('');
  }

  // Process snapshot
  if (summary.processSnapshot.processes.length > 0) {
    lines.push('Process Snapshot:');
    for (const p of summary.processSnapshot.processes) {
      let line = `  PID ${p.pid} (${p.name}): CPU ${p.cpuPercent}% | RAM ${p.memoryMB}MB`;
      if (p.handleCount != null) {
        line += ` | handles=${p.handleCount}`;
      }
      lines.push(line);
    }
    lines.push(`  Activity: log=${summary.processSnapshot.activitySignals.logLastModifiedSecondsAgo}s ago | cpu=${summary.processSnapshot.activitySignals.cpuActive ? 'active' : 'idle'}`);
    lines.push('');
  }

  // Timeline
  if (summary.timeline.length > 0) {
    lines.push(`Timeline: ${summary.timeline.length} events`);
    for (const event of summary.timeline.slice(-10)) {
      lines.push(`  [${event.timestamp}] ${event.type}: ${event.detail}`);
    }
    lines.push('');
  }

  // Journal
  lines.push(`Guardian journal: ${summary.journalEntries} entries`);
  if (summary.recentJournal.length > 0) {
    lines.push('Recent actions:');
    for (const entry of summary.recentJournal.slice(-5)) {
      lines.push(`  [${entry.timestamp}] ${entry.action}: ${entry.detail}`);
    }
  }

  return lines.join('\n');
}
