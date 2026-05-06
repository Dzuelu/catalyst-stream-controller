import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Use the REAL ws module (not the Discord RPC mock from setup.ts)
vi.unmock('ws');
import { WebSocket } from 'ws';

// Mock KeyRenderer (used by VirtualManagedDevice.drawKey)
vi.mock('../../../src/main/rendering/KeyRenderer', () => ({
  renderKey: vi.fn(async () => 'data:image/png;base64,TEST_KEY_IMAGE')
}));

// Mock qrcode
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,MOCK_QR_CODE')
  }
}));

import {
  validatePin,
  DEFAULT_WEB_SERVER_PORT,
  DEFAULT_PIN,
  BINARY_MSG_KEY_IMAGE,
  type WebServerStatus
} from '../../../src/main/devices/virtual/web-companion-protocol';
import { VirtualWebServer, getLocalIpAddress } from '../../../src/main/devices/virtual/VirtualWebServer';
import { VirtualDriver } from '../../../src/main/devices/virtual/VirtualDriver';
import type { VirtualDeviceConfig } from '../../../src/main/devices/virtual/VirtualDeviceConfig';

/** Path used by VirtualDriver when given explicit dataPath */
const TEST_DATA_PATH = '/tmp/virtual-web-server-test-devices.json';

/** Find a free port by binding to port 0 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error('Could not get port'));
      }
    });
  });
}

/** Create a valid config for testing */
function makeConfig(overrides: Partial<VirtualDeviceConfig> = {}): VirtualDeviceConfig {
  return {
    id: `virtual-test-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    name: 'Test Deck',
    rows: 3,
    columns: 5,
    keySize: 96,
    encoders: 0,
    encoderPosition: 'none',
    sliders: 0,
    sliderPosition: 'none',
    ...overrides
  };
}

/** Track all WebSocket clients for cleanup */
const openClients: WebSocket[] = [];

/** Connect a WebSocket and track it for cleanup */
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    openClients.push(ws);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Send JSON and wait for a response matching a type */
function sendAndWait(
  ws: WebSocket,
  msg: object,
  expectedType: string,
  timeout = 3000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${expectedType}"`)), timeout);
    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === expectedType) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(parsed);
        }
      } catch {
        // Not JSON — ignore binary messages
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

/** Wait for a message of a specific type */
function _waitForMessage(ws: WebSocket, expectedType: string, timeout = 3000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${expectedType}"`)), timeout);
    const handler = (data: Buffer | string) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === expectedType) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(parsed);
        }
      } catch {
        // Not JSON — ignore
      }
    };
    ws.on('message', handler);
  });
}

/** Authenticate a WebSocket connection */
async function authenticateWs(ws: WebSocket, pin = DEFAULT_PIN): Promise<Record<string, unknown>> {
  return sendAndWait(ws, { type: 'auth', pin }, 'auth-result');
}

// ═══════════════════════════════════════════════════════════════════
//  Protocol Utilities
// ═══════════════════════════════════════════════════════════════════

describe('web-companion-protocol', () => {
  describe('validatePin', () => {
    it('should accept a valid 4-digit PIN', () => {
      expect(validatePin('1234')).toBeNull();
    });

    it('should accept a valid 8-digit PIN', () => {
      expect(validatePin('12345678')).toBeNull();
    });

    it('should reject too short PIN', () => {
      expect(validatePin('12')).toContain('at least 4');
    });

    it('should reject too long PIN', () => {
      expect(validatePin('123456789')).toContain('at most 8');
    });

    it('should reject empty PIN', () => {
      expect(validatePin('')).not.toBeNull();
    });

    it('should reject non-digit PIN', () => {
      expect(validatePin('abcd')).toContain('digits');
    });

    it('should reject mixed PIN', () => {
      expect(validatePin('12ab')).toContain('digits');
    });
  });

  it('should have expected default values', () => {
    expect(DEFAULT_WEB_SERVER_PORT).toBe(9120);
    expect(DEFAULT_PIN).toBe('0000');
    expect(BINARY_MSG_KEY_IMAGE).toBe(0x01);
  });
});

// ═══════════════════════════════════════════════════════════════════
//  getLocalIpAddress
// ═══════════════════════════════════════════════════════════════════

