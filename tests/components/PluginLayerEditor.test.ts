import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PluginLayerEditor from '../../src/renderer/components/PluginLayerEditor.svelte';
import type { PluginLayer } from '../../src/shared/types';

describe('PluginLayerEditor', () => {
  const defaultLayer: PluginLayer = {
    id: 'layer-plugin-1',
    type: 'plugin',
    name: 'Plugin Image',
    visible: true,
    opacity: 1,
    locked: false,
    fit: 'contain',
    pluginId: 'obs',
    imageId: 'scene-preview'
  };

  const defaultProps = {
    layer: defaultLayer,
    pluginName: 'OBS Studio',
    onChange: vi.fn()
  };

  // ─── Fit mode select ──────────────────────────────────────

  describe('fit mode', () => {
    it('should display fit mode select', () => {
      const { container } = render(PluginLayerEditor, { props: defaultProps });
      const select = container.querySelector('#plugin-fit') as HTMLSelectElement;
      expect(select).toBeInTheDocument();
    });

    it('should show current fit value', () => {
      const { container } = render(PluginLayerEditor, { props: defaultProps });
      const select = container.querySelector('#plugin-fit') as HTMLSelectElement;
      expect(select.value).toBe('contain');
    });

    it('should call onChange when fit mode changes', async () => {
      const onChange = vi.fn();
      const { container } = render(PluginLayerEditor, { props: { ...defaultProps, onChange } });
      const select = container.querySelector('#plugin-fit') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'cover' } });
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fit: 'cover' }));
    });

    it('should list all four fit options', () => {
      const { container } = render(PluginLayerEditor, { props: defaultProps });
      const options = container.querySelectorAll('#plugin-fit option');
      expect(options.length).toBe(4);
    });

    it('should preserve other layer properties when changing fit', async () => {
      const onChange = vi.fn();
      const { container } = render(PluginLayerEditor, { props: { ...defaultProps, onChange } });
      const select = container.querySelector('#plugin-fit') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'stretch' } });
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'layer-plugin-1',
          type: 'plugin',
          pluginId: 'obs',
          fit: 'stretch'
        })
      );
    });
  });

  // ─── Info text ────────────────────────────────────────────

  describe('info text', () => {
    it('should display plugin name', () => {
      render(PluginLayerEditor, { props: defaultProps });
      expect(screen.getByText('OBS Studio')).toBeInTheDocument();
    });

    it('should display pluginId when present', () => {
      render(PluginLayerEditor, { props: defaultProps });
      expect(screen.getByText('(plugin: obs)')).toBeInTheDocument();
    });

    it('should not display pluginId when absent', () => {
      const layerWithoutPluginId = { ...defaultLayer, pluginId: undefined };
      render(PluginLayerEditor, { props: { ...defaultProps, layer: layerWithoutPluginId } });
      expect(screen.queryByText(/\(plugin:/)).not.toBeInTheDocument();
    });

    it('should show description about dynamic images', () => {
      render(PluginLayerEditor, { props: defaultProps });
      expect(screen.getByText(/pushes dynamic images/)).toBeInTheDocument();
    });

    it('should use default plugin name when not provided', () => {
      render(PluginLayerEditor, { props: { layer: defaultLayer } });
      expect(screen.getByText('plugin')).toBeInTheDocument();
    });
  });

  // ─── Label ────────────────────────────────────────────────

  describe('label', () => {
    it('should display Fit Mode label', () => {
      render(PluginLayerEditor, { props: defaultProps });
      expect(screen.getByText('Fit Mode')).toBeInTheDocument();
    });
  });
});
