import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';

// killTree's Windows branch runs `taskkill`; the real tree kill is covered by
// watchdog-kill-tree.test.ts on Windows. Here the platform and `spawn` are
// faked, so every branch runs on any machine, CI included.
const spawnMock = vi.fn();
vi.mock('child_process', () => ({ spawn: (...a: unknown[]) => spawnMock(...a) }));

const { killTree } = await import('../src/kill-tree.js');

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
function setPlatform(value: string): void {
  Object.defineProperty(process, 'platform', { ...realPlatform, value });
}

/** A stand-in ChildProcess: only what killTree reads. */
function fakeChild(over: Partial<{ pid: number | undefined; exitCode: number | null; signalCode: string | null }> = {}) {
  const child = { pid: 123, exitCode: null, signalCode: null, kill: vi.fn(), ...over };
  return child as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockImplementation(() => new EventEmitter());
});
afterEach(() => {
  Object.defineProperty(process, 'platform', realPlatform);
});

describe('killTree on Windows', () => {
  beforeEach(() => setPlatform('win32'));

  it('ends the whole tree with taskkill /T /F and does not call kill()', () => {
    const child = fakeChild();
    killTree(child);
    expect(spawnMock).toHaveBeenCalledWith('taskkill', ['/pid', '123', '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('falls back to kill() with the given signal if taskkill cannot start', () => {
    const tk = new EventEmitter();
    spawnMock.mockImplementation(() => tk);
    const child = fakeChild();
    killTree(child, 'SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
    tk.emit('error', new Error('spawn taskkill ENOENT'));
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('uses kill() when the child has no pid', () => {
    const child = fakeChild({ pid: undefined });
    killTree(child);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('killTree elsewhere', () => {
  beforeEach(() => setPlatform('linux'));

  it('sends SIGKILL by default and the given signal otherwise', () => {
    const a = fakeChild();
    killTree(a);
    expect(a.kill).toHaveBeenCalledWith('SIGKILL');
    const b = fakeChild();
    killTree(b, 'SIGTERM');
    expect(b.kill).toHaveBeenCalledWith('SIGTERM');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('swallows a kill() that throws', () => {
    const child = fakeChild();
    child.kill.mockImplementation(() => {
      throw new Error('already gone');
    });
    expect(() => killTree(child)).not.toThrow();
  });
});

describe('killTree never touches a child that has already exited', () => {
  it.each([
    ['win32', { exitCode: 0 }],
    ['win32', { signalCode: 'SIGTERM' }],
    ['linux', { exitCode: 1 }],
  ])('%s %j', (platform, over) => {
    setPlatform(platform);
    const child = fakeChild(over);
    killTree(child);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });
});
