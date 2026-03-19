import { stat, readdir, readFile, writeFile, appendFile, mkdir, rename, open } from 'fs/promises';
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

/** File entry with pre-fetched stats to avoid redundant stat calls. */
export interface FileWithStats {
  path: string;
  size: number;
  mtimeMs: number;
}

/** List all files in a directory recursively with stats (single traversal). */
export async function listFilesWithStats(dirPath: string): Promise<FileWithStats[]> {
  const results: FileWithStats[] = [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listFilesWithStats(fullPath));
      } else {
        try {
          const s = await stat(fullPath);
          results.push({ path: fullPath, size: s.size, mtimeMs: s.mtimeMs });
        } catch {
          // file disappeared between readdir and stat
        }
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
      // Normalize path: convert /f/AI → F:, F:\AI → F:, \\server\share → unsupported
      let drive: string | null = null;
      if (targetPath.match(/^\/[a-zA-Z]\//)) {
        // Git Bash style: /c/Users → C:
        drive = targetPath[1].toUpperCase() + ':';
      } else if (targetPath.match(/^[a-zA-Z]:/)) {
        drive = targetPath.substring(0, 2).toUpperCase();
      }
      // UNC paths (\\server\share) and other formats: fall through to return -1

      if (drive) {
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

/**
 * Read the last N lines of a file.
 * Uses reverse-seek for files > 1MB to avoid reading the entire file into memory.
 */
export async function tailFile(filePath: string, lines: number): Promise<string> {
  try {
    const info = await stat(filePath);
    const SMALL_FILE_THRESHOLD = 1024 * 1024; // 1MB

    if (info.size <= SMALL_FILE_THRESHOLD) {
      // Small file: read all at once (fast path)
      const content = await readFile(filePath, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    }

    // Large file: read from the end in chunks
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const fh = await open(filePath, 'r');
    try {
      let position = info.size;
      let collected = '';
      let lineCount = 0;

      while (position > 0 && lineCount <= lines) {
        const readSize = Math.min(CHUNK_SIZE, position);
        position -= readSize;
        const buf = Buffer.alloc(readSize);
        await fh.read(buf, 0, readSize, position);
        const chunk = buf.toString('utf-8');
        collected = chunk + collected;
        // Count newlines in the chunk (approximate — final count done after loop)
        for (let i = 0; i < chunk.length; i++) {
          if (chunk.charCodeAt(i) === 10) lineCount++;
        }
      }

      const allLines = collected.split('\n');
      return allLines.slice(-lines).join('\n');
    } finally {
      await fh.close();
    }
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

/** Read the journal (last N entries). Tolerates corrupt lines. */
export async function readJournal(lastN?: number): Promise<JournalEntry[]> {
  try {
    const content = await readFile(getJournalPath(), 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: JournalEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as JournalEntry);
      } catch {
        // Skip corrupt line — don't lose the rest of the journal
      }
    }
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
