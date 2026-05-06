import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ForegroundAppInfo, AppProfileRule, AppSwitchSettings } from '../../shared/app-switch-types';

const execFileAsync = promisify(execFile);

type DetectorFn = () => Promise<ForegroundAppInfo | null>;

/**
 * Monitors the foreground application and triggers profile switches
 * based on user-configured app→profile rules.
 *
 * Uses a cascading detection strategy:
 *  - macOS:  NSWorkspace via osascript
 *  - Linux/Wayland: hyprctl → swaymsg → KDE D-Bus → GNOME D-Bus
 *  - Linux/X11: xdotool + xprop
 *  - Windows: PowerShell Get-Process
 */
export class ForegroundAppMonitor {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private settings: AppSwitchSettings;
  private lastAppName = '';
  private lastProfileId = '';
  private detector: DetectorFn | null = null;
  private onProfileSwitch: ((profileId: string) => void) | null = null;
  private onAppChanged: ((app: ForegroundAppInfo) => void) | null = null;
  private currentApp: ForegroundAppInfo | null = null;
  private manualOverrideUntilChange = false;

  constructor() {
    this.settings = {
      enabled: false,
      defaultProfileId: '',
      rules: [],
      pollIntervalMs: 500
    };
  }

  /** Set the callback for when a profile switch should happen */
  setOnProfileSwitch(handler: (profileId: string) => void): void {
    this.onProfileSwitch = handler;
  }

  /** Set the callback for when the foreground app changes */
  setOnAppChanged(handler: (app: ForegroundAppInfo) => void): void {
    this.onAppChanged = handler;
  }

  /** Get the current foreground app via a live detection */
  async getCurrentApp(): Promise<ForegroundAppInfo | null> {
    // Use the active detector if the monitor is running, otherwise resolve one temporarily
    const detector = this.detector ?? (await this.resolveDetector());
    if (detector) {
      try {
        this.currentApp = await detector();
      } catch {
        // ignore — return last cached result
      }
    }
    return this.currentApp;
  }

  /** Signal that the user manually switched profiles — pause auto-switching until the app changes */
  notifyManualSwitch(): void {
    this.manualOverrideUntilChange = true;
  }

  /** Update settings and restart polling if needed */
  async updateSettings(settings: AppSwitchSettings): Promise<void> {
    const wasRunning = this.pollTimer !== null;
    this.stop();
    this.settings = { ...settings };

    if (settings.enabled && wasRunning) {
      await this.start();
    } else if (settings.enabled) {
      await this.start();
    }
  }

  /** Start polling for the foreground app */
  async start(): Promise<void> {
    if (this.pollTimer) return;
    if (!this.settings.enabled) return;

    // Detect the right strategy for this platform
    this.detector = await this.resolveDetector();
    if (!this.detector) {
      console.warn('[AppMonitor] No suitable foreground app detector found for this platform');
      return;
    }

    console.log('[AppMonitor] Starting foreground app monitoring');
    this.poll(); // Initial poll immediately
    this.pollTimer = setInterval(() => this.poll(), this.settings.pollIntervalMs);
  }

