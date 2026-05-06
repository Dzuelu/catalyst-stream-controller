import type { DisplayInfo, TouchTarget, DeviceOptions } from '../types';

import { LoupedeckDevice } from './base';

/**
 * Loupedeck Live S — 5×3 key grid with 2 knobs, single display.
 */
export class LoupedeckLiveS extends LoupedeckDevice {
  static override productId = 0x0006;
  static override vendorId = 0x2ec2;

  readonly type = 'Loupedeck Live S' as const;
  readonly buttons: readonly (number | string)[] = [0, 1, 2, 3];
  readonly knobs: readonly string[] = ['knobCL', 'knobTL'];
  readonly columns = 5;
  readonly rows = 3;
  readonly visibleX: [number, number] = [15, 465];

  readonly displays: Record<string, DisplayInfo> = {
    center: { id: Buffer.from('\x00M'), width: 480, height: 270 }
  };

  constructor(options?: DeviceOptions) {
    super(options);
  }

  getTarget(x: number, y: number, _id?: number): TouchTarget {
    if (x < this.visibleX[0] || x >= this.visibleX[1]) return {};
    const column = Math.floor((x - this.visibleX[0]) / this.keySize);
    const row = Math.floor(y / this.keySize);
    const key = row * this.columns + column;
    return { screen: 'center', key };
  }
}
