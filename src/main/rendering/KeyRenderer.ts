/**
 * KeyRenderer — Single source of truth for rendering button key appearances.
 *
 * This module uses node-canvas (Cairo) to render a ButtonAppearance layer stack
 * into a PNG data URI. The same output is used for both the physical device
 * (via LoupedeckDriver) and the UI preview (via IPC to the renderer process).
 *
 * This eliminates the CSS-vs-canvas rendering desync that existed before.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const canvasModule: typeof CanvasModule = require('canvas');

import type {
  ButtonAppearance,
  SafeAreaInsets,
  Layer,
  FillLayer,
  ImageLayer,
  TextLayer,
  PluginLayer,
  ImageFit
} from '../../shared/types';
import { KEY_MARGIN_COLOR } from '../../shared/types';
import type * as CanvasModule from 'canvas';
import type { CanvasRenderingContext2D, Image } from 'canvas';

// ─── LRU Image Cache ─────────────────────────────────────────────

const IMAGE_CACHE_CAPACITY = 64;

interface CacheEntry {
  image: Image;
  lastUsed: number;
}

const imageCache = new Map<string, CacheEntry>();

/** Load an image from a data URI, using the LRU cache */
async function loadCachedImage(dataUri: string): Promise<Image> {
  // Use a hash of the first 64 + last 32 chars as cache key to avoid
  // storing multi-KB keys in the map. For data URIs of different images
  // this is effectively collision-free.
  const key =
    dataUri.length <= 128
      ? dataUri
      : `${dataUri.substring(0, 64)}|${dataUri.length}|${dataUri.substring(dataUri.length - 32)}`;

  const cached = imageCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.image;
  }

  // Decode data URI → Buffer → loadImage
  const matches = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error('Invalid data URI format');
  }
  const buf = Buffer.from(matches[2], 'base64');
  const image = await canvasModule.loadImage(buf);

  // Evict oldest entry if at capacity
  if (imageCache.size >= IMAGE_CACHE_CAPACITY) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of imageCache) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) imageCache.delete(oldestKey);
  }

  imageCache.set(key, { image, lastUsed: Date.now() });
  return image;
}

/** Clear the image cache (e.g. on profile switch) */
export function clearImageCache(): void {
  imageCache.clear();
}

// ─── Safe Area Helpers ────────────────────────────────────────────

interface SafeArea {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

function computeSafeArea(width: number, height: number, insets: SafeAreaInsets): SafeArea {
  const x = insets.left;
  const y = insets.top;
  const w = width - insets.left - insets.right;
  const h = height - insets.top - insets.bottom;
  return { x, y, w, h, cx: x + Math.round(w / 2), cy: y + Math.round(h / 2) };
}

// ─── Layer Renderers ──────────────────────────────────────────────

function renderFillLayer(ctx: CanvasRenderingContext2D, layer: FillLayer, safe: SafeArea): void {
  ctx.fillStyle = layer.color;
  ctx.fillRect(safe.x, safe.y, safe.w, safe.h);
}

async function renderImageLayer(ctx: CanvasRenderingContext2D, layer: ImageLayer, safe: SafeArea): Promise<void> {
  let image: Image;
  try {
    image = await loadCachedImage(layer.dataUri);
  } catch {
    return; // Skip layer if image can't be loaded
  }
  drawFittedImage(ctx, image, safe, layer.fit, layer.scale, layer.offsetX, layer.offsetY);
}

async function renderPluginLayer(
  ctx: CanvasRenderingContext2D,
  layer: PluginLayer,
  safe: SafeArea,
  pluginImageDataUri?: string
): Promise<void> {
  if (!pluginImageDataUri) return; // No image available — render as transparent

  let image: Image;
  try {
    image = await loadCachedImage(pluginImageDataUri);
  } catch {
    return;
  }
  drawFittedImage(ctx, image, safe, layer.fit, 1, 0, 0);
}

function renderTextLayer(ctx: CanvasRenderingContext2D, layer: TextLayer, safe: SafeArea): void {
  const labelText = layer.text;
  if (!labelText) return;

  const fontSize = layer.fontSize || Math.max(12, Math.round(safe.w * 0.2));
  const bold = layer.bold;

  ctx.fillStyle = layer.color || '#ffffff';
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;

  // Horizontal alignment
  const posH = layer.positionH || 'center';
  ctx.textAlign = posH;
  let textX: number;
  if (posH === 'left') textX = safe.x + 4;
  else if (posH === 'right') textX = safe.x + safe.w - 4;
  else textX = safe.cx;

  // Word wrap
  const maxWidth = safe.w - 8;
  const words = labelText.split(' ');
  const lines: string[] = [];
  let currentLine = '';
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);

