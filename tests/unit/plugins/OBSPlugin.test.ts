import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClient } from '../../../src/plugins/obs/client';
import { manifest } from '../../../src/plugins/obs/manifest';
import { getMockOBSInstance, resetMockOBS } from '../../mocks/obs-websocket-js';
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
  url: 'ws://localhost:4455',
  password: 'test-pass',
  autoConnect: false
};

// ─── Manifest Tests ─────────────────────────────────────────────

describe('OBS Plugin Manifest', () => {
  it('should have correct metadata', () => {
    expect(manifest.id).toBe('obs');
    expect(manifest.name).toBe('OBS Studio');
    expect(manifest.version).toBe('1.0.0');
  });

  it('should declare all 12 actions', () => {
    const actionIds = Object.keys(manifest.actions);
    expect(actionIds).toHaveLength(12);
    expect(actionIds).toContain('switch-scene');
    expect(actionIds).toContain('toggle-stream');
    expect(actionIds).toContain('start-stream');
    expect(actionIds).toContain('stop-stream');
    expect(actionIds).toContain('toggle-record');
    expect(actionIds).toContain('start-record');
    expect(actionIds).toContain('stop-record');
    expect(actionIds).toContain('toggle-mute');
    expect(actionIds).toContain('set-mute');
    expect(actionIds).toContain('toggle-source-visibility');
    expect(actionIds).toContain('save-replay-buffer');
    expect(actionIds).toContain('toggle-virtual-cam');
  });

  it('should have params defined on actions that need them', () => {
    expect(manifest.actions['switch-scene'].params).toHaveProperty('sceneName');
    expect(manifest.actions['toggle-mute'].params).toHaveProperty('inputName');
    expect(manifest.actions['set-mute'].params).toHaveProperty('inputName');
    expect(manifest.actions['set-mute'].params).toHaveProperty('muted');
    expect(manifest.actions['toggle-source-visibility'].params).toHaveProperty('sceneName');
    expect(manifest.actions['toggle-source-visibility'].params).toHaveProperty('sourceName');
  });

  it('should have no params on parameterless actions', () => {
    expect(manifest.actions['toggle-stream'].params).toBeUndefined();
    expect(manifest.actions['start-stream'].params).toBeUndefined();
    expect(manifest.actions['save-replay-buffer'].params).toBeUndefined();
  });

  it('should have dynamic options queries on select fields', () => {
    expect(manifest.actions['switch-scene'].params!.sceneName.dynamicOptionsQuery).toBe('getScenes');
    expect(manifest.actions['toggle-mute'].params!.inputName.dynamicOptionsQuery).toBe('getInputs');
  });

  it('should declare connection settings fields', () => {
    expect(manifest.connection!.fields).toHaveLength(3);
    const keys = manifest.connection!.fields.map((f: { key: string }) => f.key);
    expect(keys).toContain('url');
    expect(keys).toContain('password');
    expect(keys).toContain('autoConnect');
  });

  it('should have default state with expected keys', () => {
    expect(manifest.state!.defaults).toHaveProperty('connected', false);
    expect(manifest.state!.defaults).toHaveProperty('streaming', false);
    expect(manifest.state!.defaults).toHaveProperty('recording', false);
    expect(manifest.state!.defaults).toHaveProperty('currentScene', null);
  });

  it('should have state display fields', () => {
    expect(manifest.state!.display).toBeDefined();
    expect(manifest.state!.display!.length).toBeGreaterThan(0);
  });
});

// ─── Client Tests ───────────────────────────────────────────────

