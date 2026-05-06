import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manifest } from '../../../src/plugins/youtube/manifest';
import { createClient } from '../../../src/plugins/youtube/client';
import { youtubePlugin } from '../../../src/plugins/youtube';
import type { PluginHostAPI } from '../../../src/shared/plugin-types';

// ─── Helpers ────────────────────────────────────────────────────

function createMockHostAPI(): PluginHostAPI {
  return {
    log: vi.fn(),
    setBrightness: vi.fn(async () => {}),
    setButtonImage: vi.fn(async () => {}),
    clearButtonImage: vi.fn(async () => {}),
    getDevices: vi.fn(() => []),
    executeAction: vi.fn(async () => {}),
    executePluginAction: vi.fn(async () => {}),
    getPluginInfo: vi.fn(() => null),
    getRegisteredPlugins: vi.fn(() => []),
    onButtonDown: vi.fn(() => () => {}),
    onButtonUp: vi.fn(() => () => {}),
    onKnobRotate: vi.fn(() => () => {}),
    onKnobPress: vi.fn(() => () => {}),
    onProfileChanged: vi.fn(() => () => {}),
    onPageChanged: vi.fn(() => () => {}),
    onDeviceConnected: vi.fn(() => () => {}),
    onDeviceDisconnected: vi.fn(() => () => {}),
    onSystemWakeUp: vi.fn(() => () => {}),
    showFeedback: vi.fn(),
    getOwnSettings: vi.fn(() => ({})),
    saveOwnSettings: vi.fn(async () => {}),
    createImage: {
      solidColor: vi.fn(() => 'data:image/png;base64,'),
      textImage: vi.fn(() => 'data:image/png;base64,')
    }
  };
}

// ─── Manifest Tests ─────────────────────────────────────────────

