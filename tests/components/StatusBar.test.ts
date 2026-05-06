import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import StatusBar from '../../src/renderer/components/StatusBar.svelte';
import { connectedDevices, selectedDeviceId } from '../../src/renderer/stores/device';
import { profiles, activeProfileId, currentPageId, breadcrumbs } from '../../src/renderer/stores/profile';
import { mockOSCApi } from '../setup-renderer';
import type { DeviceInfo, Profile } from '../../src/shared/types';

const testDevice: DeviceInfo = {
  id: 'dev-1',
  name: 'Razer Stream Controller X',
  serial: 'SN12345',
  rows: 3,
  cols: 5,
  keySize: 96,
  controls: [],
  connected: true,
  safeAreaInsets: { top: 2, bottom: 20, left: 10, right: 10 }
};

const testProfile: Profile = {
  id: 'p1',
  name: 'Default',
  rootPageId: 'root',
  pages: { root: { id: 'root', name: 'Root', bindings: {} } }
};

describe('StatusBar', () => {
  beforeEach(() => {
    // Set up device
    const deviceMap = new Map<string, DeviceInfo>();
    deviceMap.set('dev-1', testDevice);
    connectedDevices.set(deviceMap);
    selectedDeviceId.set('dev-1');

    // Set up profile
    profiles.set([testProfile]);
    activeProfileId.set('p1');
    currentPageId.set('root');
    breadcrumbs.set([{ pageId: 'root', pageName: 'Root' }]);

    // Return brightness
    vi.mocked(mockOSCApi.getBrightness).mockResolvedValue(1.0);
  });

  // ─── Connection status ──────────────────────────────────

  describe('connection status', () => {
    it('should show device name when connected', () => {
      render(StatusBar);
      expect(screen.getByText('Razer Stream Controller X')).toBeInTheDocument();
    });

    it('should show Disconnected when no device', () => {
      connectedDevices.set(new Map());
      selectedDeviceId.set(null);
      render(StatusBar);
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });

    it('should show serial number', () => {
      render(StatusBar);
      expect(screen.getByText(/SN12345/)).toBeInTheDocument();
    });
  });

  // ─── Controls ────────────────────────────────────────────

  describe('controls', () => {
    it('should show brightness slider when connected', () => {
      const { container } = render(StatusBar);
      const slider = container.querySelector('input[type="range"]');
      expect(slider).toBeInTheDocument();
    });

    it('should show Calibrate Keys button when connected', () => {
      render(StatusBar);
      expect(screen.getByText('⚙ Calibrate Keys')).toBeInTheDocument();
    });

    it('should show Logs button', () => {
      render(StatusBar);
      expect(screen.getByText('📋 Logs')).toBeInTheDocument();
    });

    it('should not show Calibrate button when disconnected', () => {
      connectedDevices.set(new Map());
      selectedDeviceId.set(null);
      render(StatusBar);
      expect(screen.queryByText('⚙ Calibrate Keys')).not.toBeInTheDocument();
    });

    it('should show Logs button even when disconnected', () => {
      connectedDevices.set(new Map());
      selectedDeviceId.set(null);
      render(StatusBar);
      expect(screen.getByText('📋 Logs')).toBeInTheDocument();
    });
  });

  // ─── Profile switcher integration ──────────────────────

  describe('profile switcher', () => {
    it('should render ProfileSwitcher with active profile name', () => {
      render(StatusBar);
      expect(screen.getByText('Profile:')).toBeInTheDocument();
      expect(screen.getByText('Default')).toBeInTheDocument();
    });
  });

  // ─── Panel toggles ──────────────────────────────────────

  describe('panel toggles', () => {
    it('should open logs panel on Logs button click', async () => {
      render(StatusBar);
      await fireEvent.click(screen.getByText('📋 Logs'));
      expect(screen.getByText('Application Logs')).toBeInTheDocument();
    });

    it('should open calibration panel on Calibrate click', async () => {
      render(StatusBar);
      await fireEvent.click(screen.getByText('⚙ Calibrate Keys'));
      expect(screen.getByText('⚙ Calibration Settings')).toBeInTheDocument();
    });
  });

  // ─── Brightness ─────────────────────────────────────────

  describe('brightness', () => {
    it('should load brightness on mount', async () => {
      render(StatusBar);
      await vi.waitFor(() => {
        expect(mockOSCApi.getBrightness).toHaveBeenCalled();
      });
    });
  });
});
