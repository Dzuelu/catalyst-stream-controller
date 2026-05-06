import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserWindow, dialog, invokeHandler, getRegisteredChannels, resetAllElectronMocks } from '../mocks/electron';
import { resetMockFs, setFile, getFile } from '../mocks/fs';
import { registerIpcHandlers } from '../../src/main/ipc/handlers';
import { IPC_CHANNELS } from '../../src/shared/types';
import type {
  InteractionSettings,
  Profile,
  SafeAreaInsets,
  DrawKeyRequest,
  PageNavigationState
} from '../../src/shared/types';
import { createAppearanceFromFlat } from '../../src/shared/appearance-helpers';
import type { AppSwitchSettings, ForegroundAppInfo } from '../../src/shared/app-switch-types';

// ─── Mock dependencies ──────────────────────────────────────────

function createMockDeviceManager() {
  const mockDevice = {
    setBrightness: vi.fn(),
    drawKey: vi.fn(),
    drawCalibration: vi.fn(),
    setKeyInsets: vi.fn(),
    getInfo: vi.fn(() => ({
      id: 'dev-1',
      name: 'Mock Device',
      serial: 'SERIAL-001',
      rows: 3,
      cols: 5,
      keySize: 96,
      controls: [],
      connected: true,
      safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
    }))
  };
  return {
    getDeviceInfo: vi.fn(() => mockDevice.getInfo()),
    getAllDeviceInfos: vi.fn(() => [mockDevice.getInfo()]),
    getDevice: vi.fn((_id: string) => mockDevice),
    getAllDevices: vi.fn(() => [mockDevice]),
    _mockDevice: mockDevice
  };
}

function createMockProfile(): Profile {
  return {
    id: 'prof-1',
    name: 'Default Profile',
    rootPageId: 'page-root',
    pages: {
      'page-root': {
        id: 'page-root',
        name: 'Root',
        bindings: {
          0: {
            press: {
              id: 'action-1',
              type: 'hotkey',
              label: 'Test Hotkey',
              config: { steps: [{ modifiers: [], key: 'a' }] }
            }
          }
        }
      }
    }
  };
}

function createMockProfileManager() {
  const profile = createMockProfile();
  const navState: PageNavigationState = {
    currentPageId: 'page-root',
    breadcrumbs: [{ pageId: 'page-root', pageName: 'Root' }]
  };
  return {
    getData: vi.fn(() => ({
      version: 3 as const,
      activeProfileId: 'prof-1',
      profiles: [profile],
      interactionSettings: { longPressMs: 500, doubleTapMs: 300 }
    })),
    getProfile: vi.fn((id: string) => (id === 'prof-1' ? profile : undefined)),
    saveProfile: vi.fn(),
    getActiveProfile: vi.fn(() => profile),
    setActiveProfile: vi.fn(async () => true),
    createProfile: vi.fn(async (name: string) => ({
      ...profile,
      id: 'prof-new',
      name
    })),
    deleteProfile: vi.fn(async () => true),
    renameProfile: vi.fn(async () => true),
    importProfile: vi.fn(async (p: Profile) => ({
      ...p,
      id: 'prof-imported'
    })),
    getNavigationState: vi.fn(() => navState),
    navigateToPage: vi.fn(() => navState),
    navigateBack: vi.fn(() => navState),
    navigateToRoot: vi.fn(() => navState),
    getCurrentPageId: vi.fn(() => 'page-root'),
    getCurrentPage: vi.fn(() => profile.pages['page-root']),
    createPage: vi.fn(async (name: string) => ({
      id: 'page-new',
      name,
      bindings: {}
    })),
    deletePage: vi.fn(async () => true),
    renamePage: vi.fn(async () => true),
    getInteractionSettings: vi.fn(() => ({
      longPressMs: 500,
      doubleTapMs: 300
    })),
    setInteractionSettings: vi.fn(),
    getAppSwitchSettings: vi.fn(() => ({
      enabled: false,
      defaultProfileId: '',
      rules: [],
      pollIntervalMs: 500
    })),
    setAppSwitchSettings: vi.fn(),
    getCalibrationInsets: vi.fn(() => ({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0
    })),
    setCalibrationInsets: vi.fn(),
    saveBrightness: vi.fn(),
    getBrightness: vi.fn((serial?: string) => (serial === 'SERIAL-001' ? 0.8 : serial === '_default' ? 1 : undefined)),
    getDeviceProfileId: vi.fn((_dKey: string) => 'prof-1'),
    getDeviceCurrentPage: vi.fn((_dKey: string) => profile.pages['page-root']),
    getDeviceNavigationState: vi.fn((_dKey: string) => navState),
    setDeviceProfile: vi.fn(async () => true),
    navigateDeviceToPage: vi.fn((_dKey: string) => navState),
    navigateDeviceBack: vi.fn((_dKey: string) => navState),
    navigateDeviceToRoot: vi.fn((_dKey: string) => navState),
    initDeviceNavigation: vi.fn()
  };
}

