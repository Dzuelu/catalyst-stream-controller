import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';
import WebSocket from 'ws';

// ─── Discord RPC Protocol Types ──────────────────────────────

interface RPCMessage {
  cmd: string;
  nonce?: string;
  args?: Record<string, unknown>;
  evt?: string | null;
  data?: Record<string, unknown>;
}

/** Port range Discord RPC listens on */
const RPC_PORT_MIN = 6463;
const RPC_PORT_MAX = 6472;

const RECONNECT_INTERVAL_MS = 5000;

// ─── Discord State Type ──────────────────────────────────────

interface DiscordState {
  connected: boolean;
  authenticated: boolean;
  username: string | null;
  muted: boolean;
  deafened: boolean;
  inputVolume: number;
  outputVolume: number;
  currentVoiceChannelId: string | null;
  voiceConnectionState: string | null;
}

const DEFAULT_STATE: DiscordState = {
  connected: false,
  authenticated: false,
  username: null,
  muted: false,
  deafened: false,
  inputVolume: 100,
  outputVolume: 100,
  currentVoiceChannelId: null,
  voiceConnectionState: null
};

// ─── Plugin Client Implementation ────────────────────────────

class DiscordPluginClient implements PluginClient {
  private ws: WebSocket | null = null;
  private state: DiscordState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;

  /** Pending RPC responses keyed by nonce */
  private pendingResponses: Map<string, { resolve: (data: unknown) => void; reject: (err: Error) => void }> = new Map();

