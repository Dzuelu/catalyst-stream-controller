# Plugin System — Architecture Plan

## 1. Motivation

Adding a new integration today (e.g. Twitch, Philips Hue, MIDI) requires touching
**10 files across 4 process boundaries**. The OBS and Discord integrations follow
an identical structural pattern, but the wiring is manual and scattered:

| File | What you add |
|---|---|
| `shared/x-types.ts` | New file: connection settings, action types, labels, params, state |
| `shared/types.ts` | New ActionType literal, IPC channels, ProfileData field |
| `main/integrations/XClient.ts` | New file: connect/disconnect/state/executeAction/destroy |
| `main/index.ts` | Instantiate, wire state callback, pass to handlers, auto-connect, cleanup |
| `main/ipc/handlers.ts` | Add parameter, ~30 lines of ipcMain.handle() calls |
| `main/actions/ActionExecutor.ts` | Add field, setter, case in switch, private method |
| `main/profiles/ProfileManager.ts` | Add getter + setter for connection settings |
| `preload/preload.ts` | Add ~8 bridge methods |
| `renderer/components/ActionPanel.svelte` | Imports, state vars, init, load/save, ~170 lines of template |
| `package.json` | npm dependency (if any) |

A plugin system should let you add a new integration by creating **one self-contained
package** and dropping it into a plugins folder — no core file edits required.

---

## 2. Goals

1. **Zero core edits** — Adding a new integration should never require modifying
   `types.ts`, `index.ts`, `handlers.ts`, `preload.ts`, `ActionExecutor.ts`,
   `ProfileManager.ts`, or `ActionPanel.svelte`.
2. **Migrate OBS & Discord** — Both existing integrations become built-in plugins
   using the same API any third-party plugin would use.
3. **Type-safe plugin contract** — A single `PluginClient` interface that
   TypeScript enforces, covering the main process client, shared types, and UI
   component.
4. **Host API access** — Plugins can call back into the host to control device
   brightness, set button images, execute any action (built-in or plugin),
   navigate pages, switch profiles, subscribe to device events, and log messages.
5. **Opt-in plugin images** — Plugins can provide dynamic button images at runtime,
   but only when the user explicitly enables plugin images on that button via the
   appearance editor. The user retains full control over what renders on each key.
6. **No performance regression** — Plugin discovery happens once at startup; action
   dispatch remains a direct function call, not a message bus.
7. **Sandboxed settings** — Each plugin's connection settings are stored under a
   namespaced key in `ProfileData`, not as a top-level field.
8. **UI composition** — Plugin UIs render inside `ActionPanel.svelte` via a dynamic
   Svelte component slot, not via hard-coded `{:else if}` chains.

---

## 3. Plugin Contract

### 3.1 Shared Types (renderer + main)

Each plugin exports a **manifest** that fully describes its capabilities. This
replaces the per-integration type files (`obs-types.ts`, `discord-types.ts`):

```typescript
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

  /** Map of actionId → human-readable label */
  actionLabels: Record<string, string>;

  /** Map of actionId → list of parameter names that action requires.
   *  Each param name corresponds to a field in the action config and
   *  a field definition in `paramFields`. */
  actionParams: Record<string, string[]>;

  /** Field definitions for all parameters used across actions.
   *  Drives automatic UI generation — plugins don't need custom Svelte. */
  paramFields: Record<string, ParamFieldDef>;

  /** ── Connection Settings Schema ──────────────────────── */

  /** Default connection settings (used on first run) */
  defaultConnectionSettings: Record<string, unknown>;

  /** Field definitions for the connection settings UI */
  connectionSettingsFields: ParamFieldDef[];

  /** ── State ───────────────────────────────────────────── */

  /** Default state snapshot (used before first connect) */
  defaultState: Record<string, unknown>;

  /** Optional: describe which state fields to show in the live status
   *  panel when this plugin's action type is selected. */
  stateDisplay?: StateDisplayField[];

  /** ── Button Visuals ──────────────────────────────────── */

  /** If true, the plugin can provide dynamic button images at runtime.
   *  When a user enables "Plugin Image" on a button configured with this
   *  plugin's action type, the core will call `getButtonImage()` on the
   *  client during key rendering. The plugin can also push images via
   *  `hostAPI.setButtonImage()` in response to state changes.
   *
   *  NOTE: The user must explicitly enable plugin images per-button in the
   *  appearance editor. This flag just declares that the plugin supports
   *  the capability. */
  supportsDynamicImages?: boolean;
}

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
```

### 3.2 Plugin Host API

The **host API** is the interface plugins use to call back into the core application.
It is injected into the plugin client factory, giving plugins controlled access to
device capabilities, action execution, navigation, device events, lifecycle events,
and logging.

```typescript
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
  executeAction(
    type: BuiltinActionType,
    config: Record<string, unknown>,
  ): Promise<void>;

  /** Execute an action on another plugin. Requires the target plugin to
   *  be registered and connected. Throws if the target plugin is not
   *  available. */
  executePluginAction(
    pluginId: string,
    config: Record<string, unknown>,
  ): Promise<void>;

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
  onKnobRotate(callback: (knobIndex: number, direction: 'cw' | 'ccw', deviceSerial: string) => void): () => void;

  /** Subscribe to knob press events. */
  onKnobPress(callback: (knobIndex: number, deviceSerial: string) => void): () => void;

  // ─── Lifecycle Events ──────────────────────────────────
  /** Called when the active profile changes. */
  onProfileChanged(callback: (profileId: string) => void): () => void;

  /** Called when the user navigates to a different page. */
  onPageChanged(callback: (pageId: string) => void): () => void;

  /** Called when a device connects. */
  onDeviceConnected(callback: (serial: string, name: string) => void): () => void;

  /** Called when a device disconnects. */
  onDeviceDisconnected(callback: (serial: string) => void): () => void;

  // ─── Logging ───────────────────────────────────────────
  /** Log a message that appears in the app's log panel. The source
   *  will automatically be prefixed with the plugin name. */
  log(level: 'info' | 'warn' | 'error', message: string): void;

  // ─── Settings (own) ────────────────────────────────────
  /** Read the plugin's own persisted settings. */
  getOwnSettings(): Record<string, unknown>;

  /** Save the plugin's own settings to disk. */
  saveOwnSettings(settings: Record<string, unknown>): Promise<void>;
}
```

### 3.3 Main Process Client

Each plugin provides a **factory function** that receives the host API and creates
its main-process client:

```typescript
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
   *  button's appearance settings). Called during key re-render if
   *  `manifest.supportsDynamicImages` is true.
   *  Return null to skip the plugin image layer for this render. */
  getButtonImage?(actionConfig: Record<string, unknown>): string | null;
}

/** Factory function — receives the host API for calling back into the core. */
export type PluginClientFactory = (hostAPI: PluginHostAPI) => PluginClient;
```

### 3.4 Plugin Package Structure

```
src/plugins/
├── obs/
│   ├── manifest.ts          # exports PluginManifest
│   ├── client.ts            # exports PluginClientFactory
│   └── index.ts             # re-exports both
├── discord/
│   ├── manifest.ts
│   ├── client.ts
│   └── index.ts
└── (future plugins...)
```

All built-in plugins live under `src/plugins/` and are bundled with the app.
Third-party plugins (future goal) would live in the user data directory.

---

## 4. Core Infrastructure Changes

### 4.1 Button Appearance Model (reworked)

The current `ButtonAppearance` stores a flat structure with a single optional
`icon`. This is extended with a **plugin image configuration** that the user
controls. The key principle: **the user decides what shows on their buttons,
plugins only provide image data when asked.**

#### Updated ButtonAppearance

```typescript
/** Visual appearance settings for a button key */
export interface ButtonAppearance {
  /** Background color (CSS hex, e.g. '#1a1a2e') */
  backgroundColor: string;

  /** Label text settings */
  label: {
    text: string;
    color: string;
    fontSize: number;
    bold: boolean;
    positionV: PositionAnchorV;
    positionH: PositionAnchorH;
  };

  /** Optional user-set icon (stored as data URI) */
  icon?: {
    dataUri: string;
    fit: ImageFit;
    offsetX: number;
    offsetY: number;
    scale: number;
  };

  /** Plugin image configuration (persisted user setting).
   *  When a button is configured with a plugin action type and the plugin
   *  supports dynamic images, the appearance editor shows a "Plugin Image"
   *  section with these controls. The actual image content is provided by
   *  the plugin at runtime and stored in a separate in-memory map — NOT
   *  persisted in this object. */
  pluginImage?: {
    /** Whether to show the plugin's dynamic image on this button.
     *  Default: false. The user toggles this on in the appearance editor. */
    enabled: boolean;

    /** How the plugin image should be fitted within the canvas.
     *  Default: 'contain'. Controlled by the user. */
    fit: ImageFit;
  };
}
```

