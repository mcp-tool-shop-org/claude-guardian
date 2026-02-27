/**
 * Structured error type used across CLI + MCP.
 * Every guardian error carries a machine-readable code, a human hint, and optionally the root cause.
 */

/** Error codes — one per failure mode. */
export type GuardianErrorCode =
  | 'STATE_CORRUPT'
  | 'STATE_WRITE_FAILED'
  | 'BUDGET_CORRUPT'
  | 'BUDGET_WRITE_FAILED'
  | 'BUNDLE_FAILED'
  | 'SCAN_FAILED'
  | 'FIX_FAILED'
  | 'PROCESS_SCAN_FAILED'
  | 'DISK_CHECK_FAILED'
  | 'UNKNOWN';

export class GuardianError extends Error {
  /** Machine-readable error code. */
  readonly code: GuardianErrorCode;
  /** Human-friendly hint about what to do. */
  readonly hint: string;
  /** Original error (if wrapping). */
  readonly cause?: Error;

  constructor(code: GuardianErrorCode, message: string, hint: string, cause?: Error) {
    super(message);
    this.name = 'GuardianError';
    this.code = code;
    this.hint = hint;
    this.cause = cause;
  }

  /** Format for MCP tool responses (no stack traces). */
  toMcpText(): string {
    const lines = [`Error [${this.code}]: ${this.message}`];
    lines.push(`Hint: ${this.hint}`);
    if (this.cause) {
      lines.push(`Cause: ${this.cause.message}`);
    }
    return lines.join('\n');
  }

  /** Format for CLI output. */
  toCliText(): string {
    const lines = [`[guardian] Error: ${this.message}`];
    lines.push(`  Code: ${this.code}`);
    lines.push(`  Hint: ${this.hint}`);
    if (this.cause) {
      lines.push(`  Cause: ${this.cause.message}`);
    }
    return lines.join('\n');
  }
}

/** Wrap any thrown value into a GuardianError. */
export function wrapError(err: unknown, code: GuardianErrorCode, hint: string): GuardianError {
  if (err instanceof GuardianError) return err;
  const cause = err instanceof Error ? err : new Error(String(err));
  return new GuardianError(code, cause.message, hint, cause);
}
