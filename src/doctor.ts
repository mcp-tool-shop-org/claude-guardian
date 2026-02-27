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

  const summary: DoctorSummary = {
    timestamp: new Date().toISOString(),
    system: systemInfo,
    claudeProjects,
    biggestFiles,
    journalEntries: journal.length,
    recentJournal,
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

      archive.finalize();
    };

    addTails().catch(reject);
  });
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
