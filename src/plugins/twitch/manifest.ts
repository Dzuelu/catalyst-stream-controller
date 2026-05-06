import type { PluginManifest, PluginIconPack } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

/** Twitch-branded purple */
const TWITCH_PURPLE = '#9146ff';

const twitchIconPacks: PluginIconPack[] = [
  {
    label: 'Twitch',
    icons: [
      {
        id: 'plugin:twitch:logo',
        label: 'Twitch',
        svg: svg(
          '<path d="M20 16 L20 72 L36 72 L36 80 L44 72 L56 72 L76 52 L76 16 Z" fill="#9146ff" stroke="none"/>' +
            '<path d="M32 16 L76 16 L76 52 L64 64 L52 64 L44 72 L44 64 L32 64 Z" stroke="white" fill="none"/>' +
            '<line x1="48" y1="32" x2="48" y2="48"/>' +
            '<line x1="60" y1="32" x2="60" y2="48"/>'
        )
      },
      {
        id: 'plugin:twitch:chat',
        label: 'Chat',
        svg: svg(
          '<path d="M16 24 h64 v36 h-44 l-12 12 v-12 h-8 v-36z" fill="#9146ff"/>' +
            '<line x1="32" y1="38" x2="64" y2="38" stroke="white" stroke-width="3"/>' +
            '<line x1="32" y1="48" x2="56" y2="48" stroke="white" stroke-width="3"/>'
        )
      },
      {
        id: 'plugin:twitch:ad',
        label: 'Ad Break',
        svg: svg(
          '<rect x="20" y="24" width="56" height="48" rx="4" fill="#9146ff"/>' +
            '<text x="48" y="56" text-anchor="middle" fill="white" font-size="24" font-weight="bold" stroke="none">AD</text>'
        )
      },
      {
        id: 'plugin:twitch:clip',
        label: 'Clip',
        svg: svg(
          '<rect x="16" y="24" width="64" height="48" rx="6" stroke="#9146ff" fill="none"/>' +
            '<polygon points="40,36 40,60 60,48" fill="#9146ff" stroke="none"/>'
        )
      },
      {
        id: 'plugin:twitch:marker',
        label: 'Marker',
        svg: svg(
          '<circle cx="48" cy="44" r="20" fill="none" stroke="#9146ff"/>' +
            '<circle cx="48" cy="44" r="6" fill="#9146ff" stroke="none"/>' +
            '<line x1="48" y1="64" x2="48" y2="80" stroke="#9146ff"/>'
        )
      },
      {
        id: 'plugin:twitch:poll',
        label: 'Poll',
        svg: svg(
          '<rect x="24" y="24" width="40" height="8" rx="2" fill="#9146ff" stroke="none"/>' +
            '<rect x="24" y="38" width="28" height="8" rx="2" fill="#9146ff" stroke="none"/>' +
            '<rect x="24" y="52" width="48" height="8" rx="2" fill="#9146ff" stroke="none"/>' +
            '<rect x="24" y="66" width="16" height="8" rx="2" fill="#9146ff" stroke="none"/>'
        )
      },
      {
        id: 'plugin:twitch:prediction',
        label: 'Prediction',
        svg: svg(
          '<circle cx="48" cy="44" r="24" fill="none" stroke="#9146ff"/>' +
            '<text x="48" y="52" text-anchor="middle" fill="#9146ff" font-size="20" font-weight="bold" stroke="none">?</text>' +
            '<line x1="48" y1="68" x2="48" y2="76" stroke="#9146ff"/>' +
            '<circle cx="48" cy="80" r="2" fill="#9146ff" stroke="none"/>'
        )
      },
      {
        id: 'plugin:twitch:emote-only',
        label: 'Emote Only',
        svg: svg(
          '<circle cx="48" cy="48" r="24" fill="#9146ff" stroke="none"/>' +
            '<circle cx="40" cy="42" r="3" fill="white" stroke="none"/>' +
            '<circle cx="56" cy="42" r="3" fill="white" stroke="none"/>' +
            '<path d="M36 54 Q48 66 60 54" stroke="white" fill="none" stroke-width="3"/>'
        )
      }
    ]
  }
];

