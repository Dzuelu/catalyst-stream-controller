import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CalibrationPanel from '../../src/renderer/components/CalibrationPanel.svelte';
import { mockOSCApi } from '../setup-renderer';
import { selectedDeviceId } from '../../src/renderer/stores/device';

describe('CalibrationPanel', () => {
  const onClose = vi.fn();
  const onReapplyKeys = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    onReapplyKeys.mockReset();
    selectedDeviceId.set('device-1');
  });

  // ─── Visibility ──────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      render(CalibrationPanel, {
        props: { visible: false, onClose, onReapplyKeys }
      });
      expect(screen.queryByText('⚙ Calibration Settings')).not.toBeInTheDocument();
    });

    it('should render when visible is true', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText('⚙ Calibration Settings')).toBeInTheDocument();
    });
  });

  // ─── Content when visible ────────────────────────────────

  describe('content', () => {
    it('should show description text', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText(/Adjust how much of each key/)).toBeInTheDocument();
    });

    it('should show calibration pattern toggle button', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText('🎨 Show Calibration Pattern')).toBeInTheDocument();
    });

    it('should show four inset sliders', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText('Top')).toBeInTheDocument();
      expect(screen.getByText('Bottom')).toBeInTheDocument();
      expect(screen.getByText('Left')).toBeInTheDocument();
      expect(screen.getByText('Right')).toBeInTheDocument();
    });

    it('should show preview area', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText('Safe Area')).toBeInTheDocument();
      expect(screen.getByText(/Preview/)).toBeInTheDocument();
    });

    it('should show safe area dimensions', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      // Default insets: top=2, bottom=20, left=10, right=10
      // Safe area: (96-10-10)×(96-2-20) = 76×74
      expect(screen.getByText(/76×74px/)).toBeInTheDocument();
    });

    it('should show close button', () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      expect(screen.getByText('✕')).toBeInTheDocument();
    });
  });

  // ─── Interactions ────────────────────────────────────────

  describe('interactions', () => {
    it('should call onClose when close button is clicked', async () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      await fireEvent.click(screen.getByText('✕'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('should toggle calibration pattern on button click', async () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      const toggleButton = screen.getByText('🎨 Show Calibration Pattern');
      await fireEvent.click(toggleButton);
      expect(mockOSCApi.drawCalibration).toHaveBeenCalledTimes(1);
      // Button text should change
      expect(screen.getByText('✓ Calibration Pattern Active')).toBeInTheDocument();
    });

    it('should call onReapplyKeys when toggling pattern off', async () => {
      render(CalibrationPanel, {
        props: { visible: true, onClose, onReapplyKeys }
      });
      // Toggle on
      await fireEvent.click(screen.getByText('🎨 Show Calibration Pattern'));
      // Toggle off
      await fireEvent.click(screen.getByText('✓ Calibration Pattern Active'));
      expect(onReapplyKeys).toHaveBeenCalledTimes(1);
    });
  });
});
