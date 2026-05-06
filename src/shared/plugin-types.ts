/**
 * Plugin System Type Definitions
 *
 * Shared types used by both the main process (PluginRegistry, PluginClient)
 * and the renderer process (ActionPanel, PluginActionPanel).
 */

import type { BuiltinActionType, Layer, LayerBase } from './types';

// ─── Plugin Manifest ────────────────────────────────────────────

/** Every plugin must export an object satisfying this interface. */
export interface PluginManifest {
  /** Unique plugin identifier (e.g. 'obs', 'discord', 'twitch') */
  id: string;

  /** Human-readable name shown in the UI (e.g. 'OBS Studio') */
  name: string;

  /** Short description for a future plugin settings page */
  description?: string;

  /** Semantic version string */
  version: string;

  /** ── Action Definitions ──────────────────────────────── */

  /** All actions this plugin exposes, keyed by action ID.
   *
   *  Each entry bundles the human-readable label and the parameter
   *  field definitions that the action accepts.  Example:
   *  ```ts
   *  actions: {
   *    'switch-scene': {
   *      label: 'Switch Scene',
   *      params: {
   *        sceneName: { key: 'sceneName', label: 'Scene', type: 'select',
   *                     dynamicOptionsQuery: 'getScenes' }
   *      }
   *    },
   *    'toggle-stream': { label: 'Toggle Stream' }
   *  }
   *  ``` */
  actions: Record<string, ActionDefinition>;

  /** ── Connection ──────────────────────────────────────── */

  /** Connection configuration — default settings and UI field defs.
   *  Omit entirely for plugins that don't need external connections
   *  (e.g. utility / benchmark plugins). When omitted the connection
   *  settings card is hidden in the UI and `connect()` receives `{}`. */
  connection?: {
    /** Default connection settings (used on first run) */
    defaults: Record<string, unknown>;
    /** Field definitions for the connection settings UI */
    fields: ParamFieldDef[];
  };

  /** ── State ───────────────────────────────────────────── */

  /** Plugin state configuration.
   *  Omit for plugins that carry no observable state. When omitted
   *  the live-status panel is hidden and `getState()` returns `{}`. */
  state?: {
    /** Default state snapshot (used before first connect) */
    defaults: Record<string, unknown>;
    /** Optional: which state fields to show in the live status panel
     *  when this plugin's action type is selected. */
    display?: StateDisplayField[];
  };

  /** ── Custom Icons ────────────────────────────────────── */

  /** Plugin icon packs — allows plugins to register custom icons that
   *  appear in the icon picker and can be used in action `defaultAppearance`.
   *
   *  Each entry defines a "pack" (tab in the icon picker). If the `label`
   *  matches an existing built-in tab (e.g. `'Media'`), the icons are
   *  appended to that tab. Otherwise a new tab is created.
   *
   *  Icon IDs **must** be namespaced as `plugin:{pluginId}:{name}` to
   *  prevent collisions. Icons that don't match the owning plugin's
   *  namespace are silently dropped at load time.  Example:
   *  ```ts
   *  iconPacks: [{
   *    label: 'Streaming',
   *    icons: [
   *      { id: 'plugin:obs:broadcast', label: 'Go Live', svg: '<svg ...>' }
   *    ]
   *  }]
   *  ```
   *  Reference them in action `defaultAppearance` via `iconRef('plugin:obs:broadcast')`.
   *
   *  SVG strings should use a 96×96 viewBox with white strokes on transparent
   *  background, matching the built-in icon conventions. */
  iconPacks?: PluginIconPack[];
}

/** Defines a single action a plugin exposes */
export interface ActionDefinition {
  /** Human-readable label shown in action dropdowns */
  label: string;
  /** Parameter field definitions this action accepts, keyed by param name.
   *  Omit or leave empty for actions with no parameters. */
  params?: Record<string, ParamFieldDef>;
  /** Default button appearance applied when this action is first assigned.
   *  Each layer only needs its `type` plus non-default fields. Omitted
   *  fields fall back to type-specific defaults. */
  defaultAppearance?: {
    layers: Array<Partial<Layer> & Pick<LayerBase, 'type'>>;
  };
}

/** A plugin-defined icon pack (tab in the icon picker) */
export interface PluginIconPack {
  /** Display label for the tab. If the label matches an existing built-in
   *  or plugin-created tab, icons are appended to that tab instead of
   *  creating a new one. */
  label: string;
  /** Icons to register in this pack. */
  icons: PluginIconDefinition[];
}

