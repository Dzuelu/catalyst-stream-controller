import type { DeviceOptions } from '../types';

import { LoupedeckLive } from './loupedeck-live';

/**
 * Razer Stream Controller — identical protocol to Loupedeck Live,
 * different vendor/product IDs.
 */
export class RazerStreamController extends LoupedeckLive {
  static override productId = 0x0d06;
  static override vendorId = 0x1532;

  override readonly type = 'Razer Stream Controller';

  constructor(options?: DeviceOptions) {
    super(options);
  }
}
