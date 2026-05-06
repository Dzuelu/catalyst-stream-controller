import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manifest } from '../../../src/plugins/hue/manifest';
import { createClient } from '../../../src/plugins/hue/client';
import { huePlugin } from '../../../src/plugins/hue';
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

describe('Hue Plugin — Manifest', () => {
  it('should have correct id', () => {
    expect(manifest.id).toBe('hue');
  });

  it('should have correct name', () => {
    expect(manifest.name).toBe('Philips Hue');
  });

  it('should have a semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should define connection fields', () => {
    expect(manifest.connection).toBeDefined();
    expect(manifest.connection!.fields.length).toBeGreaterThanOrEqual(2);
    const keys = manifest.connection!.fields.map((f) => f.key);
    expect(keys).toContain('bridgeIp');
    expect(keys).toContain('apiKey');
    expect(keys).toContain('autoConnect');
  });

  it('should define state defaults', () => {
    expect(manifest.state).toBeDefined();
    expect(manifest.state!.defaults).toHaveProperty('connected', false);
    expect(manifest.state!.defaults).toHaveProperty('bridgeName', null);
    expect(manifest.state!.defaults).toHaveProperty('lightCount', 0);
    expect(manifest.state!.defaults).toHaveProperty('groupCount', 0);
    expect(manifest.state!.defaults).toHaveProperty('sceneCount', 0);
  });

  it('should define state display fields', () => {
    expect(manifest.state!.display).toBeDefined();
    const displayKeys = manifest.state!.display!.map((d) => d.key);
    expect(displayKeys).toContain('bridgeName');
    expect(displayKeys).toContain('lightCount');
    expect(displayKeys).toContain('groupCount');
    expect(displayKeys).toContain('sceneCount');
    expect(displayKeys).toContain('apiVersion');
  });

  // ── Actions ─────────────────────────────────────────────

  describe('actions', () => {
    it('should define light power actions', () => {
      expect(manifest.actions['toggle-light']).toBeDefined();
      expect(manifest.actions['turn-on-light']).toBeDefined();
      expect(manifest.actions['turn-off-light']).toBeDefined();
    });

    it('should define brightness actions', () => {
      expect(manifest.actions['set-brightness']).toBeDefined();
      expect(manifest.actions['adjust-brightness']).toBeDefined();
    });

    it('should define color actions', () => {
      expect(manifest.actions['set-color']).toBeDefined();
      expect(manifest.actions['set-color-temperature']).toBeDefined();
    });

    it('should define group actions', () => {
      expect(manifest.actions['toggle-group']).toBeDefined();
      expect(manifest.actions['set-group-brightness']).toBeDefined();
    });

    it('should define scene action', () => {
      expect(manifest.actions['activate-scene']).toBeDefined();
    });

    it('should define effect actions', () => {
      expect(manifest.actions['trigger-effect']).toBeDefined();
      expect(manifest.actions['alert-light']).toBeDefined();
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

    it('set-brightness should have brightness range param', () => {
      const action = manifest.actions['set-brightness'];
      expect(action.params?.brightness).toBeDefined();
      expect(action.params!.brightness.type).toBe('range');
      expect(action.params!.brightness.min).toBe(0);
      expect(action.params!.brightness.max).toBe(100);
    });

    it('adjust-brightness should have delta select param', () => {
      const action = manifest.actions['adjust-brightness'];
      expect(action.params?.delta).toBeDefined();
      expect(action.params!.delta.type).toBe('select');
      expect(action.params!.delta.options!.length).toBeGreaterThanOrEqual(4);
    });

    it('set-color-temperature should have mirek param with options', () => {
      const action = manifest.actions['set-color-temperature'];
      expect(action.params?.mirek).toBeDefined();
      expect(action.params!.mirek.type).toBe('select');
      expect(action.params!.mirek.options!.length).toBeGreaterThanOrEqual(4);
    });

    it('trigger-effect should have effect param', () => {
      const action = manifest.actions['trigger-effect'];
      expect(action.params?.effect).toBeDefined();
      expect(action.params!.effect.type).toBe('select');
      expect(action.params!.effect.options!.length).toBeGreaterThanOrEqual(2);
    });

    it('alert-light should have alert type param', () => {
      const action = manifest.actions['alert-light'];
      expect(action.params?.alert).toBeDefined();
      expect(action.params!.alert.type).toBe('select');
      expect(action.params!.alert.options!.length).toBeGreaterThanOrEqual(2);
    });

    it('light actions should have dynamic lightId param', () => {
      const lightActions = ['toggle-light', 'turn-on-light', 'turn-off-light', 'set-brightness', 'set-color'];
      for (const actionKey of lightActions) {
        const action = manifest.actions[actionKey];
        expect(action.params?.lightId, `${actionKey} should have lightId param`).toBeDefined();
        expect(action.params!.lightId.dynamicOptionsQuery).toBe('getLights');
      }
    });

    it('group actions should have dynamic groupId param', () => {
      const groupActions = ['toggle-group', 'set-group-brightness'];
      for (const actionKey of groupActions) {
        const action = manifest.actions[actionKey];
        expect(action.params?.groupId, `${actionKey} should have groupId param`).toBeDefined();
        expect(action.params!.groupId.dynamicOptionsQuery).toBe('getGroups');
      }
    });

    it('activate-scene should have dynamic sceneId param', () => {
      const action = manifest.actions['activate-scene'];
      expect(action.params?.sceneId).toBeDefined();
      expect(action.params!.sceneId.dynamicOptionsQuery).toBe('getScenes');
    });
  });

  // ── Icons ───────────────────────────────────────────────

  describe('icon packs', () => {
    it('should define a Hue icon pack', () => {
      expect(manifest.iconPacks).toBeDefined();
      expect(manifest.iconPacks!.length).toBeGreaterThanOrEqual(1);
      expect(manifest.iconPacks![0].label).toBe('Philips Hue');
    });

    it('should have namespaced icon IDs', () => {
      for (const pack of manifest.iconPacks ?? []) {
        for (const icon of pack.icons) {
          expect(icon.id).toMatch(/^plugin:hue:/);
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

describe('Hue Plugin — Client', () => {
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
    expect(state.bridgeName).toBeNull();
    expect(state.lightCount).toBe(0);
    expect(state.groupCount).toBe(0);
    expect(state.sceneCount).toBe(0);
  });

  it('should support setOnStateChanged', () => {
    const client = createClient(hostAPI);
    const handler = vi.fn();
    client.setOnStateChanged(handler);
    expect(true).toBe(true);
  });

  it('should throw when connecting without bridge IP', async () => {
    const client = createClient(hostAPI);
    await expect(client.connect({ bridgeIp: '', apiKey: 'abc' })).rejects.toThrow('Bridge IP address is required');
  });

  it('should throw when connecting without API key', async () => {
    const client = createClient(hostAPI);
    await expect(client.connect({ bridgeIp: '192.168.1.100', apiKey: '' })).rejects.toThrow('API key is required');
  });

  it('should log warning when executing action while disconnected', async () => {
    const client = createClient(hostAPI);
    await client.executeAction({ pluginAction: 'toggle-light' });
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

  it('should expose dynamic query methods', () => {
    const client = createClient(hostAPI);
    expect(client.queries).toBeDefined();
    expect(typeof client.queries!.getLights).toBe('function');
    expect(typeof client.queries!.getGroups).toBe('function');
    expect(typeof client.queries!.getScenes).toBe('function');
  });

  it('should return empty arrays from queries when disconnected', async () => {
    const client = createClient(hostAPI);
    expect(await client.queries!.getLights()).toEqual([]);
    expect(await client.queries!.getGroups()).toEqual([]);
    expect(await client.queries!.getScenes()).toEqual([]);
  });
});

// ─── Plugin Package Tests ───────────────────────────────────────

describe('Hue Plugin — Package', () => {
  it('should export a valid PluginPackage', () => {
    expect(huePlugin.manifest).toBe(manifest);
    expect(typeof huePlugin.createClient).toBe('function');
  });

  it('should produce a working client from the package factory', () => {
    const hostAPI = createMockHostAPI();
    const client = huePlugin.createClient(hostAPI);
    expect(client.isConnected()).toBe(false);
    expect(client.getState()).toHaveProperty('connected', false);
  });
});
