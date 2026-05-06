import { app, BrowserWindow, Menu, Tray, nativeImage, powerMonitor } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { DeviceManager } from './devices/DeviceManager';
import { ProfileManager } from './profiles/ProfileManager';
import { ActionExecutor } from './actions/ActionExecutor';
import { ButtonInteractionManager } from './devices/ButtonInteractionManager';
import { registerIpcHandlers } from './ipc/handlers';
import { ForegroundAppMonitor } from './integrations/ForegroundAppMonitor';
import { LogCollector } from './logging/LogCollector';
import { PluginRegistry } from './plugins/PluginRegistry';
import { PluginStoreClient } from './plugins/PluginStoreClient';
import { PluginInstaller } from './plugins/PluginInstaller';
import { loadExternalPlugins } from './plugins/PluginLoader';
import { obsPlugin } from '../plugins/obs';
import { discordPlugin } from '../plugins/discord';
import { twitchPlugin } from '../plugins/twitch';
import { youtubePlugin } from '../plugins/youtube';
import { huePlugin } from '../plugins/hue';
import { midiPlugin } from '../plugins/midi';
import { VirtualDriver } from './devices/virtual/VirtualDriver';
import { VirtualWebServer } from './devices/virtual/VirtualWebServer';
import type * as CanvasModule from 'canvas';
import type {
  ButtonAppearance,
  ButtonBinding,
  ActionConfig,
  InteractionSettings,
  TriggerType,
  KnobBinding
} from '../shared/types';
import type { ManagedDevice } from './devices/types';
import { IPC_CHANNELS, createDefaultAppearance } from '../shared/types';
import { hasPluginLayer } from '../shared/appearance-helpers';
import { renderKey } from './rendering/KeyRenderer';
import appIconSvg from './assets/app-icon.svg?raw';

// Suppress harmless Chromium GPU errors
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Start log collection immediately so all subsystem logs are captured
const logCollector = new LogCollector();

// Cached app icon — set during app.ready, used in createWindow
let cachedAppIcon: Electron.NativeImage | undefined;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Catch uncaught exceptions (e.g. socket hang up from device lib) so they don't crash the app
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error.message);
  // Don't exit — device connection errors are recoverable
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let deviceManager: DeviceManager | null = null;
let profileManager: ProfileManager | null = null;
let actionExecutor: ActionExecutor | null = null;
let interactionManager: ButtonInteractionManager | null = null;
let appMonitor: ForegroundAppMonitor | null = null;
let pluginRegistry: PluginRegistry | null = null;
let virtualDriver: VirtualDriver | null = null;
let webServer: VirtualWebServer | null = null;

/** Open virtual deck windows, keyed by virtual device ID */
const virtualDeckWindows = new Map<string, BrowserWindow>();

