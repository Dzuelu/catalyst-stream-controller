import { describe, it, expect, beforeEach } from 'vitest';
import { validateManifest, isHostVersionCompatible, loadSinglePlugin } from '../../../src/main/plugins/PluginLoader';
import { setFile, resetMockFs } from '../../mocks/fs';

// ─── Helpers ────────────────────────────────────────────────────

/** A minimal valid manifest object */
function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    actions: {
      action1: {
        label: 'Action 1',
        params: { param1: { key: 'param1', type: 'text', label: 'Param 1' } }
      }
    },
    connection: {
      defaults: { url: 'ws://localhost' },
      fields: [{ key: 'url', type: 'text', label: 'URL' }]
    },
    state: {
      defaults: { connected: false }
    },
    ...overrides
  };
}

// ─── validateManifest ───────────────────────────────────────────

describe('validateManifest', () => {
  it('should accept a valid manifest', () => {
    expect(validateManifest(validManifest())).toBeNull();
  });

  it('should reject null', () => {
    expect(validateManifest(null)).toBe('manifest.json must be a JSON object');
  });

  it('should reject undefined', () => {
    expect(validateManifest(undefined)).toBe('manifest.json must be a JSON object');
  });

  it('should reject non-objects', () => {
    expect(validateManifest('string')).toBe('manifest.json must be a JSON object');
    expect(validateManifest(42)).toBe('manifest.json must be a JSON object');
    expect(validateManifest(true)).toBe('manifest.json must be a JSON object');
  });

  // ─── Required Fields ──────────────────────────────────────

  const requiredFields = ['id', 'name', 'version', 'actions'];

  for (const field of requiredFields) {
    it(`should reject manifest missing "${field}"`, () => {
      const m = validManifest();
      delete (m as Record<string, unknown>)[field];
      const error = validateManifest(m);
      expect(error).toContain(field);
    });
  }

  it('should reject null values for required fields', () => {
    const m = validManifest({ id: null });
    const error = validateManifest(m);
    expect(error).toContain('id');
  });

  // ─── Type Checking ────────────────────────────────────────

  it('should reject non-string id', () => {
    expect(validateManifest(validManifest({ id: 42 }))).toContain('"id" must be a non-empty string');
  });

  it('should reject empty string id', () => {
    expect(validateManifest(validManifest({ id: '' }))).toContain('"id" must be a non-empty string');
  });

  it('should reject non-string name', () => {
    expect(validateManifest(validManifest({ name: 123 }))).toContain('"name" must be a non-empty string');
  });

  it('should reject empty string name', () => {
    expect(validateManifest(validManifest({ name: '' }))).toContain('"name" must be a non-empty string');
  });

  it('should reject non-string version', () => {
    expect(validateManifest(validManifest({ version: 1 }))).toContain('"version" must be a non-empty string');
  });

  it('should reject non-object actions', () => {
    expect(validateManifest(validManifest({ actions: 'nope' }))).toContain('"actions" must be an object');
  });

  it('should accept manifest without connection', () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).connection;
    expect(validateManifest(m)).toBeNull();
  });

  it('should reject non-object connection when provided', () => {
    expect(validateManifest(validManifest({ connection: 42 }))).toContain('"connection" must be an object');
  });

  it('should reject connection without defaults', () => {
    expect(validateManifest(validManifest({ connection: { fields: [] } }))).toContain(
      '"connection.defaults" must be an object'
    );
  });

  it('should reject connection without fields array', () => {
    expect(validateManifest(validManifest({ connection: { defaults: {}, fields: {} } }))).toContain(
      '"connection.fields" must be an array'
    );
  });

  it('should accept manifest without state', () => {
    const m = validManifest();
    delete (m as Record<string, unknown>).state;
    expect(validateManifest(m)).toBeNull();
  });

  it('should reject non-object state when provided', () => {
    expect(validateManifest(validManifest({ state: 'bad' }))).toContain('"state" must be an object');
  });

  it('should reject state without defaults', () => {
    expect(validateManifest(validManifest({ state: {} }))).toContain('"state.defaults" must be an object');
  });

  // ─── Valid Edge Cases ─────────────────────────────────────

  it('should accept manifest with extra fields', () => {
    const m = validManifest({ description: 'A plugin', minHostVersion: '0.1.0', icon: '🎮' });
    expect(validateManifest(m)).toBeNull();
  });

  it('should accept manifest with empty objects for optional nested data', () => {
    const m = validManifest({
      actions: {},
      connection: { defaults: {}, fields: [] },
      state: { defaults: {} }
    });
    expect(validateManifest(m)).toBeNull();
  });

  it('should accept manifest without connection or state', () => {
    const m = {
      id: 'minimal',
      name: 'Minimal Plugin',
      version: '0.1.0',
      actions: { 'do-thing': { label: 'Do Thing' } }
    };
    expect(validateManifest(m)).toBeNull();
  });
});

