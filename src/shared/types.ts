import type { AppSwitchSettings } from './app-switch-types';

// ─── Control Types ──────────────────────────────────────────────

export interface ButtonControl {
  type: 'button';
  index: number;
  row: number;
  col: number;
}

export interface KnobControl {
  type: 'knob';
  /** String ID from the hardware (e.g. 'knobTL', 'knobCR') */
  id: string;
  /** Human-readable label (e.g. 'Top Left') */
  label: string;
  /** Position hint: 'left', 'right', or 'bottom' side of the device */
  side: 'left' | 'right' | 'bottom';
}

export interface SliderControl {
  type: 'slider';
  /** String ID (e.g. 'sliderL', 'sliderR') */
  id: string;
  label: string;
  side: 'left' | 'right';
}

export type Control = ButtonControl | KnobControl | SliderControl;

// ─── Device Types ───────────────────────────────────────────────

/** Pixel insets from each edge of the key canvas to the visible area */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface DeviceInfo {
  id: string;
  name: string;
  serial?: string;
  firmwareVersion?: string;
  rows: number;
  cols: number;
  keySize: number; // pixels (e.g. 96 for RSCX)
  controls: Control[];
  connected: boolean;
  safeAreaInsets: SafeAreaInsets;
}

// ─── Action Types ───────────────────────────────────────────────

/** Built-in action types */
export type BuiltinActionType =
  | 'hotkey'
  | 'launch'
  | 'command'
  | 'multimedia'
  | 'go-to-page'
  | 'go-to-back'
  | 'multi-action'
  | 'switch-profile'
  | 'set-brightness'
  | 'none';

/** Plugin action types are prefixed with 'plugin:' */
export type PluginActionType = `plugin:${string}`;

/** All action types (built-in + plugin) */
export type ActionType = BuiltinActionType | PluginActionType;

/** Trigger type for button interactions.
 *  - 'press' / 'longPress' / 'doubleTap': semantic triggers from the state machine
 *  - 'down' / 'up': immediate physical triggers (for hold-for-action patterns) */
export type TriggerType = 'press' | 'longPress' | 'doubleTap' | 'down' | 'up';

/** All trigger types — use when iterating over all possible triggers in a binding */
export const ALL_TRIGGER_TYPES: readonly TriggerType[] = ['press', 'longPress', 'doubleTap', 'down', 'up'] as const;

export interface ActionConfig {
  id: string;
  type: ActionType;
  label: string;
  icon?: string; // path or data URI for the button icon
  config: Record<string, unknown>; // type-specific config
}

export interface KeystrokeStep {
  key: string;
  modifiers: string[]; // ['ctrl', 'shift', etc.]
}

export interface HotkeyConfig {
  steps: KeystrokeStep[];
}

export interface LaunchConfig {
  path: string; // path to executable
  args?: string[];
}

export interface CommandConfig {
  command: string; // shell command to execute
}

export interface MultimediaConfig {
  action: 'play-pause' | 'next' | 'prev' | 'volume-up' | 'volume-down' | 'mute';
}

export interface GoToPageConfig {
  pageId: string; // target page ID within the same profile
}

/** A single step within a multi-action sequence */
export interface MultiActionStep {
  action: ActionConfig;
  /** Delay in milliseconds to wait AFTER this step completes (default 0) */
  delayMs?: number;
}

/** Config for the multi-action type: executes a sequence of sub-actions */
export interface MultiActionConfig {
  steps: MultiActionStep[];
}

export interface SwitchProfileConfig {
  profileId: string; // target profile ID to switch to
}

export interface SetBrightnessConfig {
  brightness: number; // 0-100 percentage
}

// ─── Button Binding ─────────────────────────────────────────

/** A button binding maps trigger types to actions.
 *  - `press`: fires on normal tap (default)
 *  - `longPress`: fires after holding 500ms
 *  - `doubleTap`: fires on two rapid taps within 300ms
 *  - `down`: fires immediately on physical button-down (zero latency)
 *  - `up`: fires immediately on physical button-up (zero latency)
 *
 *  If only `press` is used this behaves like a simple single-action button.
 *  When `doubleTap` is configured, the press action is slightly delayed to
 *  allow the double-tap window to elapse first.
 *
 *  `down` and `up` are independent of the press/longPress/doubleTap state machine.
 *  They always fire on the physical event. Use for hold-for-action patterns
 *  like push-to-talk (down=activate, up=deactivate).
 */
