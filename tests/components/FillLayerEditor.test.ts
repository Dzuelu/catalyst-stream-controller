import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FillLayerEditor from '../../src/renderer/components/FillLayerEditor.svelte';
import type { FillLayer } from '../../src/shared/types';

describe('FillLayerEditor', () => {
  const defaultLayer: FillLayer = {
    id: 'layer-fill-1',
    type: 'fill',
    name: 'Background',
    visible: true,
    opacity: 1,
    locked: false,
    color: '#1a1a2e'
  };

  const defaultProps = {
    layer: defaultLayer,
    onChange: vi.fn(),
    onInput: vi.fn()
  };

  // ─── Color picker ─────────────────────────────────────────

  describe('color picker', () => {
    it('should display color input', () => {
      const { container } = render(FillLayerEditor, { props: defaultProps });
      const colorInput = container.querySelector('#fill-color') as HTMLInputElement;
      expect(colorInput).toBeInTheDocument();
    });

    it('should show current color value', () => {
      const { container } = render(FillLayerEditor, { props: defaultProps });
      const colorInput = container.querySelector('#fill-color') as HTMLInputElement;
      expect(colorInput.value).toBe('#1a1a2e');
    });

    it('should call onInput when color changes via picker', async () => {
      const onInput = vi.fn();
      const { container } = render(FillLayerEditor, { props: { ...defaultProps, onInput } });
      const colorInput = container.querySelector('#fill-color') as HTMLInputElement;
      await fireEvent.input(colorInput, { target: { value: '#ff0000' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ color: '#ff0000' }));
    });

    it('should call onChange when color is committed via picker', async () => {
      const onChange = vi.fn();
      const { container } = render(FillLayerEditor, { props: { ...defaultProps, onChange } });
      const colorInput = container.querySelector('#fill-color') as HTMLInputElement;
      await fireEvent.change(colorInput, { target: { value: '#00ff00' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: '#00ff00' }));
    });
  });

  // ─── Text hex input ───────────────────────────────────────

  describe('text hex input', () => {
    it('should display text input with hex color value', () => {
      const { container } = render(FillLayerEditor, { props: defaultProps });
      const textInputs = container.querySelectorAll('input[type="text"]');
      const hexInput = textInputs[0] as HTMLInputElement;
      expect(hexInput).toBeInTheDocument();
      expect(hexInput.value).toBe('#1a1a2e');
    });

    it('should call onInput when hex text is typed', async () => {
      const onInput = vi.fn();
      const { container } = render(FillLayerEditor, { props: { ...defaultProps, onInput } });
      const textInputs = container.querySelectorAll('input[type="text"]');
      const hexInput = textInputs[0] as HTMLInputElement;
      await fireEvent.input(hexInput, { target: { value: '#abcdef' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ color: '#abcdef' }));
    });

    it('should call onChange when hex text is committed', async () => {
      const onChange = vi.fn();
      const { container } = render(FillLayerEditor, { props: { ...defaultProps, onChange } });
      const textInputs = container.querySelectorAll('input[type="text"]');
      const hexInput = textInputs[0] as HTMLInputElement;
      await fireEvent.change(hexInput, { target: { value: '#123456' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: '#123456' }));
    });
  });

  // ─── Label ────────────────────────────────────────────────

  describe('label', () => {
    it('should display Color label', () => {
      render(FillLayerEditor, { props: defaultProps });
      expect(screen.getByText('Color')).toBeInTheDocument();
    });
  });
});
