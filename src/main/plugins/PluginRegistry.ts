/**
 * Plugin Registry — Central orchestrator for the plugin system.
 *
 * Manages plugin lifecycle (register, connect, disconnect, destroy),
 * builds scoped PluginHostAPI instances per plugin, handles generic
 * plugin IPC, and manages runtime plugin image storage.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type { DeviceManager } from '../devices/DeviceManager';
import type { ProfileManager } from '../profiles/ProfileManager';
import type { ActionExecutor } from '../actions/ActionExecutor';
import type { PluginManifest, PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';
import type { PluginInstaller } from './PluginInstaller';
import type { PluginStoreClient } from './PluginStoreClient';
import * as pluginImageHelpers from './PluginImageHelpers';
import { createSandboxedHostAPI, createSandboxedClient } from './PluginSandbox';
import {
  type BuiltinActionType,
  type ButtonAppearance,
  type ButtonBinding,
  type DeviceButtonEvent,
  type DeviceKnobEvent,
  type PluginFeedbackEvent
} from '../../shared/types';
import { IPC_CHANNELS, ALL_TRIGGER_TYPES } from '../../shared/types';
import { hasPluginLayer } from '../../shared/appearance-helpers';

// ─── Types ──────────────────────────────────────────────────────

/** A registered plugin: manifest + live client instance */
export interface RegisteredPlugin {
  manifest: PluginManifest;
  client: PluginClient;
}

/** Runtime plugin image data (not persisted) */
interface PluginImageEntry {
  pluginId: string;
  dataUri: string;
}

/** Dependencies injected into the registry */
export interface PluginRegistryOptions {
  deviceManager: DeviceManager;
  profileManager: ProfileManager;
  actionExecutor: ActionExecutor;
  /** Callback to re-render a single key after plugin image changes */
  reapplyKey: (keyIndex: number, deviceSerial?: string) => void;
}

/** Whether a plugin was loaded from a built-in source or externally */
export type PluginSource = 'built-in' | 'external';

// ─── Registry ───────────────────────────────────────────────────

