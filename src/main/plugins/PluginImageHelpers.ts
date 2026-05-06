/**
 * Plugin Image Helpers — utility functions for generating device-compatible
 * images (base64 PNG data URIs) that plugins can push via setButtonImage().
 *
 * These are exposed to plugins through `PluginHostAPI.createImage.*` so
 * plugin authors never need to know the raw image format the device expects.
 *
 * Uses the `canvas` module (available as a transitive dependency via
 * loupedeck) to render into a 72×72 canvas and export as PNG.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const canvasModule: typeof CanvasModule = require('canvas');
import type * as CanvasModule from 'canvas';

/** Default image size (matches typical stream controller key) */
const SIZE = 72;

// ─── Public API ──────────────────────────────────────────────────

/**
 * Create a solid-colour image with an optional centred text label.
 *
 * @param color  CSS colour string (hex, rgb(), named, etc.)
 * @param text   Optional short text to render over the colour
 * @returns      `data:image/png;base64,...` ready for setButtonImage()
 */
export function solidColor(color: string, text?: string): string {
  const canvas = canvasModule.createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = color;
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (text) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, SIZE / 2, SIZE / 2);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Create an image with a text label on a coloured background.
 *
 * @param options.text       The text to render
 * @param options.textColor  CSS colour for the text (default '#ffffff')
 * @param options.bgColor    CSS colour for the background (default '#1a1a2e')
 * @param options.fontSize   Font size in pixels (default 14)
 * @param options.bold       Whether the text is bold (default true)
 * @returns                  `data:image/png;base64,...`
 */
export function textImage(options: {
  text: string;
  textColor?: string;
  bgColor?: string;
  fontSize?: number;
  bold?: boolean;
}): string {
  const { text, textColor = '#ffffff', bgColor = '#1a1a2e', fontSize = 14, bold = true } = options;

  const canvas = canvasModule.createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = textColor;
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, SIZE / 2, SIZE / 2);

  return canvas.toDataURL('image/png');
}
