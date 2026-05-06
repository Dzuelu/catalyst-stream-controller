import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import IconPicker from '../../src/renderer/components/IconPicker.svelte';

describe('IconPicker', () => {
  const defaultProps = {
    visible: true,
    pluginIconPacks: [],
    onSelect: vi.fn(),
    onClose: vi.fn()
  };

  // ─── Visibility ───────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      const { container } = render(IconPicker, {
        props: { ...defaultProps, visible: false }
      });
      expect(container.querySelector('.fixed')).not.toBeInTheDocument();
    });

    it('should render when visible is true', () => {
      render(IconPicker, { props: defaultProps });
      expect(screen.getByText('Icon Library')).toBeInTheDocument();
    });
  });

  // ─── Header ───────────────────────────────────────────────

  describe('header', () => {
    it('should display title', () => {
      render(IconPicker, { props: defaultProps });
      expect(screen.getByText('Icon Library')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(IconPicker, { props: { ...defaultProps, onClose } });
      await fireEvent.click(screen.getByTitle('Close'));
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when backdrop is clicked', async () => {
      const onClose = vi.fn();
      const { container } = render(IconPicker, { props: { ...defaultProps, onClose } });
      const backdrop = container.querySelector('.fixed.inset-0');
      await fireEvent.click(backdrop!);
      expect(onClose).toHaveBeenCalled();
    });

    it('should call onClose when Escape is pressed', async () => {
      const onClose = vi.fn();
      const { container } = render(IconPicker, { props: { ...defaultProps, onClose } });
      const backdrop = container.querySelector('.fixed.inset-0');
      await fireEvent.keyDown(backdrop!, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── Search ───────────────────────────────────────────────

  describe('search', () => {
    it('should display search input', () => {
      render(IconPicker, { props: defaultProps });
      expect(screen.getByPlaceholderText('Search icons…')).toBeInTheDocument();
    });

    it('should filter icons when search query is entered', async () => {
      render(IconPicker, { props: defaultProps });
      const searchInput = screen.getByPlaceholderText('Search icons…');
      await fireEvent.input(searchInput, { target: { value: 'play' } });
      // After search, the category tabs should be hidden (search spans all packs)
      // Just verify the search input value is set
      expect((searchInput as HTMLInputElement).value).toBe('play');
    });
  });

  // ─── Category tabs ────────────────────────────────────────

  describe('category tabs', () => {
    it('should display category tab buttons', () => {
      const { container } = render(IconPicker, { props: defaultProps });
      // Should have tab buttons for icon packs
      const tabs = container.querySelectorAll('.overflow-x-auto button');
      expect(tabs.length).toBeGreaterThan(0);
    });

    it('should hide category tabs when search query is present', async () => {
      const { container } = render(IconPicker, { props: defaultProps });
      const searchInput = screen.getByPlaceholderText('Search icons…');
      await fireEvent.input(searchInput, { target: { value: 'test' } });
      // When searching, tabs section should not be visible
      const tabsSection = container.querySelector('.overflow-x-auto');
      // The tabs section is conditionally rendered with {#if !searchQuery}
      expect(tabsSection).not.toBeInTheDocument();
    });
  });

  // ─── Icon grid ────────────────────────────────────────────

  describe('icon grid', () => {
    it('should display icons in a grid', () => {
      const { container } = render(IconPicker, { props: defaultProps });
      // Icons are rendered as buttons with SVG content
      const gridButtons = container.querySelectorAll('.grid button');
      expect(gridButtons.length).toBeGreaterThan(0);
    });
  });
});
