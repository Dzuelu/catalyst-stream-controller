/**
 * Plugin Store Client — Talks to the npm registry via HTTP to search,
 * browse versions, and download plugin tarballs.
 *
 * No `npm` CLI dependency — all operations use the public npm registry
 * REST API directly via Node's built-in `https` module.
 *
 * Registry endpoints:
 *   GET https://registry.npmjs.org/-/v1/search?text=keywords:catalyst-stream-controller-plugin
 *   GET https://registry.npmjs.org/{package}
 *   GET https://registry.npmjs.org/{package}/{version}
 *   GET {tarball_url}
 */

import https from 'node:https';
import http from 'node:http';

// ─── Types ──────────────────────────────────────────────────────

/** A plugin found via registry search */
export interface PluginSearchResult {
  /** npm package name (e.g. 'catalyst-stream-controller-plugin-hue') */
  name: string;
  /** Latest version */
  version: string;
  /** Package description */
  description: string;
  /** npm download count (approximate) */
  downloads: number;
  /** Package author name */
  author: string;
  /** When the package was last modified */
  modified: string;
  /** catalyst-stream-controller-plugin metadata from package.json (if present) */
  oscPlugin?: {
    displayName?: string;
    description?: string;
    icon?: string;
    minHostVersion?: string;
  };
  /** All keywords */
  keywords: string[];
}

/** Version info for a specific plugin */
export interface PluginVersionInfo {
  version: string;
  tarballUrl: string;
  published: string;
  /** Whether this is the 'latest' dist-tag */
  isLatest: boolean;
}

/** Full metadata for a plugin package */
export interface PluginPackageMetadata {
  name: string;
  description: string;
  /** All available versions, newest first */
  versions: PluginVersionInfo[];
  /** The latest dist-tag version */
  latestVersion: string;
  /** Author name */
  author: string;
  /** Repository URL */
  repository?: string;
  /** Homepage URL */
  homepage?: string;
  /** License */
  license?: string;
}

// ─── HTTP Helpers ───────────────────────────────────────────────

const REGISTRY_BASE = 'https://registry.npmjs.org';
const SEARCH_KEYWORD = 'catalyst-stream-controller-plugin';

/** Simple HTTP(S) GET that returns the response body as a string */
function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error(`Request timeout for ${url}`));
    });
  });
}

