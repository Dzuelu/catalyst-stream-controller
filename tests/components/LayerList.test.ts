import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LayerList from '../../src/renderer/components/LayerList.svelte';
import type { Layer, FillLayer, TextLayer, ImageLayer } from '../../src/shared/types';

describe('LayerList', () => {
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

  const defaultProps = {
    layers: [fillLayer, textLayer, imageLayer] as Layer[],
    selectedLayerId: null,
    hasPluginAction: false
  };

  // ─── Empty state ──────────────────────────────────────────

  describe('empty state', () => {
    it('should show "No layers" when list is empty', () => {
      render(LayerList, { props: { layers: [], selectedLayerId: null, hasPluginAction: false } });
      expect(screen.getByText('No layers')).toBeInTheDocument();
    });

    it('should show the header label', () => {
      render(LayerList, { props: defaultProps });
      expect(screen.getByText('Layers')).toBeInTheDocument();
    });
  });

  // ─── Layer display ────────────────────────────────────────

  describe('layer display', () => {
    it('should display all layer names', () => {
      render(LayerList, { props: defaultProps });
      expect(screen.getByText('Background')).toBeInTheDocument();
      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Icon')).toBeInTheDocument();
    });

    it('should display layers in reverse order (top = highest z-order)', () => {
      const { container } = render(LayerList, { props: defaultProps });
      const layerNames = container.querySelectorAll('.truncate');
      const names = Array.from(layerNames).map((el) => el.textContent?.trim());
      // Reversed: Icon (last in array) appears first in display
      expect(names[0]).toBe('Icon');
      expect(names[1]).toBe('Title');
      expect(names[2]).toBe('Background');
    });

    it('should show layer type badges', () => {
      render(LayerList, { props: defaultProps });
      expect(screen.getByText('fill')).toBeInTheDocument();
      expect(screen.getByText('text')).toBeInTheDocument();
      expect(screen.getByText('image')).toBeInTheDocument();
    });
  });

  // ─── Selection ────────────────────────────────────────────

  describe('selection', () => {
    it('should have clickable layer items', async () => {
      const { container } = render(LayerList, { props: defaultProps });
      const layerItems = container.querySelectorAll('[draggable="true"]');
      // Each layer should be a clickable element
      expect(layerItems.length).toBe(3);
      // Verify cursor-pointer class is present (clickable)
      expect(layerItems[0].className).toContain('cursor-pointer');
    });

    it('should highlight selected layer', () => {
      const { container } = render(LayerList, {
        props: { ...defaultProps, selectedLayerId: 'layer-fill-1' }
      });
      // The selected layer should have the accent styling
      const layerItems = container.querySelectorAll('[draggable="true"]');
      const selectedItem = Array.from(layerItems).find((el) => el.className.includes('border-l-[var(--color-accent)]'));
      expect(selectedItem).toBeTruthy();
    });
  });

  // ─── Visibility toggle ────────────────────────────────────

  describe('visibility toggle', () => {
    it('should have clickable visibility toggle buttons', async () => {
      render(LayerList, { props: defaultProps });
      const visibilityButtons = screen.getAllByTitle('Hide layer');
      expect(visibilityButtons.length).toBe(3);
      // Verify buttons are interactive
      await fireEvent.click(visibilityButtons[0]);
      // No error means the handler executed successfully
    });

    it('should show hide title for visible layers', () => {
      render(LayerList, { props: defaultProps });
      const hideButtons = screen.getAllByTitle('Hide layer');
      expect(hideButtons.length).toBe(3);
    });

    it('should show show title for hidden layers', () => {
      const hiddenLayer = { ...fillLayer, visible: false };
      render(LayerList, {
        props: { ...defaultProps, layers: [hiddenLayer] }
      });
      expect(screen.getByTitle('Show layer')).toBeInTheDocument();
    });
  });

  // ─── Lock toggle ──────────────────────────────────────────

  describe('lock toggle', () => {
    it('should have clickable lock toggle buttons', async () => {
      render(LayerList, { props: defaultProps });
      const lockButtons = screen.getAllByTitle('Lock layer');
      expect(lockButtons.length).toBe(3);
      // Verify buttons are interactive
      await fireEvent.click(lockButtons[0]);
      // No error means the handler executed successfully
    });

    it('should show unlock title for locked layers', () => {
      const lockedLayer = { ...fillLayer, locked: true };
      render(LayerList, {
        props: { ...defaultProps, layers: [lockedLayer] }
      });
      expect(screen.getByTitle('Unlock layer')).toBeInTheDocument();
    });
  });

  // ─── Add layer menu ───────────────────────────────────────

  describe('add layer menu', () => {
    it('should show Add button', () => {
      render(LayerList, { props: defaultProps });
      expect(screen.getByText('+ Add ▾')).toBeInTheDocument();
    });

    it('should show layer type options when Add is clicked', async () => {
      render(LayerList, { props: defaultProps });
      await fireEvent.click(screen.getByText('+ Add ▾'));

      expect(screen.getByText('Fill')).toBeInTheDocument();
      expect(screen.getByText('Image')).toBeInTheDocument();
      expect(screen.getByText('Text')).toBeInTheDocument();
    });

    it('should not show Plugin Image option when hasPluginAction is false', async () => {
      render(LayerList, { props: defaultProps });
      await fireEvent.click(screen.getByText('+ Add ▾'));

      expect(screen.queryByText('Plugin Image')).not.toBeInTheDocument();
    });

    it('should show Plugin Image option when hasPluginAction is true', async () => {
      render(LayerList, { props: { ...defaultProps, hasPluginAction: true } });
      await fireEvent.click(screen.getByText('+ Add ▾'));

      expect(screen.getByText('Plugin Image')).toBeInTheDocument();
    });

    it('should close menu after selecting a layer type', async () => {
      render(LayerList, { props: defaultProps });

      await fireEvent.click(screen.getByText('+ Add ▾'));
      expect(screen.getByText('Fill')).toBeInTheDocument();

      await fireEvent.click(screen.getByText('Fill'));
      // Menu should be closed after selection
      expect(screen.queryByText('Image')).not.toBeInTheDocument();
    });

    it('should disable Add button when at max layers', () => {
      const maxLayers = Array.from({ length: 8 }, (_, i) => ({
        ...fillLayer,
        id: `layer-${i}`,
        name: `Layer ${i}`
      }));
      render(LayerList, {
        props: { layers: maxLayers, selectedLayerId: null, hasPluginAction: false }
      });
      const addButton = screen.getByText('+ Add ▾');
      expect(addButton).toBeDisabled();
    });
  });

  // ─── Drag and drop ────────────────────────────────────────

  describe('drag and drop', () => {
    it('should have draggable layers', () => {
      const { container } = render(LayerList, { props: defaultProps });
      const draggables = container.querySelectorAll('[draggable="true"]');
      expect(draggables.length).toBe(3);
    });

    it('should support drag start on layers', async () => {
      const { container } = render(LayerList, { props: defaultProps });

      const draggables = container.querySelectorAll('[draggable="true"]');
      const dataTransfer = { effectAllowed: '', setData: vi.fn() };

      await fireEvent.dragStart(draggables[0], { dataTransfer });
      // Verify drag data was set
      expect(dataTransfer.setData).toHaveBeenCalledWith('application/x-osc-layer', expect.any(String));
    });
  });
});