/** A single icon defined by a plugin */
export interface PluginIconDefinition {
  /** Namespaced icon ID: `plugin:{pluginId}:{name}` (e.g. `'plugin:obs:broadcast'`) */
  id: string;
  /** Human-readable label shown in the icon picker */
  label: string;
  /** Raw SVG markup (96×96 viewBox recommended, white strokes on transparent) */
  svg: string;
}

// ─── Field Definitions ──────────────────────────────────────────

/** Describes a single form field for auto-generated UI */
export interface ParamFieldDef {
  /** Unique key — matches the key in actionConfig / connectionSettings */
  key: string;
  /** Human-readable label */
  label: string;
  /** Field type determines which input widget is rendered */
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'range' | 'image';
  /** Placeholder text (for text/password) */
  placeholder?: string;
  /** For 'select': static options */
  options?: Array<{ value: string | number | boolean; label: string }>;
  /** For 'select': name of a query method on the client that returns
   *  dynamic options (e.g. 'getScenes'). Overrides static options when
   *  the plugin is connected. */
  dynamicOptionsQuery?: string;
  /** For 'range'/'number': constraints */
  min?: number;
  max?: number;
  step?: number;
  /** For 'range': suffix shown after the value (e.g. '%', 'ms') */
  suffix?: string;
  /** For 'image': accepted MIME types (default: 'image/*') */
  accept?: string;
  /** Help text shown below the field */
  helpText?: string;
}

/** Describes a state field to show in the live status panel */
export interface StateDisplayField {
  key: string;
  label: string;
  /** Optional emoji/icon prefix */
  icon?: string;
  /** Format function name: 'boolean-on-off', 'percent', 'text' */
  format?: string;
}

// ─── Plugin Host API ────────────────────────────────────────────

/** Capabilities the host app exposes to plugins. */
export interface PluginHostAPI {
  // ─── Device Capabilities ───────────────────────────────
  /** Set device brightness (0–1). If no serial, applies to all devices. */
  setBrightness(value: number, deviceSerial?: string): Promise<void>;

  /** Set a plugin image on a button this plugin owns.
   *
   *  Validation (all must pass):
   *  1. The button at keyIndex must have `pluginImage.enabled === true`
   *     in its appearance settings (user opted in via the appearance editor).
   *  2. At least one trigger (press, longPress, doubleTap, down, up) on the
   *     button must have `type === 'plugin:{thisPluginId}'`.
   *
   *  If validation fails, the call throws with a descriptive error.
   *  imageDataUri is a base64 data URI (e.g. 'data:image/png;base64,...').
   *  If no serial, applies to the first connected device. */
  setButtonImage(keyIndex: number, imageDataUri: string, deviceSerial?: string): Promise<void>;

  /** Clear the plugin image for a key, reverting to the user's configured
   *  appearance only. */
  clearButtonImage(keyIndex: number, deviceSerial?: string): Promise<void>;

  /** Get info about all currently connected devices. */
  getDevices(): Array<{
    serial: string;
    name: string;
    rows: number;
    cols: number;
    keyCount: number;
    hasKnobs: boolean;
  }>;

  // ─── Action Execution ──────────────────────────────────
  /** Execute any built-in action type. Supports all types: hotkey, launch,
   *  command, multimedia, set-brightness, go-to-page, go-to-back,
   *  switch-profile, multi-action, none. */
  executeAction(type: BuiltinActionType, config: Record<string, unknown>): Promise<void>;

  /** Execute an action on another plugin. Requires the target plugin to
   *  be registered and connected. Throws if the target plugin is not
   *  available. */
  executePluginAction(pluginId: string, config: Record<string, unknown>): Promise<void>;

  // ─── Plugin Discovery ──────────────────────────────────
  /** Check if a plugin is registered and get its info. Returns null if
   *  the plugin is not installed. */
  getPluginInfo(pluginId: string): {
    id: string;
    name: string;
    version: string;
    connected: boolean;
  } | null;

  /** Get a list of all registered plugin IDs. */
  getRegisteredPlugins(): string[];

  // ─── Device Events ─────────────────────────────────────
  /** Subscribe to raw button-down events from the device. Returns an
   *  unsubscribe function. */
  onButtonDown(callback: (keyIndex: number, deviceSerial: string) => void): () => void;

  /** Subscribe to raw button-up events from the device. */
  onButtonUp(callback: (keyIndex: number, deviceSerial: string) => void): () => void;

  /** Subscribe to knob rotation events. direction is 'cw' or 'ccw'. */
  onKnobRotate(callback: (knobId: string, direction: 'cw' | 'ccw', deviceSerial: string) => void): () => void;

  /** Subscribe to knob press events. */
  onKnobPress(callback: (knobId: string, deviceSerial: string) => void): () => void;

