import { BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/types';
import type { LogEntry } from '../../shared/log-types';

const MAX_ENTRIES = 2000;

/**
 * Captures console.log / warn / error output from the main process,
 * stores entries in a ring buffer, and broadcasts new entries to the renderer.
 *
 * Must be instantiated early — before other subsystems start logging.
 */
export class LogCollector {
  private entries: LogEntry[] = [];
  private nextId = 1;
  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;

  constructor() {
    // Capture the originals so we still output to the terminal
    this.originalLog = console.log.bind(console);
    this.originalWarn = console.warn.bind(console);
    this.originalError = console.error.bind(console);

    this.intercept();
  }

  /** Get all stored log entries */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /** Clear all stored entries */
  clear(): void {
    this.entries = [];
  }

  /** Stop intercepting console methods and restore originals */
  destroy(): void {
    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
  }

  // ─── Internal ─────────────────────────────────────────────

  /** HH:MM:SS.mmm timestamp for terminal output */
  private timestamp(): string {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  }

  private intercept(): void {
    console.log = (...args: unknown[]) => {
      this.originalLog(`[${this.timestamp()}]`, ...args);
      this.capture('info', args);
    };

    console.warn = (...args: unknown[]) => {
      this.originalWarn(`[${this.timestamp()}]`, ...args);
      this.capture('warn', args);
    };

    console.error = (...args: unknown[]) => {
      this.originalError(`[${this.timestamp()}]`, ...args);
      this.capture('error', args);
    };
  }

  private capture(level: LogEntry['level'], args: unknown[]): void {
    const message = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');

    // Extract a source tag like "[Main]" or "[AppMonitor]" from the message
    const sourceMatch = message.match(/^\[([^\]]+)\]/);
    const source = sourceMatch?.[1] ?? '';

    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level,
      source,
      message
    };

    this.entries.push(entry);

    // Ring buffer — drop oldest entries
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    // Broadcast to all open windows
    this.broadcast(entry);
  }

  private broadcast(entry: LogEntry): void {
    try {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.LOG_NEW_ENTRY, entry);
        }
      }
    } catch {
      // Ignore — windows may not be ready yet
    }
  }
}
