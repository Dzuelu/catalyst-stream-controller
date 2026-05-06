/**
 * VirtualWebServer — HTTP + WebSocket server for the Web Companion.
 *
 * Phase 3 of the Virtual Stream Deck feature:
 * - Serves a static web companion app (placeholder for Phase 4)
 * - REST API endpoints for device listing/config
 * - WebSocket server for real-time key images, interactions, and slider sync
 * - PIN-based authentication for LAN security
 * - QR code generation for easy mobile connection
 */

import http from 'node:http';
import { networkInterfaces } from 'node:os';
import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import type { VirtualDriver } from './VirtualDriver';
import type { WsClientMessage, WsServerMessage, WebServerStatus } from './web-companion-protocol';
import type { KnobControl, SliderControl } from '../../../shared/types';
import { BINARY_MSG_KEY_IMAGE, DEFAULT_WEB_SERVER_PORT, DEFAULT_PIN, validatePin } from './web-companion-protocol';
import { WEB_COMPANION_HTML } from './web-companion-app';

// ─── Types ─────────────────────────────────────────────────────

interface AuthenticatedClient {
  ws: WebSocket;
  subscribedDeviceId: string | null;
}

// ─── Placeholder HTML ──────────────────────────────────────────

// ─── Helper: get local LAN IP ──────────────────────────────────

