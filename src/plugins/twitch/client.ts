import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';

// ─── Twitch Helix API helpers ──────────────────────────────────

const HELIX_BASE = 'https://api.twitch.tv/helix';

/** Typed subset of chat settings returned by Helix */
interface ChatSettings {
  emote_mode?: boolean;
  subscriber_mode?: boolean;
  follower_mode?: boolean;
  follower_mode_duration?: number | null;
  slow_mode?: boolean;
  slow_mode_wait_time?: number | null;
}

// ─── Twitch State ──────────────────────────────────────────────

interface TwitchState {
  connected: boolean;
  username: string | null;
  userId: string | null;
  streamTitle: string | null;
  streamGame: string | null;
  isLive: boolean;
  viewerCount: number;
  followerCount: number;
  emoteOnly: boolean;
  subscriberOnly: boolean;
  followerOnly: boolean;
  slowMode: boolean;
  activePollId: string | null;
  activePredictionId: string | null;
  /** outcome IDs for the active prediction (needed for resolve) */
  predictionOutcomeIds: string[];
}

const DEFAULT_STATE: TwitchState = {
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
  activePredictionId: null,
  predictionOutcomeIds: []
};

const RECONNECT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

// ─── Client Implementation ─────────────────────────────────────

class TwitchPluginClient implements PluginClient {
  private state: TwitchState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Periodic poll for stream / chat status */
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
  }

  // ─── PluginClient interface ────────────────────────────────

  async connect(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();

    const accessToken = settings.accessToken as string;
    const clientId = settings.clientId as string;

    if (!accessToken || !clientId) {
      throw new Error('Client ID and Access Token are required');
    }

    try {
      this.hostAPI.log('info', 'Validating token…');
      await this.validateAndFetchUser(clientId, accessToken);
      this.hostAPI.log('info', `Connected as ${this.state.username}`);

      // Initial data fetch
      await this.refreshStreamInfo();
      await this.refreshChatSettings();

      // Start periodic polling
      this.startPolling();
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
    this.stopPolling();
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
    if (!this.state.connected || !this.state.userId) {
      this.hostAPI.log('warn', 'Cannot execute action — not connected');
      return;
    }

    const action = (config.pluginAction as string) ?? '';

    try {
      switch (action) {
        case 'create-clip':
          await this.createClip();
          break;
        case 'create-stream-marker':
          await this.createStreamMarker(config.description as string | undefined);
          break;
        case 'run-ad':
          await this.runAd(Number(config.duration) || 30);
          break;
        case 'send-chat-message':
          await this.sendChatMessage(config.message as string);
          break;
        case 'set-emote-only':
          await this.setChatSetting({ emote_mode: config.enabled !== false });
          break;
        case 'set-subscriber-only':
          await this.setChatSetting({ subscriber_mode: config.enabled !== false });
          break;
        case 'set-follower-only':
          await this.setChatSetting({
            follower_mode: config.enabled !== false,
            follower_mode_duration: config.enabled !== false ? Number(config.duration) || 0 : null
          });
          break;
        case 'set-slow-mode':
          await this.setChatSetting({
            slow_mode: config.enabled !== false,
            slow_mode_wait_time: config.enabled !== false ? Number(config.delay) || 30 : null
          });
          break;
        case 'clear-chat':
          await this.clearChat();
          break;
        case 'create-poll':
          await this.createPoll(config);
          break;
        case 'end-poll':
          await this.endPoll();
          break;
        case 'create-prediction':
          await this.createPrediction(config);
          break;
        case 'resolve-prediction':
          await this.resolvePrediction(config.winningOutcome as string);
          break;
        case 'cancel-prediction':
          await this.cancelPrediction();
          break;
        default:
          this.hostAPI.log('warn', `Unknown Twitch action: ${action}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hostAPI.log('error', `Action "${action}" failed: ${msg}`);
    }
  }

  destroy(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    this.stopPolling();
  }

  // ─── Queries (dynamic dropdowns) ────────────────────────────

  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {};

  // ─── Internal: Helix API ─────────────────────────────────────

  private get clientId(): string {
    return (this.settings?.clientId as string) ?? '';
  }

  private get accessToken(): string {
    return (this.settings?.accessToken as string) ?? '';
  }

  private async helix(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const url = `${HELIX_BASE}${path}`;
    const headers: Record<string, string> = {
      'Client-ID': this.clientId,
      Authorization: `Bearer ${this.accessToken}`
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Helix ${method} ${path} → ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return {};
  }

  // ─── Internal: Connection & Validation ──────────────────────

  private async validateAndFetchUser(clientId: string, accessToken: string): Promise<void> {
    // Validate the token via the Twitch OAuth endpoint
    const valResp = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${accessToken}` }
    });

    if (!valResp.ok) {
      throw new Error('Invalid access token');
    }

    const valData = (await valResp.json()) as { login?: string; user_id?: string; client_id?: string };

    if (valData.client_id && valData.client_id !== clientId) {
      this.hostAPI.log('warn', 'Token client_id does not match provided Client ID — will proceed anyway');
    }

    this.updateState({
      connected: true,
      username: valData.login ?? null,
      userId: valData.user_id ?? null
    });
  }

  // ─── Internal: Data Refresh ─────────────────────────────────

  private async refreshStreamInfo(): Promise<void> {
    if (!this.state.userId) return;
    try {
      const data = (await this.helix('GET', `/streams?user_id=${this.state.userId}`)) as {
        data?: Array<{
          title?: string;
          game_name?: string;
          viewer_count?: number;
          type?: string;
        }>;
      };

      const stream = data?.data?.[0];
      if (stream && stream.type === 'live') {
        this.updateState({
          isLive: true,
          streamTitle: stream.title ?? null,
          streamGame: stream.game_name ?? null,
          viewerCount: stream.viewer_count ?? 0
        });
      } else {
        this.updateState({
          isLive: false,
          streamTitle: null,
          streamGame: null,
          viewerCount: 0
        });
      }

      // Follower count
      const followData = (await this.helix(
        'GET',
        `/channels/followers?broadcaster_id=${this.state.userId}&first=1`
      )) as { total?: number };
      this.updateState({ followerCount: followData?.total ?? 0 });
    } catch (error) {
      this.hostAPI.log('error', `Failed to refresh stream info: ${error}`);
    }
  }

  private async refreshChatSettings(): Promise<void> {
    if (!this.state.userId) return;
    try {
      const data = (await this.helix('GET', `/chat/settings?broadcaster_id=${this.state.userId}`)) as {
        data?: ChatSettings[];
      };

      const settings = data?.data?.[0];
      if (settings) {
        this.updateState({
          emoteOnly: settings.emote_mode ?? false,
          subscriberOnly: settings.subscriber_mode ?? false,
          followerOnly: settings.follower_mode ?? false,
          slowMode: settings.slow_mode ?? false
        });
      }
    } catch (error) {
      this.hostAPI.log('error', `Failed to refresh chat settings: ${error}`);
    }
  }

  // ─── Internal: Polling ──────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.state.connected) return;
      try {
        await this.refreshStreamInfo();
        await this.refreshChatSettings();
      } catch {
        // Errors logged inside refresh methods
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Internal: Actions ──────────────────────────────────────

  private async createClip(): Promise<void> {
    const data = (await this.helix('POST', `/clips?broadcaster_id=${this.state.userId}`)) as {
      data?: Array<{ id?: string; edit_url?: string }>;
    };
    const clip = data?.data?.[0];
    if (clip) {
      this.hostAPI.log('info', `Clip created: ${clip.edit_url ?? clip.id}`);
    }
  }

  private async createStreamMarker(description?: string): Promise<void> {
    const body: Record<string, unknown> = { user_id: this.state.userId };
    if (description) body.description = description;
    await this.helix('POST', '/streams/markers', body);
    this.hostAPI.log('info', `Stream marker created${description ? `: ${description}` : ''}`);
  }

  private async runAd(duration: number): Promise<void> {
    await this.helix('POST', '/channels/commercial', {
      broadcaster_id: this.state.userId,
      length: duration
    });
    this.hostAPI.log('info', `Ad started (${duration}s)`);
  }

  private async sendChatMessage(message: string): Promise<void> {
    if (!message) {
      this.hostAPI.log('warn', 'No message to send');
      return;
    }
    await this.helix('POST', '/chat/messages', {
      broadcaster_id: this.state.userId,
      sender_id: this.state.userId,
      message
    });
  }

  private async setChatSetting(settings: Record<string, unknown>): Promise<void> {
    await this.helix(
      'PATCH',
      `/chat/settings?broadcaster_id=${this.state.userId}&moderator_id=${this.state.userId}`,
      settings
    );
    // Refresh to pick up the new state
    await this.refreshChatSettings();
  }

  private async clearChat(): Promise<void> {
    await this.helix(
      'DELETE',
      `/moderation/chat?broadcaster_id=${this.state.userId}&moderator_id=${this.state.userId}`
    );
    this.hostAPI.log('info', 'Chat cleared');
  }

  private async createPoll(config: Record<string, unknown>): Promise<void> {
    const title = config.title as string;
    if (!title) {
      this.hostAPI.log('warn', 'Poll title is required');
      return;
    }

    const choices: Array<{ title: string }> = [];
    for (const key of ['choice1', 'choice2', 'choice3', 'choice4']) {
      const val = config[key] as string | undefined;
      if (val?.trim()) {
        choices.push({ title: val.trim() });
      }
    }
    if (choices.length < 2) {
      this.hostAPI.log('warn', 'At least 2 choices are required for a poll');
      return;
    }

    const body = {
      broadcaster_id: this.state.userId,
      title,
      choices,
      duration: Number(config.durationSeconds) || 60
    };

    const data = (await this.helix('POST', '/polls', body)) as {
      data?: Array<{ id?: string }>;
    };

    const poll = data?.data?.[0];
    if (poll?.id) {
      this.updateState({ activePollId: poll.id });
      this.hostAPI.log('info', `Poll created: "${title}"`);
    }
  }

  private async endPoll(): Promise<void> {
    if (!this.state.activePollId) {
      this.hostAPI.log('warn', 'No active poll to end');
      return;
    }
    await this.helix('PATCH', '/polls', {
      broadcaster_id: this.state.userId,
      id: this.state.activePollId,
      status: 'TERMINATED'
    });
    this.hostAPI.log('info', 'Poll ended');
    this.updateState({ activePollId: null });
  }

  private async createPrediction(config: Record<string, unknown>): Promise<void> {
    const title = config.title as string;
    if (!title) {
      this.hostAPI.log('warn', 'Prediction title is required');
      return;
    }

    const outcome1 = (config.outcome1 as string)?.trim();
    const outcome2 = (config.outcome2 as string)?.trim();
    if (!outcome1 || !outcome2) {
      this.hostAPI.log('warn', 'Two outcomes are required for a prediction');
      return;
    }

    const body = {
      broadcaster_id: this.state.userId,
      title,
      outcomes: [{ title: outcome1 }, { title: outcome2 }],
      prediction_window: Number(config.predictionWindow) || 60
    };

    const data = (await this.helix('POST', '/predictions', body)) as {
      data?: Array<{ id?: string; outcomes?: Array<{ id: string }> }>;
    };

    const prediction = data?.data?.[0];
    if (prediction?.id) {
      this.updateState({
        activePredictionId: prediction.id,
        predictionOutcomeIds: (prediction.outcomes ?? []).map((o) => o.id)
      });
      this.hostAPI.log('info', `Prediction created: "${title}"`);
    }
  }

  private async resolvePrediction(winningOutcome: string): Promise<void> {
    if (!this.state.activePredictionId) {
      this.hostAPI.log('warn', 'No active prediction to resolve');
      return;
    }

    // Map 'outcome1' / 'outcome2' to actual IDs
    const index = winningOutcome === 'outcome2' ? 1 : 0;
    const winningId = this.state.predictionOutcomeIds[index];
    if (!winningId) {
      this.hostAPI.log('error', 'Could not determine winning outcome ID');
      return;
    }

    await this.helix('PATCH', '/predictions', {
      broadcaster_id: this.state.userId,
      id: this.state.activePredictionId,
      status: 'RESOLVED',
      winning_outcome_id: winningId
    });
    this.hostAPI.log('info', 'Prediction resolved');
    this.updateState({ activePredictionId: null, predictionOutcomeIds: [] });
  }

  private async cancelPrediction(): Promise<void> {
    if (!this.state.activePredictionId) {
      this.hostAPI.log('warn', 'No active prediction to cancel');
      return;
    }

    await this.helix('PATCH', '/predictions', {
      broadcaster_id: this.state.userId,
      id: this.state.activePredictionId,
      status: 'CANCELED'
    });
    this.hostAPI.log('info', 'Prediction canceled');
    this.updateState({ activePredictionId: null, predictionOutcomeIds: [] });
  }

  // ─── Internal: State Management ─────────────────────────────

  private updateState(partial: Partial<TwitchState>): void {
    this.state = { ...this.state, ...partial };
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    if (this.onStateChangedHandler) {
      this.onStateChangedHandler({ ...this.state } as unknown as Record<string, unknown>);
    }
  }

  // ─── Internal: Reconnection ─────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalDisconnect || !this.settings) return;
    this.hostAPI.log('info', `Scheduling reconnect in ${RECONNECT_INTERVAL_MS}ms…`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || !this.settings) return;
      try {
        await this.connect(this.settings);
      } catch {
        // connect() schedules another reconnect on failure
      }
    }, RECONNECT_INTERVAL_MS);
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
  return new TwitchPluginClient(hostAPI);
};