describe('YouTube Plugin — Manifest', () => {
  it('should have correct id', () => {
    expect(manifest.id).toBe('youtube');
  });

  it('should have correct name', () => {
    expect(manifest.name).toBe('YouTube');
  });

  it('should have a semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should define connection fields', () => {
    expect(manifest.connection).toBeDefined();
    expect(manifest.connection!.fields.length).toBeGreaterThanOrEqual(3);
    const keys = manifest.connection!.fields.map((f) => f.key);
    expect(keys).toContain('apiKey');
    expect(keys).toContain('accessToken');
    expect(keys).toContain('autoConnect');
  });

  it('should define broadcastId connection field', () => {
    const keys = manifest.connection!.fields.map((f) => f.key);
    expect(keys).toContain('broadcastId');
  });

  it('should define state defaults', () => {
    expect(manifest.state).toBeDefined();
    expect(manifest.state!.defaults).toHaveProperty('connected', false);
    expect(manifest.state!.defaults).toHaveProperty('isLive', false);
    expect(manifest.state!.defaults).toHaveProperty('channelName', null);
    expect(manifest.state!.defaults).toHaveProperty('viewerCount', 0);
  });

  it('should define state display fields', () => {
    expect(manifest.state!.display).toBeDefined();
    const displayKeys = manifest.state!.display!.map((d) => d.key);
    expect(displayKeys).toContain('channelName');
    expect(displayKeys).toContain('isLive');
    expect(displayKeys).toContain('viewerCount');
    expect(displayKeys).toContain('broadcastTitle');
    expect(displayKeys).toContain('broadcastStatus');
  });

  // ── Actions ─────────────────────────────────────────────

  describe('actions', () => {
    it('should define broadcast lifecycle actions', () => {
      expect(manifest.actions['transition-broadcast']).toBeDefined();
      expect(manifest.actions['end-broadcast']).toBeDefined();
    });

    it('should define metadata actions', () => {
      expect(manifest.actions['update-title']).toBeDefined();
      expect(manifest.actions['update-description']).toBeDefined();
    });

    it('should define chat actions', () => {
      expect(manifest.actions['send-chat-message']).toBeDefined();
      expect(manifest.actions['set-chat-slow-mode']).toBeDefined();
      expect(manifest.actions['set-chat-members-only']).toBeDefined();
      expect(manifest.actions['set-chat-subscribers-only']).toBeDefined();
    });

    it('should define ad and slate actions', () => {
      expect(manifest.actions['insert-cue-point']).toBeDefined();
      expect(manifest.actions['insert-slate']).toBeDefined();
      expect(manifest.actions['remove-slate']).toBeDefined();
    });

    it('should have labels for all actions', () => {
      for (const [key, action] of Object.entries(manifest.actions)) {
        expect(action.label, `action "${key}" should have a label`).toBeTruthy();
      }
    });

    it('should have default appearances for all actions', () => {
      for (const [key, action] of Object.entries(manifest.actions)) {
        expect(action.defaultAppearance, `action "${key}" should have defaultAppearance`).toBeDefined();
        expect(action.defaultAppearance!.layers.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('transition-broadcast should have status param with valid options', () => {
      const action = manifest.actions['transition-broadcast'];
      expect(action.params?.status).toBeDefined();
      expect(action.params!.status.type).toBe('select');
      expect(action.params!.status.options!.length).toBeGreaterThanOrEqual(3);
    });

    it('insert-cue-point should have durationSecs param with options', () => {
      const action = manifest.actions['insert-cue-point'];
      expect(action.params?.durationSecs).toBeDefined();
      expect(action.params!.durationSecs.type).toBe('select');
      expect(action.params!.durationSecs.options!.length).toBeGreaterThanOrEqual(3);
    });

    it('send-chat-message should have message param', () => {
      const action = manifest.actions['send-chat-message'];
      expect(action.params?.message).toBeDefined();
      expect(action.params!.message.type).toBe('text');
    });
  });

  // ── Icons ───────────────────────────────────────────────

  describe('icon packs', () => {
    it('should define a YouTube icon pack', () => {
      expect(manifest.iconPacks).toBeDefined();
      expect(manifest.iconPacks!.length).toBeGreaterThanOrEqual(1);
      expect(manifest.iconPacks![0].label).toBe('YouTube');
    });

    it('should have namespaced icon IDs', () => {
      for (const pack of manifest.iconPacks ?? []) {
        for (const icon of pack.icons) {
          expect(icon.id).toMatch(/^plugin:youtube:/);
        }
      }
    });

    it('should have SVG content for all icons', () => {
      for (const pack of manifest.iconPacks ?? []) {
        for (const icon of pack.icons) {
          expect(icon.svg).toContain('<svg');
          expect(icon.svg).toContain('</svg>');
        }
      }
    });
  });
});

// ─── Client Tests ───────────────────────────────────────────────

describe('YouTube Plugin — Client', () => {
  let hostAPI: PluginHostAPI;

  beforeEach(() => {
    hostAPI = createMockHostAPI();
    vi.restoreAllMocks();
  });

  it('should create a client via factory', () => {
    const client = createClient(hostAPI);
    expect(client).toBeDefined();
    expect(client.isConnected()).toBe(false);
  });

  it('should start disconnected with default state', () => {
    const client = createClient(hostAPI);
    const state = client.getState();
    expect(state.connected).toBe(false);
    expect(state.channelName).toBeNull();
    expect(state.isLive).toBe(false);
    expect(state.viewerCount).toBe(0);
  });

  it('should support setOnStateChanged', () => {
    const client = createClient(hostAPI);
    const handler = vi.fn();
    client.setOnStateChanged(handler);
    // No error — interface satisfied
    expect(true).toBe(true);
  });

  it('should throw when connecting without access token', async () => {
    const client = createClient(hostAPI);
    await expect(client.connect({ accessToken: '' })).rejects.toThrow('Access Token is required');
  });

  it('should log warning when executing action while disconnected', async () => {
    const client = createClient(hostAPI);
    await client.executeAction({ pluginAction: 'transition-broadcast' });
    expect(hostAPI.log).toHaveBeenCalledWith('warn', expect.stringContaining('not connected'));
  });

  it('should handle unknown actions gracefully when disconnected', async () => {
    const client = createClient(hostAPI);
    await client.executeAction({ pluginAction: 'nonexistent-action' });
    expect(hostAPI.log).toHaveBeenCalledWith('warn', expect.stringContaining('not connected'));
  });

  it('should clean up on disconnect', async () => {
    const client = createClient(hostAPI);
    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(client.getState().connected).toBe(false);
  });

  it('should clean up on destroy', () => {
    const client = createClient(hostAPI);
    client.destroy();
    expect(client.isConnected()).toBe(false);
  });

  it('should have empty queries', () => {
    const client = createClient(hostAPI);
    expect(client.queries).toBeDefined();
    expect(Object.keys(client.queries!)).toHaveLength(0);
  });
});

// ─── Plugin Package Tests ───────────────────────────────────────

describe('YouTube Plugin — Package', () => {
  it('should export a valid PluginPackage', () => {
    expect(youtubePlugin.manifest).toBe(manifest);
    expect(typeof youtubePlugin.createClient).toBe('function');
  });

  it('should produce a working client from the package factory', () => {
    const hostAPI = createMockHostAPI();
    const client = youtubePlugin.createClient(hostAPI);
    expect(client.isConnected()).toBe(false);
    expect(client.getState()).toHaveProperty('connected', false);
  });
});
