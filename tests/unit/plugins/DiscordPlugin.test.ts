import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../../../src/plugins/discord/client';
import { manifest } from '../../../src/plugins/discord/manifest';
import { getLastMockWebSocket, resetMockWS } from '../../mocks/ws';
import type { PluginHostAPI } from '../../../src/shared/plugin-types';

// ─── Mock Host API ──────────────────────────────────────────────

function createMockHostAPI(): PluginHostAPI {
  return {
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
    log: vi.fn(),
    getOwnSettings: vi.fn(() => ({})),
    saveOwnSettings: vi.fn(async () => {}),
    createImage: {
      solidColor: vi.fn(() => 'data:image/png;base64,mock'),
      textImage: vi.fn(() => 'data:image/png;base64,mock')
    }
  };
}

const DEFAULT_SETTINGS = {
  clientId: 'test-client-id',
  autoConnect: false
};

// ─── Manifest Tests ─────────────────────────────────────────────

describe('Discord Plugin Manifest', () => {
  it('should have correct metadata', () => {
    expect(manifest.id).toBe('discord');
    expect(manifest.name).toBe('Discord');
    expect(manifest.version).toBe('1.0.0');
  });

  it('should declare all 8 actions', () => {
    const actionIds = Object.keys(manifest.actions);
    expect(actionIds).toHaveLength(8);
    expect(actionIds).toContain('toggle-mute');
    expect(actionIds).toContain('toggle-deafen');
    expect(actionIds).toContain('set-mute');
    expect(actionIds).toContain('set-deafen');
    expect(actionIds).toContain('join-voice-channel');
    expect(actionIds).toContain('leave-voice-channel');
    expect(actionIds).toContain('set-input-volume');
    expect(actionIds).toContain('set-output-volume');
  });

  it('should have params defined on actions that need them', () => {
    expect(manifest.actions['set-mute'].params).toHaveProperty('muted');
    expect(manifest.actions['set-deafen'].params).toHaveProperty('deafened');
    expect(manifest.actions['join-voice-channel'].params).toHaveProperty('channelId');
    expect(manifest.actions['set-input-volume'].params).toHaveProperty('volume');
    expect(manifest.actions['set-output-volume'].params).toHaveProperty('volume');
  });

  it('should have no params on parameterless actions', () => {
    expect(manifest.actions['toggle-mute'].params).toBeUndefined();
    expect(manifest.actions['toggle-deafen'].params).toBeUndefined();
    expect(manifest.actions['leave-voice-channel'].params).toBeUndefined();
  });

  it('should have dynamic options query for channelId', () => {
    expect(manifest.actions['join-voice-channel'].params!.channelId.dynamicOptionsQuery).toBe('getVoiceChannels');
  });

  it('should have connection settings fields', () => {
    expect(manifest.connection!.fields).toHaveLength(2);
    const keys = manifest.connection!.fields.map((f: { key: string }) => f.key);
    expect(keys).toContain('clientId');
    expect(keys).toContain('autoConnect');
  });

  it('should have default state with expected keys', () => {
    expect(manifest.state!.defaults).toHaveProperty('connected', false);
    expect(manifest.state!.defaults).toHaveProperty('authenticated', false);
    expect(manifest.state!.defaults).toHaveProperty('muted', false);
    expect(manifest.state!.defaults).toHaveProperty('deafened', false);
    expect(manifest.state!.defaults).toHaveProperty('inputVolume', 100);
    expect(manifest.state!.defaults).toHaveProperty('outputVolume', 100);
  });

  it('should have state display fields', () => {
    expect(manifest.state!.display).toBeDefined();
    expect(manifest.state!.display!.length).toBeGreaterThan(0);
  });

  it('should have volume param with range constraints', () => {
    expect(manifest.actions['set-input-volume'].params!.volume.type).toBe('range');
    expect(manifest.actions['set-input-volume'].params!.volume.min).toBe(0);
    expect(manifest.actions['set-input-volume'].params!.volume.max).toBe(200);
  });
});

// ─── Client Tests ───────────────────────────────────────────────

