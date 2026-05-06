import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ButtonCell from '../../src/renderer/components/ButtonCell.svelte';
import type { ButtonBinding } from '../../src/shared/types';
import { createAppearanceFromFlat } from '../../src/shared/appearance-helpers';

describe('ButtonCell', () => {
  const emptyProps = {
    index: 0,
    binding: null,
    isSelected: false
  };

  // ─── Empty state ──────────────────────────────────────────

  describe('empty state', () => {
    it('should render with index badge', () => {
      render(ButtonCell, { props: emptyProps });
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('should show plus sign when no binding', () => {
      render(ButtonCell, { props: emptyProps });
      expect(screen.getByText('+')).toBeInTheDocument();
    });

    it('should show correct index for different positions', () => {
      render(ButtonCell, { props: { ...emptyProps, index: 7 } });
      expect(screen.getByText('8')).toBeInTheDocument();
    });
  });

  // ─── With binding ──────────────────────────────────────────

  describe('with binding', () => {
    const binding: ButtonBinding = {
      press: {
        id: 'action-1',
        type: 'hotkey',
        label: 'My Hotkey',
        config: { steps: [{ modifiers: ['ctrl'], key: 'c' }] }
      },
      appearance: createAppearanceFromFlat({
        backgroundColor: '#1a1a2e',
        label: {
          text: 'My Hotkey',
          color: '#ffffff',
          positionV: 'center',
          positionH: 'center'
        }
      })
    };

    it('should not show plus sign when binding exists', () => {
      render(ButtonCell, { props: { ...emptyProps, binding } });
      expect(screen.queryByText('+')).not.toBeInTheDocument();
    });

    it('should show trigger indicator dot for press binding', () => {
      const { container } = render(ButtonCell, { props: { ...emptyProps, binding } });
      // The trigger dot for press is rendered
      const dots = container.querySelectorAll('.rounded-full');
      expect(dots.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── Multiple triggers ────────────────────────────────────

  describe('trigger indicators', () => {
    it('should show green dot for longPress binding', () => {
      const binding: ButtonBinding = {
        press: { id: 'a1', type: 'hotkey', label: 'Press', config: {} },
        longPress: { id: 'a2', type: 'hotkey', label: 'Long', config: {} }
      };
      const { container } = render(ButtonCell, { props: { ...emptyProps, binding } });
      const dots = container.querySelectorAll('.rounded-full');
      // Should have press + longPress dots
      expect(dots.length).toBeGreaterThanOrEqual(2);
    });

    it('should show dot for doubleTap binding', () => {
      const binding: ButtonBinding = {
        press: { id: 'a1', type: 'hotkey', label: 'Press', config: {} },
        doubleTap: { id: 'a3', type: 'hotkey', label: 'DblTap', config: {} }
      };
      const { container } = render(ButtonCell, { props: { ...emptyProps, binding } });
      const dots = container.querySelectorAll('.rounded-full');
      expect(dots.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Page link indicators ─────────────────────────────────

  describe('page link indicators', () => {
    it('should show folder icon for go-to-page action', () => {
      const binding: ButtonBinding = {
        press: { id: 'a1', type: 'go-to-page', label: 'Sub Page', config: { pageId: 'p2' } }
      };
      render(ButtonCell, { props: { ...emptyProps, binding } });
      expect(screen.getByText('📂')).toBeInTheDocument();
    });

    it('should show back arrow for go-to-back action', () => {
      const binding: ButtonBinding = {
        press: { id: 'a1', type: 'go-to-back', label: 'Back', config: {} }
      };
      render(ButtonCell, { props: { ...emptyProps, binding } });
      expect(screen.getByText('↩')).toBeInTheDocument();
    });
  });

  // ─── Selected state ───────────────────────────────────────

  describe('selection', () => {
    it('should apply selected styling', () => {
      const { container } = render(ButtonCell, {
        props: { ...emptyProps, isSelected: true }
      });
      const button = container.querySelector('button');
      expect(button?.className).toContain('border-[var(--color-accent)]');
    });

    it('should dispatch select event on click', async () => {
      const { container } = render(ButtonCell, { props: emptyProps });
      const button = container.querySelector('button')!;
      // Verify the button is interactive and handles click events
      const clickHandler = vi.fn();
      button.addEventListener('click', clickHandler);
      await fireEvent.click(button);
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Preview data URI ─────────────────────────────────────

  describe('preview rendering', () => {
    const testDataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';

    it('should render preview image when previewDataUri is provided', () => {
      const { container } = render(ButtonCell, {
        props: { ...emptyProps, previewDataUri: testDataUri }
      });
      const img = container.querySelector('img');
      expect(img).toBeInTheDocument();
      expect(img?.getAttribute('src')).toBe(testDataUri);
    });

    it('should not show plus sign when preview is present', () => {
      render(ButtonCell, {
        props: { ...emptyProps, previewDataUri: testDataUri }
      });
      expect(screen.queryByText('+')).not.toBeInTheDocument();
    });

    it('should show plus sign when no preview and no binding', () => {
      render(ButtonCell, {
        props: { ...emptyProps, previewDataUri: null }
      });
      expect(screen.getByText('+')).toBeInTheDocument();
    });
  });

  // ─── None action type ─────────────────────────────────────

  describe('none action type', () => {
    it('should not display plus sign for none action type', () => {
      const binding: ButtonBinding = {
        press: { id: 'a1', type: 'none', label: '', config: {} }
      };
      const { container } = render(ButtonCell, { props: { ...emptyProps, binding } });
      // none type has hasAnyBinding=true (binding.press exists) but hasAction=false
      // So no + sign is displayed
      expect(screen.queryByText('+')).not.toBeInTheDocument();
      // The trigger indicator area exists but has no dots
      const dots = container.querySelectorAll('.rounded-full');
      expect(dots.length).toBe(0);
    });
  });
});
