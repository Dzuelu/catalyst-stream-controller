/**
 * Plugin Installer — Handles downloading, extracting, validating, and
 * managing the lifecycle of external plugins on disk.
 *
 * Manages the local plugins.json manifest that tracks installed plugins
 * and their versions.
 *
 * Plugin install flow:
 *   1. Download tarball (from npm registry or direct URL)
 *   2. Extract to temp directory
 *   3. Validate manifest.json + dist/index.js
 *   4. Move to {userData}/plugins/{name}/
 *   5. Update plugins.json
 *   6. Dynamic import + register with PluginRegistry
 */

import { app } from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';
import { getPluginsDir, ensurePluginsDir, validateManifest, loadSinglePlugin } from './PluginLoader';
import type { LoadedExternalPlugin } from './PluginLoader';
import type { PluginStoreClient } from './PluginStoreClient';

// ─── Types ──────────────────────────────────────────────────────

/** Entry in the installed plugins manifest */
export interface InstalledPluginEntry {
  /** Installed version */
  version: string;
  /** How the plugin was installed */
  source: 'npm' | 'url';
  /** If source is 'url', the original URL */
  sourceUrl?: string;
  /** ISO timestamp of installation */
  installedAt: string;
  /** npm package name (may differ from manifest.id) */
  packageName?: string;
}

/** The plugins.json manifest structure */
export interface InstalledPluginsManifest {
  installed: Record<string, InstalledPluginEntry>;
}

/** Result of an install operation */
export interface InstallResult {
  success: boolean;
  pluginId?: string;
  version?: string;
  error?: string;
  plugin?: LoadedExternalPlugin;
}

// ─── Tar Extraction ─────────────────────────────────────────────

/**
 * Minimal tar header parser — extracts files from a POSIX tar stream.
 *
 * npm tarballs are gzipped tars with files nested under `package/`.
 * We strip the leading `package/` prefix during extraction.
 *
 * Security: Validates that all extracted paths stay within the target
 * directory (no path traversal via `../../`).
 */
async function extractTarGz(tarBuffer: Buffer, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });

  // Decompress gzip
  const decompressed = await decompressGzip(tarBuffer);

  // Parse tar
  let offset = 0;
  while (offset < decompressed.length - 512) {
    // Read header (512 bytes)
    const header = decompressed.subarray(offset, offset + 512);

    // Check for end-of-archive (two consecutive 512-byte blocks of zeros)
    if (header.every((b) => b === 0)) break;

    // Parse name (0-100 bytes, null-terminated)
    const nameEnd = header.indexOf(0, 0);
    let name = header.subarray(0, Math.min(nameEnd, 100)).toString('utf-8');

    // Parse size (124-136, octal ASCII)
    const sizeStr = header.subarray(124, 136).toString('utf-8').trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Parse type flag (156, single char)
    const typeFlag = String.fromCharCode(header[156]);

    // Check for USTAR long name prefix (345-500)
    const prefix = header.subarray(345, 500).toString('utf-8').replace(/\0/g, '').trim();
    if (prefix) {
      name = `${prefix}/${name}`;
    }

    offset += 512; // Move past header

    // Strip leading 'package/' prefix (npm convention)
    const strippedName = name.replace(/^package\//, '');

    if (strippedName && typeFlag !== '5' && size > 0) {
      // It's a file
      const filePath = path.join(targetDir, strippedName);
      const resolvedPath = path.resolve(filePath);

      // Security: path traversal check
      if (!resolvedPath.startsWith(path.resolve(targetDir))) {
        throw new Error(`Path traversal detected in tarball: ${name}`);
      }

      // Create parent directories
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write file content
      const content = decompressed.subarray(offset, offset + size);
      await fs.writeFile(filePath, content);
    } else if (strippedName && typeFlag === '5') {
      // It's a directory
      const dirPath = path.join(targetDir, strippedName);
      const resolvedPath = path.resolve(dirPath);

      if (!resolvedPath.startsWith(path.resolve(targetDir))) {
        throw new Error(`Path traversal detected in tarball: ${name}`);
      }

      await fs.mkdir(dirPath, { recursive: true });
    }

    // Advance past file data (rounded up to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }
}

/** Decompress a gzip buffer */
function decompressGzip(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk as Buffer);
        callback();
      }
    });

    gunzip.on('error', reject);
    writable.on('error', reject);
    writable.on('finish', () => resolve(Buffer.concat(chunks)));

    gunzip.pipe(writable);
    gunzip.end(buffer);
  });
}