/** Open (or focus) a virtual deck window for the given device ID */
function openVirtualDeckWindow(deviceId: string): void {
  // Focus if already open
  const existing = virtualDeckWindows.get(deviceId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const config = virtualDriver?.getConfig(deviceId);
  const title = config ? `Virtual Deck — ${config.name}` : 'Virtual Deck';

  // Size the window based on the device grid
  const cols = config?.columns ?? 5;
  const rows = config?.rows ?? 3;
  const cellSize = 100;
  const padding = 40;
  const width = Math.max(400, cols * cellSize + padding * 2);
  const height = Math.max(300, rows * cellSize + padding * 2 + 60);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: 300,
    minHeight: 200,
    title,
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const hash = `#virtual-deck/${deviceId}`;
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    win.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}${hash}`);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { hash });
  }

  virtualDeckWindows.set(deviceId, win);

  win.on('closed', () => {
    virtualDeckWindows.delete(deviceId);
  });
}

/** Render an SVG string to a nativeImage at the requested pixel size via node-canvas. */
async function svgToNativeImage(svg: string, size: number): Promise<Electron.NativeImage> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const canvasMod: typeof CanvasModule = require('canvas');
  const { createCanvas, loadImage } = canvasMod;

  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const img = await loadImage(svgDataUrl);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const pngBuffer = canvas.toBuffer('image/png');
  return nativeImage.createFromBuffer(pngBuffer, { width: size, height: size });
}

/** Render the app icon SVG at tray size.
 *  macOS menu bar expects ~22pt (44px for Retina 2×).
 *  Linux/Windows system trays typically use 24–32px icons. */
async function createTrayImage(): Promise<Electron.NativeImage> {
  const size = process.platform === 'darwin' ? 44 : 32;
  return svgToNativeImage(appIconSvg, size);
}

/** Show (or re-create) the main application window */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

/** Create a system tray icon with Open / Quit options */
async function createTray(): Promise<void> {
  const icon = await createTrayImage();
  tray = new Tray(icon);
  tray.setToolTip('Catalyst Stream Controller');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Window', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);

  tray.on('double-click', showMainWindow);
}

/** Close a virtual deck window */
function closeVirtualDeckWindow(deviceId: string): void {
  const win = virtualDeckWindows.get(deviceId);
  if (win && !win.isDestroyed()) {
    win.close();
  }
  virtualDeckWindows.delete(deviceId);
}

/** Wire key-image events from a virtual device to all renderer windows */
function wireVirtualDeviceKeyImageForwarding(deviceId: string): void {
  if (!virtualDriver) return;
  const device = virtualDriver.getDevice(deviceId);
  if (!device) return;
  device.on('key-image', (data: { keyIndex: number; dataUri: string }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.VIRTUAL_DEVICE_KEY_IMAGE, {
          deviceId,
          ...data
        });
      }
    }
  });
}

const createWindow = () => {
  // Use the rendered app icon for the window (visible on Linux/Windows taskbars)
  const appIcon = cachedAppIcon;

  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0f0f14',
    title: 'Catalyst Stream Controller',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load the renderer
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // // Open DevTools in development
  // if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  //   mainWindow.webContents.openDevTools();
  // }

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.isQuitting = false;

/** Build a ButtonAppearance from a ButtonBinding.
 *  Reads from binding.appearance (the canonical source).
 *  Defensive: if appearance exists but lacks .layers (old format), fall back to default. */
function bindingToAppearance(binding: ButtonBinding | undefined): ButtonAppearance {
  if (binding?.appearance?.layers?.length) {
    return binding.appearance;
  }
  // Default empty appearance for unconfigured keys or malformed appearances
  return createDefaultAppearance();
}

/** Get a stable device key for per-device profile assignment.
 *  Prefers the device serial (persists across reconnects), falls back to its ID. */
function deviceKey(dm: DeviceManager, deviceId: string): string {
  const device = dm.getDevice(deviceId);
  return device?.getInfo().serial || deviceId;
}

/** Push all key images from the assigned profile & page to a single device.
 *  Also sends rendered preview images tagged with the device key.
 *  When `previewOnly` is true, only send previews to the renderer — skip physical device draws. */
async function applyPageToSingleDevice(
  dm: DeviceManager,
  pm: ProfileManager,
  device: ManagedDevice,
  pr?: PluginRegistry | null,
  previewOnly = false
): Promise<void> {
  const dKey = device.getInfo().serial || device.getInfo().id;
  pm.initDeviceNavigation(dKey);
  const page = pm.getDeviceCurrentPage(dKey);
  const profile = pm.getDeviceProfile(dKey);
  if (!page || !profile) return;

  const info = device.getInfo();
  const devKeys = info.rows * info.cols;

  console.log(
    `[Main] ${previewOnly ? 'Pushing previews' : 'Applying page'} "${page.name}" (profile "${profile.name}") to ${info.name} [${dKey}] (${devKeys} keys)`
  );

  for (let i = 0; i < devKeys; i++) {
    const binding = page.bindings[i];
    const appearance = bindingToAppearance(binding);

    let pluginImageDataUri: string | undefined;
    if (pr && hasPluginLayer(appearance)) {
      const pluginImage = pr.getPluginImage(i);
      if (pluginImage) pluginImageDataUri = pluginImage.dataUri;
    }

    if (!previewOnly) {
      try {
        await device.drawKey(i, appearance, pluginImageDataUri);
      } catch {
        // Ignore draw errors during bulk paint
      }
    }
  }

  // Send rendered preview images to the renderer process, tagged with device key
  const previewKeySize = info.keySize ?? 96;
  for (let i = 0; i < devKeys; i++) {
    const binding = page.bindings[i];
    if (!binding) {
      mainWindow?.webContents.send(IPC_CHANNELS.KEY_PREVIEW_UPDATE, { keyIndex: i, dataUri: null, deviceKey: dKey });
      continue;
    }

    const appearance = bindingToAppearance(binding);
    let pluginImageDataUri: string | undefined;
    if (pr && hasPluginLayer(appearance)) {
      const pluginImage = pr.getPluginImage(i);
      if (pluginImage) pluginImageDataUri = pluginImage.dataUri;
    }

    try {
      const previewInsetZero = { top: 0, bottom: 0, left: 0, right: 0 };
      const dataUri = await renderKey(appearance, previewInsetZero, previewKeySize, previewKeySize, pluginImageDataUri);
      mainWindow?.webContents.send(IPC_CHANNELS.KEY_PREVIEW_UPDATE, { keyIndex: i, dataUri, deviceKey: dKey });
    } catch {
      // Ignore render errors during bulk preview
    }
  }
}

/** Apply the assigned page to ALL connected devices. */
async function applyAllDevicePages(dm: DeviceManager, pm: ProfileManager, pr?: PluginRegistry | null): Promise<void> {
  for (const device of dm.getAllDevices()) {
    await applyPageToSingleDevice(dm, pm, device, pr);
  }
}

/** Push only preview images (no physical device draws) for ALL connected devices. */
async function pushAllDevicePreviews(dm: DeviceManager, pm: ProfileManager, pr?: PluginRegistry | null): Promise<void> {
  for (const device of dm.getAllDevices()) {
    await applyPageToSingleDevice(dm, pm, device, pr, true);
  }
}

/** Legacy wrapper: Push all key images from the current page of the active profile to connected device(s).
 *  If a specific device is provided, only update that device.
 *  Otherwise, update all connected devices.
 *  Also sends rendered preview images to the renderer process. */
async function applyCurrentPageToDevice(
  dm: DeviceManager,
  pm: ProfileManager,
  targetDevice?: ManagedDevice
): Promise<void> {
  if (targetDevice) {
    await applyPageToSingleDevice(dm, pm, targetDevice, pluginRegistry);
    return;
  }
  await applyAllDevicePages(dm, pm, pluginRegistry);
}

app.on('ready', async () => {
  console.log('[Main] App ready — initializing...');

  // Set the application icon from the SVG source.  In packaged builds the icon
  // comes from the .icns/.ico bundled by Electron Forge, but during development
  // the Dock/taskbar shows the generic Electron icon unless we set it here.
  try {
    const appIcon = await svgToNativeImage(appIconSvg, 512);
    if (process.platform === 'darwin') {
      app.dock?.setIcon(appIcon);
    }
    // The BrowserWindow icon is set in createWindow via this reference
    cachedAppIcon = appIcon;
  } catch (err) {
    console.warn('[Main] Failed to render app icon:', err);
  }

  // Initialize managers
  profileManager = new ProfileManager();
  await profileManager.init();

  deviceManager = new DeviceManager();

  // Initialize virtual device driver and register with device manager
  virtualDriver = new VirtualDriver();
  await virtualDriver.load();
  deviceManager.registerDriver(virtualDriver);

  // Initialize web companion server (does not start until user enables it)
  webServer = new VirtualWebServer(virtualDriver);
  webServer.on('status-changed', (status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.WEB_SERVER_STATUS_CHANGED, status);
      }
    }
  });

  actionExecutor = new ActionExecutor();

  // ─── Reapply a single key ────────────────────────────────
  // Rebuilds the appearance from the current page binding, composites
  // any plugin runtime image, and sends to all devices + renderer preview.
  // Per-key coalescing and USB serialization happen inside the device
  // driver's draw queue, so rapid calls here are safe — stale frames
  // are automatically dropped.
  async function reapplyKey(keyIndex: number, _deviceSerial?: string): Promise<void> {
    if (!deviceManager || !profileManager || !pluginRegistry) return;

    // Reapply to every device (each may have a different page/profile)
    for (const device of deviceManager.getAllDevices()) {
      const dKey = device.getInfo().serial || device.getInfo().id;
      profileManager.initDeviceNavigation(dKey);
      const page = profileManager.getDeviceCurrentPage(dKey);
      if (!page) continue;
      const binding = page.bindings[keyIndex];
      const appearance = bindingToAppearance(binding);

      let pluginImageDataUri: string | undefined;
      if (hasPluginLayer(appearance)) {
        const pluginImage = pluginRegistry.getPluginImage(keyIndex);
        if (pluginImage) pluginImageDataUri = pluginImage.dataUri;
      }

      try {
        await device.drawKey(keyIndex, appearance, pluginImageDataUri);
      } catch {
        // Ignore draw errors
      }

      // Send rendered preview to the renderer process (zero insets — UI preview fills the cell)
      try {
        const keySize = device.getInfo().keySize ?? 96;
        const previewInsets = { top: 0, bottom: 0, left: 0, right: 0 };
        const dataUri = await renderKey(appearance, previewInsets, keySize, keySize, pluginImageDataUri);
        mainWindow?.webContents.send(IPC_CHANNELS.KEY_PREVIEW_UPDATE, { keyIndex, dataUri, deviceKey: dKey });
      } catch {
        // Ignore preview render errors
      }
    }
  }

  // Initialize plugin registry
  pluginRegistry = new PluginRegistry({
    deviceManager,
    profileManager,
    actionExecutor,
    reapplyKey
  });
  pluginRegistry.wireIPC();
  actionExecutor.setPluginRegistry(pluginRegistry);

  // Register built-in plugins
  pluginRegistry.registerPlugin(obsPlugin.manifest, obsPlugin.createClient, 'built-in');
  pluginRegistry.registerPlugin(discordPlugin.manifest, discordPlugin.createClient, 'built-in');
  pluginRegistry.registerPlugin(twitchPlugin.manifest, twitchPlugin.createClient, 'built-in');
  pluginRegistry.registerPlugin(youtubePlugin.manifest, youtubePlugin.createClient, 'built-in');
  pluginRegistry.registerPlugin(huePlugin.manifest, huePlugin.createClient, 'built-in');
  pluginRegistry.registerPlugin(midiPlugin.manifest, midiPlugin.createClient, 'built-in');

  // Set up plugin store & installer for external plugins
  const pluginStoreClient = new PluginStoreClient();
  const pluginInstaller = new PluginInstaller(pluginStoreClient);
  pluginRegistry.setInstaller(pluginInstaller, pluginStoreClient);

  // Load external plugins from {userData}/plugins/
  loadExternalPlugins()
    .then((result) => {
      if (!pluginRegistry) return;
      for (const loaded of result.loaded) {
        pluginRegistry.registerPlugin(loaded.manifest, loaded.createClient, 'external');
      }
      for (const err of result.errors) {
        console.warn(`[Main] Failed to load external plugin at ${err.pluginDir}: ${err.error}`);
      }
      if (result.loaded.length > 0) {
        console.log(`[Main] Loaded ${result.loaded.length} external plugin(s)`);
      }
    })
    .catch((err) => {
      console.error('[Main] Error loading external plugins:', err);
    });

  /** Broadcast current profile & page state to the renderer */
  function broadcastProfileAndPage(): void {
    if (!profileManager) return;
    const data = profileManager.getData();
    const state = profileManager.getNavigationState();
    mainWindow?.webContents.send(IPC_CHANNELS.PROFILE_CHANGED, data);
    mainWindow?.webContents.send(IPC_CHANNELS.PAGE_CHANGED, state);
  }

  // Initialize foreground app monitor for per-app profile switching
  const appSwitchSettings = profileManager.getAppSwitchSettings();
  appMonitor = new ForegroundAppMonitor();

  // Wire callbacks before enabling (updateSettings may start polling)
  appMonitor.setOnProfileSwitch(async (profileId: string) => {
    if (!profileManager || !deviceManager) return;
    console.log(`[Main] App-switch → switching to profile ${profileId}`);
    profileManager.setActiveProfile(profileId);
    broadcastProfileAndPage();
    await applyCurrentPageToDevice(deviceManager, profileManager);
    updateInteractionHints();
  });

  appMonitor.setOnAppChanged((appInfo) => {
    mainWindow?.webContents.send(IPC_CHANNELS.APP_SWITCH_APP_CHANGED, appInfo);
  });

  // Apply saved settings (will auto-start if enabled)
  await appMonitor.updateSettings(appSwitchSettings);

  // IDs of virtual devices that were just created (not restored from config).
  // We skip painting the active profile onto brand-new virtual decks so they
  // start with a clean slate instead of cloning an existing device's layout.
  const freshlyCreatedVirtualIds = new Set<string>();

  // Register IPC handlers
  registerIpcHandlers(
    deviceManager,
    profileManager,
    actionExecutor,
    async () => {
      if (deviceManager && profileManager) {
        await applyCurrentPageToDevice(deviceManager, profileManager);
        updateInteractionHints();
      }
    },
    async (dKey: string) => {
      if (deviceManager && profileManager) {
        // Find the device by its key (serial or ID)
        for (const device of deviceManager.getAllDevices()) {
          const dk = device.getInfo().serial || device.getInfo().id;
          if (dk === dKey) {
            await applyPageToSingleDevice(deviceManager, profileManager, device, pluginRegistry);
            break;
          }
        }
        updateInteractionHints();
      }
    },
    async () => {
      if (deviceManager && profileManager) {
        await pushAllDevicePreviews(deviceManager, profileManager, pluginRegistry);
      }
    },
    (settings: InteractionSettings) => {
      interactionManager?.setTimings(settings);
    },
    appMonitor,
    logCollector,
    virtualDriver ?? undefined,
    {
      open: openVirtualDeckWindow,
      close: closeVirtualDeckWindow
    },
    webServer ?? undefined,
    freshlyCreatedVirtualIds
  );

  // Auto-connect plugins that have autoConnect enabled
  pluginRegistry.connectAll().catch((err) => {
    console.warn('[Main] Plugin auto-connect errors:', err);
  });

  // Broadcast system wake events to all plugins
  powerMonitor.on('resume', () => {
    console.log('[Main] System resumed from sleep — notifying plugins');
    pluginRegistry?.broadcastSystemWake();
  });

  // Remove the default application menu on Linux and Windows.
  // macOS gets a standard menu bar for free (Edit, Window, etc.) so leave it.
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  // Create the main window
  createWindow();

  // Create a system tray icon so the app can run in the background
  // when the window is closed. The user can re-open from the tray or Dock/taskbar.
  await createTray();

  // Start device discovery
  deviceManager.on('device-connected', async (info) => {
    mainWindow?.webContents.send('device:connected', info);

    // Restore saved calibration insets for this specific device
    if (profileManager) {
      const device = deviceManager!.getDevice(info.id);
      if (device) {
        // Try device-specific calibration first (by serial), then fallback to default
        const serial = info.serial;
        const savedInsets =
          (serial && profileManager.getCalibrationInsets(serial)) || profileManager.getCalibrationInsets('_default');
        if (savedInsets) {
          device.setKeyInsets(savedInsets);
          console.log(
            `[Main] Restored calibration insets for ${info.name} — T:${savedInsets.top} B:${savedInsets.bottom} L:${savedInsets.left} R:${savedInsets.right}`
          );
        }

        // Restore saved brightness for this device
        const savedBrightness =
          (serial && profileManager.getBrightness(serial)) ?? profileManager.getBrightness('_default') ?? 1;
        await device.setBrightness(savedBrightness);
        console.log(`[Main] Restored brightness for ${info.name}: ${Math.round(savedBrightness * 100)}%`);
      }
    }

    // Re-apply the current page's key labels to the newly connected device.
    // Skip for freshly-created virtual decks so they start with a blank canvas.
    if (deviceManager && profileManager) {
      const dKey = info.serial || info.id;

      // Ensure this device has its own profile assignment (auto-creates one if needed)
      await profileManager.ensureDeviceAssignment(dKey, info.name);

      if (freshlyCreatedVirtualIds.has(info.id)) {
        freshlyCreatedVirtualIds.delete(info.id);
        console.log(`[Main] Skipping profile paint for new virtual device ${info.id}`);
      } else {
        const device = deviceManager.getDevice(info.id);
        if (device) {
          await applyCurrentPageToDevice(deviceManager, profileManager, device);
        }
      }
      updateInteractionHints();
    }

    // Wire key-image forwarding for virtual devices so the virtual deck UI receives rendered frames
    if (info.id.startsWith('virtual-')) {
      wireVirtualDeviceKeyImageForwarding(info.id);
      // Also wire web companion forwarding if server is running
      if (webServer?.isRunning()) {
        webServer.wireDeviceListeners(info.id);
      }
    }
  });

  deviceManager.on('device-disconnected', (deviceId) => {
    mainWindow?.webContents.send('device:disconnected', deviceId);
  });

  /** Update the interaction manager's binding hints from all device pages */
  function updateInteractionHints(): void {
    if (!profileManager || !interactionManager || !deviceManager) return;

    const longPressIndices: number[] = [];
    const doubleTapIndices: number[] = [];
    const downIndices: number[] = [];
    const upIndices: number[] = [];

    // Merge hints from all connected devices' pages
    for (const device of deviceManager.getAllDevices()) {
      const dKey = device.getInfo().serial || device.getInfo().id;
      profileManager.initDeviceNavigation(dKey);
      const page = profileManager.getDeviceCurrentPage(dKey);
      if (!page) continue;

      for (const [key, binding] of Object.entries(page.bindings)) {
        const idx = Number(key);
        if (binding.longPress && !longPressIndices.includes(idx)) longPressIndices.push(idx);
        if (binding.doubleTap && !doubleTapIndices.includes(idx)) doubleTapIndices.push(idx);
        if (binding.down && !downIndices.includes(idx)) downIndices.push(idx);
        if (binding.up && !upIndices.includes(idx)) upIndices.push(idx);
      }
    }

    interactionManager.updateBindingHints(longPressIndices, doubleTapIndices, downIndices, upIndices);
  }

  /** Execute a single action (go-to-page, go-to-back, multi-action, or delegate to ActionExecutor) */
  function executeAction(buttonIndex: number, action: ActionConfig, dKey?: string): void {
    if (action.type === 'none') return;

    if (action.type === 'multi-action') {
      const cfg = action.config as Record<string, unknown>;
      const steps = (cfg.steps as Array<{ action: ActionConfig; delayMs?: number }>) ?? [];
      console.log(`[Main] Multi-action: executing ${steps.length} step(s)`);

      // Run steps sequentially with optional delays
      (async () => {
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (!step.action || step.action.type === 'none') continue;
          executeAction(buttonIndex, step.action, dKey);
          // Wait for the configured delay between steps
          const delay = step.delayMs ?? 0;
          if (delay > 0 && i < steps.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      })().catch((err) => {
        console.error(`[Main] Multi-action failed:`, err);
      });
      return;
    }

    if (action.type === 'go-to-page') {
      const config = action.config as Record<string, unknown>;
      const targetPageId = config.pageId as string;
      if (targetPageId && profileManager && deviceManager) {
        if (dKey) {
          const state = profileManager.navigateDeviceToPage(dKey, targetPageId);
          if (state) {
            console.log(`[Main] Device "${dKey}" navigating to page "${targetPageId}" via key ${buttonIndex}`);
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send('page:changed', state);
            }
            interactionManager?.reset();
            updateInteractionHints();
            // Re-apply only this device
            for (const device of deviceManager.getAllDevices()) {
              const dk = device.getInfo().serial || device.getInfo().id;
              if (dk === dKey) {
                applyPageToSingleDevice(deviceManager, profileManager, device, pluginRegistry).catch((err) => {
                  console.error('[Main] Failed to apply page after navigation:', err);
                });
                break;
              }
            }
          }
        } else {
          const state = profileManager.navigateToPage(targetPageId);
          if (state) {
            console.log(`[Main] Navigating to page "${targetPageId}" via key ${buttonIndex}`);
            mainWindow?.webContents.send('page:changed', state);
            interactionManager?.reset();
            updateInteractionHints();
            applyCurrentPageToDevice(deviceManager, profileManager).catch((err) => {
              console.error('[Main] Failed to apply page after navigation:', err);
            });
          }
        }
      }
    } else if (action.type === 'go-to-back') {
      if (profileManager && deviceManager) {
        if (dKey) {
          const state = profileManager.navigateDeviceBack(dKey);
          if (state) {
            console.log(`[Main] Device "${dKey}" navigating back via key ${buttonIndex}`);
            for (const win of BrowserWindow.getAllWindows()) {
              win.webContents.send('page:changed', state);
            }
            interactionManager?.reset();
            updateInteractionHints();
            for (const device of deviceManager.getAllDevices()) {
              const dk = device.getInfo().serial || device.getInfo().id;
              if (dk === dKey) {
                applyPageToSingleDevice(deviceManager, profileManager, device, pluginRegistry).catch((err) => {
                  console.error('[Main] Failed to apply page after back navigation:', err);
                });
                break;
              }
            }
          }
        } else {
          const state = profileManager.navigateBack();
          if (state) {
            console.log(`[Main] Navigating back via key ${buttonIndex}`);
            mainWindow?.webContents.send('page:changed', state);
            interactionManager?.reset();
            updateInteractionHints();
            applyCurrentPageToDevice(deviceManager, profileManager).catch((err) => {
              console.error('[Main] Failed to apply page after back navigation:', err);
            });
          }
        }
      }
    } else if (action.type === 'switch-profile') {
      const config = action.config as Record<string, unknown>;
      const targetProfileId = config.profileId as string;
      if (targetProfileId && profileManager && deviceManager) {
        if (dKey) {
          // Switch profile for this specific device only
          profileManager
            .setDeviceProfile(dKey, targetProfileId)
            .then(async (success) => {
              if (success) {
                console.log(`[Main] Device "${dKey}" switching to profile "${targetProfileId}" via key ${buttonIndex}`);
                appMonitor?.notifyManualSwitch();
                const data = profileManager!.getData();
                for (const win of BrowserWindow.getAllWindows()) {
                  win.webContents.send('profile:changed', data);
                }
                const navState = profileManager!.getDeviceNavigationState(dKey);
                for (const win of BrowserWindow.getAllWindows()) {
                  win.webContents.send('page:changed', navState);
                }
                interactionManager?.reset();
                updateInteractionHints();
                for (const device of deviceManager!.getAllDevices()) {
                  const dk = device.getInfo().serial || device.getInfo().id;
                  if (dk === dKey) {
                    await applyPageToSingleDevice(deviceManager!, profileManager!, device, pluginRegistry);
                    break;
                  }
                }
              }
            })
            .catch((err) => {
              console.error('[Main] Switch-profile failed:', err);
            });
        } else {
          profileManager
            .setActiveProfile(targetProfileId)
            .then(async (success) => {
              if (success) {
                console.log(`[Main] Switching to profile "${targetProfileId}" via key ${buttonIndex}`);
                appMonitor?.notifyManualSwitch();
                const data = profileManager!.getData();
                for (const win of BrowserWindow.getAllWindows()) {
                  win.webContents.send('profile:changed', data);
                }
                const navState = profileManager!.getNavigationState();
                for (const win of BrowserWindow.getAllWindows()) {
                  win.webContents.send('page:changed', navState);
                }
                interactionManager?.reset();
                updateInteractionHints();
                await applyCurrentPageToDevice(deviceManager!, profileManager!);
              }
            })
            .catch((err) => {
              console.error('[Main] Switch-profile failed:', err);
            });
        }
      }
    } else if (action.type === 'set-brightness') {
      const config = action.config as Record<string, unknown>;
      const brightnessPercent = config.brightness as number;
      if (typeof brightnessPercent === 'number' && deviceManager && profileManager) {
        const brightness = Math.max(0, Math.min(1, brightnessPercent / 100));
        console.log(`[Main] Setting brightness to ${brightnessPercent}% via key ${buttonIndex}`);
        (async () => {
          for (const device of deviceManager!.getAllDevices()) {
            await device.setBrightness(brightness);
            const serial = device.getInfo().serial;
            await profileManager!.saveBrightness(brightness, serial || '_default');
          }
          // Notify renderer so the brightness slider updates
          mainWindow?.webContents.send('brightness:changed', brightnessPercent);
        })().catch((err) => {
          console.error('[Main] Set-brightness failed:', err);
        });
      }
    } else {
      actionExecutor!.execute(action, buttonIndex).catch((err) => {
        console.error(`[Main] Action execution failed for key ${buttonIndex}:`, err);
      });
    }
  }

  // Set up button interaction manager
  interactionManager = new ButtonInteractionManager((deviceId: string, buttonIndex: number, trigger: TriggerType) => {
    if (!profileManager || !actionExecutor || !deviceManager) return;

    // Look up this device's own profile and page
    const dKey = deviceKey(deviceManager, deviceId);
    profileManager.initDeviceNavigation(dKey);
    const page = profileManager.getDeviceCurrentPage(dKey);
    if (!page) return;

    const binding = page.bindings[buttonIndex];
    if (!binding) return;

    const action = binding[trigger];
    if (action && action.type !== 'none') {
      executeAction(buttonIndex, action, dKey);
    }
  });

  // Apply saved interaction timing settings
  interactionManager.setTimings(profileManager.getInteractionSettings());

  deviceManager.on('button-down', (event) => {
    mainWindow?.webContents.send('device:button-down', event);
    interactionManager?.handleDown(event.deviceId, event.buttonIndex);
  });

  deviceManager.on('button-up', (event) => {
    mainWindow?.webContents.send('device:button-up', event);
    interactionManager?.handleUp(event.deviceId, event.buttonIndex);
  });

  // Knob rotation — look up the knob binding and execute the appropriate action
  deviceManager.on('knob-rotate', (event) => {
    mainWindow?.webContents.send(IPC_CHANNELS.DEVICE_KNOB_ROTATE, event);

    if (!profileManager || !actionExecutor || !deviceManager) return;
    const dKey = deviceKey(deviceManager, event.deviceId);
    profileManager.initDeviceNavigation(dKey);
    const page = profileManager.getDeviceCurrentPage(dKey);
    if (!page) return;

    const knobBinding: KnobBinding | undefined = page.knobBindings?.[event.knobId];
    if (!knobBinding) return;

    const action = event.delta > 0 ? knobBinding.rotateClockwise : knobBinding.rotateCounterClockwise;
    if (action && action.type !== 'none') {
      console.log(`[Main] Knob ${event.knobId} rotated ${event.delta > 0 ? 'CW' : 'CCW'}`);
      executeAction(-1, action, dKey);
    }
  });

  // Knob press — look up the knob binding and execute the press action
  deviceManager.on('knob-press', (event) => {
    if (!profileManager || !actionExecutor || !deviceManager) return;
    const dKey = deviceKey(deviceManager, event.deviceId);
    profileManager.initDeviceNavigation(dKey);
    const page = profileManager.getDeviceCurrentPage(dKey);
    if (!page) return;

    const knobBinding: KnobBinding | undefined = page.knobBindings?.[event.knobId];
    if (!knobBinding?.press) return;

    console.log(`[Main] Knob ${event.knobId} pressed`);
    executeAction(-1, knobBinding.press, dKey);
  });

  // Attempt to discover and connect to devices
  await deviceManager.discover();
  updateInteractionHints();

  // Start polling for hot-plugged devices
  deviceManager.startPolling();
});

app.on('window-all-closed', () => {
  // Don't quit when all windows are closed — the tray icon keeps the app alive
  // on all platforms. The user can re-open from the tray or quit explicitly.
});

app.on('activate', () => {
  // Re-show or re-create the window when the Dock icon is clicked on macOS
  showMainWindow();
});

app.on('before-quit', (event) => {
  if (app.isQuitting) return; // Already cleaning up — let it proceed
  event.preventDefault();
  app.isQuitting = true;
  console.log('[Main] Shutting down...');

  // Destroy tray icon
  if (tray) {
    tray.destroy();
    tray = null;
  }

  // Synchronous teardown
  interactionManager?.destroy();
  appMonitor?.destroy();
  pluginRegistry?.destroyAll();
  logCollector.destroy();

  // Close all virtual deck windows
  for (const [id] of virtualDeckWindows) {
    closeVirtualDeckWindow(id);
  }

  // Stop web companion server
  if (webServer?.isRunning()) {
    webServer.stop().catch(() => {});
  }

  // Async teardown — stop polling first, then disconnect devices
  const cleanup = async () => {
    try {
      deviceManager?.stopPolling();
      await deviceManager?.disconnectAll();
    } catch (err) {
      console.error('[Main] Cleanup error (ignored):', err);
    }
    // Use app.exit() instead of app.quit() to terminate immediately.
    // app.quit() re-fires before-quit → window-all-closed, and on macOS
    // window-all-closed intentionally does NOT quit (standard keep-alive
    // behaviour), so the app hangs in the Dock with no windows.
    // app.exit() also avoids the native serialport addon's Napi::Error
    // crash by skipping Node.js teardown callbacks.
    app.exit(0);
  };

  cleanup();
});
