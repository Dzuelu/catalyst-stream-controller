import type { ActionConfig } from '@shared/types';

// ─── Built-in Action Fixtures ───────────────────────────────────

export const hotkeyAction: ActionConfig = {
  id: 'test-hotkey',
  type: 'hotkey',
  label: 'Copy',
  config: {
    steps: [{ key: 'c', modifiers: ['meta'] }]
  }
};

export const multiStepHotkeyAction: ActionConfig = {
  id: 'test-multi-hotkey',
  type: 'hotkey',
  label: 'Save All',
  config: {
    steps: [
      { key: 's', modifiers: ['meta'] },
      { key: 's', modifiers: ['meta', 'shift'] }
    ]
  }
};

export const launchAction: ActionConfig = {
  id: 'test-launch',
  type: 'launch',
  label: 'Open Browser',
  config: {
    path: '/Applications/Firefox.app',
    args: ['--private-window']
  }
};

export const commandAction: ActionConfig = {
  id: 'test-command',
  type: 'command',
  label: 'List Files',
  config: {
    command: 'ls -la /tmp'
  }
};

export const multimediaPlayPause: ActionConfig = {
  id: 'test-media-pp',
  type: 'multimedia',
  label: 'Play/Pause',
  config: {
    action: 'play-pause'
  }
};

export const multimediaVolumeUp: ActionConfig = {
  id: 'test-media-volup',
  type: 'multimedia',
  label: 'Volume Up',
  config: {
    action: 'volume-up'
  }
};

export const goToPageAction: ActionConfig = {
  id: 'test-goto',
  type: 'go-to-page',
  label: 'Go to OBS',
  config: {
    pageId: 'page-obs'
  }
};

export const goBackAction: ActionConfig = {
  id: 'test-goback',
  type: 'go-to-back',
  label: '← Back',
  config: {}
};

export const switchProfileAction: ActionConfig = {
  id: 'test-switch-profile',
  type: 'switch-profile',
  label: 'Music Profile',
  config: {
    profileId: 'profile-2'
  }
};

export const setBrightnessAction: ActionConfig = {
  id: 'test-brightness',
  type: 'set-brightness',
  label: '50% Brightness',
  config: {
    brightness: 50
  }
};

export const noneAction: ActionConfig = {
  id: 'test-none',
  type: 'none',
  label: '',
  config: {}
};

// ─── OBS Plugin Action Fixtures ─────────────────────────────────

export const obsSwitchScene: ActionConfig = {
  id: 'test-obs-scene',
  type: 'plugin:obs',
  label: 'Gaming Scene',
  config: {
    pluginAction: 'switch-scene',
    sceneName: 'Gaming'
  }
};

export const obsToggleStream: ActionConfig = {
  id: 'test-obs-stream',
  type: 'plugin:obs',
  label: 'Toggle Stream',
  config: {
    pluginAction: 'toggle-stream'
  }
};

export const obsToggleMute: ActionConfig = {
  id: 'test-obs-mute',
  type: 'plugin:obs',
  label: 'Toggle Mic',
  config: {
    pluginAction: 'toggle-mute',
    inputName: 'Microphone'
  }
};

export const obsSetMute: ActionConfig = {
  id: 'test-obs-setmute',
  type: 'plugin:obs',
  label: 'Mute Mic',
  config: {
    pluginAction: 'set-mute',
    inputName: 'Microphone',
    muted: true
  }
};

export const obsToggleSourceVisibility: ActionConfig = {
  id: 'test-obs-source',
  type: 'plugin:obs',
  label: 'Toggle Webcam',
  config: {
    pluginAction: 'toggle-source-visibility',
    sceneName: 'Gaming',
    sourceName: 'Webcam'
  }
};

export const obsToggleRecord: ActionConfig = {
  id: 'test-obs-record',
  type: 'plugin:obs',
  label: 'Toggle Recording',
  config: {
    pluginAction: 'toggle-record'
  }
};

// ─── Discord Plugin Action Fixtures ─────────────────────────────

export const discordToggleMute: ActionConfig = {
  id: 'test-discord-mute',
  type: 'plugin:discord',
  label: 'Discord Mute',
  config: {
    pluginAction: 'toggle-mute'
  }
};

export const discordToggleDeafen: ActionConfig = {
  id: 'test-discord-deafen',
  type: 'plugin:discord',
  label: 'Discord Deafen',
  config: {
    pluginAction: 'toggle-deafen'
  }
};

export const discordJoinChannel: ActionConfig = {
  id: 'test-discord-join',
  type: 'plugin:discord',
  label: 'Join General',
  config: {
    pluginAction: 'join-voice-channel',
    channelId: '1234567890'
  }
};

export const discordSetVolume: ActionConfig = {
  id: 'test-discord-vol',
  type: 'plugin:discord',
  label: 'Input 80%',
  config: {
    pluginAction: 'set-input-volume',
    volume: 80
  }
};

// ─── Multi-Action Fixtures ──────────────────────────────────────

export const multiAction: ActionConfig = {
  id: 'test-multi',
  type: 'multi-action',
  label: 'Stream Start Sequence',
  config: {
    steps: [
      { action: obsSwitchScene, delayMs: 0 },
      { action: obsToggleStream, delayMs: 500 },
      { action: discordToggleMute, delayMs: 200 }
    ]
  }
};

export const emptyMultiAction: ActionConfig = {
  id: 'test-multi-empty',
  type: 'multi-action',
  label: 'Empty Multi',
  config: {
    steps: []
  }
};