export function getLocalIpAddress(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      // Skip loopback and non-IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

// ─── VirtualWebServer ──────────────────────────────────────────

export class VirtualWebServer extends EventEmitter {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port: number;
  private pin: string;
  private virtualDriver: VirtualDriver;
  private clients: Map<WebSocket, AuthenticatedClient> = new Map();

  /** Key-image listener disposers, keyed by deviceId */
  private imageListeners: Map<string, () => void> = new Map();
  /** Slider-change listener disposers, keyed by deviceId */
  private sliderListeners: Map<string, () => void> = new Map();

  constructor(virtualDriver: VirtualDriver, options?: { port?: number; pin?: string }) {
    super();
    this.virtualDriver = virtualDriver;
    this.port = options?.port ?? DEFAULT_WEB_SERVER_PORT;
    this.pin = options?.pin ?? DEFAULT_PIN;
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  /** Start the HTTP + WebSocket server */
  async start(port?: number): Promise<void> {
    if (this.httpServer) {
      throw new Error('Web companion server is already running');
    }

    if (port !== undefined) {
      this.port = port;
    }

    return new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handleHttpRequest(req, res));

      server.on('error', (err) => {
        reject(err);
      });

      server.listen(this.port, () => {
        this.httpServer = server;
        this.wss = new WebSocketServer({ server, path: '/ws' });
        this.wss.on('connection', (ws) => this.handleConnection(ws));

        // Wire key-image and slider forwarding for all active virtual devices
        this.wireAllDeviceListeners();

        console.log(`[WebCompanion] Server started on port ${this.port}`);
        this.emit('status-changed', this.getStatus());
        resolve();
      });
    });
  }

  /** Stop the server and disconnect all clients */
  async stop(): Promise<void> {
    if (!this.httpServer) return;

    // Remove device listeners
    this.unwireAllDeviceListeners();

    // Forcefully close all WebSocket connections (terminate = no handshake wait)
    for (const [ws] of this.clients) {
      ws.terminate();
    }
    this.clients.clear();

    // Close WebSocket server
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
    });
    this.wss = null;

    // Close HTTP server
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.httpServer = null;

    console.log('[WebCompanion] Server stopped');
    this.emit('status-changed', this.getStatus());
  }

  // ─── PIN management ──────────────────────────────────────────

  setPin(pin: string): void {
    const error = validatePin(pin);
    if (error) throw new Error(error);
    this.pin = pin;
  }

  getPin(): string {
    return this.pin;
  }

  // ─── Status & info ───────────────────────────────────────────

  getStatus(): WebServerStatus {
    return {
      running: this.httpServer !== null,
      port: this.port,
      url: this.getConnectionUrl(),
      connectedClients: this.getAuthenticatedClientCount(),
      pin: this.pin
    };
  }

  getConnectionUrl(): string | null {
    if (!this.httpServer) return null;
    const ip = getLocalIpAddress();
    if (!ip) return null;
    return `http://${ip}:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  getAuthenticatedClientCount(): number {
    let count = 0;
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        count++;
      }
    }
    return count;
  }

  /** Generate a QR code data URI for the connection URL */
  async getQrCode(): Promise<string | null> {
    const url = this.getConnectionUrl();
    if (!url) return null;
    try {
      return await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: { dark: '#ffffffFF', light: '#0f0f14FF' }
      });
    } catch {
      return null;
    }
  }

  isRunning(): boolean {
    return this.httpServer !== null;
  }

  // ─── HTTP Request Handler ────────────────────────────────────

  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(WEB_COMPANION_HTML);
      return;
    }

    if (req.method === 'GET' && url === '/api/devices') {
      const configs = this.virtualDriver.getConfigs();
      const devices = configs.map((c) => ({ id: c.id, name: c.name }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
      return;
    }

    // Match /api/device/:id/config
    const configMatch = url.match(/^\/api\/device\/([^/]+)\/config$/);
    if (req.method === 'GET' && configMatch) {
      const deviceId = decodeURIComponent(configMatch[1]);
      const config = this.virtualDriver.getConfig(deviceId);
      if (!config) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Device not found' }));
        return;
      }
      const device = this.virtualDriver.getDevice(deviceId);
      const info = device?.getInfo();
      const encoders = (info?.controls ?? [])
        .filter((c): c is KnobControl => c.type === 'knob')
        .map((k) => ({ id: k.id, label: k.label, side: k.side }));
      const sliders = (info?.controls ?? [])
        .filter((c): c is SliderControl => c.type === 'slider')
        .map((s) => ({ id: s.id, label: s.label, side: s.side }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          deviceId: config.id,
          rows: config.rows,
          cols: config.columns,
          keySize: config.keySize,
          encoders,
          sliders
        })
      );
      return;
    }

    // Health check
    if (req.method === 'GET' && url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', clients: this.getAuthenticatedClientCount() }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  // ─── WebSocket Connection Handler ────────────────────────────

  private handleConnection(ws: WebSocket): void {
    // New client starts unauthenticated
    const client: AuthenticatedClient = { ws, subscribedDeviceId: null };
    // Don't add to authenticated clients map yet — require auth first

    let authenticated = false;

    // Set a timeout for authentication (30 seconds)
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        this.sendJson(ws, { type: 'auth-result', success: false, error: 'Authentication timeout' });
        ws.close(4001, 'Authentication timeout');
      }
    }, 30000);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return; // We don't accept binary from clients

      try {
        const message: WsClientMessage = JSON.parse(data.toString());

        if (!authenticated) {
          // Only accept auth messages before authentication
          if (message.type === 'auth') {
            if (message.pin === this.pin) {
              authenticated = true;
              clearTimeout(authTimeout);
              this.clients.set(ws, client);
              this.sendJson(ws, { type: 'auth-result', success: true });

              // Send device list
              const configs = this.virtualDriver.getConfigs();
              this.sendJson(ws, {
                type: 'device-list',
                devices: configs.map((c) => ({ id: c.id, name: c.name }))
              });

              this.emit('status-changed', this.getStatus());
            } else {
              this.sendJson(ws, { type: 'auth-result', success: false, error: 'Invalid PIN' });
            }
          }
          return;
        }

        // Authenticated — handle messages
        this.handleClientMessage(client, message);
      } catch (err) {
        console.warn('[WebCompanion] Invalid message from client:', err);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      this.clients.delete(ws);
      this.emit('status-changed', this.getStatus());
    });

    ws.on('error', (err) => {
      console.warn('[WebCompanion] Client WebSocket error:', err.message);
    });
  }

  // ─── Client Message Handling ─────────────────────────────────

  private handleClientMessage(client: AuthenticatedClient, message: WsClientMessage): void {
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(client, message.deviceId);
        break;

      case 'key-down':
        this.virtualDriver.getDevice(message.deviceId)?.injectKeyDown(message.key);
        break;

      case 'key-up':
        this.virtualDriver.getDevice(message.deviceId)?.injectKeyUp(message.key);
        break;

      case 'encoder-rotate':
        this.virtualDriver.getDevice(message.deviceId)?.injectEncoderRotate(message.encoder, message.delta);
        break;

      case 'encoder-press':
        this.virtualDriver.getDevice(message.deviceId)?.injectEncoderPress(message.encoder);
        break;

      case 'encoder-release':
        // encoder-release is a no-op for now (the device doesn't have a release event)
        // Could be used for toggle press/release in the future
        break;

      case 'slider-change': {
        const value = Math.max(0, Math.min(127, Math.round(message.value)));
        this.virtualDriver.getDevice(message.deviceId)?.injectSliderChange(message.slider, value);
        break;
      }

      case 'auth':
        // Already authenticated — ignore duplicate auth attempts
        break;
    }
  }

  /** Handle a device subscription — send config + current state */
  private handleSubscribe(client: AuthenticatedClient, deviceId: string): void {
    client.subscribedDeviceId = deviceId;

    const device = this.virtualDriver.getDevice(deviceId);
    if (!device) return;

    const info = device.getInfo();
    const encoders = info.controls
      .filter((c): c is KnobControl => c.type === 'knob')
      .map((k) => ({ id: k.id, label: k.label, side: k.side }));
    const sliders = info.controls
      .filter((c): c is SliderControl => c.type === 'slider')
      .map((s) => ({ id: s.id, label: s.label, side: s.side }));

    // Send device config
    this.sendJson(client.ws, {
      type: 'device-config',
      deviceId,
      config: {
        rows: info.rows,
        cols: info.cols,
        keySize: info.keySize,
        encoders,
        sliders
      }
    });

    // Send current key images
    const images = device.getAllKeyImages();
    for (const [keyIndex, dataUri] of images) {
      this.sendKeyImage(client.ws, deviceId, keyIndex, dataUri);
    }

    // Send current slider values
    const sliderValues = device.getAllSliderValues();
    for (const [sliderId, value] of Object.entries(sliderValues)) {
      this.sendJson(client.ws, {
        type: 'slider-value',
        deviceId,
        slider: sliderId,
        value
      });
    }
  }

  // ─── Broadcasting ────────────────────────────────────────────

  /** Broadcast a key image to all subscribed clients (called by device listener) */
  broadcastKeyImage(deviceId: string, keyIndex: number, dataUri: string): void {
    for (const client of this.clients.values()) {
      if (client.subscribedDeviceId === deviceId && client.ws.readyState === WebSocket.OPEN) {
        this.sendKeyImage(client.ws, deviceId, keyIndex, dataUri);
      }
    }
  }

  /** Broadcast a slider value to all subscribed clients */
  broadcastSliderValue(deviceId: string, sliderId: string, value: number): void {
    for (const client of this.clients.values()) {
      if (client.subscribedDeviceId === deviceId && client.ws.readyState === WebSocket.OPEN) {
        this.sendJson(client.ws, {
          type: 'slider-value',
          deviceId,
          slider: sliderId,
          value
        });
      }
    }
  }

  /** Broadcast device config change to all subscribed clients */
  broadcastDeviceConfig(deviceId: string): void {
    const device = this.virtualDriver.getDevice(deviceId);
    if (!device) return;

    const info = device.getInfo();
    const encoders = info.controls
      .filter((c): c is KnobControl => c.type === 'knob')
      .map((k) => ({ id: k.id, label: k.label, side: k.side }));
    const sliders = info.controls
      .filter((c): c is SliderControl => c.type === 'slider')
      .map((s) => ({ id: s.id, label: s.label, side: s.side }));

    const msg: WsServerMessage = {
      type: 'device-config',
      deviceId,
      config: {
        rows: info.rows,
        cols: info.cols,
        keySize: info.keySize,
        encoders,
        sliders
      }
    };

    for (const client of this.clients.values()) {
      if (client.subscribedDeviceId === deviceId && client.ws.readyState === WebSocket.OPEN) {
        this.sendJson(client.ws, msg);
      }
    }
  }

  // ─── Device Event Wiring ─────────────────────────────────────

  /** Wire key-image and slider-change listeners for all active virtual devices */
  wireAllDeviceListeners(): void {
    const configs = this.virtualDriver.getConfigs();
    for (const config of configs) {
      this.wireDeviceListeners(config.id);
    }
  }

  /** Wire listeners for a specific device */
  wireDeviceListeners(deviceId: string): void {
    // Remove existing listeners first
    this.unwireDeviceListeners(deviceId);

    const device = this.virtualDriver.getDevice(deviceId);
    if (!device) return;

    // Wire key-image events
    const imageHandler = (data: { keyIndex: number; dataUri: string }) => {
      this.broadcastKeyImage(deviceId, data.keyIndex, data.dataUri);
    };
    device.on('key-image', imageHandler);
    this.imageListeners.set(deviceId, () => {
      // We can't remove the listener from VirtualManagedDevice (no removeListener)
      // but tracking it lets us know it's wired. The device gets replaced on update.
    });

    // Wire slider-change events
    const sliderHandler = (data: { sliderId: string; value: number }) => {
      this.broadcastSliderValue(deviceId, data.sliderId, data.value);
    };
    device.on('slider-change', sliderHandler);
    this.sliderListeners.set(deviceId, () => {
      // Same note as above
    });
  }

  /** Remove listeners for a specific device */
  private unwireDeviceListeners(deviceId: string): void {
    this.imageListeners.delete(deviceId);
    this.sliderListeners.delete(deviceId);
  }

  /** Remove all device listeners */
  private unwireAllDeviceListeners(): void {
    this.imageListeners.clear();
    this.sliderListeners.clear();
  }

  // ─── Sending Helpers ─────────────────────────────────────────

  /** Send a JSON message to a WebSocket client */
  private sendJson(ws: WebSocket, message: WsServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send a key image as a binary frame.
   *
   * Binary format: [1 byte: BINARY_MSG_KEY_IMAGE][2 bytes: keyIndex (BE)][image data (PNG)]
   *
   * The data URI is decoded from base64 to raw bytes for the binary payload.
   * The web client renders these directly via Blob URL.
   */
  private sendKeyImage(ws: WebSocket, _deviceId: string, keyIndex: number, dataUri: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    try {
      // Extract the base64 portion and media type from the data URI
      const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return;

      const imageBuffer = Buffer.from(match[2], 'base64');

      // Build binary frame: [type][keyIndex_hi][keyIndex_lo][image_data]
      const header = Buffer.alloc(3);
      header[0] = BINARY_MSG_KEY_IMAGE;
      header.writeUInt16BE(keyIndex, 1);

      const frame = Buffer.concat([header, imageBuffer]);
      ws.send(frame, { binary: true });
    } catch {
      // Malformed data URI — skip
    }
  }
}