  /** The port we successfully connected to */
  private connectedPort: number | null = null;

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
  }

  // ─── PluginClient interface ─────────────────────────────────

  async connect(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();

    const clientId = settings.clientId as string;
    if (!clientId) {
      throw new Error('Discord Client ID is required');
    }

    // Try each port until we find Discord
    let lastError: Error | null = null;
    for (let port = RPC_PORT_MIN; port <= RPC_PORT_MAX; port++) {
      try {
        await this.connectToPort(port, clientId, settings);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    this.scheduleReconnect();
    throw lastError ?? new Error('Could not connect to Discord RPC on any port');
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connectedPort = null;
    this.pendingResponses.forEach((p) => p.reject(new Error('Disconnected')));
    this.pendingResponses.clear();

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

  setOnStateChanged(handler: (state: Record<string, unknown>) => void): void {
    this.onStateChangedHandler = handler;
  }

  async executeAction(config: Record<string, unknown>): Promise<void> {
    if (!this.ws || !this.state.authenticated) {
      this.hostAPI.log('warn', 'Cannot execute action — not authenticated');
      return;
    }

    const action = config.pluginAction as string;

    switch (action) {
      case 'toggle-mute': {
        await this.sendCommand('SET_VOICE_SETTINGS', { mute: !this.state.muted });
        break;
      }
      case 'toggle-deafen': {
        await this.sendCommand('SET_VOICE_SETTINGS', { deaf: !this.state.deafened });
        break;
      }
      case 'set-mute': {
        await this.sendCommand('SET_VOICE_SETTINGS', {
          mute: config.muted ?? true
        });
        break;
      }
      case 'set-deafen': {
        await this.sendCommand('SET_VOICE_SETTINGS', {
          deaf: config.deafened ?? true
        });
        break;
      }
      case 'join-voice-channel': {
        if (!config.channelId) {
          this.hostAPI.log('warn', 'No channel ID for join-voice-channel');
          return;
        }
        await this.sendCommand('SELECT_VOICE_CHANNEL', {
          channel_id: config.channelId
        });
        break;
      }
      case 'leave-voice-channel': {
        await this.sendCommand('SELECT_VOICE_CHANNEL', { channel_id: null });
        break;
      }
      case 'set-input-volume': {
        const vol = Math.max(0, Math.min(200, (config.volume as number) ?? 100));
        await this.sendCommand('SET_VOICE_SETTINGS', { input: { volume: vol } });
        break;
      }
      case 'set-output-volume': {
        const vol = Math.max(0, Math.min(200, (config.volume as number) ?? 100));
        await this.sendCommand('SET_VOICE_SETTINGS', { output: { volume: vol } });
        break;
      }
      default:
        this.hostAPI.log('warn', `Unknown Discord action: ${action}`);
    }
  }

  destroy(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.pendingResponses.forEach((p) => p.reject(new Error('Client destroyed')));
    this.pendingResponses.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Dynamic dropdown queries */
  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {
    getVoiceChannels: async (): Promise<Array<{ value: string; label: string }>> => {
      if (!this.ws || !this.state.authenticated) return [];

      try {
        const guildsResult = (await this.sendCommand('GET_GUILDS', {})) as {
          guilds?: Array<{ id: string; name: string }>;
        };
        const guilds = guildsResult?.guilds ?? [];

        const channels: Array<{ value: string; label: string }> = [];

        for (const guild of guilds) {
          try {
            const channelsResult = (await this.sendCommand('GET_CHANNELS', {
              guild_id: guild.id
            })) as {
              channels?: Array<{ id: string; name: string; type: number }>;
            };

            const voiceChannels = (channelsResult?.channels ?? []).filter(
              (ch) => ch.type === 2 // GUILD_VOICE
            );

            for (const ch of voiceChannels) {
              channels.push({
                value: ch.id,
                label: `${guild.name} / ${ch.name}`
              });
            }
          } catch {
            // Skip guilds we can't fetch channels from
          }
        }

        return channels;
      } catch (err) {
        this.hostAPI.log('error', `Failed to get voice channels: ${err}`);
        return [];
      }
    }
  };

  // ─── Internal: Connection ───────────────────────────────────

  private connectToPort(port: number, clientId: string, settings: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${port}?v=1&client_id=${clientId}`;
      const ws = new WebSocket(url, { origin: 'https://streamkit.discord.com' });

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`Connection to port ${port} timed out`));
      }, 3000);

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        ws.close();
        reject(err);
      });

      ws.on('open', () => {
        clearTimeout(timeout);
        this.ws = ws;
        this.connectedPort = port;
        this.setupWebSocket(ws);
        this.waitForReady(ws)
          .then(async () => {
            this.updateState({ connected: true });
            this.hostAPI.log('info', `Connected on port ${port}`);

            const accessToken = settings.accessToken as string | undefined;
            if (accessToken) {
              try {
                await this.authenticate(accessToken);
              } catch {
                this.hostAPI.log('warn', 'Stored token invalid, need re-authorization');
                try {
                  await this.authorizeAndAuthenticate(clientId);
                } catch (authErr) {
                  this.hostAPI.log('warn', `Authorization failed: ${authErr}`);
                }
              }
            } else {
              try {
                await this.authorizeAndAuthenticate(clientId);
              } catch (authErr) {
                this.hostAPI.log('warn', `Authorization failed: ${authErr}`);
              }
            }

            resolve();
          })
          .catch(reject);
      });
    });
  }

  private waitForReady(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for READY'));
      }, 5000);

      const handler = (data: Buffer | ArrayBuffer | Buffer[]) => {
        try {
          const msg = JSON.parse(data.toString()) as RPCMessage;
          if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
            clearTimeout(timeout);
            ws.off('message', handler);
            resolve();
          }
        } catch {
          // Ignore parse errors during wait
        }
      };

      ws.on('message', handler);
    });
  }

  private async authorizeAndAuthenticate(clientId: string): Promise<void> {
    const authResult = (await this.sendCommand('AUTHORIZE', {
      client_id: clientId,
      scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'],
      prompt: 'none'
    })) as { code?: string };

    if (!authResult?.code) {
      throw new Error('Authorization failed — no code received');
    }

    const tokenResult = await this.exchangeCodeForToken(authResult.code, clientId);
    if (!tokenResult?.access_token) {
      throw new Error('Token exchange failed');
    }

    await this.authenticate(tokenResult.access_token);

    // Store the token for future sessions
    if (this.settings) {
      this.settings = { ...this.settings, accessToken: tokenResult.access_token };
      // Persist via host API
      await this.hostAPI.saveOwnSettings(this.settings);
    }
  }

  private async exchangeCodeForToken(code: string, clientId: string): Promise<{ access_token: string } | null> {
    try {
      const response = await fetch('https://streamkit.discord.com/overlay/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          grant_type: 'authorization_code',
          client_id: clientId
        })
      });

      if (!response.ok) {
        this.hostAPI.log('error', `Token exchange HTTP error: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as { access_token?: string };
      return data.access_token ? { access_token: data.access_token } : null;
    } catch (err) {
      this.hostAPI.log('error', `Token exchange failed: ${err}`);
      return null;
    }
  }

  private async authenticate(accessToken: string): Promise<void> {
    const result = (await this.sendCommand('AUTHENTICATE', {
      access_token: accessToken
    })) as { user?: { username?: string } };

    if (result?.user) {
      this.updateState({
        authenticated: true,
        username: result.user.username ?? null
      });
      this.hostAPI.log('info', `Authenticated as ${result.user.username}`);

      await this.subscribeToEvents();
      await this.refreshFullState();
    } else {
      throw new Error('Authentication failed — no user data');
    }
  }

  /** Get the stored access token (for saving back to settings on connect) */
  getAccessToken(): string | undefined {
    return this.settings?.accessToken as string | undefined;
  }

  // ─── Internal: State ────────────────────────────────────────

  private updateState(partial: Partial<DiscordState>): void {
    this.state = { ...this.state, ...partial };
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    if (this.onStateChangedHandler) {
      this.onStateChangedHandler({ ...this.state } as unknown as Record<string, unknown>);
    }
  }

  // ─── Internal: State Refresh ────────────────────────────────

  private async refreshFullState(): Promise<void> {
    try {
      const voiceSettings = (await this.sendCommand('GET_VOICE_SETTINGS', {})) as {
        mute?: boolean;
        deaf?: boolean;
        input?: { volume?: number };
        output?: { volume?: number };
      };

      if (voiceSettings) {
        this.updateState({
          muted: voiceSettings.mute ?? false,
          deafened: voiceSettings.deaf ?? false,
          inputVolume: voiceSettings.input?.volume ?? 100,
          outputVolume: voiceSettings.output?.volume ?? 100
        });
      }

      const selectedChannel = (await this.sendCommand('GET_SELECTED_VOICE_CHANNEL', {})) as {
        id?: string;
      } | null;

      this.updateState({
        currentVoiceChannelId: selectedChannel?.id ?? null
      });
    } catch (err) {
      this.hostAPI.log('error', `Failed to refresh state: ${err}`);
    }
  }

  // ─── Internal: Events ───────────────────────────────────────

  private async subscribeToEvents(): Promise<void> {
    try {
      await this.subscribe('VOICE_SETTINGS_UPDATE');
      await this.subscribe('VOICE_CHANNEL_SELECT');
      await this.subscribe('VOICE_CONNECTION_STATUS');
      this.hostAPI.log('info', 'Subscribed to voice events');
    } catch (err) {
      this.hostAPI.log('error', `Failed to subscribe to events: ${err}`);
    }
  }

  private async subscribe(event: string, args?: Record<string, unknown>): Promise<void> {
    await this.sendCommand('SUBSCRIBE', args ?? {}, event);
  }

  // ─── Internal: WebSocket ────────────────────────────────────

  private setupWebSocket(ws: WebSocket): void {
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const msg = JSON.parse(data.toString()) as RPCMessage;
        this.handleMessage(msg);
      } catch (err) {
        this.hostAPI.log('error', `Failed to parse message: ${err}`);
      }
    });

    ws.on('close', () => {
      this.hostAPI.log('info', 'WebSocket closed');
      this.ws = null;
      this.connectedPort = null;

      this.pendingResponses.forEach((p) => p.reject(new Error('Connection closed')));
      this.pendingResponses.clear();

      this.state = { ...DEFAULT_STATE };
      this.emitStateChanged();

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    });

    ws.on('error', (err: Error) => {
      this.hostAPI.log('error', `WebSocket error: ${err.message}`);
    });
  }

  private handleMessage(msg: RPCMessage): void {
    if (msg.nonce && this.pendingResponses.has(msg.nonce)) {
      const pending = this.pendingResponses.get(msg.nonce)!;
      this.pendingResponses.delete(msg.nonce);

      if (msg.evt === 'ERROR') {
        pending.reject(new Error(`Discord RPC Error: ${(msg.data as Record<string, unknown>)?.message ?? 'Unknown'}`));
      } else {
        pending.resolve(msg.data ?? {});
      }
      return;
    }

    if (msg.cmd === 'DISPATCH') {
      this.handleEvent(msg.evt ?? '', msg.data ?? {});
    }
  }

  private handleEvent(event: string, data: Record<string, unknown>): void {
    switch (event) {
      case 'VOICE_SETTINGS_UPDATE': {
        const update: Partial<DiscordState> = {};
        if (typeof data.mute === 'boolean') update.muted = data.mute;
        if (typeof data.deaf === 'boolean') update.deafened = data.deaf;
        if (data.input && typeof (data.input as Record<string, unknown>).volume === 'number') {
          update.inputVolume = (data.input as Record<string, unknown>).volume as number;
        }
        if (data.output && typeof (data.output as Record<string, unknown>).volume === 'number') {
          update.outputVolume = (data.output as Record<string, unknown>).volume as number;
        }
        this.updateState(update);
        break;
      }
      case 'VOICE_CHANNEL_SELECT': {
        this.updateState({
          currentVoiceChannelId: (data.channel_id as string) ?? null
        });
        break;
      }
      case 'VOICE_CONNECTION_STATUS': {
        this.updateState({
          voiceConnectionState: (data.state as string) ?? null
        });
        break;
      }
      case 'READY':
        break;
      default:
        break;
    }
  }

  private sendCommand(cmd: string, args: Record<string, unknown>, evt?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      const message: RPCMessage = { cmd, nonce, args };
      if (evt) message.evt = evt;

      this.pendingResponses.set(nonce, { resolve, reject });

      setTimeout(() => {
        if (this.pendingResponses.has(nonce)) {
          this.pendingResponses.delete(nonce);
          reject(new Error(`RPC command ${cmd} timed out`));
        }
      }, 10000);

      this.ws.send(JSON.stringify(message));
    });
  }

  // ─── Internal: Reconnection ─────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalDisconnect) return;
    this.hostAPI.log('info', `Scheduling reconnect in ${RECONNECT_INTERVAL_MS}ms`);
    this.reconnectTimer = setInterval(() => {
      if (this.ws) {
        this.clearReconnectTimer();
        return;
      }
      if (this.settings) {
        this.hostAPI.log('info', 'Attempting reconnect...');
        this.connect(this.settings).catch(() => {
          // Will retry on next interval
        });
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ─── Factory ─────────────────────────────────────────────────

export const createClient: PluginClientFactory = (hostAPI: PluginHostAPI): PluginClient => {
  return new DiscordPluginClient(hostAPI);
};