export const manifest: PluginManifest = {
  id: 'twitch',
  name: 'Twitch',
  description:
    'Control your Twitch stream — run ads, create clips, manage chat modes, send messages, and start polls/predictions.',
  version: '1.0.0',

  iconPacks: twitchIconPacks,

  actions: {
    // ── Stream management ──────────────────────────────
    'create-clip': {
      label: 'Create Clip',
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:clip', 'Clip', TWITCH_PURPLE)
    },
    'create-stream-marker': {
      label: 'Create Stream Marker',
      params: {
        description: {
          key: 'description',
          label: 'Description',
          type: 'text',
          placeholder: 'Optional marker label…'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:marker', 'Marker', TWITCH_PURPLE)
    },
    'run-ad': {
      label: 'Run Ad',
      params: {
        duration: {
          key: 'duration',
          label: 'Duration (seconds)',
          type: 'select',
          options: [
            { value: 30, label: '30s' },
            { value: 60, label: '60s' },
            { value: 90, label: '90s' },
            { value: 120, label: '2 min' },
            { value: 150, label: '2.5 min' },
            { value: 180, label: '3 min' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#2e1a0a', 'plugin:twitch:ad', 'Ad', '#e5c07b')
    },

    // ── Chat management ────────────────────────────────
    'send-chat-message': {
      label: 'Send Chat Message',
      params: {
        message: {
          key: 'message',
          label: 'Message',
          type: 'text',
          placeholder: 'Message to send…'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:chat', 'Chat', TWITCH_PURPLE)
    },
    'set-emote-only': {
      label: 'Set Emote-Only Mode',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:emote-only', 'Emote\nOnly', TWITCH_PURPLE)
    },
    'set-subscriber-only': {
      label: 'Set Subscriber-Only Mode',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:logo', 'Sub\nOnly', TWITCH_PURPLE)
    },
    'set-follower-only': {
      label: 'Set Follower-Only Mode',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        },
        duration: {
          key: 'duration',
          label: 'Min. Follow Time (minutes)',
          type: 'number',
          min: 0,
          max: 129600,
          helpText: '0 = any follower; max 129600 (3 months)'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:logo', 'Follower\nOnly', TWITCH_PURPLE)
    },
    'set-slow-mode': {
      label: 'Set Slow Mode',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        },
        delay: {
          key: 'delay',
          label: 'Wait Time (seconds)',
          type: 'number',
          min: 3,
          max: 120,
          helpText: 'Seconds between messages (3–120)'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:chat', 'Slow\nMode', '#e5c07b')
    },
    'clear-chat': {
      label: 'Clear Chat',
      defaultAppearance: defaultLayers('#2e0a0a', 'plugin:twitch:chat', 'Clear\nChat', '#e06c75')
    },

    // ── Polls & Predictions ────────────────────────────
    'create-poll': {
      label: 'Create Poll',
      params: {
        title: {
          key: 'title',
          label: 'Title',
          type: 'text',
          placeholder: 'Poll question…'
        },
        choice1: {
          key: 'choice1',
          label: 'Choice 1',
          type: 'text',
          placeholder: 'First option…'
        },
        choice2: {
          key: 'choice2',
          label: 'Choice 2',
          type: 'text',
          placeholder: 'Second option…'
        },
        choice3: {
          key: 'choice3',
          label: 'Choice 3',
          type: 'text',
          placeholder: 'Third option (optional)'
        },
        choice4: {
          key: 'choice4',
          label: 'Choice 4',
          type: 'text',
          placeholder: 'Fourth option (optional)'
        },
        durationSeconds: {
          key: 'durationSeconds',
          label: 'Duration (seconds)',
          type: 'number',
          min: 15,
          max: 1800,
          helpText: '15–1800 seconds'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:poll', 'Poll', TWITCH_PURPLE)
    },
    'end-poll': {
      label: 'End Poll',
      defaultAppearance: defaultLayers('#2e0a0a', 'plugin:twitch:poll', 'End\nPoll', '#e06c75')
    },
    'create-prediction': {
      label: 'Create Prediction',
      params: {
        title: {
          key: 'title',
          label: 'Title',
          type: 'text',
          placeholder: 'Prediction question…'
        },
        outcome1: {
          key: 'outcome1',
          label: 'Outcome 1',
          type: 'text',
          placeholder: 'Blue outcome…'
        },
        outcome2: {
          key: 'outcome2',
          label: 'Outcome 2',
          type: 'text',
          placeholder: 'Pink outcome…'
        },
        predictionWindow: {
          key: 'predictionWindow',
          label: 'Window (seconds)',
          type: 'number',
          min: 30,
          max: 1800,
          helpText: '30–1800 seconds'
        }
      },
      defaultAppearance: defaultLayers('#1a0a2e', 'plugin:twitch:prediction', 'Predict', TWITCH_PURPLE)
    },
    'resolve-prediction': {
      label: 'Resolve Prediction',
      params: {
        winningOutcome: {
          key: 'winningOutcome',
          label: 'Winning Outcome',
          type: 'select',
          options: [
            { value: 'outcome1', label: 'Outcome 1 (Blue)' },
            { value: 'outcome2', label: 'Outcome 2 (Pink)' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#0a2e0a', 'plugin:twitch:prediction', 'Resolve', '#98c379')
    },
    'cancel-prediction': {
      label: 'Cancel Prediction',
      defaultAppearance: defaultLayers('#2e0a0a', 'plugin:twitch:prediction', 'Cancel\nPredict', '#e06c75')
    }
  },

  connection: {
    defaults: {
      clientId: '',
      accessToken: undefined,
      autoConnect: false
    },
    fields: [
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        placeholder: 'Twitch Application Client ID',
        helpText: 'Register an app at dev.twitch.tv/console and copy the Client ID'
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        placeholder: 'OAuth user access token',
        helpText:
          'A user access token with scopes: channel:manage:broadcast, channel:manage:polls, channel:manage:predictions, channel:edit:commercial, clips:edit, moderator:manage:chat_settings, user:write:chat, channel:manage:ads, moderator:manage:chat_messages'
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
      username: null,
      userId: null,
      streamTitle: null,
      streamGame: null,
      isLive: false,
      viewerCount: 0,
      followerCount: 0,
      emoteOnly: false,
      subscriberOnly: false,
      followerOnly: false,
      slowMode: false,
      activePollId: null,
      activePredictionId: null
    },
    display: [
      { key: 'username', label: 'Channel', icon: '👤' },
      { key: 'isLive', label: 'Live', icon: '🔴' },
      { key: 'viewerCount', label: 'Viewers', icon: '👁️' },
      { key: 'streamTitle', label: 'Title', icon: '📺' },
      { key: 'streamGame', label: 'Game', icon: '🎮' }
    ]
  }
};
