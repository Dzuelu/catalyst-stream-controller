// ─── Per-Application Profile Switching Types ─────────────────────

/** Info about the currently focused foreground application */
export interface ForegroundAppInfo {
  /** Application name (e.g. "OBS Studio", "Google Chrome") */
  name: string;
  /** macOS bundle ID (e.g. "com.obsproject.obs-studio") — macOS only */
  bundleId?: string;
  /** Full path to the application executable */
  path?: string;
  /** Process ID */
  pid?: number;
  /** Which detection method was used */
  detectionMethod: 'macos' | 'hyprland' | 'sway' | 'kde' | 'gnome' | 'x11' | 'windows' | 'script' | 'unknown';
}

/** A rule mapping a foreground app to a profile */
export interface AppProfileRule {
  id: string;
  /** Display name to match against (case-insensitive) */
  appName: string;
  /** macOS bundle ID for precise matching (optional, takes priority over name) */
  bundleId?: string;
  /** Executable path for matching (optional, fallback) */
  appPath?: string;
  /** The profile ID to activate when this app is focused */
  profileId: string;
}

/** Settings for the per-application profile switching feature */
export interface AppSwitchSettings {
  /** Whether auto-switching is enabled */
  enabled: boolean;
  /** Profile to use when no rule matches (empty string = don't switch) */
  defaultProfileId: string;
  /** Ordered list of app→profile rules */
  rules: AppProfileRule[];
  /** Polling interval in milliseconds (default 500) */
  pollIntervalMs: number;
}

export const DEFAULT_APP_SWITCH_SETTINGS: AppSwitchSettings = {
  enabled: false,
  defaultProfileId: '',
  rules: [],
  pollIntervalMs: 500
};