#### Runtime Plugin Image Storage

The actual plugin image data is **not** stored in `ButtonAppearance`. It lives in
an in-memory map managed by the `PluginRegistry`:

```typescript
/** Runtime-only plugin image data. Keyed by 'keyIndex' or 'keyIndex:serial'. */
private pluginImageMap: Map<string, { pluginId: string; dataUri: string }> = new Map();
```

This separation ensures:
- **User settings persist** (`pluginImage.enabled`, `pluginImage.fit`) across
  app restarts
- **Plugin image data is transient** — cleared on disconnect, not written to disk
- **Clean ownership** — the map tracks which plugin set each image for cleanup

#### Rendering Order (bottom to top)

```
┌─────────────────────────────┐
│  1. backgroundColor         │  ← always rendered
├─────────────────────────────┤
│  2. user icon               │  ← if user set an icon
├─────────────────────────────┤
│  3. plugin image            │  ← if pluginImage.enabled AND plugin has image
├─────────────────────────────┤
│  4. label text              │  ← always rendered on top
└─────────────────────────────┘
```

Layer control:
- **User controls all layers** — they choose their icon, toggle the plugin image,
  write the label. The rendering order is fixed but each layer is independently
  enabled/disabled.
- **Both icon and plugin image** — If the user sets an icon AND enables plugin
  images, both render. The plugin image composites above the user icon (useful for
  status overlays, indicators, badges).
- **Plugin image only** — The user can leave the icon empty and just enable the
  plugin image (e.g. OBS provides a scene thumbnail or status icon).
- **Icon only** — The user can set an icon and not enable plugin images (today's
  behavior).
- **Neither** — Just background color and label text.

The fixed order (plugin image above user icon) is deliberate — plugin images are
typically small status indicators or overlays. If future use cases require
user-controlled ordering, we can add a `pluginImagePosition: 'above' | 'below'`
setting later.

#### Ownership Validation

When a plugin calls `hostAPI.setButtonImage(keyIndex, dataUri)`, the core validates:

