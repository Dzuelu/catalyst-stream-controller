import { BUTTONS, type HapticPattern } from '../constants';
import type { DisplayInfo, TouchTarget, DeviceOptions } from '../types';

import { LoupedeckDevice } from './base';

/**
 * Razer Stream Controller X — 5×3 key grid, no knobs, no side strips.
 * Keys are button-only (no touch screen), so button presses
 * also emit synthetic touch events.
 */
export class RazerStreamControllerX extends LoupedeckDevice {
  static override productId = 0x0d09;
  static override vendorId = 0x1532;

  override readonly type = 'Razer Stream Controller X';
  readonly buttons: (number | string)[] = [];
  readonly knobs: string[] = [];
  readonly columns = 5;
  readonly rows = 3;
  readonly visibleX: [number, number] = [0, 480];
  override keySize = 96;

  readonly displays: Record<string, DisplayInfo> = {
    center: { id: Buffer.from('\x00M'), width: 480, height: 288 }
  };

  constructor(options?: DeviceOptions) {
    super(options);
  }

  getTarget(_x: number, _y: number, _id?: number): TouchTarget {
    return {};
  }

  /** Emit an extra touchstart/touchend since RSCX uses buttons for keys. */
  protected override onButton(buff: Buffer): void {
    super.onButton(buff);
    const event = buff[1] === 0x00 ? 'touchstart' : 'touchend';
    const key = BUTTONS[buff[0]] as number;
    const row = Math.floor(key / this.columns);
    const col = key % this.columns;
    const touch = {
      id: 0,
      x: (col + 0.5) * this.keySize,
      y: (row + 0.5) * this.keySize,
      target: { key }
    };
    this.emit(event, {
      touches: event === 'touchstart' ? [touch] : [],
      changedTouches: [touch]
    });
  }

  override setButtonColor(): never {
    throw new Error('Setting key color not available on this device!');
  }

  override vibrate(_pattern?: HapticPattern): never {
    throw new Error('Vibration not available on this device!');
  }
}