// ─── isHostVersionCompatible ────────────────────────────────────

describe('isHostVersionCompatible', () => {
  it('should return true when no minHostVersion is specified', () => {
    expect(isHostVersionCompatible(undefined, '1.0.0')).toBe(true);
  });

  it('should return true when versions match exactly', () => {
    expect(isHostVersionCompatible('1.0.0', '1.0.0')).toBe(true);
  });

  it('should return true when app version is higher major', () => {
    expect(isHostVersionCompatible('1.0.0', '2.0.0')).toBe(true);
  });

  it('should return true when app version is higher minor', () => {
    expect(isHostVersionCompatible('1.2.0', '1.3.0')).toBe(true);
  });

  it('should return true when app version is higher patch', () => {
    expect(isHostVersionCompatible('1.0.0', '1.0.1')).toBe(true);
  });

  it('should return false when app version is lower major', () => {
    expect(isHostVersionCompatible('2.0.0', '1.0.0')).toBe(false);
  });

  it('should return false when app version is lower minor', () => {
    expect(isHostVersionCompatible('1.3.0', '1.2.0')).toBe(false);
  });

  it('should return false when app version is lower patch', () => {
    expect(isHostVersionCompatible('1.0.2', '1.0.1')).toBe(false);
  });

  it('should handle v-prefix in minHostVersion', () => {
    expect(isHostVersionCompatible('v1.0.0', '1.0.0')).toBe(true);
  });

  it('should handle v-prefix in app version', () => {
    expect(isHostVersionCompatible('1.0.0', 'v1.0.0')).toBe(true);
  });

  it('should handle partial versions', () => {
    expect(isHostVersionCompatible('1', '1.0.0')).toBe(true);
    expect(isHostVersionCompatible('1.0', '1.0.0')).toBe(true);
  });

  it('should handle zero versions', () => {
    expect(isHostVersionCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isHostVersionCompatible('0.2.0', '0.1.0')).toBe(false);
  });
});

// ─── loadSinglePlugin ───────────────────────────────────────────

describe('loadSinglePlugin', () => {
  const pluginDir = '/mock/plugins/test-plugin';

  beforeEach(() => {
    resetMockFs();
  });

  it('should return error when manifest.json is missing', async () => {
    // No files set in mock fs
    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('manifest.json not found');
  });

  it('should return error when manifest.json has invalid JSON', async () => {
    setFile(`${pluginDir}/manifest.json`, 'not json {{{');

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Invalid JSON');
  });

  it('should return error when manifest fails validation', async () => {
    setFile(`${pluginDir}/manifest.json`, JSON.stringify({ id: 'test' })); // missing fields

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('missing required field');
  });

  it('should return error when host version is incompatible', async () => {
    const manifest = validManifest({ minHostVersion: '2.0.0' });
    setFile(`${pluginDir}/manifest.json`, JSON.stringify(manifest));

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('requires host version');
  });

  it('should return error when dist/index.js is missing', async () => {
    const manifest = validManifest();
    setFile(`${pluginDir}/manifest.json`, JSON.stringify(manifest));
    // dist/index.js not created

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('entry point not found');
  });

  it('should validate manifest before checking entry point', async () => {
    // Manifest has all fields but id is empty — should fail validation
    const manifest = validManifest({ id: '' });
    setFile(`${pluginDir}/manifest.json`, JSON.stringify(manifest));
    setFile(`${pluginDir}/dist/index.js`, 'module.exports = {}');

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    expect(result).toHaveProperty('error');
    // Should fail on validation, not on import
    expect((result as { error: string }).error).toContain('must be a non-empty string');
  });

  it('should accept compatible minHostVersion', async () => {
    const manifest = validManifest({ minHostVersion: '0.1.0' });
    setFile(`${pluginDir}/manifest.json`, JSON.stringify(manifest));
    setFile(`${pluginDir}/dist/index.js`, 'export function createClient() {}');

    const result = await loadSinglePlugin(pluginDir, '1.0.0');
    // Will fail at import stage (can't import from mock fs), but should NOT fail at version check
    if ('error' in result) {
      expect(result.error).not.toContain('requires host version');
    }
  });
});