1. **User opt-in**: Does the button at `keyIndex` have
   `appearance.pluginImage?.enabled === true`? If not → reject ("plugin images
   not enabled on this button").

2. **Plugin ownership**: Does at least one trigger on the button's binding have
   `type === 'plugin:{callingPluginId}'`? The check examines **all** trigger
   types — `press`, `longPress`, `doubleTap`, `down`, and `up`:

   ```typescript
   const triggers = [
     binding.press, binding.longPress, binding.doubleTap,
     binding.down, binding.up
   ];
   const ownsButton = triggers.some(
     t => t?.type === `plugin:${pluginId}`
   );
   ```

   If no trigger matches → reject ("button is not owned by this plugin").

3. If both checks pass → store the image in `pluginImageMap` and re-render the key.

The `getButtonImage()` path applies the same checks — the core only calls it for
buttons where `pluginImage.enabled === true` AND at least one trigger matches the
plugin's action type.

**Why check all triggers?** A user might configure `press` as a plugin action and
`longPress` as a built-in action (or vice versa). The plugin should still be able
to show its status image on the button as long as any trigger uses that plugin.

#### Cleanup

Plugin images are cleared from `pluginImageMap` when:
- The plugin disconnects
- The plugin is destroyed (shutdown)
- The user disables `pluginImage.enabled` on a button
- The user changes a button's action type away from the plugin
- `clearButtonImage()` is called by the plugin

### 4.2 Plugin Registry (new: `src/main/plugins/PluginRegistry.ts`)

Central orchestrator that replaces the manual wiring in `index.ts`:

```
PluginRegistry
  ├── discover()        — scan src/plugins/*/index.ts, import manifests
  ├── register(plugin)  — validate manifest, instantiate client via factory
  ├── getPlugin(id)     — return { manifest, client } by plugin ID
  ├── getAllPlugins()    — return all registered plugins
  ├── connectAll()      — auto-connect all plugins with autoConnect=true
  ├── destroyAll()      — tear down all clients + unsubscribe all + clear images
  ├── wireIPC()         — register generic IPC handlers for all plugins
  ├── buildHostAPI(id)  — create a sandboxed PluginHostAPI for a specific plugin
  ├── pluginImageMap    — runtime plugin image storage (in-memory)
  ├── getPluginImage()  — retrieve runtime image for a key (used by renderer)
  └── clearPluginImages(pluginId) — clear all images for a plugin (disconnect)
```

The registry creates one `PluginHostAPI` instance per plugin during registration.
Each host API is scoped — `log()` auto-prefixes the plugin name, `getOwnSettings()`
reads only that plugin's settings, `setButtonImage()` validates both user opt-in
and plugin ownership. The registry also tracks event subscriptions per plugin so
they can be cleaned up on plugin destroy.

**IPC pattern becomes generic** — instead of per-plugin handlers, the registry
registers a fixed set of parameterized channels:

```
plugin:connect       (pluginId, settings) → { success, error? }
plugin:disconnect    (pluginId)
plugin:get-state     (pluginId) → state
plugin:query         (pluginId, queryName) → options[]
plugin:get-settings  (pluginId) → settings
plugin:set-settings  (pluginId, settings)
plugin:get-manifests () → PluginManifest[]
plugin:get-info      (pluginId) → { id, name, version, connected } | null
```

Plus one event channel per plugin (dynamically created):
```
plugin:state-changed:{pluginId}
```

### 4.3 ActionType Changes (`shared/types.ts`)

Replace the hard-coded `ActionType` union with a two-tier approach:

```typescript
/** Built-in action types (not plugin-provided) */
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

/** All action types */
export type ActionType = BuiltinActionType | PluginActionType;
```

When a button is configured as `type: 'plugin:obs'`, the `config` bag contains
the plugin-specific action config (e.g. `{ pluginAction: 'switch-scene', sceneName: '...' }`).

ActionExecutor's switch statement becomes:

```typescript
default:
  if (action.type.startsWith('plugin:')) {
    const pluginId = action.type.slice(7); // 'plugin:obs' → 'obs'
    await this.pluginRegistry.getPlugin(pluginId)?.client.executeAction(action.config);
  }
```

### 4.4 ProfileData Changes

Replace per-integration fields with a generic map:

```typescript
export interface ProfileData {
  version: 4; // bump version for migration
  // ...existing fields...
  /** Plugin connection settings, keyed by plugin ID */
  pluginSettings?: Record<string, Record<string, unknown>>;
  // Remove: obsConnectionSettings, discordConnectionSettings
}
```

ProfileManager gets generic methods:

```typescript
getPluginSettings(pluginId: string): Record<string, unknown>
setPluginSettings(pluginId: string, settings: Record<string, unknown>): Promise<void>
```

A **v3 → v4 migration** moves `obsConnectionSettings` to `pluginSettings.obs`
and `discordConnectionSettings` to `pluginSettings.discord`.

### 4.5 Preload Changes

Replace per-integration methods with generic plugin bridge:

```typescript
// ─── Plugins (generic) ────────────────────────────────────
pluginConnect: (pluginId, settings) => ipcRenderer.invoke('plugin:connect', pluginId, settings),
pluginDisconnect: (pluginId) => ipcRenderer.invoke('plugin:disconnect', pluginId),
pluginGetState: (pluginId) => ipcRenderer.invoke('plugin:get-state', pluginId),
pluginQuery: (pluginId, queryName) => ipcRenderer.invoke('plugin:query', pluginId, queryName),
pluginGetSettings: (pluginId) => ipcRenderer.invoke('plugin:get-settings', pluginId),
pluginSetSettings: (pluginId, settings) => ipcRenderer.invoke('plugin:set-settings', pluginId, settings),
pluginGetManifests: () => ipcRenderer.invoke('plugin:get-manifests'),
pluginGetInfo: (pluginId) => ipcRenderer.invoke('plugin:get-info', pluginId),
onPluginStateChanged: (pluginId, callback) => {
  const channel = `plugin:state-changed:${pluginId}`;
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
},
```

This replaces ~16 methods (8 per integration) with 9 generic ones.

### 4.6 ActionPanel.svelte Changes

The monolithic `{:else if actionType === 'obs'}` / `{:else if actionType === 'discord'}`
blocks get replaced with a single **generic plugin action panel**:

```svelte
{:else if actionType.startsWith('plugin:')}
  {@const pluginId = actionType.slice(7)}
  {@const manifest = pluginManifests.find(m => m.id === pluginId)}
  {#if manifest}
    <PluginActionPanel
      {pluginId}
      {manifest}
      bind:actionConfig={pluginActionConfig}
      pluginState={pluginStates[pluginId]}
    />
  {/if}
```

The new `PluginActionPanel.svelte` component (~200 lines) is **entirely
data-driven** from the manifest:

- **Connection card** — renders `connectionSettingsFields` from manifest
- **Action selector** — iterates `manifest.actionLabels`
- **Param fields** — for each param in `manifest.actionParams[selectedAction]`,
  looks up `manifest.paramFields[param]` and renders the appropriate widget
  (text, select with dynamic query, range slider, boolean toggle, image picker, etc.)
- **Live status** — iterates `manifest.stateDisplay` to show current state

The action type dropdown in ActionPanel also becomes dynamic:

```svelte
<!-- Built-in types -->
<option value="hotkey">Key Sequence</option>
...
<!-- Plugin types (auto-populated) -->
{#each pluginManifests as manifest (manifest.id)}
  <option value="plugin:{manifest.id}">{manifest.name}</option>
{/each}
```

#### Plugin Image Toggle in Appearance Editor

When a button's action type is `plugin:*` and the plugin's manifest has
`supportsDynamicImages: true`, the appearance editor shows a **"Plugin Image"**
section below the icon picker:

```svelte
{#if isPluginAction && pluginSupportsDynamicImages}
  <div class="plugin-image-section">
    <label>
      <input type="checkbox" bind:checked={pluginImageEnabled} />
      Show plugin status image
    </label>
    {#if pluginImageEnabled}
      <label>Image Fit
        <select bind:value={pluginImageFit}>
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
          <option value="stretch">Stretch</option>
          <option value="none">None</option>
        </select>
      </label>
    {/if}
  </div>
{/if}
```

This writes to `appearance.pluginImage = { enabled: true, fit: 'contain' }` and
is persisted with the profile data.

### 4.7 Dynamic Button Image Integration

When a plugin declares `supportsDynamicImages: true`, the core's key rendering
pipeline (`reapplyAllKeys()` / `reapplyKey()` in `index.ts`) checks for plugin
images — but only when the user has opted in:

```typescript
// In reapplyKey() / buildKeyAppearance():

// Step 1: Check if user enabled plugin images on this button
if (appearance.pluginImage?.enabled) {
  // Step 2: Find the first plugin action across all triggers
  const allTriggers = [
    binding?.press, binding?.longPress, binding?.doubleTap,
    binding?.down, binding?.up
  ];
  const pluginTrigger = allTriggers.find(
    t => t?.type?.startsWith('plugin:')
  );

  if (pluginTrigger) {
    const pluginId = pluginTrigger.type.slice(7);
    const plugin = pluginRegistry.getPlugin(pluginId);

    // Step 3a: Check the runtime image map (for push-based images)
    const runtimeImage = pluginRegistry.getPluginImage(keyIndex, serial);
    if (runtimeImage) {
      compositePluginImage(canvas, runtimeImage.dataUri, appearance.pluginImage.fit);
    }
    // Step 3b: Fall back to pull-based image (getButtonImage)
    else if (
      plugin?.manifest.supportsDynamicImages &&
      plugin.client.getButtonImage
    ) {
      const dynamicImage = plugin.client.getButtonImage(pluginTrigger.config);
      if (dynamicImage) {
        compositePluginImage(canvas, dynamicImage, appearance.pluginImage.fit);
      }
    }
  }
}
```

The plugin's state change handler also triggers `reapplyAllKeys()` so that image
changes propagate to the device immediately when state changes (e.g. OBS starts
streaming → "LIVE" indicator appears on the button, composited above the user's
icon but below the user's label).

**Two image update paths:**
- **Pull** — `getButtonImage(config)` is called during rendering. Synchronous,
  returns current image or null. Used for state-derived images.
- **Push** — `hostAPI.setButtonImage(keyIndex, dataUri)` stores the image and
  triggers a re-render. Used for event-driven updates.

The push path goes through ownership validation (§4.1). The pull path is safe
because the core only calls it when `pluginImage.enabled` is true and the trigger
matches the plugin.

### 4.8 Host API Implementation

The `PluginRegistry.buildHostAPI(pluginId)` method creates a scoped host API
by wrapping existing core services:

```typescript
private buildHostAPI(pluginId: string): PluginHostAPI {
  // Track subscriptions for cleanup on destroy
  const subscriptions: Array<() => void> = [];

  const api: PluginHostAPI = {
    // ─── Device capabilities ───────────────────────────────
    setBrightness: async (value, serial?) => {
      const devices = serial
        ? [this.deviceManager.getDevice(serial)]
        : this.deviceManager.getAllDevices();
      for (const device of devices) {
        if (device) await device.setBrightness(value);
      }
    },

    setButtonImage: async (keyIndex, dataUri, serial?) => {
      // Validate 1: user must have enabled plugin images on this button
      const appearance = this.getAppearanceAt(keyIndex);
      if (!appearance?.pluginImage?.enabled) {
        throw new Error(
          `Plugin "${pluginId}" cannot set image on key ${keyIndex}: ` +
          `plugin images are not enabled on this button. ` +
          `The user must enable "Show plugin status image" in the appearance editor.`
        );
      }

      // Validate 2: this plugin must own at least one trigger on the button
      const binding = this.getBindingAt(keyIndex);
      const triggers = [
        binding?.press, binding?.longPress, binding?.doubleTap,
        binding?.down, binding?.up
      ];
      const ownsButton = triggers.some(
        t => t?.type === `plugin:${pluginId}`
      );
      if (!ownsButton) {
        throw new Error(
          `Plugin "${pluginId}" cannot set image on key ${keyIndex}: ` +
          `no trigger on this button uses this plugin's action type`
        );
      }

      // Store runtime image and trigger re-render
      const mapKey = serial ? `${keyIndex}:${serial}` : `${keyIndex}`;
      this.pluginImageMap.set(mapKey, { pluginId, dataUri });
      this.reapplyKey(keyIndex, serial);
    },

    clearButtonImage: async (keyIndex, serial?) => {
      const mapKey = serial ? `${keyIndex}:${serial}` : `${keyIndex}`;
      this.pluginImageMap.delete(mapKey);
      this.reapplyKey(keyIndex, serial);
    },

    getDevices: () => {
      return this.deviceManager.getAllDevices().map(d => ({
        serial: d.serial, name: d.name,
        rows: d.rows, cols: d.cols, keyCount: d.keyCount,
        hasKnobs: d.knobs > 0,
      }));
    },

    // ─── Action execution ──────────────────────────────────
    executeAction: async (type, config) => {
      await this.actionExecutor.execute({ type, config, label: '' });
    },

    executePluginAction: async (targetPluginId, config) => {
      const target = this.getPlugin(targetPluginId);
      if (!target) {
        throw new Error(`Plugin "${targetPluginId}" is not registered`);
      }
      if (!target.client.isConnected()) {
        throw new Error(`Plugin "${targetPluginId}" is not connected`);
      }
      await target.client.executeAction(config);
    },

    // ─── Plugin discovery ──────────────────────────────────
    getPluginInfo: (targetId) => {
      const target = this.getPlugin(targetId);
      if (!target) return null;
      return {
        id: target.manifest.id,
        name: target.manifest.name,
        version: target.manifest.version,
        connected: target.client.isConnected(),
      };
    },

    getRegisteredPlugins: () => {
      return Array.from(this.plugins.keys());
    },

    // ─── Device events ─────────────────────────────────────
    onButtonDown: (cb) => {
      const handler = (keyIndex: number, serial: string) => cb(keyIndex, serial);
      this.deviceManager.on('key-down', handler);
      const unsub = () => this.deviceManager.off('key-down', handler);
      subscriptions.push(unsub);
      return unsub;
    },

    onButtonUp: (cb) => {
      const handler = (keyIndex: number, serial: string) => cb(keyIndex, serial);
      this.deviceManager.on('key-up', handler);
      const unsub = () => this.deviceManager.off('key-up', handler);
      subscriptions.push(unsub);
      return unsub;
    },

    onKnobRotate: (cb) => {
      const handler = (knobIndex: number, dir: 'cw' | 'ccw', serial: string) =>
        cb(knobIndex, dir, serial);
      this.deviceManager.on('knob-rotate', handler);
      const unsub = () => this.deviceManager.off('knob-rotate', handler);
      subscriptions.push(unsub);
      return unsub;
    },

    onKnobPress: (cb) => {
      const handler = (knobIndex: number, serial: string) => cb(knobIndex, serial);
      this.deviceManager.on('knob-press', handler);
      const unsub = () => this.deviceManager.off('knob-press', handler);
      subscriptions.push(unsub);
      return unsub;
    },

    // ─── Lifecycle events ──────────────────────────────────
    onProfileChanged: (cb) => {
      this.profileManager.on('profile-changed', cb);
      const unsub = () => this.profileManager.off('profile-changed', cb);
      subscriptions.push(unsub);
      return unsub;
    },

    onPageChanged: (cb) => {
      this.profileManager.on('page-changed', cb);
      const unsub = () => this.profileManager.off('page-changed', cb);
      subscriptions.push(unsub);
      return unsub;
    },

    onDeviceConnected: (cb) => {
      this.deviceManager.on('device-connected', cb);
      const unsub = () => this.deviceManager.off('device-connected', cb);
      subscriptions.push(unsub);
      return unsub;
    },

    onDeviceDisconnected: (cb) => {
      this.deviceManager.on('device-disconnected', cb);
      const unsub = () => this.deviceManager.off('device-disconnected', cb);
      subscriptions.push(unsub);
      return unsub;
    },

    // ─── Logging ───────────────────────────────────────────
    log: (level, message) => {
      const manifest = this.getPlugin(pluginId)?.manifest;
      const source = manifest?.name ?? pluginId;
      this.logCollector.add(level, `[${source}] ${message}`, source);
    },

    // ─── Settings ──────────────────────────────────────────
    getOwnSettings: () => this.profileManager.getPluginSettings(pluginId),
    saveOwnSettings: async (settings) => {
      await this.profileManager.setPluginSettings(pluginId, settings);
    },
  };

  // Store subscriptions list for cleanup on plugin.destroy()
  this.pluginSubscriptions.set(pluginId, subscriptions);

  return api;
}
```

On `destroyAll()` or when a single plugin is destroyed, the registry:
1. Iterates the plugin's subscription list and calls each unsubscribe function
2. Clears all runtime images for the plugin from `pluginImageMap`
3. Triggers a re-render of affected keys

### 4.9 Down/Up Trigger Types (new)

The current `ButtonBinding` supports three trigger types: `press`, `longPress`,
and `doubleTap`. These are **semantic** triggers produced by the
`ButtonInteractionManager`'s state machine from raw physical button events.

To support **hold-for-action** patterns (push-to-talk, hold-to-record, toggle
while held), we add two new trigger types that map directly to physical events:

#### Updated Types

```typescript
/** Trigger type for button interactions */
export type TriggerType = 'press' | 'longPress' | 'doubleTap' | 'down' | 'up';