/** HTTP(S) GET that returns the response as a Buffer (for tarballs) */
function httpGetBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, (res) => {
      // Follow redirects
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGetBuffer(res.headers.location).then(resolve, reject);
        return;
      }

      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Download timeout for ${url}`));
    });
  });
}

// ─── Search Result Cache ────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Simple TTL cache for API responses */
class ResponseCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, ttlMs: number): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// ─── Plugin Store Client ────────────────────────────────────────

/** Cache TTLs */
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const VERSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export class PluginStoreClient {
  private cache = new ResponseCache();

  /**
   * Search the npm registry for catalyst-stream-controller-plugin packages.
   *
   * Uses: GET /-/v1/search?text=keywords:catalyst-stream-controller-plugin{+query}&size={size}
   */
  async search(query?: string, size = 50): Promise<PluginSearchResult[]> {
    const searchText = query ? `keywords:${SEARCH_KEYWORD} ${query}` : `keywords:${SEARCH_KEYWORD}`;
    const cacheKey = `search:${searchText}:${size}`;

    const cached = this.cache.get<PluginSearchResult[]>(cacheKey, SEARCH_CACHE_TTL);
    if (cached) return cached;

    const url = `${REGISTRY_BASE}/-/v1/search?text=${encodeURIComponent(searchText)}&size=${size}`;
    const raw = await httpGet(url);
    const data = JSON.parse(raw) as {
      objects: Array<{
        package: {
          name: string;
          version: string;
          description?: string;
          keywords?: string[];
          author?: { name?: string; username?: string } | string;
          date?: string;
          links?: { npm?: string; homepage?: string; repository?: string };
        };
        score?: { detail?: { popularity?: number } };
        downloads?: { monthly?: number };
      }>;
    };

    const results: PluginSearchResult[] = data.objects.map((obj) => {
      const pkg = obj.package;
      const authorName =
        typeof pkg.author === 'string' ? pkg.author : (pkg.author?.name ?? pkg.author?.username ?? 'Unknown');

      return {
        name: pkg.name,
        version: pkg.version,
        description: pkg.description ?? '',
        downloads: 0, // Search API doesn't include downloads directly
        author: authorName,
        modified: pkg.date ?? '',
        keywords: pkg.keywords ?? []
      };
    });

    this.cache.set(cacheKey, results);
    return results;
  }

  /**
   * Get all published versions for a package, newest first.
   *
   * Uses: GET /{package} (abbreviated metadata)
   */
  async getVersions(packageName: string): Promise<PluginPackageMetadata> {
    const cacheKey = `versions:${packageName}`;
    const cached = this.cache.get<PluginPackageMetadata>(cacheKey, VERSION_CACHE_TTL);
    if (cached) return cached;

    const url = `${REGISTRY_BASE}/${encodeURIComponent(packageName)}`;
    const raw = await httpGet(url);
    const data = JSON.parse(raw) as {
      name: string;
      description?: string;
      'dist-tags'?: Record<string, string>;
      time?: Record<string, string>;
      versions?: Record<
        string,
        {
          version: string;
          dist?: { tarball?: string };
          author?: { name?: string } | string;
          repository?: { url?: string } | string;
          homepage?: string;
          license?: string;
          'catalyst-stream-controller-plugin'?: Record<string, unknown>;
        }
      >;
      author?: { name?: string } | string;
      repository?: { url?: string } | string;
      homepage?: string;
      license?: string;
    };

    const latestVersion = data['dist-tags']?.latest ?? '';
    const timeMap = data.time ?? {};
    const versionsMap = data.versions ?? {};

    // Build version list, newest first
    const versions: PluginVersionInfo[] = Object.keys(versionsMap)
      .map((ver) => ({
        version: ver,
        tarballUrl: versionsMap[ver]?.dist?.tarball ?? '',
        published: timeMap[ver] ?? '',
        isLatest: ver === latestVersion
      }))
      .sort((a, b) => {
        // Sort by publish date descending (newest first)
        return (b.published || '').localeCompare(a.published || '');
      });

    const authorName = typeof data.author === 'string' ? data.author : (data.author?.name ?? 'Unknown');
    const repoUrl = typeof data.repository === 'string' ? data.repository : (data.repository as { url?: string })?.url;

    const result: PluginPackageMetadata = {
      name: data.name,
      description: data.description ?? '',
      versions,
      latestVersion,
      author: authorName,
      repository: repoUrl,
      homepage: data.homepage,
      license: data.license
    };

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get the latest version string for a package.
   *
   * Uses: GET /{package}/latest
   */
  async getLatest(packageName: string): Promise<string> {
    const meta = await this.getVersions(packageName);
    return meta.latestVersion;
  }

  /**
   * Download a specific version's tarball as a Buffer.
   *
   * First fetches version metadata to get the tarball URL, then downloads.
   */
  async downloadTarball(packageName: string, version: string): Promise<Buffer> {
    const meta = await this.getVersions(packageName);
    const versionInfo = meta.versions.find((v) => v.version === version);

    if (!versionInfo) {
      throw new Error(`Version "${version}" not found for package "${packageName}"`);
    }

    if (!versionInfo.tarballUrl) {
      throw new Error(`No tarball URL for ${packageName}@${version}`);
    }

    return httpGetBuffer(versionInfo.tarballUrl);
  }

  /**
   * Download a tarball from a direct URL (for non-npm sources like GitHub releases).
   */
  async downloadFromUrl(url: string): Promise<Buffer> {
    return httpGetBuffer(url);
  }

  /**
   * Clear the response cache (e.g. after install/uninstall to refresh).
   */
  clearCache(): void {
    this.cache.clear();
  }
}
