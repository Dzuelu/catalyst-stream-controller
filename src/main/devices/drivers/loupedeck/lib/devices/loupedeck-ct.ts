import type { DisplayInfo, TouchTarget, DeviceOptions } from '../types';

import { LoupedeckLive } from './loupedeck-live';

/**
 * Loupedeck CT — same base layout as Live but with additional buttons,
 * a center knob display, and separate display addressing.
 */
export class LoupedeckCT extends LoupedeckLive {
  static override productId = 0x0003;

  override readonly type = 'Loupedeck CT';
  override readonly buttons: readonly (number | string)[] = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    'home',
    'enter',
    'undo',
    'save',
    'keyboard',
    'fnL',
    'a',
    'b',
    'c',
    'd',
    'fnR',
    'e'
  ];

  override readonly displays: Record<string, DisplayInfo> = {
    center: { id: Buffer.from('\x00A'), width: 360, height: 270 },
    left: { id: Buffer.from('\x00L'), width: 60, height: 270 },
    right: { id: Buffer.from('\x00R'), width: 60, height: 270 },
    knob: { id: Buffer.from('\x00W'), width: 240, height: 240, endianness: 'be' }
  };

  constructor(options?: DeviceOptions) {
    super(options);
  }

  override getTarget(x: number, y: number, id?: number): TouchTarget {
    if (id === 0) return { screen: 'knob' };
    return super.getTarget(x, y);
  }
}