/** A button binding maps trigger types to actions. */
export interface ButtonBinding {
  /** Standard tap action (default). If longPress or doubleTap are
   *  configured, press may be deferred to allow detection windows. */
  press?: ActionConfig;

  /** Fires after holding the button for ≥ longPressMs (default 500ms). */
  longPress?: ActionConfig;

  /** Fires on two rapid taps within doubleTapMs (default 300ms). */
  doubleTap?: ActionConfig;

  /** Fires immediately on physical button-down. Not subject to any
   *  detection delay. Use for "start" actions (begin recording,
   *  push-to-talk activate). */
  down?: ActionConfig;

  /** Fires immediately on physical button-up. Not subject to any
   *  detection delay. Use for "stop" actions (end recording,
   *  push-to-talk deactivate). */
  up?: ActionConfig;
}
```

#### Trigger Semantics

| Trigger | When it fires | Delay? | Use case |
|---|---|---|---|
| `down` | Immediately on physical button-down | No | Start actions, push-to-talk begin |
| `up` | Immediately on physical button-up | No | Stop actions, push-to-talk end |
| `press` | On tap completion (instant or deferred) | Maybe* | Default tap actions |
| `longPress` | After holding ≥ longPressMs | Yes | Secondary actions |
| `doubleTap` | On second tap within doubleTapMs | Yes | Tertiary actions |

\* `press` fires instantly on button-down when no `longPress` or `doubleTap`
bindings exist. Otherwise it fires on button-up after the detection window.

#### Interaction Notes

- `down` and `up` are **independent** of the `press`/`longPress`/`doubleTap`
  state machine. They always fire on the physical event, regardless of what other
  triggers are configured.
- If both `down` and `press` are configured, both fire on a normal tap: `down`
  fires on button-down, then `press` fires on completion. Users should be aware
  of this and configure them for complementary actions (e.g. `down` = "start",
  `up` = "stop", no `press` action).
- `down` fires **before** the longPress timer starts. If the user holds the
  button, the sequence is: `down` → (hold) → `longPress`. On release: `up`.
- `up` fires **regardless** of whether `longPress` fired. If the user holds
  past the longPress threshold: `down` → `longPress` → (release) → `up`.

#### ButtonInteractionManager Changes

```typescript
// In handleDown():
handleDown(deviceId: string, buttonIndex: number): void {
  // 1. Fire 'down' trigger immediately (if binding exists)
  if (this.downButtons.has(buttonIndex)) {
    this.callback(deviceId, buttonIndex, 'down');
  }

  // 2. Existing press/longPress/doubleTap logic (unchanged)
  // ...
}

// In handleUp():
handleUp(deviceId: string, buttonIndex: number): void {
  // 1. Fire 'up' trigger immediately (if binding exists)
  if (this.upButtons.has(buttonIndex)) {
    this.callback(deviceId, buttonIndex, 'up');
  }

  // 2. Existing press/longPress/doubleTap logic (unchanged)
  // ...
}

// updateBindingHints gains two new sets:
updateBindingHints(
  longPressIndices: number[],
  doubleTapIndices: number[],
  downIndices: number[],
  upIndices: number[]
): void {
  this.longPressButtons = new Set(longPressIndices);
  this.doubleTapButtons = new Set(doubleTapIndices);
  this.downButtons = new Set(downIndices);
  this.upButtons = new Set(upIndices);
}
```

#### UI Changes

The trigger type selector in `ActionPanel.svelte` gains two new options:

```svelte
<select bind:value={selectedTrigger}>
  <option value="press">Press</option>
  <option value="longPress">Long Press</option>
  <option value="doubleTap">Double Tap</option>
  <option value="down">Down (Immediate)</option>
  <option value="up">Up (Release)</option>
