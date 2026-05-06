import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/types';
import type {
  DeviceButtonEvent,
  DeviceKnobEvent,
  DeviceSliderEvent,
  DeviceInfo,
  DrawKeyRequest,
  InteractionSettings,
  KeyPreviewUpdate,
  KeyRenderPreviewRequest,
  Page,
  PageNavigationState,
  PluginFeedbackEvent,
  Profile,
  ProfileData,
  SafeAreaInsets
} from '../shared/types';
import type { VirtualDeviceConfig } from '../main/devices/virtual/VirtualDeviceConfig';
import type { WebServerStatus } from '../main/devices/virtual/web-companion-protocol';
import type { AppSwitchSettings, ForegroundAppInfo } from '../shared/app-switch-types';
import type { LogEntry } from '../shared/log-types';

// Expose a safe API to the renderer via context bridge
const api = {
  // ─── Device ─────────────────────────────────────────────
  getDeviceInfo: (): Promise<DeviceInfo | null> => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_INFO),

  getConnectedDevices: (): Promise<DeviceInfo[]> => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_ALL_INFO),

  setBrightness: (brightness: number, deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_SET_BRIGHTNESS, brightness, deviceId),

  getBrightness: (deviceId: string): Promise<number> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_BRIGHTNESS, deviceId),

  onBrightnessChanged: (callback: (brightness: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, brightness: number) => callback(brightness);
    ipcRenderer.on('brightness:changed', listener);
    return () => ipcRenderer.removeListener('brightness:changed', listener);
  },

  drawKey: (request: DrawKeyRequest): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.DEVICE_DRAW_KEY, request),

  /** Request a rendered key preview (PNG data URI) from the main process via KeyRenderer */
  renderKeyPreview: (request: KeyRenderPreviewRequest): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.KEY_RENDER_PREVIEW, request),

  /** Listen for key preview image updates pushed by the main process */
  onKeyPreviewUpdate: (callback: (update: KeyPreviewUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: KeyPreviewUpdate) => callback(update);
    ipcRenderer.on(IPC_CHANNELS.KEY_PREVIEW_UPDATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.KEY_PREVIEW_UPDATE, listener);
  },

  drawCalibration: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_DRAW_CALIBRATION, deviceId),

  setKeyInsets: (insets: SafeAreaInsets, deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_SET_KEY_INSETS, insets, deviceId),

  pickImage: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.PICK_IMAGE),

  onDeviceConnected: (callback: (info: DeviceInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: DeviceInfo) => callback(info);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_CONNECTED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_CONNECTED, listener);
  },

  onDeviceDisconnected: (callback: (deviceId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_DISCONNECTED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_DISCONNECTED, listener);
  },

  onButtonDown: (callback: (event: DeviceButtonEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DeviceButtonEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_BUTTON_DOWN, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_BUTTON_DOWN, listener);
  },

  onButtonUp: (callback: (event: DeviceButtonEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DeviceButtonEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_BUTTON_UP, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_BUTTON_UP, listener);
  },

  onKnobRotate: (callback: (event: DeviceKnobEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DeviceKnobEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_KNOB_ROTATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_KNOB_ROTATE, listener);
  },

  // ─── Profiles ───────────────────────────────────────────────
  loadProfile: (id: string): Promise<Profile | null> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_LOAD, id),

  saveProfile: (profile: Profile): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SAVE, profile),

  getAllProfiles: (): Promise<ProfileData> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_GET_ALL),

  setActiveProfile: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_SET_ACTIVE, id),

  createProfile: (name: string): Promise<Profile> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_CREATE, name),

  deleteProfile: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.PROFILE_DELETE, id),

  renameProfile: (id: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_RENAME, id, newName),

  exportProfile: (id: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_EXPORT, id),

  importProfile: (): Promise<{ success: boolean; imported?: string[]; errors?: string[] }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PROFILE_IMPORT),

  onProfileChanged: (callback: (data: ProfileData) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ProfileData) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PROFILE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PROFILE_CHANGED, listener);
  },

  // ─── Pages ──────────────────────────────────────────────────
  getPageState: (): Promise<PageNavigationState> => ipcRenderer.invoke(IPC_CHANNELS.PAGE_GET_STATE),

  navigatePage: (pageId: string): Promise<PageNavigationState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PAGE_NAVIGATE, pageId),

  navigateBack: (): Promise<PageNavigationState | null> => ipcRenderer.invoke(IPC_CHANNELS.PAGE_NAVIGATE_BACK),

  navigateRoot: (): Promise<PageNavigationState | null> => ipcRenderer.invoke(IPC_CHANNELS.PAGE_NAVIGATE_ROOT),

  createPage: (name: string, deviceKey?: string): Promise<Page | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PAGE_CREATE, name, deviceKey),

  deletePage: (pageId: string, deviceKey?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PAGE_DELETE, pageId, deviceKey),

  renamePage: (pageId: string, newName: string, deviceKey?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.PAGE_RENAME, pageId, newName, deviceKey),

  onPageChanged: (callback: (state: PageNavigationState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: PageNavigationState) => callback(state);
    ipcRenderer.on(IPC_CHANNELS.PAGE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PAGE_CHANGED, listener);
  },

  // ─── Per-Device Profile / Page ──────────────────────────────
  /** Get the active profile ID for a specific device */
  deviceGetActiveProfile: (deviceKey: string): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_GET_ACTIVE_PROFILE, deviceKey),

  /** Assign a profile to a specific device */
  deviceSetActiveProfile: (deviceKey: string, profileId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_SET_ACTIVE_PROFILE, deviceKey, profileId),

  /** Get navigation state for a specific device */
  deviceGetPageState: (deviceKey: string): Promise<PageNavigationState> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_PAGE_GET_STATE, deviceKey),

  /** Navigate to a page on a specific device */
  deviceNavigatePage: (deviceKey: string, pageId: string): Promise<PageNavigationState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE, deviceKey, pageId),

  /** Navigate back on a specific device */
  deviceNavigateBack: (deviceKey: string): Promise<PageNavigationState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE_BACK, deviceKey),

  /** Navigate to root on a specific device */
  deviceNavigateRoot: (deviceKey: string): Promise<PageNavigationState | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE_ROOT, deviceKey),

  // ─── Actions ────────────────────────────────────────────────
  executeAction: (actionId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.ACTION_EXECUTE, actionId),

  // ─── Interaction Settings ─────────────────────────────────
  getInteractionSettings: (): Promise<InteractionSettings> => ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_GET_SETTINGS),

  setInteractionSettings: (settings: InteractionSettings): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.INTERACTION_SET_SETTINGS, settings),

  // ─── App Switching ──────────────────────────────────────────
  appSwitchGetSettings: (): Promise<AppSwitchSettings> => ipcRenderer.invoke(IPC_CHANNELS.APP_SWITCH_GET_SETTINGS),

  appSwitchSetSettings: (settings: AppSwitchSettings): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_SWITCH_SET_SETTINGS, settings),

  appSwitchGetCurrentApp: (): Promise<ForegroundAppInfo | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_SWITCH_GET_CURRENT_APP),

  appSwitchGetDetectionMethod: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_SWITCH_GET_DETECTION_METHOD),

  onAppSwitchAppChanged: (callback: (app: ForegroundAppInfo) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, app: ForegroundAppInfo) => callback(app);
    ipcRenderer.on(IPC_CHANNELS.APP_SWITCH_APP_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_SWITCH_APP_CHANGED, listener);
  },

  // ─── Plugins (generic) ────────────────────────────────────
  pluginConnect: (pluginId: string, settings: Record<string, unknown>): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_CONNECT, pluginId, settings),

  pluginDisconnect: (pluginId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_DISCONNECT, pluginId),

  pluginGetState: (pluginId: string): Promise<Record<string, unknown> | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_STATE, pluginId),

  pluginQuery: (pluginId: string, queryName: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_QUERY, pluginId, queryName),

  pluginGetSettings: (pluginId: string): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_SETTINGS, pluginId),

  pluginSetSettings: (pluginId: string, settings: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_SET_SETTINGS, pluginId, settings),

  pluginGetManifests: (): Promise<unknown[]> => ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_MANIFESTS),

  pluginGetInfo: (
    pluginId: string
  ): Promise<{ id: string; name: string; version: string; connected: boolean } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_GET_INFO, pluginId),

  onPluginStateChanged: (pluginId: string, callback: (state: Record<string, unknown>) => void) => {
    const channel = `plugin:state-changed:${pluginId}`;
    const listener = (_event: Electron.IpcRendererEvent, state: Record<string, unknown>) => callback(state);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  onPluginShowFeedback: (callback: (event: PluginFeedbackEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: PluginFeedbackEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.PLUGIN_SHOW_FEEDBACK, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PLUGIN_SHOW_FEEDBACK, listener);
  },

  // ─── Plugin Store ───────────────────────────────────────────
  pluginStoreSearch: (query?: string): Promise<unknown[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_SEARCH, query),

  pluginStoreGetVersions: (packageName: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_GET_VERSIONS, packageName),

  pluginStoreInstall: (
    packageName: string,
    version: string
  ): Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_INSTALL, packageName, version),

  pluginStoreInstallUrl: (
    url: string
  ): Promise<{ success: boolean; pluginId?: string; version?: string; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_INSTALL_URL, url),

  pluginStoreUninstall: (pluginId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_UNINSTALL, pluginId),

  pluginStoreGetInstalled: (): Promise<
    Record<string, { version: string; source: string; installedAt: string; packageName?: string }>
  > => ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_GET_INSTALLED),

  pluginStoreCheckUpdates: (): Promise<Array<{ pluginId: string; currentVersion: string; latestVersion: string }>> =>
    ipcRenderer.invoke(IPC_CHANNELS.PLUGIN_STORE_CHECK_UPDATES),

  // ─── Logging ────────────────────────────────────────────────
  logGetEntries: (): Promise<LogEntry[]> => ipcRenderer.invoke(IPC_CHANNELS.LOG_GET_ENTRIES),

  logClear: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.LOG_CLEAR),

  onLogEntry: (callback: (entry: LogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry);
    ipcRenderer.on(IPC_CHANNELS.LOG_NEW_ENTRY, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LOG_NEW_ENTRY, listener);
  },

  // ─── Lifecycle ──────────────────────────────────────────────
  /** Signal that the renderer is ready to receive pushed events (key previews, etc.) */
  rendererReady: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.RENDERER_READY),

  // ─── Virtual Devices ────────────────────────────────────────
  virtualDeviceGetConfigs: (): Promise<VirtualDeviceConfig[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_GET_CONFIGS),

  virtualDeviceCreate: (config: VirtualDeviceConfig): Promise<VirtualDeviceConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_CREATE, config),

  virtualDeviceUpdate: (config: VirtualDeviceConfig): Promise<VirtualDeviceConfig> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_UPDATE, config),

  virtualDeviceDelete: (deviceId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_DELETE, deviceId),

  virtualDeviceKeyDown: (deviceId: string, buttonIndex: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_DOWN, deviceId, buttonIndex),

  virtualDeviceKeyUp: (deviceId: string, buttonIndex: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_UP, deviceId, buttonIndex),

  virtualDeviceEncoderRotate: (deviceId: string, knobId: string, delta: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_ENCODER_ROTATE, deviceId, knobId, delta),

  virtualDeviceEncoderPress: (deviceId: string, knobId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_ENCODER_PRESS, deviceId, knobId),

  virtualDeviceSliderChange: (deviceId: string, sliderId: string, value: number): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_SLIDER_CHANGE, deviceId, sliderId, value),

  virtualDeviceGetKeyImages: (deviceId: string): Promise<Record<number, string>> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_GET_KEY_IMAGES, deviceId),

  virtualDeviceGetSliderValues: (deviceId: string): Promise<Record<string, number>> =>
    ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DEVICE_GET_SLIDER_VALUES, deviceId),

  onVirtualDeviceKeyImage: (callback: (data: { deviceId: string; keyIndex: number; dataUri: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { deviceId: string; keyIndex: number; dataUri: string }
    ) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_IMAGE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_IMAGE, listener);
  },

  onVirtualDeviceSliderValue: (callback: (data: { deviceId: string; sliderId: string; value: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { deviceId: string; sliderId: string; value: number }) =>
      callback(data);
    ipcRenderer.on(IPC_CHANNELS.VIRTUAL_DEVICE_SLIDER_VALUE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.VIRTUAL_DEVICE_SLIDER_VALUE, listener);
  },

  onSliderChange: (callback: (event: DeviceSliderEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: DeviceSliderEvent) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DEVICE_SLIDER_CHANGE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DEVICE_SLIDER_CHANGE, listener);
  },

  // ─── Web Companion Server ─────────────────────────────────────
  webServerStart: (port?: number): Promise<WebServerStatus> => ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_START, port),

  webServerStop: (): Promise<WebServerStatus> => ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_STOP),

  webServerGetStatus: (): Promise<WebServerStatus> => ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_GET_STATUS),

  webServerSetPin: (pin: string): Promise<WebServerStatus> => ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_SET_PIN, pin),

  webServerSetPort: (port: number): Promise<{ port: number }> =>
    ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_SET_PORT, port),

  webServerGetQrCode: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.WEB_SERVER_GET_QR_CODE),

  onWebServerStatusChanged: (callback: (status: WebServerStatus) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: WebServerStatus) => callback(status);
    ipcRenderer.on(IPC_CHANNELS.WEB_SERVER_STATUS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WEB_SERVER_STATUS_CHANGED, listener);
  },

  // ─── Virtual Deck Windows ───────────────────────────────────
  virtualDeckOpen: (deviceId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DECK_OPEN, deviceId),

  virtualDeckClose: (deviceId: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.VIRTUAL_DECK_CLOSE, deviceId)
};

export type OSCApi = typeof api;

contextBridge.exposeInMainWorld('osc', api);
