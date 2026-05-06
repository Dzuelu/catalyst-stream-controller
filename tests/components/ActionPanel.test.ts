import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ActionPanel from '../../src/renderer/components/ActionPanel.svelte';
import {
  profiles,
  activeProfileId,
  currentPageId,
  breadcrumbs,
  selectedButtonIndex,
  selectedKnobId
} from '../../src/renderer/stores/profile';
import { connectedDevices, selectedDeviceId } from '../../src/renderer/stores/device';
import { mockOSCApi } from '../setup-renderer';
import type { Profile, DeviceInfo } from '../../src/shared/types';
import { createAppearanceFromFlat } from '../../src/shared/appearance-helpers';

const testProfile: Profile = {
  id: 'p1',
  name: 'Test',
  rootPageId: 'root',
  pages: {
    root: {
      id: 'root',
      name: 'Root',
      bindings: {
        0: {
          press: { id: 'act-1', type: 'hotkey', label: 'Copy', config: { steps: [{ modifiers: ['ctrl'], key: 'c' }] } },
          appearance: createAppearanceFromFlat({
            backgroundColor: '#1a1a2e',
            label: { text: 'Copy', color: '#ffffff', positionV: 'center', positionH: 'center' }
          })
        }
      },
      knobBindings: {
        knobTL: {
          rotateClockwise: { id: 'act-k1', type: 'hotkey', label: 'Vol Up', config: {} }
        }
      }
    },
    sub: { id: 'sub', name: 'Sub Page', bindings: {} }
  }
};

const testDevice: DeviceInfo = {
  id: 'dev-1',
  name: 'Test Device',
  rows: 3,
  cols: 5,
  keySize: 96,
  controls: [],
  connected: true,
  safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 }
};

