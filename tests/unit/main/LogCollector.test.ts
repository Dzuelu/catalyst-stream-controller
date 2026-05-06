import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LogCollector } from '../../../src/main/logging/LogCollector';
import { BrowserWindow } from 'electron';

describe('LogCollector', () => {
  let collector: LogCollector;
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;

  beforeEach(() => {
    // Save console originals before LogCollector intercepts them
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;

    collector = new LogCollector();
  });

  afterEach(() => {
    collector.destroy();
    // Restore originals just in case destroy didn't work
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  });

  // ─── Capture ──────────────────────────────────────────────

  describe('capture', () => {
    it('should capture console.log as info level', () => {
      console.log('test message');

      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('info');
      expect(entries[0].message).toContain('test message');
    });

    it('should capture console.warn as warn level', () => {
      console.warn('warning message');

      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('warn');
      expect(entries[0].message).toContain('warning message');
    });

    it('should capture console.error as error level', () => {
      console.error('error message');

      const entries = collector.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
      expect(entries[0].message).toContain('error message');
    });

    it('should extract source tag from bracketed prefix', () => {
      console.log('[Main] starting up');

      const entries = collector.getEntries();
      expect(entries[0].source).toBe('Main');
    });

    it('should handle multiple arguments', () => {
      console.log('count:', 42, { key: 'value' });

      const entries = collector.getEntries();
      expect(entries[0].message).toContain('count:');
      expect(entries[0].message).toContain('42');
      expect(entries[0].message).toContain('"key"');
    });

    it('should handle Error objects in arguments', () => {
      const err = new Error('something broke');
      console.error('oops', err);

      const entries = collector.getEntries();
      expect(entries[0].message).toContain('something broke');
    });

    it('should assign unique incrementing IDs', () => {
      console.log('first');
      console.log('second');
      console.log('third');

      const entries = collector.getEntries();
      expect(entries[0].id).toBeLessThan(entries[1].id);
      expect(entries[1].id).toBeLessThan(entries[2].id);
    });

    it('should include ISO timestamps', () => {
      console.log('timestamped');
      const entries = collector.getEntries();
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ─── Ring Buffer ──────────────────────────────────────────

  describe('ring buffer', () => {
    it('should cap entries at MAX_ENTRIES (2000)', () => {
      for (let i = 0; i < 2050; i++) {
        console.log(`message-${i}`);
      }

      const entries = collector.getEntries();
      expect(entries.length).toBe(2000);
      // Oldest entries should be dropped
      expect(entries[0].message).toContain('message-50');
      expect(entries[entries.length - 1].message).toContain('message-2049');
    });
  });

  // ─── Clear ────────────────────────────────────────────────

  describe('clear', () => {
    it('should remove all entries', () => {
      console.log('one');
      console.log('two');
      expect(collector.getEntries()).toHaveLength(2);

      collector.clear();
      expect(collector.getEntries()).toHaveLength(0);
    });
  });

  // ─── Broadcast ────────────────────────────────────────────

  describe('broadcast', () => {
    it('should broadcast to all open BrowserWindows', () => {
      const mockWebContents = { send: vi.fn() };
      const mockWindow = { isDestroyed: () => false, webContents: mockWebContents };
      (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([mockWindow]);

      console.log('[Test] broadcast check');

      expect(mockWebContents.send).toHaveBeenCalledTimes(1);
      expect(mockWebContents.send).toHaveBeenCalledWith(
        'log:new-entry',
        expect.objectContaining({
          level: 'info',
          message: expect.stringContaining('broadcast check')
        })
      );
    });

    it('should skip destroyed windows', () => {
      const mockWebContents = { send: vi.fn() };
      const destroyedWindow = { isDestroyed: () => true, webContents: mockWebContents };
      (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([destroyedWindow]);

      console.log('should not broadcast');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });
  });

  // ─── Destroy ──────────────────────────────────────────────

  describe('destroy', () => {
    it('should restore original console methods', () => {
      const interceptedLog = console.log;
      collector.destroy();

      // After destroy, console.log should no longer be the intercepted version
      expect(console.log).not.toBe(interceptedLog);
    });
  });

  // ─── Immutability ─────────────────────────────────────────

  describe('getEntries returns a copy', () => {
    it('should not allow external mutation of internal state', () => {
      console.log('test');
      const entries = collector.getEntries();
      entries.length = 0;

      // Internal state should be unaffected
      expect(collector.getEntries()).toHaveLength(1);
    });
  });
});
