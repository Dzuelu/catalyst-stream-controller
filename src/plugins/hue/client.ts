import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';

// ─── Hue Bridge REST API ───────────────────────────────────────
//
// The Philips Hue system exposes a local REST API on the bridge.
// All calls go to  https://<bridgeIp>/api/<apiKey>/...
// (or http if the v1 API is used — we support both via the toggle
// in the connection settings).
//
// We use the v1-style REST endpoints which are broadly compatible
// (Hue API v1 works on all bridges; v2/CLIP is only on newer FW).
// ────────────────────────────────────────────────────────────────

// ─── State ─────────────────────────────────────────────────────

interface HueState {
  connected: boolean;
  bridgeName: string | null;
  bridgeId: string | null;
  bridgeIp: string | null;
  lightCount: number;
  groupCount: number;
  sceneCount: number;
  apiVersion: string | null;
}

const DEFAULT_STATE: HueState = {
  connected: false,
  bridgeName: null,
  bridgeId: null,
  bridgeIp: null,
  lightCount: 0,
  groupCount: 0,
  sceneCount: 0,
  apiVersion: null
};

const RECONNECT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 60_000;

// ─── Resource caches (for dynamic queries) ─────────────────────

interface HueLight {
  id: string;
  name: string;
  on: boolean;
  brightness: number;
}

interface HueGroup {
  id: string;
  name: string;
  on: boolean;
  type: string;
}

interface HueScene {
  id: string;
  name: string;
  group?: string;
}

// ─── Client Implementation ─────────────────────────────────────

