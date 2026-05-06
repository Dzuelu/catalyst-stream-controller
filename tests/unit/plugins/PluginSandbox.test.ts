import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimiter,
  withTimeout,
  createSandboxedHostAPI,
  createSandboxedClient,
  DEFAULT_SANDBOX_CONFIG
} from '../../../src/main/plugins/PluginSandbox';
import type { PluginHostAPI, PluginClient } from '../../../src/shared/plugin-types';

// ─── Helpers ────────────────────────────────────────────────────

function createMockHostAPI(): PluginHostAPI {
  return {
    setBrightness: vi.fn(async () => {}),
    setButtonImage: vi.fn(async () => {}),
    clearButtonImage: vi.fn(async () => {}),
    getDevices: vi.fn(() => []),
    executeAction: vi.fn(async () => {}),
    executePluginAction: vi.fn(async () => {}),
    getPluginInfo: vi.fn(() => null),
    getRegisteredPlugins: vi.fn(() => []),
    onButtonDown: vi.fn(() => () => {}),
    onButtonUp: vi.fn(() => () => {}),
    onKnobRotate: vi.fn(() => () => {}),
    onKnobPress: vi.fn(() => () => {}),
    onProfileChanged: vi.fn(() => () => {}),
    onPageChanged: vi.fn(() => () => {}),
    onDeviceConnected: vi.fn(() => () => {}),
    onDeviceDisconnected: vi.fn(() => () => {}),
    onSystemWakeUp: vi.fn(() => () => {}),
    showFeedback: vi.fn(),
    log: vi.fn(),
    getOwnSettings: vi.fn(() => ({})),
    saveOwnSettings: vi.fn(async () => {}),
    createImage: {
      solidColor: vi.fn(() => 'data:image/png;base64,mock'),
      textImage: vi.fn(() => 'data:image/png;base64,mock')
    }
  };
}

function createMockClient(): PluginClient {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    getState: vi.fn(() => ({ status: 'connected' })),
    setOnStateChanged: vi.fn(),
    executeAction: vi.fn(async () => {}),
    destroy: vi.fn(),
    queries: {
      getScenes: vi.fn(async () => [{ value: 'scene1', label: 'Scene 1' }])
    },
    getButtonImage: vi.fn(() => 'data:image/png;base64,abc')
  };
}

// ─── RateLimiter ────────────────────────────────────────────────

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow calls within the limit', () => {
    const limiter = new RateLimiter(3, 1000);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('should reject calls exceeding the limit', () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should allow calls again after the window expires', () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(1001);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('should use a sliding window', () => {
    const limiter = new RateLimiter(2, 1000);

    expect(limiter.tryAcquire()).toBe(true); // t=0
    vi.advanceTimersByTime(500);
    expect(limiter.tryAcquire()).toBe(true); // t=500
    expect(limiter.tryAcquire()).toBe(false); // still 2 in window

    // Advance to t=1001, first call should have expired
    vi.advanceTimersByTime(501);
    expect(limiter.tryAcquire()).toBe(true); // t=1001, first expired
  });

  it('should reset the limiter', () => {
    const limiter = new RateLimiter(1, 1000);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    limiter.reset();

    expect(limiter.tryAcquire()).toBe(true);
  });

  it('should handle single-call limit', () => {
    const limiter = new RateLimiter(1, 500);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    vi.advanceTimersByTime(501);
    expect(limiter.tryAcquire()).toBe(true);
  });
});

// ─── withTimeout ────────────────────────────────────────────────

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve when the promise completes within timeout', async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 100);
    });

    const resultPromise = withTimeout(promise, 1000, 'test-op');
    vi.advanceTimersByTime(100);
    const result = await resultPromise;

    expect(result).toBe('done');
  });

  it('should reject when the promise exceeds timeout', async () => {
    const promise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 2000);
    });

    const resultPromise = withTimeout(promise, 500, 'slow-op');
    vi.advanceTimersByTime(501);

    await expect(resultPromise).rejects.toThrow('Plugin timeout: slow-op exceeded 500ms');
  });

  it('should reject with original error when promise fails within timeout', async () => {
    const promise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('connection failed')), 100);
    });

    const resultPromise = withTimeout(promise, 1000, 'test-op');
    vi.advanceTimersByTime(100);

    await expect(resultPromise).rejects.toThrow('connection failed');
  });

  it('should include the description in timeout errors', async () => {
    const promise = new Promise<void>(() => {}); // never resolves

    const resultPromise = withTimeout(promise, 100, 'myPlugin.connect()');
    vi.advanceTimersByTime(101);

    await expect(resultPromise).rejects.toThrow('myPlugin.connect()');
  });
});

// ─── createSandboxedHostAPI ─────────────────────────────────────