</select>
```

Tooltip/help text explains that `down`/`up` are for hold-for-action patterns.

---

## 5. Migration: OBS Plugin

### 5.1 `src/plugins/obs/manifest.ts`

The current `obs-types.ts` maps directly:

| Current | Manifest field |
|---|---|
| `OBS_ACTION_LABELS` | `actionLabels` |
| `OBS_ACTION_PARAMS` | `actionParams` |
| `DEFAULT_OBS_CONNECTION_SETTINGS` | `defaultConnectionSettings` |
| `DEFAULT_OBS_STATE` | `defaultState` |
| New | `paramFields` — defines `sceneName` (select, dynamicOptionsQuery: 'getScenes'), `inputName` (select, dynamicOptionsQuery: 'getInputs'), `sourceName` (text), `muted` (select, true/false) |
| New | `connectionSettingsFields` — `url` (text), `password` (password), `autoConnect` (boolean) |
| New | `stateDisplay` — current scene, streaming status, recording status |
| New | `supportsDynamicImages: true` — OBS can show live streaming/recording status icons on buttons when the user enables plugin images |

### 5.2 `src/plugins/obs/client.ts`

`OBSWebSocketClient` becomes the `PluginClient` implementation with minimal changes:

- `connect()` / `disconnect()` / `isConnected()` / `getState()` / `setOnStateChanged()` / `executeAction()` / `destroy()` — already match the contract
- Add `queries: { getScenes: () => ..., getInputs: () => ... }` for dynamic dropdowns
- Add `getButtonImage(config)` — returns a dynamic image based on OBS state
  (e.g. red circle when streaming, green circle when recording). Only called
  when the user has enabled plugin images on the button.
- Uses `hostAPI.log()` instead of direct `logCollector` calls
- Can use `hostAPI.onPageChanged()` to implement scene-per-page auto-switching
- Can use `down`/`up` triggers for push-to-stream or push-to-record patterns
- Return types become `Record<string, unknown>` (widened from the typed interfaces)

### 5.3 Files Removed After Migration

- `src/shared/obs-types.ts` → absorbed into `src/plugins/obs/manifest.ts`
- OBS sections from: `types.ts`, `ActionExecutor.ts`, `handlers.ts`, `preload.ts`, `index.ts`, `ActionPanel.svelte`, `ProfileManager.ts`

---

## 6. Migration: Discord Plugin

Identical pattern to OBS. The Discord-specific `paramFields` would include:

- `channelId` — select with `dynamicOptionsQuery: 'getVoiceChannels'`
- `muted` — select (Muted / Unmuted)
- `deafened` — select (Deafened / Undeafened)
- `volume` — range (0–200, suffix: '%')

The `DiscordRPCClient.queries` would expose `getVoiceChannels`.

Discord can also use `supportsDynamicImages: true` to show mute/deafen status
icons on buttons dynamically (when the user enables plugin images), and use
`hostAPI.log()` for log panel messages. It can subscribe to
`hostAPI.onDeviceConnected()` to re-render mute status icons when a new device
appears. Discord push-to-mute could use the new `down`/`up` triggers for
instant mute on press and unmute on release.

---

## 7. Implementation Phases

### Phase 1: Plugin Infrastructure (no behavior change)

Create the core plugin system without migrating existing integrations yet.
OBS and Discord continue working as-is while we build the framework alongside.

| Step | File | Description |
|---|---|---|
| 1a | `src/shared/plugin-types.ts` | New: `PluginManifest`, `ParamFieldDef`, `StateDisplayField`, `PluginHostAPI`, `PluginClient`, `PluginClientFactory` interfaces |
| 1b | `src/main/plugins/PluginRegistry.ts` | New: registry class — discover, register, buildHostAPI (with event subscriptions + ownership checks + pluginImageMap), wire IPC, connectAll, destroyAll |
| 1c | `src/shared/types.ts` | Add `PluginActionType`, widen `ActionType` union, add generic IPC channels, add `pluginSettings?` to `ProfileData`, add `pluginImage?` to `ButtonAppearance`, add `down`/`up` to `TriggerType` and `ButtonBinding` |
| 1d | `src/main/profiles/ProfileManager.ts` | Add `getPluginSettings(id)` / `setPluginSettings(id, settings)`, emit `profile-changed` and `page-changed` events |
| 1e | `src/main/index.ts` | Instantiate `PluginRegistry`, inject dependencies (DeviceManager, ProfileManager, ActionExecutor, LogCollector), call `discover()` + `wireIPC()` + `connectAll()`, add `destroyAll()` to shutdown, update `reapplyKey()` to composite plugin image layer (only when `pluginImage.enabled`) |
| 1f | `src/main/ipc/handlers.ts` | Add generic `plugin:*` IPC handlers (delegated from registry) |
| 1g | `src/preload/preload.ts` | Add generic `plugin*` bridge methods |
| 1h | `src/main/actions/ActionExecutor.ts` | Add `pluginRegistry` field + `plugin:*` dispatch in execute switch |
| 1i | `src/main/devices/ButtonInteractionManager.ts` | Add `down`/`up` trigger support: `downButtons`/`upButtons` sets, fire in `handleDown()`/`handleUp()`, update `updateBindingHints()` signature |
| 1j | `src/main/index.ts` | Update binding hint extraction to include `down`/`up` indices, update trigger callback to handle `down`/`up` triggers |

### Phase 2: Generic Plugin UI

| Step | File | Description |
|---|---|---|
| 2a | `src/renderer/components/PluginActionPanel.svelte` | New: data-driven panel rendered from `PluginManifest` — connection card, action selector, param fields (including 'image' type for custom button images), live status |
| 2b | `src/renderer/components/ActionPanel.svelte` | Add `plugin:*` branch that renders `<PluginActionPanel>`, add plugin options to action type dropdown, load/save plugin action config, add `down`/`up` to trigger type selector, add plugin image toggle to appearance editor (when plugin supports dynamic images) |

### Phase 3: Migrate OBS to Plugin

| Step | File | Description |
|---|---|---|
| 3a | `src/plugins/obs/manifest.ts` | New: OBS manifest from `obs-types.ts` |
| 3b | `src/plugins/obs/client.ts` | New: OBS client adapted from `OBSWebSocketClient.ts`, receives `PluginHostAPI`, implements `getButtonImage()`, uses `hostAPI.log()` and lifecycle events |
| 3c | `src/plugins/obs/index.ts` | New: re-export manifest + client factory |
| 3d | Remove OBS from core | Remove `obs-types.ts`, remove OBS sections from `types.ts`, `index.ts`, `handlers.ts`, `preload.ts`, `ActionExecutor.ts`, `ProfileManager.ts`, `ActionPanel.svelte` |
| 3e | `src/main/profiles/ProfileManager.ts` | v3 → v4 migration: move `obsConnectionSettings` to `pluginSettings.obs` |
| 3f | Validate | `npm run validate`, manual test |

### Phase 4: Migrate Discord to Plugin

Same as Phase 3 but for Discord. After this phase, the `integrations/` folder
only contains `ForegroundAppMonitor.ts` (which is not a plugin — it's a core
feature).

### Phase 5: Multi-Action Plugin Support

| Step | Description |
|---|---|
| 5a | Update multi-action step type dropdown to include `plugin:*` types |
| 5b | Update multi-action step config/save to use plugin param fields |

### Phase 6: External Plugins

#### 6.1 Distribution: npm Registry via Direct HTTP

Electron bundles its own Node.js runtime — users do **not** need Node.js or npm
installed. However, the `npm` CLI is **not** bundled with Electron either, so we
cannot shell out to `npm install`. Instead, we talk directly to the npm registry
over HTTP:

```
GET https://registry.npmjs.org/{package}            → full package metadata (all versions)
GET https://registry.npmjs.org/{package}/{version}   → specific version metadata + tarball URL
GET {tarball_url}                                    → download .tgz archive
```

This gives us everything we need without any CLI dependency.

#### 6.2 Plugin Discovery

Discoverability is the key UX question: how do users find plugins?

**Primary mechanism: npm keyword convention**

Plugins publish to npm with the keyword `catalyst-stream-controller-plugin` in their `package.json`:

```json
{
  "name": "catalyst-stream-controller-plugin-hue",
  "keywords": ["catalyst-stream-controller-plugin"],
  "catalyst-stream-controller-plugin": {
    "displayName": "Philips Hue",
    "description": "Control Hue lights from your Stream Deck",
    "icon": "https://example.com/hue-icon.png",
    "minHostVersion": "1.0.0"
  }
}
```

The npm registry supports text search with keyword filtering:

```
GET https://registry.npmjs.org/-/v1/search?text=keywords:catalyst-stream-controller-plugin&size=100
```

This returns package names, descriptions, versions, download counts, and
maintainer info — enough to populate a plugin browser UI.

**In-app plugin browser:**

```
┌─────────────────────────────────────────────────┐
│  🔌 Plugin Store                          [⟳]   │
├─────────────────────────────────────────────────┤
│  🔍 Search plugins...                           │
├─────────────────────────────────────────────────┤
│                                                 │
│  💡 Philips Hue              v1.2.0  [Install]  │
│  Control Hue lights from your Stream Deck       │
│  by @author · 1.2k downloads                    │
│                                                 │
│  🎮 Twitch                   v0.9.1  [Install]  │
│  Chat, alerts, and channel point actions        │
│  by @author · 850 downloads                     │
│                                                 │
│  ─── Installed ──────────────────────────────── │
│                                                 │
│  🎵 Spotify            v2.1.0 → v2.2.0 avail.  │
│  [v2.1.0 ▾]  [Update]  [Uninstall]             │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Curated list (optional, future):**

We can maintain a small JSON file in the app's GitHub repo listing
"recommended" or "verified" plugins. The plugin browser shows these
prominently and badges them as verified. This doesn't prevent users from
installing any `catalyst-stream-controller-plugin`-tagged package — it's just editorial curation.

**Alternative discovery: direct URL / tarball**

For plugins not published to npm (private, beta, or GitHub-only), users
can install by pasting a direct tarball URL or a GitHub release URL:

```
https://github.com/user/catalyst-stream-controller-plugin-foo/releases/download/v1.0.0/catalyst-stream-controller-plugin-foo-1.0.0.tgz
```

The install flow is the same — download, extract, validate, load.

#### 6.3 Plugin Format: Pre-Bundled Single File

Plugins must be **pre-bundled** by the author into a single JavaScript file
plus a manifest. This eliminates runtime dependency resolution entirely:

