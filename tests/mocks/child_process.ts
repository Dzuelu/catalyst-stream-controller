import { vi } from 'vitest';
import { promisify } from 'node:util';

/**
 * Mock for `node:child_process`.
 *
 * Provides mock implementations for `exec` and `execFile` that tests
 * can configure to simulate command outputs or failures.
 *
 * Usage in tests:
 *   import { setExecResult, setExecError } from '../mocks/child_process';
 *   setExecResult('echo hello', 'hello\n');
 *   setExecError('bad-cmd', new Error('not found'));
 */

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

/** Map of command substring → { stdout, stderr } for successful results */
const execResults = new Map<string, { stdout: string; stderr: string }>();

/** Map of command substring → Error for failed results */
const execErrors = new Map<string, Error>();

/** Default result when no specific mock is configured */
let defaultResult: { stdout: string; stderr: string } = { stdout: '', stderr: '' };

/**
 * Mock `exec` — matches command string against registered results/errors.
 * Falls back to the default result if no specific match is found.
 */
export const exec = vi.fn((command: string, callbackOrOptions?: unknown, maybeCallback?: unknown) => {
  const callback = (typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback) as
    | ExecCallback
    | undefined;

  // Check for configured error
  for (const [pattern, error] of execErrors) {
    if (command.includes(pattern)) {
      if (callback) {
        process.nextTick(() => callback(error, '', error.message));
      }
      return;
    }
  }

  // Check for configured result
  for (const [pattern, result] of execResults) {
    if (command.includes(pattern)) {
      if (callback) {
        process.nextTick(() => callback(null, result.stdout, result.stderr));
      }
      return;
    }
  }

  // Default: success with empty output
  if (callback) {
    process.nextTick(() => callback(null, defaultResult.stdout, defaultResult.stderr));
  }
});

/**
 * Mock `execFile` — same pattern matching as `exec`.
 */
export const execFile = vi.fn((file: string, args?: string[], callbackOrOptions?: unknown, maybeCallback?: unknown) => {
  const callback = (typeof callbackOrOptions === 'function' ? callbackOrOptions : maybeCallback) as
    | ExecCallback
    | undefined;

  const command = `${file} ${(args ?? []).join(' ')}`;

  for (const [pattern, error] of execErrors) {
    if (command.includes(pattern)) {
      if (callback) {
        process.nextTick(() => callback(error, '', error.message));
      }
      return;
    }
  }

  for (const [pattern, result] of execResults) {
    if (command.includes(pattern)) {
      if (callback) {
        process.nextTick(() => callback(null, result.stdout, result.stderr));
      }
      return;
    }
  }

  if (callback) {
    process.nextTick(() => callback(null, defaultResult.stdout, defaultResult.stderr));
  }
});

// ─── Custom promisify for execFile ──────────────────────────────
// Node's real execFile has [util.promisify.custom] that returns { stdout, stderr }.
// Without this, promisify(execFile) only gets the first callback arg (stdout string).
function execFilePromisified(
  file: string,
  args?: string[],
  _options?: Record<string, unknown>
): Promise<{ stdout: string; stderr: string }> {
  const command = `${file} ${(args ?? []).join(' ')}`;

  return new Promise((resolve, reject) => {
    for (const [pattern, error] of execErrors) {
      if (command.includes(pattern)) {
        process.nextTick(() => reject(error));
        return;
      }
    }

    for (const [pattern, result] of execResults) {
      if (command.includes(pattern)) {
        process.nextTick(() => resolve({ stdout: result.stdout, stderr: result.stderr }));
        return;
      }
    }

    process.nextTick(() => resolve({ stdout: defaultResult.stdout, stderr: defaultResult.stderr }));
  });
}

// Attach the custom promisify symbol so promisify(execFile) returns { stdout, stderr }
Object.defineProperty(execFile, promisify.custom, {
  value: execFilePromisified,
  configurable: true
});

// ─── Test Helpers ────────────────────────────────────────────────

/** Configure a successful result for commands containing the given pattern */
export function setExecResult(commandPattern: string, stdout: string, stderr = ''): void {
  execResults.set(commandPattern, { stdout, stderr });
}

/** Configure a failure for commands containing the given pattern */
export function setExecError(commandPattern: string, error: Error): void {
  execErrors.set(commandPattern, error);
}

/** Set the default result for commands that don't match any pattern */
export function setDefaultExecResult(stdout: string, stderr = ''): void {
  defaultResult = { stdout, stderr };
}

/** Reset all configured results and errors */
export function resetExecMocks(): void {
  execResults.clear();
  execErrors.clear();
  defaultResult = { stdout: '', stderr: '' };
  exec.mockClear();
  execFile.mockClear();
}
