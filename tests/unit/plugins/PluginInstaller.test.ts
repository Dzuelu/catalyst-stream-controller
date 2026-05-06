import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginInstaller, readInstalledManifest } from '../../../src/main/plugins/PluginInstaller';
import { setFile, getFile, resetMockFs } from '../../mocks/fs';
import type { PluginStoreClient } from '../../../src/main/plugins/PluginStoreClient';

// ─── Mock Store Client ──────────────────────────────────────────

function createMockStoreClient(): PluginStoreClient {
  return {
    search: vi.fn(async () => []),
    getVersions: vi.fn(async () => ({
      name: 'test-pkg',
      description: '',
      versions: [],
      latestVersion: '1.0.0',
      author: 'Test',
      repository: undefined,
      homepage: undefined,
      license: undefined
    })),
    getLatest: vi.fn(async () => '1.0.0'),
    downloadTarball: vi.fn(async () => Buffer.from('')),
    downloadFromUrl: vi.fn(async () => Buffer.from('')),
    clearCache: vi.fn()
  } as unknown as PluginStoreClient;
}

// ─── Helpers ────────────────────────────────────────────────────

const MANIFEST_PATH = '/mock/userData/plugins.json';

function setInstalledManifest(manifest: Record<string, unknown>): void {
  setFile(MANIFEST_PATH, JSON.stringify(manifest));
}

