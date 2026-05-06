import type { KnobControl, SliderControl } from '../../../shared/types';

/** Configuration for a user-created virtual stream deck device */
export interface VirtualDeviceConfig {
  /** Unique device ID (e.g. 'virtual-abc123') */
  id: string;
  /** User-facing name (e.g. 'My Virtual Deck') */
  name: string;
  /** Number of button rows (1–8) */
  rows: number;
  /** Number of button columns (1–12) */
  columns: number;
  /** Rendered key resolution in pixels (default: 96) */
  keySize: number;
  /** Rotary encoders (0–6) */
  encoders: number;
  /** Where encoders are positioned relative to the button grid */
  encoderPosition: 'left' | 'right' | 'bottom' | 'none';
  /** Linear sliders/faders (0–8) */
  sliders: number;
  /** Where sliders are positioned relative to the button grid */
  sliderPosition: 'left' | 'right' | 'bottom' | 'none';
}

/** Persisted data for all virtual devices */
export interface VirtualDevicesData {
  devices: VirtualDeviceConfig[];
}

/** Generate a unique virtual device ID */
export function generateVirtualDeviceId(): string {
  return `virtual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/** Build default encoder knob controls for a virtual device config */
export function buildVirtualEncoders(config: VirtualDeviceConfig): KnobControl[] {
  const knobs: KnobControl[] = [];
  const side = config.encoderPosition === 'none' ? 'bottom' : config.encoderPosition;
  for (let i = 0; i < config.encoders; i++) {
    knobs.push({
      type: 'knob',
      id: `encoder${i}`,
      label: `Encoder ${i + 1}`,
      side
    });
  }
  return knobs;
}

/** Build slider controls for a virtual device config */
export function buildVirtualSliders(config: VirtualDeviceConfig): SliderControl[] {
  const sliders: SliderControl[] = [];
  const side = config.sliderPosition === 'bottom' || config.sliderPosition === 'none' ? 'right' : config.sliderPosition;
  for (let i = 0; i < config.sliders; i++) {
    sliders.push({
      type: 'slider',
      id: `slider${i}`,
      label: `Slider ${i + 1}`,
      side
    });
  }
  return sliders;
}

/** Validate a VirtualDeviceConfig, returning an error message or null */
export function validateVirtualDeviceConfig(config: VirtualDeviceConfig): string | null {
  if (!config.id) return 'Device ID is required';
  if (!config.name || config.name.trim().length === 0) return 'Device name is required';
  if (config.rows < 1 || config.rows > 8) return 'Rows must be between 1 and 8';
  if (config.columns < 1 || config.columns > 12) return 'Columns must be between 1 and 12';
  if (config.keySize < 32 || config.keySize > 256) return 'Key size must be between 32 and 256';
  if (config.encoders < 0 || config.encoders > 6) return 'Encoders must be between 0 and 6';
  if (config.sliders < 0 || config.sliders > 8) return 'Sliders must be between 0 and 8';
  if (!['left', 'right', 'bottom', 'none'].includes(config.encoderPosition)) return 'Invalid encoder position';
  if (!['left', 'right', 'bottom', 'none'].includes(config.sliderPosition)) return 'Invalid slider position';
  return null;
}

/** Create a sensible default config for a new virtual device */
export function createDefaultVirtualDeviceConfig(name?: string): VirtualDeviceConfig {
  return {
    id: generateVirtualDeviceId(),
    name: name ?? 'Virtual Deck',
    rows: 3,
    columns: 5,
    keySize: 96,
    encoders: 0,
    encoderPosition: 'none',
    sliders: 0,
    sliderPosition: 'none'
  };
}
