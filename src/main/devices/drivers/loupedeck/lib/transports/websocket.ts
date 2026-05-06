import { networkInterfaces } from 'node:os';
import WebSocket from 'ws';
import { CONNECTION_TIMEOUT } from '../constants';
import type { TransportType, DiscoveredDevice } from '../types';
import { BaseTransport } from './transport';

const DISCONNECT_CODES = {
  NORMAL: 1000,
  TIMEOUT: 1006
} as const;

/**
 * WebSocket transport for older Loupedeck firmware (V0.1.X).
 *
 * Connects to the device's built-in HTTP server over a local
 * network interface (100.127.x.x).
 */
export class WebSocketTransport extends BaseTransport {
  readonly type: TransportType = 'websocket';
  private connection: WebSocket | null = null;
  private lastTick = 0;
  private keepAliveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly host: string;
  private readonly connectionTimeout: number;

  constructor(host: string, connectionTimeout = CONNECTION_TIMEOUT) {
    super();
    this.host = host;
    this.connectionTimeout = connectionTimeout;
  }

  /**
   * Scan network interfaces for Loupedeck devices (100.127.x.x pattern).
   */
  static discover(): DiscoveredDevice[] {
    const results: DiscoveredDevice[] = [];
    const interfaces = Object.values(networkInterfaces()).flat();
    for (const iface of interfaces) {
      if (!iface?.address.startsWith('100.127')) continue;
      results.push({
        transport: 'websocket',
        productId: 0x04,
        vendorId: 0x2ec2,
        address: iface.address.replace(/.2$/, '.1')
      });
    }
    return results;
  }

  protected async _connect(): Promise<void> {
    const address = `ws://${this.host}`;
    this.connection = new WebSocket(address);

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.connection!.removeListener('error', onError);
        resolve();
      };
      const onError = (err: Error) => {
        this.connection!.removeListener('open', onOpen);
        reject(err);
      };
      this.connection!.once('open', onOpen);
      this.connection!.once('error', onError);
    });

    this.connection.on('message', (data: Buffer) => {
      this.lastTick = Date.now();
      this.emit('message', data);
    });

    this.connection.on('close', (code: number) => {
      this.stopKeepAlive();
      let error: Error | undefined;
      if (code === DISCONNECT_CODES.TIMEOUT) {
        error = new Error('Connection timeout - was the device disconnected?');
      }
      if (error) this.emit('error', error);
      try {
        this.setState('disconnected');
      } catch {
        // Already disconnected
      }
    });

    // Start keep-alive monitoring
    this.lastTick = Date.now();
    this.startKeepAlive();

    this.setState('connected');
  }

  protected async _close(): Promise<void> {
    this.stopKeepAlive();
    if (!this.connection) return;
    const closed = new Promise<void>((resolve) => {
      this.connection!.once('close', () => resolve());
    });
    this.connection.close();
    await closed;
    this.connection = null;
  }

  protected _send(data: Buffer): void {
    if (!this.connection) return;
    this.connection.send(data);
  }

  private startKeepAlive(): void {
    this.keepAliveTimer = setTimeout(this.checkConnected.bind(this), this.connectionTimeout * 2);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearTimeout(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private checkConnected(): void {
    this.keepAliveTimer = setTimeout(this.checkConnected.bind(this), this.connectionTimeout * 2);
    if (Date.now() - this.lastTick > this.connectionTimeout) {
      this.connection?.terminate();
    }
  }
}
