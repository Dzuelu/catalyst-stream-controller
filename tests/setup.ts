import { vi } from 'vitest';

// ── Mock Electron globally for all tests ──────────────────────
// This ensures any `import { ... } from 'electron'` resolves to our mock
// regardless of which module imports it.
vi.mock('electron', () => import('./mocks/electron'));

// ── Mock native modules that can't load in test env ───────────
vi.mock('serialport', () => ({
  SerialPort: class {
    static list = vi.fn(async () => []);
  }
}));
vi.mock('electron-squirrel-startup', () => ({ default: false }));

// ── Mock obs-websocket-js ─────────────────────────────────────
vi.mock('obs-websocket-js', () => import('./mocks/obs-websocket-js'));

// ── Mock ws (WebSocket for Discord RPC) ───────────────────────
vi.mock('ws', () => import('./mocks/ws'));

// ── Mock child_process for command/hotkey/media actions ───────
vi.mock('node:child_process', () => import('./mocks/child_process'));

// ── Mock fs for ProfileManager ────────────────────────────────
vi.mock('node:fs', () => import('./mocks/fs'));
