import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import LogPanel from '../../src/renderer/components/LogPanel.svelte';
import { mockOSCApi } from '../setup-renderer';
import type { LogEntry } from '../../src/shared/log-types';

const sampleEntries: LogEntry[] = [
  { id: 1, timestamp: '2024-01-15T10:30:00.000Z', level: 'info', source: 'Main', message: '[Main] App started' },
  { id: 2, timestamp: '2024-01-15T10:30:01.000Z', level: 'warn', source: 'OBS', message: '[OBS] Connection lost' },
  { id: 3, timestamp: '2024-01-15T10:30:02.000Z', level: 'error', source: 'Device', message: '[Device] USB error' }
];

describe('LogPanel', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    // Default: return sample entries
    vi.mocked(mockOSCApi.logGetEntries).mockResolvedValue(sampleEntries as any);
  });

  // ─── Visibility ──────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      render(LogPanel, { props: { visible: false, onClose } });
      expect(screen.queryByText('Application Logs')).not.toBeInTheDocument();
    });

    it('should render when visible is true', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByText('Application Logs')).toBeInTheDocument();
    });
  });

  // ─── Header controls ────────────────────────────────────

  describe('header controls', () => {
    it('should show filter level buttons', () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByText('All')).toBeInTheDocument();
    });

    it('should show search input', () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByPlaceholderText('Filter…')).toBeInTheDocument();
    });

    it('should show Copy button', () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByText('Copy')).toBeInTheDocument();
    });

    it('should show Clear button', () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });
  });

  // ─── Log entries display ─────────────────────────────────

  describe('log entries', () => {
    it('should load entries from IPC on mount', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      // Wait for async loadEntries
      await vi.waitFor(() => {
        expect(mockOSCApi.logGetEntries).toHaveBeenCalled();
      });
    });

    it('should show empty state when no entries', async () => {
      vi.mocked(mockOSCApi.logGetEntries).mockResolvedValue([]);
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText('No log entries yet')).toBeInTheDocument();
      });
    });

    it('should display log entries from IPC', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText('App started')).toBeInTheDocument();
      });
      expect(screen.getByText('Connection lost')).toBeInTheDocument();
      expect(screen.getByText('USB error')).toBeInTheDocument();
    });

    it('should show level badges', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText('INF')).toBeInTheDocument();
      });
      expect(screen.getByText('WRN')).toBeInTheDocument();
      expect(screen.getByText('ERR')).toBeInTheDocument();
    });

    it('should show source labels', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText('Main')).toBeInTheDocument();
      });
      expect(screen.getByText('OBS')).toBeInTheDocument();
      expect(screen.getByText('Device')).toBeInTheDocument();
    });
  });

  // ─── Interactions ────────────────────────────────────────

  describe('interactions', () => {
    it('should clear logs when Clear button clicked', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText('App started')).toBeInTheDocument();
      });

      await fireEvent.click(screen.getByText('Clear'));
      expect(mockOSCApi.logClear).toHaveBeenCalled();
    });

    it('should register onLogEntry listener when visible', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(mockOSCApi.onLogEntry).toHaveBeenCalled();
      });
    });
  });

  // ─── Footer ──────────────────────────────────────────────

  describe('footer', () => {
    it('should show entry count', async () => {
      render(LogPanel, { props: { visible: true, onClose } });
      await vi.waitFor(() => {
        expect(screen.getByText(/3.*entries/)).toBeInTheDocument();
      });
    });

    it('should show auto-scroll status', () => {
      render(LogPanel, { props: { visible: true, onClose } });
      expect(screen.getByText(/Auto-scroll on/)).toBeInTheDocument();
    });
  });
});
