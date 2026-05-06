import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import KnobCell from '../../src/renderer/components/KnobCell.svelte';
import type { KnobControl, KnobBinding } from '../../src/shared/types';

describe('KnobCell', () => {
  const defaultControl: KnobControl = {
    type: 'knob',
    id: 'knobTL',
    label: 'Top Left',
    side: 'left'
  };

  // ─── Empty state ──────────────────────────────────────────

  describe('empty state', () => {
    it('should render with knob label', () => {
      render(KnobCell, { props: { control: defaultControl } });
      expect(screen.getByText('Top Left')).toBeInTheDocument();
    });

    it('should show a dot when no binding', () => {
      const { container } = render(KnobCell, { props: { control: defaultControl } });
      expect(container.querySelector('.knob-dot')).toBeInTheDocument();
    });

    it('should have correct title attribute', () => {
      render(KnobCell, { props: { control: defaultControl } });
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('title', 'Top Left knob');
    });

    it('should not have selected class by default', () => {
      const { container } = render(KnobCell, { props: { control: defaultControl } });
      const button = container.querySelector('.knob-cell');
      expect(button?.classList.contains('selected')).toBe(false);
    });

    it('should not have has-binding class when no binding', () => {
      const { container } = render(KnobCell, { props: { control: defaultControl } });
      const button = container.querySelector('.knob-cell');
      expect(button?.classList.contains('has-binding')).toBe(false);
    });
  });

  // ─── With binding ────────────────────────────────────────

  describe('with binding', () => {
    const binding: KnobBinding = {
      rotateClockwise: {
        id: 'act-1',
        type: 'hotkey',
        label: 'Volume Up',
        config: { steps: [{ modifiers: [], key: 'VolumeUp' }] }
      }
    };

    it('should show summary label from CW action', () => {
      render(KnobCell, { props: { control: defaultControl, binding } });
      expect(screen.getByText('Volume Up')).toBeInTheDocument();
    });

    it('should have has-binding class', () => {
      const { container } = render(KnobCell, { props: { control: defaultControl, binding } });
      const button = container.querySelector('.knob-cell');
      expect(button?.classList.contains('has-binding')).toBe(true);
    });

    it('should prefer CW label over CCW label', () => {
      const mixedBinding: KnobBinding = {
        rotateClockwise: { id: 'a1', type: 'hotkey', label: 'CW Action', config: {} },
        rotateCounterClockwise: { id: 'a2', type: 'hotkey', label: 'CCW Action', config: {} }
      };
      render(KnobCell, { props: { control: defaultControl, binding: mixedBinding } });
      expect(screen.getByText('CW Action')).toBeInTheDocument();
    });

    it('should fall back to CCW label when no CW', () => {
      const ccwOnlyBinding: KnobBinding = {
        rotateCounterClockwise: { id: 'a2', type: 'hotkey', label: 'CCW Only', config: {} }
      };
      render(KnobCell, { props: { control: defaultControl, binding: ccwOnlyBinding } });
      expect(screen.getByText('CCW Only')).toBeInTheDocument();
    });

    it('should fall back to press label when no rotate bindings', () => {
      const pressOnlyBinding: KnobBinding = {
        press: { id: 'a3', type: 'hotkey', label: 'Press Action', config: {} }
      };
      render(KnobCell, { props: { control: defaultControl, binding: pressOnlyBinding } });
      expect(screen.getByText('Press Action')).toBeInTheDocument();
    });
  });

  // ─── Selection ────────────────────────────────────────────

  describe('selection', () => {
    it('should apply selected class when isSelected is true', () => {
      const { container } = render(KnobCell, {
        props: { control: defaultControl, isSelected: true }
      });
      const button = container.querySelector('.knob-cell');
      expect(button?.classList.contains('selected')).toBe(true);
    });

    it('should be clickable', async () => {
      const { container } = render(KnobCell, {
        props: { control: defaultControl }
      });
      const button = container.querySelector('button')!;
      const clickHandler = vi.fn();
      button.addEventListener('click', clickHandler);
      await fireEvent.click(button);
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Different controls ──────────────────────────────────

  describe('different controls', () => {
    it('should render with different control label', () => {
      const control: KnobControl = {
        type: 'knob',
        id: 'knobCR',
        label: 'Center Right',
        side: 'right'
      };
      render(KnobCell, { props: { control } });
      expect(screen.getByText('Center Right')).toBeInTheDocument();
      expect(screen.getByRole('button')).toHaveAttribute('title', 'Center Right knob');
    });
  });
});
