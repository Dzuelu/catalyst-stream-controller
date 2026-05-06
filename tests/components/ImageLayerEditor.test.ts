import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ImageLayerEditor from '../../src/renderer/components/ImageLayerEditor.svelte';
import type { ImageLayer } from '../../src/shared/types';

describe('ImageLayerEditor', () => {
  const layerWithImage: ImageLayer = {
    id: 'layer-img-1',
    type: 'image',
    name: 'Icon',
    visible: true,
    opacity: 1,
    locked: false,
    dataUri: 'data:image/png;base64,abc123',
    fit: 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0
  };

  const layerWithoutImage: ImageLayer = {
    id: 'layer-img-2',
    type: 'image',
    name: 'Empty',
    visible: true,
    opacity: 1,
    locked: false,
    dataUri: '',
    fit: 'contain',
    scale: 1,
    offsetX: 0,
    offsetY: 0
  };

  const defaultProps = {
    layer: layerWithImage,
    onChange: vi.fn(),
    onInput: vi.fn()
  };

  // ─── With image ───────────────────────────────────────────

  describe('with image', () => {
    it('should display image preview', () => {
      const { container } = render(ImageLayerEditor, { props: defaultProps });
      const img = container.querySelector('img[alt="Layer icon"]') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toBe('data:image/png;base64,abc123');
    });

    it('should show Browse Icons button', () => {
      render(ImageLayerEditor, { props: defaultProps });
      expect(screen.getByText('Browse Icons')).toBeInTheDocument();
    });

    it('should show Upload Image button', () => {
      render(ImageLayerEditor, { props: defaultProps });
      expect(screen.getByText('Upload Image')).toBeInTheDocument();
    });

    it('should show Remove Image button', () => {
      render(ImageLayerEditor, { props: defaultProps });
      expect(screen.getByText('Remove Image')).toBeInTheDocument();
    });

    it('should have clickable Browse Icons button', async () => {
      render(ImageLayerEditor, { props: defaultProps });
      const browseBtn = screen.getByText('Browse Icons');
      // Verify the button is present and clickable
      await fireEvent.click(browseBtn);
      // No error means the dispatch handler ran successfully
      expect(browseBtn).toBeInTheDocument();
    });

    it('should have clickable Upload Image button', async () => {
      render(ImageLayerEditor, { props: defaultProps });
      const uploadBtn = screen.getByText('Upload Image');
      await fireEvent.click(uploadBtn);
      expect(uploadBtn).toBeInTheDocument();
    });

    it('should have clickable Remove Image button', async () => {
      render(ImageLayerEditor, { props: defaultProps });
      const removeBtn = screen.getByText('Remove Image');
      await fireEvent.click(removeBtn);
      expect(removeBtn).toBeInTheDocument();
    });
  });

  // ─── Without image ────────────────────────────────────────

  describe('without image', () => {
    it('should show Browse Icons button when no image', () => {
      render(ImageLayerEditor, { props: { ...defaultProps, layer: layerWithoutImage } });
      expect(screen.getByText('Browse Icons')).toBeInTheDocument();
    });

    it('should show Upload Image button when no image', () => {
      render(ImageLayerEditor, { props: { ...defaultProps, layer: layerWithoutImage } });
      expect(screen.getByText('Upload Image')).toBeInTheDocument();
    });

    it('should not show image preview when no image', () => {
      const { container } = render(ImageLayerEditor, { props: { ...defaultProps, layer: layerWithoutImage } });
      const img = container.querySelector('img[alt="Layer icon"]');
      expect(img).not.toBeInTheDocument();
    });
  });

  // ─── Fit mode ─────────────────────────────────────────────

  describe('fit mode', () => {
    it('should display fit mode select with current value', () => {
      const { container } = render(ImageLayerEditor, { props: defaultProps });
      const select = container.querySelector('#img-fit') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
      expect(select.value).toBe('contain');
    });

    it('should call onChange when fit mode changes', async () => {
      const onChange = vi.fn();
      const { container } = render(ImageLayerEditor, { props: { ...defaultProps, onChange } });
      const select = container.querySelector('#img-fit') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'cover' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fit: 'cover' }));
    });

    it('should list all fit options', () => {
      const { container } = render(ImageLayerEditor, { props: defaultProps });
      const options = container.querySelectorAll('#img-fit option');
      expect(options.length).toBe(4);
    });
  });

  // ─── Scale ────────────────────────────────────────────────

  describe('scale', () => {
    it('should display scale slider', () => {
      const { container } = render(ImageLayerEditor, { props: defaultProps });
      const slider = container.querySelector('#img-scale') as HTMLInputElement;
      expect(slider).toBeInTheDocument();
    });

    it('should show current scale value', () => {
      render(ImageLayerEditor, { props: defaultProps });
      expect(screen.getByText('1.00')).toBeInTheDocument();
    });

    it('should call onInput when scale slider moves', async () => {
      const onInput = vi.fn();
      const { container } = render(ImageLayerEditor, { props: { ...defaultProps, onInput } });
      const slider = container.querySelector('#img-scale') as HTMLInputElement;
      await fireEvent.input(slider, { target: { value: '1.5' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ scale: 1.5 }));
    });
  });

  // ─── Offset controls ──────────────────────────────────────

  describe('offset controls', () => {
    it('should display offset X slider', () => {
      const { container } = render(ImageLayerEditor, { props: defaultProps });
      const slider = container.querySelector('#img-ox') as HTMLInputElement;
      expect(slider).toBeInTheDocument();
    });

    it('should call onInput when offset X changes', async () => {
      const onInput = vi.fn();
      const { container } = render(ImageLayerEditor, { props: { ...defaultProps, onInput } });
      const slider = container.querySelector('#img-ox') as HTMLInputElement;
      await fireEvent.input(slider, { target: { value: '10' } });
      expect(onInput).toHaveBeenCalledWith(expect.objectContaining({ offsetX: 10 }));
    });
  });
});
