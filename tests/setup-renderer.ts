import { vi, type Mock } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { OSCApi } from '../src/preload/preload';

// ── Mock window.osc (preload API) ────────────────────────────
// Every renderer component accesses window.osc for IPC calls.
// This mock provides sensible defaults that can be overridden per test.

function noop() {
  return () => {};
}

/**
 * Test-friendly version of OSCApi: event listener methods return () => void
 * instead of () => Electron.IpcRenderer (which is an internal Electron detail).
 */
type TestableApi = {
  [K in keyof OSCApi]: OSCApi[K] extends (...args: infer A) => () => unknown ? (...args: A) => () => void : OSCApi[K];
};

/** Type-safe mock: each method of OSCApi becomes a Mock with the same signature */
type MockedOSCApi = {
  [K in keyof TestableApi]: TestableApi[K] extends (...args: infer A) => infer R
    ? Mock<(...args: A) => R>
    : TestableApi[K];
};

const mockOSCApi: MockedOSCApi = {
  // Device
  getDeviceInfo: vi.fn(async () => null),
  getConnectedDevices: vi.fn(async () => []),
  setBrightness: vi.fn(async () => {}),
  getBrightness: vi.fn(async () => 1),
  onBrightnessChanged: vi.fn(noop),
  drawKey: vi.fn(async () => {}),
  renderKeyPreview: vi.fn(async () => 'data:image/png;base64,mock-preview'),
  onKeyPreviewUpdate: vi.fn(noop),
  drawCalibration: vi.fn(async () => {}),
  setKeyInsets: vi.fn(async () => {}),
  pickImage: vi.fn(async () => null),
  onDeviceConnected: vi.fn(noop),
  onDeviceDisconnected: vi.fn(noop),
  onButtonDown: vi.fn(noop),
  onButtonUp: vi.fn(noop),
  onKnobRotate: vi.fn(noop),

  // Profiles
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async () => {}),
  getAllProfiles: vi.fn(async () => ({
    version: 3 as const,
    activeProfileId: 'prof-1',
    profiles: [
      {
        id: 'prof-1',
        name: 'Default',
        rootPageId: 'page-root',
        pages: {
          'page-root': { id: 'page-root', name: 'Root', bindings: {} }
        }
      }
    ]
  })),
  setActiveProfile: vi.fn(async () => true),
  createProfile: vi.fn(async (name: string) => ({
    id: 'prof-new',
    name,
    rootPageId: 'page-root',
    pages: { 'page-root': { id: 'page-root', name: 'Root', bindings: {} } }
  })),
  deleteProfile: vi.fn(async () => true),
  renameProfile: vi.fn(async () => true),
  exportProfile: vi.fn(async () => ({ success: true })),
  importProfile: vi.fn(async () => ({ success: true, imported: ['Imported Profile'] })),
  onProfileChanged: vi.fn(noop),

  // Pages
  getPageState: vi.fn(async () => ({
    currentPageId: 'page-root',
    breadcrumbs: [{ pageId: 'page-root', pageName: 'Root' }]
  })),
  navigatePage: vi.fn(async () => null),
  navigateBack: vi.fn(async () => null),
  navigateRoot: vi.fn(async () => null),
  createPage: vi.fn(async () => ({ id: 'page-new', name: 'New Page', bindings: {} })),
  deletePage: vi.fn(async () => true),
  renamePage: vi.fn(async () => true),
  onPageChanged: vi.fn(noop),

  // Per-Device Profile / Page
  deviceGetActiveProfile: vi.fn(async () => 'prof-1'),
  deviceSetActiveProfile: vi.fn(async () => true),
  deviceGetPageState: vi.fn(async () => ({
    currentPageId: 'page-root',
    breadcrumbs: [{ pageId: 'page-root', pageName: 'Root' }]
  })),
  deviceNavigatePage: vi.fn(async () => null),
  deviceNavigateBack: vi.fn(async () => null),
  deviceNavigateRoot: vi.fn(async () => null),

  // Actions
  executeAction: vi.fn(async () => {}),

  // Interaction settings
  getInteractionSettings: vi.fn(async () => ({ longPressMs: 500, doubleTapMs: 300 })),
  setInteractionSettings: vi.fn(async () => {}),

  // App switching
  appSwitchGetSettings: vi.fn(async () => ({
    enabled: false,
    defaultProfileId: '',
    rules: [],
    pollIntervalMs: 500
  })),
  appSwitchSetSettings: vi.fn(async () => {}),
  appSwitchGetCurrentApp: vi.fn(async () => null),
  appSwitchGetDetectionMethod: vi.fn(async () => null),
  onAppSwitchAppChanged: vi.fn(noop),

  // Logging
  logGetEntries: vi.fn(async () => []),
  logClear: vi.fn(async () => {}),
  onLogEntry: vi.fn(noop),

  // Plugins
  pluginConnect: vi.fn(async () => ({ success: true })),
  pluginDisconnect: vi.fn(async () => {}),
  pluginGetState: vi.fn(async () => null),
  pluginQuery: vi.fn(async () => []),
  pluginGetSettings: vi.fn(async () => ({})),
  pluginSetSettings: vi.fn(async () => {}),
  pluginGetManifests: vi.fn(async () => []),
  pluginGetInfo: vi.fn(async () => null),
  onPluginStateChanged: vi.fn(noop),

  // Plugin feedback
  onPluginShowFeedback: vi.fn(noop),

  // Plugin Store

  pluginStoreSearch: vi.fn(async (_query?: string): Promise<any[]> => []),

  pluginStoreGetVersions: vi.fn(async (_name: string): Promise<any> => null),

  pluginStoreInstall: vi.fn(async (_name: string, _version: string): Promise<any> => ({ success: true })),

  pluginStoreInstallUrl: vi.fn(async (_url: string): Promise<any> => ({ success: true })),

  pluginStoreUninstall: vi.fn(async (_id: string): Promise<any> => ({ success: true })),

  pluginStoreGetInstalled: vi.fn(async (): Promise<any> => ({})),

  pluginStoreCheckUpdates: vi.fn(async (): Promise<any[]> => []),

  // Virtual Devices
  virtualDeviceGetConfigs: vi.fn(async () => []),
  virtualDeviceCreate: vi.fn(async (config: any) => config),
  virtualDeviceUpdate: vi.fn(async (config: any) => config),
  virtualDeviceDelete: vi.fn(async () => {}),
  virtualDeviceKeyDown: vi.fn(async () => {}),
  virtualDeviceKeyUp: vi.fn(async () => {}),
  virtualDeviceEncoderRotate: vi.fn(async () => {}),
  virtualDeviceEncoderPress: vi.fn(async () => {}),
  virtualDeviceSliderChange: vi.fn(async () => {}),
  virtualDeviceGetKeyImages: vi.fn(async () => ({})),
  virtualDeviceGetSliderValues: vi.fn(async () => ({})),
  onVirtualDeviceKeyImage: vi.fn(noop),
  onVirtualDeviceSliderValue: vi.fn(noop),
  onSliderChange: vi.fn(noop),
  virtualDeckOpen: vi.fn(async () => {}),
  virtualDeckClose: vi.fn(async () => {}),

  // Web Companion Server
  webServerStart: vi.fn(async () => ({
    running: true,
    port: 9120,
    url: 'http://192.168.1.1:9120',
    connectedClients: 0,
    pin: '0000'
  })),
  webServerStop: vi.fn(async () => ({ running: false, port: 9120, url: null, connectedClients: 0, pin: '0000' })),
  webServerGetStatus: vi.fn(async () => ({ running: false, port: 9120, url: null, connectedClients: 0, pin: '0000' })),
  webServerSetPin: vi.fn(async () => ({ running: false, port: 9120, url: null, connectedClients: 0, pin: '1234' })),
  webServerSetPort: vi.fn(async () => ({ port: 9120 })),
  webServerGetQrCode: vi.fn(async () => null),
  onWebServerStatusChanged: vi.fn(noop),

  rendererReady: vi.fn(async () => {})
};

// Install on window before any component imports
Object.defineProperty(window, 'osc', {
  value: mockOSCApi,
  writable: true,
  configurable: true
});

// Export for test files to access and override mocks
export { mockOSCApi };

// ── Reset all mocks between tests ─────────────────────────────
import { beforeEach } from 'vitest';

beforeEach(() => {
  // Clear call counts but keep implementations
  Object.values(mockOSCApi).forEach((mock) => {
    if (typeof mock === 'function' && 'mockClear' in mock) {
      (mock as ReturnType<typeof vi.fn>).mockClear();
    }
  });
});
