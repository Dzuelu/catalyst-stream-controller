import type { PluginManifest, PluginIconPack } from '../../shared/plugin-types';
import { defaultLayers, svg } from '../manifest-helpers';

/** YouTube red */
const YT_RED = '#ff0000';

const youtubeIconPacks: PluginIconPack[] = [
  {
    label: 'YouTube',
    icons: [
      {
        id: 'plugin:youtube:play',
        label: 'Play',
        svg: svg(
          '<rect x="16" y="24" width="64" height="48" rx="8" fill="#ff0000" stroke="none"/>' +
            '<polygon points="40,36 40,60 62,48" fill="white" stroke="none"/>'
        )
      },
      {
        id: 'plugin:youtube:live',
        label: 'Live',
        svg: svg(
          '<circle cx="48" cy="44" r="8" fill="#ff0000" stroke="none"/>' +
            '<path d="M30 62 a28 28 0 0 1 0 -36" stroke="#ff0000"/>' +
            '<path d="M66 26 a28 28 0 0 1 0 36" stroke="#ff0000"/>' +
            '<path d="M22 70 a40 40 0 0 1 0 -52" stroke="#ff0000"/>' +
            '<path d="M74 18 a40 40 0 0 1 0 52" stroke="#ff0000"/>'
        )
      },
      {
        id: 'plugin:youtube:chat',
        label: 'Live Chat',
        svg: svg(
          '<path d="M16 24 h64 v36 h-44 l-12 12 v-12 h-8 v-36z" fill="#ff0000"/>' +
            '<line x1="32" y1="38" x2="64" y2="38" stroke="white" stroke-width="3"/>' +
            '<line x1="32" y1="48" x2="56" y2="48" stroke="white" stroke-width="3"/>'
        )
      },
      {
        id: 'plugin:youtube:end-stream',
        label: 'End Stream',
        svg: svg(
          '<rect x="16" y="24" width="64" height="48" rx="8" fill="none" stroke="#ff0000"/>' +
            '<line x1="32" y1="36" x2="64" y2="60" stroke="#ff0000" stroke-width="5"/>' +
            '<line x1="64" y1="36" x2="32" y2="60" stroke="#ff0000" stroke-width="5"/>'
        )
      },
      {
        id: 'plugin:youtube:cue-point',
        label: 'Ad Cue Point',
        svg: svg(
          '<rect x="20" y="24" width="56" height="48" rx="4" fill="#ff8800"/>' +
            '<text x="48" y="56" text-anchor="middle" fill="white" font-size="22" font-weight="bold" stroke="none">AD</text>'
        )
      },
      {
        id: 'plugin:youtube:banner',
        label: 'Banner',
        svg: svg(
          '<rect x="12" y="32" width="72" height="16" rx="3" fill="#ff0000" stroke="none"/>' +
            '<line x1="24" y1="40" x2="72" y2="40" stroke="white" stroke-width="3"/>' +
            '<rect x="12" y="52" width="72" height="16" rx="3" fill="none" stroke="#ff0000"/>'
        )
      },
      {
        id: 'plugin:youtube:viewers',
        label: 'Viewers',
        svg: svg(
          '<path d="M8 48 Q48 16 88 48 Q48 80 8 48Z" stroke="#ff0000" fill="none"/>' +
            '<circle cx="48" cy="48" r="12" fill="#ff0000" stroke="none"/>' +
            '<circle cx="48" cy="48" r="5" fill="white" stroke="none"/>'
        )
      }
    ]
  }
];