describe('getLocalIpAddress', () => {
  it('should return a string or null', () => {
    const ip = getLocalIpAddress();
    if (ip !== null) {
      expect(typeof ip).toBe('string');
      // Should look like an IPv4 address
      expect(ip).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
//  VirtualWebServer — Core Lifecycle
// ═══════════════════════════════════════════════════════════════════

describe('VirtualWebServer', () => {
  let driver: VirtualDriver;
  let server: VirtualWebServer;
  let testPort: number;

  beforeEach(async () => {
    driver = new VirtualDriver(TEST_DATA_PATH);
    testPort = await getFreePort();
    server = new VirtualWebServer(driver, { port: testPort, pin: '1234' });
  });

  afterEach(async () => {
    // Terminate any open client WebSockets first
    for (const ws of openClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    openClients.length = 0;
    if (server.isRunning()) {
      await server.stop();
    }
  });

  // ─── Lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('should start and report running status', async () => {
      await server.start();
      expect(server.isRunning()).toBe(true);
      const status = server.getStatus();
      expect(status.running).toBe(true);
      expect(status.port).toBe(testPort);
    });

    it('should stop after starting', async () => {
      await server.start();
      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should throw if started twice', async () => {
      await server.start();
      await expect(server.start()).rejects.toThrow('already running');
    });

    it('should not throw when stopping while not running', async () => {
      await expect(server.stop()).resolves.not.toThrow();
    });

    it('should allow restart after stop', async () => {
      await server.start();
      await server.stop();
      await server.start();
      expect(server.isRunning()).toBe(true);
    });

    it('should accept a port override on start', async () => {
      const newPort = await getFreePort();
      await server.start(newPort);
      expect(server.getPort()).toBe(newPort);
      expect(server.getStatus().port).toBe(newPort);
    });

    it('should emit status-changed on start and stop', async () => {
      const statuses: WebServerStatus[] = [];
      server.on('status-changed', (s: WebServerStatus) => statuses.push(s));

      await server.start();
      await server.stop();

      expect(statuses.length).toBe(2);
      expect(statuses[0].running).toBe(true);
      expect(statuses[1].running).toBe(false);
    });
  });

  // ─── PIN management ────────────────────────────────────────

  describe('PIN management', () => {
    it('should get the configured PIN', () => {
      expect(server.getPin()).toBe('1234');
    });

    it('should set a valid PIN', () => {
      server.setPin('5678');
      expect(server.getPin()).toBe('5678');
    });

    it('should reject an invalid PIN', () => {
      expect(() => server.setPin('ab')).toThrow();
    });

    it('should include PIN in status', () => {
      const status = server.getStatus();
      expect(status.pin).toBe('1234');
    });
  });

  // ─── Status ────────────────────────────────────────────────

  describe('status', () => {
    it('should report not running initially', () => {
      const status = server.getStatus();
      expect(status.running).toBe(false);
      expect(status.connectedClients).toBe(0);
    });

    it('should have 0 authenticated clients initially', () => {
      expect(server.getAuthenticatedClientCount()).toBe(0);
    });

    it('should return a connection URL when running', async () => {
      await server.start();
      const url = server.getConnectionUrl();
      if (url) {
        expect(url).toContain(String(testPort));
      }
    });

    it('should return null connection URL when not running', () => {
      expect(server.getConnectionUrl()).toBeNull();
    });
  });

  // ─── QR Code ───────────────────────────────────────────────

  describe('QR code', () => {
    it('should return null when server not running', async () => {
      const qr = await server.getQrCode();
      expect(qr).toBeNull();
    });

    it('should return a data URI when running', async () => {
      await server.start();
      const qr = await server.getQrCode();
      if (server.getConnectionUrl()) {
        expect(qr).toContain('data:image/png;base64');
      }
    });
  });

  // ─── HTTP Endpoints ────────────────────────────────────────

  describe('HTTP endpoints', () => {
    beforeEach(async () => {
      await server.start();
    });

    function httpGet(path: string): Promise<{ status: number; body: string }> {
      return new Promise((resolve, reject) => {
        http
          .get(`http://127.0.0.1:${testPort}${path}`, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
          })
          .on('error', reject);
      });
    }

    it('GET / should serve the web companion app', async () => {
      const { status, body } = await httpGet('/');
      expect(status).toBe(200);
      expect(body).toContain('Web Companion');
      expect(body).toContain('pin-screen');
      expect(body).toContain('deck-screen');
    });

    it('GET /api/devices should return empty list initially', async () => {
      const { status, body } = await httpGet('/api/devices');
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.devices).toEqual([]);
    });

    it('GET /api/devices should list virtual devices', async () => {
      const config = makeConfig({ id: 'virtual-http-test-1', name: 'HTTP Test Deck' });
      await driver.createDevice(config);

      const { status, body } = await httpGet('/api/devices');
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.devices).toEqual([{ id: 'virtual-http-test-1', name: 'HTTP Test Deck' }]);
    });

    it('GET /api/device/:id/config should return device config', async () => {
      const config = makeConfig({
        id: 'virtual-http-test-2',
        name: 'Config Test',
        rows: 2,
        columns: 3,
        keySize: 72
      });
      await driver.createDevice(config);

      const { status, body } = await httpGet('/api/device/virtual-http-test-2/config');
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.deviceId).toBe('virtual-http-test-2');
      expect(data.rows).toBe(2);
      expect(data.cols).toBe(3);
      expect(data.keySize).toBe(72);
    });

    it('GET /api/device/:id/config should 404 for unknown device', async () => {
      const { status } = await httpGet('/api/device/nonexistent/config');
      expect(status).toBe(404);
    });

    it('GET /api/health should return ok', async () => {
      const { status, body } = await httpGet('/api/health');
      expect(status).toBe(200);
      const data = JSON.parse(body);
      expect(data.status).toBe('ok');
    });

    it('GET /unknown should return 404', async () => {
      const { status } = await httpGet('/unknown');
      expect(status).toBe(404);
    });
  });

  // ─── WebSocket Authentication ──────────────────────────────

  describe('WebSocket authentication', () => {
    beforeEach(async () => {
      await server.start();
    });

    it('should accept correct PIN', async () => {
      const ws = await connectWs(testPort);
      try {
        const result = await authenticateWs(ws, '1234');
        expect(result.success).toBe(true);
      } finally {
        ws.terminate();
      }
    });

    it('should reject incorrect PIN', async () => {
      const ws = await connectWs(testPort);
      try {
        const result = await authenticateWs(ws, '9999');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid PIN');
      } finally {
        ws.terminate();
      }
    });

    it('should send device list after successful auth', async () => {
      const config = makeConfig({ id: 'virtual-ws-auth-1', name: 'WS Auth Deck' });
      await driver.createDevice(config);

      const ws = await connectWs(testPort);
      try {
        // We'll collect messages after auth
        const messages: Record<string, unknown>[] = [];
        const collectPromise = new Promise<void>((resolve) => {
          let count = 0;
          ws.on('message', (data) => {
            try {
              const parsed = JSON.parse(data.toString());
              messages.push(parsed);
              count++;
              if (count >= 2) resolve(); // auth-result + device-list
            } catch {
              // ignore
            }
          });
        });

        ws.send(JSON.stringify({ type: 'auth', pin: '1234' }));
        await collectPromise;

        const authResult = messages.find((m) => m.type === 'auth-result');
        const deviceList = messages.find((m) => m.type === 'device-list');
        expect(authResult?.success).toBe(true);
        expect(deviceList?.devices).toEqual([{ id: 'virtual-ws-auth-1', name: 'WS Auth Deck' }]);
      } finally {
        ws.terminate();
      }
    });

    it('should count authenticated clients', async () => {
      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        // Small delay for the server to update
        await new Promise((r) => setTimeout(r, 50));
        expect(server.getAuthenticatedClientCount()).toBe(1);
      } finally {
        ws.terminate();
      }
    });

    it('should decrement client count on disconnect', async () => {
      const ws = await connectWs(testPort);
      await authenticateWs(ws, '1234');
      await new Promise((r) => setTimeout(r, 50));
      expect(server.getAuthenticatedClientCount()).toBe(1);

      ws.terminate();
      await new Promise((r) => setTimeout(r, 100));
      expect(server.getAuthenticatedClientCount()).toBe(0);
    });

    it('should ignore non-auth messages before authentication', async () => {
      const ws = await connectWs(testPort);
      try {
        // Send a subscribe message before auth — should be ignored
        ws.send(JSON.stringify({ type: 'subscribe', deviceId: 'test' }));

        // Now auth
        const result = await authenticateWs(ws, '1234');
        expect(result.success).toBe(true);
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── WebSocket Device Subscription ─────────────────────────

  describe('WebSocket device subscription', () => {
    let config: VirtualDeviceConfig;

    beforeEach(async () => {
      config = makeConfig({
        id: 'virtual-sub-test',
        name: 'Subscription Test',
        encoders: 2,
        encoderPosition: 'bottom',
        sliders: 1,
        sliderPosition: 'right'
      });
      await driver.createDevice(config);
      await server.start();
    });

    it('should send device-config on subscribe', async () => {
      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        const result = await sendAndWait(ws, { type: 'subscribe', deviceId: config.id }, 'device-config');
        expect(result.deviceId).toBe(config.id);
        expect((result.config as Record<string, unknown>).rows).toBe(3);
        expect((result.config as Record<string, unknown>).cols).toBe(5);
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── WebSocket Interaction Injection ───────────────────────

  describe('WebSocket interaction injection', () => {
    let config: VirtualDeviceConfig;

    beforeEach(async () => {
      config = makeConfig({
        id: 'virtual-interact-test',
        name: 'Interaction Test',
        encoders: 1,
        encoderPosition: 'bottom',
        sliders: 1,
        sliderPosition: 'right'
      });
      await driver.createDevice(config);
      await server.start();
    });

    it('should inject key-down events', async () => {
      const device = driver.getDevice(config.id)!;
      const downSpy = vi.fn();
      device.on('down', downSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'key-down', deviceId: config.id, key: 3 }));
        await new Promise((r) => setTimeout(r, 100));
        expect(downSpy).toHaveBeenCalledWith({ buttonIndex: 3 });
      } finally {
        ws.terminate();
      }
    });

    it('should inject key-up events', async () => {
      const device = driver.getDevice(config.id)!;
      const upSpy = vi.fn();
      device.on('up', upSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'key-up', deviceId: config.id, key: 5 }));
        await new Promise((r) => setTimeout(r, 100));
        expect(upSpy).toHaveBeenCalledWith({ buttonIndex: 5 });
      } finally {
        ws.terminate();
      }
    });

    it('should inject encoder-rotate events', async () => {
      const device = driver.getDevice(config.id)!;
      const rotateSpy = vi.fn();
      device.on('rotate', rotateSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'encoder-rotate', deviceId: config.id, encoder: 'encoder0', delta: 1 }));
        await new Promise((r) => setTimeout(r, 100));
        expect(rotateSpy).toHaveBeenCalledWith({ knobId: 'encoder0', delta: 1 });
      } finally {
        ws.terminate();
      }
    });

    it('should inject encoder-press events', async () => {
      const device = driver.getDevice(config.id)!;
      const pressSpy = vi.fn();
      device.on('knob-press', pressSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'encoder-press', deviceId: config.id, encoder: 'encoder0' }));
        await new Promise((r) => setTimeout(r, 100));
        expect(pressSpy).toHaveBeenCalledWith({ knobId: 'encoder0' });
      } finally {
        ws.terminate();
      }
    });

    it('should inject slider-change events', async () => {
      const device = driver.getDevice(config.id)!;
      const sliderSpy = vi.fn();
      device.on('slider-change', sliderSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'slider-change', deviceId: config.id, slider: 'slider0', value: 64 }));
        await new Promise((r) => setTimeout(r, 100));
        expect(sliderSpy).toHaveBeenCalledWith({ sliderId: 'slider0', value: 64 });
      } finally {
        ws.terminate();
      }
    });

    it('should clamp slider values to 0-127', async () => {
      const device = driver.getDevice(config.id)!;
      const sliderSpy = vi.fn();
      device.on('slider-change', sliderSpy);

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'slider-change', deviceId: config.id, slider: 'slider0', value: 200 }));
        await new Promise((r) => setTimeout(r, 100));
        expect(sliderSpy).toHaveBeenCalledWith({ sliderId: 'slider0', value: 127 });
      } finally {
        ws.terminate();
      }
    });

    it('should handle encoder-release gracefully', async () => {
      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        // Should not throw
        ws.send(JSON.stringify({ type: 'encoder-release', deviceId: config.id, encoder: 'encoder0' }));
        await new Promise((r) => setTimeout(r, 50));
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── Key Image Broadcasting ────────────────────────────────

  describe('key image broadcasting', () => {
    it('should broadcast key images as binary frames', async () => {
      const config = makeConfig({ id: 'virtual-img-test', name: 'Image Test' });
      await driver.createDevice(config);
      await server.start();

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        // Subscribe to device
        ws.send(JSON.stringify({ type: 'subscribe', deviceId: config.id }));
        await new Promise((r) => setTimeout(r, 100));

        // Collect binary messages
        const binaryMessages: Buffer[] = [];
        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            binaryMessages.push(Buffer.from(data as Buffer));
          }
        });

        // Broadcast a key image
        const testDataUri =
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        server.broadcastKeyImage(config.id, 7, testDataUri);
        await new Promise((r) => setTimeout(r, 200));

        expect(binaryMessages.length).toBeGreaterThanOrEqual(1);
        const frame = binaryMessages[binaryMessages.length - 1];
        // Check header
        expect(frame[0]).toBe(BINARY_MSG_KEY_IMAGE);
        expect(frame.readUInt16BE(1)).toBe(7); // keyIndex
        // Image data follows
        expect(frame.length).toBeGreaterThan(3);
      } finally {
        ws.terminate();
      }
    });

    it('should not send images to unsubscribed clients', async () => {
      const config = makeConfig({ id: 'virtual-nosub-test', name: 'NoSub Test' });
      await driver.createDevice(config);
      await server.start();

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        // Do NOT subscribe

        const binaryMessages: Buffer[] = [];
        ws.on('message', (data, isBinary) => {
          if (isBinary) binaryMessages.push(Buffer.from(data as Buffer));
        });

        server.broadcastKeyImage(config.id, 0, 'data:image/png;base64,AAAA');
        await new Promise((r) => setTimeout(r, 100));

        expect(binaryMessages.length).toBe(0);
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── Slider Value Broadcasting ─────────────────────────────

  describe('slider value broadcasting', () => {
    it('should broadcast slider values to subscribed clients', async () => {
      const config = makeConfig({
        id: 'virtual-slider-bc-test',
        name: 'Slider BC Test',
        sliders: 1,
        sliderPosition: 'right'
      });
      await driver.createDevice(config);
      await server.start();

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'subscribe', deviceId: config.id }));
        // Wait for device-config + initial slider values
        await new Promise((r) => setTimeout(r, 200));

        // Collect messages
        const messages: Record<string, unknown>[] = [];
        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            try {
              messages.push(JSON.parse(data.toString()));
            } catch {
              // ignore
            }
          }
        });

        server.broadcastSliderValue(config.id, 'slider0', 100);
        await new Promise((r) => setTimeout(r, 100));

        const sliderMsg = messages.find((m) => m.type === 'slider-value' && m.value === 100);
        expect(sliderMsg).toBeDefined();
        expect(sliderMsg?.slider).toBe('slider0');
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── Device Config Broadcasting ────────────────────────────

  describe('device config broadcasting', () => {
    it('should broadcast device config to subscribed clients', async () => {
      const config = makeConfig({ id: 'virtual-cfg-bc-test', name: 'Config BC Test' });
      await driver.createDevice(config);
      await server.start();

      const ws = await connectWs(testPort);
      try {
        await authenticateWs(ws, '1234');
        ws.send(JSON.stringify({ type: 'subscribe', deviceId: config.id }));
        // Wait for initial config
        await new Promise((r) => setTimeout(r, 200));

        // Collect messages
        const messages: Record<string, unknown>[] = [];
        ws.on('message', (data, isBinary) => {
          if (!isBinary) {
            try {
              messages.push(JSON.parse(data.toString()));
            } catch {
              // ignore
            }
          }
        });

        server.broadcastDeviceConfig(config.id);
        await new Promise((r) => setTimeout(r, 100));

        const configMsg = messages.find((m) => m.type === 'device-config');
        expect(configMsg).toBeDefined();
        expect(configMsg?.deviceId).toBe(config.id);
      } finally {
        ws.terminate();
      }
    });
  });

  // ─── Multiple Clients ──────────────────────────────────────

  describe('multiple clients', () => {
    it('should support multiple authenticated clients', async () => {
      await server.start();
      const ws1 = await connectWs(testPort);
      const ws2 = await connectWs(testPort);
      try {
        await authenticateWs(ws1, '1234');
        await authenticateWs(ws2, '1234');
        await new Promise((r) => setTimeout(r, 50));
        expect(server.getAuthenticatedClientCount()).toBe(2);
      } finally {
        ws1.terminate();
        ws2.terminate();
      }
    });
  });

  // ─── Graceful shutdown ─────────────────────────────────────

  describe('graceful shutdown', () => {
    it('should disconnect clients on stop', async () => {
      await server.start();
      const ws = await connectWs(testPort);
      await authenticateWs(ws, '1234');

      const closePromise = new Promise<void>((resolve) => {
        ws.on('close', () => resolve());
      });

      await server.stop();
      await closePromise;
      expect(server.isRunning()).toBe(false);
    });
  });
});
