import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForegroundAppMonitor } from '../../../src/main/integrations/ForegroundAppMonitor';
import { setExecResult, resetExecMocks } from '../../mocks/child_process';
import type { AppSwitchSettings } from '../../../src/shared/app-switch-types';

describe('ForegroundAppMonitor', () => {
  let monitor: ForegroundAppMonitor;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    resetExecMocks();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    // Default to macOS for tests
    Object.defineProperty(process, 'platform', { value: 'darwin', writable: true, configurable: true });
    monitor = new ForegroundAppMonitor();
  });

  afterEach(() => {
    monitor.destroy();
    vi.useRealTimers();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  const SETTINGS: AppSwitchSettings = {
    enabled: true,
    defaultProfileId: 'default-profile',
    rules: [
      { id: 'rule-1', appName: 'Firefox', profileId: 'browser-profile' },
      { id: 'rule-2', appName: 'OBS Studio', profileId: 'streaming-profile' },
      { id: 'rule-3', appName: 'Music', bundleId: 'com.apple.music', profileId: 'music-profile' }
    ],
    pollIntervalMs: 500
  };

  // ─── Start / Stop ─────────────────────────────────────────

  describe('start/stop', () => {
    it('should not start when settings.enabled is false', async () => {
      await monitor.updateSettings({ ...SETTINGS, enabled: false });
      // No polling should happen
      const spy = vi.fn();
      monitor.setOnAppChanged(spy);
      await vi.advanceTimersByTimeAsync(2000);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should start polling when enabled', async () => {
      // Mock macOS detector response
      setExecResult('osascript', 'Firefox\norg.mozilla.firefox\n/Applications/Firefox.app\n12345');

      const appChangedSpy = vi.fn();
      monitor.setOnAppChanged(appChangedSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);

      expect(appChangedSpy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Firefox' }));
    });

    it('should stop polling on destroy', async () => {
      setExecResult('osascript', 'Firefox\norg.mozilla.firefox\n\n12345');

      const spy = vi.fn();
      monitor.setOnAppChanged(spy);

      await monitor.updateSettings(SETTINGS);
      // Let the initial poll complete
      await vi.advanceTimersByTimeAsync(100);
      expect(spy).toHaveBeenCalledTimes(1);

      monitor.destroy();
      spy.mockClear();

      // Advance more time — no further calls should fire
      await vi.advanceTimersByTimeAsync(2000);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ─── Rule Matching ────────────────────────────────────────

  describe('rule matching', () => {
    it('should switch profile when foreground app matches a rule by name', async () => {
      setExecResult('osascript', 'Firefox\norg.mozilla.firefox\n/Applications/Firefox.app\n12345');

      const profileSpy = vi.fn();
      monitor.setOnProfileSwitch(profileSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);

      expect(profileSpy).toHaveBeenCalledWith('browser-profile');
    });

    it('should switch profile when foreground app matches a rule by bundleId', async () => {
      setExecResult('osascript', 'Music\ncom.apple.music\n/System/Applications/Music.app\n99');

      const profileSpy = vi.fn();
      monitor.setOnProfileSwitch(profileSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);

      expect(profileSpy).toHaveBeenCalledWith('music-profile');
    });

    it('should fall back to default profile when no rule matches', async () => {
      setExecResult('osascript', 'Calculator\ncom.apple.calculator\n\n55');

      const profileSpy = vi.fn();
      monitor.setOnProfileSwitch(profileSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);

      expect(profileSpy).toHaveBeenCalledWith('default-profile');
    });

    it('should not re-trigger when the same app stays in focus', async () => {
      setExecResult('osascript', 'Firefox\norg.mozilla.firefox\n\n12345');

      const profileSpy = vi.fn();
      monitor.setOnProfileSwitch(profileSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);
      expect(profileSpy).toHaveBeenCalledTimes(1);

      // Advance more time — same app should not trigger again
      await vi.advanceTimersByTimeAsync(2000);
      expect(profileSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Manual Override ──────────────────────────────────────

  describe('manual override', () => {
    it('should pause auto-switching after manual switch until app changes', async () => {
      setExecResult('osascript', 'Firefox\norg.mozilla.firefox\n\n12345');

      const profileSpy = vi.fn();
      monitor.setOnProfileSwitch(profileSpy);

      await monitor.updateSettings(SETTINGS);
      await vi.advanceTimersByTimeAsync(100);
      expect(profileSpy).toHaveBeenCalledTimes(1);

      // User manually switches profile
      monitor.notifyManualSwitch();
      profileSpy.mockClear();

      // App changes — manual override should be cleared and profile switch fires
      resetExecMocks();
      setExecResult('osascript', 'OBS Studio\ncom.obsproject.obs-studio\n\n99');

      await vi.advanceTimersByTimeAsync(600);
      expect(profileSpy).toHaveBeenCalledWith('streaming-profile');
    });
  });

  // ─── getCurrentApp ────────────────────────────────────────

  describe('getCurrentApp', () => {
    it('should return the current foreground app', async () => {
      setExecResult('osascript', 'Finder\ncom.apple.finder\n/System/Library/CoreServices/Finder.app\n1');

      const app = await monitor.getCurrentApp();
      expect(app).not.toBeNull();
      expect(app!.name).toBe('Finder');
      expect(app!.bundleId).toBe('com.apple.finder');
    });

    it('should return null when detection fails', async () => {
      resetExecMocks();
      setExecResult('osascript', ''); // Empty output → null

      const app = await monitor.getCurrentApp();
      expect(app).toBeNull();
    });
  });
});