export const manifest: PluginManifest = {
  id: 'youtube',
  name: 'YouTube',
  description:
    'Control YouTube Live streams — manage broadcasts, insert ad breaks, send chat messages, update stream metadata, and insert cue points.',
  version: '1.0.0',

  iconPacks: youtubeIconPacks,

  actions: {
    // ── Broadcast lifecycle ────────────────────────────
    'transition-broadcast': {
      label: 'Transition Broadcast',
      params: {
        status: {
          key: 'status',
          label: 'Status',
          type: 'select',
          options: [
            { value: 'testing', label: 'Testing (preview)' },
            { value: 'live', label: 'Live' },
            { value: 'complete', label: 'Complete (end)' }
          ],
          helpText: 'Transition the bound broadcast to testing, live, or complete'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:live', 'Go Live', YT_RED)
    },
    'end-broadcast': {
      label: 'End Broadcast',
      defaultAppearance: defaultLayers('#2e0a0a', 'plugin:youtube:end-stream', 'End\nStream', YT_RED)
    },

    // ── Stream metadata ────────────────────────────────
    'update-title': {
      label: 'Update Stream Title',
      params: {
        title: {
          key: 'title',
          label: 'Title',
          type: 'text',
          placeholder: 'New stream title…'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:play', 'Title', '#ffffff')
    },
    'update-description': {
      label: 'Update Stream Description',
      params: {
        description: {
          key: 'description',
          label: 'Description',
          type: 'text',
          placeholder: 'New description…'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:play', 'Desc.', '#ffffff')
    },

    // ── Chat ───────────────────────────────────────────
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
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:chat', 'Chat', YT_RED)
    },
    'set-chat-slow-mode': {
      label: 'Set Chat Slow Mode',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        },
        slowModeSeconds: {
          key: 'slowModeSeconds',
          label: 'Delay (seconds)',
          type: 'number',
          min: 1,
          max: 300,
          helpText: 'Seconds between messages (1–300)'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:chat', 'Slow\nMode', '#e5c07b')
    },
    'set-chat-members-only': {
      label: 'Set Members-Only Chat',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:chat', 'Members\nOnly', YT_RED)
    },
    'set-chat-subscribers-only': {
      label: 'Set Subscribers-Only Chat',
      params: {
        enabled: {
          key: 'enabled',
          label: 'Enabled',
          type: 'boolean'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:chat', 'Subs\nOnly', YT_RED)
    },

    // ── Ads / Cue points ───────────────────────────────
    'insert-cue-point': {
      label: 'Insert Ad Cue Point',
      params: {
        durationSecs: {
          key: 'durationSecs',
          label: 'Duration (seconds)',
          type: 'select',
          options: [
            { value: 30, label: '30s' },
            { value: 60, label: '60s' },
            { value: 120, label: '2 min' },
            { value: 180, label: '3 min' },
            { value: 240, label: '4 min' },
            { value: 300, label: '5 min' }
          ]
        }
      },
      defaultAppearance: defaultLayers('#2e1a0a', 'plugin:youtube:cue-point', 'Ad Break', '#e5c07b')
    },

    // ── Banner / slate ─────────────────────────────────
    'insert-slate': {
      label: 'Insert Slate (Banner)',
      params: {
        text: {
          key: 'text',
          label: 'Banner Text',
          type: 'text',
          placeholder: 'BRB — back in 5 min!'
        }
      },
      defaultAppearance: defaultLayers('#1a0a0a', 'plugin:youtube:banner', 'Banner', '#ffffff')
    },
    'remove-slate': {
      label: 'Remove Slate (Banner)',
      defaultAppearance: defaultLayers('#2e0a0a', 'plugin:youtube:banner', 'Remove\nBanner', YT_RED)
    }
  },

  connection: {
    defaults: {
      apiKey: '',
      accessToken: undefined,
      broadcastId: undefined,
      autoConnect: false
    },
    fields: [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'text',
        placeholder: 'YouTube Data API v3 key',
        helpText: 'Create a key at console.cloud.google.com → APIs & Services → Credentials'
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        placeholder: 'OAuth2 user access token',
        helpText:
          'A user access token with scopes: youtube, youtube.force-ssl. Generate via OAuth2 Playground or your own OAuth flow.'
      },
      {
        key: 'broadcastId',
        label: 'Broadcast ID',
        type: 'text',
        placeholder: 'Optional — auto-detects active broadcast',
        helpText: 'Leave blank to auto-detect the current live/upcoming broadcast'
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
      channelName: null,
      channelId: null,
      broadcastId: null,
      broadcastTitle: null,
      broadcastStatus: null,
      liveChatId: null,
      isLive: false,
      viewerCount: 0,
      subscriberCount: 0
    },
    display: [
      { key: 'channelName', label: 'Channel', icon: '📺' },
      { key: 'isLive', label: 'Live', icon: '🔴' },
      { key: 'viewerCount', label: 'Viewers', icon: '👁️' },
      { key: 'broadcastTitle', label: 'Title', icon: '🎬' },
      { key: 'broadcastStatus', label: 'Status', icon: '⏱️' }
    ]
  }
};
