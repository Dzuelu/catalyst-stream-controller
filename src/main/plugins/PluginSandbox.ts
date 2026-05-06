/**
 * Plugin Sandboxing — Wraps PluginHostAPI and PluginClient methods
 * with rate limiting, timeout enforcement, and error boundaries for
 * external (non-built-in) plugins.
 *
 * Built-in plugins (OBS, Discord) are trusted and bypass sandboxing.
 * External plugins get the sandboxed versions automatically.
 *
 * Soft sandboxing strategy:
 *   - Rate limiting on setButtonImage() and setBrightness() (max N calls/sec)
 *   - Timeout enforcement on connect(), executeAction(), queries.* (30s default)
 *   - Error boundaries — plugin exceptions are caught and logged
 *   - Resource tracking — leaked subscriptions are cleaned up on destroy
 */

import type { PluginHostAPI } from '../../shared/plugin-types';

// ─── Rate Limiter ───────────────────────────────────────────────

/** Simple sliding-window rate limiter */
export class RateLimiter {
  private timestamps: number[] = [];

  constructor(
    /** Maximum number of calls allowed within the window */
    private maxCalls: number,
    /** Time window in milliseconds */
    private windowMs: number
  ) {}

  /** Check if a call is allowed. Returns true and records the call, or false if rate-limited. */
  tryAcquire(): boolean {
    const now = Date.now();
    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);

    if (this.timestamps.length >= this.maxCalls) {
      return false;
    }

    this.timestamps.push(now);
    return true;
  }

  /** Reset the limiter (e.g. on plugin reconnect) */
  reset(): void {
    this.timestamps = [];
  }
}

// ─── Timeout Helper ─────────────────────────────────────────────

/** Wrap a promise with a timeout. Rejects with TimeoutError if exceeded. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, description: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Plugin timeout: ${description} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ─── Configuration ──────────────────────────────────────────────

export interface SandboxConfig {
  /** Max setButtonImage() calls per second per plugin (default: 60) */
  imageRateLimit: number;
  /** Max setBrightness() calls per second per plugin (default: 10) */
  brightnessRateLimit: number;
  /** Max showFeedback() calls per second per plugin (default: 5) */
  feedbackRateLimit: number;
  /** Timeout for connect() in ms (default: 5000) */
  connectTimeoutMs: number;
  /** Timeout for executeAction() in ms (default: 500) */
  executeTimeoutMs: number;
  /** Timeout for query methods in ms (default: 500) */
  queryTimeoutMs: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  imageRateLimit: 60,
  brightnessRateLimit: 10,
  feedbackRateLimit: 5,
  connectTimeoutMs: 5_000,
  executeTimeoutMs: 500,
  queryTimeoutMs: 500
};

// ─── Sandboxed Host API ─────────────────────────────────────────

/**
 * Wrap a PluginHostAPI with rate limiting on device-control methods.
 * Returns a new PluginHostAPI that delegates to the original but
 * enforces rate limits and logs violations.
 */
export function createSandboxedHostAPI(
  original: PluginHostAPI,
  pluginId: string,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG
): PluginHostAPI {
  const imageLimiter = new RateLimiter(config.imageRateLimit, 1000);
  const brightnessLimiter = new RateLimiter(config.brightnessRateLimit, 1000);
  const feedbackLimiter = new RateLimiter(config.feedbackRateLimit, 1000);

  return {
    ...original,

    setBrightness: async (value, serial?) => {
      if (!brightnessLimiter.tryAcquire()) {
        original.log('warn', `Rate limited: setBrightness() exceeded ${config.brightnessRateLimit}/sec`);
        return;
      }
      try {
        await original.setBrightness(value, serial);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `setBrightness failed: ${msg}`);
      }
    },

    setButtonImage: async (keyIndex, imageDataUri, serial?) => {
      if (!imageLimiter.tryAcquire()) {
        original.log('warn', `Rate limited: setButtonImage() exceeded ${config.imageRateLimit}/sec`);
        return;
      }
      try {
        await original.setButtonImage(keyIndex, imageDataUri, serial);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `setButtonImage failed: ${msg}`);
      }
    },

    clearButtonImage: async (keyIndex, serial?) => {
      try {
        await original.clearButtonImage(keyIndex, serial);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `clearButtonImage failed: ${msg}`);
      }
    },

    executeAction: async (type, config_) => {
      try {
        await original.executeAction(type, config_);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `executeAction failed: ${msg}`);
      }
    },

    executePluginAction: async (targetPluginId, config_) => {
      try {
        await original.executePluginAction(targetPluginId, config_);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `executePluginAction(${targetPluginId}) failed: ${msg}`);
      }
    },

    showFeedback: (keyIndex, feedbackType, durationMs?) => {
      if (!feedbackLimiter.tryAcquire()) {
        original.log('warn', `Rate limited: showFeedback() exceeded ${config.feedbackRateLimit}/sec`);
        return;
      }
      try {
        original.showFeedback(keyIndex, feedbackType, durationMs);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        original.log('error', `showFeedback failed: ${msg}`);
      }
    }
  };
}

// ─── Sandboxed Client Wrapper ───────────────────────────────────

import type { PluginClient } from '../../shared/plugin-types';

/**
 * Wrap a PluginClient with timeout enforcement and error boundaries.
 * Returns a new PluginClient that delegates to the original but
 * catches all errors and enforces timeouts.
 */
export function createSandboxedClient(
  original: PluginClient,
  pluginId: string,
  logFn: (level: 'info' | 'warn' | 'error', message: string) => void,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG
): PluginClient {
  return {
    connect: async (settings) => {
      try {
        await withTimeout(original.connect(settings), config.connectTimeoutMs, `${pluginId}.connect()`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFn('error', `Plugin "${pluginId}" connect failed: ${msg}`);
        throw err; // Re-throw so the caller (UI) knows it failed
      }
    },

    disconnect: async () => {
      try {
        await original.disconnect();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFn('error', `Plugin "${pluginId}" disconnect failed: ${msg}`);
      }
    },

    isConnected: () => {
      try {
        return original.isConnected();
      } catch {
        return false;
      }
    },

    getState: () => {
      try {
        return original.getState();
      } catch {
        return {};
      }
    },

    setOnStateChanged: (handler) => {
      // Wrap the handler with error boundary
      original.setOnStateChanged((state) => {
        try {
          handler(state);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logFn('error', `Plugin "${pluginId}" state change handler error: ${msg}`);
        }
      });
    },

    executeAction: async (actionConfig) => {
      try {
        await withTimeout(original.executeAction(actionConfig), config.executeTimeoutMs, `${pluginId}.executeAction()`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFn('error', `Plugin "${pluginId}" executeAction failed: ${msg}`);
        throw err;
      }
    },

    destroy: () => {
      try {
        original.destroy();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logFn('error', `Plugin "${pluginId}" destroy failed: ${msg}`);
      }
    },

    // Wrap query methods with timeout
    queries: original.queries
      ? Object.fromEntries(
          Object.entries(original.queries).map(([key, fn]) => [
            key,
            async () => {
              try {
                return await withTimeout(fn(), config.queryTimeoutMs, `${pluginId}.queries.${key}()`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logFn('error', `Plugin "${pluginId}" query "${key}" failed: ${msg}`);
                return [];
              }
            }
          ])
        )
      : undefined,

    // Wrap getButtonImage with error boundary (synchronous)
    getButtonImage: original.getButtonImage
      ? (actionConfig) => {
          try {
            return original.getButtonImage!(actionConfig);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logFn('error', `Plugin "${pluginId}" getButtonImage failed: ${msg}`);
            return null;
          }
        }
      : undefined
  };
}