describe('createSandboxedHostAPI', () => {
  let mockHost: PluginHostAPI;

  beforeEach(() => {
    vi.useFakeTimers();
    mockHost = createMockHostAPI();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delegate non-rate-limited methods directly', () => {
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    sandboxed.getDevices();
    expect(mockHost.getDevices).toHaveBeenCalled();

    sandboxed.getPluginInfo('obs');
    expect(mockHost.getPluginInfo).toHaveBeenCalledWith('obs');

    sandboxed.getRegisteredPlugins();
    expect(mockHost.getRegisteredPlugins).toHaveBeenCalled();

    sandboxed.log('info', 'hello');
    expect(mockHost.log).toHaveBeenCalledWith('info', 'hello');

    sandboxed.getOwnSettings();
    expect(mockHost.getOwnSettings).toHaveBeenCalled();
  });

  it('should delegate event subscriptions', () => {
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');
    const cb = vi.fn();

    sandboxed.onButtonDown(cb);
    expect(mockHost.onButtonDown).toHaveBeenCalledWith(cb);

    sandboxed.onButtonUp(cb);
    expect(mockHost.onButtonUp).toHaveBeenCalledWith(cb);
  });

  it('should rate-limit setButtonImage', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, imageRateLimit: 2 };
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin', config);

    // First 2 calls should go through
    await sandboxed.setButtonImage(0, 'data:img1');
    await sandboxed.setButtonImage(1, 'data:img2');
    expect(mockHost.setButtonImage).toHaveBeenCalledTimes(2);

    // Third call should be rate-limited
    await sandboxed.setButtonImage(2, 'data:img3');
    expect(mockHost.setButtonImage).toHaveBeenCalledTimes(2);
    expect(mockHost.log).toHaveBeenCalledWith('warn', expect.stringContaining('Rate limited'));
  });

  it('should rate-limit setBrightness', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, brightnessRateLimit: 1 };
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin', config);

    await sandboxed.setBrightness(0.5);
    expect(mockHost.setBrightness).toHaveBeenCalledTimes(1);

    await sandboxed.setBrightness(0.8);
    expect(mockHost.setBrightness).toHaveBeenCalledTimes(1); // rate-limited
    expect(mockHost.log).toHaveBeenCalledWith('warn', expect.stringContaining('Rate limited'));
  });

  it('should allow rate-limited calls after the window expires', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, imageRateLimit: 1 };
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin', config);

    await sandboxed.setButtonImage(0, 'data:img1');
    await sandboxed.setButtonImage(1, 'data:img2'); // rate-limited

    vi.advanceTimersByTime(1001);

    await sandboxed.setButtonImage(2, 'data:img3');
    expect(mockHost.setButtonImage).toHaveBeenCalledTimes(2);
  });

  it('should catch errors in setButtonImage and log them', async () => {
    (mockHost.setButtonImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('device error'));
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    // Should not throw
    await sandboxed.setButtonImage(0, 'data:img');
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('setButtonImage failed'));
  });

  it('should catch errors in setBrightness and log them', async () => {
    (mockHost.setBrightness as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('hw error'));
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    await sandboxed.setBrightness(0.5);
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('setBrightness failed'));
  });

  it('should catch errors in executeAction and log them', async () => {
    (mockHost.executeAction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('oops'));
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    await sandboxed.executeAction('hotkey', { key: 'A' });
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('executeAction failed'));
  });

  it('should catch errors in executePluginAction and log them', async () => {
    (mockHost.executePluginAction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    await sandboxed.executePluginAction('obs', { action: 'switch-scene' });
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('executePluginAction(obs) failed'));
  });

  it('should catch errors in clearButtonImage and log them', async () => {
    (mockHost.clearButtonImage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    await sandboxed.clearButtonImage(0);
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('clearButtonImage failed'));
  });

  it('should rate-limit showFeedback', () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, feedbackRateLimit: 2 };
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin', config);

    sandboxed.showFeedback(0, 'ok');
    sandboxed.showFeedback(1, 'alert');
    expect(mockHost.showFeedback).toHaveBeenCalledTimes(2);

    // Third call should be rate-limited
    sandboxed.showFeedback(2, 'ok');
    expect(mockHost.showFeedback).toHaveBeenCalledTimes(2);
    expect(mockHost.log).toHaveBeenCalledWith('warn', expect.stringContaining('Rate limited'));
  });

  it('should catch errors in showFeedback and log them', () => {
    (mockHost.showFeedback as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('feedback error');
    });
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    sandboxed.showFeedback(0, 'ok');
    expect(mockHost.log).toHaveBeenCalledWith('error', expect.stringContaining('showFeedback failed'));
  });

  it('should delegate showFeedback with custom duration', () => {
    const sandboxed = createSandboxedHostAPI(mockHost, 'test-plugin');

    sandboxed.showFeedback(5, 'alert', 2000);
    expect(mockHost.showFeedback).toHaveBeenCalledWith(5, 'alert', 2000);
  });
});

// ─── createSandboxedClient ──────────────────────────────────────

