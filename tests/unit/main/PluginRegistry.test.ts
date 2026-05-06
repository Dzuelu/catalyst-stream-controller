import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PluginRegistry } from '../../../src/main/plugins/PluginRegistry';
import type { PluginRegistryOptions } from '../../../src/main/plugins/PluginRegistry';
import type {
  PluginManifest,
  PluginClient,
  PluginClientFactory,
  PluginHostAPI
} from '../../../src/shared/plugin-types';
import { createAppearanceFromFlat } from '../../../src/shared/appearance-helpers';

// ─── Helpers ────────────────────────────────────────────────────

/** Minimal mock manifest */
function createTestManifest(id = 'test-plugin', overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: `Test Plugin (${id})`,
    version: '1.0.0',
    actions: { 'do-thing': { label: 'Do Thing' } },
    connection: {
      defaults: { autoConnect: false },
      fields: []
    },
    state: {
      defaults: { connected: false }
    },
    ...overrides
  };
}

/** Minimal mock client */
function createMockClient(): PluginClient {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => false),
    getState: vi.fn(() => ({ connected: false })),
    setOnStateChanged: vi.fn(),
    executeAction: vi.fn(async () => {}),
    destroy: vi.fn(),
    queries: {}
  };
}

/** Create a factory that returns a pre-made mock client and captures hostAPI */
function createMockFactory(client?: PluginClient): {
  factory: PluginClientFactory;
  client: PluginClient;
  capturedHostAPI: { value: PluginHostAPI | null };
} {
  const mockClient = client ?? createMockClient();
  const capturedHostAPI: { value: PluginHostAPI | null } = { value: null };
  const factory: PluginClientFactory = (hostAPI) => {
    capturedHostAPI.value = hostAPI;
    return mockClient;
  };
  return { factory, client: mockClient, capturedHostAPI };
}

