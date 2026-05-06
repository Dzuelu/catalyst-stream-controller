/** A single log entry captured from the main process */
export interface LogEntry {
  /** Unique incrementing id */
  id: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Severity level */
  level: 'info' | 'warn' | 'error';
  /** The source tag extracted from the message (e.g. "AppMonitor", "Main"), if any */
  source: string;
  /** The log message text */
  message: string;
}
