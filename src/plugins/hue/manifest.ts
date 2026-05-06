import type { PluginManifest, PluginIconPack } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

/** Philips Hue yellow/amber */
const HUE_AMBER = '#e8a317';

// ── Icon Pack ────────────────────────────────────────────────

const hueIconPacks: PluginIconPack[] = [
  {
    label: 'Philips Hue',
    icons: [
      {
        id: 'plugin:hue:bulb',
        label: 'Light Bulb',
        svg: svg(
          '<ellipse cx="48" cy="38" rx="16" ry="22" fill="#ffcc00" stroke="none"/>' +
            '<rect x="40" y="56" width="16" height="8" rx="2" fill="#cccccc" stroke="none"/>' +
            '<rect x="42" y="64" width="12" height="4" rx="2" fill="#aaaaaa" stroke="none"/>' +
            '<line x1="48" y1="16" x2="48" y2="10"/>' +
            '<line x1="28" y1="24" x2="23" y2="19"/>' +
            '<line x1="68" y1="24" x2="73" y2="19"/>' +
            '<line x1="20" y1="40" x2="14" y2="40"/>' +
            '<line x1="76" y1="40" x2="82" y2="40"/>'
        )
      },
      {
        id: 'plugin:hue:room',
        label: 'Room / Group',
        svg: svg(
          '<rect x="20" y="30" width="56" height="40" rx="4" stroke="white" fill="none"/>' +
            '<line x1="20" y1="30" x2="48" y2="16"/>' +
            '<line x1="76" y1="30" x2="48" y2="16"/>' +
            '<ellipse cx="48" cy="48" rx="8" ry="12" fill="#ffcc00" stroke="none"/>'
        )
      },
      {
        id: 'plugin:hue:scene',
        label: 'Scene',
        svg: svg(
          '<circle cx="32" cy="36" r="10" fill="#ff6666" stroke="none"/>' +
            '<circle cx="64" cy="36" r="10" fill="#6699ff" stroke="none"/>' +
            '<circle cx="48" cy="58" r="10" fill="#66ff99" stroke="none"/>'
        )
      },
      {
        id: 'plugin:hue:color',
        label: 'Color Wheel',
        svg: svg(
          '<circle cx="48" cy="48" r="24" fill="none" stroke="white"/>' +
            '<path d="M48 24 A24 24 0 0 1 72 48 L48 48 Z" fill="#ff4444" stroke="none"/>' +
            '<path d="M72 48 A24 24 0 0 1 48 72 L48 48 Z" fill="#44ff44" stroke="none"/>' +
            '<path d="M48 72 A24 24 0 0 1 24 48 L48 48 Z" fill="#4444ff" stroke="none"/>' +
            '<path d="M24 48 A24 24 0 0 1 48 24 L48 48 Z" fill="#ffff44" stroke="none"/>'
        )
      },
      {
        id: 'plugin:hue:brightness',
        label: 'Brightness',
        svg: svg(
          '<circle cx="48" cy="48" r="18" fill="#ffcc00" stroke="none"/>' +
            '<line x1="48" y1="16" x2="48" y2="24"/>' +
            '<line x1="48" y1="72" x2="48" y2="80"/>' +
            '<line x1="16" y1="48" x2="24" y2="48"/>' +
            '<line x1="72" y1="48" x2="80" y2="48"/>' +
            '<line x1="25" y1="25" x2="31" y2="31"/>' +
            '<line x1="65" y1="65" x2="71" y2="71"/>' +
            '<line x1="71" y1="25" x2="65" y2="31"/>' +
            '<line x1="25" y1="71" x2="31" y2="65"/>'
        )
      },
      {
        id: 'plugin:hue:power',
        label: 'Power',
        svg: svg(
          '<circle cx="48" cy="52" r="22" fill="none" stroke="white"/>' + '<line x1="48" y1="30" x2="48" y2="52"/>'
        )
      },
      {
        id: 'plugin:hue:alert',
        label: 'Alert / Effect',
        svg: svg(
          '<polygon points="48,14 56,38 80,38 60,54 68,78 48,62 28,78 36,54 16,38 40,38" fill="#ffcc00" stroke="none"/>'
        )
      }
    ]
  }
];

// ── Manifest ─────────────────────────────────────────────────