  // Measure glyph dimensions for vertical placement
  const m = ctx.measureText('Hg');
  const ascent = m.actualBoundingBoxAscent ?? fontSize * 0.75;
  const descent = m.actualBoundingBoxDescent ?? fontSize * 0.25;
  const glyphHeight = ascent + descent;
  const lineHeight = Math.round(glyphHeight * 1.4);
  const totalTextH = glyphHeight + (lines.length - 1) * lineHeight;

  // Vertical positioning
  const posV = layer.positionV || 'center';
  let firstBaseline: number;
  ctx.textBaseline = 'alphabetic';

  if (posV === 'top') {
    firstBaseline = safe.y + 4 + ascent;
  } else if (posV === 'bottom') {
    firstBaseline = safe.y + safe.h - 4 - totalTextH + ascent;
  } else {
    // center
    firstBaseline = Math.round(safe.cy - totalTextH / 2 + ascent);
  }

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], textX, firstBaseline + i * lineHeight);
  }
}

// ─── Image Fitting ────────────────────────────────────────────────

function drawFittedImage(
  ctx: CanvasRenderingContext2D,
  image: Image,
  safe: SafeArea,
  fit: ImageFit,
  scale: number,
  offsetX: number,
  offsetY: number
): void {
  let drawW: number;
  let drawH: number;

  if (fit === 'stretch') {
    drawW = safe.w * scale;
    drawH = safe.h * scale;
  } else if (fit === 'cover') {
    const ratio = Math.max(safe.w / image.width, safe.h / image.height) * scale;
    drawW = image.width * ratio;
    drawH = image.height * ratio;
  } else if (fit === 'none') {
    drawW = image.width * scale;
    drawH = image.height * scale;
  } else {
    // contain (default)
    const ratio = Math.min(safe.w / image.width, safe.h / image.height) * scale;
    drawW = image.width * ratio;
    drawH = image.height * ratio;
  }

  const drawX = safe.cx - drawW / 2 + offsetX;
  const drawY = safe.cy - drawH / 2 + offsetY;

  // Clip to safe area so image doesn't bleed outside
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(safe.x, safe.y);
  ctx.lineTo(safe.x + safe.w, safe.y);
  ctx.lineTo(safe.x + safe.w, safe.y + safe.h);
  ctx.lineTo(safe.x, safe.y + safe.h);
  ctx.closePath();
  ctx.clip();

  ctx.drawImage(image, Math.round(drawX), Math.round(drawY), Math.round(drawW), Math.round(drawH));
  ctx.restore();
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Render a button appearance layer stack to a PNG data URI.
 *
 * @param appearance         The layer stack to render
 * @param insets             Device-specific safe area insets
 * @param width              Canvas width in pixels (e.g. 96)
 * @param height             Canvas height in pixels (e.g. 96)
 * @param pluginImageDataUri Optional resolved plugin image data URI to inject
 *                           into any visible PluginLayer. The caller is responsible
 *                           for resolving imageId → data URI via the plugin registry
 *                           before calling this function.
 * @returns data:image/png;base64,... string
 */
export async function renderKey(
  appearance: ButtonAppearance,
  insets: SafeAreaInsets,
  width: number,
  height: number,
  pluginImageDataUri?: string
): Promise<string> {
  const canvas = canvasModule.createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Fill entire canvas with neutral margin colour
  ctx.fillStyle = KEY_MARGIN_COLOR;
  ctx.fillRect(0, 0, width, height);

  const safe = computeSafeArea(width, height, insets);

  // Render layers bottom-to-top
  for (const layer of appearance.layers) {
    if (!layer.visible) continue;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));

    await renderLayer(ctx, layer, safe, pluginImageDataUri);

    ctx.restore();
  }

  return canvas.toDataURL('image/png');
}

/** Dispatch rendering to the correct layer handler */
async function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  safe: SafeArea,
  pluginImageDataUri?: string
): Promise<void> {
  switch (layer.type) {
    case 'fill':
      renderFillLayer(ctx, layer, safe);
      break;
    case 'image':
      await renderImageLayer(ctx, layer, safe);
      break;
    case 'text':
      renderTextLayer(ctx, layer, safe);
      break;
    case 'plugin':
      await renderPluginLayer(ctx, layer, safe, pluginImageDataUri);
      break;
  }
}
