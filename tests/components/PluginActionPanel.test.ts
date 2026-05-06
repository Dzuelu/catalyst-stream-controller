import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import PluginActionPanel from '../../src/renderer/components/PluginActionPanel.svelte';
import { mockOSCApi } from '../setup-renderer';
import type { PluginManifest } from '../../src/shared/plugin-types';

// ─── Fixture: connection-based plugin (e.g. OBS) ────────────────

const obsManifest: PluginManifest = {
  id: 'obs',
  name: 'OBS Studio',
  version: '1.0.0',
  actions: {
    'switch-scene': {
      label: 'Switch Scene',
      params: {
        sceneName: {
          key: 'sceneName',
          label: 'Scene',
          type: 'select',
          dynamicOptionsQuery: 'getScenes'
        }
      }
    },
    'toggle-stream': {
      label: 'Toggle Stream'
    }
  },
  connection: {
    defaults: { host: 'localhost', port: 4455 },
    fields: [
      { key: 'host', label: 'Host', type: 'text', placeholder: 'localhost' },
      { key: 'port', label: 'Port', type: 'number', min: 1, max: 65535 }
    ]
  },
  state: {
    defaults: { connected: false, streaming: false, recording: false },
    display: [
      { key: 'streaming', label: 'Streaming', icon: '🔴', format: 'boolean-on-off' },
      { key: 'recording', label: 'Recording', icon: '⏺', format: 'boolean-on-off' }
    ]
  }
};

// ─── Fixture: connection-less plugin (e.g. utility) ─────────────

const utilityManifest: PluginManifest = {
  id: 'utility',
  name: 'Utility',
  version: '1.0.0',
  actions: {
    delay: {
      label: 'Delay',
      params: {
        ms: { key: 'ms', label: 'Duration (ms)', type: 'number', min: 0, max: 10000 }
      }
    },
    notification: {
      label: 'Show Notification',
      params: {
        message: { key: 'message', label: 'Message', type: 'text', placeholder: 'Hello world' },
        sound: {
          key: 'sound',
          label: 'Sound',
          type: 'boolean'
        }
      }
    }
  }
};

// ─── Fixture: plugin with range and image fields ────────────────

const mediaManifest: PluginManifest = {
  id: 'media',
  name: 'Media Player',
  version: '1.0.0',
  actions: {
    'set-volume': {
      label: 'Set Volume',
      params: {
        volume: { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 100, step: 1, suffix: '%' },
        icon: { key: 'icon', label: 'Button Icon', type: 'image' }
      }
    }
  }
};

