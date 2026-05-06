# Plugin Development Guide

This guide covers everything you need to build a plugin for **Catalyst Stream Controller**. Plugins can integrate external services, control hardware, or add new action types — all without modifying the core application.

---

## Overview

A plugin consists of three files:

```
src/plugins/my-plugin/
├── manifest.ts   # Declares actions, connection fields, state, icons
├── client.ts     # Implements connection logic and action execution
└── index.ts      # Re-exports the manifest and client factory as a PluginPackage
```

The system is **manifest-driven**: define your actions, parameters, and connection fields declaratively — the UI is generated automatically.

---

## Quick Start

### 1. Create the Manifest

The manifest declares what your plugin does: its actions, connection settings, live state, and custom icons.

```ts
// src/plugins/my-plugin/manifest.ts
import type { PluginManifest } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

export const manifest: PluginManifest = {
  id: 'my-plugin',
  name: 'My Plugin',
  version: '1.0.0',

  actions: {
    'do-something': {
      label: 'Do Something',
      params: {
        target: {
          key: 'target',
          label: 'Target',
          type: 'text',
          placeholder: 'Enter a value'
        }
      },
      defaultAppearance: defaultLayers('#2a4080', 'plugin:my-plugin:icon', 'Do It')
    }
  },

  connection: {
    defaults: { host: 'localhost', port: 8080, autoConnect: false },
    fields: [
      { key: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { key: 'port', label: 'Port', type: 'number', min: 1, max: 65535 },
      { key: 'autoConnect', label: 'Auto-connect on startup', type: 'boolean' }
    ]
  },

  state: {
    defaults: { connected: false, status: null },
    display: [
      { key: 'status', label: 'Status', icon: '📡', format: 'text' }
    ]
  },

  iconPacks: [
    {
      label: 'My Plugin',
      icons: [
        {
          id: 'plugin:my-plugin:icon',
          label: 'My Icon',
          svg: svg('<circle cx="48" cy="48" r="20" fill="white" stroke="none"/>')
        }
      ]
    }
  ]
};
```

### 2. Create the Client

The client implements connection management, action execution, and optional dynamic queries.

```ts
// src/plugins/my-plugin/client.ts
import type {
  PluginClient,
  PluginClientFactory,
  PluginHostAPI
} from '../../shared/plugin-types';

interface MyState {
  connected: boolean;
  status: string | null;
}

class MyPluginClient implements PluginClient {
  private state: MyState = { connected: false, status: null };
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
  }

  async connect(settings: Record<string, unknown>): Promise<void> {
    const host = settings.host as string;
    const port = settings.port as number;
    // ... establish connection ...
    this.hostAPI.log('info', `Connected to ${host}:${port}`);
    this.updateState({ connected: true, status: 'Online' });
  }

  async disconnect(): Promise<void> {
    // ... clean up connection ...
    this.updateState({ connected: false, status: null });
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  setOnStateChanged(handler: (state: Record<string, unknown>) => void): void {
    this.onStateChangedHandler = handler;
  }

  async executeAction(config: Record<string, unknown>): Promise<void> {
    const action = config.action as string;
    switch (action) {
      case 'do-something':
        // ... perform the action ...
        this.hostAPI.showFeedback(config.keyIndex as number, 'ok');
        break;
    }
  }

  destroy(): void {
    // Clean up timers, sockets, etc.
  }

  // Optional: dynamic dropdown queries
  queries = {
    getTargets: async (): Promise<Array<{ value: string; label: string }>> => {
      return [
        { value: 'a', label: 'Target A' },
        { value: 'b', label: 'Target B' }
      ];
    }
  };

  private updateState(patch: Partial<MyState>): void {
    Object.assign(this.state, patch);
    this.onStateChangedHandler?.({ ...this.state });
  }
}

export const createClient: PluginClientFactory = (hostAPI) => new MyPluginClient(hostAPI);
```

### 3. Create the Package Export

```ts
// src/plugins/my-plugin/index.ts
import type { PluginPackage } from '../../shared/plugin-types';
import { manifest } from './manifest';
import { createClient } from './client';

export const myPlugin: PluginPackage = {
  manifest,
  createClient
};
```

### 4. Register the Plugin

In `src/main/index.ts`, import and register your plugin:

```ts
import { myPlugin } from '../plugins/my-plugin';

// Inside the initialization block:
pluginRegistry.registerPlugin(myPlugin.manifest, myPlugin.createClient, 'built-in');
```

---

## Manifest Reference

### `PluginManifest`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier (e.g. `'obs'`, `'discord'`) |
| `name` | `string` | Yes | Display name shown in the UI |
| `description` | `string` | No | Short description for settings page |
| `version` | `string` | Yes | Semantic version |
| `actions` | `Record<string, ActionDefinition>` | Yes | Actions the plugin exposes |
| `connection` | `{ defaults, fields }` | No | Connection settings schema. Omit for plugins that don't need external connections |
| `state` | `{ defaults, display? }` | No | Live state configuration. Omit for stateless plugins |
| `iconPacks` | `PluginIconPack[]` | No | Custom icons for the icon picker |