describe('createSandboxedClient', () => {
  let mockClient: PluginClient;
  let logFn: (level: 'info' | 'warn' | 'error', message: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = createMockClient();
    logFn = vi.fn() as unknown as typeof logFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delegate connect with timeout enforcement', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, connectTimeoutMs: 500 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    await sandboxed.connect({ url: 'ws://localhost:4455' });
    expect(mockClient.connect).toHaveBeenCalledWith({ url: 'ws://localhost:4455' });
  });

  it('should reject connect on timeout', async () => {
    const slowConnect = vi.fn(() => new Promise<void>(() => {})); // never resolves
    mockClient.connect = slowConnect;

    const config = { ...DEFAULT_SANDBOX_CONFIG, connectTimeoutMs: 200 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    const promise = sandboxed.connect({ url: 'ws://localhost' });
    vi.advanceTimersByTime(201);

    await expect(promise).rejects.toThrow('Plugin timeout');
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('connect failed'));
  });

  it('should re-throw connect errors', async () => {
    (mockClient.connect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('refused'));

    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);
    await expect(sandboxed.connect({})).rejects.toThrow('refused');
  });

  it('should delegate disconnect with error boundary', async () => {
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    await sandboxed.disconnect();
    expect(mockClient.disconnect).toHaveBeenCalled();
  });

  it('should catch disconnect errors', async () => {
    (mockClient.disconnect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('cleanup fail'));
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    // Should NOT throw
    await sandboxed.disconnect();
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('disconnect failed'));
  });

  it('should return false from isConnected on error', () => {
    (mockClient.isConnected as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    expect(sandboxed.isConnected()).toBe(false);
  });

  it('should return empty object from getState on error', () => {
    (mockClient.getState as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    expect(sandboxed.getState()).toEqual({});
  });

  it('should wrap state change handler with error boundary', () => {
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);
    const handler = vi.fn(() => {
      throw new Error('handler crash');
    });

    sandboxed.setOnStateChanged(handler);

    // Get the wrapped handler that was passed to the original
    const wrappedHandler = (mockClient.setOnStateChanged as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Call it — should NOT throw
    wrappedHandler({ status: 'connected' });
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('state change handler error'));
  });

  it('should delegate executeAction with timeout', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, executeTimeoutMs: 300 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    await sandboxed.executeAction({ action: 'switch-scene' });
    expect(mockClient.executeAction).toHaveBeenCalledWith({ action: 'switch-scene' });
  });

  it('should timeout executeAction', async () => {
    (mockClient.executeAction as ReturnType<typeof vi.fn>).mockReturnValue(new Promise<void>(() => {}));
    const config = { ...DEFAULT_SANDBOX_CONFIG, executeTimeoutMs: 100 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    const promise = sandboxed.executeAction({ action: 'test' });
    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toThrow('Plugin timeout');
  });

  it('should delegate destroy with error boundary', () => {
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    sandboxed.destroy();
    expect(mockClient.destroy).toHaveBeenCalled();
  });

  it('should catch destroy errors', () => {
    (mockClient.destroy as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('cleanup fail');
    });
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    // Should NOT throw
    sandboxed.destroy();
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('destroy failed'));
  });

  it('should wrap query methods with timeout', async () => {
    const config = { ...DEFAULT_SANDBOX_CONFIG, queryTimeoutMs: 200 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    const result = await sandboxed.queries!.getScenes();
    expect(result).toEqual([{ value: 'scene1', label: 'Scene 1' }]);
  });

  it('should timeout slow query methods', async () => {
    mockClient.queries = {
      getScenes: vi.fn((): Promise<{ value: string; label: string }[]> => new Promise(() => {})) // never resolves
    };
    const config = { ...DEFAULT_SANDBOX_CONFIG, queryTimeoutMs: 100 };
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn, config);

    const promise = sandboxed.queries!.getScenes();
    vi.advanceTimersByTime(101);

    const result = await promise;
    expect(result).toEqual([]); // returns empty array on timeout
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('query "getScenes" failed'));
  });

  it('should wrap getButtonImage with error boundary', () => {
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    const result = sandboxed.getButtonImage!({ action: 'test' });
    expect(result).toBe('data:image/png;base64,abc');
  });

  it('should return null from getButtonImage on error', () => {
    mockClient.getButtonImage = vi.fn(() => {
      throw new Error('render fail');
    });
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    const result = sandboxed.getButtonImage!({ action: 'test' });
    expect(result).toBeNull();
    expect(logFn).toHaveBeenCalledWith('error', expect.stringContaining('getButtonImage failed'));
  });

  it('should handle client without queries', () => {
    delete mockClient.queries;
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    expect(sandboxed.queries).toBeUndefined();
  });

  it('should handle client without getButtonImage', () => {
    delete mockClient.getButtonImage;
    const sandboxed = createSandboxedClient(mockClient, 'test-plugin', logFn);

    expect(sandboxed.getButtonImage).toBeUndefined();
  });
});