```
catalyst-stream-controller-plugin-hue/
├── package.json           # npm metadata + catalyst-stream-controller-plugin config
├── manifest.json          # PluginManifest (JSON, not TS)
└── dist/
    └── index.js           # bundled plugin code (esbuild/rollup output)
```

**Why require bundling?**

- No dependency hell — the plugin is self-contained
- No native module compilation issues (no `node-gyp`, no build tools)
- Fast install — just extract, no `npm install` step
- Predictable — what the author tested is exactly what runs
- Smaller — tree-shaking removes unused code

Plugin authors would run something like:

```bash
esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js
npm publish
```

We'll provide a `create-catalyst-stream-controller-plugin` scaffold/template that sets this up
automatically.

#### 6.4 Version Management

**Local plugin manifest** tracks installed plugins:

```json
// ~/.config/catalyst-stream-controller/plugins.json
{
  "installed": {
    "catalyst-stream-controller-plugin-hue": {
      "version": "1.2.0",
      "source": "npm",
      "installedAt": "2026-01-15T10:30:00Z"
    },
    "catalyst-stream-controller-plugin-twitch": {
      "version": "0.9.1",
      "source": "url",
      "sourceUrl": "https://github.com/.../v0.9.1/plugin.tgz",
      "installedAt": "2026-02-01T14:00:00Z"
    }
  }
}
```

**Version operations:**

| Operation | How |
|---|---|
| **Install specific version** | User picks from a dropdown populated by `GET /{package}` version list |
| **Install latest** | Resolve `latest` dist-tag from registry, download that version |
| **Upgrade** | Download new tarball, replace plugin directory, reload plugin |
| **Downgrade** | Same as install — pick any older version from the dropdown |
| **Check for updates** | Compare `plugins.json` version against registry `latest` tag |
| **Pin version** | Don't auto-update; only update when user explicitly clicks "Update" |
| **Uninstall** | Stop plugin, delete directory, remove from `plugins.json`, reload |

**No auto-updates.** Users explicitly choose when to upgrade. The plugin
browser shows a badge when a newer version is available, but never installs
it automatically. This lets users stay on a working version if a new release
introduces issues.

**Rollback scenario:**

1. User has `catalyst-stream-controller-plugin-hue@1.2.0` installed
2. Updates to `1.3.0` — something breaks
3. Opens plugin browser → clicks version dropdown → selects `1.2.0`
4. App downloads `1.2.0` tarball, replaces the plugin directory, reloads
5. Back to working state

#### 6.5 Install / Load Flow

```
User clicks "Install" in plugin browser
  │
  ├── 1. Fetch tarball URL from registry metadata
  ├── 2. Download .tgz to temp directory
  ├── 3. Extract to ~/.config/catalyst-stream-controller/plugins/{name}/
  ├── 4. Validate:
  │     ├── manifest.json exists and satisfies PluginManifest schema
  │     ├── dist/index.js exists
  │     ├── manifest.id matches package name convention
  │     └── minHostVersion is compatible (if specified)
  ├── 5. Update plugins.json
  ├── 6. Dynamic import() the plugin's dist/index.js
  ├── 7. Register with PluginRegistry (same as built-in plugins)
  └── 8. Show success notification

App startup:
  │
  ├── 1. Load built-in plugins (static imports, as today)
  ├── 2. Read plugins.json
  ├── 3. For each installed external plugin:
  │     ├── Validate manifest.json
  │     ├── Dynamic import() dist/index.js
  │     └── Register with PluginRegistry
  └── 4. connectAll() (handles both built-in and external)
```

#### 6.6 Sandboxing

Built-in plugins (OBS, Discord) run in the main process with full trust.
External plugins need guardrails:

**Phase 6a: Soft sandboxing (initial)**

- Host API is the only interface — plugins can't `require('fs')` to read
  arbitrary files because their bundled code runs through our loader
- Rate limiting on `setButtonImage()` and `setBrightness()` calls
  (e.g. max 10 calls/second per plugin)
- Timeout enforcement on `connect()`, `executeAction()`, `queries.*`
  (e.g. 30 second timeout, reject with error)
- Error boundaries — plugin exceptions are caught and logged, never crash
  the app
- Resource tracking — if a plugin leaks event listeners or timers, the
  registry cleans them up on destroy

**Phase 6b: Hard sandboxing (future, if needed)**

- Run each external plugin in a `child_process.fork()` worker
- The PluginHostAPI becomes an IPC bridge (JSON-RPC over the fork channel)
- Plugin crashes only kill the worker, not the app — auto-restart possible
- Memory limits via `--max-old-space-size` on the worker
- This is the VS Code extension host model

Hard sandboxing is significantly more complex (serialization overhead,
async-only API, worker lifecycle management) and is only warranted if the
plugin ecosystem grows large enough that untrusted code is a real concern.
Soft sandboxing is sufficient for an initial release.

#### 6.7 Plugin Author Experience

**`create-catalyst-stream-controller-plugin` template:**

```bash
npx create-catalyst-stream-controller-plugin my-plugin
```

Generates:

```
catalyst-stream-controller-plugin-my-plugin/
├── package.json           # pre-configured with catalyst-stream-controller-plugin keyword
├── tsconfig.json          # TypeScript config
├── src/
│   ├── manifest.ts        # PluginManifest template
│   ├── client.ts          # PluginClient template
│   └── index.ts           # re-exports
├── build.mjs              # esbuild script
└── README.md              # docs template
```

**Type package:**

We publish `@catalyst-stream-controller/plugin-types` to npm containing:
- `PluginManifest`, `ParamFieldDef`, `StateDisplayField`
- `PluginClient`, `PluginClientFactory`
- `PluginHostAPI`

Plugin authors `npm install -D @catalyst-stream-controller/plugin-types` for
full type checking during development.

**Local dev workflow:**

Plugin authors can symlink their plugin into the plugins directory for
live development:

```bash
ln -s ~/dev/catalyst-stream-controller-plugin-hue ~/.config/catalyst-stream-controller/plugins/catalyst-stream-controller-plugin-hue
```

The app loads it like any installed plugin. Combined with `esbuild --watch`,
this gives a fast dev loop (edit → rebuild → restart app).

#### 6.8 Implementation Steps

| Step | Description |
|---|---|
| 6a | **Plugin loader** — scan `~/.config/catalyst-stream-controller/plugins/`, validate `manifest.json`, dynamic `import()` dist/index.js, register with PluginRegistry |
| 6b | **npm registry client** — `PluginStoreClient` class: `search(query)`, `getVersions(name)`, `download(name, version)`, `getLatest(name)` — all via HTTP to registry.npmjs.org |
| 6c | **Install/uninstall logic** — download tarball, extract, validate, update `plugins.json`, register/unregister, reload |
| 6d | **Plugin browser UI** — new `PluginStore.svelte` page: search, browse, install, update, downgrade, uninstall, version picker |
| 6e | **Update checking** — on app launch, compare installed versions against registry `latest` tags, show badge on plugins with updates |
| 6f | **Soft sandboxing** — rate limiting on host API calls, timeout enforcement on async plugin methods, error boundaries around all plugin calls |
| 6g | **`create-catalyst-stream-controller-plugin` template** — npm package that scaffolds a new plugin project with TypeScript, esbuild, manifest template |
| 6h | **`@catalyst-stream-controller/plugin-types`** — publish type definitions package to npm for plugin authors |
| 6i | **Direct URL install** — support installing from a tarball URL (GitHub releases, private registries) |
| 6j | **Hard sandboxing (future)** — `child_process.fork()` worker per plugin, IPC bridge for PluginHostAPI, worker crash recovery |

---

