import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import VirtualDevicePanel from '../../src/renderer/components/VirtualDevicePanel.svelte';
import { mockOSCApi } from '../setup-renderer';

describe('VirtualDevicePanel', () => {
  beforeEach(() => {
    mockOSCApi.virtualDeviceGetConfigs.mockResolvedValue([]);
  });

  // ─── Visibility ───────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      const { container } = render(VirtualDevicePanel, {
        props: { visible: false, onClose: vi.fn() }
      });
      expect(container.querySelector('.vdp-overlay')).not.toBeInTheDocument();
    });

    it('should render when visible is true', () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      expect(screen.getByText('Virtual Devices')).toBeInTheDocument();
    });
  });

  // ─── Header ───────────────────────────────────────────────

  describe('header', () => {
    it('should display title', () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      expect(screen.getByText('Virtual Devices')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(VirtualDevicePanel, { props: { visible: true, onClose } });
      await fireEvent.click(screen.getByText('✕'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── Empty state ──────────────────────────────────────────

  describe('empty state', () => {
    it('should show empty message when no devices', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('No virtual devices yet.')).toBeInTheDocument();
      });
    });

    it('should show helpful description', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(
          screen.getByText('Create a software-only deck that works without physical hardware.')
        ).toBeInTheDocument();
      });
    });

    it('should show New Virtual Device button', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
    });
  });

  // ─── Device list ──────────────────────────────────────────

  describe('device list', () => {
    const mockDevices = [
      {
        id: 'vd-1',
        name: 'My Deck',
        rows: 3,
        columns: 5,
        keySize: 96,
        encoders: 2,
        encoderPosition: 'left' as const,
        sliders: 0,
        sliderPosition: 'none' as const
      },
      {
        id: 'vd-2',
        name: 'Mini Deck',
        rows: 2,
        columns: 3,
        keySize: 72,
        encoders: 0,
        encoderPosition: 'none' as const,
        sliders: 1,
        sliderPosition: 'right' as const
      }
    ];

    beforeEach(() => {
      mockOSCApi.virtualDeviceGetConfigs.mockResolvedValue(mockDevices);
    });

    it('should display device names', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('My Deck')).toBeInTheDocument();
        expect(screen.getByText('Mini Deck')).toBeInTheDocument();
      });
    });

    it('should display device dimensions', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText(/3×5/)).toBeInTheDocument();
        expect(screen.getByText(/2×3/)).toBeInTheDocument();
      });
    });

    it('should display encoder count when present', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText(/2E/)).toBeInTheDocument();
      });
    });

    it('should display slider count when present', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText(/1S/)).toBeInTheDocument();
      });
    });

    it('should show Open, Edit, and Delete buttons for each device', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        const openBtns = screen.getAllByText('Open');
        const editBtns = screen.getAllByText('Edit');
        const deleteBtns = screen.getAllByText('Delete');
        expect(openBtns.length).toBe(2);
        expect(editBtns.length).toBe(2);
        expect(deleteBtns.length).toBe(2);
      });
    });

    it('should call virtualDeckOpen when Open is clicked', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getAllByText('Open').length).toBe(2);
      });
      await fireEvent.click(screen.getAllByText('Open')[0]);
      expect(mockOSCApi.virtualDeckOpen).toHaveBeenCalledWith('vd-1');
    });
  });

  // ─── Create form ──────────────────────────────────────────

  describe('create form', () => {
    it('should show form when New Virtual Device is clicked', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      expect(screen.getByText('New Virtual Device')).toBeInTheDocument();
    });

    it('should show form fields', async () => {
      const { container } = render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));

      expect(container.querySelector('#vdp-name')).toBeInTheDocument();
      expect(container.querySelector('#vdp-rows')).toBeInTheDocument();
      expect(container.querySelector('#vdp-cols')).toBeInTheDocument();
      expect(container.querySelector('#vdp-keysize')).toBeInTheDocument();
      expect(container.querySelector('#vdp-encoders')).toBeInTheDocument();
      expect(container.querySelector('#vdp-sliders')).toBeInTheDocument();
    });

    it('should have default values', async () => {
      const { container } = render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));

      expect((container.querySelector('#vdp-name') as HTMLInputElement).value).toBe('Virtual Deck');
      expect((container.querySelector('#vdp-rows') as HTMLInputElement).value).toBe('3');
      expect((container.querySelector('#vdp-cols') as HTMLInputElement).value).toBe('5');
      expect((container.querySelector('#vdp-keysize') as HTMLInputElement).value).toBe('96');
    });

    it('should show Create Device button', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      expect(screen.getByText('Create Device')).toBeInTheDocument();
    });

    it('should show Cancel button', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should return to device list when Cancel is clicked', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      expect(screen.getByText('New Virtual Device')).toBeInTheDocument();

      await fireEvent.click(screen.getByText('Cancel'));
      await waitFor(() => {
        expect(screen.getByText('No virtual devices yet.')).toBeInTheDocument();
      });
    });

    it('should call virtualDeviceCreate on submit', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      await fireEvent.click(screen.getByText('Create Device'));
      await waitFor(() => {
        expect(mockOSCApi.virtualDeviceCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            name: 'Virtual Deck',
            rows: 3,
            columns: 5,
            keySize: 96
          })
        );
      });
    });

    it('should show preview text', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));
      expect(screen.getByText(/3×5 grid/)).toBeInTheDocument();
    });
  });

  // ─── Delete confirmation ──────────────────────────────────

  describe('delete confirmation', () => {
    beforeEach(() => {
      mockOSCApi.virtualDeviceGetConfigs.mockResolvedValue([
        {
          id: 'vd-1',
          name: 'My Deck',
          rows: 3,
          columns: 5,
          keySize: 96,
          encoders: 0,
          encoderPosition: 'none',
          sliders: 0,
          sliderPosition: 'none'
        }
      ]);
    });

    it('should show Confirm and Cancel on delete click', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Delete'));
      expect(screen.getByText('Confirm')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('should call virtualDeviceDelete when confirmed', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Delete'));
      await fireEvent.click(screen.getByText('Confirm'));
      await waitFor(() => {
        expect(mockOSCApi.virtualDeviceDelete).toHaveBeenCalledWith('vd-1');
      });
    });

    it('should cancel delete confirmation', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Delete'));
      await fireEvent.click(screen.getByText('Cancel'));
      // Should go back to normal action buttons
      await waitFor(() => {
        expect(screen.getByText('Open')).toBeInTheDocument();
        expect(screen.getByText('Delete')).toBeInTheDocument();
      });
    });
  });

  // ─── Edit form ────────────────────────────────────────────

  describe('edit form', () => {
    const existingDevice = {
      id: 'vd-1',
      name: 'My Deck',
      rows: 4,
      columns: 6,
      keySize: 72,
      encoders: 2,
      encoderPosition: 'left' as const,
      sliders: 1,
      sliderPosition: 'right' as const
    };

    beforeEach(() => {
      mockOSCApi.virtualDeviceGetConfigs.mockResolvedValue([existingDevice]);
    });

    it('should show Edit Device title when editing', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Edit'));
      expect(screen.getByText('Edit Device')).toBeInTheDocument();
    });

    it('should pre-fill form with device values', async () => {
      const { container } = render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Edit'));

      expect((container.querySelector('#vdp-name') as HTMLInputElement).value).toBe('My Deck');
      expect((container.querySelector('#vdp-rows') as HTMLInputElement).value).toBe('4');
      expect((container.querySelector('#vdp-cols') as HTMLInputElement).value).toBe('6');
      expect((container.querySelector('#vdp-keysize') as HTMLInputElement).value).toBe('72');
    });

    it('should show Save Changes button when editing', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Edit'));
      expect(screen.getByText('Save Changes')).toBeInTheDocument();
    });

    it('should call virtualDeviceUpdate on save', async () => {
      render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Edit'));
      await fireEvent.click(screen.getByText('Save Changes'));
      await waitFor(() => {
        expect(mockOSCApi.virtualDeviceUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'vd-1',
            name: 'My Deck',
            rows: 4,
            columns: 6
          })
        );
      });
    });
  });

  // ─── Form validation ──────────────────────────────────────

  describe('form validation', () => {
    it('should show error when name is empty', async () => {
      const { container } = render(VirtualDevicePanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('+ New Virtual Device'));

      const nameInput = container.querySelector('#vdp-name') as HTMLInputElement;
      await fireEvent.input(nameInput, { target: { value: '' } });
      await fireEvent.click(screen.getByText('Create Device'));

      await waitFor(() => {
        expect(screen.getByText('Name is required')).toBeInTheDocument();
      });
    });
  });
});
