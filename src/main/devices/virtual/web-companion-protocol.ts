/**
 * Web Companion WebSocket Protocol
 *
 * Defines message types and structures for the bidirectional
 * WebSocket communication between the main app and web companion clients.
 *
 * JSON text frames are used for all messages except key images.
 * Key images are sent as binary frames: [1 byte type][2 bytes keyIndex][image data].
 */

// ─── Binary Frame Constants ────────────────────────────────────

/** Binary message type identifier (first byte of binary frames) */
export const BINARY_MSG_KEY_IMAGE = 0x01;

// ─── JSON Message Types (Server → Client) ──────────────────────

export interface WsDeviceConfigMessage {
  type: 'device-config';
  deviceId: string;
  config: {
    rows: number;
    cols: number;
    keySize: number;
    encoders: { id: string; label: string; side: string }[];
    sliders: { id: string; label: string; side: string }[];
  };
}

export interface WsSliderValueMessage {
  type: 'slider-value';
  deviceId: string;
  slider: string;
  value: number;
}

export interface WsAuthResultMessage {
  type: 'auth-result';
  success: boolean;
  error?: string;
}

export interface WsDeviceListMessage {
  type: 'device-list';
  devices: { id: string; name: string }[];
}

// ─── JSON Message Types (Client → Server) ──────────────────────

export interface WsAuthMessage {
  type: 'auth';
  pin: string;
}

export interface WsSubscribeMessage {
  type: 'subscribe';
  deviceId: string;
}

export interface WsKeyDownMessage {
  type: 'key-down';
  deviceId: string;
  key: number;
}

export interface WsKeyUpMessage {
  type: 'key-up';
  deviceId: string;
  key: number;
}

export interface WsEncoderRotateMessage {
  type: 'encoder-rotate';
  deviceId: string;
  encoder: string;
  delta: number;
}

export interface WsEncoderPressMessage {
  type: 'encoder-press';
  deviceId: string;
  encoder: string;
}

export interface WsEncoderReleaseMessage {
  type: 'encoder-release';
  deviceId: string;
  encoder: string;
}

export interface WsSliderChangeMessage {
  type: 'slider-change';
  deviceId: string;
  slider: string;
  value: number;
}

// ─── Union types ───────────────────────────────────────────────

export type WsServerMessage = WsDeviceConfigMessage | WsSliderValueMessage | WsAuthResultMessage | WsDeviceListMessage;

export type WsClientMessage =
  | WsAuthMessage
  | WsSubscribeMessage
  | WsKeyDownMessage
  | WsKeyUpMessage
  | WsEncoderRotateMessage
  | WsEncoderPressMessage
  | WsEncoderReleaseMessage
  | WsSliderChangeMessage;

// ─── Server Status ─────────────────────────────────────────────

export interface WebServerStatus {
  running: boolean;
  port: number;
  url: string | null;
  connectedClients: number;
  pin: string;
}

// ─── Default Config ────────────────────────────────────────────

export const DEFAULT_WEB_SERVER_PORT = 9120;
export const DEFAULT_PIN = '0000';
export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 8;

/** Validate a PIN string (4–8 digits) */
export function validatePin(pin: string): string | null {
  if (!pin || pin.length < MIN_PIN_LENGTH) return `PIN must be at least ${MIN_PIN_LENGTH} digits`;
  if (pin.length > MAX_PIN_LENGTH) return `PIN must be at most ${MAX_PIN_LENGTH} digits`;
  if (!/^\d+$/.test(pin)) return 'PIN must contain only digits';
  return null;
}
