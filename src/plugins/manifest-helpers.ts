/**
 * Shared helper functions for plugin manifests.
 *
 * These utilities eliminate boilerplate when defining icon packs and
 * default button appearances across built-in (and third-party) plugins.
 */
import type { Layer, LayerBase } from '../shared/types';

// ── Default Layer Stack ─────────────────────────────────────

/** Return type for {@link defaultLayers}. */
export type DefaultAppearance = { layers: Array<Partial<Layer> & Pick<LayerBase, 'type'>> };

/**
 * Build a default appearance layer stack from concise arguments.
 *
 * Produces a three-layer stack: solid background → centred icon → bold
 * bottom-centre label.  Only the `type` field is required per layer —
 * omitted fields use the layer-type defaults at render time.
 */
export function defaultLayers(bg: string, iconId: string, text: string, textColor = '#ffffff'): DefaultAppearance {
  return {
    layers: [
      { type: 'fill' as const, color: bg },
      { type: 'image' as const, dataUri: `icon:${iconId}`, fit: 'contain' as const },
      {
        type: 'text' as const,
        text,
        color: textColor,
        bold: true,
        positionV: 'bottom' as const,
        positionH: 'center' as const
      }
    ]
  };
}

// ── SVG Icon Helper ─────────────────────────────────────────

/**
 * Wrap an SVG body fragment in a standard 96×96 icon shell.
 *
 * Uses white strokes with rounded caps/joins — the same conventions
 * that all built-in icon packs follow.  Pass the inner `<path>`,
 * `<circle>`, `<rect>`, etc. elements as the `body` string.
 *
 * @example
 * ```ts
 * svg('<circle cx="48" cy="48" r="20" fill="white" stroke="none"/>')
 * ```
 */
export const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
