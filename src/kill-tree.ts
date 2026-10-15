/**
 * Ending a supervised process, everywhere.
 *
 * The watchdog starts its command with `shell: true`, so on Windows the child
 * it holds is cmd.exe and the real command is cmd.exe's child. `child.kill()`
 * ends cmd.exe only: the hung command stays alive, and a hang recovery then
 * starts a second copy beside it.
 *
 * `killTree` ends the whole tree on Windows (`taskkill /T /F`, as forceful as
 * the TerminateProcess that `kill()` already was there). Elsewhere the child is
 * the command itself and gets `signal`, so a supervised program keeps its
 * chance to clean up on SIGTERM.
 *
 * Nothing happens for a child that has already exited: its pid may have been
 * reused, and `taskkill /T` on a reused pid would end an unrelated tree.
 */

import { spawn, type ChildProcess } from 'child_process';

export function killTree(child: ChildProcess, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid !== undefined) {
    const tk = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    tk.on('error', () => killChild(child, signal));
    return;
  }
  killChild(child, signal);
}

function killChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    /* already gone */
  }
}
