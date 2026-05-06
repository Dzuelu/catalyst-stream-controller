import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import DeviceGrid from '../../src/renderer/components/DeviceGrid.svelte';
import { connectedDevices, selectedDeviceId } from '../../src/renderer/stores/device';
import { profiles, activeProfileId, currentPageId, breadcrumbs } from '../../src/renderer/stores/profile';
import type { DeviceInfo, Profile } from '../../src/shared/types';
import { createAppearanceFromFlat } from '../../src/shared/appearance-helpers';

// Build a test device with a 3×5 button grid (like Razer Stream Controller X)
const testDevice: DeviceInfo = {
  id: 'dev-1',
  name: 'Razer Stream Controller X',
  rows: 3,
  cols: 5,
  keySize: 96,
  controls: [
    // 15 buttons
    ...Array.from({ length: 15 }, (_, i) => ({
      type: 'button' as const,
      index: i,
      row: Math.floor(i / 5),
      col: i % 5
    }))
  ],
  connected: true,
  safeAreaInsets: { top: 2, bottom: 20, left: 10, right: 10 }
};

// Device with knobs (like Loupedeck)
const deviceWithKnobs: DeviceInfo = {
  id: 'dev-2',
  name: 'Loupedeck CT',
  rows: 2,
  cols: 4,
  keySize: 96,
  controls: [
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'button' as const,
      index: i,
      row: Math.floor(i / 4),
      col: i % 4
    })),
    { type: 'knob' as const, id: 'knobTL', label: 'Top Left', side: 'left' as const },
    { type: 'knob' as const, id: 'knobCL', label: 'Center Left', side: 'left' as const },
    { type: 'knob' as const, id: 'knobTR', label: 'Top Right', side: 'right' as const }
  ],
  connected: true,
  safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
};

// Device with bottom encoders (like Stream Deck +)
const deviceWithBottomKnobs: DeviceInfo = {
  id: 'dev-3',
  name: 'Stream Deck +',
  rows: 2,
  cols: 4,
  keySize: 120,
  controls: [
    ...Array.from({ length: 8 }, (_, i) => ({
      type: 'button' as const,
      index: i,
      row: Math.floor(i / 4),
      col: i % 4
    })),
    { type: 'knob' as const, id: 'encoder0', label: 'Encoder 1', side: 'bottom' as const },
    { type: 'knob' as const, id: 'encoder1', label: 'Encoder 2', side: 'bottom' as const },
    { type: 'knob' as const, id: 'encoder2', label: 'Encoder 3', side: 'bottom' as const },
    { type: 'knob' as const, id: 'encoder3', label: 'Encoder 4', side: 'bottom' as const }
  ],
  connected: true,
  safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
};

const testProfile: Profile = {
  id: 'profile-1',
  name: 'Test',
  rootPageId: 'page-root',
  pages: {
    'page-root': {
      id: 'page-root',
      name: 'Root',
      bindings: {
        0: {
          press: { id: 'a1', type: 'hotkey', label: 'Cut', config: {} },
          appearance: createAppearanceFromFlat({
            backgroundColor: '#1a1a2e',
            label: { text: 'Cut', color: '#ffffff', positionV: 'center', positionH: 'center' }
          })
        },
        3: {
          press: { id: 'a2', type: 'plugin:obs', label: 'Scene 1', config: {} },
          appearance: createAppearanceFromFlat({
            backgroundColor: '#1a1a2e',
            label: {
              text: 'Scene 1',
              color: '#ffffff',
              positionV: 'center',
              positionH: 'center'
            }
          })
        }
      }
    }
  }
};

