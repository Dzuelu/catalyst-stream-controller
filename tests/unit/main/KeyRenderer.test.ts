import { describe, it, expect, beforeEach } from 'vitest';
import { renderKey, clearImageCache } from '../../../src/main/rendering/KeyRenderer';
import type {
  ButtonAppearance,
  SafeAreaInsets,
  FillLayer,
  ImageLayer,
  TextLayer,
  PluginLayer
} from '../../../src/shared/types';
import { createDefaultAppearance, generateLayerId, KEY_MARGIN_COLOR } from '../../../src/shared/types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createCanvas } = require('canvas') as {
  createCanvas: (
    w: number,
    h: number
  ) => {
    getContext: (type: '2d') => { fillStyle: string; fillRect: (x: number, y: number, w: number, h: number) => void };
    toDataURL: (mime: string) => string;
  };
};

// ─── Helpers ──────────────────────────────────────────────────────

const DEFAULT_INSETS: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const RSCX_INSETS: SafeAreaInsets = { top: 2, bottom: 20, left: 10, right: 10 };

/** Generate a tiny 4x4 red PNG data URI for testing */
function makeTestPng(color = '#ff0000'): string {
  const c = createCanvas(4, 4);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  return c.toDataURL('image/png');
}

function makeFillLayer(overrides: Partial<FillLayer> = {}): FillLayer {
  return {
    id: generateLayerId(),
    type: 'fill',
    name: 'Background',
    visible: true,
    opacity: 1,
    locked: false,
    color: '#1a1a2e',
    ...overrides
  };
}

function makeImageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: generateLayerId(),
    type: 'image',
    name: 'Icon',
    visible: true,
    opacity: 1,
    locked: false,
    dataUri: makeTestPng(),
    fit: 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    ...overrides
  };
}

function makeTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: generateLayerId(),
    type: 'text',
    name: 'Label',
    visible: true,
    opacity: 1,
    locked: false,
    text: 'Hello',
    color: '#ffffff',
    fontSize: 14,
    bold: true,
    positionV: 'center',
    positionH: 'center',
    ...overrides
  };
}

function makePluginLayer(overrides: Partial<PluginLayer> = {}): PluginLayer {
  return {
    id: generateLayerId(),
    type: 'plugin',
    name: 'Plugin Image',
    visible: true,
    opacity: 1,
    locked: false,
    fit: 'contain',
    ...overrides
  };
}

