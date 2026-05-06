import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import TextLayerEditor from '../../src/renderer/components/TextLayerEditor.svelte';
import type { TextLayer } from '../../src/shared/types';

describe('TextLayerEditor', () => {
  const defaultLayer: TextLayer = {
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

  const defaultProps = {
    layer: defaultLayer,
    onChange: vi.fn(),
    onInput: vi.fn()
  };

  // ─── Text input ───────────────────────────────────────────

  describe('text input', () => {
    it('should display text input with current value', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const input = container.querySelector('#text-content') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.value).toBe('Hello');
    });

    it('should call onInput when text is typed', async () => {
      const onInput = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onInput } });
      const input = container.querySelector('#text-content') as HTMLInputElement;
      await fireEvent.input(input, { target: { value: 'World' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ text: 'World' }));
    });

    it('should call onChange when text is committed', async () => {
      const onChange = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onChange } });
      const input = container.querySelector('#text-content') as HTMLInputElement;
      await fireEvent.change(input, { target: { value: 'World' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ text: 'World' }));
    });

    it('should show placeholder text', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const input = container.querySelector('#text-content') as HTMLInputElement;
      expect(input.placeholder).toBe('e.g. Mute');
    });
  });

  // ─── Color controls ───────────────────────────────────────

  describe('color controls', () => {
    it('should display color picker with current color', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const colorInput = container.querySelector('#text-color') as HTMLInputElement;
      expect(colorInput).toBeInTheDocument();
      expect(colorInput.value).toBe('#ffffff');
    });

    it('should call onInput when color changes via picker', async () => {
      const onInput = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onInput } });
      const colorInput = container.querySelector('#text-color') as HTMLInputElement;
      await fireEvent.input(colorInput, { target: { value: '#ff0000' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ color: '#ff0000' }));
    });

    it('should call onChange when color is committed', async () => {
      const onChange = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onChange } });
      const colorInput = container.querySelector('#text-color') as HTMLInputElement;
      await fireEvent.change(colorInput, { target: { value: '#00ff00' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ color: '#00ff00' }));
    });
  });

  // ─── Bold checkbox ────────────────────────────────────────

  describe('bold checkbox', () => {
    it('should display bold checkbox', () => {
      render(TextLayerEditor, { props: defaultProps });
      expect(screen.getByText('Bold')).toBeInTheDocument();
    });

    it('should reflect current bold state', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    it('should call onChange when bold is toggled', async () => {
      const onChange = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onChange } });
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
      await fireEvent.change(checkbox, { target: { checked: true } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ bold: true }));
    });
  });

  // ─── Font size slider ─────────────────────────────────────

  describe('font size', () => {
    it('should display font size slider', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const slider = container.querySelector('#text-fontsize') as HTMLInputElement;
      expect(slider).toBeInTheDocument();
    });

    it('should show current font size value', () => {
      render(TextLayerEditor, { props: defaultProps });
      expect(screen.getByText('14')).toBeInTheDocument();
    });

    it('should show "Auto" when fontSize is 0', () => {
      const autoLayer = { ...defaultLayer, fontSize: 0 };
      render(TextLayerEditor, { props: { ...defaultProps, layer: autoLayer } });
      expect(screen.getByText('Auto')).toBeInTheDocument();
    });

    it('should call onInput when font size slider moves', async () => {
      const onInput = vi.fn();
      const { container } = render(TextLayerEditor, { props: { ...defaultProps, onInput } });
      const slider = container.querySelector('#text-fontsize') as HTMLInputElement;
      await fireEvent.input(slider, { target: { value: '20' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ fontSize: 20 }));
    });
  });

  // ─── Position grid ────────────────────────────────────────

  describe('position grid', () => {
    it('should display position label', () => {
      render(TextLayerEditor, { props: defaultProps });
      expect(screen.getByText('Position')).toBeInTheDocument();
    });

    it('should render 9 position buttons (3x3 grid)', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      // The grid has 9 buttons for each position combo
      const gridContainer = container.querySelector('.grid.grid-cols-3');
      expect(gridContainer).toBeInTheDocument();
      const buttons = gridContainer!.querySelectorAll('button');
      expect(buttons.length).toBe(9);
    });

    it('should highlight the current position', () => {
      const { container } = render(TextLayerEditor, { props: defaultProps });
      const gridContainer = container.querySelector('.grid.grid-cols-3');
      const buttons = gridContainer!.querySelectorAll('button');
      // Center-center is the 5th button (index 4) - should have accent styling
      const activeButton = Array.from(buttons).find((btn) => btn.className.includes('bg-[var(--color-accent)]'));
      expect(activeButton).toBeTruthy();
    });
  });
});