## 8. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      RENDERER PROCESS                       │
│                                                             │
│  ActionPanel.svelte                                         │
│    ├── Built-in action UIs (hotkey, launch, command, ...)   │
│    ├── Trigger selector (press, longPress, doubleTap,       │
│    │                      down, up)                         │
│    ├── {#if actionType.startsWith('plugin:')}               │
│    │     <PluginActionPanel manifest={...} />               │
│    │       ├── Connection card (from manifest fields)       │
│    │       ├── Action <select> (from manifest.actionLabels) │
│    │       ├── Param fields (from manifest.paramFields)     │
│    │       │     └── 'image' type → file picker for icons   │
│    │       └── Live status (from manifest.stateDisplay)     │
│    └── Appearance editor                                    │
│          ├── Background color, label, user icon (existing)  │
│          └── Plugin Image toggle (when plugin supports it)  │
│                ├── ☑ Show plugin status image                │
│                └── Image Fit: [contain ▾]                   │
│                                                             │
│  window.osc.pluginConnect(id, settings)                     │
│  window.osc.pluginQuery(id, 'getScenes')                   │
│  window.osc.pluginGetInfo(id) → version/status check        │
│  window.osc.onPluginStateChanged(id, callback)              │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge)
┌──────────────────────────▼──────────────────────────────────┐
│                       MAIN PROCESS                          │
│                                                             │
│  ButtonInteractionManager                                   │
│    ├── handleDown() → fires 'down' (immediate)              │
│    │                → fires 'press' (instant if no LH/DT)   │
│    │                → starts longPress timer                 │
│    └── handleUp()  → fires 'up' (immediate)                 │
│                    → fires 'press'/'doubleTap' (deferred)   │
│                                                             │
│  PluginRegistry                                             │
│    ├── plugins: Map<string, { manifest, client }>           │
│    ├── pluginSubscriptions: Map<string, unsub[]>            │
│    ├── pluginImageMap: Map<string, { pluginId, dataUri }>   │
│    ├── wireIPC() → generic plugin:* handlers                │
│    ├── connectAll() → auto-connect plugins with settings    │
│    ├── buildHostAPI(id) → scoped PluginHostAPI per plugin   │
│    └── destroyAll() → shutdown + unsubscribe + clear images │
│                                                             │
│  PluginHostAPI (per plugin, scoped)                         │
│    ├── setBrightness() → DeviceManager                      │
│    ├── setButtonImage() → validate opt-in + ownership →     │
│    │                      pluginImageMap + re-render         │
│    ├── clearButtonImage() → clear from map + re-render      │
│    ├── executeAction() → ActionExecutor (all built-in)      │
│    ├── executePluginAction() → target plugin's client       │
│    ├── getPluginInfo() / getRegisteredPlugins()             │
│    ├── onButtonDown/Up() → DeviceManager events             │
│    ├── onKnobRotate/Press() → DeviceManager events          │
│    ├── onProfileChanged/PageChanged() → ProfileManager      │
│    ├── onDeviceConnected/Disconnected() → DeviceManager     │
│    ├── log() → LogCollector (prefixed)                      │
│    └── getOwnSettings() / saveOwnSettings()                 │
│                                                             │
│  ActionExecutor                                             │
│    └── execute('plugin:obs', config)                        │
│          → registry.getPlugin('obs').client.executeAction() │
│                                                             │
│  ProfileManager                                             │
│    └── pluginSettings: { obs: {...}, discord: {...} }       │
│                                                             │
│  Key Rendering Pipeline (reapplyKey)                        │
│    ├── 1. backgroundColor                                   │
│    ├── 2. user icon (if set)                                │
│    ├── 3. plugin image (if pluginImage.enabled AND data)    │
│    │       └── check pluginImageMap OR getButtonImage()     │
│    └── 4. label text (always on top)                        │
│                                                             │
│  PluginClient (per plugin)                                  │
│    ├── connect() / disconnect()                             │
│    ├── getState() / setOnStateChanged()                     │
│    ├── executeAction(config)                                │
│    ├── getButtonImage?(config) → only if user opted in      │
│    ├── queries: { getScenes(), getInputs() }                │
│    └── destroy()                                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. Key Design Decisions

### Why not custom Svelte components per plugin?

Rendering arbitrary Svelte components from plugins would require either:
- Dynamic `import()` of `.svelte` files at runtime (Vite doesn't support this in
  production builds for Electron)
- An iframe-based sandbox (heavy, poor UX)
- A plugin build step that pre-compiles Svelte (complex DX)

Instead, the **manifest-driven approach** generates UI from declarative field
definitions. This covers 95%+ of integration UIs (dropdowns, text inputs, toggles,
sliders, image pickers). If a plugin needs truly custom UI in the future, we can
add an escape hatch via an HTML string or web component.

### Why `plugin:obs` prefix instead of just `obs`?

- Clear separation between built-in and plugin action types
- No risk of namespace collision if a plugin ID matches a built-in type
- Easy pattern matching: `action.type.startsWith('plugin:')`
- The prefix can be stripped for display: `manifest.name`

### Why keep built-in actions (hotkey, launch, etc.) outside the plugin system?

These are **core platform capabilities** that don't connect to external services.
They have no connection settings, no live state, no reconnection logic. Forcing
them into the plugin model would add unnecessary complexity. The plugin system is
specifically designed for **external service integrations**. However, plugins
can **invoke** all built-in capabilities via `hostAPI.executeAction()`.

### Why a single generic IPC channel set instead of per-plugin channels?

- **Scalability** — 10 plugins × 7 channels = 70 registered handlers vs. 7 generic ones
- **Security** — preload only exposes a fixed API surface; the plugin ID is just a
  parameter, not a new channel
- **Simplicity** — the registry dispatches internally; no code generation needed

### Why inject PluginHostAPI instead of exposing services directly?

- **Scoping** — Each plugin gets its own API instance where `log()` is auto-prefixed,
  `getOwnSettings()` reads only that plugin's namespace, and `setButtonImage()`
  validates ownership
- **Testability** — Easy to mock in tests: pass a fake `PluginHostAPI` to the factory
- **Security** — The host API is a controlled surface. Plugins can't access
  `DeviceManager` or `ProfileManager` directly, only the capabilities we expose.
- **Future sandboxing** — When Phase 6 runs plugins in forked processes, the host API
  becomes the IPC bridge contract

### Why opt-in plugin images instead of automatic overlay?

The previous design automatically showed plugin images on any button with a
matching action type. This was too opinionated:

- **User control** — Users should decide what renders on their buttons. Some may
  want a clean custom icon without a plugin overlay. Others may want the plugin's
  dynamic status image instead of their own icon. The opt-in toggle lets them choose.
- **Both icons and plugin images** — Users can have their own icon AND enable
  plugin images. The plugin image composites above the user icon (useful for
  status badges/indicators on top of a custom icon).
- **Validation as guard rail** — `setButtonImage()` validates that the user enabled
  plugin images before accepting the image. This prevents plugins from drawing on
  buttons without user consent.
- **Persisted preference** — The `pluginImage.enabled` and `pluginImage.fit`
  settings persist with the profile, so the user's choice survives app restarts.
  The actual image data is runtime-only.

### Why down/up triggers instead of extending press/longPress?

The existing `press`, `longPress`, and `doubleTap` triggers are **semantic** —
they're the output of a state machine that interprets raw button events. Adding
`down` and `up` as **physical** triggers gives users direct access to the raw
button events without interfering with the semantic trigger logic:

- **Hold-for-action** — `down` = "start", `up` = "stop". Perfect for push-to-talk,
  push-to-mute, hold-to-record, or any toggle-while-held pattern.
- **No interference** — `down`/`up` fire independently of the `press`/`longPress`/
  `doubleTap` state machine. The semantic triggers continue working exactly as before.
- **Zero latency** — `down` fires immediately on physical press, no detection delay.
  `up` fires immediately on release. This is critical for latency-sensitive actions
  like push-to-talk.
- **Compatible with all combinations** — Users can configure any combination of
  triggers. `down` + `up` for hold patterns, `press` for tap, `longPress` for
  secondary action — all on the same button.

### Token / credential storage

Plugin connection settings (including OAuth tokens) are stored in the profile
data file, same as today. For a future Phase 6 (external plugins), we may want to
move credentials to the OS keychain via `safeStorage`.

### Button image ownership model

Plugins can only set images on buttons where:
1. The **user opted in** — `appearance.pluginImage.enabled === true`
2. The **plugin owns a trigger** — at least one trigger (`press`, `longPress`,
   `doubleTap`, `down`, `up`) has `type === 'plugin:{pluginId}'`

Both checks are enforced by `hostAPI.setButtonImage()`. The `getButtonImage()`
pull path applies the same checks — the core only calls it when both conditions
are met.

Rationale:
- Users retain full control — no plugin can draw on their buttons without consent
- Plugins can't interfere with each other's visuals
- Plugins can't draw on built-in action buttons
- Ownership checks all trigger types, not just `press` — a plugin that provides
  a `longPress` or `down` action on a button should still be able to show its
  status image
- Clear mental model: "I enabled plugin images on this button, the plugin provides
  the content"

Exception: If a future use case requires cross-plugin image setting (e.g. a
"notification" plugin that badges any button), we can add an opt-in permission
flag in the manifest.

### Plugin-to-plugin action execution