export interface ButtonBinding {
  press?: ActionConfig;
  longPress?: ActionConfig;
  doubleTap?: ActionConfig;
  /** Fires immediately on physical button-down. Not subject to detection delays. */
  down?: ActionConfig;
  /** Fires immediately on physical button-up. Not subject to detection delays. */
  up?: ActionConfig;
  /** Visual appearance for this button (background, label, icon).
   *  Stored at the binding level — shared across all triggers. */
  appearance?: ButtonAppearance;
}

// ─── Knob Binding ───────────────────────────────────────────

/** A knob binding maps rotation directions and press to actions.
 *  - `rotateClockwise`: fires on each clockwise click
 *  - `rotateCounterClockwise`: fires on each counter-clockwise click
 *  - `press`: fires when the knob is pressed (clicked down)
 */
export interface KnobBinding {
  rotateClockwise?: ActionConfig;
  rotateCounterClockwise?: ActionConfig;
  press?: ActionConfig;
}

/** Trigger type for knob interactions */
export type KnobTriggerType = 'rotateClockwise' | 'rotateCounterClockwise' | 'press';

// ─── Button Appearance ──────────────────────────────────────────

/** Position anchor for label text or images within the key canvas */
export type PositionAnchorV = 'top' | 'center' | 'bottom';
export type PositionAnchorH = 'left' | 'center' | 'right';

/** How an image should be fitted within the key canvas */
export type ImageFit = 'contain' | 'cover' | 'stretch' | 'none';

// ─── Layer Types ─────────────────────────────────────────────────

/** Discriminator for the layer union */
export type LayerType = 'fill' | 'image' | 'text' | 'plugin';

/** Common properties shared by all layer types */
export interface LayerBase {
  /** Stable unique identifier for reordering / editing */
  id: string;
  /** Discriminator for the layer union */
  type: LayerType;
  /** User-editable label (e.g. "Background", "Logo", "Title") */
  name: string;
  /** Whether this layer is rendered. Toggle without deleting. */
  visible: boolean;
  /** Opacity 0–1 (default 1). Applied as globalAlpha during rendering. */
  opacity: number;
  /** When true, prevents accidental edits in the UI */
  locked: boolean;
}

/** Solid colour fill layer */
export interface FillLayer extends LayerBase {
  type: 'fill';
  /** CSS hex colour (e.g. '#1a1a2e') */
  color: string;
}

/** Static image layer (user-uploaded or icon-pack reference) */
export interface ImageLayer extends LayerBase {
  type: 'image';
  /** Image data as data:image/png;base64,... or icon:<id> reference */
  dataUri: string;
  /** How the image is fitted within the safe area */
  fit: ImageFit;
  /** Scale multiplier (0.1–2.0, default 1.0) */
  scale: number;
  /** Horizontal offset from centre in pixels (-48..+48 on 96px canvas) */
  offsetX: number;
  /** Vertical offset from centre in pixels (-48..+48 on 96px canvas) */
  offsetY: number;
}

/** Text label layer */
export interface TextLayer extends LayerBase {
  type: 'text';
  /** The label text to render */
  text: string;
  /** Text colour (CSS hex) */
  color: string;
  /** Font size in pixels on the device canvas. 0 = auto (~20% of safe area width). */
  fontSize: number;
  /** Whether the text is bold */
  bold: boolean;
  /** Vertical anchor within the safe area */
  positionV: PositionAnchorV;
  /** Horizontal anchor within the safe area */
  positionH: PositionAnchorH;
}

/** Plugin dynamic image layer.
 *  The actual image data is NOT persisted — it is resolved at render time
 *  from the plugin image registry (by imageId) or from the legacy
 *  per-button setButtonImage() data. */
export interface PluginLayer extends LayerBase {
  type: 'plugin';
  /** How the plugin-provided image is fitted within the safe area */
  fit: ImageFit;
  /** ID of the plugin that controls this layer (e.g. 'obs').
   *  Set automatically when the layer is created from a bound plugin action. */
  pluginId?: string;
  /** Optional reference to a named image in the plugin's image registry.
   *  If omitted, falls back to the legacy per-button image from setButtonImage(). */
  imageId?: string;
}

/** Union of all layer types */
export type Layer = FillLayer | ImageLayer | TextLayer | PluginLayer;

/** Maximum number of layers per button appearance */
export const MAX_LAYERS = 8;

// ─── Button Appearance ──────────────────────────────────────────

/** Visual appearance settings for a button key — an ordered layer stack
 *  rendered bottom-to-top. */
export interface ButtonAppearance {
  layers: Layer[];
}

/** Default neutral background colour for key margins and empty keys */
export const KEY_MARGIN_COLOR = '#1a1a2e';