class HuePluginClient implements PluginClient {
  private state: HueState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Cached resources
  private lightsCache: HueLight[] = [];
  private groupsCache: HueGroup[] = [];
  private scenesCache: HueScene[] = [];

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
  }

  // ─── PluginClient interface ────────────────────────────────

  async connect(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();

    const bridgeIp = settings.bridgeIp as string;
    const apiKey = settings.apiKey as string;
    if (!bridgeIp) {
      throw new Error('Bridge IP address is required');
    }
    if (!apiKey) {
      throw new Error('API key is required — press the link button on your bridge and click Connect');
    }

    try {
      this.hostAPI.log('info', `Connecting to Hue Bridge at ${bridgeIp}…`);

      // Validate by fetching the bridge config
      await this.fetchBridgeConfig();

      // Cache resources
      await this.refreshResources();

      this.hostAPI.log('info', `Connected to ${this.state.bridgeName}`);
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
    this.lightsCache = [];
    this.groupsCache = [];
    this.scenesCache = [];
    this.state = { ...DEFAULT_STATE };
    this.emitStateChanged();
    this.hostAPI.log('info', 'Disconnected from Hue Bridge');
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
        case 'toggle-light':
          await this.toggleLight(config.lightId as string);
          break;
        case 'turn-on-light':
          await this.setLightPower(config.lightId as string, true);
          break;
        case 'turn-off-light':
          await this.setLightPower(config.lightId as string, false);
          break;
        case 'set-brightness':
          await this.setLightBrightness(config.lightId as string, Number(config.brightness));
          break;
        case 'adjust-brightness':
          await this.adjustLightBrightness(config.lightId as string, Number(config.delta));
          break;
        case 'set-color':
          await this.setLightColor(config.lightId as string, config.color as string);
          break;
        case 'set-color-temperature':
          await this.setLightColorTemp(config.lightId as string, Number(config.mirek));
          break;
        case 'toggle-group':
          await this.toggleGroup(config.groupId as string);
          break;
        case 'set-group-brightness':
          await this.setGroupBrightness(config.groupId as string, Number(config.brightness));
          break;
        case 'activate-scene':
          await this.activateScene(config.sceneId as string);
          break;
        case 'trigger-effect':
          await this.triggerEffect(config.lightId as string, config.effect as string);
          break;
        case 'alert-light':
          await this.alertLight(config.lightId as string, config.alert as string);
          break;
        default:
          this.hostAPI.log('warn', `Unknown Hue action: ${action}`);
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

  /** Dynamic dropdown queries for lights, groups, and scenes */
  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {
    getLights: async () => this.lightsCache.map((l) => ({ value: l.id, label: l.name })),
    getGroups: async () => this.groupsCache.map((g) => ({ value: g.id, label: `${g.name} (${g.type})` })),
    getScenes: async () => this.scenesCache.map((s) => ({ value: s.id, label: s.name }))
  };

  // ─── Internal: Hue REST API ─────────────────────────────────

  private get bridgeIp(): string {
    return (this.settings?.bridgeIp as string) ?? '';
  }

  private get apiKey(): string {
    return (this.settings?.apiKey as string) ?? '';
  }

  private get baseUrl(): string {
    return `http://${this.bridgeIp}/api/${this.apiKey}`;
  }

  private async hueGet(path: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) {
      throw new Error(`Hue GET ${path} → ${response.status}`);
    }
    return response.json();
  }

  private async huePut(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Hue PUT ${path} → ${response.status}`);
    }
    const result = await response.json();
    // The Hue API returns an array; check for errors
    if (Array.isArray(result)) {
      const err = result.find((r: Record<string, unknown>) => r.error !== undefined) as
        | { error?: { description?: string } }
        | undefined;
      if (err?.error) {
        throw new Error(err.error.description ?? 'Hue API error');
      }
    }
    return result;
  }

  private async huePost(path: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Hue POST ${path} → ${response.status}`);
    }
    return response.json();
  }

  // ─── Internal: Bridge Config ────────────────────────────────

  private async fetchBridgeConfig(): Promise<void> {
    const data = (await this.hueGet('/config')) as {
      name?: string;
      bridgeid?: string;
      apiversion?: string;
      ipaddress?: string;
    };

    if (!data || !data.name) {
      throw new Error('Invalid bridge response — check IP and API key');
    }

    this.updateState({
      connected: true,
      bridgeName: data.name,
      bridgeId: data.bridgeid ?? null,
      bridgeIp: data.ipaddress ?? this.bridgeIp,
      apiVersion: data.apiversion ?? null
    });
  }

  // ─── Internal: Resource Refresh ─────────────────────────────

  private async refreshResources(): Promise<void> {
    try {
      await Promise.all([this.refreshLights(), this.refreshGroups(), this.refreshScenes()]);
      this.updateState({
        lightCount: this.lightsCache.length,
        groupCount: this.groupsCache.length,
        sceneCount: this.scenesCache.length
      });
    } catch (error) {
      this.hostAPI.log('error', `Failed to refresh resources: ${error}`);
    }
  }

  private async refreshLights(): Promise<void> {
    const data = (await this.hueGet('/lights')) as Record<
      string,
      {
        name?: string;
        state?: { on?: boolean; bri?: number };
      }
    >;

    this.lightsCache = Object.entries(data).map(([id, light]) => ({
      id,
      name: light.name ?? `Light ${id}`,
      on: light.state?.on ?? false,
      brightness: light.state?.bri ?? 0
    }));
  }

  private async refreshGroups(): Promise<void> {
    const data = (await this.hueGet('/groups')) as Record<
      string,
      {
        name?: string;
        type?: string;
        state?: { any_on?: boolean };
      }
    >;

    this.groupsCache = Object.entries(data).map(([id, group]) => ({
      id,
      name: group.name ?? `Group ${id}`,
      on: group.state?.any_on ?? false,
      type: group.type ?? 'LightGroup'
    }));
  }

  private async refreshScenes(): Promise<void> {
    const data = (await this.hueGet('/scenes')) as Record<
      string,
      {
        name?: string;
        group?: string;
      }
    >;

    this.scenesCache = Object.entries(data).map(([id, scene]) => ({
      id,
      name: scene.name ?? `Scene ${id}`,
      group: scene.group
    }));
  }

  // ─── Internal: Light Actions ────────────────────────────────

  private async toggleLight(lightId: string): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    // Get current state
    const cached = this.lightsCache.find((l) => l.id === lightId);
    const currentlyOn = cached?.on ?? false;

    await this.huePut(`/lights/${lightId}/state`, { on: !currentlyOn });

    if (cached) cached.on = !currentlyOn;
    this.hostAPI.log('info', `Light ${lightId} toggled ${currentlyOn ? 'off' : 'on'}`);
  }

  private async setLightPower(lightId: string, on: boolean): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    await this.huePut(`/lights/${lightId}/state`, { on });

    const cached = this.lightsCache.find((l) => l.id === lightId);
    if (cached) cached.on = on;
    this.hostAPI.log('info', `Light ${lightId} turned ${on ? 'on' : 'off'}`);
  }

  private async setLightBrightness(lightId: string, brightness: number): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    // Convert 0-100 percentage to 1-254 Hue range
    const bri = Math.max(1, Math.min(254, Math.round((brightness / 100) * 254)));
    await this.huePut(`/lights/${lightId}/state`, { on: true, bri });

    const cached = this.lightsCache.find((l) => l.id === lightId);
    if (cached) {
      cached.brightness = bri;
      cached.on = true;
    }
    this.hostAPI.log('info', `Light ${lightId} brightness set to ${brightness}%`);
  }

  private async adjustLightBrightness(lightId: string, delta: number): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    // bri_inc accepts -254 to 254
    const briInc = Math.round((delta / 100) * 254);
    await this.huePut(`/lights/${lightId}/state`, { on: true, bri_inc: briInc });

    this.hostAPI.log('info', `Light ${lightId} brightness adjusted by ${delta > 0 ? '+' : ''}${delta}%`);
  }

  private async setLightColor(lightId: string, hexColor: string): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }
    if (!hexColor) {
      this.hostAPI.log('warn', 'No color specified');
      return;
    }

    // Convert hex to xy CIE color space (used by Hue API)
    const xy = hexToXY(hexColor);
    await this.huePut(`/lights/${lightId}/state`, { on: true, xy });

    this.hostAPI.log('info', `Light ${lightId} color set to ${hexColor}`);
  }

  private async setLightColorTemp(lightId: string, mirek: number): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    // ct (mirek) range is 153 (6500K) to 500 (2000K)
    const ct = Math.max(153, Math.min(500, mirek));
    await this.huePut(`/lights/${lightId}/state`, { on: true, ct });

    this.hostAPI.log('info', `Light ${lightId} color temperature set to ${ct} mirek`);
  }

  // ─── Internal: Group Actions ────────────────────────────────

  private async toggleGroup(groupId: string): Promise<void> {
    if (!groupId) {
      this.hostAPI.log('warn', 'No group selected');
      return;
    }

    const cached = this.groupsCache.find((g) => g.id === groupId);
    const currentlyOn = cached?.on ?? false;

    await this.huePut(`/groups/${groupId}/action`, { on: !currentlyOn });

    if (cached) cached.on = !currentlyOn;
    this.hostAPI.log('info', `Group ${groupId} toggled ${currentlyOn ? 'off' : 'on'}`);
  }

  private async setGroupBrightness(groupId: string, brightness: number): Promise<void> {
    if (!groupId) {
      this.hostAPI.log('warn', 'No group selected');
      return;
    }

    const bri = Math.max(1, Math.min(254, Math.round((brightness / 100) * 254)));
    await this.huePut(`/groups/${groupId}/action`, { on: true, bri });

    this.hostAPI.log('info', `Group ${groupId} brightness set to ${brightness}%`);
  }

  // ─── Internal: Scene Actions ────────────────────────────────

  private async activateScene(sceneId: string): Promise<void> {
    if (!sceneId) {
      this.hostAPI.log('warn', 'No scene selected');
      return;
    }

    // Find which group the scene belongs to
    const scene = this.scenesCache.find((s) => s.id === sceneId);
    const groupId = scene?.group ?? '0';

    await this.huePut(`/groups/${groupId}/action`, { scene: sceneId });

    this.hostAPI.log('info', `Scene "${scene?.name ?? sceneId}" activated`);
  }

  // ─── Internal: Effects ──────────────────────────────────────

  private async triggerEffect(lightId: string, effect: string): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    await this.huePut(`/lights/${lightId}/state`, { effect: effect ?? 'none' });

    this.hostAPI.log('info', `Light ${lightId} effect set to "${effect}"`);
  }

  private async alertLight(lightId: string, alert: string): Promise<void> {
    if (!lightId) {
      this.hostAPI.log('warn', 'No light selected');
      return;
    }

    await this.huePut(`/lights/${lightId}/state`, { alert: alert ?? 'none' });

    this.hostAPI.log('info', `Light ${lightId} alert set to "${alert}"`);
  }

  // ─── Internal: Polling ──────────────────────────────────────

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(async () => {
      if (!this.state.connected) return;
      try {
        await this.refreshResources();
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

  private updateState(partial: Partial<HueState>): void {
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

// ─── Color Conversion ─────────────────────────────────────────

/** Convert a hex colour string (#RRGGBB) to CIE xy coordinates for the Hue API. */
function hexToXY(hex: string): [number, number] {
  const clean = hex.replace(/^#/, '');
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;

  // Apply gamma correction
  const rLinear = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  const gLinear = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  const bLinear = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  // Wide-gamut D65 conversion
  const X = rLinear * 0.664511 + gLinear * 0.154324 + bLinear * 0.162028;
  const Y = rLinear * 0.283881 + gLinear * 0.668433 + bLinear * 0.047685;
  const Z = rLinear * 0.000088 + gLinear * 0.07231 + bLinear * 0.986039;

  const sum = X + Y + Z;
  if (sum === 0) return [0.3127, 0.329]; // D65 white point fallback

  return [Math.round((X / sum) * 10000) / 10000, Math.round((Y / sum) * 10000) / 10000];
}

// ─── Factory ───────────────────────────────────────────────────

export const createClient: PluginClientFactory = (hostAPI: PluginHostAPI): PluginClient => {
  return new HuePluginClient(hostAPI);
};
