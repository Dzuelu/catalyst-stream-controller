/**
 * Appearance Helpers — Bridge between the old flat ButtonAppearance fields
 * and the new layer-based format.
 *
 * These helpers allow ActionPanel (Phase 4) and ButtonCell (Phase 3) to
 * continue using flat form-state variables while the underlying data model
 * uses layers. They will be removed when the UI is fully migrated to
 * the layer list + inspector pattern.
 */

import type {
  ButtonAppearance,
  FillLayer,
  ImageLayer,
  TextLayer,
  PluginLayer,
  Layer,
  LayerBase,
  PositionAnchorV,
  PositionAnchorH,
  ImageFit
} from './types';
import { generateLayerId, KEY_MARGIN_COLOR } from './types';

// ─── Flat → Layers ──────────────────────────────────────────────

export interface FlatAppearanceInput {
  backgroundColor?: string;
  label?: {
    text?: string;
    color?: string;
    fontSize?: number;
    bold?: boolean;
    positionV?: PositionAnchorV;
    positionH?: PositionAnchorH;
  };
  icon?: {
    dataUri: string;
    fit?: ImageFit;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
  };
  pluginImage?: {
    enabled: boolean;
    fit?: ImageFit;
  };
}

/**
 * Convert flat appearance fields (old format) into a layer-based ButtonAppearance.
 * Used by ActionPanel.buildAppearance() and plugin manifest defaults.
 */
export function createAppearanceFromFlat(flat: FlatAppearanceInput): ButtonAppearance {
  const layers: Layer[] = [];

  // 1. Fill layer (always present)
  layers.push({
    id: generateLayerId(),
    type: 'fill',
    name: 'Background',
    visible: true,
    opacity: 1,
    locked: false,
    color: flat.backgroundColor ?? KEY_MARGIN_COLOR
  });

  // 2. Image layer (optional — only if icon data URI exists)
  if (flat.icon?.dataUri) {
    layers.push({
      id: generateLayerId(),
      type: 'image',
      name: 'Icon',
      visible: true,
      opacity: 1,
      locked: false,
      dataUri: flat.icon.dataUri,
      fit: flat.icon.fit ?? 'contain',
      scale: flat.icon.scale ?? 1,
      offsetX: flat.icon.offsetX ?? 0,
      offsetY: flat.icon.offsetY ?? 0
    });
  }

  // 3. Plugin layer (optional — only if plugin image is enabled)
  if (flat.pluginImage?.enabled) {
    layers.push({
      id: generateLayerId(),
      type: 'plugin',
      name: 'Plugin Image',
      visible: true,
      opacity: 1,
      locked: false,
      fit: flat.pluginImage.fit ?? 'contain'
    });
  }

  // 4. Text layer (always present)
  layers.push({
    id: generateLayerId(),
    type: 'text',
    name: 'Label',
    visible: true,
    opacity: 1,
    locked: false,
    text: flat.label?.text ?? '',
    color: flat.label?.color ?? '#ffffff',
    fontSize: flat.label?.fontSize ?? 0,
    bold: flat.label?.bold ?? true,
    positionV: flat.label?.positionV ?? 'center',
    positionH: flat.label?.positionH ?? 'center'
  });

  return { layers };
}

// ─── Layers → Flat ──────────────────────────────────────────────

export interface FlatAppearanceOutput {
  backgroundColor: string;
  label: {
    text: string;
    color: string;
    fontSize: number;
    bold: boolean;
    positionV: PositionAnchorV;
    positionH: PositionAnchorH;
  };
  icon: {
    dataUri: string | null;
    fit: ImageFit;
    offsetX: number;
    offsetY: number;
    scale: number;
  };
  pluginImage: {
    enabled: boolean;
    fit: ImageFit;
  };
}

/**
 * Extract flat appearance values from a layer-based ButtonAppearance.
 * Returns the first fill/text/image/plugin layer found (or defaults).
 * Used by ButtonCell.svelte and ActionPanel when loading from binding.
 */