/** Create a default empty appearance (fill + empty text label) */
export function createDefaultAppearance(): ButtonAppearance {
  return {
    layers: [
      {
        id: generateLayerId(),
        type: 'fill',
        name: 'Background',
        visible: true,
        opacity: 1,
        locked: false,
        color: KEY_MARGIN_COLOR
      },
      {
        id: generateLayerId(),
        type: 'text',
        name: 'Label',
        visible: true,
        opacity: 1,
        locked: false,
        text: '',
        color: '#ffffff',
        fontSize: 0,
        bold: true,
        positionV: 'center',
        positionH: 'center'
      }
    ]
  };
}

/** Generate a short unique ID for layers */
export function generateLayerId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ─── Interaction Settings ────────────────────────────────────────

/** Configurable timing for button interactions (global, not per-profile) */
export interface InteractionSettings {
  /** How long (ms) a button must be held to trigger a long press. Default 500. */
  longPressMs: number;
  /** Window (ms) to detect a second tap for double-tap. Default 300. */
  doubleTapMs: number;
}

export const DEFAULT_INTERACTION_SETTINGS: InteractionSettings = {
  longPressMs: 500,
  doubleTapMs: 300
};

// ─── Page & Profile Types ───────────────────────────────────────

/** A single page of button bindings within a profile */
export interface Page {
  id: string;
  name: string;
  bindings: Record<number, ButtonBinding>; // key index → binding (triggers → actions)
  /** Knob bindings keyed by knob string ID (e.g. 'knobTL') */
  knobBindings?: Record<string, KnobBinding>;
}

/** A profile contains a tree of pages */
export interface Profile {
  id: string;
  name: string;
  pages: Record<string, Page>; // page ID → page
  rootPageId: string; // the default/home page
}

export interface ProfileData {
  version: 3;
  activeProfileId: string;
  profiles: Profile[];
  /** Per-device profile assignment: device key (serial-based ID) → profile ID.
   *  Devices without an explicit assignment fall back to `activeProfileId`. */
  deviceProfileAssignment?: Record<string, string>;
  /** Global interaction timing settings (optional — defaults applied if absent) */
  interactionSettings?: InteractionSettings;
  /** Plugin connection settings, keyed by plugin ID */
  pluginSettings?: Record<string, Record<string, unknown>>;
  /** Per-application profile switching settings (optional — defaults applied if absent) */
  appSwitchSettings?: AppSwitchSettings;
  /** Device calibration insets keyed by device serial (optional — device defaults used if absent) */
  calibrationInsets?: Record<string, SafeAreaInsets>;
  /** Device screen brightness keyed by device serial (0-1, optional — defaults to 1) */
  deviceBrightness?: Record<string, number>;
}

/** Breadcrumb entry for page navigation in the renderer */
export interface PageBreadcrumb {
  pageId: string;
  pageName: string;
}

/** Info about the currently navigated page, sent from main → renderer */
export interface PageNavigationState {
  currentPageId: string;
  breadcrumbs: PageBreadcrumb[];
  /** When present, identifies which device this state applies to */
  deviceKey?: string;
}

// ─── IPC Channel Types ──────────────────────────────────────────