describe('ActionPanel', () => {
  beforeEach(() => {
    // Set up stores
    profiles.set([testProfile]);
    activeProfileId.set('p1');
    currentPageId.set('root');
    breadcrumbs.set([{ pageId: 'root', pageName: 'Root' }]);
    selectedButtonIndex.set(null);
    selectedKnobId.set(null);

    const deviceMap = new Map<string, DeviceInfo>();
    deviceMap.set('dev-1', testDevice);
    connectedDevices.set(deviceMap);
    selectedDeviceId.set('dev-1');

    // Mock interaction settings
    vi.mocked(mockOSCApi.getInteractionSettings).mockResolvedValue({
      longPressMs: 500,
      doubleTapMs: 300
    });
  });

  // ─── No selection ────────────────────────────────────────

  describe('no selection', () => {
    it('should render without errors when no button selected', () => {
      const { container } = render(ActionPanel);
      // Panel renders but no button/knob header
      expect(container.querySelector('.p-4')).toBeInTheDocument();
    });
  });

  // ─── Button selected ─────────────────────────────────────

  describe('button selected', () => {
    beforeEach(() => {
      selectedButtonIndex.set(0);
    });

    it('should show button header', () => {
      render(ActionPanel);
      expect(screen.getByText('Button 1')).toBeInTheDocument();
    });

    it('should show close button', () => {
      render(ActionPanel);
      expect(screen.getByText('✕')).toBeInTheDocument();
    });

    it('should show trigger tabs', () => {
      render(ActionPanel);
      expect(screen.getByText('Press')).toBeInTheDocument();
      expect(screen.getByText('Long Press')).toBeInTheDocument();
      expect(screen.getByText('Double Tap')).toBeInTheDocument();
    });

    it('should show action type selector', () => {
      render(ActionPanel);
      expect(screen.getByLabelText('Action Type')).toBeInTheDocument();
    });

    it('should display all action type options', () => {
      render(ActionPanel);
      const select = screen.getByLabelText('Action Type') as HTMLSelectElement;
      const options = Array.from(select.options).map((o) => o.value);
      expect(options).toContain('none');
      expect(options).toContain('hotkey');
      expect(options).toContain('command');
      expect(options).toContain('multimedia');
      expect(options).toContain('go-to-page');
      expect(options).toContain('go-to-back');
      expect(options).toContain('switch-profile');
      expect(options).toContain('set-brightness');
      expect(options).toContain('multi-action');
    });

    it('should show existing action label for bound button', async () => {
      render(ActionPanel);
      // Switch to Appearance tab where layers are displayed
      await fireEvent.click(screen.getByText('Appearance'));
      // The layer list should show the Label layer name
      expect(screen.getByText('Label')).toBeInTheDocument();
      // Click on the Label layer to select it and open the inspector
      await fireEvent.click(screen.getByText('Label'));
      // Now the TextLayerEditor should show the text input with "Copy"
      const labelInput = screen.getByDisplayValue('Copy');
      expect(labelInput).toBeInTheDocument();
    });

    it('should show different button number for button 5', () => {
      selectedButtonIndex.set(4);
      render(ActionPanel);
      expect(screen.getByText('Button 5')).toBeInTheDocument();
    });
  });

  // ─── Knob selected ──────────────────────────────────────

  describe('knob selected', () => {
    beforeEach(() => {
      selectedButtonIndex.set(null);
      selectedKnobId.set('knobTL');
    });

    it('should show knob header', () => {
      render(ActionPanel);
      expect(screen.getByText(/Knob/)).toBeInTheDocument();
    });

    it('should show knob trigger tabs', () => {
      render(ActionPanel);
      expect(screen.getByText('Clockwise')).toBeInTheDocument();
      expect(screen.getByText('Counter-CW')).toBeInTheDocument();
    });

    it('should show action type selector in knob mode', () => {
      render(ActionPanel);
      expect(screen.getByLabelText('Action Type')).toBeInTheDocument();
    });
  });

  // ─── Trigger tab interaction ─────────────────────────────

  describe('trigger tabs', () => {
    beforeEach(() => {
      selectedButtonIndex.set(0);
    });

    it('should switch to Long Press tab', async () => {
      render(ActionPanel);
      await fireEvent.click(screen.getByText('Long Press'));
      // Long press tab shows timing info
      expect(screen.getByText(/Hold button for/)).toBeInTheDocument();
    });

    it('should switch to Double Tap tab', async () => {
      render(ActionPanel);
      await fireEvent.click(screen.getByText('Double Tap'));
      // Double tap tab shows tap window info
      expect(screen.getByText(/Tap twice/)).toBeInTheDocument();
    });
  });

  // ─── Action type configuration ──────────────────────────

  describe('action configuration', () => {
    beforeEach(() => {
      selectedButtonIndex.set(0);
    });

    it('should show hotkey config when hotkey is loaded', () => {
      render(ActionPanel);
      // Button 0 has hotkey action loaded — should show keystroke steps
      expect(screen.getByText('Keystroke Steps')).toBeInTheDocument();
    });

    it('should show label input', async () => {
      render(ActionPanel);
      await fireEvent.click(screen.getByText('Appearance'));
      // Select the Label layer to open the text editor
      await fireEvent.click(screen.getByText('Label'));
      expect(screen.getByDisplayValue('Copy')).toBeInTheDocument();
    });
  });

  // ─── Save/Clear controls ─────────────────────────────────

  describe('save and clear', () => {
    beforeEach(() => {
      selectedButtonIndex.set(0);
    });

    it('should have save button', () => {
      render(ActionPanel);
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('should have clear button', () => {
      render(ActionPanel);
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });
  });

  // ─── Multi-action plugin steps ───────────────────────────

  describe('multi-action with plugin steps', () => {
    const obsManifest = {
      id: 'obs',
      name: 'OBS Studio',
      description: 'OBS WebSocket integration',
      version: '1.0.0',
      actions: {
        'switch-scene': {
          label: 'Switch Scene',
          params: {
            sceneName: {
              key: 'sceneName',
              label: 'Scene',
              type: 'select' as const,
              dynamicOptionsQuery: 'getScenes'
            }
          }
        },
        'toggle-stream': { label: 'Toggle Stream' }
      },
      connection: {
        defaults: {},
        fields: []
      },
      state: {
        defaults: {}
      }
    };

    const multiActionProfile: Profile = {
      id: 'p1',
      name: 'Test',
      rootPageId: 'root',
      pages: {
        root: {
          id: 'root',
          name: 'Root',
          bindings: {
            0: {
              press: {
                id: 'act-multi',
                type: 'multi-action',
                label: 'Stream Macro',
                config: {
                  steps: [
                    {
                      action: {
                        id: 'step-1',
                        type: 'plugin:obs',
                        label: 'Switch Scene',
                        config: { pluginAction: 'switch-scene', sceneName: 'Gaming' }
                      },
                      delayMs: 500
                    },
                    {
                      action: {
                        id: 'step-2',
                        type: 'hotkey',
                        label: 'Mute',
                        config: { steps: [{ key: 'm', modifiers: ['ctrl'] }] }
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      }
    };

    beforeEach(() => {
      vi.mocked(mockOSCApi.pluginGetManifests).mockResolvedValue([obsManifest] as any);
      profiles.set([multiActionProfile]);
      activeProfileId.set('p1');
      currentPageId.set('root');
      breadcrumbs.set([{ pageId: 'root', pageName: 'Root' }]);
      selectedButtonIndex.set(0);
    });

    it('should show multi-action steps with plugin step type', async () => {
      render(ActionPanel);
      // Should show the step headers
      expect(screen.getByText('Step 1')).toBeInTheDocument();
      expect(screen.getByText('Step 2')).toBeInTheDocument();
    });

    it('should include plugin types in step type dropdown', async () => {
      render(ActionPanel);
      // Wait a tick for manifests to load
      await vi.waitFor(() => {
        const selects = screen.getAllByRole('combobox');
        // Find a step type select that has the plugin option
        const stepSelect = selects.find((s) => {
          const options = Array.from((s as HTMLSelectElement).options).map((o) => o.value);
          return options.includes('plugin:obs');
        });
        expect(stepSelect).toBeTruthy();
      });
    });
  });
});
