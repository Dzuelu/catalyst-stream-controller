import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import VirtualDeckButton from '../../src/renderer/components/virtual-deck/VirtualDeckButton.svelte';
import VirtualDeckKnob from '../../src/renderer/components/virtual-deck/VirtualDeckKnob.svelte';
import VirtualDeckSlider from '../../src/renderer/components/virtual-deck/VirtualDeckSlider.svelte';
import VirtualDevicePanel from '../../src/renderer/components/VirtualDevicePanel.svelte';
import { mockOSCApi } from '../setup-renderer';
import type { KnobControl, SliderControl } from '../../src/shared/types';

// ─── VirtualDeckButton ──────────────────────────────────────────

describe('VirtualDeckButton', () => {
  const defaultProps = {
    deviceId: 'virtual-test-1',
    keyIndex: 3,
    imageDataUri: null as string | null,
    keySize: 96
  };

  it('should render with fallback index label', () => {
    render(VirtualDeckButton, { props: defaultProps });
    expect(screen.getByText('4')).toBeInTheDocument(); // keyIndex 3 → display "4"
  });

  it('should render key image when provided', () => {
    render(VirtualDeckButton, {
      props: { ...defaultProps, imageDataUri: 'data:image/png;base64,AAAA' }
    });
    const img = screen.getByAltText('Key 4');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('should apply custom key size', () => {
    const { container } = render(VirtualDeckButton, {
      props: { ...defaultProps, keySize: 120 }
    });
    const button = container.querySelector('.vd-button') as HTMLElement;
    expect(button.style.width).toBe('120px');
    expect(button.style.height).toBe('120px');
  });

  it('should send keyDown on pointer down', async () => {
    const { container } = render(VirtualDeckButton, { props: defaultProps });
    const button = container.querySelector('.vd-button') as HTMLElement;

    // Mock setPointerCapture
    button.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(button);
    expect(mockOSCApi.virtualDeviceKeyDown).toHaveBeenCalledWith('virtual-test-1', 3);
  });

  it('should send keyUp on pointer up', async () => {
    const { container } = render(VirtualDeckButton, { props: defaultProps });
    const button = container.querySelector('.vd-button') as HTMLElement;
    button.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(button);
    await fireEvent.pointerUp(button);
    expect(mockOSCApi.virtualDeviceKeyUp).toHaveBeenCalledWith('virtual-test-1', 3);
  });

  it('should send keyUp on pointer cancel', async () => {
    const { container } = render(VirtualDeckButton, { props: defaultProps });
    const button = container.querySelector('.vd-button') as HTMLElement;
    button.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(button);
    await fireEvent.pointerCancel(button);
    expect(mockOSCApi.virtualDeviceKeyUp).toHaveBeenCalledWith('virtual-test-1', 3);
  });

  it('should apply pressed class on pointer down', async () => {
    const { container } = render(VirtualDeckButton, { props: defaultProps });
    const button = container.querySelector('.vd-button') as HTMLElement;
    button.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(button);
    expect(button.classList.contains('pressed')).toBe(true);
  });

  it('should remove pressed class on pointer up', async () => {
    const { container } = render(VirtualDeckButton, { props: defaultProps });
    const button = container.querySelector('.vd-button') as HTMLElement;
    button.setPointerCapture = vi.fn();

    await fireEvent.pointerDown(button);
    await fireEvent.pointerUp(button);
    expect(button.classList.contains('pressed')).toBe(false);
  });
});

// ─── VirtualDeckKnob ──────────────────────────────────────────

describe('VirtualDeckKnob', () => {
  const knobControl: KnobControl = {
    type: 'knob',
    id: 'encoder0',
    label: 'Encoder 1',
    side: 'bottom'
  };

  const defaultProps = {
    deviceId: 'virtual-test-1',
    control: knobControl
  };

  it('should render with label', () => {
    render(VirtualDeckKnob, { props: defaultProps });
    expect(screen.getByText('Encoder 1')).toBeInTheDocument();
  });

  it('should render knob ring and indicator', () => {
    const { container } = render(VirtualDeckKnob, { props: defaultProps });
    expect(container.querySelector('.vd-knob-ring')).toBeInTheDocument();
    expect(container.querySelector('.vd-knob-indicator')).toBeInTheDocument();
  });

  it('should send encoder press on click (no drag)', async () => {
    const { container } = render(VirtualDeckKnob, { props: defaultProps });
    const knob = container.querySelector('.vd-knob') as HTMLElement;
    knob.setPointerCapture = vi.fn();

    // getBoundingClientRect needed for circular drag computation
    knob.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 56,
      bottom: 56,
      width: 56,
      height: 56,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    // Click = pointerDown + pointerUp without significant movement
    await fireEvent.pointerDown(knob, { clientX: 28, clientY: 28 });
    await fireEvent.pointerUp(knob, { clientX: 28, clientY: 28 });

    expect(mockOSCApi.virtualDeviceEncoderPress).toHaveBeenCalledWith('virtual-test-1', 'encoder0');
  });

  it('should apply pressed class while held', async () => {
    const { container } = render(VirtualDeckKnob, { props: defaultProps });
    const knob = container.querySelector('.vd-knob') as HTMLElement;
    knob.setPointerCapture = vi.fn();
    knob.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 56,
      bottom: 56,
      width: 56,
      height: 56,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    await fireEvent.pointerDown(knob, { clientX: 28, clientY: 28 });
    expect(knob.classList.contains('pressed')).toBe(true);

    await fireEvent.pointerUp(knob, { clientX: 28, clientY: 28 });
    expect(knob.classList.contains('pressed')).toBe(false);
  });

  it('should emit rotate on sufficient circular drag', async () => {
    const { container } = render(VirtualDeckKnob, { props: defaultProps });
    const knob = container.querySelector('.vd-knob') as HTMLElement;
    knob.setPointerCapture = vi.fn();
    knob.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 56,
      bottom: 56,
      width: 56,
      height: 56,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    // Start drag from the right side of the knob center
    await fireEvent.pointerDown(knob, { clientX: 56, clientY: 28 });

    // Drag clockwise — move in an arc: right → bottom → left (>15° per tick)
    // Multiple large movements to accumulate enough angle for at least 1 tick
    await fireEvent.pointerMove(knob, { clientX: 48, clientY: 56 }); // ~45° CW
    await fireEvent.pointerMove(knob, { clientX: 10, clientY: 56 }); // more CW

    await fireEvent.pointerUp(knob, { clientX: 10, clientY: 56 });

    // Should have emitted at least one rotation
    expect(mockOSCApi.virtualDeviceEncoderRotate).toHaveBeenCalled();
    const call = mockOSCApi.virtualDeviceEncoderRotate.mock.calls[0] as unknown[];
    expect(call[0]).toBe('virtual-test-1');
    expect(call[1]).toBe('encoder0');
  });

  it('should support vertical swipe mode', async () => {
    const { container } = render(VirtualDeckKnob, {
      props: { ...defaultProps, interactionMode: 'vertical' as const }
    });
    const knob = container.querySelector('.vd-knob') as HTMLElement;
    knob.setPointerCapture = vi.fn();

    // Drag up (CW in vertical mode) — 12px per tick
    await fireEvent.pointerDown(knob, { clientX: 28, clientY: 50 });
    await fireEvent.pointerMove(knob, { clientX: 28, clientY: 25 }); // 25px up = ~2 ticks

    // Should have emitted rotation
    expect(mockOSCApi.virtualDeviceEncoderRotate).toHaveBeenCalled();
  });
});

// ─── VirtualDeckSlider ──────────────────────────────────────────

describe('VirtualDeckSlider', () => {
  const sliderControl: SliderControl = {
    type: 'slider',
    id: 'slider0',
    label: 'Slider 1',
    side: 'right'
  };

  const defaultProps = {
    deviceId: 'virtual-test-1',
    control: sliderControl,
    value: 64
  };

  it('should render with label', () => {
    render(VirtualDeckSlider, { props: defaultProps });
    expect(screen.getByText('Slider 1')).toBeInTheDocument();
  });

  it('should display current value', () => {
    render(VirtualDeckSlider, { props: defaultProps });
    expect(screen.getByText('64')).toBeInTheDocument();
  });

  it('should render track, fill, and thumb', () => {
    const { container } = render(VirtualDeckSlider, { props: defaultProps });
    expect(container.querySelector('.vd-slider-track')).toBeInTheDocument();
    expect(container.querySelector('.vd-slider-fill')).toBeInTheDocument();
    expect(container.querySelector('.vd-slider-thumb')).toBeInTheDocument();
  });

  it('should apply dragging class on pointer down', async () => {
    const { container } = render(VirtualDeckSlider, { props: defaultProps });
    const track = container.querySelector('.vd-slider-track') as HTMLElement;
    track.setPointerCapture = vi.fn();
    track.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 28,
      bottom: 120,
      width: 28,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    await fireEvent.pointerDown(track, { clientY: 60 });
    expect(track.classList.contains('dragging')).toBe(true);
  });

  it('should send slider change on click', async () => {
    const { container } = render(VirtualDeckSlider, { props: defaultProps });
    const track = container.querySelector('.vd-slider-track') as HTMLElement;
    track.setPointerCapture = vi.fn();
    track.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 28,
      bottom: 120,
      width: 28,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    // Click at the top = value 127
    await fireEvent.pointerDown(track, { clientY: 0 });
    expect(mockOSCApi.virtualDeviceSliderChange).toHaveBeenCalledWith('virtual-test-1', 'slider0', 127);
  });

  it('should clamp slider value to 0 at bottom', async () => {
    const { container } = render(VirtualDeckSlider, { props: defaultProps });
    const track = container.querySelector('.vd-slider-track') as HTMLElement;
    track.setPointerCapture = vi.fn();
    track.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 28,
      bottom: 120,
      width: 28,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    // Click at bottom = value 0
    await fireEvent.pointerDown(track, { clientY: 120 });
    expect(mockOSCApi.virtualDeviceSliderChange).toHaveBeenCalledWith('virtual-test-1', 'slider0', 0);
  });

  it('should remove dragging class on pointer up', async () => {
    const { container } = render(VirtualDeckSlider, { props: defaultProps });
    const track = container.querySelector('.vd-slider-track') as HTMLElement;
    track.setPointerCapture = vi.fn();
    track.getBoundingClientRect = vi.fn(() => ({
      left: 0,
      top: 0,
      right: 28,
      bottom: 120,
      width: 28,
      height: 120,
      x: 0,
      y: 0,
      toJSON: () => {}
    }));

    await fireEvent.pointerDown(track, { clientY: 60 });
    await fireEvent.pointerUp(track);
    expect(track.classList.contains('dragging')).toBe(false);
  });
});

// ─── VirtualDevicePanel ──────────────────────────────────────────

describe('VirtualDevicePanel', () => {
  it('should not render when not visible', () => {
    const { container } = render(VirtualDevicePanel, {
      props: { visible: false, onClose: vi.fn() }
    });
    expect(container.querySelector('.vdp-overlay')).not.toBeInTheDocument();
  });

  it('should render overlay when visible', () => {
    const { container } = render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    expect(container.querySelector('.vdp-overlay')).toBeInTheDocument();
  });

  it('should show header with title', () => {
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    expect(screen.getByText('Virtual Devices')).toBeInTheDocument();
  });

  it('should show empty state when no devices', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    // Wait for async load
    await vi.waitFor(() => {
      expect(screen.getByText('No virtual devices yet.')).toBeInTheDocument();
    });
  });

  it('should show "New Virtual Device" button', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    await vi.waitFor(() => {
      expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
    });
  });

  it('should list existing devices', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'virtual-1',
        name: 'My Deck',
        rows: 3,
        columns: 5,
        keySize: 96,
        encoders: 2,
        encoderPosition: 'bottom',
        sliders: 1,
        sliderPosition: 'right'
      }
    ]);
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    await vi.waitFor(() => {
      expect(screen.getByText('My Deck')).toBeInTheDocument();
    });
  });

  it('should show Open, Edit, Delete buttons for each device', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'virtual-1',
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
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    await vi.waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
      expect(screen.getByText('Edit')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('should call onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(VirtualDevicePanel, {
      props: { visible: true, onClose }
    });
    const closeBtn = screen.getByText('✕');
    await fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('should show create form when New Virtual Device is clicked', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    await vi.waitFor(() => {
      expect(screen.getByText('+ New Virtual Device')).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByText('+ New Virtual Device'));
    expect(screen.getByText('New Virtual Device')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Rows')).toBeInTheDocument();
    expect(screen.getByLabelText('Columns')).toBeInTheDocument();
  });

  it('should call virtualDeckOpen when Open is clicked', async () => {
    (mockOSCApi.virtualDeviceGetConfigs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: 'virtual-1',
        name: 'Test Deck',
        rows: 3,
        columns: 5,
        keySize: 96,
        encoders: 0,
        encoderPosition: 'none',
        sliders: 0,
        sliderPosition: 'none'
      }
    ]);
    render(VirtualDevicePanel, {
      props: { visible: true, onClose: vi.fn() }
    });
    await vi.waitFor(() => {
      expect(screen.getByText('Open')).toBeInTheDocument();
    });
    await fireEvent.click(screen.getByText('Open'));
    expect(mockOSCApi.virtualDeckOpen).toHaveBeenCalledWith('virtual-1');
  });
});
