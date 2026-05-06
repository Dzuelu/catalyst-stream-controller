import type { PluginManifest, PluginIconPack } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

/** MIDI theme purple */
const MIDI_PURPLE = '#6b2fa0';

// ── Icon Pack ────────────────────────────────────────────────

const midiIconPacks: PluginIconPack[] = [
  {
    label: 'MIDI',
    icons: [
      {
        id: 'plugin:midi:note',
        label: 'Music Note',
        svg: svg(
          '<ellipse cx="38" cy="64" rx="12" ry="8" fill="white" stroke="none"/>' +
            '<line x1="50" y1="64" x2="50" y2="24"/>' +
            '<path d="M50 24 Q62 20 68 28 Q74 36 62 38 L50 40" fill="white" stroke="none"/>'
        )
      },
      {
        id: 'plugin:midi:knob',
        label: 'Control Knob',
        svg: svg(
          '<circle cx="48" cy="48" r="22" fill="none" stroke="white"/>' +
            '<circle cx="48" cy="48" r="4" fill="white" stroke="none"/>' +
            '<line x1="48" y1="48" x2="48" y2="30"/>'
        )
      },
      {
        id: 'plugin:midi:piano',
        label: 'Piano Keys',
        svg: svg(
          '<rect x="16" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="26" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="36" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="46" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="56" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="66" y="28" width="10" height="40" rx="1" fill="white" stroke="none"/>' +
            '<rect x="22" y="28" width="8" height="24" rx="1" fill="#333" stroke="none"/>' +
            '<rect x="32" y="28" width="8" height="24" rx="1" fill="#333" stroke="none"/>' +
            '<rect x="52" y="28" width="8" height="24" rx="1" fill="#333" stroke="none"/>' +
            '<rect x="62" y="28" width="8" height="24" rx="1" fill="#333" stroke="none"/>'
        )
      },
      {
        id: 'plugin:midi:fader',
        label: 'Fader',
        svg: svg(
          '<rect x="42" y="16" width="12" height="64" rx="3" fill="none" stroke="white"/>' +
            '<rect x="38" y="40" width="20" height="10" rx="2" fill="white" stroke="none"/>'
        )
      },
      {
        id: 'plugin:midi:play',
        label: 'Transport Play',
        svg: svg('<polygon points="32,24 72,48 32,72" fill="white" stroke="none"/>')
      },
      {
        id: 'plugin:midi:stop',
        label: 'Transport Stop',
        svg: svg('<rect x="28" y="28" width="40" height="40" rx="2" fill="white" stroke="none"/>')
      },
      {
        id: 'plugin:midi:record',
        label: 'Transport Record',
        svg: svg('<circle cx="48" cy="48" r="20" fill="#ff3333" stroke="none"/>')
      },
      {
        id: 'plugin:midi:plug',
        label: 'MIDI DIN Plug',
        svg: svg(
          '<circle cx="48" cy="48" r="24" fill="none" stroke="white"/>' +
            '<circle cx="48" cy="36" r="4" fill="white" stroke="none"/>' +
            '<circle cx="36" cy="48" r="4" fill="white" stroke="none"/>' +
            '<circle cx="60" cy="48" r="4" fill="white" stroke="none"/>' +
            '<circle cx="40" cy="58" r="4" fill="white" stroke="none"/>' +
            '<circle cx="56" cy="58" r="4" fill="white" stroke="none"/>'
        )
      }
    ]
  }
];

// ── Manifest ─────────────────────────────────────────────────