describe('PluginActionPanel', () => {
  beforeEach(() => {
    mockOSCApi.pluginGetSettings.mockResolvedValue({});
    mockOSCApi.pluginGetState.mockResolvedValue(null);
    mockOSCApi.pluginConnect.mockResolvedValue({ success: true });
    mockOSCApi.pluginDisconnect.mockResolvedValue(undefined);
    mockOSCApi.pluginQuery.mockResolvedValue([]);
    mockOSCApi.pluginSetSettings.mockResolvedValue(undefined);
    mockOSCApi.onPluginStateChanged.mockReturnValue(() => {});
  });

  // ═══════════════════════════════════════════════════════════
  // Connection-based Plugin (OBS-like)
  // ═══════════════════════════════════════════════════════════

  describe('connection-based plugin', () => {
    const defaultProps = {
      pluginId: 'obs',
      manifest: obsManifest,
      actionConfig: { pluginAction: 'switch-scene' },
      pluginState: null as Record<string, unknown> | null,
      onDirty: vi.fn(),
      onActionChanged: vi.fn()
    };

    // ─── Connection card ──────────────────────────────────────

    describe('connection card', () => {
      it('should show connection status card', async () => {
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('Not connected')).toBeInTheDocument();
        });
      });

      it('should show red indicator when disconnected', async () => {
        const { container } = render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          const indicator = container.querySelector('.bg-red-400');
          expect(indicator).toBeInTheDocument();
        });
      });

      it('should show Connect button when disconnected', async () => {
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('Connect')).toBeInTheDocument();
        });
      });

      it('should show green indicator when connected', async () => {
        const { container } = render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          const indicator = container.querySelector('.bg-green-400');
          expect(indicator).toBeInTheDocument();
        });
      });

      it('should show connected message with plugin name', async () => {
        render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          expect(screen.getByText('Connected to OBS Studio')).toBeInTheDocument();
        });
      });

      it('should show Disconnect button when connected', async () => {
        render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          expect(screen.getByText('Disconnect')).toBeInTheDocument();
        });
      });
    });

    // ─── Connect / Disconnect flow ────────────────────────────

    describe('connect/disconnect flow', () => {
      it('should call pluginConnect when Connect is clicked', async () => {
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('Connect')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('Connect'));
        expect(mockOSCApi.pluginConnect).toHaveBeenCalledWith('obs', expect.any(Object));
      });

      it('should show "Connecting..." while connecting', async () => {
        // Make pluginConnect hang (never resolves)
        mockOSCApi.pluginConnect.mockReturnValue(new Promise(() => {}));
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('Connect')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('Connect'));
        expect(screen.getByText('Connecting...')).toBeInTheDocument();
      });

      it('should show error on connection failure', async () => {
        mockOSCApi.pluginConnect.mockResolvedValue({ success: false, error: 'Connection refused' });
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('Connect')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('Connect'));
        await waitFor(() => {
          expect(screen.getByText('⚠ Connection refused')).toBeInTheDocument();
        });
      });

      it('should call pluginDisconnect when Disconnect is clicked', async () => {
        mockOSCApi.pluginGetState.mockResolvedValue({ connected: false });
        render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          expect(screen.getByText('Disconnect')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('Disconnect'));
        expect(mockOSCApi.pluginDisconnect).toHaveBeenCalledWith('obs');
      });
    });

    // ─── Connection settings ──────────────────────────────────

    describe('connection settings', () => {
      it('should show Connection Settings toggle', async () => {
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('▸ Connection Settings')).toBeInTheDocument();
        });
      });

      it('should show settings fields when toggled open', async () => {
        const { container } = render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('▸ Connection Settings')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('▸ Connection Settings'));
        await waitFor(() => {
          expect(screen.getByText('▾ Hide Settings')).toBeInTheDocument();
          expect(container.querySelector('#conn-host')).toBeInTheDocument();
          expect(container.querySelector('#conn-port')).toBeInTheDocument();
        });
      });

      it('should load saved settings on init', async () => {
        mockOSCApi.pluginGetSettings.mockResolvedValue({ host: '192.168.1.50', port: 4455 });
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(mockOSCApi.pluginGetSettings).toHaveBeenCalledWith('obs');
        });
      });

      it('should save settings on field blur', async () => {
        const { container } = render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.getByText('▸ Connection Settings')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('▸ Connection Settings'));
        await waitFor(() => {
          expect(container.querySelector('#conn-host')).toBeInTheDocument();
        });
        const hostInput = container.querySelector('#conn-host') as HTMLInputElement;
        await fireEvent.input(hostInput, { target: { value: '10.0.0.5' } });
        await fireEvent.blur(hostInput);
        expect(mockOSCApi.pluginSetSettings).toHaveBeenCalledWith('obs', expect.any(Object));
      });
    });

    // ─── Dynamic options ──────────────────────────────────────

    describe('dynamic options', () => {
      it('should fetch dynamic options when connected', async () => {
        mockOSCApi.pluginGetState.mockResolvedValue({ connected: true });
        mockOSCApi.pluginQuery.mockResolvedValue([
          { value: 'Scene 1', label: 'Scene 1' },
          { value: 'Scene 2', label: 'Scene 2' }
        ]);
        render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          expect(mockOSCApi.pluginQuery).toHaveBeenCalledWith('obs', 'getScenes');
        });
      });

      it('should display dynamic options in select field', async () => {
        mockOSCApi.pluginGetState.mockResolvedValue({ connected: true });
        mockOSCApi.pluginQuery.mockResolvedValue([
          { value: 'Gaming', label: 'Gaming' },
          { value: 'Chat', label: 'Chat' }
        ]);
        render(PluginActionPanel, {
          props: { ...defaultProps, pluginState: { connected: true } }
        });
        await waitFor(() => {
          expect(screen.getByText('Gaming')).toBeInTheDocument();
          expect(screen.getByText('Chat')).toBeInTheDocument();
        });
      });

      it('should show text input fallback when no options available and disconnected', async () => {
        const { container } = render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          // Should show a text input since no dynamic options or static options
          const sceneInput = container.querySelector('#param-sceneName');
          expect(sceneInput).toBeInTheDocument();
        });
      });
    });

    // ─── Live status display ──────────────────────────────────

    describe('live status', () => {
      it('should show status panel when connected and display fields defined', async () => {
        render(PluginActionPanel, {
          props: {
            ...defaultProps,
            pluginState: { connected: true, streaming: true, recording: false }
          }
        });
        await waitFor(() => {
          expect(screen.getByText('OBS Studio Status')).toBeInTheDocument();
        });
      });

      it('should format boolean-on-off values', async () => {
        render(PluginActionPanel, {
          props: {
            ...defaultProps,
            pluginState: { connected: true, streaming: true, recording: false }
          }
        });
        await waitFor(() => {
          expect(screen.getByText(/Streaming: On/)).toBeInTheDocument();
          expect(screen.getByText(/Recording: Off/)).toBeInTheDocument();
        });
      });

      it('should not show status panel when disconnected', async () => {
        render(PluginActionPanel, { props: defaultProps });
        await waitFor(() => {
          expect(screen.queryByText('OBS Studio Status')).not.toBeInTheDocument();
        });
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Connection-less Plugin (utility-like)
  // ═══════════════════════════════════════════════════════════

  describe('connection-less plugin', () => {
    const defaultProps = {
      pluginId: 'utility',
      manifest: utilityManifest,
      actionConfig: { pluginAction: 'delay' },
      pluginState: null as Record<string, unknown> | null,
      onDirty: vi.fn(),
      onActionChanged: vi.fn()
    };

    it('should not show connection card', async () => {
      render(PluginActionPanel, { props: defaultProps });
      await waitFor(() => {
        expect(screen.queryByText('Not connected')).not.toBeInTheDocument();
        expect(screen.queryByText('Connect')).not.toBeInTheDocument();
      });
    });

    it('should auto-connect on init', async () => {
      render(PluginActionPanel, { props: defaultProps });
      await waitFor(() => {
        expect(mockOSCApi.pluginConnect).toHaveBeenCalledWith('utility', {});
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Action Selector
  // ═══════════════════════════════════════════════════════════

  describe('action selector', () => {
    const defaultProps = {
      pluginId: 'obs',
      manifest: obsManifest,
      actionConfig: { pluginAction: 'switch-scene' },
      pluginState: { connected: true } as Record<string, unknown> | null,
      onDirty: vi.fn(),
      onActionChanged: vi.fn()
    };

    it('should display action selector with plugin name label', () => {
      render(PluginActionPanel, { props: defaultProps });
      expect(screen.getByText('OBS Studio Command')).toBeInTheDocument();
    });

    it('should list all available actions', () => {
      render(PluginActionPanel, { props: defaultProps });
      expect(screen.getByText('Switch Scene')).toBeInTheDocument();
      expect(screen.getByText('Toggle Stream')).toBeInTheDocument();
    });

    it('should show current action as selected', () => {
      const { container } = render(PluginActionPanel, { props: defaultProps });
      const select = container.querySelector('#plugin-action') as HTMLSelectElement;
      expect(select.value).toBe('switch-scene');
    });

    it('should call onActionChanged when action is switched', async () => {
      const onActionChanged = vi.fn();
      const { container } = render(PluginActionPanel, {
        props: { ...defaultProps, onActionChanged }
      });
      const select = container.querySelector('#plugin-action') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'toggle-stream' } });
      expect(onActionChanged).toHaveBeenCalledWith('toggle-stream');
    });

    it('should call onDirty when action is switched', async () => {
      const onDirty = vi.fn();
      const { container } = render(PluginActionPanel, {
        props: { ...defaultProps, onDirty }
      });
      const select = container.querySelector('#plugin-action') as HTMLSelectElement;
      await fireEvent.change(select, { target: { value: 'toggle-stream' } });
      expect(onDirty).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Parameter Fields
  // ═══════════════════════════════════════════════════════════

  describe('parameter fields', () => {
    // ─── Number field ─────────────────────────────────────────

    describe('number field', () => {
      const props = {
        pluginId: 'utility',
        manifest: utilityManifest,
        actionConfig: { pluginAction: 'delay' },
        pluginState: null as Record<string, unknown> | null,
        onDirty: vi.fn(),
        onActionChanged: vi.fn()
      };

      it('should render number input for number fields', async () => {
        const { container } = render(PluginActionPanel, { props });
        await waitFor(() => {
          const input = container.querySelector('#param-ms') as HTMLInputElement;
          expect(input).toBeInTheDocument();
          expect(input.type).toBe('number');
        });
      });

      it('should show field label', async () => {
        render(PluginActionPanel, { props });
        await waitFor(() => {
          expect(screen.getByText('Duration (ms)')).toBeInTheDocument();
        });
      });

      it('should call onDirty when value changes', async () => {
        const onDirty = vi.fn();
        const { container } = render(PluginActionPanel, { props: { ...props, onDirty } });
        await waitFor(() => {
          expect(container.querySelector('#param-ms')).toBeInTheDocument();
        });
        const input = container.querySelector('#param-ms') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: '500' } });
        expect(onDirty).toHaveBeenCalled();
      });
    });

    // ─── Text field ───────────────────────────────────────────

    describe('text field', () => {
      const props = {
        pluginId: 'utility',
        manifest: utilityManifest,
        actionConfig: { pluginAction: 'notification' },
        pluginState: null as Record<string, unknown> | null,
        onDirty: vi.fn(),
        onActionChanged: vi.fn()
      };

      it('should render text input for text fields', async () => {
        const { container } = render(PluginActionPanel, { props });
        await waitFor(() => {
          const input = container.querySelector('#param-message') as HTMLInputElement;
          expect(input).toBeInTheDocument();
          expect(input.type).toBe('text');
        });
      });

      it('should show placeholder text', async () => {
        const { container } = render(PluginActionPanel, { props });
        await waitFor(() => {
          const input = container.querySelector('#param-message') as HTMLInputElement;
          expect(input.placeholder).toBe('Hello world');
        });
      });
    });

    // ─── Boolean field ────────────────────────────────────────

    describe('boolean field', () => {
      const props = {
        pluginId: 'utility',
        manifest: utilityManifest,
        actionConfig: { pluginAction: 'notification' },
        pluginState: null as Record<string, unknown> | null,
        onDirty: vi.fn(),
        onActionChanged: vi.fn()
      };

      it('should render select with Yes/No for boolean fields', async () => {
        const { container } = render(PluginActionPanel, { props });
        await waitFor(() => {
          const select = container.querySelector('#param-sound') as HTMLSelectElement;
          expect(select).toBeInTheDocument();
        });
      });

      it('should show field label', async () => {
        render(PluginActionPanel, { props });
        await waitFor(() => {
          expect(screen.getByText('Sound')).toBeInTheDocument();
        });
      });
    });

    // ─── Range field ──────────────────────────────────────────

    describe('range field', () => {
      const props = {
        pluginId: 'media',
        manifest: mediaManifest,
        actionConfig: { pluginAction: 'set-volume' },
        pluginState: null as Record<string, unknown> | null,
        onDirty: vi.fn(),
        onActionChanged: vi.fn()
      };

      it('should render range input for range fields', async () => {
        const { container } = render(PluginActionPanel, { props });
        await waitFor(() => {
          const input = container.querySelector('#param-volume') as HTMLInputElement;
          expect(input).toBeInTheDocument();
          expect(input.type).toBe('range');
        });
      });

      it('should show suffix after value', async () => {
        render(PluginActionPanel, { props });
        await waitFor(() => {
          expect(screen.getByText(/0%/)).toBeInTheDocument();
        });
      });

      it('should call onDirty when range changes', async () => {
        const onDirty = vi.fn();
        const { container } = render(PluginActionPanel, { props: { ...props, onDirty } });
        await waitFor(() => {
          expect(container.querySelector('#param-volume')).toBeInTheDocument();
        });
        const input = container.querySelector('#param-volume') as HTMLInputElement;
        await fireEvent.input(input, { target: { value: '75' } });
        expect(onDirty).toHaveBeenCalled();
      });
    });

    // ─── Image field ──────────────────────────────────────────

    describe('image field', () => {
      const props = {
        pluginId: 'media',
        manifest: mediaManifest,
        actionConfig: { pluginAction: 'set-volume' },
        pluginState: null as Record<string, unknown> | null,
        onDirty: vi.fn(),
        onActionChanged: vi.fn()
      };

      it('should render Choose Image button when no image set', async () => {
        render(PluginActionPanel, { props });
        await waitFor(() => {
          expect(screen.getByText('Choose Image')).toBeInTheDocument();
        });
      });

      it('should show preview and Change/Remove when image is set', async () => {
        const propsWithImage = {
          ...props,
          actionConfig: { pluginAction: 'set-volume', icon: 'data:image/png;base64,abc' }
        };
        render(PluginActionPanel, { props: propsWithImage });
        await waitFor(() => {
          expect(screen.getByText('Change')).toBeInTheDocument();
          expect(screen.getByText('Remove')).toBeInTheDocument();
        });
      });

      it('should call pickImage when Choose Image is clicked', async () => {
        mockOSCApi.pickImage.mockResolvedValue('data:image/png;base64,new-image');
        render(PluginActionPanel, { props });
        await waitFor(() => {
          expect(screen.getByText('Choose Image')).toBeInTheDocument();
        });
        await fireEvent.click(screen.getByText('Choose Image'));
        expect(mockOSCApi.pickImage).toHaveBeenCalled();
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Plugin Initialization
  // ═══════════════════════════════════════════════════════════

  describe('initialization', () => {
    it('should load saved settings on mount', async () => {
      render(PluginActionPanel, {
        props: {
          pluginId: 'obs',
          manifest: obsManifest,
          actionConfig: { pluginAction: 'switch-scene' },
          pluginState: null,
          onDirty: vi.fn(),
          onActionChanged: vi.fn()
        }
      });
      await waitFor(() => {
        expect(mockOSCApi.pluginGetSettings).toHaveBeenCalledWith('obs');
      });
    });

    it('should get initial plugin state', async () => {
      render(PluginActionPanel, {
        props: {
          pluginId: 'obs',
          manifest: obsManifest,
          actionConfig: { pluginAction: 'switch-scene' },
          pluginState: null,
          onDirty: vi.fn(),
          onActionChanged: vi.fn()
        }
      });
      await waitFor(() => {
        expect(mockOSCApi.pluginGetState).toHaveBeenCalledWith('obs');
      });
    });

    it('should subscribe to state changes', async () => {
      render(PluginActionPanel, {
        props: {
          pluginId: 'obs',
          manifest: obsManifest,
          actionConfig: { pluginAction: 'switch-scene' },
          pluginState: null,
          onDirty: vi.fn(),
          onActionChanged: vi.fn()
        }
      });
      await waitFor(() => {
        expect(mockOSCApi.onPluginStateChanged).toHaveBeenCalledWith('obs', expect.any(Function));
      });
    });
  });
});
