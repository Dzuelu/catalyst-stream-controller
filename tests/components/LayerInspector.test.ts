import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayerInspector from '../../src/renderer/components/LayerInspector.svelte';
import type { FillLayer, TextLayer, ImageLayer } from '../../src/shared/types';

describe('LayerInspector', () => {
  const fillLayer: FillLayer = {
    id: 'layer-fill-1',
    type: 'fill',
    name: 'Background',
    visible: true,
    opacity: 1,
    locked: false,
    color: '#1a1a2e'
  };

  const textLayer: TextLayer = {
    id: 'layer-text-1',
    type: 'text',
    name: 'Title',
    visible: true,
    opacity: 1,
    locked: false,
    text: 'Hello',
    color: '#ffffff',
    fontSize: 14,
    bold: false,
    positionV: 'center',
    positionH: 'center'
  };

  const imageLayer: ImageLayer = {
    id: 'layer-img-1',
    type: 'image',
    name: 'Icon',
    visible: true,
    opacity: 1,
    locked: false,
    dataUri: 'data:image/png;base64,abc',
    fit: 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0
  };

  // ─── Header ───────────────────────────────────────────────

  describe('header', () => {
    it('should display layer type', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByText('fill')).toBeInTheDocument();
    });

    it('should display layer name', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByText('Background')).toBeInTheDocument();
    });

    it('should show duplicate button', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByTitle('Duplicate layer')).toBeInTheDocument();
    });

    it('should show delete button', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByTitle('Delete layer')).toBeInTheDocument();
    });

    it('should call onDelete when delete button is clicked', async () => {
      const onDelete = vi.fn();
      render(LayerInspector, { props: { layer: fillLayer, onDelete } });
      await fireEvent.click(screen.getByTitle('Delete layer'));
      expect(onDelete).toHaveBeenCalled();
    });

    it('should call onDuplicate when duplicate button is clicked', async () => {
      const onDuplicate = vi.fn();
      render(LayerInspector, { props: { layer: fillLayer, onDuplicate } });
      await fireEvent.click(screen.getByTitle('Duplicate layer'));
      expect(onDuplicate).toHaveBeenCalled();
    });
  });

  // ─── Type-specific editors ────────────────────────────────

  describe('type-specific editors', () => {
    it('should render FillLayerEditor for fill layers', () => {
      const { container } = render(LayerInspector, { props: { layer: fillLayer } });
      // FillLayerEditor has a color input with id="fill-color"
      expect(container.querySelector('#fill-color')).toBeInTheDocument();
    });

    it('should render TextLayerEditor for text layers', () => {
      const { container } = render(LayerInspector, { props: { layer: textLayer } });
      // TextLayerEditor has a text input with id="text-content"
      expect(container.querySelector('#text-content')).toBeInTheDocument();
    });

    it('should render ImageLayerEditor for image layers', () => {
      render(LayerInspector, { props: { layer: imageLayer } });
      // ImageLayerEditor shows "Browse Icons" and "Upload Image" buttons
      expect(screen.getByText('Browse Icons')).toBeInTheDocument();
    });
  });

  // ─── Opacity control ──────────────────────────────────────

  describe('opacity control', () => {
    it('should display opacity slider', () => {
      const { container } = render(LayerInspector, { props: { layer: fillLayer } });
      expect(container.querySelector('#layer-opacity')).toBeInTheDocument();
    });

    it('should display opacity percentage', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByText('100%')).toBeInTheDocument();
    });

    it('should call onInput when opacity slider moves', async () => {
      const onInput = vi.fn();
      const { container } = render(LayerInspector, { props: { layer: fillLayer, onInput } });
      const slider = container.querySelector('#layer-opacity') as HTMLInputElement;
      await fireEvent.input(slider, { target: { value: '0.5' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.5 }));
    });

    it('should call onChange when opacity slider is committed', async () => {
      const onChange = vi.fn();
      const { container } = render(LayerInspector, { props: { layer: fillLayer, onChange } });
      const slider = container.querySelector('#layer-opacity') as HTMLInputElement;
      await fireEvent.change(slider, { target: { value: '0.75' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.75 }));
    });

    it('should show 50% for opacity 0.5', () => {
      const halfOpacityLayer = { ...fillLayer, opacity: 0.5 };
      render(LayerInspector, { props: { layer: halfOpacityLayer } });
      expect(screen.getByText('50%')).toBeInTheDocument();
    });
  });

  // ─── Layer name editing ───────────────────────────────────

  describe('layer name editing', () => {
    it('should show name as text by default', () => {
      render(LayerInspector, { props: { layer: fillLayer } });
      expect(screen.getByText('Background')).toBeInTheDocument();
    });

    it('should enter edit mode on double-click', async () => {
      const { container } = render(LayerInspector, { props: { layer: fillLayer } });
      const nameSpan = screen.getByText('Background');
      await fireEvent.dblClick(nameSpan);
      // Should now show an input
      const input = container.querySelector('input[type="text"]');
      expect(input).toBeInTheDocument();
    });

    it('should not enter edit mode when locked', async () => {
      const lockedLayer = { ...fillLayer, locked: true };
      const { container } = render(LayerInspector, { props: { layer: lockedLayer } });
      const nameSpan = screen.getByText('Background');
      await fireEvent.dblClick(nameSpan);
      // Should NOT show an input - the name span should still be there
      const inputs = container.querySelectorAll('input[type="text"]');
      // Only the color inputs should exist, not a name editor
      const nameInput = Array.from(inputs).find((i) => (i as HTMLInputElement).value === 'Background');
      expect(nameInput).toBeUndefined();
    });
  });
});