function createMockActionExecutor() {
  return {
    execute: vi.fn()
  };
}

function createMockAppMonitor() {
  return {
    updateSettings: vi.fn(),
    getCurrentApp: vi.fn(
      async (): Promise<ForegroundAppInfo | null> => ({
        name: 'Firefox',
        bundleId: 'org.mozilla.firefox',
        detectionMethod: 'macos'
      })
    ),
    notifyManualSwitch: vi.fn()
  };
}

function createMockLogCollector() {
  return {
    getEntries: vi.fn(() => [
      { id: 1, timestamp: '2026-01-01T00:00:00Z', level: 'info', message: 'test', source: 'Main' }
    ]),
    clear: vi.fn()
  };
}

// ─── Test suite ─────────────────────────────────────────────────

describe('IPC Handlers (integration)', () => {
  let deviceManager: ReturnType<typeof createMockDeviceManager>;
  let profileManager: ReturnType<typeof createMockProfileManager>;
  let actionExecutor: ReturnType<typeof createMockActionExecutor>;
  let applyCurrentPage: () => Promise<void>;
  let applyDevicePage: (deviceKey: string) => Promise<void>;
  let pushPreviews: () => Promise<void>;
  let onInteractionSettingsChanged: (settings: InteractionSettings) => void;
  let appMonitor: ReturnType<typeof createMockAppMonitor>;
  let logCollector: ReturnType<typeof createMockLogCollector>;

  // Helpers for broadcast assertions
  const mockWebContents = { send: vi.fn() };
  const mockWindow = { webContents: mockWebContents, isDestroyed: vi.fn(() => false) };

  beforeEach(() => {
    resetAllElectronMocks();
    resetMockFs();

    deviceManager = createMockDeviceManager();
    profileManager = createMockProfileManager();
    actionExecutor = createMockActionExecutor();
    applyCurrentPage = vi.fn<() => Promise<void>>();
    applyDevicePage = vi.fn<(deviceKey: string) => Promise<void>>();
    pushPreviews = vi.fn<() => Promise<void>>();
    onInteractionSettingsChanged = vi.fn<(settings: InteractionSettings) => void>();
    appMonitor = createMockAppMonitor();
    logCollector = createMockLogCollector();

    // Set up BrowserWindow.getAllWindows to return our mock window for broadcast tests
    mockWebContents.send.mockClear();
    (BrowserWindow.getAllWindows as ReturnType<typeof vi.fn>).mockReturnValue([mockWindow]);
    (BrowserWindow.getFocusedWindow as ReturnType<typeof vi.fn>).mockReturnValue(mockWindow);

    registerIpcHandlers(
      deviceManager as never,
      profileManager as never,
      actionExecutor as never,
      applyCurrentPage,
      applyDevicePage,
      pushPreviews,
      onInteractionSettingsChanged,
      appMonitor as never,
      logCollector as never
    );
  });

  // ─── Registration ───────────────────────────────────────────

  describe('handler registration', () => {
    it('should register all expected IPC channels', () => {
      const channels = getRegisteredChannels();
      const expectedChannels = [
        'device:get-info',
        'device:get-all-info',
        'device:set-brightness',
        'device:get-brightness',
        'device:draw-key',
        'device:draw-calibration',
        'device:set-key-insets',
        'profile:get-all',
        'profile:load',
        'profile:save',
        'profile:set-active',
        'profile:create',
        'profile:delete',
        'profile:rename',
        'profile:export',
        'profile:import',
        'page:get-state',
        'page:navigate',
        'page:navigate-back',
        'page:navigate-root',
        'page:create',
        'page:delete',
        'page:rename',
        'image:pick',
        'interaction:get-settings',
        'interaction:set-settings',
        'action:execute',
        'app-switch:get-settings',
        'app-switch:set-settings',
        'app-switch:get-current-app',
        'app-switch:get-detection-method',
        'log:get-entries',
        'log:clear',
        'key:render-preview',
        'renderer:ready',
        'virtual-device:get-configs',
        'virtual-device:create',
        'virtual-device:update',
        'virtual-device:delete',
        'virtual-device:key-down',
        'virtual-device:key-up',
        'virtual-device:encoder-rotate',
        'virtual-device:encoder-press',
        'virtual-device:slider-change',
        'virtual-device:get-key-images',
        'virtual-device:get-slider-values',
        'virtual-deck:open',
        'virtual-deck:close',
        'web-server:start',
        'web-server:stop',
        'web-server:get-status',
        'web-server:set-pin',
        'web-server:set-port',
        'web-server:get-qr',
        'device:get-active-profile',
        'device:set-active-profile',
        'device:page-get-state',
        'device:page-navigate',
        'device:page-navigate-back',
        'device:page-navigate-root'
      ];
      for (const ch of expectedChannels) {
        expect(channels).toContain(ch);
      }
      expect(channels.length).toBe(expectedChannels.length);
    });
  });

  // ─── Device handlers ───────────────────────────────────────

  describe('device handlers', () => {
    it('device:get-info should return device info', async () => {
      const result = await invokeHandler(IPC_CHANNELS.DEVICE_GET_INFO);
      expect(deviceManager.getDeviceInfo).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ id: 'dev-1', name: 'Mock Device' }));
    });

    it('device:get-all-info should return array of device infos', async () => {
      const result = await invokeHandler(IPC_CHANNELS.DEVICE_GET_ALL_INFO);
      expect(deviceManager.getAllDeviceInfos).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('device:set-brightness should set brightness on specific device and persist', async () => {
      await invokeHandler(IPC_CHANNELS.DEVICE_SET_BRIGHTNESS, 0.5, 'dev-1');
      expect(deviceManager.getDevice).toHaveBeenCalledWith('dev-1');
      expect(deviceManager._mockDevice.setBrightness).toHaveBeenCalledWith(0.5);
      expect(profileManager.saveBrightness).toHaveBeenCalledWith(0.5, 'SERIAL-001');
    });

    it('device:set-brightness without deviceId should be ignored', async () => {
      await invokeHandler(IPC_CHANNELS.DEVICE_SET_BRIGHTNESS, 0.7);
      // Without deviceId, the handler should not set brightness on any device
      expect(deviceManager._mockDevice.setBrightness).not.toHaveBeenCalled();
    });

    it('device:get-brightness should return brightness for specific device', async () => {
      const result = await invokeHandler(IPC_CHANNELS.DEVICE_GET_BRIGHTNESS, 'dev-1');
      expect(result).toBe(0.8);
    });

    it('device:get-brightness without deviceId should return default with warning', async () => {
      const result = await invokeHandler(IPC_CHANNELS.DEVICE_GET_BRIGHTNESS);
      // Falls back to default brightness
      expect(result).toBe(1);
    });

    it('device:draw-key should draw to a specific device', async () => {
      const request: DrawKeyRequest = {
        deviceId: 'dev-1',
        keyIndex: 3,
        appearance: createAppearanceFromFlat({
          backgroundColor: '#000000',
          label: {
            text: 'Test',
            color: '#ffffff',
            fontSize: 14,
            bold: false,
            positionV: 'center',
            positionH: 'center'
          }
        })
      };
      await invokeHandler(IPC_CHANNELS.DEVICE_DRAW_KEY, request);
      expect(deviceManager.getDevice).toHaveBeenCalledWith('dev-1');
      expect(deviceManager._mockDevice.drawKey).toHaveBeenCalledWith(3, request.appearance);
    });

    it('device:draw-key without deviceId should be ignored', async () => {
      const request = {
        keyIndex: 0,
        appearance: createAppearanceFromFlat({
          backgroundColor: '#000000',
          label: {
            text: '',
            color: '#ffffff',
            fontSize: 14,
            bold: false,
            positionV: 'center',
            positionH: 'center'
          }
        })
      };
      await invokeHandler(IPC_CHANNELS.DEVICE_DRAW_KEY, request);
      // Without deviceId, the handler should not draw to any device
      expect(deviceManager._mockDevice.drawKey).not.toHaveBeenCalled();
    });

    it('device:draw-calibration should draw calibration on specific device', async () => {
      await invokeHandler(IPC_CHANNELS.DEVICE_DRAW_CALIBRATION, 'dev-1');
      expect(deviceManager._mockDevice.drawCalibration).toHaveBeenCalled();
    });

    it('device:set-key-insets should set insets and persist', async () => {
      const insets: SafeAreaInsets = { top: 2, bottom: 2, left: 2, right: 2 };
      await invokeHandler(IPC_CHANNELS.DEVICE_SET_KEY_INSETS, insets, 'dev-1');
      expect(deviceManager._mockDevice.setKeyInsets).toHaveBeenCalledWith(insets);
      expect(profileManager.setCalibrationInsets).toHaveBeenCalledWith(insets, 'SERIAL-001');
    });
  });

  // ─── Profile handlers ──────────────────────────────────────

  describe('profile handlers', () => {
    it('profile:get-all should return profile data', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_GET_ALL);
      expect(profileManager.getData).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ version: 3, activeProfileId: 'prof-1' }));
    });

    it('profile:load should return a specific profile', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_LOAD, 'prof-1');
      expect(profileManager.getProfile).toHaveBeenCalledWith('prof-1');
      expect(result).toEqual(expect.objectContaining({ id: 'prof-1', name: 'Default Profile' }));
    });

    it('profile:load should return undefined for unknown id', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_LOAD, 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('profile:save should save and broadcast when profile is active', async () => {
      const profile = createMockProfile();
      await invokeHandler(IPC_CHANNELS.PROFILE_SAVE, profile);
      expect(profileManager.saveProfile).toHaveBeenCalledWith(profile);
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
      expect(applyDevicePage).toHaveBeenCalledWith('SERIAL-001');
    });

    it('profile:save should not re-apply page if saved profile is not active', async () => {
      profileManager.getDeviceProfileId.mockReturnValue('prof-other-device');
      const profile = { ...createMockProfile(), id: 'prof-other' };
      await invokeHandler(IPC_CHANNELS.PROFILE_SAVE, profile);
      expect(profileManager.saveProfile).toHaveBeenCalled();
      expect(applyDevicePage).not.toHaveBeenCalled();
    });

    it('profile:set-active should switch profile and broadcast', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_SET_ACTIVE, 'prof-1');
      expect(result).toBe(true);
      expect(profileManager.setActiveProfile).toHaveBeenCalledWith('prof-1');
      expect(appMonitor.notifyManualSwitch).toHaveBeenCalled();
      // Should broadcast both profile and page changes
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
    });

    it('profile:set-active should not broadcast on failure', async () => {
      profileManager.setActiveProfile.mockResolvedValue(false);
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_SET_ACTIVE, 'bad-id');
      expect(result).toBe(false);
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('profile:create should create a new profile and broadcast', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_CREATE, 'New Profile');
      expect(profileManager.createProfile).toHaveBeenCalledWith('New Profile');
      expect(result).toEqual(expect.objectContaining({ name: 'New Profile' }));
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('profile:delete should delete and broadcast', async () => {
      // Simulate deleting a non-active profile
      profileManager.getActiveProfile.mockReturnValue({ ...createMockProfile(), id: 'prof-other' } as never);
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_DELETE, 'prof-1');
      expect(result).toBe(true);
      expect(profileManager.deleteProfile).toHaveBeenCalledWith('prof-1');
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('profile:delete should broadcast page change if deleted profile was active', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_DELETE, 'prof-1');
      expect(result).toBe(true);
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
    });

    it('profile:rename should rename and broadcast', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PROFILE_RENAME, 'prof-1', 'Renamed');
      expect(result).toBe(true);
      expect(profileManager.renameProfile).toHaveBeenCalledWith('prof-1', 'Renamed');
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('profile:export should save profile to file on success', async () => {
      (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePath: '/tmp/profile.json'
      });
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_EXPORT, 'prof-1')) as {
        success: boolean;
      };
      expect(result.success).toBe(true);
      // Verify data was written to mock fs
      const written = getFile('/tmp/profile.json');
      expect(written).toBeDefined();
      const parsed = JSON.parse(written!);
      expect(parsed.format).toBe('catalyst-stream-controller-profile');
      expect(parsed.profile.id).toBe('prof-1');
    });

    it('profile:export should return failure when dialog is canceled', async () => {
      (dialog.showSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: true,
        filePath: undefined
      });
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_EXPORT, 'prof-1')) as {
        success: boolean;
      };
      expect(result.success).toBe(false);
    });

    it('profile:export should return error for unknown profile', async () => {
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_EXPORT, 'nonexistent')) as {
        success: boolean;
        error?: string;
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Profile not found');
    });

    it('profile:import should import profiles from selected files', async () => {
      const profileData = {
        format: 'catalyst-stream-controller-profile',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: createMockProfile()
      };
      setFile('/tmp/imported.json', JSON.stringify(profileData));
      (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/imported.json']
      });
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_IMPORT)) as {
        success: boolean;
        imported?: string[];
      };
      expect(result.success).toBe(true);
      expect(profileManager.importProfile).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('profile:import should return failure when dialog is canceled', async () => {
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_IMPORT)) as {
        success: boolean;
      };
      expect(result.success).toBe(false);
    });

    it('profile:import should report errors for invalid format', async () => {
      setFile('/tmp/bad.json', JSON.stringify({ wrong: 'format' }));
      (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/bad.json']
      });
      const result = (await invokeHandler(IPC_CHANNELS.PROFILE_IMPORT)) as {
        success: boolean;
        errors?: string[];
      };
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Invalid profile format');
    });
  });

  // ─── Page handlers ─────────────────────────────────────────

  describe('page handlers', () => {
    it('page:get-state should return navigation state', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PAGE_GET_STATE);
      expect(profileManager.getNavigationState).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ currentPageId: 'page-root' }));
    });

    it('page:navigate should navigate to page and broadcast', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PAGE_NAVIGATE, 'page-2');
      expect(profileManager.navigateToPage).toHaveBeenCalledWith('page-2');
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });

    it('page:navigate should not broadcast when navigateToPage returns null', async () => {
      profileManager.navigateToPage.mockReturnValue(null as unknown as PageNavigationState);
      await invokeHandler(IPC_CHANNELS.PAGE_NAVIGATE, 'nonexistent');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('page:navigate-back should navigate back and broadcast', async () => {
      await invokeHandler(IPC_CHANNELS.PAGE_NAVIGATE_BACK);
      expect(profileManager.navigateBack).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
    });

    it('page:navigate-root should navigate to root and broadcast', async () => {
      await invokeHandler(IPC_CHANNELS.PAGE_NAVIGATE_ROOT);
      expect(profileManager.navigateToRoot).toHaveBeenCalled();
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
    });

    it('page:create should create page and broadcast profile changes', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PAGE_CREATE, 'New Page');
      expect(profileManager.createPage).toHaveBeenCalledWith('New Page', undefined);
      expect(result).toEqual(expect.objectContaining({ name: 'New Page' }));
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('page:create should not broadcast when createPage returns null', async () => {
      profileManager.createPage.mockResolvedValue(null as never);
      await invokeHandler(IPC_CHANNELS.PAGE_CREATE, 'Fail');
      expect(mockWebContents.send).not.toHaveBeenCalled();
    });

    it('page:delete should delete and broadcast', async () => {
      // Not the current page
      profileManager.getCurrentPageId.mockReturnValue('page-other');
      const result = await invokeHandler(IPC_CHANNELS.PAGE_DELETE, 'page-root');
      expect(result).toBe(true);
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
    });

    it('page:delete should also broadcast page change and re-apply when deleting current page', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PAGE_DELETE, 'page-root');
      expect(result).toBe(true);
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
      expect(applyCurrentPage).toHaveBeenCalled();
    });

    it('page:rename should rename and broadcast', async () => {
      const result = await invokeHandler(IPC_CHANNELS.PAGE_RENAME, 'page-root', 'Renamed');
      expect(result).toBe(true);
      expect(profileManager.renamePage).toHaveBeenCalledWith('page-root', 'Renamed', undefined);
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PROFILE_CHANGED, expect.anything());
      expect(mockWebContents.send).toHaveBeenCalledWith(IPC_CHANNELS.PAGE_CHANGED, expect.anything());
    });
  });

  // ─── Image handler ─────────────────────────────────────────

  describe('image handler', () => {
    it('image:pick should return data URI when user selects a file', async () => {
      setFile('/tmp/test.png', 'fake-png-data');
      (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: false,
        filePaths: ['/tmp/test.png']
      });
      const result = await invokeHandler(IPC_CHANNELS.PICK_IMAGE);
      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('image:pick should return null when dialog is canceled', async () => {
      (dialog.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValue({
        canceled: true,
        filePaths: []
      });
      const result = await invokeHandler(IPC_CHANNELS.PICK_IMAGE);
      expect(result).toBeNull();
    });
  });

  // ─── Interaction settings handlers ─────────────────────────

  describe('interaction settings handlers', () => {
    it('interaction:get-settings should return current settings', async () => {
      const result = (await invokeHandler(IPC_CHANNELS.INTERACTION_GET_SETTINGS)) as InteractionSettings;
      expect(result).toEqual({ longPressMs: 500, doubleTapMs: 300 });
    });

    it('interaction:set-settings should save and notify callback', async () => {
      const settings: InteractionSettings = { longPressMs: 600, doubleTapMs: 200 };
      await invokeHandler(IPC_CHANNELS.INTERACTION_SET_SETTINGS, settings);
      expect(profileManager.setInteractionSettings).toHaveBeenCalledWith(settings);
      expect(onInteractionSettingsChanged).toHaveBeenCalledWith(settings);
    });
  });

  // ─── Action handler ────────────────────────────────────────

  describe('action handler', () => {
    it('action:execute should find and execute the matching action', async () => {
      await invokeHandler(IPC_CHANNELS.ACTION_EXECUTE, 'action-1');
      expect(actionExecutor.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'action-1', type: 'hotkey' }));
    });

    it('action:execute should do nothing for unknown actionId', async () => {
      await invokeHandler(IPC_CHANNELS.ACTION_EXECUTE, 'nonexistent');
      expect(actionExecutor.execute).not.toHaveBeenCalled();
    });

    it('action:execute should do nothing when no current page', async () => {
      profileManager.getCurrentPage.mockReturnValue(
        undefined as unknown as ReturnType<typeof profileManager.getCurrentPage>
      );
      profileManager.getDeviceCurrentPage.mockReturnValue(
        null as unknown as ReturnType<typeof profileManager.getDeviceCurrentPage>
      );
      await invokeHandler(IPC_CHANNELS.ACTION_EXECUTE, 'action-1');
      expect(actionExecutor.execute).not.toHaveBeenCalled();
    });
  });

  // ─── App switching handlers ───────────────────────────────

  describe('app switching handlers', () => {
    it('app-switch:get-settings should return settings', async () => {
      const result = (await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_SETTINGS)) as AppSwitchSettings;
      expect(result).toEqual(expect.objectContaining({ enabled: false, rules: [] }));
    });

    it('app-switch:set-settings should save and update monitor', async () => {
      const settings: AppSwitchSettings = {
        enabled: true,
        defaultProfileId: 'prof-1',
        rules: [{ id: 'r1', appName: 'Firefox', profileId: 'prof-2' }],
        pollIntervalMs: 1000
      };
      await invokeHandler(IPC_CHANNELS.APP_SWITCH_SET_SETTINGS, settings);
      expect(profileManager.setAppSwitchSettings).toHaveBeenCalledWith(settings);
      expect(appMonitor.updateSettings).toHaveBeenCalledWith(settings);
    });

    it('app-switch:get-current-app should return current app info', async () => {
      const result = (await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_CURRENT_APP)) as ForegroundAppInfo;
      expect(result).toEqual(expect.objectContaining({ name: 'Firefox', bundleId: 'org.mozilla.firefox' }));
    });

    it('app-switch:get-detection-method should return method from current app', async () => {
      const result = await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_DETECTION_METHOD);
      expect(result).toBe('macos');
    });

    it('app-switch:get-detection-method should return null when no app detected', async () => {
      appMonitor.getCurrentApp.mockResolvedValue(null);
      const result = await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_DETECTION_METHOD);
      expect(result).toBeNull();
    });
  });

  // ─── App switching without monitor ────────────────────────

  describe('app switching handlers (no monitor)', () => {
    beforeEach(() => {
      resetAllElectronMocks();
      registerIpcHandlers(
        deviceManager as never,
        profileManager as never,
        actionExecutor as never,
        applyCurrentPage,
        applyDevicePage,
        pushPreviews,
        onInteractionSettingsChanged,
        undefined, // no appMonitor
        logCollector as never
      );
    });

    it('app-switch:get-current-app should return null without monitor', async () => {
      const result = await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_CURRENT_APP);
      expect(result).toBeNull();
    });

    it('app-switch:get-detection-method should return null without monitor', async () => {
      const result = await invokeHandler(IPC_CHANNELS.APP_SWITCH_GET_DETECTION_METHOD);
      expect(result).toBeNull();
    });
  });

  // ─── Logging handlers ─────────────────────────────────────

  describe('logging handlers', () => {
    it('log:get-entries should return log entries', async () => {
      const result = await invokeHandler(IPC_CHANNELS.LOG_GET_ENTRIES);
      expect(logCollector.getEntries).toHaveBeenCalled();
      expect(result).toHaveLength(1);
    });

    it('log:clear should clear log entries', async () => {
      await invokeHandler(IPC_CHANNELS.LOG_CLEAR);
      expect(logCollector.clear).toHaveBeenCalled();
    });
  });

  // ─── Logging without collector ────────────────────────────

  describe('logging handlers (no collector)', () => {
    beforeEach(() => {
      resetAllElectronMocks();
      registerIpcHandlers(
        deviceManager as never,
        profileManager as never,
        actionExecutor as never,
        applyCurrentPage,
        applyDevicePage,
        pushPreviews,
        onInteractionSettingsChanged,
        appMonitor as never,
        undefined // no logCollector
      );
    });

    it('log:get-entries should return empty array without collector', async () => {
      const result = await invokeHandler(IPC_CHANNELS.LOG_GET_ENTRIES);
      expect(result).toEqual([]);
    });

    it('log:clear should not throw without collector', () => {
      expect(() => invokeHandler(IPC_CHANNELS.LOG_CLEAR)).not.toThrow();
    });
  });
});