export const IPC_CHANNELS = {
  // Device events (main → renderer)
  DEVICE_CONNECTED: 'device:connected',
  DEVICE_DISCONNECTED: 'device:disconnected',
  DEVICE_BUTTON_DOWN: 'device:button-down',
  DEVICE_BUTTON_UP: 'device:button-up',
  DEVICE_KNOB_ROTATE: 'device:knob-rotate',

  // Device commands (renderer → main)
  DEVICE_GET_INFO: 'device:get-info',
  DEVICE_GET_ALL_INFO: 'device:get-all-info',
  DEVICE_SET_BRIGHTNESS: 'device:set-brightness',
  DEVICE_GET_BRIGHTNESS: 'device:get-brightness',
  DEVICE_DRAW_KEY: 'device:draw-key',

  // Profile management (renderer → main)
  PROFILE_LOAD: 'profile:load',
  PROFILE_SAVE: 'profile:save',
  PROFILE_GET_ALL: 'profile:get-all',
  PROFILE_SET_ACTIVE: 'profile:set-active',
  PROFILE_CREATE: 'profile:create',
  PROFILE_DELETE: 'profile:delete',
  PROFILE_RENAME: 'profile:rename',
  PROFILE_EXPORT: 'profile:export',
  PROFILE_IMPORT: 'profile:import',

  // Profile events (main → renderer)
  PROFILE_CHANGED: 'profile:changed',

  // Page management (renderer → main)
  PAGE_NAVIGATE: 'page:navigate',
  PAGE_NAVIGATE_BACK: 'page:navigate-back',
  PAGE_NAVIGATE_ROOT: 'page:navigate-root',
  PAGE_GET_STATE: 'page:get-state',
  PAGE_CREATE: 'page:create',
  PAGE_DELETE: 'page:delete',
  PAGE_RENAME: 'page:rename',

  // Page events (main → renderer)
  PAGE_CHANGED: 'page:changed',

  // Per-device profile / page (renderer → main)
  /** Get the active profile ID for a specific device key */
  DEVICE_GET_ACTIVE_PROFILE: 'device:get-active-profile',
  /** Assign a profile to a specific device key */
  DEVICE_SET_ACTIVE_PROFILE: 'device:set-active-profile',
  /** Get navigation state for a specific device key */
  DEVICE_PAGE_GET_STATE: 'device:page-get-state',
  /** Navigate to a page on a specific device */
  DEVICE_PAGE_NAVIGATE: 'device:page-navigate',
  /** Navigate back on a specific device */
  DEVICE_PAGE_NAVIGATE_BACK: 'device:page-navigate-back',
  /** Navigate to root on a specific device */
  DEVICE_PAGE_NAVIGATE_ROOT: 'device:page-navigate-root',

  // Calibration & debug (renderer → main)
  DEVICE_DRAW_CALIBRATION: 'device:draw-calibration',
  DEVICE_SET_KEY_INSETS: 'device:set-key-insets',

  // Image management (renderer → main)
  PICK_IMAGE: 'image:pick',

  // Interaction settings (renderer → main)
  INTERACTION_GET_SETTINGS: 'interaction:get-settings',
  INTERACTION_SET_SETTINGS: 'interaction:set-settings',

  // Action commands (renderer → main)
  ACTION_EXECUTE: 'action:execute',

  // App switching (renderer → main)
  APP_SWITCH_GET_SETTINGS: 'app-switch:get-settings',
  APP_SWITCH_SET_SETTINGS: 'app-switch:set-settings',
  APP_SWITCH_GET_CURRENT_APP: 'app-switch:get-current-app',
  APP_SWITCH_GET_DETECTION_METHOD: 'app-switch:get-detection-method',

  // App switching events (main → renderer)
  APP_SWITCH_APP_CHANGED: 'app-switch:app-changed',

  // Plugin system (renderer → main)
  PLUGIN_CONNECT: 'plugin:connect',
  PLUGIN_DISCONNECT: 'plugin:disconnect',
  PLUGIN_GET_STATE: 'plugin:get-state',
  PLUGIN_QUERY: 'plugin:query',
  PLUGIN_GET_SETTINGS: 'plugin:get-settings',
  PLUGIN_SET_SETTINGS: 'plugin:set-settings',
  PLUGIN_GET_MANIFESTS: 'plugin:get-manifests',
  PLUGIN_GET_INFO: 'plugin:get-info',

  // Plugin store (renderer → main)
  PLUGIN_STORE_SEARCH: 'plugin-store:search',
  PLUGIN_STORE_GET_VERSIONS: 'plugin-store:get-versions',
  PLUGIN_STORE_INSTALL: 'plugin-store:install',
  PLUGIN_STORE_INSTALL_URL: 'plugin-store:install-url',
  PLUGIN_STORE_UNINSTALL: 'plugin-store:uninstall',
  PLUGIN_STORE_GET_INSTALLED: 'plugin-store:get-installed',
  PLUGIN_STORE_CHECK_UPDATES: 'plugin-store:check-updates',

  // Logging (renderer → main)
  LOG_GET_ENTRIES: 'log:get-entries',
  LOG_CLEAR: 'log:clear',

  // Plugin feedback events (main → renderer)
  PLUGIN_SHOW_FEEDBACK: 'plugin:show-feedback',

  // Logging events (main → renderer)
  LOG_NEW_ENTRY: 'log:new-entry',

  // Key rendering (renderer ↔ main)
  /** Request a key preview render from the main process (renderer → main).
   *  Payload: KeyRenderPreviewRequest → returns PNG data URI string */
  KEY_RENDER_PREVIEW: 'key:render-preview',
  /** Push a rendered key preview image to the renderer (main → renderer).
   *  Payload: KeyPreviewUpdate */
  KEY_PREVIEW_UPDATE: 'key:preview-update',

  // Virtual device management (renderer → main)
  VIRTUAL_DEVICE_GET_CONFIGS: 'virtual-device:get-configs',
  VIRTUAL_DEVICE_CREATE: 'virtual-device:create',
  VIRTUAL_DEVICE_UPDATE: 'virtual-device:update',
  VIRTUAL_DEVICE_DELETE: 'virtual-device:delete',
  /** Inject a button-down event into a virtual device */
  VIRTUAL_DEVICE_KEY_DOWN: 'virtual-device:key-down',
  /** Inject a button-up event into a virtual device */
  VIRTUAL_DEVICE_KEY_UP: 'virtual-device:key-up',
  /** Inject an encoder rotation into a virtual device */
  VIRTUAL_DEVICE_ENCODER_ROTATE: 'virtual-device:encoder-rotate',
  /** Inject an encoder press into a virtual device */
  VIRTUAL_DEVICE_ENCODER_PRESS: 'virtual-device:encoder-press',
  /** Inject a slider value change into a virtual device */
  VIRTUAL_DEVICE_SLIDER_CHANGE: 'virtual-device:slider-change',
  /** Get all current key images for a virtual device */
  VIRTUAL_DEVICE_GET_KEY_IMAGES: 'virtual-device:get-key-images',
  /** Get all current slider values for a virtual device */
  VIRTUAL_DEVICE_GET_SLIDER_VALUES: 'virtual-device:get-slider-values',

  // Virtual device events (main → renderer)
  VIRTUAL_DEVICE_KEY_IMAGE: 'virtual-device:key-image',
  VIRTUAL_DEVICE_SLIDER_VALUE: 'virtual-device:slider-value',

  // Virtual deck windows (renderer → main)
  VIRTUAL_DECK_OPEN: 'virtual-deck:open',
  VIRTUAL_DECK_CLOSE: 'virtual-deck:close',

  // Web companion server (renderer → main)
  WEB_SERVER_START: 'web-server:start',
  WEB_SERVER_STOP: 'web-server:stop',
  WEB_SERVER_GET_STATUS: 'web-server:get-status',
  WEB_SERVER_SET_PIN: 'web-server:set-pin',
  WEB_SERVER_SET_PORT: 'web-server:set-port',
  WEB_SERVER_GET_QR_CODE: 'web-server:get-qr',

  // Web companion server events (main → renderer)
  WEB_SERVER_STATUS_CHANGED: 'web-server:status-changed',

  // Slider events (main → renderer)
  DEVICE_SLIDER_CHANGE: 'device:slider-change',

  // Lifecycle (renderer → main)
  /** Signal that the renderer is ready to receive IPC push events.
   *  Main process responds by pushing key previews for the current page. */
  RENDERER_READY: 'renderer:ready'
} as const;

