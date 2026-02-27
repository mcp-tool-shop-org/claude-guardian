import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir } from 'fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

export interface HandleCountResult {
  pid: number;
  count: number | null;
  error: string | null;
}

/** Get open handle/FD count for a PID. Best-effort, never throws. */
export async function getHandleCount(pid: number): Promise<HandleCountResult> {
  try {
    if (process.platform === 'win32') {
      return await getHandleCountWindows(pid);
    } else if (process.platform === 'linux') {
      return await getHandleCountLinux(pid);
    } else if (process.platform === 'darwin') {
      return await getHandleCountMacOS(pid);
    } else {
      return { pid, count: null, error: `Unsupported platform: ${process.platform}` };
    }
  } catch (err) {
    return { pid, count: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Get handle counts for multiple PIDs in parallel. */
export async function getHandleCounts(pids: number[]): Promise<HandleCountResult[]> {
  return Promise.all(pids.map(pid => getHandleCount(pid)));
}

async function getHandleCountWindows(pid: number): Promise<HandleCountResult> {
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).HandleCount`,
    ], { timeout: 3000 });

    const count = parseInt(stdout.trim(), 10);
    if (isNaN(count)) {
      return { pid, count: null, error: `Unexpected output: ${stdout.trim()}` };
    }
    return { pid, count, error: null };
  } catch (err) {
    return { pid, count: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getHandleCountLinux(pid: number): Promise<HandleCountResult> {
  try {
    const fdPath = join('/proc', String(pid), 'fd');
    const entries = await readdir(fdPath);
    return { pid, count: entries.length, error: null };
  } catch (err) {
    return { pid, count: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function getHandleCountMacOS(pid: number): Promise<HandleCountResult> {
  try {
    const { stdout } = await execFileAsync('lsof', ['-p', String(pid)], { timeout: 3000 });
    // lsof outputs one line per FD, first line is header
    const lines = stdout.trim().split('\n');
    const count = Math.max(0, lines.length - 1);
    return { pid, count, error: null };
  } catch (err) {
    return { pid, count: null, error: err instanceof Error ? err.message : String(err) };
  }
}