describe('DeviceGrid', () => {
  beforeEach(() => {
    // Set up device
    const deviceMap = new Map<string, DeviceInfo>();
    deviceMap.set('dev-1', testDevice);
    connectedDevices.set(deviceMap);
    selectedDeviceId.set('dev-1');

    // Set up profile
    profiles.set([testProfile]);
    activeProfileId.set('profile-1');
    currentPageId.set('page-root');
    breadcrumbs.set([{ pageId: 'page-root', pageName: 'Root' }]);
  });

  // ─── Basic rendering ────────────────────────────────────

  describe('basic rendering', () => {
    it('should show device name', () => {
      render(DeviceGrid);
      expect(screen.getByText('Razer Stream Controller X')).toBeInTheDocument();
    });

    it('should render all button cells', () => {
      const { container } = render(DeviceGrid);
      // Each ButtonCell renders a <button> element
      const buttons = container.querySelectorAll('button');
      // 15 buttons in a 3×5 grid
      expect(buttons.length).toBe(15);
    });

    it('should show grid dimensions info', () => {
      render(DeviceGrid);
      expect(screen.getByText(/3×5/)).toBeInTheDocument();
    });

    it('should show rearrange hint', () => {
      render(DeviceGrid);
      expect(screen.getByText(/Drag to rearrange/)).toBeInTheDocument();
    });
  });

  // ─── With bindings ──────────────────────────────────────

  describe('with bindings', () => {
    it('should show trigger indicators for bound buttons', () => {
      render(DeviceGrid);
      // Bound buttons (indices 0 and 3) have trigger indicator dots; labels are
      // rendered server-side into the preview image so they don't appear as DOM text.
      const buttons = screen.getAllByRole('button');
      // Buttons at index 0 and 3 should be draggable (bound)
      expect(buttons[0]).toHaveAttribute('draggable', 'true');
      expect(buttons[3]).toHaveAttribute('draggable', 'true');
      // Unbound buttons are not draggable
      expect(buttons[1]).toHaveAttribute('draggable', 'false');
    });

    it('should show button indices for all cells', () => {
      render(DeviceGrid);
      // Index badges: 1, 2, 3, ... 15
      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('15')).toBeInTheDocument();
    });
  });

  // ─── With knobs ─────────────────────────────────────────

  describe('with knobs', () => {
    beforeEach(() => {
      const deviceMap = new Map<string, DeviceInfo>();
      deviceMap.set('dev-2', deviceWithKnobs);
      connectedDevices.set(deviceMap);
      selectedDeviceId.set('dev-2');
    });

    it('should render knob cells', () => {
      render(DeviceGrid);
      expect(screen.getByText('Top Left')).toBeInTheDocument();
      expect(screen.getByText('Center Left')).toBeInTheDocument();
      expect(screen.getByText('Top Right')).toBeInTheDocument();
    });

    it('should show knob count in info', () => {
      render(DeviceGrid);
      expect(screen.getByText(/3 knobs/)).toBeInTheDocument();
    });

    it('should show device name for knob device', () => {
      render(DeviceGrid);
      expect(screen.getByText('Loupedeck CT')).toBeInTheDocument();
    });
  });

  // ─── No device ──────────────────────────────────────────

  describe('no device', () => {
    it('should show Unknown Device when no device connected', () => {
      connectedDevices.set(new Map());
      selectedDeviceId.set(null);
      render(DeviceGrid);
      expect(screen.getByText('Unknown Device')).toBeInTheDocument();
    });
  });

  // ─── Bottom knobs (Stream Deck +) ──────────────────────

  describe('with bottom knobs', () => {
    beforeEach(() => {
      const deviceMap = new Map<string, DeviceInfo>();
      deviceMap.set('dev-3', deviceWithBottomKnobs);
      connectedDevices.set(deviceMap);
      selectedDeviceId.set('dev-3');
    });

    it('should render bottom encoder knobs', () => {
      render(DeviceGrid);
      expect(screen.getByText('Encoder 1')).toBeInTheDocument();
      expect(screen.getByText('Encoder 2')).toBeInTheDocument();
      expect(screen.getByText('Encoder 3')).toBeInTheDocument();
      expect(screen.getByText('Encoder 4')).toBeInTheDocument();
    });

    it('should render buttons alongside bottom knobs', () => {
      const { container } = render(DeviceGrid);
      // 8 buttons + 4 knobs = 12 total <button> elements
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBe(12);
    });

    it('should show knob count in info text', () => {
      render(DeviceGrid);
      expect(screen.getByText(/4 knobs/)).toBeInTheDocument();
    });

    it('should show device name for SD+', () => {
      render(DeviceGrid);
      expect(screen.getByText('Stream Deck +')).toBeInTheDocument();
    });

    it('should render bottom knobs in a separate row', () => {
      const { container } = render(DeviceGrid);
      const bottomRow = container.querySelector('.knob-row-bottom');
      expect(bottomRow).toBeInTheDocument();
      // All 4 encoder knobs should be in the bottom row
      const knobCells = bottomRow!.querySelectorAll('.knob-cell');
      expect(knobCells.length).toBe(4);
    });

    it('should not render side knob columns for bottom-only knobs', () => {
      const { container } = render(DeviceGrid);
      const knobColumns = container.querySelectorAll('.knob-column');
      expect(knobColumns.length).toBe(0);
    });
  });
});
