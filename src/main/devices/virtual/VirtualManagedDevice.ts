import type { ManagedDevice } from '../types';
import { buildButtonGrid } from '../types';
import type {
  DeviceInfo,
  SafeAreaInsets,
  ButtonAppearance,
  Control,
  KnobControl,
  SliderControl
} from '../../../shared/types';
import type { VirtualDeviceConfig } from './VirtualDeviceConfig';
import { renderKey as keyRendererRenderKey } from '../../rendering/KeyRenderer';

/**
 * A virtual managed device — software-only, no hardware.
 *
 * Implements the same ManagedDevice interface as physical devices.
 * Interaction events are injected via public methods (e.g. from IPC
 * or a WebSocket companion), and rendered frames are emitted for
 * the UI to display.
 */
export class VirtualManagedDevice implements ManagedDevice {
  id: string;
  private config: VirtualDeviceConfig;
  private listeners: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private deviceInfo: DeviceInfo;
  private disconnected = false;
  private insets: SafeAreaInsets;

  /** Latest rendered key images (data URIs), indexed by key index */
  private keyImages: Map<number, string> = new Map();
  /** Latest slider values (0–127), indexed by slider id */
  private sliderValues: Map<string, number> = new Map();

  constructor(config: VirtualDeviceConfig, knobs: KnobControl[], sliders: SliderControl[]) {
    this.id = config.id;
    this.config = config;
    this.insets = { top: 0, bottom: 0, left: 0, right: 0 };

    const controls: Control[] = [...buildButtonGrid(config.rows, config.columns), ...knobs, ...sliders];

    this.deviceInfo = {
      id: config.id,
      name: config.name,
      rows: config.rows,
      cols: config.columns,
      keySize: config.keySize,
      controls,
      connected: true,
      safeAreaInsets: { ...this.insets }
    };

    // Initialize slider values to 0
    for (const slider of sliders) {
      this.sliderValues.set(slider.id, 0);
    }
  }

  // ─── ManagedDevice interface ─────────────────────────────────

  getInfo(): DeviceInfo {
    return { ...this.deviceInfo };
  }

  async setBrightness(_brightness: number): Promise<void> {
    // Virtual devices don't have physical brightness — no-op
    // Could be used in the future to dim the UI representation
  }

  async drawKey(keyIndex: number, appearance: ButtonAppearance, pluginImageDataUri?: string): Promise<void> {
    if (this.disconnected) return;

    try {
      const keySize = this.config.keySize;
      const dataUri = await keyRendererRenderKey(appearance, this.insets, keySize, keySize, pluginImageDataUri);

      this.keyImages.set(keyIndex, dataUri);
      this.emitLocal('key-image', { keyIndex, dataUri });
    } catch (error) {
      if (!this.disconnected) {
        console.error(`[VirtualDevice] Failed to draw key ${keyIndex}:`, error);
      }
    }
  }

  async drawCalibration(): Promise<void> {
    // Virtual devices don't need calibration — no physical bezels
    // Could render a visual grid if desired in the future
  }

  setKeyInsets(newInsets: SafeAreaInsets): void {
    this.insets = { ...newInsets };
    this.deviceInfo.safeAreaInsets = { ...newInsets };
  }

  async disconnect(): Promise<void> {
    if (this.disconnected) return;
    this.disconnected = true;
    this.deviceInfo.connected = false;
    this.keyImages.clear();
    this.emitLocal('disconnect');
  }

  on(event: 'down', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'up', handler: (data: { buttonIndex: number }) => void): void;
  on(event: 'rotate', handler: (data: { knobId: string; delta: number }) => void): void;
  on(event: 'knob-press', handler: (data: { knobId: string }) => void): void;
  on(event: 'disconnect', handler: () => void): void;
  on(event: 'key-image', handler: (data: { keyIndex: number; dataUri: string }) => void): void;
  on(event: 'slider-change', handler: (data: { sliderId: string; value: number }) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, handler: (...args: any[]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  // ─── Interaction injection (called from IPC / WebSocket) ─────

  /** Simulate a button press (down event) */
  injectKeyDown(buttonIndex: number): void {
    if (this.disconnected) return;
    this.emitLocal('down', { buttonIndex });
  }

  /** Simulate a button release (up event) */
  injectKeyUp(buttonIndex: number): void {
    if (this.disconnected) return;
    this.emitLocal('up', { buttonIndex });
  }

  /** Simulate an encoder rotation */
  injectEncoderRotate(knobId: string, delta: number): void {
    if (this.disconnected) return;
    this.emitLocal('rotate', { knobId, delta });
  }

  /** Simulate an encoder press */
  injectEncoderPress(knobId: string): void {
    if (this.disconnected) return;
    this.emitLocal('knob-press', { knobId });
  }

  /** Simulate a slider value change (0–127) */
  injectSliderChange(sliderId: string, value: number): void {
    if (this.disconnected) return;
    const clamped = Math.max(0, Math.min(127, Math.round(value)));
    this.sliderValues.set(sliderId, clamped);
    this.emitLocal('slider-change', { sliderId, value: clamped });
  }

  // ─── State queries ────────────────────────────────────────────

  /** Get the latest rendered image for a key (data URI or undefined) */
  getKeyImage(keyIndex: number): string | undefined {
    return this.keyImages.get(keyIndex);
  }

  /** Get all current key images */
  getAllKeyImages(): Map<number, string> {
    return new Map(this.keyImages);
  }

  /** Get the current value of a slider (0–127) */
  getSliderValue(sliderId: string): number {
    return this.sliderValues.get(sliderId) ?? 0;
  }

  /** Get all current slider values */
  getAllSliderValues(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [id, value] of this.sliderValues) {
      result[id] = value;
    }
    return result;
  }

  /** Get the device config */
  getConfig(): VirtualDeviceConfig {
    return { ...this.config };
  }

  /** Check if this is a virtual device */
  get isVirtual(): boolean {
    return true;
  }

  // ─── Internal ─────────────────────────────────────────────────

  private emitLocal(event: string, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(...args);
        } catch (err) {
          console.error(`[VirtualDevice] Error in event handler for '${event}':`, err);
        }
      }
    }
  }
}
