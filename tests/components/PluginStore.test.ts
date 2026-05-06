import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import PluginStore from '../../src/renderer/components/PluginStore.svelte';
import { mockOSCApi } from '../setup-renderer';

// ─── Helpers ────────────────────────────────────────────────────

const MOCK_SEARCH_RESULTS = [
  {
    name: 'catalyst-stream-controller-plugin-hue',
    version: '1.2.0',
    description: 'Philips Hue integration',
    downloads: 150,
    author: 'Test Author',
    modified: '2024-01-15',
    keywords: ['catalyst-stream-controller-plugin', 'hue']
  },
  {
    name: 'catalyst-stream-controller-plugin-spotify',
    version: '2.0.0',
    description: 'Spotify control',
    downloads: 300,
    author: 'Another Author',
    modified: '2024-06-01',
    keywords: ['catalyst-stream-controller-plugin', 'spotify']
  }
];

const MOCK_INSTALLED = {
  obs: {
    version: '1.0.0',
    source: 'built-in',
    installedAt: '',
    name: 'OBS Studio',
    description: 'Control OBS Studio via WebSocket'
  },
  discord: {
    version: '1.0.0',
    source: 'built-in',
    installedAt: '',
    name: 'Discord',
    description: 'Control Discord voice chat'
  },
  hue: {
    version: '1.0.0',
    source: 'npm',
    installedAt: '2024-01-01T00:00:00Z',
    packageName: 'catalyst-stream-controller-plugin-hue'
  }
};

/**
 * Let all pending microtasks and Svelte reactive updates flush.
 * Uses multiple rounds of macrotask boundaries to handle the
 * $effect → async IPC → state update → $effect re-run chain.
 */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 50));
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PluginStore', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    onClose.mockReset();

    vi.mocked(mockOSCApi.pluginStoreSearch).mockResolvedValue(MOCK_SEARCH_RESULTS as any);

    vi.mocked(mockOSCApi.pluginStoreGetInstalled).mockResolvedValue(MOCK_INSTALLED as any);
  });

  afterEach(() => {
    cleanup();
  });

  it('should not render when visible is false', () => {
    render(PluginStore, { props: { visible: false, onClose } });
    expect(screen.queryByText(/Plugin Store/)).not.toBeInTheDocument();
  });

  it('should render and load data when visible', async () => {
    render(PluginStore, { props: { visible: true, onClose } });
    await settle();

    // Structure
    expect(screen.getByText(/Plugin Store/)).toBeInTheDocument();
    expect(screen.getByText(/Browse/)).toBeInTheDocument();
    expect(screen.getByText(/Installed/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search plugins...')).toBeInTheDocument();

    // Data loaded via $effect (checkForUpdates is refresh-button-only)
    expect(mockOSCApi.pluginStoreSearch).toHaveBeenCalled();
    expect(mockOSCApi.pluginStoreGetInstalled).toHaveBeenCalled();

    // Search results rendered
    expect(screen.getByText('catalyst-stream-controller-plugin-hue')).toBeInTheDocument();
    expect(screen.getByText('catalyst-stream-controller-plugin-spotify')).toBeInTheDocument();
    expect(screen.getByText('Philips Hue integration')).toBeInTheDocument();
    expect(screen.getByText('Spotify control')).toBeInTheDocument();
    expect(screen.getByText(/Test Author/)).toBeInTheDocument();
    expect(screen.getByText(/Another Author/)).toBeInTheDocument();
  });

  it('should close on button click', async () => {
    render(PluginStore, { props: { visible: true, onClose } });
    await settle();
    // Use getAllByText since there may be multiple ✕ buttons, pick the header close button
    const closeButtons = screen.getAllByText('✕');
    await fireEvent.click(closeButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('should close on Escape key', async () => {
    render(PluginStore, { props: { visible: true, onClose } });
    await settle();
    const modal = screen.getByText(/Plugin Store/).closest('.fixed');
    if (modal) {
      await fireEvent.keyDown(modal, { key: 'Escape' });
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('should show empty state when no results', async () => {
    vi.mocked(mockOSCApi.pluginStoreSearch).mockResolvedValue([]);
    render(PluginStore, { props: { visible: true, onClose } });
    await settle();
    expect(screen.getByText(/Search for plugins or browse available ones/)).toBeInTheDocument();
  });

  it('should show error on search failure', async () => {
    vi.mocked(mockOSCApi.pluginStoreSearch).mockRejectedValue(new Error('Network error'));
    render(PluginStore, { props: { visible: true, onClose } });
    await settle();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });
});