  /** Stop polling */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('[AppMonitor] Stopped foreground app monitoring');
    }
  }

  /** Clean up */
  destroy(): void {
    this.stop();
    this.onProfileSwitch = null;
    this.onAppChanged = null;
  }

  // ─── Polling ────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.detector) return;

    try {
      const app = await this.detector();
      if (!app) return;

      this.currentApp = app;

      // Check if the foreground app changed
      const appKey = app.bundleId || app.name;
      if (appKey === this.lastAppName) return;

      this.lastAppName = appKey;
      this.manualOverrideUntilChange = false; // App changed — clear manual override

      this.onAppChanged?.(app);

      // Find matching rule
      const matchedRule = this.findMatchingRule(app);
      const targetProfileId = matchedRule?.profileId || this.settings.defaultProfileId;

      if (!targetProfileId || targetProfileId === this.lastProfileId) return;
      if (this.manualOverrideUntilChange) return;

      this.lastProfileId = targetProfileId;
      console.log(
        `[AppMonitor] App changed to "${app.name}" → switching to profile "${targetProfileId}"${matchedRule ? ` (rule: ${matchedRule.appName})` : ' (default)'}`
      );
      this.onProfileSwitch?.(targetProfileId);
    } catch (_error) {
      // Silently ignore polling errors — the app might have briefly disappeared
    }
  }

  /** Find the first matching rule for a foreground app */
  private findMatchingRule(app: ForegroundAppInfo): AppProfileRule | null {
    for (const rule of this.settings.rules) {
      // 1. Bundle ID match (most reliable, macOS)
      if (rule.bundleId && app.bundleId && rule.bundleId.toLowerCase() === app.bundleId.toLowerCase()) {
        return rule;
      }

      // 2. App name match (case-insensitive)
      if (rule.appName && app.name.toLowerCase() === rule.appName.toLowerCase()) {
        return rule;
      }

      // 3. App path match (prefix)
      if (rule.appPath && app.path && app.path.toLowerCase().startsWith(rule.appPath.toLowerCase())) {
        return rule;
      }
    }
    return null;
  }

  // ─── Platform Detection ─────────────────────────────────────

  /** Determine the best detector for the current platform */
  private async resolveDetector(): Promise<DetectorFn | null> {
    if (process.platform === 'darwin') {
      return () => this.detectMacOS();
    }

    if (process.platform === 'win32') {
      return () => this.detectWindows();
    }

    if (process.platform === 'linux') {
      return this.resolveLinuxDetector();
    }

    return null;
  }

  /** Determine the best Linux detector (bundled script, then X11 fallback) */
  private async resolveLinuxDetector(): Promise<DetectorFn | null> {
    // Resolve the bundled active-window script path
    // In packaged app: <resources>/active-window
    // In development: build/linux/scripts/active-window
    const scriptPath = this.resolveActiveWindowScript();
    if (scriptPath) {
      console.log(`[AppMonitor] Using Linux detector (active-window script at ${scriptPath})`);
      return () => this.detectLinuxScript(scriptPath);
    }

    console.warn('[AppMonitor] active-window script not found; no Linux detector available');
    return null;
  }

  /** Resolve the path to the bundled active-window script */
  private resolveActiveWindowScript(): string | null {
    // Packaged app: process.resourcesPath is set by Electron
    if (process.resourcesPath) {
      const packaged = path.join(process.resourcesPath, 'active-window');
      if (existsSync(packaged)) return packaged;
    }

    // Development: relative to project root
    const dev = path.resolve(__dirname, '../../build/linux/scripts/active-window');
    if (existsSync(dev)) return dev;

    return null;
  }

  // ─── Linux Script Detector ─────────────────────────────────

  private async detectLinuxScript(scriptPath: string): Promise<ForegroundAppInfo | null> {
    try {
      const { stdout } = await execFileAsync(scriptPath, [], { timeout: 2000 });
      const data = JSON.parse(stdout.trim());
      if (!data.name) return null;

      return {
        name: data.name,
        pid: data.pid || undefined,
        detectionMethod: 'script'
      };
    } catch {
      return null;
    }
  }

  // ─── macOS Detector ─────────────────────────────────────────

  private async detectMacOS(): Promise<ForegroundAppInfo | null> {
    // Uses osascript to get frontmost app info — no permissions needed
    const script = `
      tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set bundleId to bundle identifier of frontApp
        set appPID to unix id of frontApp
        try
          set appFile to POSIX path of (file of frontApp)
        on error
          set appFile to ""
        end try
        return appName & "\\n" & bundleId & "\\n" & appFile & "\\n" & appPID
      end tell
    `;

    try {
      const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 2000 });
      const lines = stdout.trim().split('\n');
      if (lines.length < 4) return null;
      console.log(`[AppMonitor] Using macOS detector (osascript)\nFound: ${lines}}`);

      return {
        name: lines[0],
        bundleId: lines[1] || undefined,
        path: lines[2] || undefined,
        pid: parseInt(lines[3], 10) || undefined,
        detectionMethod: 'macos'
      };
    } catch (err) {
      console.warn('[AppMonitor] macOS detection error:', (err as Error).message);
      return null;
    }
  }

  // ─── Windows Detector ──────────────────────────────────────

  private async detectWindows(): Promise<ForegroundAppInfo | null> {
    try {
      const script = `
        Add-Type @"
          using System;
          using System.Runtime.InteropServices;
          public class FGWindow {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
          }
"@
        $hwnd = [FGWindow]::GetForegroundWindow()
        $pid = 0
        [FGWindow]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
          Write-Output $proc.ProcessName
          Write-Output $proc.Id
          Write-Output $proc.Path
        }
      `;

      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        timeout: 3000
      });
      const lines = stdout.trim().split(/\r?\n/);
      if (lines.length < 1 || !lines[0]) return null;
      console.log(`[AppMonitor] Using Windows detector (PowerShell)\nFound: ${lines}`);

      return {
        name: lines[0],
        pid: parseInt(lines[1], 10) || undefined,
        path: lines[2] || undefined,
        detectionMethod: 'windows'
      };
    } catch {
      return null;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────
}