export const manifest: PluginManifest = {
  id: 'hue',
  name: 'Philips Hue',
  version: '1.0.0',

  iconPacks: hueIconPacks,

  actions: {
    // ── Power ────────────────────────────────────────────
    'toggle-light': {
      label: 'Toggle Light',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        }
      },
      defaultAppearance: defaultLayers(HUE_AMBER, 'plugin:hue:bulb', 'Toggle')
    },

    'turn-on-light': {
      label: 'Turn On Light',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        }
      },
      defaultAppearance: defaultLayers('#2d7a2d', 'plugin:hue:power', 'On')
    },

    'turn-off-light': {
      label: 'Turn Off Light',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        }
      },
      defaultAppearance: defaultLayers('#7a2d2d', 'plugin:hue:power', 'Off')
    },

    // ── Brightness ───────────────────────────────────────
    'set-brightness': {
      label: 'Set Brightness',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        brightness: {
          key: 'brightness',
          label: 'Brightness',
          type: 'range',
          min: 0,
          max: 100,
          step: 5,
          suffix: '%'
        }
      },
      defaultAppearance: defaultLayers(HUE_AMBER, 'plugin:hue:brightness', 'Bright')
    },

    'adjust-brightness': {
      label: 'Adjust Brightness',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        delta: {
          key: 'delta',
          label: 'Adjustment',
          type: 'select',
          options: [
            { value: '-50', label: '−50%' },
            { value: '-25', label: '−25%' },
            { value: '-10', label: '−10%' },
            { value: '10', label: '+10%' },
            { value: '25', label: '+25%' },
            { value: '50', label: '+50%' }
          ]
        }
      },
      defaultAppearance: defaultLayers(HUE_AMBER, 'plugin:hue:brightness', 'Adjust')
    },

    // ── Color ────────────────────────────────────────────
    'set-color': {
      label: 'Set Color',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        color: {
          key: 'color',
          label: 'Color (hex)',
          type: 'text',
          placeholder: '#ff8800'
        }
      },
      defaultAppearance: defaultLayers('#2d3a6b', 'plugin:hue:color', 'Color')
    },

    'set-color-temperature': {
      label: 'Set Color Temperature',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        mirek: {
          key: 'mirek',
          label: 'Temperature',
          type: 'select',
          options: [
            { value: '153', label: 'Daylight (6500K)' },
            { value: '230', label: 'Cool White (4350K)' },
            { value: '290', label: 'Neutral (3450K)' },
            { value: '370', label: 'Warm White (2700K)' },
            { value: '454', label: 'Candlelight (2200K)' },
            { value: '500', label: 'Ultra Warm (2000K)' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#6b4a2d', 'plugin:hue:brightness', 'Temp')
    },

    // ── Groups / Rooms ───────────────────────────────────
    'toggle-group': {
      label: 'Toggle Room / Group',
      params: {
        groupId: {
          key: 'groupId',
          label: 'Room / Group',
          type: 'select',
          dynamicOptionsQuery: 'getGroups',
          options: []
        }
      },
      defaultAppearance: defaultLayers(HUE_AMBER, 'plugin:hue:room', 'Room')
    },

    'set-group-brightness': {
      label: 'Set Room Brightness',
      params: {
        groupId: {
          key: 'groupId',
          label: 'Room / Group',
          type: 'select',
          dynamicOptionsQuery: 'getGroups',
          options: []
        },
        brightness: {
          key: 'brightness',
          label: 'Brightness',
          type: 'range',
          min: 0,
          max: 100,
          step: 5,
          suffix: '%'
        }
      },
      defaultAppearance: defaultLayers(HUE_AMBER, 'plugin:hue:room', 'Room Bri')
    },

    // ── Scenes ───────────────────────────────────────────
    'activate-scene': {
      label: 'Activate Scene',
      params: {
        sceneId: {
          key: 'sceneId',
          label: 'Scene',
          type: 'select',
          dynamicOptionsQuery: 'getScenes',
          options: []
        }
      },
      defaultAppearance: defaultLayers('#2d3a6b', 'plugin:hue:scene', 'Scene')
    },

    // ── Effects ──────────────────────────────────────────
    'trigger-effect': {
      label: 'Trigger Effect',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        effect: {
          key: 'effect',
          label: 'Effect',
          type: 'select',
          options: [
            { value: 'colorloop', label: 'Color Loop' },
            { value: 'breathe', label: 'Breathe' },
            { value: 'none', label: 'None (stop effect)' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#6b2d6b', 'plugin:hue:alert', 'Effect')
    },

    'alert-light': {
      label: 'Alert (Flash)',
      params: {
        lightId: {
          key: 'lightId',
          label: 'Light',
          type: 'select',
          dynamicOptionsQuery: 'getLights',
          options: []
        },
        alert: {
          key: 'alert',
          label: 'Alert Type',
          type: 'select',
          options: [
            { value: 'select', label: 'Single flash' },
            { value: 'lselect', label: 'Repeated flash (15 s)' },
            { value: 'none', label: 'Stop' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#6b2d2d', 'plugin:hue:alert', 'Alert')
    }
  },

  connection: {
    defaults: {
      bridgeIp: '',
      apiKey: undefined,
      autoConnect: false
    },
    fields: [
      {
        key: 'bridgeIp',
        label: 'Bridge IP Address',
        type: 'text',
        placeholder: '192.168.1.x or press Discover',
        helpText: 'The local IP of your Hue Bridge. Find it in the Hue app → Settings → My Hue System → Hue Bridge.'
      },
      {
        key: 'apiKey',
        label: 'API Key / Username',
        type: 'password',
        placeholder: 'Generated via bridge link-button',
        helpText:
          'Press the link button on your bridge, then click Connect. The app will register and store a key automatically.'
      },
      {
        key: 'autoConnect',
        label: 'Auto-connect on startup',
        type: 'boolean'
      }
    ]
  },

  state: {
    defaults: {
      connected: false,
      bridgeName: null,
      bridgeId: null,
      bridgeIp: null,
      lightCount: 0,
      groupCount: 0,
      sceneCount: 0,
      apiVersion: null
    },
    display: [
      { key: 'bridgeName', label: 'Bridge', icon: '🌉' },
      { key: 'lightCount', label: 'Lights', icon: '💡' },
      { key: 'groupCount', label: 'Rooms', icon: '🏠' },
      { key: 'sceneCount', label: 'Scenes', icon: '🎨' },
      { key: 'apiVersion', label: 'API', icon: '🔧' }
    ]
  }
};