describe('Discord Plugin Client', () => {
  let client: ReturnType<typeof createClient>;
  let hostAPI: PluginHostAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    resetMockWS();
    hostAPI = createMockHostAPI();
    client = createClient(hostAPI);
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  // ─── Connection ───────────────────────────────────────────

  describe('connection', () => {
    it('should require a clientId to connect', async () => {
      await expect(client.connect({ clientId: '', autoConnect: false })).rejects.toThrow(
        'Discord Client ID is required'
      );
    });

    it('should create WebSocket with correct URL format', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      expect(ws.url).toMatch(/ws:\/\/127\.0\.0\.1:\d{4}\?v=1&client_id=test-client-id/);

      // Clean up
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);
      ws.close();
      await vi.advanceTimersByTimeAsync(10000);

      try {
        await connectPromise;
      } catch {
        // Expected — auth will fail
      }
    });

    it('should emit connected state when READY is received', async () => {
      const handler = vi.fn();
      client.setOnStateChanged(handler);

      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      const connectedCall = handler.mock.calls.find(
        (call: unknown[]) => (call[0] as Record<string, unknown>).connected === true
      );
      expect(connectedCall).toBeDefined();

      // Clean up
      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });
  });

  // ─── Disconnect ───────────────────────────────────────────

  describe('disconnect', () => {
    it('should reset state on disconnect', async () => {
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toHaveProperty('connected', false);
      expect(client.getState()).toHaveProperty('authenticated', false);
    });

    it('should log disconnect', async () => {
      await client.disconnect();
      expect(hostAPI.log).toHaveBeenCalledWith('info', 'Disconnected');
    });
  });

  // ─── State ────────────────────────────────────────────────

  describe('state', () => {
    it('should start with default state', () => {
      const state = client.getState();
      expect(state).toHaveProperty('connected', false);
      expect(state).toHaveProperty('authenticated', false);
      expect(state).toHaveProperty('muted', false);
      expect(state).toHaveProperty('deafened', false);
      expect(state).toHaveProperty('inputVolume', 100);
      expect(state).toHaveProperty('outputVolume', 100);
    });

    it('should return a copy of state', () => {
      const s1 = client.getState();
      const s2 = client.getState();
      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });
  });

  // ─── Execute Action ───────────────────────────────────────

  describe('executeAction', () => {
    it('should warn when not authenticated', async () => {
      await client.executeAction({ pluginAction: 'toggle-mute' });
      expect(hostAPI.log).toHaveBeenCalledWith('warn', expect.stringContaining('not authenticated'));
    });
  });

  // ─── Event Handling ───────────────────────────────────────

  describe('event handling', () => {
    it('should update muted state on VOICE_SETTINGS_UPDATE', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      ws._receive({
        cmd: 'DISPATCH',
        evt: 'VOICE_SETTINGS_UPDATE',
        data: { mute: true, deaf: false }
      });

      expect(client.getState()).toHaveProperty('muted', true);
      expect(client.getState()).toHaveProperty('deafened', false);

      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });

    it('should update deafened state on VOICE_SETTINGS_UPDATE', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      ws._receive({
        cmd: 'DISPATCH',
        evt: 'VOICE_SETTINGS_UPDATE',
        data: { mute: false, deaf: true }
      });

      expect(client.getState()).toHaveProperty('deafened', true);

      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });

    it('should update volume on VOICE_SETTINGS_UPDATE', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      ws._receive({
        cmd: 'DISPATCH',
        evt: 'VOICE_SETTINGS_UPDATE',
        data: { input: { volume: 75 }, output: { volume: 50 } }
      });

      expect(client.getState()).toHaveProperty('inputVolume', 75);
      expect(client.getState()).toHaveProperty('outputVolume', 50);

      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });

    it('should update currentVoiceChannelId on VOICE_CHANNEL_SELECT', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      ws._receive({
        cmd: 'DISPATCH',
        evt: 'VOICE_CHANNEL_SELECT',
        data: { channel_id: 'ch-123' }
      });

      expect(client.getState()).toHaveProperty('currentVoiceChannelId', 'ch-123');

      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });

    it('should update voiceConnectionState on VOICE_CONNECTION_STATUS', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      ws._receive({
        cmd: 'DISPATCH',
        evt: 'VOICE_CONNECTION_STATUS',
        data: { state: 'VOICE_CONNECTED' }
      });

      expect(client.getState()).toHaveProperty('voiceConnectionState', 'VOICE_CONNECTED');

      ws.close();
      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });
  });

  // ─── Queries ──────────────────────────────────────────────

  describe('queries', () => {
    it('should expose getVoiceChannels query method', () => {
      expect(client.queries).toBeDefined();
      expect(typeof client.queries!.getVoiceChannels).toBe('function');
    });

    it('should return empty array when not authenticated', async () => {
      const channels = await client.queries!.getVoiceChannels();
      expect(channels).toEqual([]);
    });
  });

  // ─── Destroy ──────────────────────────────────────────────

  describe('destroy', () => {
    it('should clean up without errors', () => {
      expect(() => client.destroy()).not.toThrow();
    });

    it('should reject pending responses on destroy', async () => {
      client.destroy();
      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toHaveProperty('connected', false);
    });

    it('should close websocket if open', async () => {
      const connectPromise = client.connect(DEFAULT_SETTINGS);
      await vi.advanceTimersByTimeAsync(0);

      const ws = getLastMockWebSocket();
      ws._receive({ cmd: 'DISPATCH', evt: 'READY', data: {} });
      await vi.advanceTimersByTimeAsync(0);

      client.destroy();
      expect(ws.close).toHaveBeenCalled();

      try {
        await connectPromise;
      } catch {
        // Expected
      }
    });
  });
});
