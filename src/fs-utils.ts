import { stat, readdir, readFile, writeFile, appendFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { createReadStream, createWriteStream, existsSync } from 'fs';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import type { JournalEntry } from './types.js';
import { getGuardianDataPath, getJournalPath } from './defaults.js';

/** Get size of a file in bytes. Returns 0 if file doesn't exist. */
export async function fileSize(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/** Get total size of a directory (recursive) in bytes. */
export async function dirSize(dirPath: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await dirSize(fullPath);
      } else {
        total += await fileSize(fullPath);
      }
    }
  } catch {
    // dir doesn't exist or unreadable
  }
  return total;
}

/** List all files in a directory recursively. */
export async function listFilesRecursive(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listFilesRecursive(fullPath));
      } else {
        results.push(fullPath);
      }
    }
  } catch {
    // dir doesn't exist or unreadable
  }
  return results;
}

/** Get disk free space in GB for the drive containing a given path. */
export async function getDiskFreeGB(targetPath: string): Promise<number> {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    if (process.platform === 'win32') {
      // Normalize path: convert /f/AI → F:, F:\AI → F:
      let drive: string;
      if (targetPath.match(/^\/[a-zA-Z]\//)) {
        // Git Bash style: /c/Users → C:
        drive = targetPath[1].toUpperCase() + ':';
      } else {
        drive = targetPath.substring(0, 2).toUpperCase();
      }

      // Try PowerShell first (wmic is deprecated on newer Windows)
      try {
        const { stdout } = await execFileAsync('powershell', [
          '-NoProfile', '-Command',
          `(Get-PSDrive ${drive[0]}).Free`
        ]);
        const freeBytes = parseInt(stdout.trim(), 10);
        if (!isNaN(freeBytes)) {
          return freeBytes / (1024 ** 3);
        }
      } catch {
        // Fall back to wmic
      }

      try {
        const { stdout } = await execFileAsync('wmic', [
          'logicaldisk', 'where', `DeviceID='${drive}'`, 'get', 'FreeSpace', '/value'
        ]);
        const match = stdout.match(/FreeSpace=(\d+)/);
        if (match) {
          return parseInt(match[1], 10) / (1024 ** 3);
        }
      } catch {
        // wmic not available
      }
    } else {
      // Use df on Unix
      const { stdout } = await execFileAsync('df', ['-k', targetPath]);
      const lines = stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const availKB = parseInt(parts[3], 10);
        return availKB / (1024 ** 2);
      }
    }
  } catch {
    // fallback
  }
  return -1; // unknown
}

/** Gzip a file in place (original → original.gz, original deleted). */
export async function gzipFile(filePath: string): Promise<string> {
  const gzPath = filePath + '.gz';
  await pipeline(
    createReadStream(filePath),
    createGzip(),
    createWriteStream(gzPath)
  );
  const { unlink } = await import('fs/promises');
  await unlink(filePath);
  return gzPath;
}

/** Read the last N lines of a file. */
export async function tailFile(filePath: string, lines: number): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const allLines = content.split('\n');
    return allLines.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/** Trim a file to its last N lines. Returns new size in bytes. */
export async function trimFileToLines(filePath: string, keepLines: number): Promise<number> {
  const content = await readFile(filePath, 'utf-8');
  const allLines = content.split('\n');
  if (allLines.length <= keepLines) {
    return Buffer.byteLength(content, 'utf-8');
  }
  const trimmed = allLines.slice(-keepLines).join('\n');
  await writeFile(filePath, trimmed, 'utf-8');
  return Buffer.byteLength(trimmed, 'utf-8');
}

/** Append a journal entry. */
export async function writeJournalEntry(entry: JournalEntry): Promise<void> {
  const dataDir = getGuardianDataPath();
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  const line = JSON.stringify(entry) + '\n';
  await appendFile(getJournalPath(), line, 'utf-8');
}

/** Read the journal (last N entries). */
export async function readJournal(lastN?: number): Promise<JournalEntry[]> {
  try {
    const content = await readFile(getJournalPath(), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries = lines.map(l => JSON.parse(l) as JournalEntry);
    if (lastN) {
      return entries.slice(-lastN);
    }
    return entries;
  } catch {
    return [];
  }
}

/** Bytes to MB, 2 decimal places. */
export function bytesToMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** Check if a path exists. */
export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