describe('OBS Plugin Client', () => {
  let client: ReturnType<typeof createClient>;
  let hostAPI: PluginHostAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    resetMockOBS();
    hostAPI = createMockHostAPI();
    client = createClient(hostAPI);
  });

  afterEach(() => {
    client.destroy();
    vi.useRealTimers();
  });

  // ─── Connection ───────────────────────────────────────────

  describe('connection', () => {
    it('should connect via obs-websocket-js and refresh state', async () => {
      await client.connect(DEFAULT_SETTINGS);

      const obs = getMockOBSInstance();
      expect(obs.connect).toHaveBeenCalledWith(
        DEFAULT_SETTINGS.url,
        DEFAULT_SETTINGS.password,
        expect.objectContaining({ rpcVersion: 1 })
      );
      expect(client.isConnected()).toBe(true);
    });

    it('should log connection events via hostAPI', async () => {
      await client.connect(DEFAULT_SETTINGS);

      expect(hostAPI.log).toHaveBeenCalledWith('info', expect.stringContaining('Connecting'));
      expect(hostAPI.log).toHaveBeenCalledWith('info', expect.stringContaining('Connected'));
    });

    it('should throw and log on connection failure', async () => {
      const obs = getMockOBSInstance();
      obs.connect.mockRejectedValueOnce(new Error('refused'));

      await expect(client.connect(DEFAULT_SETTINGS)).rejects.toThrow('refused');
      expect(client.isConnected()).toBe(false);
      expect(hostAPI.log).toHaveBeenCalledWith('error', expect.stringContaining('refused'));
    });

    it('should disconnect and reset state', async () => {
      await client.connect(DEFAULT_SETTINGS);
      await client.disconnect();

      expect(client.isConnected()).toBe(false);
      expect(client.getState()).toHaveProperty('connected', false);
      expect(client.getState()).toHaveProperty('currentScene', null);
    });

    it('should schedule reconnect on connection failure', async () => {
      const obs = getMockOBSInstance();
      obs.connect.mockRejectedValueOnce(new Error('fail'));

      try {
        await client.connect(DEFAULT_SETTINGS);
      } catch {
        // expected
      }

      expect(hostAPI.log).toHaveBeenCalledWith('info', expect.stringContaining('reconnect'));
    });
  });

  // ─── State Management ────────────────────────────────────

  describe('state', () => {
    it('should emit state changes to the registered handler', async () => {
      const handler = vi.fn();
      client.setOnStateChanged(handler);

      await client.connect(DEFAULT_SETTINGS);

      expect(handler).toHaveBeenCalled();
      const lastState = handler.mock.calls[handler.mock.calls.length - 1][0];
      expect(lastState.connected).toBe(true);
    });

    it('should return a copy of state', () => {
      const s1 = client.getState();
      const s2 = client.getState();
      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });

    it('should start with default state', () => {
      const state = client.getState();
      expect(state).toHaveProperty('connected', false);
      expect(state).toHaveProperty('streaming', false);
      expect(state).toHaveProperty('recording', false);
    });
  });

  // ─── Queries ──────────────────────────────────────────────

  describe('queries', () => {
    it('should expose getScenes and getInputs query methods', () => {
      expect(client.queries).toBeDefined();
      expect(typeof client.queries!.getScenes).toBe('function');
      expect(typeof client.queries!.getInputs).toBe('function');
    });

    it('should return empty array for getScenes when disconnected', async () => {
      const scenes = await client.queries!.getScenes();
      expect(scenes).toEqual([]);
    });

    it('should return empty array for getInputs when disconnected', async () => {
      const inputs = await client.queries!.getInputs();
      expect(inputs).toEqual([]);
    });

    it('should fetch scenes when connected', async () => {
      const obs = getMockOBSInstance();
      await client.connect(DEFAULT_SETTINGS);

      obs.call.mockImplementation(async (method: string) => {
        if (method === 'GetSceneList') {
          return { scenes: [{ sceneName: 'Scene A' }, { sceneName: 'Scene B' }] };
        }
        return {};
      });

      const scenes = await client.queries!.getScenes();
      expect(scenes).toEqual([
        { value: 'Scene B', label: 'Scene B' },
        { value: 'Scene A', label: 'Scene A' }
      ]);
    });

    it('should fetch inputs when connected', async () => {
      const obs = getMockOBSInstance();
      await client.connect(DEFAULT_SETTINGS);

      obs.call.mockImplementation(async (method: string) => {
        if (method === 'GetInputList') {
          return { inputs: [{ inputName: 'Mic' }, { inputName: 'Desktop' }] };
        }
        return {};
      });

      const inputs = await client.queries!.getInputs();
      expect(inputs).toEqual([
        { value: 'Mic', label: 'Mic' },
        { value: 'Desktop', label: 'Desktop' }
      ]);
    });
  });

  // ─── Action Execution ────────────────────────────────────

  describe('executeAction', () => {
    beforeEach(async () => {
      await client.connect(DEFAULT_SETTINGS);
    });

    it('should warn when not connected', async () => {
      await client.disconnect();
      await client.executeAction({ pluginAction: 'toggle-stream' });
      expect(hostAPI.log).toHaveBeenCalledWith('warn', expect.stringContaining('not connected'));
    });

    it('should switch scene', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'switch-scene', sceneName: 'Gaming' });
      expect(obs.call).toHaveBeenCalledWith('SetCurrentProgramScene', { sceneName: 'Gaming' });
    });

    it('should toggle stream', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'toggle-stream' });
      expect(obs.call).toHaveBeenCalledWith('ToggleStream');
    });

    it('should start/stop stream', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'start-stream' });
      expect(obs.call).toHaveBeenCalledWith('StartStream');

      await client.executeAction({ pluginAction: 'stop-stream' });
      expect(obs.call).toHaveBeenCalledWith('StopStream');
    });

    it('should toggle record', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'toggle-record' });
      expect(obs.call).toHaveBeenCalledWith('ToggleRecord');
    });

    it('should start/stop record', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'start-record' });
      expect(obs.call).toHaveBeenCalledWith('StartRecord');

      await client.executeAction({ pluginAction: 'stop-record' });
      expect(obs.call).toHaveBeenCalledWith('StopRecord');
    });

    it('should toggle mute', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'toggle-mute', inputName: 'Mic' });
      expect(obs.call).toHaveBeenCalledWith('ToggleInputMute', { inputName: 'Mic' });
    });

    it('should set mute', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'set-mute', inputName: 'Mic', muted: true });
      expect(obs.call).toHaveBeenCalledWith('SetInputMute', { inputName: 'Mic', inputMuted: true });
    });

    it('should toggle source visibility', async () => {
      const obs = getMockOBSInstance();
      obs.call.mockImplementation(async (method: string) => {
        if (method === 'GetSceneItemId') return { sceneItemId: 42 };
        if (method === 'GetSceneItemEnabled') return { sceneItemEnabled: true };
        return {};
      });

      await client.executeAction({
        pluginAction: 'toggle-source-visibility',
        sceneName: 'Gaming',
        sourceName: 'Webcam'
      });

      expect(obs.call).toHaveBeenCalledWith('SetSceneItemEnabled', {
        sceneName: 'Gaming',
        sceneItemId: 42,
        sceneItemEnabled: false
      });
    });

    it('should save replay buffer', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'save-replay-buffer' });
      expect(obs.call).toHaveBeenCalledWith('SaveReplayBuffer');
    });

    it('should toggle virtual cam', async () => {
      const obs = getMockOBSInstance();
      await client.executeAction({ pluginAction: 'toggle-virtual-cam' });
      expect(obs.call).toHaveBeenCalledWith('ToggleVirtualCam');
    });

    it('should log warning for unknown action', async () => {
      await client.executeAction({ pluginAction: 'teleport' });
      expect(hostAPI.log).toHaveBeenCalledWith('warn', expect.stringContaining('Unknown action'));
    });

    it('should log error when action throws', async () => {
      const obs = getMockOBSInstance();
      obs.call.mockRejectedValueOnce(new Error('OBS error'));

      await client.executeAction({ pluginAction: 'toggle-stream' });
      expect(hostAPI.log).toHaveBeenCalledWith('error', expect.stringContaining('failed'));
    });
  });

  // ─── Event Listeners ─────────────────────────────────────

  describe('event listeners', () => {
    it('should update currentScene on CurrentProgramSceneChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('CurrentProgramSceneChanged', { sceneName: 'New Scene' });
      expect(client.getState()).toHaveProperty('currentScene', 'New Scene');
    });

    it('should update streaming on StreamStateChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('StreamStateChanged', { outputActive: true, outputState: 'started' });
      expect(client.getState()).toHaveProperty('streaming', true);
    });

    it('should update recording on RecordStateChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('RecordStateChanged', { outputActive: true, outputState: 'started' });
      expect(client.getState()).toHaveProperty('recording', true);
    });

    it('should update virtualCamActive on VirtualcamStateChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('VirtualcamStateChanged', { outputActive: true });
      expect(client.getState()).toHaveProperty('virtualCamActive', true);
    });

    it('should update replayBufferActive on ReplayBufferStateChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('ReplayBufferStateChanged', { outputActive: true });
      expect(client.getState()).toHaveProperty('replayBufferActive', true);
    });

    it('should update mutedInputs on InputMuteStateChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('InputMuteStateChanged', { inputName: 'Mic', inputMuted: true });
      expect((client.getState() as Record<string, unknown>).mutedInputs).toEqual({ Mic: true });
    });

    it('should reset state on ConnectionClosed', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('ConnectionClosed');
      expect(client.getState()).toHaveProperty('connected', false);
    });

    it('should update scene list on SceneListChanged', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      obs.emit('SceneListChanged', { scenes: [{ sceneName: 'A' }, { sceneName: 'B' }] });
      expect((client.getState() as Record<string, unknown>).scenes).toEqual(['B', 'A']);
    });
  });

  // ─── Destroy ──────────────────────────────────────────────

  describe('destroy', () => {
    it('should not throw and clean up timers', () => {
      expect(() => client.destroy()).not.toThrow();
      vi.advanceTimersByTime(10000);
    });

    it('should disconnect the obs-websocket', async () => {
      await client.connect(DEFAULT_SETTINGS);
      const obs = getMockOBSInstance();

      client.destroy();

      expect(obs.disconnect).toHaveBeenCalled();
    });
  });
});
