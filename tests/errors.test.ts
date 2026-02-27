import { describe, it, expect } from 'vitest';
import { GuardianError, wrapError } from '../src/errors.js';

describe('GuardianError', () => {
  it('constructs with code, message, hint', () => {
    const err = new GuardianError('STATE_CORRUPT', 'bad json', 'Delete state.json');
    expect(err.code).toBe('STATE_CORRUPT');
    expect(err.message).toBe('bad json');
    expect(err.hint).toBe('Delete state.json');
    expect(err.name).toBe('GuardianError');
    expect(err.cause).toBeUndefined();
  });

  it('constructs with cause', () => {
    const cause = new SyntaxError('Unexpected token');
    const err = new GuardianError('STATE_CORRUPT', 'parse failed', 'Reset state', cause);
    expect(err.cause).toBe(cause);
  });

  it('toMcpText formats without stack trace', () => {
    const cause = new Error('ENOENT');
    const err = new GuardianError('BUNDLE_FAILED', 'Cannot create bundle', 'Check disk space', cause);
    const text = err.toMcpText();
    expect(text).toContain('Error [BUNDLE_FAILED]');
    expect(text).toContain('Cannot create bundle');
    expect(text).toContain('Hint: Check disk space');
    expect(text).toContain('Cause: ENOENT');
    expect(text).not.toContain('at '); // No stack frames
  });

  it('toCliText formats with code and hint', () => {
    const err = new GuardianError('DISK_CHECK_FAILED', 'df failed', 'Check mount');
    const text = err.toCliText();
    expect(text).toContain('[guardian] Error: df failed');
    expect(text).toContain('Code: DISK_CHECK_FAILED');
    expect(text).toContain('Hint: Check mount');
  });
});

describe('wrapError', () => {
  it('wraps a plain Error', () => {
    const original = new Error('something broke');
    const wrapped = wrapError(original, 'UNKNOWN', 'Try again');
    expect(wrapped).toBeInstanceOf(GuardianError);
    expect(wrapped.code).toBe('UNKNOWN');
    expect(wrapped.hint).toBe('Try again');
    expect(wrapped.cause).toBe(original);
  });

  it('passes through an existing GuardianError', () => {
    const ge = new GuardianError('STATE_CORRUPT', 'bad', 'fix it');
    const wrapped = wrapError(ge, 'UNKNOWN', 'ignored');
    expect(wrapped).toBe(ge); // Same reference
  });

  it('wraps a string', () => {
    const wrapped = wrapError('string error', 'SCAN_FAILED', 'Retry');
    expect(wrapped.code).toBe('SCAN_FAILED');
    expect(wrapped.message).toBe('string error');
  });
});
