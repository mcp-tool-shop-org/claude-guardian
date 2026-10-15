import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DEFAULT_CONFIG } from '../src/defaults.js';
import { killTree } from '../src/kill-tree.js';
import { Watchdog } from '../src/watchdog.js';

// Hang recovery and the journal write to the user's ~/.claude; neither is under test.
vi.mock('../src/doctor.js', () => ({ generateBundle: vi.fn(async () => ({ zipPath: 'mock-bundle.zip' })) }));
vi.mock('../src/fs-utils.js', async (importActual) => ({
  ...(await importActual<typeof import('../src/fs-utils.js')>()),
  writeJournalEntry: vi.fn(async () => {}),
}));

// The watchdog runs its command with `shell: true`, so on Windows the child it
// holds is cmd.exe and the real command is cmd.exe's child. `child.kill()` used
// to end cmd.exe only: a hung command stayed alive, and hang recovery started a
// second copy beside it. The holder starts a grandchild sharing its stdio, then
// both sleep: a command that outlives its shell.
const SLEEP_MS = 20_000;
const HOLDER = `
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, ${SLEEP_MS})"], { stdio: "inherit" });
writeFileSync(process.argv[2], String(g.pid));
setTimeout(() => {}, ${SLEEP_MS});
`;

let dir: string | null = null;
let pids: number[] = [];
let dogs: Watchdog[] = [];

afterEach(async () => {
  const hadDogs = dogs.length > 0;
  for (const d of dogs) d.stop();
  dogs = [];
  if (hadDogs) await sleep(1_000); // let taskkill finish before the holder's directory goes
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  pids = [];
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  dir = null;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Run the holder under a Watchdog (no polling timer: the test calls pollCheck itself). */
async function watchedHolder(config = DEFAULT_CONFIG) {
  dir = await mkdtemp(join(tmpdir(), 'guardian-killtree-'));
  const script = join(dir, 'holder.cjs');
  const pidFile = join(dir, 'grandchild.pid');
  await writeFile(script, HOLDER, 'utf8');
  const events: string[] = [];
  const wd = new Watchdog('node', [`"${script}"`, `"${pidFile}"`], config, (type) => events.push(type));
  dogs.push(wd);
  const priv = wd as unknown as { spawnChild(): void; pollCheck(): Promise<void> };
  priv.spawnChild();
  return { wd, priv, pidFile, events };
}

/** The grandchild's pid once the holder has written it, registered for cleanup. */
async function grandchild(pidFile: string): Promise<number> {
  for (let i = 0; i < 100; i++) {
    try {
      const pid = Number(await readFile(pidFile, 'utf8'));
      if (pid) {
        pids.push(pid);
        return pid;
      }
    } catch {
      /* not written yet */
    }
    await sleep(100);
  }
  throw new Error('the holder never started its grandchild');
}

describe('killTree', () => {
  it('leaves a child that has already exited alone', async () => {
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((r) => child.once('exit', r));
    const kill = vi.spyOn(child, 'kill');
    killTree(child); // a reused pid must never be signalled
    expect(kill).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')('sends the signal it is given, SIGKILL by default', async () => {
    for (const [arg, expected] of [[undefined, 'SIGKILL'], ['SIGTERM', 'SIGTERM']] as const) {
      const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
      const exited = new Promise<string | null>((r) => child.once('exit', (_c, sig) => r(sig)));
      killTree(child, arg);
      expect(await exited).toBe(expected);
    }
  });
});

describe('Watchdog ends the whole process tree', () => {
  it.skipIf(process.platform !== 'win32')('[win32] stop() ends the grandchild too', async () => {
    const { wd, pidFile } = await watchedHolder();
    const pid = await grandchild(pidFile);
    expect(alive(pid)).toBe(true);
    wd.stop();
    // taskkill runs on its own; give it a moment. Before the fix the command
    // was still running here, with SLEEP_MS left to go.
    await sleep(1_500);
    expect(alive(pid)).toBe(false);
  }, 20_000);

  it('hang recovery restarts the command', async () => {
    const { wd, priv, pidFile, events } = await watchedHolder({ ...DEFAULT_CONFIG, hangNoActivitySeconds: 0, autoRestart: true });
    await grandchild(pidFile);
    const before = wd.getState().childPid;
    await sleep(150); // inactivity must be above the zero threshold
    await priv.pollCheck();
    expect(events).toContain('hang-detected');
    expect(events).toContain('restarting');
    expect(wd.getState().restartCount).toBeGreaterThanOrEqual(1);
    expect(wd.getState().childPid).not.toBe(before);
  }, 20_000);

  it.skipIf(process.platform !== 'win32')('[win32] hang recovery ends the hung command instead of starting a second beside it', async () => {
    const { priv, pidFile } = await watchedHolder({ ...DEFAULT_CONFIG, hangNoActivitySeconds: 0, autoRestart: true });
    const hung = await grandchild(pidFile);
    expect(alive(hung)).toBe(true);
    await sleep(150);
    await priv.pollCheck();
    await sleep(1_500);
    expect(alive(hung), 'the hung command was left running beside its replacement').toBe(false);
  }, 20_000);
});
