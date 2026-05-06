import type { PluginManifest, PluginIconPack } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

/**
 * OBS Studio plugin manifest.
 *
 * Describes all OBS actions, their parameters, connection settings,
 * and live state fields so the generic plugin UI can render the
 * configuration panel without any OBS-specific code.
 */

/**
 * Plugin-specific icon pack for OBS streaming actions.
 *
 * This demonstrates how any plugin can ship its own icons:
 *
 * 1. Define an `iconPacks` array on the manifest with one or more packs.
 *    If the `label` matches a built-in tab (e.g. 'Media'), the icons are
 *    appended to that tab. Otherwise a new tab is created.
 *
 * 2. Each icon ID must be namespaced as `plugin:{pluginId}:{name}`
 *    (e.g. `'plugin:obs:broadcast'`) so icons can never collide with
 *    built-in icons or other plugins. The core validates this at load
 *    time and silently drops mis-namespaced icons.
 *
 * 3. Reference icons in action `defaultAppearance` via
 *    `iconRef('plugin:obs:broadcast')`.
 */
const obsIconPacks: PluginIconPack[] = [
  {
    label: 'Streaming',
    icons: [
      {
        id: 'plugin:obs:broadcast',
        label: 'Go Live',
        svg: svg(
          '<circle cx="48" cy="48" r="8" fill="red" stroke="none"/><path d="M30 66 a28 28 0 0 1 0 -36" stroke="red"/><path d="M66 30 a28 28 0 0 1 0 36" stroke="red"/><path d="M22 74 a40 40 0 0 1 0 -52" stroke="red"/><path d="M74 22 a40 40 0 0 1 0 52" stroke="red"/>'
        )
      },
      {
        id: 'plugin:obs:stream-off',
        label: 'Stream Off',
        svg: svg(
          '<circle cx="48" cy="48" r="8" fill="white" stroke="none"/><path d="M30 66 a28 28 0 0 1 0 -36"/><path d="M66 30 a28 28 0 0 1 0 36"/><line x1="20" y1="20" x2="76" y2="76" stroke="red" stroke-width="5"/>'
        )
      },
      {
        id: 'plugin:obs:scene',
        label: 'Scene',
        svg: svg(
          '<rect x="16" y="24" width="64" height="48" rx="4"/><line x1="16" y1="42" x2="80" y2="42"/><line x1="48" y1="42" x2="48" y2="72"/><circle cx="48" cy="33" r="4" fill="white" stroke="none"/>'
        )
      },
      {
        id: 'plugin:obs:transition',
        label: 'Transition',
        svg: svg(
          '<rect x="14" y="24" width="30" height="24" rx="3"/><rect x="52" y="48" width="30" height="24" rx="3"/><path d="M44 36 L52 36 L52 48" stroke-dasharray="4 3"/><polyline points="48,44 52,48 56,44"/>'
        )
      },
      {
        id: 'plugin:obs:screen-share',
        label: 'Screen Share',
        svg: svg(
          '<rect x="14" y="20" width="68" height="48" rx="4"/><line x1="36" y1="68" x2="60" y2="68"/><line x1="48" y1="68" x2="48" y2="76"/><line x1="36" y1="76" x2="60" y2="76"/><polyline points="48,36 48,54"/><polyline points="40,44 48,36 56,44"/>'
        )
      },
      {
        id: 'plugin:obs:chat',
        label: 'Chat',
        svg: svg(
          '<path d="M16 24 h64 a0 0 0 0 1 0 0 v36 a0 0 0 0 1 0 0 h-44 l-12 12 v-12 h-8 a0 0 0 0 1 0 0 v-36 a0 0 0 0 1 0 0z" fill="white"/><line x1="32" y1="40" x2="64" y2="40" stroke="#1a1a2e" stroke-width="3"/><line x1="32" y1="50" x2="56" y2="50" stroke="#1a1a2e" stroke-width="3"/>'
        )
      },
      {
        id: 'plugin:obs:eye',
        label: 'Viewers',
        svg: svg(
          '<path d="M8 48 Q48 16 88 48 Q48 80 8 48Z"/><circle cx="48" cy="48" r="12" fill="white" stroke="none"/><circle cx="48" cy="48" r="6" fill="#1a1a2e" stroke="none"/>'
        )
      },
      {
        id: 'plugin:obs:eye-off',
        label: 'Source Hidden',
        svg: svg(
          '<path d="M8 48 Q48 16 88 48 Q48 80 8 48Z"/><circle cx="48" cy="48" r="12" fill="white" stroke="none"/><circle cx="48" cy="48" r="6" fill="#1a1a2e" stroke="none"/><line x1="20" y1="20" x2="76" y2="76" stroke="red" stroke-width="5"/>'
        )
      }
    ]
  }
];

