import { ipcMain, BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../../shared/types';
import type {
  DrawKeyRequest,
  InteractionSettings,
  KeyRenderPreviewRequest,
  Page,
  Profile,
  SafeAreaInsets
} from '../../shared/types';
import type { DeviceManager } from '../devices/DeviceManager';
import type { ProfileManager } from '../profiles/ProfileManager';
import type { ActionExecutor } from '../actions/ActionExecutor';
import type { ForegroundAppMonitor } from '../integrations/ForegroundAppMonitor';
import type { AppSwitchSettings } from '../../shared/app-switch-types';
import type { LogCollector } from '../logging/LogCollector';
import type { VirtualDriver } from '../devices/virtual/VirtualDriver';
import type { VirtualDeviceConfig } from '../devices/virtual/VirtualDeviceConfig';
import type { VirtualWebServer } from '../devices/virtual/VirtualWebServer';
import { renderKey } from '../rendering/KeyRenderer';

/** Notify all renderer windows that profile data changed */
function broadcastProfileChanged(profileManager: ProfileManager): void {
  const data = profileManager.getData();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.PROFILE_CHANGED, data);
  }
}

/** Notify all renderer windows that page navigation changed */
function broadcastPageChanged(profileManager: ProfileManager): void {
  const state = profileManager.getNavigationState();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.PAGE_CHANGED, state);
  }
}

/** Notify all renderer windows that a device's page navigation changed */
function broadcastDevicePageChanged(profileManager: ProfileManager, deviceKey: string): void {
  const state = profileManager.getDeviceNavigationState(deviceKey);
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.PAGE_CHANGED, state);
  }
}

