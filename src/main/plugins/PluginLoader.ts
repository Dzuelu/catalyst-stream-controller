/**
 * Plugin Loader — Scans the external plugins directory, validates
 * manifest.json files, and dynamically imports plugin code.
 *
 * External plugins live in:
 *   {userData}/plugins/{plugin-name}/
 *     ├── manifest.json
 *     └── dist/
 *         └── index.js
 */

import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { PluginManifest, PluginClientFactory } from '../../shared/plugin-types';

// ─── Types ──────────────────────────────────────────────────────

/** Result of loading a single external plugin */
export interface LoadedExternalPlugin {
  manifest: PluginManifest;
  createClient: PluginClientFactory;
  /** Absolute path to the plugin directory */
  pluginDir: string;
}

/** Error encountered while loading a plugin */
export interface PluginLoadError {
  pluginDir: string;
  error: string;
}

/** Result of scanning and loading all external plugins */
export interface PluginLoaderResult {
  loaded: LoadedExternalPlugin[];
  errors: PluginLoadError[];
}

// ─── Manifest Validation ────────────────────────────────────────

/** Minimum required fields for a valid manifest.json */
const REQUIRED_MANIFEST_FIELDS: Array<keyof PluginManifest> = ['id', 'name', 'version', 'actions'];

/**
 * Validate that a parsed JSON object satisfies the PluginManifest shape.
 * Returns an error message if invalid, or null if valid.
 */
export function validateManifest(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return 'manifest.json must be a JSON object';
  }

  const obj = data as Record<string, unknown>;

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in obj) || obj[field] === undefined || obj[field] === null) {
      return `manifest.json is missing required field: "${field}"`;
    }
  }

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    return 'manifest.json "id" must be a non-empty string';
  }
  if (typeof obj.name !== 'string' || obj.name.length === 0) {
    return 'manifest.json "name" must be a non-empty string';
  }
  if (typeof obj.version !== 'string' || obj.version.length === 0) {
    return 'manifest.json "version" must be a non-empty string';
  }
  if (typeof obj.actions !== 'object') {
    return 'manifest.json "actions" must be an object';
  }
  // connection is optional — but if provided, validate its shape
  if (obj.connection !== undefined) {
    if (typeof obj.connection !== 'object' || obj.connection === null) {
      return 'manifest.json "connection" must be an object (or omitted)';
    }
    const conn = obj.connection as Record<string, unknown>;
    if (typeof conn.defaults !== 'object') {
      return 'manifest.json "connection.defaults" must be an object';
    }
    if (!Array.isArray(conn.fields)) {
      return 'manifest.json "connection.fields" must be an array';
    }
  }
  // state is optional — but if provided, validate its shape
  if (obj.state !== undefined) {
    if (typeof obj.state !== 'object' || obj.state === null) {
      return 'manifest.json "state" must be an object (or omitted)';
    }
    const st = obj.state as Record<string, unknown>;
    if (typeof st.defaults !== 'object') {
      return 'manifest.json "state.defaults" must be an object';
    }
  }

  return null;
}

// ─── Host Version Compatibility ─────────────────────────────────

/**
 * Check if the plugin's minHostVersion is compatible with the current app version.
 * Uses simple semver major.minor comparison (no patch comparison).
 */
export function isHostVersionCompatible(minHostVersion: string | undefined, appVersion: string): boolean {
  if (!minHostVersion) return true; // No requirement = always compatible

  const parseVersion = (v: string): [number, number, number] => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  };

  const [minMajor, minMinor, minPatch] = parseVersion(minHostVersion);
  const [appMajor, appMinor, appPatch] = parseVersion(appVersion);

  if (appMajor !== minMajor) return appMajor > minMajor;
  if (appMinor !== minMinor) return appMinor > minMinor;
  return appPatch >= minPatch;
}

// ─── Plugin Loader ──────────────────────────────────────────────

/**
 * Get the external plugins directory path.
 * Creates the directory if it doesn't exist.
 */
export function getPluginsDir(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

/**
 * Ensure the plugins directory exists.
 */
export async function ensurePluginsDir(): Promise<string> {
  const dir = getPluginsDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Scan the plugins directory and load all valid external plugins.
 *
 * For each subdirectory in {userData}/plugins/:
 * 1. Read and validate manifest.json
 * 2. Check host version compatibility
 * 3. Dynamic import() dist/index.js
 * 4. Validate that the module exports a PluginClientFactory
 */
export async function loadExternalPlugins(appVersion?: string): Promise<PluginLoaderResult> {
  const result: PluginLoaderResult = { loaded: [], errors: [] };
  const pluginsDir = await ensurePluginsDir();
  const version = appVersion ?? app.getVersion();

  let entries: string[];
  try {
    entries = await fs.readdir(pluginsDir);
  } catch {
    // Directory doesn't exist or can't be read — not an error, just no plugins
    return result;
  }

  for (const entry of entries) {
    const pluginDir = path.join(pluginsDir, entry);

    // Skip non-directories
    try {
      const stat = await fs.stat(pluginDir);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }

    // Load individual plugin
    const loadResult = await loadSinglePlugin(pluginDir, version);
    if ('error' in loadResult) {
      result.errors.push({ pluginDir, error: loadResult.error });
    } else {
      result.loaded.push(loadResult);
    }
  }

  return result;
}

/**
 * Load a single plugin from a directory.
 * Returns the loaded plugin or an error.
 */
export async function loadSinglePlugin(
  pluginDir: string,
  appVersion: string
): Promise<LoadedExternalPlugin | { error: string }> {
  const manifestPath = path.join(pluginDir, 'manifest.json');
  const entryPath = path.join(pluginDir, 'dist', 'index.js');

  // 1. Read manifest.json
  let manifestRaw: string;
  try {
    manifestRaw = await fs.readFile(manifestPath, 'utf-8');
  } catch {
    return { error: `manifest.json not found at ${manifestPath}` };
  }

  // 2. Parse JSON
  let manifestData: unknown;
  try {
    manifestData = JSON.parse(manifestRaw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Invalid JSON in manifest.json: ${msg}` };
  }

  // 3. Validate manifest structure
  const validationError = validateManifest(manifestData);
  if (validationError) {
    return { error: validationError };
  }

  const manifest = manifestData as PluginManifest;

  // 4. Check host version compatibility
  const oscPluginMeta = (manifestData as Record<string, unknown>)['minHostVersion'] as string | undefined;
  if (!isHostVersionCompatible(oscPluginMeta, appVersion)) {
    return {
      error: `Plugin requires host version >= ${oscPluginMeta}, but app is ${appVersion}`
    };
  }

  // 5. Check dist/index.js exists
  try {
    await fs.access(entryPath);
  } catch {
    return { error: `Plugin entry point not found: dist/index.js` };
  }

  // 6. Dynamic import the plugin module
  let pluginModule: Record<string, unknown>;
  try {
    // Use file:// URL for dynamic import compatibility
    const fileUrl = `file://${entryPath}`;
    pluginModule = (await import(fileUrl)) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Failed to import plugin: ${msg}` };
  }

  // 7. Validate exported factory function
  const createClient = (pluginModule.createClient ?? pluginModule.default) as PluginClientFactory | undefined;
  if (typeof createClient !== 'function') {
    return {
      error: 'Plugin module must export a "createClient" function or a default export that is a PluginClientFactory'
    };
  }

  return {
    manifest,
    createClient,
    pluginDir
  };
}