export const manifest: PluginManifest = {
  id: 'obs',
  name: 'OBS Studio',
  description: 'Control OBS Studio via WebSocket — switch scenes, toggle stream/record, mute inputs, and more.',
  version: '1.0.0',

  // ── Plugin icon pack ────────────────────────────────────────
  iconPacks: obsIconPacks,

  // ── Action definitions ──────────────────────────────────────

  actions: {
    'switch-scene': {
      label: 'Switch Scene',
      params: {
        sceneName: {
          key: 'sceneName',
          label: 'Scene',
          type: 'select',
          placeholder: 'Select a scene…',
          dynamicOptionsQuery: 'getScenes'
        }
      },
      defaultAppearance: defaultLayers('#1a1a3e', 'plugin:obs:scene', 'Scene')
    },
    'toggle-stream': {
      label: 'Toggle Stream',
      defaultAppearance: defaultLayers('#2d1a2e', 'plugin:obs:broadcast', 'Stream', '#e06c75')
    },
    'start-stream': {
      label: 'Start Stream',
      defaultAppearance: defaultLayers('#1a2e1a', 'plugin:obs:broadcast', 'Start\nStream', '#98c379')
    },
    'stop-stream': {
      label: 'Stop Stream',
      defaultAppearance: defaultLayers('#2e1a1a', 'plugin:obs:stream-off', 'Stop\nStream', '#e06c75')
    },
    'toggle-record': {
      label: 'Toggle Recording',
      defaultAppearance: defaultLayers('#2e1a1a', 'record', 'Record', '#e06c75')
    },
    'start-record': {
      label: 'Start Recording',
      defaultAppearance: defaultLayers('#1a2e1a', 'record', 'Start\nRecord', '#98c379')
    },
    'stop-record': {
      label: 'Stop Recording',
      defaultAppearance: defaultLayers('#2e1a1a', 'stop', 'Stop\nRecord', '#e06c75')
    },
    'toggle-mute': {
      label: 'Toggle Mute',
      params: {
        inputName: {
          key: 'inputName',
          label: 'Input',
          type: 'select',
          placeholder: 'Select an input…',
          dynamicOptionsQuery: 'getInputs'
        }
      },
      defaultAppearance: defaultLayers('#1a2e2e', 'microphone', 'Mute', '#56b6c2')
    },
    'set-mute': {
      label: 'Set Mute',
      params: {
        inputName: {
          key: 'inputName',
          label: 'Input',
          type: 'select',
          placeholder: 'Select an input…',
          dynamicOptionsQuery: 'getInputs'
        },
        muted: {
          key: 'muted',
          label: 'Muted',
          type: 'boolean'
        }
      },
      defaultAppearance: defaultLayers('#1a2e2e', 'microphone-off', 'Set Mute', '#56b6c2')
    },
    'toggle-source-visibility': {
      label: 'Toggle Source Visibility',
      params: {
        sceneName: {
          key: 'sceneName',
          label: 'Scene',
          type: 'select',
          placeholder: 'Select a scene…',
          dynamicOptionsQuery: 'getScenes'
        },
        sourceName: {
          key: 'sourceName',
          label: 'Source Name',
          type: 'text',
          placeholder: 'Source name…'
        }
      },
      defaultAppearance: defaultLayers('#1a1a3e', 'plugin:obs:eye', 'Source', '#c678dd')
    },
    'save-replay-buffer': {
      label: 'Save Replay Buffer',
      defaultAppearance: defaultLayers('#2e2e1a', 'save', 'Replay', '#e5c07b')
    },
    'toggle-virtual-cam': {
      label: 'Toggle Virtual Camera',
      defaultAppearance: defaultLayers('#1a2e1a', 'camera', 'Virtual\nCam', '#98c379')
    }
  },

  // ── Connection ──────────────────────────────────────────────

  connection: {
    defaults: {
      url: 'ws://127.0.0.1:4455',
      password: undefined,
      autoConnect: false
    },
    fields: [
      {
        key: 'url',
        label: 'WebSocket URL',
        type: 'text',
        placeholder: 'ws://127.0.0.1:4455'
      },
      {
        key: 'password',
        label: 'Password',
        type: 'password',
        placeholder: 'Optional'
      },
      {
        key: 'autoConnect',
        label: 'Auto-connect on startup',
        type: 'boolean'
      }
    ]
  },

  // ── State ───────────────────────────────────────────────────

  state: {
    defaults: {
      connected: false,
      currentScene: null,
      scenes: [],
      streaming: false,
      recording: false,
      recordPaused: false,
      virtualCamActive: false,
      replayBufferActive: false,
      mutedInputs: {}
    },
    display: [
      { key: 'currentScene', label: 'Scene', icon: '🎬' },
      { key: 'streaming', label: 'Streaming', icon: '📡' },
      { key: 'recording', label: 'Recording', icon: '🔴' }
    ]
  }
};
