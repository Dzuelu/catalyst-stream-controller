import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';

// ─── YouTube Data API v3 base ──────────────────────────────────

const YT_API_BASE = 'https://www.googleapis.com/youtube/v3';

// ─── YouTube State ─────────────────────────────────────────────

interface YouTubeState {
  connected: boolean;
  channelName: string | null;
  channelId: string | null;
  broadcastId: string | null;
  broadcastTitle: string | null;
  broadcastStatus: string | null;
  liveChatId: string | null;
  isLive: boolean;
  viewerCount: number;
  subscriberCount: number;
}

const DEFAULT_STATE: YouTubeState = {
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
};

const RECONNECT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 30_000;

// ─── Client Implementation ─────────────────────────────────────

class YouTubePluginClient implements PluginClient {
  private state: YouTubeState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (!accessToken) {
      throw new Error('Access Token is required');
    }

    try {
      this.hostAPI.log('info', 'Fetching channel info…');

      // Fetch the authenticated user's channel
      await this.fetchChannelInfo();

      // Detect or use the supplied broadcast
      const explicitBroadcastId = settings.broadcastId as string | undefined;
      if (explicitBroadcastId) {
        await this.fetchBroadcastInfo(explicitBroadcastId);
      } else {
        await this.detectActiveBroadcast();
      }

      this.hostAPI.log('info', `Connected as ${this.state.channelName}`);
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
    if (!this.state.connected) {
      this.hostAPI.log('warn', 'Cannot execute action — not connected');
      return;
    }

    const action = (config.pluginAction as string) ?? '';

    try {
      switch (action) {
        case 'transition-broadcast':
          await this.transitionBroadcast(config.status as string);
          break;
        case 'end-broadcast':
          await this.transitionBroadcast('complete');
          break;
        case 'update-title':
          await this.updateBroadcastMetadata({ title: config.title as string });
          break;
        case 'update-description':
          await this.updateBroadcastMetadata({ description: config.description as string });
          break;
        case 'send-chat-message':
          await this.sendChatMessage(config.message as string);
          break;
        case 'set-chat-slow-mode': {
          const enabled = config.enabled !== false;
          const seconds = enabled ? Number(config.slowModeSeconds) || 30 : 0;
          await this.updateChatSettings({ slowModeEnabled: enabled, slowModeSeconds: seconds });
          break;
        }
        case 'set-chat-members-only':
          await this.updateChatSettings({ membersOnlyEnabled: config.enabled !== false });
          break;
        case 'set-chat-subscribers-only':
          await this.updateChatSettings({ subscribersOnlyEnabled: config.enabled !== false });
          break;
        case 'insert-cue-point':
          await this.insertCuePoint(Number(config.durationSecs) || 30);
          break;
        case 'insert-slate':
          await this.insertSlate(config.text as string | undefined);
          break;
        case 'remove-slate':
          await this.removeSlate();
          break;
        default:
          this.hostAPI.log('warn', `Unknown YouTube action: ${action}`);
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

  /** No dynamic dropdown queries for YouTube currently */
  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {};

  // ─── Internal: YouTube Data API ──────────────────────────────

  private get accessToken(): string {
    return (this.settings?.accessToken as string) ?? '';
  }

  private get apiKey(): string {
    return (this.settings?.apiKey as string) ?? '';
  }

  private async ytApi(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    // Append API key to query params if available
    const separator = path.includes('?') ? '&' : '?';
    const keyParam = this.apiKey ? `${separator}key=${this.apiKey}` : '';
    const url = `${YT_API_BASE}${path}${keyParam}`;

    const headers: Record<string, string> = {
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
      throw new Error(`YouTube API ${method} ${path} → ${response.status}: ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return {};
  }

  // ─── Internal: Channel & Broadcast ──────────────────────────

  private async fetchChannelInfo(): Promise<void> {
    const data = (await this.ytApi('GET', '/channels?part=snippet,statistics&mine=true')) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string };
        statistics?: { subscriberCount?: string; viewCount?: string };
      }>;
    };

    const channel = data?.items?.[0];
    if (!channel) {
      throw new Error('Could not find your YouTube channel — check token scopes');
    }

    this.updateState({
      connected: true,
      channelId: channel.id,
      channelName: channel.snippet?.title ?? null,
      subscriberCount: parseInt(channel.statistics?.subscriberCount ?? '0', 10)
    });
  }

  private async detectActiveBroadcast(): Promise<void> {
    // Try active first, then upcoming
    for (const status of ['active', 'upcoming']) {
      const data = (await this.ytApi(
        'GET',
        `/liveBroadcasts?part=snippet,status,contentDetails&broadcastStatus=${status}&mine=true&maxResults=1`
      )) as {
        items?: Array<{
          id: string;
          snippet?: { title?: string; liveChatId?: string };
          status?: { lifeCycleStatus?: string };
        }>;
      };

      const broadcast = data?.items?.[0];
      if (broadcast) {
        this.updateState({
          broadcastId: broadcast.id,
          broadcastTitle: broadcast.snippet?.title ?? null,
          broadcastStatus: broadcast.status?.lifeCycleStatus ?? status,
          liveChatId: broadcast.snippet?.liveChatId ?? null,
          isLive: broadcast.status?.lifeCycleStatus === 'live'
        });
        this.hostAPI.log('info', `Found ${status} broadcast: "${broadcast.snippet?.title}" (${broadcast.id})`);
        return;
      }
    }

    this.hostAPI.log('info', 'No active or upcoming broadcast found');
  }

  private async fetchBroadcastInfo(broadcastId: string): Promise<void> {
    const data = (await this.ytApi('GET', `/liveBroadcasts?part=snippet,status,contentDetails&id=${broadcastId}`)) as {
      items?: Array<{
        id: string;
        snippet?: { title?: string; liveChatId?: string };
        status?: { lifeCycleStatus?: string };
      }>;
    };

    const broadcast = data?.items?.[0];
    if (!broadcast) {
      this.hostAPI.log('warn', `Broadcast ${broadcastId} not found`);
      return;
    }

    this.updateState({
      broadcastId: broadcast.id,
      broadcastTitle: broadcast.snippet?.title ?? null,
      broadcastStatus: broadcast.status?.lifeCycleStatus ?? null,
      liveChatId: broadcast.snippet?.liveChatId ?? null,
      isLive: broadcast.status?.lifeCycleStatus === 'live'
    });
  }

  private async refreshStreamStats(): Promise<void> {
    if (!this.state.broadcastId) return;
    try {
      // Viewer count comes from the live stream's concurrent viewers
      const data = (await this.ytApi(
        'GET',
        `/videos?part=liveStreamingDetails,snippet&id=${this.state.broadcastId}`
      )) as {
        items?: Array<{
          liveStreamingDetails?: { concurrentViewers?: string };
          snippet?: { title?: string };
        }>;
      };

      const video = data?.items?.[0];
      if (video) {
        const viewers = parseInt(video.liveStreamingDetails?.concurrentViewers ?? '0', 10);
        this.updateState({
          viewerCount: viewers,
          broadcastTitle: video.snippet?.title ?? this.state.broadcastTitle
        });
      }
    } catch (error) {
      this.hostAPI.log('error', `Failed to refresh stream stats: ${error}`);
    }
  }

  // ─── Internal: Actions ──────────────────────────────────────

  private async transitionBroadcast(status: string): Promise<void> {
    if (!this.state.broadcastId) {
      this.hostAPI.log('warn', 'No broadcast bound — cannot transition');
      return;
    }

    await this.ytApi(
      'POST',
      `/liveBroadcasts/transition?broadcastStatus=${status}&id=${this.state.broadcastId}&part=status`
    );

    this.hostAPI.log('info', `Broadcast transitioned to "${status}"`);
    this.updateState({
      broadcastStatus: status,
      isLive: status === 'live'
    });
  }

  private async updateBroadcastMetadata(fields: { title?: string; description?: string }): Promise<void> {
    if (!this.state.broadcastId) {
      this.hostAPI.log('warn', 'No broadcast bound — cannot update metadata');
      return;
    }

    const body: Record<string, unknown> = {
      id: this.state.broadcastId,
      snippet: {
        title: fields.title ?? this.state.broadcastTitle,
        scheduledStartTime: new Date().toISOString(),
        ...(fields.description !== undefined ? { description: fields.description } : {})
      }
    };

    await this.ytApi('PUT', '/liveBroadcasts?part=snippet', body);

    if (fields.title) {
      this.updateState({ broadcastTitle: fields.title });
    }
    this.hostAPI.log('info', 'Broadcast metadata updated');
  }

  private async sendChatMessage(message: string): Promise<void> {
    if (!message) {
      this.hostAPI.log('warn', 'No message to send');
      return;
    }
    if (!this.state.liveChatId) {
      this.hostAPI.log('warn', 'No live chat ID — is the broadcast active?');
      return;
    }

    await this.ytApi('POST', '/liveChat/messages?part=snippet', {
      snippet: {
        liveChatId: this.state.liveChatId,
        type: 'textMessageEvent',
        textMessageDetails: { messageText: message }
      }
    });
  }

  private async updateChatSettings(settings: {
    slowModeEnabled?: boolean;
    slowModeSeconds?: number;
    membersOnlyEnabled?: boolean;
    subscribersOnlyEnabled?: boolean;
  }): Promise<void> {
    if (!this.state.liveChatId) {
      this.hostAPI.log('warn', 'No live chat ID — cannot update chat settings');
      return;
    }

    // YouTube uses liveBroadcasts.update with contentDetails for chat settings
    // or the liveChatSettings resource. We use the available approach:
    // PATCH-style via the liveBroadcast contentDetails.
    // For simplicity we'll call the liveBroadcasts endpoint with the settings.
    if (!this.state.broadcastId) return;

    const contentDetails: Record<string, unknown> = {};
    if (settings.slowModeEnabled !== undefined) {
      contentDetails.enableSlowChat = settings.slowModeEnabled;
      if (settings.slowModeEnabled && settings.slowModeSeconds) {
        contentDetails.slowChatRateSeconds = settings.slowModeSeconds;
      }
    }

    // Note: membersOnly / subscribersOnly are handled through moderator
    // capabilities which vary by API version. We pass them as available.
    if (settings.membersOnlyEnabled !== undefined) {
      contentDetails.enableMembersOnlyChat = settings.membersOnlyEnabled;
    }
    if (settings.subscribersOnlyEnabled !== undefined) {
      // YouTube API doesn't have a direct subscribers-only toggle,
      // but membersOnly effectively does this for channel memberships.
      contentDetails.enableMembersOnlyChat = settings.subscribersOnlyEnabled;
    }

    if (Object.keys(contentDetails).length > 0) {
      await this.ytApi('PUT', '/liveBroadcasts?part=contentDetails', {
        id: this.state.broadcastId,
        contentDetails
      });
      this.hostAPI.log('info', 'Chat settings updated');
    }
  }

  private async insertCuePoint(durationSecs: number): Promise<void> {
    if (!this.state.broadcastId) {
      this.hostAPI.log('warn', 'No broadcast bound — cannot insert cue point');
      return;
    }

    await this.ytApi('POST', '/liveBroadcasts/cuepoint', {
      id: this.state.broadcastId,
      cueType: 'cueTypeAd',
      durationSecs
    });

    this.hostAPI.log('info', `Ad cue point inserted (${durationSecs}s)`);
  }

  private async insertSlate(text?: string): Promise<void> {
    if (!this.state.broadcastId) {
      this.hostAPI.log('warn', 'No broadcast bound — cannot insert slate');
      return;
    }

    // YouTube "slate" is controlled via liveBroadcasts.control with the slate flag
    await this.ytApi('POST', `/liveBroadcasts/control?id=${this.state.broadcastId}&displaySlate=true&part=status`);

    this.hostAPI.log('info', `Slate inserted${text ? `: "${text}"` : ''}`);
  }

  private async removeSlate(): Promise<void> {
    if (!this.state.broadcastId) {
      this.hostAPI.log('warn', 'No broadcast bound — cannot remove slate');
      return;
    }

    await this.ytApi('POST', `/liveBroadcasts/control?id=${this.state.broadcastId}&displaySlate=false&part=status`);

    this.hostAPI.log('info', 'Slate removed');
  }

  // ─── Internal: Polling ──────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.state.connected) return;
      try {
        await this.refreshStreamStats();
      } catch {
        // Errors logged inside refresh method
      }
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ─── Internal: State Management ─────────────────────────────

  private updateState(partial: Partial<YouTubeState>): void {
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
  return new YouTubePluginClient(hostAPI);
};