export function extractFlatFromAppearance(appearance: ButtonAppearance | null | undefined): FlatAppearanceOutput {
  const defaults: FlatAppearanceOutput = {
    backgroundColor: KEY_MARGIN_COLOR,
    label: { text: '', color: '#ffffff', fontSize: 0, bold: true, positionV: 'center', positionH: 'center' },
    icon: { dataUri: null, fit: 'contain', offsetX: 0, offsetY: 0, scale: 1 },
    pluginImage: { enabled: false, fit: 'contain' }
  };

  if (!appearance?.layers?.length) return defaults;

  const fill = appearance.layers.find((l): l is FillLayer => l.type === 'fill');
  const text = appearance.layers.find((l): l is TextLayer => l.type === 'text');
  const image = appearance.layers.find((l): l is ImageLayer => l.type === 'image');
  const plugin = appearance.layers.find((l): l is PluginLayer => l.type === 'plugin');

  return {
    backgroundColor: fill?.color ?? defaults.backgroundColor,
    label: {
      text: text?.text ?? defaults.label.text,
      color: text?.color ?? defaults.label.color,
      fontSize: text?.fontSize ?? defaults.label.fontSize,
      bold: text?.bold ?? defaults.label.bold,
      positionV: text?.positionV ?? defaults.label.positionV,
      positionH: text?.positionH ?? defaults.label.positionH
    },
    icon: {
      dataUri: image?.dataUri ?? defaults.icon.dataUri,
      fit: image?.fit ?? defaults.icon.fit,
      offsetX: image?.offsetX ?? defaults.icon.offsetX,
      offsetY: image?.offsetY ?? defaults.icon.offsetY,
      scale: image?.scale ?? defaults.icon.scale
    },
    pluginImage: {
      enabled: !!plugin,
      fit: plugin?.fit ?? defaults.pluginImage.fit
    }
  };
}

/**
 * Check if a layer-based appearance has a visible PluginLayer.
 */
export function hasPluginLayer(appearance: ButtonAppearance | null | undefined): boolean {
  if (!appearance?.layers) return false;
  return appearance.layers.some((l) => l.type === 'plugin' && l.visible);
}

/**
 * Get the first visible PluginLayer from an appearance (if any).
 */
export function getPluginLayer(appearance: ButtonAppearance | null | undefined): PluginLayer | undefined {
  if (!appearance?.layers) return undefined;
  return appearance.layers.find((l): l is PluginLayer => l.type === 'plugin' && l.visible);
}

// ─── Partial Layers → Full Layers ───────────────────────────

/**
 * Expand an array of partial layers (as used in plugin manifest defaultAppearance)
 * into a full ButtonAppearance with complete Layer objects.
 * Each partial layer only needs `type` plus any non-default fields.
 */
export function expandPartialLayers(
  partialLayers: Array<Partial<Layer> & Pick<LayerBase, 'type'>>,
  pluginId?: string
): ButtonAppearance {
  const layers: Layer[] = partialLayers.map((p) => {
    const base = { id: generateLayerId(), visible: true, opacity: 1, locked: false };
    switch (p.type) {
      case 'fill': {
        const f = p as Partial<FillLayer>;
        return {
          ...base,
          type: 'fill' as const,
          name: f.name ?? 'Background',
          color: f.color ?? KEY_MARGIN_COLOR
        };
      }
      case 'image': {
        const i = p as Partial<ImageLayer>;
        return {
          ...base,
          type: 'image' as const,
          name: i.name ?? 'Icon',
          dataUri: i.dataUri ?? '',
          fit: i.fit ?? 'contain',
          scale: i.scale ?? 1,
          offsetX: i.offsetX ?? 0,
          offsetY: i.offsetY ?? 0
        };
      }
      case 'text': {
        const t = p as Partial<TextLayer>;
        return {
          ...base,
          type: 'text' as const,
          name: t.name ?? 'Label',
          text: t.text ?? '',
          color: t.color ?? '#ffffff',
          fontSize: t.fontSize ?? 0,
          bold: t.bold ?? true,
          positionV: t.positionV ?? 'center',
          positionH: t.positionH ?? 'center'
        };
      }
      case 'plugin': {
        const pl = p as Partial<PluginLayer>;
        return {
          ...base,
          type: 'plugin' as const,
          name: pl.name ?? 'Plugin Image',
          fit: pl.fit ?? 'contain',
          pluginId: pl.pluginId ?? pluginId
        };
      }
      default:
        throw new Error(`Unknown layer type: ${(p as LayerBase).type}`);
    }
  });
  return { layers };
}