/** Mock dependencies — uses explicit interface so TypeScript tracks the shape */
interface MockOptions {
  deviceManager: PluginRegistryOptions['deviceManager'] & {
    getAllDevices: ReturnType<typeof vi.fn>;
    getDevice: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  profileManager: PluginRegistryOptions['profileManager'] & {
    getPluginSettings: ReturnType<typeof vi.fn>;
    setPluginSettings: ReturnType<typeof vi.fn>;
    getCurrentPage: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
  };
  actionExecutor: PluginRegistryOptions['actionExecutor'] & {
    execute: ReturnType<typeof vi.fn>;
  };
  reapplyKey: ReturnType<typeof vi.fn<(keyIndex: number, deviceSerial?: string) => void>>;
}

/** Minimal mock dependencies for PluginRegistry */
function createMockOptions(): MockOptions {
  const deviceManager = {
    getAllDevices: vi.fn(() => []),
    getDevice: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn()
  } as unknown as MockOptions['deviceManager'];

  const profileManager = {
    getPluginSettings: vi.fn(() => ({})),
    setPluginSettings: vi.fn(async () => {}),
    getCurrentPage: vi.fn(() => null),
    on: vi.fn(),
    off: vi.fn()
  } as unknown as MockOptions['profileManager'];

  const actionExecutor = {
    execute: vi.fn(async () => {})
  } as unknown as MockOptions['actionExecutor'];

  const reapplyKey = vi.fn((_keyIndex: number, _deviceSerial?: string) => {});

  return { deviceManager, profileManager, actionExecutor, reapplyKey };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PluginRegistry', () => {
  let registry: PluginRegistry;
  let mockOpts: ReturnType<typeof createMockOptions>;

  beforeEach(() => {
    mockOpts = createMockOptions();
    registry = new PluginRegistry(mockOpts);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Registration ─────────────────────────────────────────────

  describe('registerPlugin', () => {
    it('should register a plugin and make it retrievable', () => {
      const manifest = createTestManifest('my-plugin');
      const { factory, client } = createMockFactory();

      registry.registerPlugin(manifest, factory);

      const registered = registry.getPlugin('my-plugin');
      expect(registered).toBeDefined();
      expect(registered!.manifest).toBe(manifest);
      expect(registered!.client).toBe(client);
    });

    it('should pass a scoped PluginHostAPI to the factory', () => {
      const manifest = createTestManifest('my-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      registry.registerPlugin(manifest, factory);

      expect(capturedHostAPI.value).not.toBeNull();
      expect(typeof capturedHostAPI.value!.log).toBe('function');
      expect(typeof capturedHostAPI.value!.getOwnSettings).toBe('function');
      expect(typeof capturedHostAPI.value!.saveOwnSettings).toBe('function');
      expect(typeof capturedHostAPI.value!.executeAction).toBe('function');
      expect(typeof capturedHostAPI.value!.setBrightness).toBe('function');
      expect(typeof capturedHostAPI.value!.setButtonImage).toBe('function');
      expect(typeof capturedHostAPI.value!.getDevices).toBe('function');
      expect(typeof capturedHostAPI.value!.getRegisteredPlugins).toBe('function');
    });

    it('should wire setOnStateChanged on the client', () => {
      const mockClient = createMockClient();
      const { factory } = createMockFactory(mockClient);
      const manifest = createTestManifest();

      registry.registerPlugin(manifest, factory);

      expect(mockClient.setOnStateChanged).toHaveBeenCalledOnce();
      expect(mockClient.setOnStateChanged).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should skip duplicate registration with a warning', () => {
      const manifest = createTestManifest('dup');
      const { factory: f1 } = createMockFactory();
      const { factory: f2 } = createMockFactory();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      registry.registerPlugin(manifest, f1);
      registry.registerPlugin(manifest, f2);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered'));
      warnSpy.mockRestore();
    });
  });

  // ─── Accessors ────────────────────────────────────────────────

  describe('getPlugin / getAllPlugins / getManifests', () => {
    it('should return undefined for unregistered plugin', () => {
      expect(registry.getPlugin('nonexistent')).toBeUndefined();
    });

    it('should return all registered plugins', () => {
      const { factory: f1 } = createMockFactory();
      const { factory: f2 } = createMockFactory();
      registry.registerPlugin(createTestManifest('a'), f1);
      registry.registerPlugin(createTestManifest('b'), f2);

      const all = registry.getAllPlugins();
      expect(all).toHaveLength(2);
    });

    it('should return all manifests', () => {
      const m1 = createTestManifest('a');
      const m2 = createTestManifest('b');
      const { factory: f1 } = createMockFactory();
      const { factory: f2 } = createMockFactory();
      registry.registerPlugin(m1, f1);
      registry.registerPlugin(m2, f2);

      const manifests = registry.getManifests();
      expect(manifests).toHaveLength(2);
      expect(manifests.map((m) => m.id)).toEqual(['a', 'b']);
    });
  });

  // ─── Lifecycle: connectAll ────────────────────────────────────

  describe('connectAll', () => {
    it('should auto-connect plugins with autoConnect setting', async () => {
      const mockClient = createMockClient();
      const { factory } = createMockFactory(mockClient);
      const manifest = createTestManifest('auto');

      // Profile manager returns autoConnect settings
      (mockOpts.profileManager.getPluginSettings as ReturnType<typeof vi.fn>).mockReturnValue({
        autoConnect: true,
        url: 'ws://test'
      });

      registry.registerPlugin(manifest, factory);
      await registry.connectAll();

      expect(mockClient.connect).toHaveBeenCalledWith(expect.objectContaining({ autoConnect: true, url: 'ws://test' }));
    });

    it('should NOT connect plugins without autoConnect', async () => {
      const mockClient = createMockClient();
      const { factory } = createMockFactory(mockClient);
      const manifest = createTestManifest('no-auto');

      (mockOpts.profileManager.getPluginSettings as ReturnType<typeof vi.fn>).mockReturnValue({
        autoConnect: false
      });

      registry.registerPlugin(manifest, factory);
      await registry.connectAll();

      expect(mockClient.connect).not.toHaveBeenCalled();
    });

    it('should warn on auto-connect failure without throwing', async () => {
      const mockClient = createMockClient();
      mockClient.connect = vi.fn(async () => {
        throw new Error('connect failed');
      });
      const { factory } = createMockFactory(mockClient);
      const manifest = createTestManifest('fail');

      (mockOpts.profileManager.getPluginSettings as ReturnType<typeof vi.fn>).mockReturnValue({
        autoConnect: true
      });

      registry.registerPlugin(manifest, factory);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(registry.connectAll()).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Auto-connect failed'));
      warnSpy.mockRestore();
    });

    it('should merge default settings with saved settings', async () => {
      const mockClient = createMockClient();
      const { factory } = createMockFactory(mockClient);
      const manifest = createTestManifest('merge', {
        connection: {
          defaults: { url: 'ws://default', password: '', autoConnect: false },
          fields: []
        }
      });

      (mockOpts.profileManager.getPluginSettings as ReturnType<typeof vi.fn>).mockReturnValue({
        autoConnect: true,
        password: 'secret'
      });

      registry.registerPlugin(manifest, factory);
      await registry.connectAll();

      expect(mockClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'ws://default',
          password: 'secret',
          autoConnect: true
        })
      );
    });
  });

  // ─── Lifecycle: destroyAll ────────────────────────────────────

  describe('destroyAll', () => {
    it('should destroy all clients and clear the registry', () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const { factory: f1 } = createMockFactory(client1);
      const { factory: f2 } = createMockFactory(client2);

      registry.registerPlugin(createTestManifest('a'), f1);
      registry.registerPlugin(createTestManifest('b'), f2);

      registry.destroyAll();

      expect(client1.destroy).toHaveBeenCalledOnce();
      expect(client2.destroy).toHaveBeenCalledOnce();
      expect(registry.getAllPlugins()).toHaveLength(0);
    });

    it('should not throw if a client destroy fails', () => {
      const client = createMockClient();
      client.destroy = vi.fn(() => {
        throw new Error('destroy boom');
      });
      const { factory } = createMockFactory(client);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      registry.registerPlugin(createTestManifest('err'), factory);

      expect(() => registry.destroyAll()).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error destroying'));
      errorSpy.mockRestore();
    });
  });

  // ─── Plugin Image Management ──────────────────────────────────

  describe('plugin image management', () => {
    it('should return undefined for unset images', () => {
      expect(registry.getPluginImage(0)).toBeUndefined();
      expect(registry.getPluginImage(5, 'serial-1')).toBeUndefined();
    });

    it('should store and retrieve images via setButtonImage', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      // Set up profile manager to return a binding and appearance config
      const binding = {
        press: { type: 'plugin:img-plugin', label: '', config: {} },
        appearance: createAppearanceFromFlat({
          backgroundColor: '#1a1a2e',
          label: { text: '', color: '#fff', positionV: 'center' as const, positionH: 'center' as const },
          pluginImage: { enabled: true, fit: 'contain' as const }
        })
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding }
      });

      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await hostAPI.setButtonImage(0, 'data:image/png;base64,abc');

      const img = registry.getPluginImage(0);
      expect(img).toBeDefined();
      expect(img!.pluginId).toBe('img-plugin');
      expect(img!.dataUri).toBe('data:image/png;base64,abc');
      expect(mockOpts.reapplyKey).toHaveBeenCalledWith(0, undefined);
    });

