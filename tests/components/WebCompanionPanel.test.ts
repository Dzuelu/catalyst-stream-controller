import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import WebCompanionPanel from '../../src/renderer/components/WebCompanionPanel.svelte';
import { mockOSCApi } from '../setup-renderer';

describe('WebCompanionPanel', () => {
  beforeEach(() => {
    mockOSCApi.webServerGetStatus.mockResolvedValue({
      running: false,
      port: 9120,
      url: null,
      connectedClients: 0,
      pin: '0000'
    });
    mockOSCApi.webServerGetQrCode.mockResolvedValue(null);
  });

  // ─── Visibility ───────────────────────────────────────────

  describe('visibility', () => {
    it('should not render when visible is false', () => {
      const { container } = render(WebCompanionPanel, {
        props: { visible: false, onClose: vi.fn() }
      });
      expect(container.querySelector('.fixed')).not.toBeInTheDocument();
    });

    it('should render when visible is true', () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      expect(screen.getByText('Web Companion')).toBeInTheDocument();
    });
  });

  // ─── Header ───────────────────────────────────────────────

  describe('header', () => {
    it('should display title', () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      expect(screen.getByText('Web Companion')).toBeInTheDocument();
    });

    it('should call onClose when close button is clicked', async () => {
      const onClose = vi.fn();
      render(WebCompanionPanel, { props: { visible: true, onClose } });
      // Close button has ✕ text
      const closeBtn = screen.getByText('✕');
      await fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── Server status ────────────────────────────────────────

  describe('server status', () => {
    it('should load status on mount', async () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(mockOSCApi.webServerGetStatus).toHaveBeenCalled();
      });
    });

    it('should show "Server Stopped" when not running', async () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Server Stopped')).toBeInTheDocument();
      });
    });

    it('should show "Start Server" button when stopped', async () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Start Server')).toBeInTheDocument();
      });
    });

    it('should show "Server Running" when running', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 0,
        pin: '1234'
      });
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Server Running')).toBeInTheDocument();
      });
    });

    it('should show "Stop Server" button when running', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 0,
        pin: '1234'
      });
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Stop Server')).toBeInTheDocument();
      });
    });

    it('should show connected client count when running', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 3,
        pin: '1234'
      });
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('• 3 clients')).toBeInTheDocument();
      });
    });
  });

  // ─── Server toggle ────────────────────────────────────────

  describe('server toggle', () => {
    it('should call webServerStart when Start Server is clicked', async () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Start Server')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Start Server'));
      await waitFor(() => {
        expect(mockOSCApi.webServerStart).toHaveBeenCalled();
      });
    });

    it('should call webServerStop when Stop Server is clicked', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 0,
        pin: '1234'
      });
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Stop Server')).toBeInTheDocument();
      });
      await fireEvent.click(screen.getByText('Stop Server'));
      await waitFor(() => {
        expect(mockOSCApi.webServerStop).toHaveBeenCalled();
      });
    });
  });

  // ─── Connection URL ───────────────────────────────────────

  describe('connection URL', () => {
    it('should display connection URL when running', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 0,
        pin: '1234'
      });
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('http://192.168.1.100:9120')).toBeInTheDocument();
      });
    });

    it('should show prompt to start server when stopped', async () => {
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        expect(screen.getByText('Start the server to generate a connection URL and QR code.')).toBeInTheDocument();
      });
    });

    it('should show QR code when available', async () => {
      mockOSCApi.webServerGetStatus.mockResolvedValue({
        running: true,
        port: 9120,
        url: 'http://192.168.1.100:9120',
        connectedClients: 0,
        pin: '1234'
      });
      mockOSCApi.webServerGetQrCode.mockResolvedValue('data:image/png;base64,qr-code-data');
      render(WebCompanionPanel, { props: { visible: true, onClose: vi.fn() } });
      await waitFor(() => {
        const qrImg = screen.getByAltText('QR Code for Web Companion');
        expect(qrImg).toBeInTheDocument();
      });
    });
  });
});