function makeAppearance(...layers: ButtonAppearance['layers']): ButtonAppearance {
  return { layers: layers.flat() };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('KeyRenderer', () => {
  beforeEach(() => {
    clearImageCache();
  });

  // ── Basic Rendering ─────────────────────────────────────────

  describe('renderKey basics', () => {
    it('should return a valid PNG data URI', async () => {
      const appearance = createDefaultAppearance();
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should render with zero insets', async () => {
      const appearance = makeAppearance(makeFillLayer({ color: '#ff0000' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should render with device-specific insets (RSCX)', async () => {
      const appearance = makeAppearance(makeFillLayer({ color: '#0000ff' }));
      const result = await renderKey(appearance, RSCX_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should render an empty layer stack', async () => {
      const appearance: ButtonAppearance = { layers: [] };
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });
  });

  // ── Fill Layer ──────────────────────────────────────────────

  describe('FillLayer', () => {
    it('should render a solid colour fill', async () => {
      const appearance = makeAppearance(makeFillLayer({ color: '#ff0000' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should skip invisible fill layer', async () => {
      const visibleApp = makeAppearance(makeFillLayer({ color: '#ff0000' }));
      const hiddenApp = makeAppearance(makeFillLayer({ color: '#ff0000', visible: false }));

      const visibleResult = await renderKey(visibleApp, DEFAULT_INSETS, 96, 96);
      const hiddenResult = await renderKey(hiddenApp, DEFAULT_INSETS, 96, 96);

      // Hidden layer produces the same result as an empty stack (just margin colour)
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);
      expect(hiddenResult).toBe(emptyResult);
      expect(visibleResult).not.toBe(emptyResult);
    });

    it('should apply opacity to fill layer', async () => {
      const fullOpacity = makeAppearance(makeFillLayer({ color: '#ff0000', opacity: 1 }));
      const halfOpacity = makeAppearance(makeFillLayer({ color: '#ff0000', opacity: 0.5 }));

      const fullResult = await renderKey(fullOpacity, DEFAULT_INSETS, 96, 96);
      const halfResult = await renderKey(halfOpacity, DEFAULT_INSETS, 96, 96);

      // Different opacity should produce different output
      expect(fullResult).not.toBe(halfResult);
    });

    it('should fill only safe area, not margins', async () => {
      // With large insets, filling with a bright colour should produce a
      // different image than with zero insets
      const appearance = makeAppearance(makeFillLayer({ color: '#00ff00' }));

      const noInsets = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      const withInsets = await renderKey(appearance, RSCX_INSETS, 96, 96);

      expect(noInsets).not.toBe(withInsets);
    });
  });

  // ── Image Layer ─────────────────────────────────────────────

  describe('ImageLayer', () => {
    it('should render an image', async () => {
      const appearance = makeAppearance(makeImageLayer());
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should skip invisible image layer', async () => {
      const visible = makeAppearance(makeImageLayer());
      const hidden = makeAppearance(makeImageLayer({ visible: false }));

      const visibleResult = await renderKey(visible, DEFAULT_INSETS, 96, 96);
      const hiddenResult = await renderKey(hidden, DEFAULT_INSETS, 96, 96);
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);

      expect(hiddenResult).toBe(emptyResult);
      expect(visibleResult).not.toBe(emptyResult);
    });

    it('should support fit mode: contain', async () => {
      const appearance = makeAppearance(makeImageLayer({ fit: 'contain' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should support fit mode: cover', async () => {
      const appearance = makeAppearance(makeImageLayer({ fit: 'cover' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should support fit mode: stretch', async () => {
      const appearance = makeAppearance(makeImageLayer({ fit: 'stretch' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should support fit mode: none', async () => {
      const appearance = makeAppearance(makeImageLayer({ fit: 'none' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should apply scale', async () => {
      // Use a larger image so scale differences are visible at 96x96
      const bigPng = (() => {
        const c = createCanvas(48, 48);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 48, 48);
        return c.toDataURL('image/png');
      })();

      const scale1 = makeAppearance(makeImageLayer({ dataUri: bigPng, scale: 1 }));
      const scale05 = makeAppearance(makeImageLayer({ dataUri: bigPng, scale: 0.5 }));

      const result1 = await renderKey(scale1, DEFAULT_INSETS, 96, 96);
      const result05 = await renderKey(scale05, DEFAULT_INSETS, 96, 96);

      expect(result1).not.toBe(result05);
    });

    it('should apply offset', async () => {
      const noOffset = makeAppearance(makeImageLayer({ offsetX: 0, offsetY: 0 }));
      const withOffset = makeAppearance(makeImageLayer({ offsetX: 20, offsetY: -10 }));

      const result1 = await renderKey(noOffset, DEFAULT_INSETS, 96, 96);
      const result2 = await renderKey(withOffset, DEFAULT_INSETS, 96, 96);

      expect(result1).not.toBe(result2);
    });

    it('should handle invalid data URI gracefully', async () => {
      const appearance = makeAppearance(makeImageLayer({ dataUri: 'not-a-data-uri' }));
      // Should not throw — layer is skipped
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });
  });

  // ── Text Layer ──────────────────────────────────────────────

  describe('TextLayer', () => {
    it('should render text', async () => {
      const appearance = makeAppearance(makeTextLayer({ text: 'Play' }));
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should skip invisible text layer', async () => {
      const visible = makeAppearance(makeTextLayer({ text: 'Play' }));
      const hidden = makeAppearance(makeTextLayer({ text: 'Play', visible: false }));

      const visibleResult = await renderKey(visible, DEFAULT_INSETS, 96, 96);
      const hiddenResult = await renderKey(hidden, DEFAULT_INSETS, 96, 96);
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);

      expect(hiddenResult).toBe(emptyResult);
      expect(visibleResult).not.toBe(emptyResult);
    });

    it('should skip empty text', async () => {
      const withText = makeAppearance(makeTextLayer({ text: 'Play' }));
      const emptyText = makeAppearance(makeTextLayer({ text: '' }));
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);

      const resultWithText = await renderKey(withText, DEFAULT_INSETS, 96, 96);
      const resultEmpty = await renderKey(emptyText, DEFAULT_INSETS, 96, 96);

      expect(resultWithText).not.toBe(emptyResult);
      expect(resultEmpty).toBe(emptyResult);
    });

    it('should use auto font size when fontSize is 0', async () => {
      const autoSize = makeAppearance(makeTextLayer({ text: 'Test', fontSize: 0 }));
      const result = await renderKey(autoSize, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should render with different vertical positions', async () => {
      const top = makeAppearance(makeTextLayer({ text: 'X', positionV: 'top' }));
      const center = makeAppearance(makeTextLayer({ text: 'X', positionV: 'center' }));
      const bottom = makeAppearance(makeTextLayer({ text: 'X', positionV: 'bottom' }));

      const topResult = await renderKey(top, DEFAULT_INSETS, 96, 96);
      const centerResult = await renderKey(center, DEFAULT_INSETS, 96, 96);
      const bottomResult = await renderKey(bottom, DEFAULT_INSETS, 96, 96);

      expect(topResult).not.toBe(centerResult);
      expect(centerResult).not.toBe(bottomResult);
      expect(topResult).not.toBe(bottomResult);
    });

    it('should render with different horizontal positions', async () => {
      const left = makeAppearance(makeTextLayer({ text: 'X', positionH: 'left' }));
      const center = makeAppearance(makeTextLayer({ text: 'X', positionH: 'center' }));
      const right = makeAppearance(makeTextLayer({ text: 'X', positionH: 'right' }));

      const leftResult = await renderKey(left, DEFAULT_INSETS, 96, 96);
      const centerResult = await renderKey(center, DEFAULT_INSETS, 96, 96);
      const rightResult = await renderKey(right, DEFAULT_INSETS, 96, 96);

      expect(leftResult).not.toBe(centerResult);
      expect(centerResult).not.toBe(rightResult);
    });

    it('should word-wrap long text', async () => {
      const shortText = makeAppearance(makeTextLayer({ text: 'Hi' }));
      const longText = makeAppearance(makeTextLayer({ text: 'This is a very long label that should wrap' }));

      const shortResult = await renderKey(shortText, DEFAULT_INSETS, 96, 96);
      const longResult = await renderKey(longText, DEFAULT_INSETS, 96, 96);

      // Both should render successfully
      expect(shortResult).toMatch(/^data:image\/png;base64,.+$/);
      expect(longResult).toMatch(/^data:image\/png;base64,.+$/);
      expect(shortResult).not.toBe(longResult);
    });

    it('should render bold and non-bold differently', async () => {
      const bold = makeAppearance(makeTextLayer({ text: 'Test', bold: true }));
      const normal = makeAppearance(makeTextLayer({ text: 'Test', bold: false }));

      const boldResult = await renderKey(bold, DEFAULT_INSETS, 96, 96);
      const normalResult = await renderKey(normal, DEFAULT_INSETS, 96, 96);

      expect(boldResult).not.toBe(normalResult);
    });
  });

  // ── Plugin Layer ────────────────────────────────────────────

  describe('PluginLayer', () => {
    it('should render when plugin image is provided', async () => {
      const appearance = makeAppearance(makePluginLayer());
      const pluginImage = makeTestPng('#00ff00');
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96, pluginImage);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should be transparent when no plugin image is provided', async () => {
      const withPlugin = makeAppearance(makePluginLayer());
      const empty: ButtonAppearance = { layers: [] };

      const pluginResult = await renderKey(withPlugin, DEFAULT_INSETS, 96, 96);
      const emptyResult = await renderKey(empty, DEFAULT_INSETS, 96, 96);

      // Without a plugin image, the plugin layer is transparent (same as empty)
      expect(pluginResult).toBe(emptyResult);
    });

    it('should skip invisible plugin layer even with image', async () => {
      const visible = makeAppearance(makePluginLayer());
      const hidden = makeAppearance(makePluginLayer({ visible: false }));
      const pluginImage = makeTestPng('#00ff00');

      const visibleResult = await renderKey(visible, DEFAULT_INSETS, 96, 96, pluginImage);
      const hiddenResult = await renderKey(hidden, DEFAULT_INSETS, 96, 96, pluginImage);
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);

      expect(hiddenResult).toBe(emptyResult);
      expect(visibleResult).not.toBe(emptyResult);
    });

    it('should apply opacity to plugin layer', async () => {
      const full = makeAppearance(makePluginLayer({ opacity: 1 }));
      const half = makeAppearance(makePluginLayer({ opacity: 0.5 }));
      const pluginImage = makeTestPng('#00ff00');

      const fullResult = await renderKey(full, DEFAULT_INSETS, 96, 96, pluginImage);
      const halfResult = await renderKey(half, DEFAULT_INSETS, 96, 96, pluginImage);

      expect(fullResult).not.toBe(halfResult);
    });
  });

  // ── Layer Ordering ──────────────────────────────────────────

  describe('layer ordering', () => {
    it('should render layers bottom-to-top', async () => {
      // Red fill, then green fill on top — should produce green
      const redFirst = makeAppearance(makeFillLayer({ color: '#ff0000' }), makeFillLayer({ color: '#00ff00' }));
      // Green fill, then red fill on top — should produce red
      const greenFirst = makeAppearance(makeFillLayer({ color: '#00ff00' }), makeFillLayer({ color: '#ff0000' }));

      const redFirstResult = await renderKey(redFirst, DEFAULT_INSETS, 96, 96);
      const greenFirstResult = await renderKey(greenFirst, DEFAULT_INSETS, 96, 96);

      expect(redFirstResult).not.toBe(greenFirstResult);
    });

    it('should render text on top of fill', async () => {
      const fillOnly = makeAppearance(makeFillLayer({ color: '#000000' }));
      const fillAndText = makeAppearance(
        makeFillLayer({ color: '#000000' }),
        makeTextLayer({ text: 'Hi', color: '#ffffff' })
      );

      const fillResult = await renderKey(fillOnly, DEFAULT_INSETS, 96, 96);
      const fillTextResult = await renderKey(fillAndText, DEFAULT_INSETS, 96, 96);

      expect(fillResult).not.toBe(fillTextResult);
    });

    it('should render image between fill and text', async () => {
      const withImage = makeAppearance(
        makeFillLayer({ color: '#000000' }),
        makeImageLayer(),
        makeTextLayer({ text: 'Title' })
      );
      const withoutImage = makeAppearance(makeFillLayer({ color: '#000000' }), makeTextLayer({ text: 'Title' }));

      const withResult = await renderKey(withImage, DEFAULT_INSETS, 96, 96);
      const withoutResult = await renderKey(withoutImage, DEFAULT_INSETS, 96, 96);

      expect(withResult).not.toBe(withoutResult);
    });
  });

  // ── Safe Area ───────────────────────────────────────────────

  describe('safe area', () => {
    it('should fill margins with neutral colour', async () => {
      // An empty stack should produce the margin colour everywhere
      const result = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should produce different output for different insets', async () => {
      const appearance = createDefaultAppearance();
      // Set a visible background so the difference is obvious
      (appearance.layers[0] as FillLayer).color = '#ff0000';

      const noInsets = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      const withInsets = await renderKey(appearance, RSCX_INSETS, 96, 96);

      expect(noInsets).not.toBe(withInsets);
    });

    it('should handle different canvas sizes', async () => {
      const appearance = createDefaultAppearance();

      const small = await renderKey(appearance, DEFAULT_INSETS, 72, 72);
      const large = await renderKey(appearance, DEFAULT_INSETS, 96, 96);

      expect(small).not.toBe(large);
    });
  });

  // ── Edge Cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle max layers (8) without error', async () => {
      const layers = Array.from({ length: 8 }, (_, i) =>
        makeFillLayer({ color: `#${((i + 1) * 30).toString(16).padStart(2, '0')}0000` })
      );
      const appearance = makeAppearance(...layers);
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should handle all layers invisible', async () => {
      const appearance = makeAppearance(
        makeFillLayer({ visible: false }),
        makeTextLayer({ text: 'Hidden', visible: false })
      );
      const emptyResult = await renderKey({ layers: [] }, DEFAULT_INSETS, 96, 96);
      const allHidden = await renderKey(appearance, DEFAULT_INSETS, 96, 96);

      expect(allHidden).toBe(emptyResult);
    });

    it('should clamp opacity to 0–1 range', async () => {
      const over = makeAppearance(makeFillLayer({ color: '#ff0000', opacity: 2.0 }));
      const under = makeAppearance(makeFillLayer({ color: '#ff0000', opacity: -0.5 }));

      // Should not throw
      const overResult = await renderKey(over, DEFAULT_INSETS, 96, 96);
      const underResult = await renderKey(under, DEFAULT_INSETS, 96, 96);

      expect(overResult).toMatch(/^data:image\/png;base64,.+$/);
      expect(underResult).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should handle zero-size safe area from extreme insets', async () => {
      const extremeInsets: SafeAreaInsets = { top: 48, bottom: 48, left: 48, right: 48 };
      const appearance = makeAppearance(makeFillLayer({ color: '#ff0000' }), makeTextLayer({ text: 'Tiny' }));
      // Should not throw — just renders a very small or empty area
      const result = await renderKey(appearance, extremeInsets, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });
  });

  // ── Image Cache ─────────────────────────────────────────────

  describe('image cache', () => {
    it('should produce identical output for same input (cache hit path)', async () => {
      const appearance = makeAppearance(makeImageLayer());

      const result1 = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      const result2 = await renderKey(appearance, DEFAULT_INSETS, 96, 96);

      expect(result1).toBe(result2);
    });

    it('should produce valid output after cache clear', async () => {
      const appearance = makeAppearance(makeImageLayer());

      await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      clearImageCache();
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);

      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });
  });

  // ── Multi-layer Compositing ─────────────────────────────────

  describe('multi-layer compositing', () => {
    it('should composite fill + image + plugin + text', async () => {
      const pluginImage = makeTestPng('#0000ff');
      const appearance = makeAppearance(
        makeFillLayer({ color: '#000000' }),
        makeImageLayer(),
        makePluginLayer(),
        makeTextLayer({ text: 'Scene 1' })
      );
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96, pluginImage);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should handle multiple text layers at different positions', async () => {
      const appearance = makeAppearance(
        makeFillLayer({ color: '#000000' }),
        makeTextLayer({ text: 'Top', positionV: 'top', name: 'Top Label' }),
        makeTextLayer({ text: 'Bottom', positionV: 'bottom', name: 'Bottom Label' })
      );
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should handle multiple image layers', async () => {
      const redPng = makeTestPng('#ff0000');
      const bluePng = makeTestPng('#0000ff');

      const appearance = makeAppearance(
        makeFillLayer({ color: '#000000' }),
        makeImageLayer({ dataUri: redPng, name: 'Red Image', scale: 0.5 }),
        makeImageLayer({ dataUri: bluePng, name: 'Blue Image', scale: 0.3, offsetX: 10 })
      );
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });

    it('should composite opacity correctly across layers', async () => {
      const opaque = makeAppearance(
        makeFillLayer({ color: '#ff0000' }),
        makeFillLayer({ color: '#0000ff', opacity: 1 })
      );
      const semiTransparent = makeAppearance(
        makeFillLayer({ color: '#ff0000' }),
        makeFillLayer({ color: '#0000ff', opacity: 0.5 })
      );

      const opaqueResult = await renderKey(opaque, DEFAULT_INSETS, 96, 96);
      const semiResult = await renderKey(semiTransparent, DEFAULT_INSETS, 96, 96);

      // Semi-transparent blue over red should look different from fully opaque blue
      expect(opaqueResult).not.toBe(semiResult);
    });
  });

  // ── createDefaultAppearance ─────────────────────────────────

  describe('createDefaultAppearance', () => {
    it('should create an appearance with fill + text layers', () => {
      const appearance = createDefaultAppearance();
      expect(appearance.layers).toHaveLength(2);
      expect(appearance.layers[0].type).toBe('fill');
      expect(appearance.layers[1].type).toBe('text');
    });

    it('should have unique IDs', () => {
      const appearance = createDefaultAppearance();
      const ids = appearance.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should set correct defaults on fill layer', () => {
      const appearance = createDefaultAppearance();
      const fill = appearance.layers[0] as FillLayer;
      expect(fill.color).toBe(KEY_MARGIN_COLOR);
      expect(fill.visible).toBe(true);
      expect(fill.opacity).toBe(1);
      expect(fill.locked).toBe(false);
    });

    it('should set correct defaults on text layer', () => {
      const appearance = createDefaultAppearance();
      const text = appearance.layers[1] as TextLayer;
      expect(text.text).toBe('');
      expect(text.color).toBe('#ffffff');
      expect(text.fontSize).toBe(0);
      expect(text.bold).toBe(true);
      expect(text.positionV).toBe('center');
      expect(text.positionH).toBe('center');
    });

    it('should render successfully', async () => {
      const appearance = createDefaultAppearance();
      const result = await renderKey(appearance, DEFAULT_INSETS, 96, 96);
      expect(result).toMatch(/^data:image\/png;base64,.+$/);
    });
  });
});
