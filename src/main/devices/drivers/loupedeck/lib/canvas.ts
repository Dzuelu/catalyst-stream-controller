/**
 * Optional canvas-based drawing helpers.
 *
 * These functions require the `canvas` (node-canvas) package to be installed.
 * They are separated from the core device API so that consumers who only use
 * {@link LoupedeckDevice.drawBuffer} / raw pixel buffers can avoid the native
 * dependency entirely.
 *
 * @example
 * ```ts
 * import { drawCanvas, drawCanvasKey } from 'loupedeck/canvas';
 *
 * await drawCanvasKey(device, 0, (ctx, w, h) => {
 *   ctx.fillStyle = 'red';
 *   ctx.fillRect(0, 0, w, h);
 * });
 * ```
 *
 * @module
 */
import type { LoupedeckDeviceLike, DrawOptions, DrawCallback } from './types';
import { rgba2rgb565 } from './util';
import type * as CanvasModule from 'canvas';

// Lazy-loaded canvas module — resolved once on first use.
let canvasModule: typeof CanvasModule | null | undefined;

async function getCanvasModule(): Promise<typeof CanvasModule> {
  if (canvasModule === undefined) {
    try {
      canvasModule = await import('canvas');
    } catch {
      canvasModule = null;
    }
  }
  if (!canvasModule) {
    throw new Error('The `canvas` package is required for canvas-based drawing. Install it with `npm install canvas`.');
  }
  return canvasModule;
}

/**
 * Draw to a display region using a canvas callback.
 *
 * Creates a node-canvas surface of the appropriate size, invokes `cb` with the
 * 2D context, then converts to an RGB565 buffer and calls
 * {@link LoupedeckDeviceLike.drawBuffer | device.drawBuffer()}.
 */
export async function drawCanvas(
  device: LoupedeckDeviceLike,
  { id, width, height, ...rest }: DrawOptions,
  cb: DrawCallback
): Promise<void> {
  const displayInfo = device.displays[id];

  if (!displayInfo) throw new Error(`Display '${id}' is not available on this device!`);
  const { width: dw, height: dh } = displayInfo;
  width ??= dw;
  height ??= dh;

  const mod = await getCanvasModule();
  const canvas = mod.createCanvas(width, height) as {
    getContext: (type: string, opts?: Record<string, unknown>) => unknown;
    toBuffer?: (format: string) => Buffer;
  };
  const ctx = canvas.getContext('2d', { pixelFormat: 'RGB16_565' });
  (cb as (ctx: unknown, w: number, h: number) => void)(ctx, width, height);

  let buffer: Buffer;
  if (canvas.toBuffer) {
    buffer = canvas.toBuffer('raw');
  } else {
    const imageData = (
      ctx as { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } }
    ).getImageData(0, 0, width, height);
    buffer = rgba2rgb565(imageData.data, width * height);
  }
  if (displayInfo.endianness === 'be') buffer.swap16();
  return device.drawBuffer({ id, width, height, ...rest }, buffer);
}

/**
 * Draw to a specific key using a canvas callback.
 *
 * Convenience wrapper around {@link drawCanvas} that resolves the key index
 * to a display region automatically.
 */
export async function drawCanvasKey(device: LoupedeckDeviceLike, index: number, cb: DrawCallback): Promise<void> {
  if (index < 0 || index >= device.columns * device.rows) {
    throw new Error(`Key ${index} is not a valid key`);
  }
  const width = device.keySize;
  const height = device.keySize;
  const x = device.visibleX[0] + (index % device.columns) * width;
  const y = Math.floor(index / device.columns) * height;
  return drawCanvas(device, { id: 'center', x, y, width, height }, cb);
}

/**
 * Draw to a full screen using a canvas callback.
 *
 * Convenience wrapper around {@link drawCanvas} that fills the entire display.
 */
export async function drawCanvasScreen(device: LoupedeckDeviceLike, id: string, cb: DrawCallback): Promise<void> {
  return drawCanvas(device, { id }, cb);
}
