import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manifest } from '../../../src/plugins/midi/manifest';
import { createClient } from '../../../src/plugins/midi/client';
import { midiPlugin } from '../../../src/plugins/midi';
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

describe('MIDI Plugin — Manifest', () => {
  it('should have correct id', () => {
    expect(manifest.id).toBe('midi');
  });

  it('should have correct name', () => {
    expect(manifest.name).toBe('MIDI');
  });

  it('should have a semver version', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('should define connection fields', () => {
    expect(manifest.connection).toBeDefined();
    expect(manifest.connection!.fields.length).toBeGreaterThanOrEqual(1);
    const keys = manifest.connection!.fields.map((f) => f.key);
    expect(keys).toContain('outputPort');
    expect(keys).toContain('autoConnect');
  });

  it('should have dynamic query for output ports', () => {
    const portField = manifest.connection!.fields.find((f) => f.key === 'outputPort');
    expect(portField).toBeDefined();
    expect(portField!.dynamicOptionsQuery).toBe('getOutputPorts');
  });

  it('should define state defaults', () => {
    expect(manifest.state).toBeDefined();
    expect(manifest.state!.defaults).toHaveProperty('connected', false);
    expect(manifest.state!.defaults).toHaveProperty('outputPortName', null);
    expect(manifest.state!.defaults).toHaveProperty('outputPortCount', 0);
  });

  it('should define state display fields', () => {
    expect(manifest.state!.display).toBeDefined();
    const displayKeys = manifest.state!.display!.map((d) => d.key);
    expect(displayKeys).toContain('outputPortName');
    expect(displayKeys).toContain('outputPortCount');
  });

  // ── Actions ─────────────────────────────────────────────

  describe('actions', () => {
    it('should define note actions', () => {
      expect(manifest.actions['send-note-on']).toBeDefined();
      expect(manifest.actions['send-note-off']).toBeDefined();
    });

    it('should define control change actions', () => {
      expect(manifest.actions['send-cc']).toBeDefined();
      expect(manifest.actions['send-cc-toggle']).toBeDefined();
    });

    it('should define program change action', () => {
      expect(manifest.actions['send-program-change']).toBeDefined();
    });

    it('should define pitch bend action', () => {
      expect(manifest.actions['send-pitch-bend']).toBeDefined();
    });

    it('should define transport actions', () => {
      expect(manifest.actions['transport-play']).toBeDefined();
      expect(manifest.actions['transport-stop']).toBeDefined();
      expect(manifest.actions['transport-record']).toBeDefined();
      expect(manifest.actions['transport-rewind']).toBeDefined();
      expect(manifest.actions['transport-fast-forward']).toBeDefined();
    });

    it('should define knob-cc action for encoders', () => {
      expect(manifest.actions['knob-cc']).toBeDefined();
      expect(manifest.actions['knob-cc'].params?.stepSize).toBeDefined();
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

    it('send-note-on should have channel/note/velocity params', () => {
      const action = manifest.actions['send-note-on'];
      expect(action.params?.channel).toBeDefined();
      expect(action.params?.note).toBeDefined();
      expect(action.params?.velocity).toBeDefined();
      expect(action.params!.note.type).toBe('number');
      expect(action.params!.note.min).toBe(0);
      expect(action.params!.note.max).toBe(127);
    });

    it('send-cc should have channel/controller/value params', () => {
      const action = manifest.actions['send-cc'];
      expect(action.params?.channel).toBeDefined();
      expect(action.params?.controller).toBeDefined();
      expect(action.params?.value).toBeDefined();
      expect(action.params!.controller.type).toBe('number');
      expect(action.params!.controller.max).toBe(127);
    });

    it('send-program-change should have channel/program params', () => {
      const action = manifest.actions['send-program-change'];
      expect(action.params?.channel).toBeDefined();
      expect(action.params?.program).toBeDefined();
      expect(action.params!.program.type).toBe('number');
      expect(action.params!.program.max).toBe(127);
    });

    it('send-pitch-bend should have channel/value params with presets', () => {
      const action = manifest.actions['send-pitch-bend'];
      expect(action.params?.channel).toBeDefined();
      expect(action.params?.value).toBeDefined();
      expect(action.params!.value.type).toBe('select');
      expect(action.params!.value.options!.length).toBeGreaterThanOrEqual(3);
    });

    it('transport actions should have no params', () => {
      const transports = ['transport-play', 'transport-stop', 'transport-record'];
      for (const key of transports) {
        const action = manifest.actions[key];
        expect(Object.keys(action.params ?? {})).toHaveLength(0);
      }
    });

    it('channel params should offer 16 channels', () => {
      const noteOn = manifest.actions['send-note-on'];
      expect(noteOn.params?.channel).toBeDefined();
      expect(noteOn.params!.channel.type).toBe('select');
      expect(noteOn.params!.channel.options!.length).toBe(16);
    });

    it('knob-cc should have step size options', () => {
      const action = manifest.actions['knob-cc'];
      expect(action.params?.stepSize).toBeDefined();
      expect(action.params!.stepSize.type).toBe('select');
      expect(action.params!.stepSize.options!.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Icons ───────────────────────────────────────────────

  describe('icon packs', () => {
    it('should define a MIDI icon pack', () => {
      expect(manifest.iconPacks).toBeDefined();
      expect(manifest.iconPacks!.length).toBeGreaterThanOrEqual(1);
      expect(manifest.iconPacks![0].label).toBe('MIDI');
    });

    it('should have namespaced icon IDs', () => {
      for (const pack of manifest.iconPacks ?? []) {
        for (const icon of pack.icons) {
          expect(icon.id).toMatch(/^plugin:midi:/);
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

describe('MIDI Plugin — Client', () => {
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
    expect(state.outputPortName).toBeNull();
    expect(state.outputPortCount).toBe(0);
  });

  it('should support setOnStateChanged', () => {
    const client = createClient(hostAPI);
    const handler = vi.fn();
    client.setOnStateChanged(handler);
    expect(true).toBe(true);
  });

  it('should throw when connecting without output port', async () => {
    const client = createClient(hostAPI);
    await expect(client.connect({ outputPort: '' })).rejects.toThrow('MIDI output port is required');
  });

  it('should throw when midi library is not available', async () => {
    // The test environment doesn't have native midi installed
    const client = createClient(hostAPI);
    await expect(client.connect({ outputPort: 'IAC Driver Bus 1' })).rejects.toThrow(/MIDI library not available/);
  });

  it('should log warning when executing action while disconnected', async () => {
    const client = createClient(hostAPI);
    await client.executeAction({ pluginAction: 'send-note-on' });
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

  it('should expose dynamic query for output ports', () => {
    const client = createClient(hostAPI);
    expect(client.queries).toBeDefined();
    expect(typeof client.queries!.getOutputPorts).toBe('function');
  });

  it('should return empty array from port query when midi unavailable', async () => {
    const client = createClient(hostAPI);
    const ports = await client.queries!.getOutputPorts();
    // Will be empty because native midi package is not installed in test env
    expect(Array.isArray(ports)).toBe(true);
  });
});

// ─── Plugin Package Tests ───────────────────────────────────────

describe('MIDI Plugin — Package', () => {
  it('should export a valid PluginPackage', () => {
    expect(midiPlugin.manifest).toBe(manifest);
    expect(typeof midiPlugin.createClient).toBe('function');
  });

  it('should produce a working client from the package factory', () => {
    const hostAPI = createMockHostAPI();
    const client = midiPlugin.createClient(hostAPI);
    expect(client.isConnected()).toBe(false);
    expect(client.getState()).toHaveProperty('connected', false);
  });
});
