import type { DeviceInfo, ButtonControl, SafeAreaInsets, ButtonAppearance } from '../../shared/types';

/** Describes a device driver that can manage a specific hardware type */
export interface DeviceDriver {
  /** Human-readable driver name */
  name: string;

  /** Start discovering devices managed by this driver.
   *  Returns an array of newly found devices (may be empty). */
  discover(): Promise<ManagedDevice[]>;

  /** Clean up resources for a specific device (by ID), or all if no ID given */
  dispose(deviceId?: string): Promise<void>;
}

/** Represents a connected, managed device instance */
export interface ManagedDevice {
  /** Unique device identifier */
  id: string;

  /** Get device metadata */
  getInfo(): DeviceInfo;

  /** Set screen brightness (0-1) */
  setBrightness(brightness: number): Promise<void>;

  /** Draw content to a specific key using full appearance settings.
   *  @param pluginImageDataUri Optional resolved plugin image data URI to inject
   *    into any visible PluginLayer. The caller resolves imageId → data URI via
   *    the plugin registry before calling this method. */
  drawKey(keyIndex: number, appearance: ButtonAppearance, pluginImageDataUri?: string): Promise<void>;

  /** Draw calibration guides on all keys so users can measure bezel coverage */
  drawCalibration(): Promise<void>;

  /** Update the safe area insets (user-provided offsets) */
  setKeyInsets(insets: SafeAreaInsets): void;

  /** Disconnect and clean up */
  disconnect(): Promise<void>;

  /** Event subscription */
  on(event: 'down', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'up', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'rotate', handler: (data: { knobId: string; delta: number }) => void): void;
  on(event: 'knob-press', handler: (data: { knobId: string }) => void): void;
  on(event: 'disconnect', handler: () => void): void;
}

/** Build a controls array for a grid-based button device */
export function buildButtonGrid(rows: number, cols: number): ButtonControl[] {
  const controls: ButtonControl[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      controls.push({
        type: 'button',
        index: row * cols + col,
        row,
        col
      });
    }
  }
  return controls;
}