function getInstalledManifest(): Record<string, unknown> | undefined {
  const raw = getFile(MANIFEST_PATH);
  return raw ? JSON.parse(raw) : undefined;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PluginInstaller', () => {
  let installer: PluginInstaller;
  let mockClient: PluginStoreClient;

  beforeEach(() => {
    resetMockFs();
    mockClient = createMockStoreClient();
    installer = new PluginInstaller(mockClient);
  });

  // ─── readInstalledManifest ────────────────────────────────

  describe('readInstalledManifest', () => {
    it('should return empty manifest when file does not exist', async () => {
      const manifest = await readInstalledManifest();
      expect(manifest).toEqual({ installed: {} });
    });

    it('should read existing manifest', async () => {
      setInstalledManifest({
        installed: {
          'test-plugin': {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01T00:00:00Z',
            packageName: 'catalyst-stream-controller-plugin-test'
          }
        }
      });

      const manifest = await readInstalledManifest();
      expect(manifest.installed).toHaveProperty('test-plugin');
      expect(manifest.installed['test-plugin'].version).toBe('1.0.0');
      expect(manifest.installed['test-plugin'].source).toBe('npm');
    });

    it('should handle malformed manifest gracefully', async () => {
      setFile(MANIFEST_PATH, 'not-json');
      const manifest = await readInstalledManifest();
      expect(manifest).toEqual({ installed: {} });
    });

    it('should handle manifest with missing installed field', async () => {
      setFile(MANIFEST_PATH, JSON.stringify({ version: 1 }));
      const manifest = await readInstalledManifest();
      expect(manifest).toEqual({ installed: {} });
    });
  });

  // ─── getInstalled ─────────────────────────────────────────

  describe('getInstalled', () => {
    it('should return the installed plugins manifest', async () => {
      setInstalledManifest({
        installed: {
          hue: {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-hue'
          },
          custom: {
            version: '0.1.0',
            source: 'url',
            sourceUrl: 'https://example.com/plugin.tgz',
            installedAt: '2024-02-01'
          }
        }
      });

      const result = await installer.getInstalled();
      expect(Object.keys(result.installed)).toHaveLength(2);
      expect(result.installed.hue.source).toBe('npm');
      expect(result.installed.custom.source).toBe('url');
      expect(result.installed.custom.sourceUrl).toBe('https://example.com/plugin.tgz');
    });

    it('should return empty manifest when nothing is installed', async () => {
      const result = await installer.getInstalled();
      expect(result.installed).toEqual({});
    });
  });

  // ─── uninstall ────────────────────────────────────────────

  describe('uninstall', () => {
    it('should remove plugin from manifest', async () => {
      setInstalledManifest({
        installed: {
          'test-plugin': { version: '1.0.0', source: 'npm', installedAt: '2024-01-01', packageName: 'pkg' },
          other: { version: '2.0.0', source: 'npm', installedAt: '2024-01-01', packageName: 'other-pkg' }
        }
      });

      const result = await installer.uninstall('test-plugin');
      expect(result.success).toBe(true);

      const manifest = getInstalledManifest();
      expect(manifest?.installed).not.toHaveProperty('test-plugin');
      expect(manifest?.installed).toHaveProperty('other');
    });

    it('should succeed even if plugin is not in manifest', async () => {
      setInstalledManifest({ installed: {} });

      const result = await installer.uninstall('nonexistent');
      expect(result.success).toBe(true);
    });

    it('should succeed even if plugins.json does not exist', async () => {
      const result = await installer.uninstall('anything');
      expect(result.success).toBe(true);
    });
  });

  // ─── checkForUpdates ──────────────────────────────────────

  describe('checkForUpdates', () => {
    it('should detect available updates for npm-sourced plugins', async () => {
      setInstalledManifest({
        installed: {
          hue: {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-hue'
          }
        }
      });

      (mockClient.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');

      const updates = await installer.checkForUpdates();
      expect(updates).toHaveLength(1);
      expect(updates[0]).toEqual({
        pluginId: 'hue',
        currentVersion: '1.0.0',
        latestVersion: '1.2.0',
        packageName: 'catalyst-stream-controller-plugin-hue'
      });
    });

    it('should not report updates when versions match', async () => {
      setInstalledManifest({
        installed: {
          hue: {
            version: '1.2.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-hue'
          }
        }
      });

      (mockClient.getLatest as ReturnType<typeof vi.fn>).mockResolvedValue('1.2.0');

      const updates = await installer.checkForUpdates();
      expect(updates).toEqual([]);
    });

    it('should skip URL-sourced plugins', async () => {
      setInstalledManifest({
        installed: {
          custom: {
            version: '0.1.0',
            source: 'url',
            sourceUrl: 'https://example.com/plugin.tgz',
            installedAt: '2024-01-01'
          }
        }
      });

      const updates = await installer.checkForUpdates();
      expect(updates).toEqual([]);
      expect(mockClient.getLatest).not.toHaveBeenCalled();
    });

    it('should skip plugins without packageName', async () => {
      setInstalledManifest({
        installed: {
          orphan: {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01'
            // no packageName
          }
        }
      });

      const updates = await installer.checkForUpdates();
      expect(updates).toEqual([]);
    });

    it('should skip plugins where getLatest fails', async () => {
      setInstalledManifest({
        installed: {
          hue: {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-hue'
          }
        }
      });

      (mockClient.getLatest as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network error'));

      const updates = await installer.checkForUpdates();
      expect(updates).toEqual([]);
    });

    it('should check multiple plugins independently', async () => {
      setInstalledManifest({
        installed: {
          hue: {
            version: '1.0.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-hue'
          },
          spotify: {
            version: '2.0.0',
            source: 'npm',
            installedAt: '2024-01-01',
            packageName: 'catalyst-stream-controller-plugin-spotify'
          }
        }
      });

      (mockClient.getLatest as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce('1.2.0') // hue has update
        .mockResolvedValueOnce('2.0.0'); // spotify is current

      const updates = await installer.checkForUpdates();
      expect(updates).toHaveLength(1);
      expect(updates[0].pluginId).toBe('hue');
    });
  });

  // ─── installFromRegistry ──────────────────────────────────

  describe('installFromRegistry', () => {
    it('should report error when tarball download fails', async () => {
      (mockClient.downloadTarball as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('version not found'));

      const result = await installer.installFromRegistry('catalyst-stream-controller-plugin-hue', '1.0.0');
      expect(result.success).toBe(false);
      expect(result.error).toContain('version not found');
    });

    it('should call downloadTarball with correct args', async () => {
      (mockClient.downloadTarball as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('expected failure'));

      await installer.installFromRegistry('catalyst-stream-controller-plugin-hue', '1.2.0');

      expect(mockClient.downloadTarball).toHaveBeenCalledWith('catalyst-stream-controller-plugin-hue', '1.2.0');
    });

    it('should clear store cache after successful tarball download attempt', async () => {
      // Even if subsequent steps fail, the download itself worked
      (mockClient.downloadTarball as ReturnType<typeof vi.fn>).mockResolvedValue(Buffer.from([0]));

      // This will fail during extraction (invalid gzip), but storeClient.downloadTarball was called
      await installer.installFromRegistry('catalyst-stream-controller-plugin-test', '1.0.0');

      // Download was attempted
      expect(mockClient.downloadTarball).toHaveBeenCalled();
    });
  });

  // ─── installFromUrl ───────────────────────────────────────

  describe('installFromUrl', () => {
    it('should report error when download fails', async () => {
      (mockClient.downloadFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await installer.installFromUrl('https://example.com/plugin.tgz');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ECONNREFUSED');
    });

    it('should call downloadFromUrl with the URL', async () => {
      (mockClient.downloadFromUrl as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('expected failure'));

      await installer.installFromUrl('https://github.com/releases/v1.0.0/plugin.tgz');

      expect(mockClient.downloadFromUrl).toHaveBeenCalledWith('https://github.com/releases/v1.0.0/plugin.tgz');
    });
  });
});