export const manifest: PluginManifest = {
  id: 'midi',
  name: 'MIDI',
  version: '1.0.0',

  iconPacks: midiIconPacks,

  actions: {
    // ── Note Messages ────────────────────────────────────
    'send-note-on': {
      label: 'Send Note On',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        note: {
          key: 'note',
          label: 'Note (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '60 = Middle C'
        },
        velocity: {
          key: 'velocity',
          label: 'Velocity (1–127)',
          type: 'number',
          min: 1,
          max: 127,
          step: 1,
          placeholder: '100'
        }
      },
      defaultAppearance: defaultLayers(MIDI_PURPLE, 'plugin:midi:note', 'Note On')
    },

    'send-note-off': {
      label: 'Send Note Off',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        note: {
          key: 'note',
          label: 'Note (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '60 = Middle C'
        }
      },
      defaultAppearance: defaultLayers('#3a2060', 'plugin:midi:note', 'Note Off')
    },

    // ── Control Change ───────────────────────────────────
    'send-cc': {
      label: 'Send Control Change',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        controller: {
          key: 'controller',
          label: 'CC Number (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '1 = Mod Wheel'
        },
        value: {
          key: 'value',
          label: 'Value (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '64'
        }
      },
      defaultAppearance: defaultLayers(MIDI_PURPLE, 'plugin:midi:knob', 'CC')
    },

    'send-cc-toggle': {
      label: 'CC Toggle (0 ↔ 127)',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        controller: {
          key: 'controller',
          label: 'CC Number (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '64 = Sustain'
        }
      },
      defaultAppearance: defaultLayers(MIDI_PURPLE, 'plugin:midi:knob', 'Toggle')
    },

    // ── Program Change ───────────────────────────────────
    'send-program-change': {
      label: 'Send Program Change',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        program: {
          key: 'program',
          label: 'Program (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '0'
        }
      },
      defaultAppearance: defaultLayers('#2d4a6b', 'plugin:midi:piano', 'Program')
    },

    // ── Pitch Bend ───────────────────────────────────────
    'send-pitch-bend': {
      label: 'Send Pitch Bend',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        value: {
          key: 'value',
          label: 'Bend Value',
          type: 'select',
          options: [
            { value: '0', label: 'Full Down' },
            { value: '4096', label: '−50%' },
            { value: '8192', label: 'Center (no bend)' },
            { value: '12288', label: '+50%' },
            { value: '16383', label: 'Full Up' }
          ]
        }
      },
      defaultAppearance: defaultLayers(MIDI_PURPLE, 'plugin:midi:fader', 'Bend')
    },

    // ── MMC Transport ────────────────────────────────────
    'transport-play': {
      label: 'MMC Play',
      params: {},
      defaultAppearance: defaultLayers('#2d6b2d', 'plugin:midi:play', 'Play')
    },

    'transport-stop': {
      label: 'MMC Stop',
      params: {},
      defaultAppearance: defaultLayers('#6b2d2d', 'plugin:midi:stop', 'Stop')
    },

    'transport-record': {
      label: 'MMC Record',
      params: {},
      defaultAppearance: defaultLayers('#8b2020', 'plugin:midi:record', 'Record')
    },

    'transport-rewind': {
      label: 'MMC Rewind',
      params: {},
      defaultAppearance: defaultLayers('#4a4a4a', 'plugin:midi:play', 'Rewind')
    },

    'transport-fast-forward': {
      label: 'MMC Fast Forward',
      params: {},
      defaultAppearance: defaultLayers('#4a4a4a', 'plugin:midi:play', 'FF')
    },

    // ── Knob → CC (for hardware knobs) ──────────────────
    'knob-cc': {
      label: 'Knob → CC (Encoder)',
      params: {
        channel: {
          key: 'channel',
          label: 'Channel',
          type: 'select',
          options: Array.from({ length: 16 }, (_, i) => ({
            value: String(i + 1),
            label: `Ch ${i + 1}`
          }))
        },
        controller: {
          key: 'controller',
          label: 'CC Number (0–127)',
          type: 'number',
          min: 0,
          max: 127,
          step: 1,
          placeholder: '1 = Mod Wheel'
        },
        stepSize: {
          key: 'stepSize',
          label: 'Step Size',
          type: 'select',
          options: [
            { value: '1', label: '1 (fine)' },
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '8', label: '8 (medium)' },
            { value: '16', label: '16 (coarse)' }
          ]
        }
      },
      defaultAppearance: defaultLayers(MIDI_PURPLE, 'plugin:midi:knob', 'Knob CC')
    }
  },

  connection: {
    defaults: {
      outputPort: '',
      autoConnect: false
    },
    fields: [
      {
        key: 'outputPort',
        label: 'MIDI Output Port',
        type: 'select',
        dynamicOptionsQuery: 'getOutputPorts',
        options: [],
        helpText:
          'Select the MIDI output device to send messages to. ' +
          'If you do not see your device, make sure it is connected and refresh.'
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
      outputPortName: null,
      outputPortCount: 0
    },
    display: [
      { key: 'outputPortName', label: 'Output Port', icon: '🔌' },
      { key: 'outputPortCount', label: 'Available Ports', icon: '🎹' }
    ]
  }
};