Plugins can call other plugins' actions via `hostAPI.executePluginAction(pluginId, config)`.
This is validated:
1. The target plugin must be registered (`getPlugin(id)` returns non-null)
2. The target plugin must be connected (`client.isConnected()` returns true)
3. If either check fails, the call throws with a descriptive error

Plugins can discover available plugins via `hostAPI.getPluginInfo(pluginId)` (returns
`null` if not installed, or `{ id, name, version, connected }` if present) and
`hostAPI.getRegisteredPlugins()` (returns all plugin IDs).

This enables use cases like:
- A "scene automator" plugin that also adjusts Hue lights via the Hue plugin
- A "macro" plugin that chains actions across multiple integrations
- Users who want programmatic multi-step workflows beyond the UI's multi-action

---

## 10. Risk Assessment

| Risk | Mitigation |
|---|---|
| Manifest-driven UI too limiting for complex plugins | Start with OBS + Discord which are representative. Add escape hatches later if needed. |
| Plugin load order / dependency issues | Built-in plugins have no inter-dependencies. External plugin deps are a Phase 6 concern. |
| ProfileData v3→v4 migration breaks existing profiles | Write careful migration in ProfileManager.init(). Test with real profile files. |
| Performance: scanning plugins at startup | Built-in plugins are static imports (no filesystem scan). Only Phase 6 external plugins would scan. |
| Type safety loss from `Record<string, unknown>` | Plugin authors lose internal type checking. Mitigate by providing a `definePlugin<T>()` helper with generics. |
| Host API abuse by misbehaving plugin | Built-in plugins are trusted. Add rate limiting / sandboxing in Phase 6 for external plugins. |
| Dynamic image rendering performance | `getButtonImage()` is synchronous and called during key rendering. Plugins must cache images, not generate them on every call. Document this constraint. |
| Event listener leaks | Registry tracks all subscriptions per plugin and unsubscribes on destroy. Each `on*` method returns an unsubscribe function. |
| Plugin-to-plugin circular calls | No built-in guard against A→B→A loops. Mitigate by documenting best practices. Add a call depth counter in Phase 6 if needed. |
| Plugin image consent bypass | setButtonImage validates `pluginImage.enabled` before accepting images. getButtonImage path also checks. No pathway for plugins to bypass user consent. |
| Layered image compositing performance | Canvas compositing is already used for key rendering. Adding one more layer is negligible. Plugin images should be pre-sized to ~96×96. |
| down/up trigger confusion with press | Document interaction clearly. Tooltip in UI explains that `down`+`press` both fire on a tap. Suggest using `down`+`up` as a pair without `press`. |
| Backward compatibility of ButtonBinding | `down` and `up` are optional fields. Existing profiles missing them work unchanged. |
| npm registry unavailable | Cache last-known search results locally. Already-installed plugins work offline — registry is only needed for install/update. |
| Malicious external plugin | Soft sandboxing (rate limiting, error boundaries, scoped Host API) mitigates abuse. Hard sandboxing (forked worker) available as escalation. Built-in plugins are trusted. |
| External plugin has native dependencies | Require pre-bundled single-file output. Plugins that need native modules must compile them into their bundle or use pure-JS alternatives. Document this constraint. |
| Plugin tarball extraction path traversal | Validate all extracted file paths are within the target directory (no `../../` escapes). Use a safe extraction library. |
| Registry API rate limiting | npm allows ~4800 requests/hour unauthenticated. Plugin browser caches search results for 5 minutes. Version lists cached for 1 hour. Well within limits for normal use. |
| Plugin version incompatible with host | `minHostVersion` field in plugin's package.json `catalyst-stream-controller-plugin` config. Install flow rejects incompatible plugins with a clear error message. |
| Stale plugin after host upgrade | Plugin browser shows a warning if a plugin hasn't been updated in 12+ months. Does not block installation — just informational. |

---

## 11. Testing Checklist

- [ ] Built-in plugins (OBS, Discord) auto-discovered and registered
- [ ] Plugin connection settings persist and migrate from v3
- [ ] Auto-connect works for plugins with `autoConnect: true`
- [ ] Action selector shows plugin action types dynamically
- [ ] PluginActionPanel renders correct fields for each action
- [ ] Dynamic dropdowns (scenes, inputs, channels) populate from queries
- [ ] Live state updates display in the status panel
- [ ] Multi-action steps can include plugin action types
- [ ] Plugin cleanup runs on app shutdown (no hanging sockets/timers)
- [ ] Removing a plugin doesn't crash — orphaned actions show "(Plugin not found)"
- [ ] `npm run validate` passes at every phase
- [ ] PluginHostAPI.setBrightness() controls device brightness and persists
- [ ] PluginHostAPI.setButtonImage() validates user opt-in (pluginImage.enabled)
- [ ] PluginHostAPI.setButtonImage() validates plugin ownership across all triggers
- [ ] PluginHostAPI.setButtonImage() rejects when pluginImage not enabled
- [ ] PluginHostAPI.setButtonImage() rejects when no trigger matches the plugin
- [ ] PluginHostAPI.setButtonImage() accepts when longPress/doubleTap/down/up has plugin type
- [ ] PluginHostAPI.clearButtonImage() reverts to user appearance
- [ ] Plugin images stored in runtime map, NOT persisted to profile file
- [ ] Plugin images cleared when plugin disconnects
- [ ] Plugin images cleared when user disables pluginImage.enabled
- [ ] Plugin `getButtonImage()` only called when pluginImage.enabled
- [ ] Plugin `getButtonImage()` returning null skips the plugin image layer
- [ ] PluginHostAPI.executeAction() works for all built-in types
- [ ] PluginHostAPI.executePluginAction() dispatches to target plugin
- [ ] PluginHostAPI.executePluginAction() throws for unregistered/disconnected plugins
- [ ] PluginHostAPI.getPluginInfo() returns correct info or null
- [ ] PluginHostAPI.log() appears in log panel with plugin name prefix
- [ ] PluginHostAPI.onButtonDown/Up() fires for device button events
- [ ] PluginHostAPI.onKnobRotate/Press() fires for knob events
- [ ] PluginHostAPI.onProfileChanged() fires on profile switch
- [ ] PluginHostAPI.onPageChanged() fires on page navigation
- [ ] PluginHostAPI.onDeviceConnected/Disconnected() fires correctly
- [ ] All event subscriptions are cleaned up on plugin.destroy()
- [ ] PluginHostAPI settings are scoped — plugins can't read/write other plugins' settings
- [ ] Button rendering: bg → user icon → plugin image (when enabled) → label
- [ ] Plugin image toggle appears in appearance editor for plugin action types
- [ ] Plugin image toggle hidden for built-in action types
- [ ] Plugin image fit selector works (contain, cover, stretch, none)
- [ ] `down` trigger fires immediately on physical button-down
- [ ] `up` trigger fires immediately on physical button-up
- [ ] `down`/`up` fire independently of press/longPress/doubleTap state machine
- [ ] `down` fires before longPress timer starts
- [ ] `up` fires regardless of whether longPress fired
- [ ] Configuring `down` without `up` (or vice versa) works correctly
- [ ] `down`/`up` triggers appear in trigger type selector UI
- [ ] Existing profiles without `down`/`up` bindings load without errors
- [ ] `updateBindingHints()` correctly tracks down/up button indices
- [ ] External plugin loader scans plugins directory and loads valid plugins
- [ ] External plugin loader skips directories with invalid/missing manifest.json
- [ ] External plugin loader skips plugins with incompatible minHostVersion
- [ ] npm registry search returns results filtered by `catalyst-stream-controller-plugin` keyword
- [ ] Version list populated from registry metadata
- [ ] Plugin install downloads tarball, extracts, validates, and registers
- [ ] Plugin install rejects tarballs with path traversal attempts
- [ ] Plugin uninstall stops plugin, removes directory, updates plugins.json
- [ ] Plugin upgrade replaces directory contents and reloads
- [ ] Plugin downgrade installs older version correctly
- [ ] Direct URL install works for GitHub release tarballs
- [ ] Update check correctly identifies plugins with newer versions available
- [ ] Installed plugins persist and reload across app restarts
- [ ] Plugin browser UI shows installed/available plugins correctly
- [ ] Rate limiting on setButtonImage/setBrightness enforced for external plugins
- [ ] Timeout enforcement on plugin connect/executeAction/queries
- [ ] Plugin exceptions caught by error boundary — app does not crash
- [ ] Plugin resource cleanup works on uninstall (subscriptions, timers, images)
