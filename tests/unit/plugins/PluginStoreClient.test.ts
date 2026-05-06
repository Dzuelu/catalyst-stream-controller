import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ─── Mock HTTPS / HTTP ──────────────────────────────────────────

/** Create a mock HTTP response that emits data and end */
function mockResponse(statusCode: number, body: string | Buffer, headers: Record<string, string> = {}) {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
  };
  res.statusCode = statusCode;
  res.headers = headers;

  // Emit data + end async so the caller has time to set up listeners
  process.nextTick(() => {
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    res.emit('data', data);
    res.emit('end');
  });

  return res;
}

/** Create a mock request object */
function mockRequest() {
  const req = new EventEmitter() as EventEmitter & {
    setTimeout: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  req.setTimeout = vi.fn();
  req.destroy = vi.fn();
  return req;
}

let httpsGetMock: any;

vi.mock('node:https', () => ({
  default: { get: (...args: unknown[]) => httpsGetMock(...args) },
  get: (...args: unknown[]) => httpsGetMock(...args)
}));

vi.mock('node:http', () => ({
  default: { get: vi.fn() },
  get: vi.fn()
}));

// ─── Import After Mocks ─────────────────────────────────────────

import { PluginStoreClient } from '../../../src/main/plugins/PluginStoreClient';

// ─── Test Data ──────────────────────────────────────────────────

const SEARCH_RESPONSE = {
  objects: [
    {
      package: {
        name: 'catalyst-stream-controller-plugin-hue',
        version: '1.2.0',
        description: 'Philips Hue integration',
        keywords: ['catalyst-stream-controller-plugin', 'hue'],
        author: { name: 'Test Author' },
        date: '2024-01-15T10:00:00Z'
      }
    },
    {
      package: {
        name: 'catalyst-stream-controller-plugin-spotify',
        version: '2.0.0',
        description: 'Spotify control',
        keywords: ['catalyst-stream-controller-plugin', 'spotify'],
        author: 'StringAuthor',
        date: '2024-06-01T10:00:00Z'
      }
    }
  ]
};

const PACKAGE_METADATA = {
  name: 'catalyst-stream-controller-plugin-hue',
  description: 'Philips Hue integration',
  'dist-tags': { latest: '1.2.0' },
  time: {
    '1.0.0': '2023-06-01T10:00:00Z',
    '1.1.0': '2023-12-01T10:00:00Z',
    '1.2.0': '2024-01-15T10:00:00Z'
  },
  versions: {
    '1.0.0': {
      version: '1.0.0',
      dist: {
        tarball:
          'https://registry.npmjs.org/catalyst-stream-controller-plugin-hue/-/catalyst-stream-controller-plugin-hue-1.0.0.tgz'
      }
    },
    '1.1.0': {
      version: '1.1.0',
      dist: {
        tarball:
          'https://registry.npmjs.org/catalyst-stream-controller-plugin-hue/-/catalyst-stream-controller-plugin-hue-1.1.0.tgz'
      }
    },
    '1.2.0': {
      version: '1.2.0',
      dist: {
        tarball:
          'https://registry.npmjs.org/catalyst-stream-controller-plugin-hue/-/catalyst-stream-controller-plugin-hue-1.2.0.tgz'
      }
    }
  },
  author: { name: 'Test Author' },
  repository: { url: 'https://github.com/test/catalyst-stream-controller-plugin-hue' },
  homepage: 'https://example.com',
  license: 'MIT'
};

// ─── Tests ──────────────────────────────────────────────────────

describe('PluginStoreClient', () => {
  let client: PluginStoreClient;

  beforeEach(() => {
    client = new PluginStoreClient();
    httpsGetMock = vi.fn();
  });

  afterEach(() => {
    client.clearCache();
  });

  // ─── search() ─────────────────────────────────────────────

  describe('search', () => {
    it('should search the npm registry for catalyst-stream-controller-plugin packages', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(SEARCH_RESPONSE)));
        return mockRequest();
      });

      const results = await client.search();

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('catalyst-stream-controller-plugin-hue');
      expect(results[0].version).toBe('1.2.0');
      expect(results[0].description).toBe('Philips Hue integration');
      expect(results[0].author).toBe('Test Author');
    });

    it('should handle string author format', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(SEARCH_RESPONSE)));
        return mockRequest();
      });

      const results = await client.search();
      expect(results[1].author).toBe('StringAuthor');
    });

    it('should include query in search text', async () => {
      httpsGetMock.mockImplementation((url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        // Verify the URL contains our query
        expect(url).toContain('keywords%3Acatalyst-stream-controller-plugin');
        expect(url).toContain('hue');
        cb(mockResponse(200, JSON.stringify({ objects: [] })));
        return mockRequest();
      });

      await client.search('hue');
    });

    it('should cache search results', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(SEARCH_RESPONSE)));
        return mockRequest();
      });

      // First call hits the network
      const results1 = await client.search();
      expect(httpsGetMock).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const results2 = await client.search();
      expect(httpsGetMock).toHaveBeenCalledTimes(1);

      expect(results1).toEqual(results2);
    });

    it('should handle empty search results', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify({ objects: [] })));
        return mockRequest();
      });

      const results = await client.search();
      expect(results).toEqual([]);
    });

    it('should throw on HTTP errors', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(500, 'Internal Server Error'));
        return mockRequest();
      });

      await expect(client.search()).rejects.toThrow('HTTP 500');
    });

    it('should handle missing optional fields gracefully', async () => {
      const minimal = {
        objects: [
          {
            package: {
              name: 'catalyst-stream-controller-plugin-minimal',
              version: '0.1.0'
              // no description, author, keywords, date
            }
          }
        ]
      };
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(minimal)));
        return mockRequest();
      });

      const results = await client.search();
      expect(results[0].description).toBe('');
      expect(results[0].author).toBe('Unknown');
      expect(results[0].keywords).toEqual([]);
      expect(results[0].modified).toBe('');
    });
  });

  // ─── getVersions() ───────────────────────────────────────

  describe('getVersions', () => {
    it('should fetch and parse package metadata', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      const meta = await client.getVersions('catalyst-stream-controller-plugin-hue');

      expect(meta.name).toBe('catalyst-stream-controller-plugin-hue');
      expect(meta.description).toBe('Philips Hue integration');
      expect(meta.latestVersion).toBe('1.2.0');
      expect(meta.author).toBe('Test Author');
      expect(meta.license).toBe('MIT');
      expect(meta.homepage).toBe('https://example.com');
      expect(meta.repository).toBe('https://github.com/test/catalyst-stream-controller-plugin-hue');
    });

    it('should sort versions newest first', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      const meta = await client.getVersions('catalyst-stream-controller-plugin-hue');
      const versionStrings = meta.versions.map((v) => v.version);

      expect(versionStrings[0]).toBe('1.2.0');
      expect(versionStrings[1]).toBe('1.1.0');
      expect(versionStrings[2]).toBe('1.0.0');
    });

    it('should mark the latest version', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      const meta = await client.getVersions('catalyst-stream-controller-plugin-hue');

      const latest = meta.versions.find((v) => v.isLatest);
      expect(latest?.version).toBe('1.2.0');

      const nonLatest = meta.versions.filter((v) => !v.isLatest);
      expect(nonLatest).toHaveLength(2);
    });

    it('should include tarball URLs', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      const meta = await client.getVersions('catalyst-stream-controller-plugin-hue');
      expect(meta.versions[0].tarballUrl).toContain('catalyst-stream-controller-plugin-hue-1.2.0.tgz');
    });

    it('should cache version metadata', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      await client.getVersions('catalyst-stream-controller-plugin-hue');
      await client.getVersions('catalyst-stream-controller-plugin-hue');

      expect(httpsGetMock).toHaveBeenCalledTimes(1);
    });

    it('should handle missing dist-tags', async () => {
      const minimal = { name: 'pkg', versions: {} };
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(minimal)));
        return mockRequest();
      });

      const meta = await client.getVersions('pkg');
      expect(meta.latestVersion).toBe('');
      expect(meta.versions).toEqual([]);
    });
  });

  // ─── getLatest() ──────────────────────────────────────────

  describe('getLatest', () => {
    it('should return the latest version string', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      const latest = await client.getLatest('catalyst-stream-controller-plugin-hue');
      expect(latest).toBe('1.2.0');
    });
  });

  // ─── downloadTarball() ────────────────────────────────────

  describe('downloadTarball', () => {
    it('should throw when version is not found', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        cb(mockResponse(200, JSON.stringify(PACKAGE_METADATA)));
        return mockRequest();
      });

      await expect(client.downloadTarball('catalyst-stream-controller-plugin-hue', '9.9.9')).rejects.toThrow(
        'Version "9.9.9" not found'
      );
    });
  });

  // ─── clearCache() ─────────────────────────────────────────

  describe('clearCache', () => {
    it('should clear the cache so next request hits network', async () => {
      let callCount = 0;
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        callCount++;
        cb(mockResponse(200, JSON.stringify(SEARCH_RESPONSE)));
        return mockRequest();
      });

      await client.search();
      expect(callCount).toBe(1);

      await client.search(); // cached
      expect(callCount).toBe(1);

      client.clearCache();

      await client.search(); // fresh
      expect(callCount).toBe(2);
    });
  });

  // ─── HTTP error handling ──────────────────────────────────

  describe('HTTP errors', () => {
    it('should follow redirects', async () => {
      let callIndex = 0;
      httpsGetMock.mockImplementation((url: string, _opts: unknown, cb: (res: EventEmitter) => void) => {
        if (callIndex === 0) {
          callIndex++;
          cb(mockResponse(302, '', { location: 'https://redirected.com/data' }));
        } else {
          cb(mockResponse(200, JSON.stringify({ objects: [] })));
        }
        return mockRequest();
      });

      const results = await client.search();
      expect(results).toEqual([]);
    });

    it('should reject on network errors', async () => {
      httpsGetMock.mockImplementation((_url: string, _opts: unknown, _cb: unknown) => {
        const req = mockRequest();
        process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
        return req;
      });

      await expect(client.search()).rejects.toThrow('ECONNREFUSED');
    });
  });
});