// ─── Manifest File ──────────────────────────────────────────────

/** Path to the plugins.json manifest */
function getManifestPath(): string {
  return path.join(app.getPath('userData'), 'plugins.json');
}

/** Read the installed plugins manifest, creating a default if it doesn't exist */
export async function readInstalledManifest(): Promise<InstalledPluginsManifest> {
  const manifestPath = getManifestPath();
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(raw) as InstalledPluginsManifest;
    if (!data.installed || typeof data.installed !== 'object') {
      return { installed: {} };
    }
    return data;
  } catch {
    return { installed: {} };
  }
}

/** Write the installed plugins manifest to disk */
async function writeInstalledManifest(manifest: InstalledPluginsManifest): Promise<void> {
  const manifestPath = getManifestPath();
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ─── Plugin Installer ──────────────────────────────────────────

export class PluginInstaller {
  constructor(private storeClient: PluginStoreClient) {}

  /**
   * Install a plugin from the npm registry by package name and version.
   */
  async installFromRegistry(packageName: string, version: string): Promise<InstallResult> {
    console.log(`[PluginInstaller] Installing ${packageName}@${version} from npm registry...`);

    try {
      // 1. Download tarball
      const tarball = await this.storeClient.downloadTarball(packageName, version);

      // 2. Extract to temp directory
      const tempDir = path.join(app.getPath('temp'), `catalyst-stream-controller-plugin-install-${Date.now()}`);
      await extractTarGz(tarball, tempDir);

      // 3. Validate
      const validationResult = await this.validateExtractedPlugin(tempDir);
      if (validationResult.error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: validationResult.error };
      }

      const manifest = validationResult.manifest!;

      // 4. Move to plugins directory
      const pluginsDir = await ensurePluginsDir();
      const targetDir = path.join(pluginsDir, manifest.id);

      // Remove existing version if present
      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rename(tempDir, targetDir);

      // 5. Update plugins.json
      const installedManifest = await readInstalledManifest();
      installedManifest.installed[manifest.id] = {
        version,
        source: 'npm',
        installedAt: new Date().toISOString(),
        packageName
      };
      await writeInstalledManifest(installedManifest);

      // 6. Load the plugin
      const loaded = await loadSinglePlugin(targetDir, app.getVersion());
      if ('error' in loaded) {
        return { success: false, error: `Plugin installed but failed to load: ${loaded.error}` };
      }

      console.log(`[PluginInstaller] Successfully installed ${manifest.id}@${version}`);

      // Clear store cache to refresh version info
      this.storeClient.clearCache();

      return {
        success: true,
        pluginId: manifest.id,
        version,
        plugin: loaded
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PluginInstaller] Failed to install ${packageName}@${version}: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Install a plugin from a direct tarball URL (GitHub releases, etc.).
   */
  async installFromUrl(url: string): Promise<InstallResult> {
    console.log(`[PluginInstaller] Installing from URL: ${url}`);

    try {
      // 1. Download tarball
      const tarball = await this.storeClient.downloadFromUrl(url);

      // 2. Extract to temp directory
      const tempDir = path.join(app.getPath('temp'), `catalyst-stream-controller-plugin-install-${Date.now()}`);
      await extractTarGz(tarball, tempDir);

      // 3. Validate
      const validationResult = await this.validateExtractedPlugin(tempDir);
      if (validationResult.error) {
        await fs.rm(tempDir, { recursive: true, force: true });
        return { success: false, error: validationResult.error };
      }

      const manifest = validationResult.manifest!;

      // 4. Move to plugins directory
      const pluginsDir = await ensurePluginsDir();
      const targetDir = path.join(pluginsDir, manifest.id);

      await fs.rm(targetDir, { recursive: true, force: true });
      await fs.rename(tempDir, targetDir);

      // 5. Update plugins.json
      const installedManifest = await readInstalledManifest();
      installedManifest.installed[manifest.id] = {
        version: manifest.version,
        source: 'url',
        sourceUrl: url,
        installedAt: new Date().toISOString()
      };
      await writeInstalledManifest(installedManifest);

      // 6. Load the plugin
      const loaded = await loadSinglePlugin(targetDir, app.getVersion());
      if ('error' in loaded) {
        return { success: false, error: `Plugin installed but failed to load: ${loaded.error}` };
      }

      console.log(`[PluginInstaller] Successfully installed ${manifest.id}@${manifest.version} from URL`);

      return {
        success: true,
        pluginId: manifest.id,
        version: manifest.version,
        plugin: loaded
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PluginInstaller] Failed to install from URL: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Uninstall a plugin by ID.
   */
  async uninstall(pluginId: string): Promise<{ success: boolean; error?: string }> {
    console.log(`[PluginInstaller] Uninstalling plugin "${pluginId}"...`);

    try {
      // 1. Remove from plugins directory
      const pluginsDir = getPluginsDir();
      const pluginDir = path.join(pluginsDir, pluginId);

      try {
        await fs.rm(pluginDir, { recursive: true, force: true });
      } catch {
        // Directory might not exist — that's fine
      }

      // 2. Remove from plugins.json
      const manifest = await readInstalledManifest();
      delete manifest.installed[pluginId];
      await writeInstalledManifest(manifest);

      console.log(`[PluginInstaller] Successfully uninstalled "${pluginId}"`);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[PluginInstaller] Failed to uninstall "${pluginId}": ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Get the list of installed external plugins from plugins.json.
   */
  async getInstalled(): Promise<InstalledPluginsManifest> {
    return readInstalledManifest();
  }

  /**
   * Check for updates: compare installed versions against registry latest.
   */
  async checkForUpdates(): Promise<
    Array<{
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
      packageName?: string;
    }>
  > {
    const manifest = await readInstalledManifest();
    const updates: Array<{
      pluginId: string;
      currentVersion: string;
      latestVersion: string;
      packageName?: string;
    }> = [];

    for (const [pluginId, entry] of Object.entries(manifest.installed)) {
      // Only check npm-sourced plugins
      if (entry.source !== 'npm' || !entry.packageName) continue;

      try {
        const latest = await this.storeClient.getLatest(entry.packageName);
        if (latest && latest !== entry.version) {
          updates.push({
            pluginId,
            currentVersion: entry.version,
            latestVersion: latest,
            packageName: entry.packageName
          });
        }
      } catch {
        // Skip plugins where we can't check (network issues, etc.)
      }
    }

    return updates;
  }

  // ─── Private Helpers ──────────────────────────────────────────

  /**
   * Validate an extracted plugin directory has valid manifest + entry point.
   */
  private async validateExtractedPlugin(
    dir: string
  ): Promise<{ manifest?: Record<string, unknown> & { id: string; version: string }; error?: string }> {
    const manifestPath = path.join(dir, 'manifest.json');
    const entryPath = path.join(dir, 'dist', 'index.js');

    // Check manifest.json exists
    let manifestRaw: string;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf-8');
    } catch {
      return { error: 'Plugin tarball does not contain manifest.json at the root' };
    }

    // Parse JSON
    let manifestData: unknown;
    try {
      manifestData = JSON.parse(manifestRaw);
    } catch {
      return { error: 'Plugin manifest.json contains invalid JSON' };
    }

    // Validate structure
    const validationError = validateManifest(manifestData);
    if (validationError) {
      return { error: validationError };
    }

    // Check dist/index.js exists
    try {
      await fs.access(entryPath);
    } catch {
      return { error: 'Plugin tarball does not contain dist/index.js' };
    }

    return { manifest: manifestData as Record<string, unknown> & { id: string; version: string } };
  }
}