### `ActionDefinition`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | `string` | Yes | Display label in action dropdowns |
| `params` | `Record<string, ParamFieldDef>` | No | Parameter fields for this action |
| `defaultAppearance` | `{ layers: Layer[] }` | No | Default button appearance when action is assigned |

### `ParamFieldDef`

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | Unique key matching the config property name |
| `label` | `string` | Human-readable label |
| `type` | `'text' \| 'password' \| 'number' \| 'boolean' \| 'select' \| 'range' \| 'image'` | Input widget type |
| `placeholder` | `string` | Placeholder text (text/password) |
| `options` | `Array<{ value, label }>` | Static options (select) |
| `dynamicOptionsQuery` | `string` | Name of a query method on the client for dynamic options (select). Overrides static options when connected |
| `min` / `max` / `step` | `number` | Constraints (number/range) |
| `suffix` | `string` | Suffix shown after value (range), e.g. `'%'` |
| `accept` | `string` | Accepted MIME types (image), default `'image/*'` |
| `helpText` | `string` | Help text shown below the field |

### `StateDisplayField`

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` | State property key |
| `label` | `string` | Display label |
| `icon` | `string` | Optional emoji prefix |
| `format` | `string` | `'text'`, `'boolean-on-off'`, or `'percent'` |

---

## Client Interface

Every plugin client must implement `PluginClient`:

```ts
interface PluginClient {
  connect(settings: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  getState(): Record<string, unknown>;
  setOnStateChanged(handler: (state: Record<string, unknown>) => void): void;
  executeAction(config: Record<string, unknown>): Promise<void>;
  destroy(): void;

  // Optional
  queries?: Record<string, () => Promise<Array<{ value: string; label: string }>>>;
  getButtonImage?(actionConfig: Record<string, unknown>): string | null;
}
```

### Lifecycle

1. **Construction** — `createClient(hostAPI)` is called once during plugin registration. Store the `hostAPI` reference.
2. **Connect** — `connect(settings)` is called when the user clicks "Connect" or on startup if `autoConnect` is true.
3. **Execute** — `executeAction(config)` is called each time a button with this plugin's action type is pressed.
4. **Disconnect** — `disconnect()` is called when the user disconnects or switches away.
5. **Destroy** — `destroy()` is called on app shutdown. Clean up all resources (timers, sockets, event listeners).

### Dynamic Queries

To populate `select` dropdowns with live data (e.g. a list of scenes from OBS), define query methods:

```ts
// In the manifest:
params: {
  sceneName: {
    key: 'sceneName',
    label: 'Scene',
    type: 'select',
    dynamicOptionsQuery: 'getScenes'  // Must match a key in client.queries
  }
}

// In the client:
queries = {
  getScenes: async () => {
    return this.scenes.map(s => ({ value: s.name, label: s.name }));
  }
};
```

### Dynamic Button Images

Plugins can render custom images on buttons at runtime. This requires:

1. The user enabling `pluginImage.enabled` in the button's appearance settings
2. The plugin owning at least one trigger on the button

**Option A: Reactive images via `getButtonImage()`** — Return an image data URI based on config and current state. Called by the renderer on each render cycle.

```ts
getButtonImage(actionConfig: Record<string, unknown>): string | null {
  const scene = actionConfig.sceneName as string;
  const isActive = this.state.currentScene === scene;
  return this.hostAPI.createImage.solidColor(isActive ? '#00ff00' : '#333', scene);
}
```

**Option B: Push images via `setButtonImage()`** — Push image updates from the plugin whenever state changes.

```ts
this.hostAPI.setButtonImage(keyIndex, imageDataUri, deviceSerial);
// Clear when done:
this.hostAPI.clearButtonImage(keyIndex, deviceSerial);
```

---

## Host API

The `PluginHostAPI` is passed to your client factory and provides access to core functionality.

### Device Control

```ts
hostAPI.setBrightness(value: number, deviceSerial?: string): Promise<void>
hostAPI.setButtonImage(keyIndex: number, imageDataUri: string, deviceSerial?: string): Promise<void>
hostAPI.clearButtonImage(keyIndex: number, deviceSerial?: string): Promise<void>
hostAPI.getDevices(): Array<{ serial, name, rows, cols, keyCount, hasKnobs }>
```

### Action Execution

```ts
// Execute a built-in action
hostAPI.executeAction(type: BuiltinActionType, config): Promise<void>
// Execute an action on another plugin
hostAPI.executePluginAction(pluginId: string, config): Promise<void>
```

### Plugin Discovery

```ts
hostAPI.getPluginInfo(pluginId: string): { id, name, version, connected } | null
hostAPI.getRegisteredPlugins(): string[]
```

### Events

Subscribe to device and lifecycle events. Each returns an unsubscribe function.

```ts
hostAPI.onButtonDown(callback: (keyIndex, deviceSerial) => void): () => void
hostAPI.onButtonUp(callback: (keyIndex, deviceSerial) => void): () => void
hostAPI.onKnobRotate(callback: (knobId, direction, deviceSerial) => void): () => void
hostAPI.onKnobPress(callback: (knobId, deviceSerial) => void): () => void
hostAPI.onProfileChanged(callback: (profileId) => void): () => void
hostAPI.onPageChanged(callback: (pageId) => void): () => void
hostAPI.onDeviceConnected(callback: (serial, name) => void): () => void
hostAPI.onDeviceDisconnected(callback: (serial) => void): () => void
hostAPI.onSystemWakeUp(callback: () => void): () => void
```

### Visual Feedback

```ts
// Show a brief overlay on a key: 'ok' (green check) or 'alert' (yellow warning)
hostAPI.showFeedback(keyIndex: number, feedbackType: 'ok' | 'alert', durationMs?: number): void
```

### Logging

```ts
// Messages appear in the app's log panel, prefixed with your plugin name
hostAPI.log(level: 'info' | 'warn' | 'error', message: string): void
```

### Settings

```ts
hostAPI.getOwnSettings(): Record<string, unknown>
hostAPI.saveOwnSettings(settings: Record<string, unknown>): Promise<void>
```

### Image Generation

```ts
hostAPI.createImage.solidColor(color: string, text?: string): string
hostAPI.createImage.textImage({
  text: string,
  textColor?: string,
  bgColor?: string,
  fontSize?: number,
  bold?: boolean
}): string
```

---

## Manifest Helpers

Two utility functions are available from `../manifest-helpers` to reduce boilerplate:

### `defaultLayers(bg, iconId, text, textColor?)`

Creates a standard 3-layer button appearance: solid background → centered icon → bold bottom-center label.

```ts
import { defaultLayers } from '../manifest-helpers';

defaultAppearance: defaultLayers('#2a4080', 'plugin:my-plugin:icon', 'Label')
```

### `svg(body)`

Wraps SVG body elements in a standard 96×96 icon shell with white strokes:

```ts
import { svg } from '../manifest-helpers';

svg('<circle cx="48" cy="48" r="20" fill="white" stroke="none"/>')
// → <svg xmlns="..." viewBox="0 0 96 96" fill="none" stroke="white" ...>...</svg>
```

---

## Custom Icons

Plugins can register icons that appear in the icon picker. Icon IDs **must** be namespaced as `plugin:{pluginId}:{name}`:

```ts
iconPacks: [
  {
    label: 'My Plugin',      // Tab label in the icon picker
    icons: [
      {
        id: 'plugin:my-plugin:bolt',
        label: 'Lightning Bolt',
        svg: svg('<path d="M52 16 L28 52 H44 L40 80 L68 44 H52 Z" fill="white" stroke="none"/>')
      }
    ]
  }
]
```

If the `label` matches an existing tab (e.g. `'Media'`), icons are appended to that tab. SVGs should use a 96×96 viewBox with white strokes on a transparent background.

Reference icons in action default appearances:

```ts
defaultAppearance: defaultLayers('#333', 'plugin:my-plugin:bolt', 'Zap')
```

---

## Action Triggers

Buttons support multiple trigger types. Plugin actions can be assigned to any of them:

| Trigger | Behavior |
|---------|----------|
| `press` | Standard tap (deferred if longPress/doubleTap exist) |
| `longPress` | Hold > 500ms (configurable) |
| `doubleTap` | Two taps within 300ms (configurable) |
| `down` | Immediate on physical press |
| `up` | Immediate on physical release |

The `down`/`up` triggers are useful for hold-for-action patterns (e.g. push-to-talk, record while held).

---

## Auto-Reconnect Pattern

Most plugins that connect to external services should implement auto-reconnect. Here's the standard pattern:

```ts
private intentionalDisconnect = false;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

async connect(settings: Record<string, unknown>): Promise<void> {
  this.intentionalDisconnect = false;
  this.clearReconnectTimer();
  try {
    // ... establish connection ...
  } catch (error) {
    if (!this.intentionalDisconnect) {
      this.scheduleReconnect();
    }
    throw error;
  }
}

async disconnect(): Promise<void> {
  this.intentionalDisconnect = true;
  this.clearReconnectTimer();
  // ... close connection ...
}

private scheduleReconnect(): void {
  this.clearReconnectTimer();
  this.reconnectTimer = setTimeout(() => {
    if (!this.intentionalDisconnect && this.settings) {
      this.connect(this.settings).catch(() => {});
    }
  }, 5000);
}

private clearReconnectTimer(): void {
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

destroy(): void {
  this.intentionalDisconnect = true;
  this.clearReconnectTimer();
  // ... additional cleanup ...
}
```

---

## Built-in Plugin Examples

The codebase includes several built-in plugins you can reference:

| Plugin | Directory | Highlights |
|--------|-----------|------------|
| OBS Studio | `src/plugins/obs/` | WebSocket connection, 12 actions, dynamic queries, state tracking, custom icons |
| Discord | `src/plugins/discord/` | RPC protocol, OAuth flow, voice channel queries |
| Philips Hue | `src/plugins/hue/` | REST API, color conversion, 14 actions, state polling |
| MIDI | `src/plugins/midi/` | Native module loading, raw byte protocol, transport abstraction |
| Twitch | `src/plugins/twitch/` | Chat integration, EventSub webhooks |
| YouTube | `src/plugins/youtube/` | YouTube Live API integration |
