import OBSWebSocket from 'obs-websocket-js';
import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';

/**
 * OBS Studio plugin client — adapts `obs-websocket-js` to the
 * generic `PluginClient` interface consumed by PluginRegistry.
 */

interface OBSState {
  connected: boolean;
  currentScene: string | null;
  scenes: string[];
  streaming: boolean;
  recording: boolean;
  recordPaused: boolean;
  virtualCamActive: boolean;
  replayBufferActive: boolean;
  mutedInputs: Record<string, boolean>;
}

const DEFAULT_STATE: OBSState = {
  connected: false,
  currentScene: null,
  scenes: [],
  streaming: false,
  recording: false,
  recordPaused: false,
  virtualCamActive: false,
  replayBufferActive: false,
  mutedInputs: {}
};

class OBSPluginClient implements PluginClient {
  private obs = new OBSWebSocket();
  private state: OBSState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInterval = 5000;
  private intentionalDisconnect = false;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
    this.setupEventListeners();
  }

  // ─── PluginClient interface ──────────────────────────────

  async connect(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();

    const url = (settings.url as string) || 'ws://127.0.0.1:4455';
    const password = (settings.password as string) || undefined;

    try {
      this.hostAPI.log('info', `Connecting to ${url}...`);
      await this.obs.connect(url, password, { rpcVersion: 1 });
      this.hostAPI.log('info', 'Connected successfully');
      await this.refreshFullState();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hostAPI.log('error', `Connection failed: ${msg}`);
      this.updateState({ connected: false });
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    try {
      await this.obs.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    this.state = { ...DEFAULT_STATE };
    this.emitStateChanged();
    this.hostAPI.log('info', 'Disconnected');
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  getState(): Record<string, unknown> {
    return { ...this.state } as unknown as Record<string, unknown>;
  }

  setOnStateChanged(handler: ((state: Record<string, unknown>) => void) | null): void {
    this.onStateChangedHandler = handler;
  }

  async executeAction(config: Record<string, unknown>): Promise<void> {
    if (!this.state.connected) {
      this.hostAPI.log('warn', 'Cannot execute action — not connected');
      return;
    }

    const actionKey = (config.pluginAction as string) ?? '';
    const params = config;

    try {
      switch (actionKey) {
        case 'switch-scene':
          if (params.sceneName) {
            await this.obs.call('SetCurrentProgramScene', { sceneName: params.sceneName as string });
          }
          break;

        case 'toggle-stream':
          await this.obs.call('ToggleStream');
          break;

        case 'start-stream':
          await this.obs.call('StartStream');
          break;

        case 'stop-stream':
          await this.obs.call('StopStream');
          break;

        case 'toggle-record':
          await this.obs.call('ToggleRecord');
          break;

        case 'start-record':
          await this.obs.call('StartRecord');
          break;

        case 'stop-record':
          await this.obs.call('StopRecord');
          break;

        case 'toggle-mute':
          if (params.inputName) {
            await this.obs.call('ToggleInputMute', { inputName: params.inputName as string });
          }
          break;

        case 'set-mute':
          if (params.inputName && params.muted !== undefined) {
            await this.obs.call('SetInputMute', {
              inputName: params.inputName as string,
              inputMuted: params.muted as boolean
            });
          }
          break;

        case 'toggle-source-visibility':
          if (params.sceneName && params.sourceName) {
            const { sceneItemId } = await this.obs.call('GetSceneItemId', {
              sceneName: params.sceneName as string,
              sourceName: params.sourceName as string
            });
            const { sceneItemEnabled } = await this.obs.call('GetSceneItemEnabled', {
              sceneName: params.sceneName as string,
              sceneItemId
            });
            await this.obs.call('SetSceneItemEnabled', {
              sceneName: params.sceneName as string,
              sceneItemId,
              sceneItemEnabled: !sceneItemEnabled
            });
          }
          break;

        case 'save-replay-buffer':
          await this.obs.call('SaveReplayBuffer');
          break;

        case 'toggle-virtual-cam':
          await this.obs.call('ToggleVirtualCam');
          break;

        default:
          this.hostAPI.log('warn', `Unknown action: ${actionKey}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hostAPI.log('error', `Action "${actionKey}" failed: ${msg}`);
    }
  }

  destroy(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.obs.disconnect().catch(() => {});
  }

  // ─── Queries ─────────────────────────────────────────────

  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {
    getScenes: async (): Promise<Array<{ value: string; label: string }>> => {
      if (!this.state.connected) return [];
      try {
        const { scenes } = await this.obs.call('GetSceneList');
        return (scenes as Array<{ sceneName: string }>)
          .map((s) => s.sceneName)
          .reverse()
          .map((name) => ({ value: name, label: name }));
      } catch (error) {
        this.hostAPI.log('error', `Failed to get scenes: ${error}`);
        return [];
      }
    },

    getInputs: async (): Promise<Array<{ value: string; label: string }>> => {
      if (!this.state.connected) return [];
      try {
        const { inputs } = await this.obs.call('GetInputList');
        return (inputs as Array<{ inputName: string }>)
          .map((i) => i.inputName)
          .map((name) => ({ value: name, label: name }));
      } catch (error) {
        this.hostAPI.log('error', `Failed to get inputs: ${error}`);
        return [];
      }
    }
  };

  // ─── Internal: State Management ──────────────────────────

  private async refreshFullState(): Promise<void> {
    try {
      const sceneResult = await this.obs.call('GetCurrentProgramScene');
      const sceneListResult = await this.obs.call('GetSceneList');
      const scenes = (sceneListResult.scenes as Array<{ sceneName: string }>).map((s) => s.sceneName).reverse();

      const streamResult = await this.obs.call('GetStreamStatus');
      const recordResult = await this.obs.call('GetRecordStatus');

      let virtualCamActive = false;
      try {
        const vcResult = await this.obs.call('GetVirtualCamStatus');
        virtualCamActive = vcResult.outputActive;
      } catch {
        // Virtual cam may not be available
      }

      let replayBufferActive = false;
      try {
        const rbResult = await this.obs.call('GetReplayBufferStatus');
        replayBufferActive = rbResult.outputActive;
      } catch {
        // Replay buffer may not be configured
      }

      const mutedInputs: Record<string, boolean> = {};
      try {
        const inputsResult = await this.obs.call('GetInputList');
        const inputs = inputsResult.inputs as Array<{ inputName: string }>;
        for (const input of inputs) {
          try {
            const muteResult = await this.obs.call('GetInputMute', { inputName: input.inputName });
            mutedInputs[input.inputName] = muteResult.inputMuted;
          } catch {
            // Not all inputs support mute
          }
        }
      } catch {
        // Ignore input list errors
      }

      this.state = {
        connected: true,
        currentScene: sceneResult.currentProgramSceneName ?? sceneResult.sceneName ?? null,
        scenes,
        streaming: streamResult.outputActive,
        recording: recordResult.outputActive,
        recordPaused: recordResult.outputPaused ?? false,
        virtualCamActive,
        replayBufferActive,
        mutedInputs
      };
      this.emitStateChanged();
    } catch (error) {
      this.hostAPI.log('error', `Failed to refresh state: ${error}`);
      this.updateState({ connected: true });
    }
  }

  private updateState(partial: Partial<OBSState>): void {
    this.state = { ...this.state, ...partial };
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    if (this.onStateChangedHandler) {
      this.onStateChangedHandler({ ...this.state } as unknown as Record<string, unknown>);
    }
  }

  // ─── Internal: Event Listeners ──────────────────────────

  private setupEventListeners(): void {
    this.obs.on('Identified', () => {
      this.hostAPI.log('info', 'Identified with server');
    });

    this.obs.on('ConnectionClosed', () => {
      const wasConnected = this.state.connected;
      this.state = { ...DEFAULT_STATE };
      this.emitStateChanged();

      if (wasConnected) {
        this.hostAPI.log('info', 'Connection closed');
        if (!this.intentionalDisconnect) {
          this.scheduleReconnect();
        }
      }
    });

    this.obs.on('CurrentProgramSceneChanged', (event) => {
      this.hostAPI.log('info', `Scene changed → "${event.sceneName}"`);
      this.updateState({ currentScene: event.sceneName });
    });

    this.obs.on('SceneListChanged', (event) => {
      const scenes = (event.scenes as Array<{ sceneName: string }>).map((s) => s.sceneName).reverse();
      this.hostAPI.log('info', `Scene list updated (${scenes.length} scenes)`);
      this.updateState({ scenes });
    });

    this.obs.on('StreamStateChanged', (event) => {
      this.hostAPI.log('info', `Stream ${event.outputActive ? 'started' : 'stopped'}`);
      this.updateState({ streaming: event.outputActive });
    });

    this.obs.on('RecordStateChanged', (event) => {
      this.hostAPI.log('info', `Recording ${event.outputActive ? 'started' : 'stopped'}`);
      this.updateState({
        recording: event.outputActive,
        recordPaused: false
      });
    });

    this.obs.on('VirtualcamStateChanged', (event) => {
      this.hostAPI.log('info', `Virtual cam ${event.outputActive ? 'started' : 'stopped'}`);
      this.updateState({ virtualCamActive: event.outputActive });
    });

    this.obs.on('ReplayBufferStateChanged', (event) => {
      this.hostAPI.log('info', `Replay buffer ${event.outputActive ? 'active' : 'stopped'}`);
      this.updateState({ replayBufferActive: event.outputActive });
    });

    this.obs.on('InputMuteStateChanged', (event) => {
      this.hostAPI.log('info', `Input "${event.inputName}" ${event.inputMuted ? 'muted' : 'unmuted'}`);
      const mutedInputs = { ...this.state.mutedInputs };
      mutedInputs[event.inputName] = event.inputMuted;
      this.updateState({ mutedInputs });
    });
  }

  // ─── Internal: Reconnection ──────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalDisconnect || !this.settings) return;

    this.hostAPI.log('info', `Scheduling reconnect in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || !this.settings) return;

      try {
        await this.connect(this.settings);
      } catch {
        // connect() already schedules another reconnect on failure
      }
    }, this.reconnectInterval);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────

export const createClient: PluginClientFactory = (hostAPI: PluginHostAPI): PluginClient => {
  return new OBSPluginClient(hostAPI);
};