export class PluginRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  /** Track which plugins are external vs built-in */
  private pluginSources: Map<string, PluginSource> = new Map();
  /** Event subscriptions per plugin — cleaned up on destroy */
  private pluginSubscriptions: Map<string, Array<() => void>> = new Map();
  /** Runtime plugin image data — keyed by 'keyIndex' or 'keyIndex:serial' */
  private pluginImageMap: Map<string, PluginImageEntry> = new Map();

  private deviceManager: DeviceManager;
  private profileManager: ProfileManager;
  private actionExecutor: ActionExecutor;
  private reapplyKeyFn: (keyIndex: number, deviceSerial?: string) => void;
  private installer: PluginInstaller | null = null;
  private storeClient: PluginStoreClient | null = null;
  /** Callbacks for system wake events — shared across all plugins */
  private systemWakeCallbacks: Set<() => void> | null = null;

  constructor(options: PluginRegistryOptions) {
    this.deviceManager = options.deviceManager;
    this.profileManager = options.profileManager;
    this.actionExecutor = options.actionExecutor;
    this.reapplyKeyFn = options.reapplyKey;
  }

  /** Set the plugin installer and store client (created after registry construction) */
  setInstaller(installer: PluginInstaller, storeClient: PluginStoreClient): void {
    this.installer = installer;
    this.storeClient = storeClient;
  }

  // ─── Plugin Registration ────────────────────────────────────

  /** Register a plugin manually (for built-in plugins).
   *  Creates the client via the factory, passing a scoped PluginHostAPI. */
  registerPlugin(manifest: PluginManifest, factory: PluginClientFactory, source: PluginSource = 'built-in'): void {
    if (this.plugins.has(manifest.id)) {
      console.warn(`[PluginRegistry] Plugin "${manifest.id}" is already registered — skipping`);
      return;
    }

    let hostAPI = this.buildHostAPI(manifest.id);

    // Apply sandboxing for external plugins
    if (source === 'external') {
      hostAPI = createSandboxedHostAPI(hostAPI, manifest.id);
    }

    let client = factory(hostAPI);

    // Wrap external plugin client with error boundaries and timeouts
    if (source === 'external') {
      client = createSandboxedClient(client, manifest.id, (level, msg) => {
        const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logFn(`[${manifest.name}] ${msg}`);
      });
    }

    // Wire state change notifications to renderer
    client.setOnStateChanged((state) => {
      const channel = `plugin:state-changed:${manifest.id}`;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, state);
        }
      }
      // Re-render keys that use this plugin (for dynamic images)
      this.reapplyPluginKeys(manifest.id);
    });

    this.plugins.set(manifest.id, { manifest, client });
    this.pluginSources.set(manifest.id, source);
    console.log(
      `[PluginRegistry] Registered ${source} plugin "${manifest.name}" v${manifest.version} (${manifest.id})`
    );
  }

  /** Unregister a plugin by ID. Destroys the client and cleans up. */
  unregisterPlugin(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    try {
      // Unsubscribe all event listeners
      const subs = this.pluginSubscriptions.get(pluginId);
      if (subs) {
        for (const unsub of subs) {
          try {
            unsub();
          } catch {
            /* Ignore */
          }
        }
        this.pluginSubscriptions.delete(pluginId);
      }

      // Clear runtime images
      this.clearPluginImages(pluginId);

      // Destroy client
      plugin.client.destroy();
      console.log(`[PluginRegistry] Unregistered plugin "${plugin.manifest.name}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PluginRegistry] Error unregistering plugin "${pluginId}": ${msg}`);
    }

    this.plugins.delete(pluginId);
    this.pluginSources.delete(pluginId);
  }

  /** Check if a plugin is external (not built-in) */
  isExternalPlugin(pluginId: string): boolean {
    return this.pluginSources.get(pluginId) === 'external';
  }

  /** Get a registered plugin by ID */
  getPlugin(id: string): RegisteredPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Get all registered plugins */
  getAllPlugins(): RegisteredPlugin[] {
    return Array.from(this.plugins.values());
  }

  /** Get all plugin manifests (for renderer) */
  getManifests(): PluginManifest[] {
    return Array.from(this.plugins.values()).map((p) => p.manifest);
  }

  // ─── Plugin Lifecycle ───────────────────────────────────────

  /** Auto-connect all plugins that have saved settings with autoConnect */
  async connectAll(): Promise<void> {
    for (const [pluginId, { manifest, client }] of this.plugins) {
      try {
        const settings = this.profileManager.getPluginSettings(pluginId);
        const defaults = manifest.connection?.defaults ?? {};
        const merged = { ...defaults, ...settings };
        if (merged.autoConnect) {
          console.log(`[PluginRegistry] Auto-connecting plugin "${manifest.name}"...`);
          await client.connect(merged);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[PluginRegistry] Auto-connect failed for "${manifest.name}": ${msg}`);
      }
    }
  }

  /** Destroy all plugins and clean up */
  destroyAll(): void {
    for (const [pluginId, { manifest, client }] of this.plugins) {
      try {
        // Unsubscribe all event listeners
        const subs = this.pluginSubscriptions.get(pluginId);
        if (subs) {
          for (const unsub of subs) {
            try {
              unsub();
            } catch {
              // Ignore
            }
          }
          this.pluginSubscriptions.delete(pluginId);
        }

        // Clear runtime images
        this.clearPluginImages(pluginId);

        // Destroy client
        client.destroy();
        console.log(`[PluginRegistry] Destroyed plugin "${manifest.name}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PluginRegistry] Error destroying plugin "${manifest.name}": ${msg}`);
      }
    }
    this.plugins.clear();
  }

  // ─── Plugin Image Management ────────────────────────────────

  /** Get runtime plugin image for a key (used by key rendering pipeline) */
  getPluginImage(keyIndex: number, deviceSerial?: string): PluginImageEntry | undefined {
    const key = deviceSerial ? `${keyIndex}:${deviceSerial}` : `${keyIndex}`;
    return this.pluginImageMap.get(key);
  }

  /** Clear all runtime images for a specific plugin */
  clearPluginImages(pluginId: string): void {
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.pluginImageMap) {
      if (entry.pluginId === pluginId) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.pluginImageMap.delete(key);
    }
    if (keysToDelete.length > 0) {
      console.log(`[PluginRegistry] Cleared ${keysToDelete.length} runtime image(s) for plugin "${pluginId}"`);
    }
  }

  // ─── IPC Wiring ─────────────────────────────────────────────

  /** Register generic plugin:* IPC handlers */
  wireIPC(): void {
    ipcMain.handle(IPC_CHANNELS.PLUGIN_CONNECT, async (_event, pluginId: string, settings: Record<string, unknown>) => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) return { success: false, error: `Plugin "${pluginId}" not found` };
      try {
        await plugin.client.connect(settings);
        await this.profileManager.setPluginSettings(pluginId, settings);
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg };
      }
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_DISCONNECT, async (_event, pluginId: string) => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) return;
      await plugin.client.disconnect();
      this.clearPluginImages(pluginId);
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_STATE, (_event, pluginId: string) => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) return null;
      return plugin.client.getState();
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_QUERY, async (_event, pluginId: string, queryName: string) => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin?.client.queries?.[queryName]) return [];
      return plugin.client.queries[queryName]();
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_SETTINGS, (_event, pluginId: string) => {
      return this.profileManager.getPluginSettings(pluginId);
    });

    ipcMain.handle(
      IPC_CHANNELS.PLUGIN_SET_SETTINGS,
      async (_event, pluginId: string, settings: Record<string, unknown>) => {
        await this.profileManager.setPluginSettings(pluginId, settings);
      }
    );

    ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_MANIFESTS, () => {
      return this.getManifests();
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_GET_INFO, (_event, pluginId: string) => {
      const plugin = this.plugins.get(pluginId);
      if (!plugin) return null;
      return {
        id: plugin.manifest.id,
        name: plugin.manifest.name,
        version: plugin.manifest.version,
        connected: plugin.client.isConnected()
      };
    });

    // ─── Plugin Store IPC ────────────────────────────────────

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_SEARCH, async (_event, query?: string) => {
      if (!this.storeClient) return [];
      try {
        return await this.storeClient.search(query);
      } catch (err) {
        console.error('[PluginRegistry] Store search failed:', err);
        return [];
      }
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_GET_VERSIONS, async (_event, packageName: string) => {
      if (!this.storeClient) return null;
      try {
        return await this.storeClient.getVersions(packageName);
      } catch (err) {
        console.error('[PluginRegistry] Store getVersions failed:', err);
        return null;
      }
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_INSTALL, async (_event, packageName: string, version: string) => {
      if (!this.installer) return { success: false, error: 'Plugin installer not available' };
      const result = await this.installer.installFromRegistry(packageName, version);
      if (result.success && result.plugin) {
        this.registerPlugin(result.plugin.manifest, result.plugin.createClient, 'external');
        // Auto-connect if the plugin has autoConnect settings
        try {
          const settings = this.profileManager.getPluginSettings(result.plugin.manifest.id);
          const defaults = result.plugin.manifest.connection?.defaults ?? {};
          const merged = { ...defaults, ...settings };
          if (merged.autoConnect) {
            const plugin = this.plugins.get(result.plugin.manifest.id);
            if (plugin) await plugin.client.connect(merged);
          }
        } catch {
          /* Non-fatal */
        }
      }
      return { success: result.success, pluginId: result.pluginId, version: result.version, error: result.error };
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_INSTALL_URL, async (_event, url: string) => {
      if (!this.installer) return { success: false, error: 'Plugin installer not available' };
      const result = await this.installer.installFromUrl(url);
      if (result.success && result.plugin) {
        this.registerPlugin(result.plugin.manifest, result.plugin.createClient, 'external');
      }
      return { success: result.success, pluginId: result.pluginId, version: result.version, error: result.error };
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_UNINSTALL, async (_event, pluginId: string) => {
      if (!this.installer) return { success: false, error: 'Plugin installer not available' };
      // Don't allow uninstalling built-in plugins
      if (!this.isExternalPlugin(pluginId)) {
        return { success: false, error: `Cannot uninstall built-in plugin "${pluginId}"` };
      }
      // Unregister from registry first (destroys client)
      this.unregisterPlugin(pluginId);
      // Then remove from disk
      return this.installer.uninstall(pluginId);
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_GET_INSTALLED, async () => {
      // Start with built-in plugins from the registry
      const result: Record<
        string,
        {
          version: string;
          source: string;
          installedAt: string;
          packageName?: string;
          name?: string;
          description?: string;
        }
      > = {};
      for (const [id, { manifest }] of this.plugins) {
        if (this.pluginSources.get(id) === 'built-in') {
          result[id] = {
            version: manifest.version,
            source: 'built-in',
            installedAt: '',
            name: manifest.name,
            description: manifest.description
          };
        }
      }
      // Merge external plugins from plugins.json
      if (this.installer) {
        const installedManifest = await this.installer.getInstalled();
        Object.assign(result, installedManifest.installed);
      }
      return result;
    });

    ipcMain.handle(IPC_CHANNELS.PLUGIN_STORE_CHECK_UPDATES, async () => {
      if (!this.installer) return [];
      try {
        return await this.installer.checkForUpdates();
      } catch {
        return [];
      }
    });

    console.log('[PluginRegistry] IPC handlers registered');
  }

  // ─── Host API Builder ───────────────────────────────────────

  /** Build a scoped PluginHostAPI for a specific plugin */
  private buildHostAPI(pluginId: string): PluginHostAPI {
    const subscriptions: Array<() => void> = [];

    const api: PluginHostAPI = {
      // ─── Device capabilities ─────────────────────────────
      setBrightness: async (value, serial?) => {
        const devices = serial
          ? this.deviceManager.getAllDevices().filter((d) => d.getInfo().serial === serial)
          : this.deviceManager.getAllDevices();
        for (const device of devices) {
          await device.setBrightness(value);
        }
      },

      setButtonImage: async (keyIndex, dataUri, serial?) => {
        // Validate 1: user must have a PluginLayer on this button
        const binding = this.getBindingAt(keyIndex);
        if (!hasPluginLayer(binding?.appearance)) {
          throw new Error(
            `Plugin "${pluginId}" cannot set image on key ${keyIndex}: ` +
              `no visible plugin layer on this button. ` +
              `The user must add a Plugin Image layer in the appearance editor.`
          );
        }

        // Validate 2: this plugin must own at least one trigger on the button
        if (!this.pluginOwnsButton(pluginId, binding)) {
          throw new Error(
            `Plugin "${pluginId}" cannot set image on key ${keyIndex}: ` +
              `no trigger on this button uses this plugin's action type`
          );
        }

        // Store runtime image and trigger re-render
        const mapKey = serial ? `${keyIndex}:${serial}` : `${keyIndex}`;
        this.pluginImageMap.set(mapKey, { pluginId, dataUri });
        this.reapplyKeyFn(keyIndex, serial);
      },

      clearButtonImage: async (keyIndex, serial?) => {
        const mapKey = serial ? `${keyIndex}:${serial}` : `${keyIndex}`;
        this.pluginImageMap.delete(mapKey);
        this.reapplyKeyFn(keyIndex, serial);
      },

      getDevices: () => {
        return this.deviceManager.getAllDevices().map((d) => {
          const info = d.getInfo();
          const buttons = info.controls.filter((c) => c.type === 'button');
          const knobs = info.controls.filter((c) => c.type === 'knob');
          return {
            serial: info.serial ?? info.id,
            name: info.name,
            rows: info.rows,
            cols: info.cols,
            keyCount: buttons.length || info.rows * info.cols,
            hasKnobs: knobs.length > 0
          };
        });
      },

      // ─── Action execution ────────────────────────────────
      executeAction: async (type, config) => {
        await this.actionExecutor.execute({
          id: `host-api-${Date.now()}`,
          type: type as BuiltinActionType,
          label: '',
          config: config as Record<string, unknown>
        });
      },

      executePluginAction: async (targetPluginId, config) => {
        const target = this.plugins.get(targetPluginId);
        if (!target) {
          throw new Error(`Plugin "${targetPluginId}" is not registered`);
        }
        if (!target.client.isConnected()) {
          throw new Error(`Plugin "${targetPluginId}" is not connected`);
        }
        await target.client.executeAction(config);
      },

      // ─── Plugin discovery ────────────────────────────────
      getPluginInfo: (targetId) => {
        const target = this.plugins.get(targetId);
        if (!target) return null;
        return {
          id: target.manifest.id,
          name: target.manifest.name,
          version: target.manifest.version,
          connected: target.client.isConnected()
        };
      },

      getRegisteredPlugins: () => {
        return Array.from(this.plugins.keys());
      },

      // ─── Device events ───────────────────────────────────
      onButtonDown: (cb) => {
        const handler = (event: DeviceButtonEvent) => {
          const device = this.deviceManager.getDevice(event.deviceId);
          const serial = device?.getInfo().serial ?? event.deviceId;
          cb(event.buttonIndex, serial);
        };
        this.deviceManager.on('button-down', handler);
        const unsub = () => this.deviceManager.off('button-down', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onButtonUp: (cb) => {
        const handler = (event: DeviceButtonEvent) => {
          const device = this.deviceManager.getDevice(event.deviceId);
          const serial = device?.getInfo().serial ?? event.deviceId;
          cb(event.buttonIndex, serial);
        };
        this.deviceManager.on('button-up', handler);
        const unsub = () => this.deviceManager.off('button-up', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onKnobRotate: (cb) => {
        const handler = (event: DeviceKnobEvent) => {
          const device = this.deviceManager.getDevice(event.deviceId);
          const serial = device?.getInfo().serial ?? event.deviceId;
          const direction: 'cw' | 'ccw' = event.delta > 0 ? 'cw' : 'ccw';
          cb(event.knobId, direction, serial);
        };
        this.deviceManager.on('knob-rotate', handler);
        const unsub = () => this.deviceManager.off('knob-rotate', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onKnobPress: (cb) => {
        const handler = (event: { deviceId: string; knobId: string }) => {
          const device = this.deviceManager.getDevice(event.deviceId);
          const serial = device?.getInfo().serial ?? event.deviceId;
          cb(event.knobId, serial);
        };
        this.deviceManager.on('knob-press', handler);
        const unsub = () => this.deviceManager.off('knob-press', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      // ─── Lifecycle events ────────────────────────────────
      // Note: ProfileManager and DeviceManager need to emit these events.
      // DeviceManager already emits device-connected/disconnected.

      onProfileChanged: (cb) => {
        const handler = (profileId: string) => cb(profileId);
        this.profileManager.on('profile-changed', handler);
        const unsub = () => this.profileManager.off('profile-changed', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onPageChanged: (cb) => {
        const handler = (pageId: string) => cb(pageId);
        this.profileManager.on('page-changed', handler);
        const unsub = () => this.profileManager.off('page-changed', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onDeviceConnected: (cb) => {
        const handler = (info: { serial?: string; name: string }) => {
          cb(info.serial ?? '', info.name);
        };
        this.deviceManager.on('device-connected', handler);
        const unsub = () => this.deviceManager.off('device-connected', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onDeviceDisconnected: (cb) => {
        const handler = (deviceId: string) => {
          // Best effort to get serial — device may already be gone
          const device = this.deviceManager.getDevice(deviceId);
          const serial = device?.getInfo().serial ?? deviceId;
          cb(serial);
        };
        this.deviceManager.on('device-disconnected', handler);
        const unsub = () => this.deviceManager.off('device-disconnected', handler);
        subscriptions.push(unsub);
        return unsub;
      },

      onSystemWakeUp: (cb) => {
        if (!this.systemWakeCallbacks) {
          this.systemWakeCallbacks = new Set();
        }
        this.systemWakeCallbacks.add(cb);
        const unsub = () => this.systemWakeCallbacks?.delete(cb);
        subscriptions.push(unsub);
        return unsub;
      },

      // ─── Visual feedback ─────────────────────────────────
      showFeedback: (keyIndex, feedbackType, durationMs = 1000) => {
        const payload: PluginFeedbackEvent = {
          keyIndex,
          feedbackType,
          durationMs
        };
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send(IPC_CHANNELS.PLUGIN_SHOW_FEEDBACK, payload);
        }
      },

      // ─── Logging ─────────────────────────────────────────
      log: (level, message) => {
        const manifest = this.plugins.get(pluginId)?.manifest;
        const source = manifest?.name ?? pluginId;
        // LogCollector intercepts console.log/warn/error automatically
        const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        logFn(`[${source}] ${message}`);
      },

      // ─── Settings ────────────────────────────────────────
      getOwnSettings: () => this.profileManager.getPluginSettings(pluginId),
      saveOwnSettings: async (settings) => {
        await this.profileManager.setPluginSettings(pluginId, settings);
      },

      // ─── Image Generation ────────────────────────────────
      createImage: {
        solidColor: pluginImageHelpers.solidColor,
        textImage: pluginImageHelpers.textImage
      }
    };

    // Store subscriptions list for cleanup on destroy
    this.pluginSubscriptions.set(pluginId, subscriptions);

    return api;
  }

  // ─── Helpers ────────────────────────────────────────────────

  /** Get the button binding at a key index on the current page */
  private getBindingAt(keyIndex: number): ButtonBinding | undefined {
    const page = this.profileManager.getCurrentPage();
    return page?.bindings[keyIndex];
  }

  /** Get the appearance config for a key.
   *  Returns the binding's appearance if configured, or undefined. */
  private getAppearanceConfig(keyIndex: number): ButtonAppearance | undefined {
    const binding = this.getBindingAt(keyIndex);
    return binding?.appearance;
  }

  /** Check if a plugin owns at least one trigger on a button binding */
  private pluginOwnsButton(pluginId: string, binding: ButtonBinding | undefined): boolean {
    if (!binding) return false;
    const expectedType = `plugin:${pluginId}`;
    return ALL_TRIGGER_TYPES.some((trigger) => {
      const action = binding[trigger];
      return action?.type === expectedType;
    });
  }

  /** Re-render all keys that belong to a specific plugin (after state change) */
  private reapplyPluginKeys(pluginId: string): void {
    const page = this.profileManager.getCurrentPage();
    if (!page) return;

    const expectedType = `plugin:${pluginId}`;
    for (const [keyStr, binding] of Object.entries(page.bindings)) {
      const hasPlugin = ALL_TRIGGER_TYPES.some((trigger) => binding[trigger]?.type === expectedType);
      if (hasPlugin) {
        this.reapplyKeyFn(Number(keyStr));
      }
    }
  }

  /** Broadcast a system wake event to all subscribed plugins */
  broadcastSystemWake(): void {
    if (!this.systemWakeCallbacks) return;
    for (const cb of this.systemWakeCallbacks) {
      try {
        cb();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[PluginRegistry] System wake callback error: ${msg}`);
      }
    }
  }
}
