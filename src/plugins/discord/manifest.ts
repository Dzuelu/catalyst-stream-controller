import type { PluginManifest } from '../../shared/plugin-types';
import { defaultLayers } from '../manifest-helpers';

/**
 * Discord plugin manifest — describes all actions, parameters,
 * connection settings, state, and UI field definitions.
 *
 * Derived from the former `src/shared/discord-types.ts`.
 */
export const manifest: PluginManifest = {
  id: 'discord',
  name: 'Discord',
  description: 'Control Discord voice chat — mute, deafen, join channels, adjust volume',
  version: '1.0.0',

  // ─── Action Definitions ──────────────────────────────────

  actions: {
    'toggle-mute': {
      label: 'Toggle Mute',
      defaultAppearance: defaultLayers('#2c2f33', 'microphone', 'Mute', '#7289da')
    },
    'toggle-deafen': {
      label: 'Toggle Deafen',
      defaultAppearance: defaultLayers('#2c2f33', 'headphones', 'Deafen', '#7289da')
    },
    'set-mute': {
      label: 'Set Mute',
      params: {
        muted: {
          key: 'muted',
          label: 'Muted',
          type: 'select',
          options: [
            { value: true, label: 'Muted' },
            { value: false, label: 'Unmuted' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#2c2f33', 'microphone-off', 'Set Mute', '#7289da')
    },
    'set-deafen': {
      label: 'Set Deafen',
      params: {
        deafened: {
          key: 'deafened',
          label: 'Deafened',
          type: 'select',
          options: [
            { value: true, label: 'Deafened' },
            { value: false, label: 'Undeafened' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#2c2f33', 'headphones', 'Set Deafen', '#7289da')
    },
    'join-voice-channel': {
      label: 'Join Voice Channel',
      params: {
        channelId: {
          key: 'channelId',
          label: 'Voice Channel',
          type: 'select',
          dynamicOptionsQuery: 'getVoiceChannels',
          helpText: 'Select a voice channel to join'
        }
      },
      defaultAppearance: defaultLayers('#2c2f33', 'headphones', 'Join\nVoice', '#43b581')
    },
    'leave-voice-channel': {
      label: 'Leave Voice Channel',
      defaultAppearance: defaultLayers('#2c2f33', 'x-mark', 'Leave\nVoice', '#f04747')
    },
    'set-input-volume': {
      label: 'Set Input Volume',
      params: {
        volume: {
          key: 'volume',
          label: 'Volume',
          type: 'range',
          min: 0,
          max: 200,
          step: 1,
          suffix: '%',
          helpText: 'Volume level (0–200%)'
        }
      },
      defaultAppearance: defaultLayers('#2c2f33', 'microphone', 'Input\nVol', '#7289da')
    },
    'set-output-volume': {
      label: 'Set Output Volume',
      params: {
        volume: {
          key: 'volume',
          label: 'Volume',
          type: 'range',
          min: 0,
          max: 200,
          step: 1,
          suffix: '%',
          helpText: 'Volume level (0–200%)'
        }
      },
      defaultAppearance: defaultLayers('#2c2f33', 'volume-up', 'Output\nVol', '#7289da')
    }
  },

  // ─── Connection ──────────────────────────────────────────

  connection: {
    defaults: {
      clientId: '',
      accessToken: undefined,
      autoConnect: false
    },
    fields: [
      {
        key: 'clientId',
        label: 'Application Client ID',
        type: 'text',
        placeholder: 'Paste your Discord Application Client ID',
        helpText: 'Create an app at discord.com/developers/applications and copy the Client ID'
      },
      {
        key: 'autoConnect',
        label: 'Auto-connect on startup',
        type: 'boolean'
      }
    ]
  },

  // ─── State ───────────────────────────────────────────────

  state: {
    defaults: {
      connected: false,
      authenticated: false,
      username: null,
      muted: false,
      deafened: false,
      inputVolume: 100,
      outputVolume: 100,
      currentVoiceChannelId: null,
      voiceConnectionState: null
    },
    display: [
      { key: 'username', label: 'User', icon: '👤', format: 'text' },
      { key: 'muted', label: 'Muted', icon: '🎙️', format: 'boolean-on-off' },
      { key: 'deafened', label: 'Deafened', icon: '🔇', format: 'boolean-on-off' },
      { key: 'inputVolume', label: 'Input Volume', icon: '🎤', format: 'percent' },
      { key: 'outputVolume', label: 'Output Volume', icon: '🔊', format: 'percent' }
    ]
  }
};
