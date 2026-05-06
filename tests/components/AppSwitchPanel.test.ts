import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import AppSwitchPanel from '../../src/renderer/components/AppSwitchPanel.svelte';
import { mockOSCApi } from '../setup-renderer';

describe('AppSwitchPanel', () => {
  beforeEach(() => {
    mockOSCApi.appSwitchGetSettings.mockResolvedValue({
      enabled: false,
      defaultProfileId: '',
      rules: [],
      pollIntervalMs: 500
    });
    mockOSCApi.appSwitchGetCurrentApp.mockResolvedValue(null);
    mockOSCApi.appSwitchGetDetectionMethod.mockResolvedValue(null);
  });

  // ─── Visibility ───────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      const { container } = render(AppSwitchPanel, {
        props: { visible: false, onClose: vi.fn() }
      });
      expect(container.querySelector('.fixed')).not.toBeInTheDocument();
    });

    it('should render when visible is true', () => {
      render(AppSwitchPanel, {
        props: { visible: true, onClose: vi.fn() }
      });
      expect(screen.getByText('App Profile Switching')).toBeInTheDocument();
    });
  });

  // ─── Header ───────────────────────────────────────────────

  describe('header', () => {
    it('should display title', () => {
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      expect(screen.getByText('App Profile Switching')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(AppSwitchPanel, { props: { visible: true, onClose } });
      await fireEvent.click(screen.getByTitle('Close'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── Settings loading ─────────────────────────────────────

  describe('settings loading', () => {
    it('should load settings on mount when visible', async () => {
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(mockOSCApi.appSwitchGetSettings).toHaveBeenCalled();
      });
    });

    it('should load current app info', async () => {
      mockOSCApi.appSwitchGetCurrentApp.mockResolvedValue({
        name: 'OBS Studio',
        detectionMethod: 'macos'
      });
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('OBS Studio')).toBeInTheDocument();
      });
    });
  });

  // ─── Enable toggle ────────────────────────────────────────

  describe('enable toggle', () => {
    it('should display auto-switch description', async () => {
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Auto-switch profiles')).toBeInTheDocument();
      });
    });

    it('should have toggle button', async () => {
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByLabelText('Toggle auto-switch')).toBeInTheDocument();
      });
    });

    it('should call appSwitchSetSettings when toggled', async () => {
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByLabelText('Toggle auto-switch')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByLabelText('Toggle auto-switch'));
      await waitFor(() => {
        expect(mockOSCApi.appSwitchSetSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
      });
    });
  });

  // ─── Current app indicator ────────────────────────────────

  describe('current app indicator', () => {
    it('should show foreground app name when available', async () => {
      mockOSCApi.appSwitchGetCurrentApp.mockResolvedValue({
        name: 'Firefox',
        detectionMethod: 'macos'
      });
      mockOSCApi.appSwitchGetDetectionMethod.mockResolvedValue('macos');
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Firefox')).toBeInTheDocument();
      });
    });

    it('should show detection method', async () => {
      mockOSCApi.appSwitchGetCurrentApp.mockResolvedValue({
        name: 'Chrome',
        detectionMethod: 'macos'
      });
      mockOSCApi.appSwitchGetDetectionMethod.mockResolvedValue('macos');
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('via macos')).toBeInTheDocument();
      });
    });

    it('should show "No foreground app detected" when enabled but no app', async () => {
      mockOSCApi.appSwitchGetSettings.mockResolvedValue({
        enabled: true,
        defaultProfileId: '',
        rules: [],
        pollIntervalMs: 500
      });
      mockOSCApi.appSwitchGetCurrentApp.mockResolvedValue(null);
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('No foreground app detected')).toBeInTheDocument();
      });
    });
  });

  // ─── Rules ────────────────────────────────────────────────

  describe('rules', () => {
    it('should display existing rules', async () => {
      mockOSCApi.appSwitchGetSettings.mockResolvedValue({
        enabled: true,
        defaultProfileId: '',
        rules: [{ id: 'rule-1', appName: 'OBS Studio', profileId: 'prof-1' }],
        pollIntervalMs: 500
      });
      render(AppSwitchPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('OBS Studio')).toBeInTheDocument();
      });
    });
  });
});