export function registerIpcHandlers(
  deviceManager: DeviceManager,
  profileManager: ProfileManager,
  actionExecutor: ActionExecutor,
  applyCurrentPage: () => Promise<void>,
  applyDevicePage: (deviceKey: string) => Promise<void>,
  pushPreviews: () => Promise<void>,
  onInteractionSettingsChanged?: (settings: InteractionSettings) => void,
  appMonitor?: ForegroundAppMonitor,
  logCollector?: LogCollector,
  virtualDriver?: VirtualDriver,
  virtualDeckCallbacks?: {
    open: (deviceId: string) => void;
    close: (deviceId: string) => void;
  },
  webServer?: VirtualWebServer,
  freshlyCreatedVirtualIds?: Set<string>
): void {
  // ─── Device handlers ────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_INFO, () => {
    return deviceManager.getDeviceInfo();
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_ALL_INFO, () => {
    return deviceManager.getAllDeviceInfos();
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_SET_BRIGHTNESS, async (_event, brightness: number, deviceId?: string) => {
    if (!deviceId) {
      console.warn('[IPC:SET_BRIGHTNESS] called without deviceId — ignoring to prevent broadcast');
      return;
    }
    console.debug(`[IPC:SET_BRIGHTNESS] deviceId=${deviceId} brightness=${brightness}`);
    const device = deviceManager.getDevice(deviceId);
    if (device) {
      await device.setBrightness(brightness);
      const serial = device.getInfo().serial;
      await profileManager.saveBrightness(brightness, serial || '_default');
    }
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_BRIGHTNESS, (_event, deviceId?: string) => {
    if (!deviceId) {
      console.warn('[IPC:GET_BRIGHTNESS] called without deviceId — returning default');
      return profileManager.getBrightness('_default') ?? 1;
    }
    const serial = deviceManager.getDevice(deviceId)?.getInfo().serial;
    return profileManager.getBrightness(serial) ?? profileManager.getBrightness('_default') ?? 1;
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_DRAW_KEY, async (_event, request: DrawKeyRequest) => {
    if (!request.deviceId) {
      console.warn('[IPC:DRAW_KEY] called without deviceId — ignoring to prevent broadcast');
      return;
    }
    console.debug(`[IPC:DRAW_KEY] keyIndex=${request.keyIndex} deviceId=${request.deviceId}`);
    const device = deviceManager.getDevice(request.deviceId);
    if (device) await device.drawKey(request.keyIndex, request.appearance);
  });

  // ─── Key Render Preview ─────────────────────────────────────
  // Renders a ButtonAppearance via KeyRenderer and returns the PNG data URI.
  // Used by the renderer process for live WYSIWYG preview.

  ipcMain.handle(IPC_CHANNELS.KEY_RENDER_PREVIEW, async (_event, request: KeyRenderPreviewRequest) => {
    // Find a device for keySize. Prefer the requested device, else first connected.
    const device = request.deviceId ? deviceManager.getDevice(request.deviceId) : deviceManager.getAllDevices()[0];

    // UI preview uses zero insets so the rendered image fills the button cell.
    // Device-specific insets are only applied when drawing to the physical device.
    const insets = { top: 0, bottom: 0, left: 0, right: 0 };
    const keySize = device?.getInfo().keySize ?? 96;

    return renderKey(request.appearance, insets, keySize, keySize);
  });

  // ─── Renderer Lifecycle ──────────────────────────────────────
  // When the renderer signals it's ready, push key previews so the UI
  // shows correct button images even if the device connected before the
  // renderer finished loading.  Only sends preview images — does NOT
  // redraw physical devices (they were already painted on connect).
  ipcMain.handle(IPC_CHANNELS.RENDERER_READY, async () => {
    await pushPreviews();
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_DRAW_CALIBRATION, async (_event, deviceId?: string) => {
    if (!deviceId) {
      console.warn('[IPC:DRAW_CALIBRATION] called without deviceId — ignoring to prevent broadcast');
      return;
    }
    console.debug(`[IPC:DRAW_CALIBRATION] deviceId=${deviceId}`);
    const device = deviceManager.getDevice(deviceId);
    if (device) await device.drawCalibration();
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_SET_KEY_INSETS, async (_event, insets: SafeAreaInsets, deviceId?: string) => {
    if (!deviceId) {
      console.warn('[IPC:SET_KEY_INSETS] called without deviceId — ignoring to prevent broadcast');
      return;
    }
    console.debug(
      `[IPC:SET_KEY_INSETS] deviceId=${deviceId} insets=T:${insets.top} B:${insets.bottom} L:${insets.left} R:${insets.right}`
    );
    const device = deviceManager.getDevice(deviceId);
    if (device) device.setKeyInsets(insets);
    // Persist calibration insets keyed by device serial (or device ID for virtual devices)
    const info = device?.getInfo();
    const persistKey = info?.serial || deviceId;
    await profileManager.setCalibrationInsets(insets, persistKey);
  });

  // ─── Profile handlers ──────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PROFILE_GET_ALL, () => {
    return profileManager.getData();
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_LOAD, (_event, id: string) => {
    return profileManager.getProfile(id);
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_SAVE, async (_event, profile: Profile) => {
    console.debug(`[IPC:PROFILE_SAVE] profileId=${profile.id} name="${profile.name}"`);
    await profileManager.saveProfile(profile);
    broadcastProfileChanged(profileManager);
    // Re-apply to any device using this profile
    for (const device of deviceManager.getAllDevices()) {
      const dKey = device.getInfo().serial || device.getInfo().id;
      if (profileManager.getDeviceProfileId(dKey) === profile.id) {
        console.debug(`[IPC:PROFILE_SAVE] Re-applying to device dKey="${dKey}"`);
        await applyDevicePage(dKey);
      }
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_SET_ACTIVE, async (_event, id: string) => {
    const success = await profileManager.setActiveProfile(id);
    if (success) {
      appMonitor?.notifyManualSwitch();
      broadcastProfileChanged(profileManager);
      broadcastPageChanged(profileManager);
      await applyCurrentPage();
    }
    return success;
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_CREATE, async (_event, name: string) => {
    const profile = await profileManager.createProfile(name);
    broadcastProfileChanged(profileManager);
    return profile;
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_DELETE, async (_event, id: string) => {
    const wasActive = profileManager.getActiveProfile()?.id === id;
    const success = await profileManager.deleteProfile(id);
    if (success) {
      broadcastProfileChanged(profileManager);
      if (wasActive) {
        broadcastPageChanged(profileManager);
        await applyCurrentPage();
      }
    }
    return success;
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_RENAME, async (_event, id: string, newName: string) => {
    const success = await profileManager.renameProfile(id, newName);
    if (success) {
      broadcastProfileChanged(profileManager);
    }
    return success;
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_EXPORT, async (_event, id: string) => {
    const profile = profileManager.getProfile(id);
    if (!profile) return { success: false, error: 'Profile not found' };

    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(focusedWindow ?? BrowserWindow.getAllWindows()[0], {
      title: 'Export Profile',
      defaultPath: `${profile.name.replace(/[^a-zA-Z0-9_\- ]/g, '')}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (result.canceled || !result.filePath) return { success: false };

    try {
      const exportData = {
        format: 'catalyst-stream-controller-profile',
        version: 1,
        exportedAt: new Date().toISOString(),
        profile: structuredClone(profile)
      };
      await fs.writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8');
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle(IPC_CHANNELS.PROFILE_IMPORT, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWindow ?? BrowserWindow.getAllWindows()[0], {
      title: 'Import Profile',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile', 'multiSelections']
    });

    if (result.canceled || result.filePaths.length === 0) return { success: false };

    const imported: string[] = [];
    const errors: string[] = [];

    for (const filePath of result.filePaths) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(raw);

        if (!data.profile || data.format !== 'catalyst-stream-controller-profile') {
          errors.push(`${path.basename(filePath)}: Invalid profile format`);
          continue;
        }

        const profile = await profileManager.importProfile(data.profile);
        imported.push(profile.name);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${path.basename(filePath)}: ${msg}`);
      }
    }

    if (imported.length > 0) {
      broadcastProfileChanged(profileManager);
    }

    return {
      success: imported.length > 0,
      imported,
      errors: errors.length > 0 ? errors : undefined
    };
  });

  // ─── Page handlers ─────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PAGE_GET_STATE, () => {
    return profileManager.getNavigationState();
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_NAVIGATE, async (_event, pageId: string) => {
    const state = profileManager.navigateToPage(pageId);
    if (state) {
      broadcastPageChanged(profileManager);
      await applyCurrentPage();
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_NAVIGATE_BACK, async () => {
    const state = profileManager.navigateBack();
    if (state) {
      broadcastPageChanged(profileManager);
      await applyCurrentPage();
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_NAVIGATE_ROOT, async () => {
    const state = profileManager.navigateToRoot();
    if (state) {
      broadcastPageChanged(profileManager);
      await applyCurrentPage();
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_CREATE, async (_event, name: string, deviceKey?: string) => {
    const page = await profileManager.createPage(name, deviceKey);
    if (page) {
      broadcastProfileChanged(profileManager);
    }
    return page;
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_DELETE, async (_event, pageId: string, deviceKey?: string) => {
    const wasCurrentPage = deviceKey
      ? profileManager.getDeviceCurrentPageId(deviceKey) === pageId
      : profileManager.getCurrentPageId() === pageId;
    const success = await profileManager.deletePage(pageId, deviceKey);
    if (success) {
      broadcastProfileChanged(profileManager);
      if (wasCurrentPage) {
        if (deviceKey) {
          broadcastDevicePageChanged(profileManager, deviceKey);
          await applyDevicePage(deviceKey);
        } else {
          broadcastPageChanged(profileManager);
          await applyCurrentPage();
        }
      }
    }
    return success;
  });

  ipcMain.handle(IPC_CHANNELS.PAGE_RENAME, async (_event, pageId: string, newName: string, deviceKey?: string) => {
    const success = await profileManager.renamePage(pageId, newName, deviceKey);
    if (success) {
      broadcastProfileChanged(profileManager);
      if (deviceKey) {
        broadcastDevicePageChanged(profileManager, deviceKey);
      } else {
        broadcastPageChanged(profileManager);
      }
    }
    return success;
  });

  // ─── Per-Device Profile / Page handlers ──────────────────────

  ipcMain.handle(IPC_CHANNELS.DEVICE_GET_ACTIVE_PROFILE, (_event, deviceKey: string) => {
    return profileManager.getDeviceProfileId(deviceKey);
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_SET_ACTIVE_PROFILE, async (_event, deviceKey: string, profileId: string) => {
    const success = await profileManager.setDeviceProfile(deviceKey, profileId);
    if (success) {
      broadcastProfileChanged(profileManager);
      broadcastDevicePageChanged(profileManager, deviceKey);
      await applyDevicePage(deviceKey);
    }
    return success;
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_PAGE_GET_STATE, (_event, deviceKey: string) => {
    return profileManager.getDeviceNavigationState(deviceKey);
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE, async (_event, deviceKey: string, pageId: string) => {
    const state = profileManager.navigateDeviceToPage(deviceKey, pageId);
    if (state) {
      broadcastDevicePageChanged(profileManager, deviceKey);
      await applyDevicePage(deviceKey);
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE_BACK, async (_event, deviceKey: string) => {
    const state = profileManager.navigateDeviceBack(deviceKey);
    if (state) {
      broadcastDevicePageChanged(profileManager, deviceKey);
      await applyDevicePage(deviceKey);
    }
    return state;
  });

  ipcMain.handle(IPC_CHANNELS.DEVICE_PAGE_NAVIGATE_ROOT, async (_event, deviceKey: string) => {
    const state = profileManager.navigateDeviceToRoot(deviceKey);
    if (state) {
      broadcastDevicePageChanged(profileManager, deviceKey);
      await applyDevicePage(deviceKey);
    }
    return state;
  });

  // ─── Image handlers ─────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.PICK_IMAGE, async () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(focusedWindow ?? BrowserWindow.getAllWindows()[0], {
      title: 'Choose Button Image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'ico'] }],
      properties: ['openFile']
    });

    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mimeMap: Record<string, string> = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      svg: 'image/svg+xml',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      ico: 'image/x-icon'
    };
    const mime = mimeMap[ext] || 'image/png';
    const data = await fs.readFile(filePath);
    const dataUri = `data:${mime};base64,${data.toString('base64')}`;
    return dataUri;
  });

  // ─── Action handlers ───────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.INTERACTION_GET_SETTINGS, () => {
    return profileManager.getInteractionSettings();
  });

  ipcMain.handle(IPC_CHANNELS.INTERACTION_SET_SETTINGS, async (_event, settings: InteractionSettings) => {
    await profileManager.setInteractionSettings(settings);
    if (onInteractionSettingsChanged) onInteractionSettingsChanged(settings);
  });

  ipcMain.handle(IPC_CHANNELS.ACTION_EXECUTE, async (_event, actionId: string) => {
    // Look up the action from all device pages by scanning bindings for matching id
    // Try global active page first, then all per-device pages
    const pages: (Page | null)[] = [profileManager.getCurrentPage()];
    for (const device of deviceManager.getAllDevices()) {
      const dKey = device.getInfo().serial || device.getInfo().id;
      pages.push(profileManager.getDeviceCurrentPage(dKey));
    }

    for (const page of pages) {
      if (!page) continue;
      for (const binding of Object.values(page.bindings)) {
        const triggers = ['press', 'longPress', 'doubleTap', 'down', 'up'] as const;
        for (const trigger of triggers) {
          const action = binding[trigger];
          if (action && action.id === actionId && action.type !== 'none') {
            await actionExecutor.execute(action);
            return;
          }
        }
      }
    }
  });

  // ─── App Switching handlers ───────────────────────────────

  ipcMain.handle(IPC_CHANNELS.APP_SWITCH_GET_SETTINGS, () => {
    return profileManager.getAppSwitchSettings();
  });

  ipcMain.handle(IPC_CHANNELS.APP_SWITCH_SET_SETTINGS, async (_event, settings: AppSwitchSettings) => {
    await profileManager.setAppSwitchSettings(settings);
    if (appMonitor) {
      await appMonitor.updateSettings(settings);
    }
  });

  ipcMain.handle(IPC_CHANNELS.APP_SWITCH_GET_CURRENT_APP, async () => {
    return (await appMonitor?.getCurrentApp()) ?? null;
  });

  ipcMain.handle(IPC_CHANNELS.APP_SWITCH_GET_DETECTION_METHOD, async () => {
    const app = await appMonitor?.getCurrentApp();
    return app?.detectionMethod ?? null;
  });

  // ─── Logging handlers ──────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.LOG_GET_ENTRIES, () => {
    return logCollector?.getEntries() ?? [];
  });

  ipcMain.handle(IPC_CHANNELS.LOG_CLEAR, () => {
    logCollector?.clear();
  });

  // ─── Virtual Device handlers ───────────────────────────────

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_GET_CONFIGS, () => {
    return virtualDriver?.getConfigs() ?? [];
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_CREATE, async (_event, config: VirtualDeviceConfig) => {
    if (!virtualDriver) throw new Error('Virtual device driver not available');
    const device = await virtualDriver.createDevice(config);

    // Mark this device as freshly created so the device-connected handler
    // does NOT paint the active profile onto it (new decks start blank).
    freshlyCreatedVirtualIds?.add(device.getInfo().id);

    deviceManager.registerDevice(device, virtualDriver);

    // Forward key-image events to all renderer windows
    device.on('key-image', (data: { keyIndex: number; dataUri: string }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_IMAGE, {
          deviceId: config.id,
          ...data
        });
      }
    });

    return device.getInfo();
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_UPDATE, async (_event, config: VirtualDeviceConfig) => {
    if (!virtualDriver) throw new Error('Virtual device driver not available');
    const device = await virtualDriver.updateDevice(config);
    deviceManager.registerDevice(device, virtualDriver);

    // Forward key-image events
    device.on('key-image', (data: { keyIndex: number; dataUri: string }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_IMAGE, {
          deviceId: config.id,
          ...data
        });
      }
    });

    return device.getInfo();
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_DELETE, async (_event, deviceId: string) => {
    if (!virtualDriver) throw new Error('Virtual device driver not available');
    await virtualDriver.deleteDevice(deviceId);
  });

  // Virtual device interaction injection (renderer → main)

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_DOWN, (_event, deviceId: string, buttonIndex: number) => {
    const device = virtualDriver?.getDevice(deviceId);
    device?.injectKeyDown(buttonIndex);
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_UP, (_event, deviceId: string, buttonIndex: number) => {
    const device = virtualDriver?.getDevice(deviceId);
    device?.injectKeyUp(buttonIndex);
  });

  ipcMain.handle(
    IPC_CHANNELS.VIRTUAL_DEVICE_ENCODER_ROTATE,
    (_event, deviceId: string, knobId: string, delta: number) => {
      const device = virtualDriver?.getDevice(deviceId);
      device?.injectEncoderRotate(knobId, delta);
    }
  );

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_ENCODER_PRESS, (_event, deviceId: string, knobId: string) => {
    const device = virtualDriver?.getDevice(deviceId);
    device?.injectEncoderPress(knobId);
  });

  ipcMain.handle(
    IPC_CHANNELS.VIRTUAL_DEVICE_SLIDER_CHANGE,
    (_event, deviceId: string, sliderId: string, value: number) => {
      const device = virtualDriver?.getDevice(deviceId);
      device?.injectSliderChange(sliderId, value);
    }
  );

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_GET_KEY_IMAGES, (_event, deviceId: string) => {
    const device = virtualDriver?.getDevice(deviceId);
    if (!device) return {};
    const images = device.getAllKeyImages();
    const result: Record<number, string> = {};
    for (const [key, value] of images) {
      result[key] = value;
    }
    return result;
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DEVICE_GET_SLIDER_VALUES, (_event, deviceId: string) => {
    const device = virtualDriver?.getDevice(deviceId);
    return device?.getAllSliderValues() ?? {};
  });

  // ─── Virtual Deck Window handlers ──────────────────────────

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DECK_OPEN, (_event, deviceId: string) => {
    virtualDeckCallbacks?.open(deviceId);
  });

  ipcMain.handle(IPC_CHANNELS.VIRTUAL_DECK_CLOSE, (_event, deviceId: string) => {
    virtualDeckCallbacks?.close(deviceId);
  });

  // ─── Web Companion Server handlers ─────────────────────────

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_START, async (_event, port?: number) => {
    if (!webServer) throw new Error('Web companion server not available');
    await webServer.start(port);
    return webServer.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_STOP, async () => {
    if (!webServer) throw new Error('Web companion server not available');
    await webServer.stop();
    return webServer.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_GET_STATUS, () => {
    return webServer?.getStatus() ?? { running: false, port: 9120, url: null, connectedClients: 0, pin: '0000' };
  });

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_SET_PIN, (_event, pin: string) => {
    if (!webServer) throw new Error('Web companion server not available');
    webServer.setPin(pin);
    return webServer.getStatus();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_SET_PORT, (_event, port: number) => {
    // Only allowed when server is stopped
    if (webServer?.isRunning()) {
      throw new Error('Cannot change port while server is running');
    }
    // Port will be used on next start — store it via the getter/setter pattern
    // For now, we pass it when calling start()
    return { port };
  });

  ipcMain.handle(IPC_CHANNELS.WEB_SERVER_GET_QR_CODE, async () => {
    if (!webServer) return null;
    return await webServer.getQrCode();
  });
}