  // ─── Lifecycle Events ──────────────────────────────────
  /** Called when the active profile changes. */
  onProfileChanged(callback: (profileId: string) => void): () => void;

  /** Called when the user navigates to a different page. */
  onPageChanged(callback: (pageId: string) => void): () => void;

  /** Called when a device connects. */
  onDeviceConnected(callback: (serial: string, name: string) => void): () => void;

  /** Called when a device disconnects. */
  onDeviceDisconnected(callback: (serial: string) => void): () => void;

  /** Called when the system wakes up from sleep/suspend.
   *  Useful for plugins that maintain persistent connections (e.g. websockets)
   *  which may have been dropped during sleep. */
  onSystemWakeUp(callback: () => void): () => void;

  // ─── Visual Feedback ───────────────────────────────────
  /** Show a brief visual feedback overlay on a key.
   *  'ok' displays a green checkmark, 'alert' displays a yellow warning icon.
   *  The overlay fades automatically after `durationMs` (default 1000ms).
   *  Useful for confirming that an action succeeded or indicating an error. */
  showFeedback(keyIndex: number, feedbackType: 'ok' | 'alert', durationMs?: number): void;

  // ─── Logging ───────────────────────────────────────────
  /** Log a message that appears in the app's log panel. The source
   *  will automatically be prefixed with the plugin name. */
  log(level: 'info' | 'warn' | 'error', message: string): void;

  // ─── Settings (own) ────────────────────────────────────
  /** Read the plugin's own persisted settings. */
  getOwnSettings(): Record<string, unknown>;

  /** Save the plugin's own settings to disk. */
  saveOwnSettings(settings: Record<string, unknown>): Promise<void>;
  // ─── Image Generation ──────────────────────────────────
  /** Helper utilities for generating device-compatible images
   *  (`data:image/png;base64,...`).  Plugin authors should use these
   *  instead of hand-crafting image data URIs — the format is guaranteed
   *  to be accepted by `setButtonImage()`. */
  createImage: {
    /** Solid-colour image with an optional centred text label. */
    solidColor(color: string, text?: string): string;
    /** Text on a coloured background with full control over styling. */
    textImage(options: {
      text: string;
      textColor?: string;
      bgColor?: string;
      fontSize?: number;
      bold?: boolean;
    }): string;
  };
}

// ─── Plugin Client ──────────────────────────────────────────────

/** The main-process side of a plugin. */
export interface PluginClient {
  /** Connect to the external service */
  connect(settings: Record<string, unknown>): Promise<void>;

  /** Disconnect gracefully */
  disconnect(): Promise<void>;

  /** Whether the client is currently connected */
  isConnected(): boolean;

  /** Get a snapshot of the current live state */
  getState(): Record<string, unknown>;

  /** Register a callback for state changes (only one handler, set by core) */
  setOnStateChanged(handler: (state: Record<string, unknown>) => void): void;

  /** Execute an action config from a button press */
  executeAction(config: Record<string, unknown>): Promise<void>;

  /** Clean up all resources (timers, sockets) on app shutdown */
  destroy(): void;

  /** Optional: query methods for dynamic dropdowns.
   *  Keys must match `dynamicOptionsQuery` values in the manifest.
   *  Each returns an array of { value, label } options. */
  queries?: Record<string, () => Promise<Array<{ value: string; label: string }>>>;

  /** Optional: return a dynamic image for a button based on the action
   *  config and current plugin state. Only called if the user has enabled
   *  plugin images on the button (`pluginImage.enabled === true` in the
   *  button's appearance settings).
   *  Return null to skip the plugin image layer for this render. */
  getButtonImage?(actionConfig: Record<string, unknown>): string | null;
}

/** Factory function — receives the host API for calling back into the core. */
export type PluginClientFactory = (hostAPI: PluginHostAPI) => PluginClient;

// ─── Plugin Package Export ──────────────────────────────────────

/** A plugin package re-exports its manifest and client factory. */
export interface PluginPackage {
  manifest: PluginManifest;
  createClient: PluginClientFactory;
}

// ─── Manifest Helpers (re-exported for external plugins) ────────
//
// These utilities are defined in `src/plugins/manifest-helpers.ts` and
// re-exported here so that the future `@catalyst-stream-controller/plugin-types`
// npm package ships them alongside the type definitions. External plugin
// authors can then:
//
//   import { defaultLayers, svg } from '@catalyst-stream-controller/plugin-types';
//
export { defaultLayers, svg } from '../plugins/manifest-helpers';
export type { DefaultAppearance } from '../plugins/manifest-helpers';