// Types for IPC payloads
export interface DeviceButtonEvent {
  deviceId: string;
  buttonIndex: number;
}

export interface DeviceKnobEvent {
  deviceId: string;
  /** Knob string ID (e.g. 'knobTL', 'knobCR') */
  knobId: string;
  /** Rotation delta: +1 for clockwise, -1 for counter-clockwise */
  delta: number;
}

export interface DeviceSliderEvent {
  deviceId: string;
  /** Slider string ID (e.g. 'slider0') */
  sliderId: string;
  /** Normalized value 0–127 */
  value: number;
}

export interface DrawKeyRequest {
  /** Target device ID. Required to prevent accidental broadcast to all devices. */
  deviceId: string;
  keyIndex: number;
  appearance: ButtonAppearance;
}

/** Feedback type for showOk() / showAlert() temporary overlays on keys. */
export type FeedbackType = 'ok' | 'alert';

/** Payload sent via PLUGIN_SHOW_FEEDBACK IPC channel. */
export interface PluginFeedbackEvent {
  keyIndex: number;
  feedbackType: FeedbackType;
  durationMs: number;
}

/** Request payload for KEY_RENDER_PREVIEW IPC (renderer → main).
 *  Asks the main process to render a key appearance via KeyRenderer
 *  and return the PNG data URI. */
export interface KeyRenderPreviewRequest {
  appearance: ButtonAppearance;
  /** Optional device ID to use for insets/keySize. If omitted, uses the first device. */
  deviceId?: string;
}

/** Payload for KEY_PREVIEW_UPDATE IPC (main → renderer).
 *  Pushed by the main process when a key's rendered preview changes
 *  (e.g. after applyCurrentPageToDevice or reapplyKey). */
export interface KeyPreviewUpdate {
  keyIndex: number;
  dataUri: string | null;
  /** When present, identifies which device this preview applies to */
  deviceKey?: string;
}