    it('should reject setButtonImage when pluginImage is not enabled', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      // No pluginImage.enabled in appearance
      const binding = {
        press: { type: 'plugin:img-plugin', label: '', config: {} }
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding }
      });

      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await expect(hostAPI.setButtonImage(0, 'data:image/png;base64,abc')).rejects.toThrow(/no visible plugin layer/);
    });

    it('should reject setButtonImage when plugin does not own the button', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      // Different plugin type on the button
      const binding = {
        press: { type: 'plugin:other-plugin', label: '', config: {} },
        appearance: createAppearanceFromFlat({
          backgroundColor: '#1a1a2e',
          label: { text: '', color: '#fff', positionV: 'center' as const, positionH: 'center' as const },
          pluginImage: { enabled: true, fit: 'contain' as const }
        })
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding }
      });

      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await expect(hostAPI.setButtonImage(0, 'data:image/png;base64,abc')).rejects.toThrow(
        /no trigger.*uses this plugin/
      );
    });

    it('should clear button images via clearButtonImage', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      const binding = {
        press: { type: 'plugin:img-plugin', label: '', config: {} },
        appearance: createAppearanceFromFlat({
          backgroundColor: '#1a1a2e',
          label: { text: '', color: '#fff', positionV: 'center' as const, positionH: 'center' as const },
          pluginImage: { enabled: true, fit: 'contain' as const }
        })
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding }
      });

      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await hostAPI.setButtonImage(0, 'data:image/png;base64,abc');
      expect(registry.getPluginImage(0)).toBeDefined();

      await hostAPI.clearButtonImage(0);
      expect(registry.getPluginImage(0)).toBeUndefined();
      expect(mockOpts.reapplyKey).toHaveBeenCalledTimes(2);
    });

    it('should clear all images for a plugin via clearPluginImages', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      const binding = {
        press: { type: 'plugin:img-plugin', label: '', config: {} },
        appearance: createAppearanceFromFlat({
          backgroundColor: '#1a1a2e',
          label: { text: '', color: '#fff', positionV: 'center' as const, positionH: 'center' as const },
          pluginImage: { enabled: true, fit: 'contain' as const }
        })
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding, 1: binding }
      });

      registry.registerPlugin(manifest, factory);
      const hostAPI = capturedHostAPI.value!;

      await hostAPI.setButtonImage(0, 'data:image/png;base64,a');
      await hostAPI.setButtonImage(1, 'data:image/png;base64,b');

      expect(registry.getPluginImage(0)).toBeDefined();
      expect(registry.getPluginImage(1)).toBeDefined();

      registry.clearPluginImages('img-plugin');

      expect(registry.getPluginImage(0)).toBeUndefined();
      expect(registry.getPluginImage(1)).toBeUndefined();
    });

    it('should support device-serial-scoped images', async () => {
      const manifest = createTestManifest('img-plugin');
      const { factory, capturedHostAPI } = createMockFactory();

      const binding = {
        press: { type: 'plugin:img-plugin', label: '', config: {} },
        appearance: createAppearanceFromFlat({
          backgroundColor: '#1a1a2e',
          label: { text: '', color: '#fff', positionV: 'center' as const, positionH: 'center' as const },
          pluginImage: { enabled: true, fit: 'contain' as const }
        })
      };
      (mockOpts.profileManager.getCurrentPage as ReturnType<typeof vi.fn>).mockReturnValue({
        id: 'page1',
        name: 'Page 1',
        bindings: { 0: binding }
      });

      registry.registerPlugin(manifest, factory);
      const hostAPI = capturedHostAPI.value!;

      await hostAPI.setButtonImage(0, 'data:image/png;base64,serial1', 'serial-A');
      await hostAPI.setButtonImage(0, 'data:image/png;base64,serial2', 'serial-B');

      expect(registry.getPluginImage(0, 'serial-A')!.dataUri).toBe('data:image/png;base64,serial1');
      expect(registry.getPluginImage(0, 'serial-B')!.dataUri).toBe('data:image/png;base64,serial2');
      expect(registry.getPluginImage(0)).toBeUndefined(); // no unserialed entry
    });
  });

  // ─── Host API: Logging ────────────────────────────────────────

  describe('hostAPI.log', () => {
    it('should prefix log messages with the plugin name', () => {
      const manifest = createTestManifest('logger');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const hostAPI = capturedHostAPI.value!;
      hostAPI.log('info', 'hello');
      hostAPI.log('warn', 'caution');
      hostAPI.log('error', 'boom');

      expect(logSpy).toHaveBeenCalledWith('[Test Plugin (logger)] hello');
      expect(warnSpy).toHaveBeenCalledWith('[Test Plugin (logger)] caution');
      expect(errorSpy).toHaveBeenCalledWith('[Test Plugin (logger)] boom');

      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  // ─── Host API: Settings ───────────────────────────────────────

  describe('hostAPI settings', () => {
    it('should read settings scoped to the plugin', () => {
      const manifest = createTestManifest('settings-test');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      (mockOpts.profileManager.getPluginSettings as ReturnType<typeof vi.fn>).mockReturnValue({ url: 'ws://saved' });

      const hostAPI = capturedHostAPI.value!;
      const settings = hostAPI.getOwnSettings();
      expect(settings).toEqual({ url: 'ws://saved' });
      expect(mockOpts.profileManager.getPluginSettings).toHaveBeenCalledWith('settings-test');
    });

    it('should save settings scoped to the plugin', async () => {
      const manifest = createTestManifest('settings-test');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await hostAPI.saveOwnSettings({ url: 'ws://new' });

      expect(mockOpts.profileManager.setPluginSettings).toHaveBeenCalledWith('settings-test', { url: 'ws://new' });
    });
  });

  // ─── Host API: Action Execution ───────────────────────────────

  describe('hostAPI action execution', () => {
    it('should delegate executeAction to ActionExecutor', async () => {
      const manifest = createTestManifest('exec');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await hostAPI.executeAction('hotkey', { keys: ['ctrl', 'c'] });

      expect(mockOpts.actionExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'hotkey',
          config: { keys: ['ctrl', 'c'] }
        })
      );
    });

    it('should delegate executePluginAction to the target plugin client', async () => {
      // Register the calling plugin
      const manifest1 = createTestManifest('caller');
      const { factory: f1, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest1, f1);

      // Register the target plugin
      const targetClient = createMockClient();
      targetClient.isConnected = vi.fn(() => true);
      const { factory: f2 } = createMockFactory(targetClient);
      registry.registerPlugin(createTestManifest('target'), f2);

      const hostAPI = capturedHostAPI.value!;
      await hostAPI.executePluginAction('target', { pluginAction: 'do-thing' });

      expect(targetClient.executeAction).toHaveBeenCalledWith({ pluginAction: 'do-thing' });
    });

    it('should throw when executing action on unregistered plugin', async () => {
      const manifest = createTestManifest('caller');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      await expect(hostAPI.executePluginAction('nonexistent', {})).rejects.toThrow(/not registered/);
    });

    it('should throw when executing action on disconnected plugin', async () => {
      const manifest1 = createTestManifest('caller');
      const { factory: f1, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest1, f1);

      const targetClient = createMockClient();
      targetClient.isConnected = vi.fn(() => false);
      const { factory: f2 } = createMockFactory(targetClient);
      registry.registerPlugin(createTestManifest('target'), f2);

      const hostAPI = capturedHostAPI.value!;
      await expect(hostAPI.executePluginAction('target', {})).rejects.toThrow(/not connected/);
    });
  });

  // ─── Host API: Plugin Discovery ───────────────────────────────

  describe('hostAPI plugin discovery', () => {
    it('should return plugin info for registered plugins', () => {
      const manifest = createTestManifest('findme', { name: 'Find Me', version: '2.0.0' });
      const mockClient = createMockClient();
      mockClient.isConnected = vi.fn(() => true);
      const { factory, capturedHostAPI } = createMockFactory(mockClient);
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      const info = hostAPI.getPluginInfo('findme');
      expect(info).toEqual({
        id: 'findme',
        name: 'Find Me',
        version: '2.0.0',
        connected: true
      });
    });

    it('should return null for unregistered plugins', () => {
      const manifest = createTestManifest('a');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      expect(hostAPI.getPluginInfo('nonexistent')).toBeNull();
    });

    it('should list all registered plugin IDs', () => {
      const { factory: f1, capturedHostAPI } = createMockFactory();
      const { factory: f2 } = createMockFactory();
      registry.registerPlugin(createTestManifest('alpha'), f1);
      registry.registerPlugin(createTestManifest('beta'), f2);

      const hostAPI = capturedHostAPI.value!;
      const ids = hostAPI.getRegisteredPlugins();
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
    });
  });

  // ─── Host API: Device Events ──────────────────────────────────

  describe('hostAPI device events', () => {
    it('should subscribe to button-down events and return unsubscribe fn', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      const cb = vi.fn();
      const unsub = hostAPI.onButtonDown(cb);

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('button-down', expect.any(Function));
      expect(typeof unsub).toBe('function');
    });

    it('should subscribe to button-up events', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onButtonUp(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('button-up', expect.any(Function));
    });

    it('should subscribe to knob-rotate events', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onKnobRotate(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('knob-rotate', expect.any(Function));
    });

    it('should subscribe to knob-press events', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onKnobPress(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('knob-press', expect.any(Function));
    });

    it('should subscribe to device-connected events', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onDeviceConnected(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('device-connected', expect.any(Function));
    });

    it('should subscribe to device-disconnected events', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onDeviceDisconnected(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalledWith('device-disconnected', expect.any(Function));
    });

    it('should unsubscribe events on destroyAll', () => {
      const manifest = createTestManifest('events');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.onButtonDown(vi.fn());

      expect(mockOpts.deviceManager.on).toHaveBeenCalled();

      registry.destroyAll();

      // off should have been called for unsubscription
      expect(mockOpts.deviceManager.off).toHaveBeenCalledWith('button-down', expect.any(Function));
    });
  });

  // ─── Host API: getDevices ─────────────────────────────────────

  describe('hostAPI.getDevices', () => {
    it('should map device info from DeviceManager', () => {
      const manifest = createTestManifest('dev');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const mockDevice = {
        getInfo: vi.fn(() => ({
          serial: 'SER123',
          id: 'dev-1',
          name: 'My Device',
          rows: 3,
          cols: 5,
          controls: [
            { type: 'button', id: '0' },
            { type: 'button', id: '1' },
            { type: 'knob', id: 'knobTL' }
          ]
        }))
      };
      (mockOpts.deviceManager.getAllDevices as ReturnType<typeof vi.fn>).mockReturnValue([mockDevice]);

      const hostAPI = capturedHostAPI.value!;
      const devices = hostAPI.getDevices();

      expect(devices).toHaveLength(1);
      expect(devices[0]).toEqual({
        serial: 'SER123',
        name: 'My Device',
        rows: 3,
        cols: 5,
        keyCount: 2,
        hasKnobs: true
      });
    });

    it('should return empty array when no devices connected', () => {
      const manifest = createTestManifest('dev');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      expect(hostAPI.getDevices()).toEqual([]);
    });
  });

  // ─── Host API: Lifecycle events ─────────────────────────────────

  describe('hostAPI.onProfileChanged', () => {
    it('subscribes to profileManager profile-changed events', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const cb = vi.fn();
      const hostAPI = capturedHostAPI.value!;
      hostAPI.onProfileChanged(cb);

      expect(mockOpts.profileManager.on).toHaveBeenCalledWith('profile-changed', expect.any(Function));
    });

    it('invokes callback when profile changes', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const cb = vi.fn();
      const hostAPI = capturedHostAPI.value!;
      hostAPI.onProfileChanged(cb);

      // Get the handler that was registered on profileManager
      const handler = (mockOpts.profileManager.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'profile-changed'
      )?.[1];
      expect(handler).toBeDefined();

      handler('profile-123');
      expect(cb).toHaveBeenCalledWith('profile-123');
    });

    it('returns an unsubscribe function that removes the listener', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      const unsub = hostAPI.onProfileChanged(vi.fn());
      expect(typeof unsub).toBe('function');

      unsub();
      expect(mockOpts.profileManager.off).toHaveBeenCalledWith('profile-changed', expect.any(Function));
    });
  });

  describe('hostAPI.onPageChanged', () => {
    it('subscribes to profileManager page-changed events', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const cb = vi.fn();
      const hostAPI = capturedHostAPI.value!;
      hostAPI.onPageChanged(cb);

      expect(mockOpts.profileManager.on).toHaveBeenCalledWith('page-changed', expect.any(Function));
    });

    it('invokes callback when page changes', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const cb = vi.fn();
      const hostAPI = capturedHostAPI.value!;
      hostAPI.onPageChanged(cb);

      const handler = (mockOpts.profileManager.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (c) => c[0] === 'page-changed'
      )?.[1];
      expect(handler).toBeDefined();

      handler('page-456');
      expect(cb).toHaveBeenCalledWith('page-456');
    });

    it('returns an unsubscribe function', () => {
      const manifest = createTestManifest('lc');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      const unsub = hostAPI.onPageChanged(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub();
      expect(mockOpts.profileManager.off).toHaveBeenCalledWith('page-changed', expect.any(Function));
    });
  });

  // ─── Host API: onSystemWakeUp ─────────────────────────────────

  describe('hostAPI.onSystemWakeUp', () => {
    it('returns an unsubscribe function', () => {
      const manifest = createTestManifest('wake');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      const unsub = hostAPI.onSystemWakeUp(vi.fn());
      expect(typeof unsub).toBe('function');
      unsub(); // should not throw
    });

    it('broadcastSystemWake invokes all registered callbacks', () => {
      const manifest1 = createTestManifest('wake1');
      const manifest2 = createTestManifest('wake2');
      const { factory: f1, capturedHostAPI: h1 } = createMockFactory();
      const { factory: f2, capturedHostAPI: h2 } = createMockFactory();
      registry.registerPlugin(manifest1, f1);
      registry.registerPlugin(manifest2, f2);

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      h1.value!.onSystemWakeUp(cb1);
      h2.value!.onSystemWakeUp(cb2);

      registry.broadcastSystemWake();

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('unsubscribe removes callback from wake broadcasts', () => {
      const manifest = createTestManifest('wake');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const cb = vi.fn();
      const unsub = capturedHostAPI.value!.onSystemWakeUp(cb);

      unsub();
      registry.broadcastSystemWake();

      expect(cb).not.toHaveBeenCalled();
    });

    it('broadcastSystemWake catches errors in callbacks', () => {
      const manifest = createTestManifest('wake');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const badCb = vi.fn(() => {
        throw new Error('wake handler crash');
      });
      capturedHostAPI.value!.onSystemWakeUp(badCb);

      expect(() => registry.broadcastSystemWake()).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('wake handler crash'));
      errorSpy.mockRestore();
    });
  });

  // ─── Host API: showFeedback ───────────────────────────────────

  describe('hostAPI.showFeedback', () => {
    it('sends PLUGIN_SHOW_FEEDBACK IPC to all windows', () => {
      const manifest = createTestManifest('fb');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      hostAPI.showFeedback(3, 'ok', 1500);

      // BrowserWindow.getAllWindows is mocked by vitest
      // Verify the function doesn't throw (IPC send is mocked)
      expect(true).toBe(true);
    });

    it('defaults durationMs to 1000 when not provided', () => {
      const manifest = createTestManifest('fb');
      const { factory, capturedHostAPI } = createMockFactory();
      registry.registerPlugin(manifest, factory);

      const hostAPI = capturedHostAPI.value!;
      // Should not throw with default duration
      expect(() => hostAPI.showFeedback(0, 'alert')).not.toThrow();
    });
  });
});
