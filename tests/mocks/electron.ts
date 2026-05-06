import { vi } from 'vitest';

// ── app ───────────────────────────────────────────────────────
export const app = {
  getPath: vi.fn((name: string) => `/mock/${name}`),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
  exit: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  removeListener: vi.fn(),
  isReady: vi.fn(() => true),
  requestSingleInstanceLock: vi.fn(() => true),
  isPackaged: false,
  getName: vi.fn(() => 'Catalyst Stream Controller'),
  getVersion: vi.fn(() => '0.1.0'),
  getAppPath: vi.fn(() => '/mock/app'),
  setLoginItemSettings: vi.fn(),
  dock: {
    hide: vi.fn(),
    show: vi.fn(),
    setBadge: vi.fn()
  }
};

// ── ipcMain ───────────────────────────────────────────────────
const ipcMainHandlers = new Map<string, (...args: unknown[]) => unknown>();
const ipcMainListeners = new Map<string, (...args: unknown[]) => void>();

export const ipcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMainHandlers.set(channel, handler);
  }),
  on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
    ipcMainListeners.set(channel, handler);
  }),
  removeHandler: vi.fn((channel: string) => {
    ipcMainHandlers.delete(channel);
  }),
  removeListener: vi.fn((channel: string) => {
    ipcMainListeners.delete(channel);
  })
};

/** Test helper: invoke a registered ipcMain.handle handler directly */
export function invokeHandler(channel: string, ...args: unknown[]): unknown {
  const handler = ipcMainHandlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  // Simulate the IPC event object as first argument
  return handler({} as unknown, ...args);
}

/** Test helper: get all registered handler channel names */
export function getRegisteredChannels(): string[] {
  return Array.from(ipcMainHandlers.keys());
}

// ── ipcRenderer ───────────────────────────────────────────────
const ipcRendererListeners = new Map<string, Set<(...args: unknown[]) => void>>();

export const ipcRenderer = {
  invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => undefined),
  send: vi.fn(),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!ipcRendererListeners.has(channel)) {
      ipcRendererListeners.set(channel, new Set());
    }
    ipcRendererListeners.get(channel)!.add(listener);
    return ipcRenderer;
  }),
  once: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    if (!ipcRendererListeners.has(channel)) {
      ipcRendererListeners.set(channel, new Set());
    }
    ipcRendererListeners.get(channel)!.add(listener);
    return ipcRenderer;
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcRendererListeners.get(channel)?.delete(listener);
    return ipcRenderer;
  }),
  removeAllListeners: vi.fn((channel: string) => {
    ipcRendererListeners.delete(channel);
    return ipcRenderer;
  })
};

// ── BrowserWindow ─────────────────────────────────────────────
const mockWebContents = {
  send: vi.fn(),
  on: vi.fn(),
  once: vi.fn(),
  openDevTools: vi.fn(),
  closeDevTools: vi.fn(),
  isDevToolsOpened: vi.fn(() => false),
  session: {
    webRequest: {
      onHeadersReceived: vi.fn()
    }
  }
};

const BrowserWindowFactory = vi.fn(() => ({
  webContents: mockWebContents,
  loadURL: vi.fn(() => Promise.resolve()),
  loadFile: vi.fn(() => Promise.resolve()),
  on: vi.fn(),
  once: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  close: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(() => false),
  isVisible: vi.fn(() => true),
  setTitle: vi.fn(),
  setMenu: vi.fn(),
  setIcon: vi.fn(),
  maximize: vi.fn(),
  minimize: vi.fn(),
  restore: vi.fn(),
  isMaximized: vi.fn(() => false),
  isMinimized: vi.fn(() => false),
  setSize: vi.fn(),
  getSize: vi.fn(() => [800, 600]),
  setPosition: vi.fn(),
  getPosition: vi.fn(() => [0, 0]),
  center: vi.fn(),
  setBounds: vi.fn(),
  getBounds: vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }))
}));

// Static methods on BrowserWindow
export const BrowserWindow = Object.assign(BrowserWindowFactory, {
  getAllWindows: vi.fn(() => [] as unknown[]),
  getFocusedWindow: vi.fn(() => null as unknown),
  fromWebContents: vi.fn(() => null as unknown)
});

// ── shell ─────────────────────────────────────────────────────
export const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve(''))
};

// ── dialog ────────────────────────────────────────────────────
export const dialog = {
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
  showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
  showMessageBox: vi.fn(async () => ({ response: 0, checkboxChecked: false })),
  showErrorBox: vi.fn()
};

// ── nativeImage ───────────────────────────────────────────────
const mockNativeImage = {
  toPNG: vi.fn(() => Buffer.from([])),
  toJPEG: vi.fn(() => Buffer.from([])),
  toDataURL: vi.fn(() => 'data:image/png;base64,'),
  getSize: vi.fn(() => ({ width: 0, height: 0 })),
  resize: vi.fn(() => mockNativeImage),
  isEmpty: vi.fn(() => true)
};

export const nativeImage = {
  createFromPath: vi.fn(() => mockNativeImage),
  createFromBuffer: vi.fn(() => mockNativeImage),
  createFromDataURL: vi.fn(() => mockNativeImage),
  createEmpty: vi.fn(() => mockNativeImage)
};

// ── Menu & Tray ───────────────────────────────────────────────
export const Menu = {
  buildFromTemplate: vi.fn(() => ({})),
  setApplicationMenu: vi.fn()
};

export const Tray = vi.fn(() => ({
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
  isDestroyed: vi.fn(() => false),
  setImage: vi.fn()
}));

// ── contextBridge ─────────────────────────────────────────────
export const contextBridge = {
  exposeInMainWorld: vi.fn()
};

// ── Test helpers ──────────────────────────────────────────────

/** Reset all mock state between tests */
export function resetAllElectronMocks(): void {
  ipcMainHandlers.clear();
  ipcMainListeners.clear();
  ipcRendererListeners.clear();
  vi.clearAllMocks();
}
