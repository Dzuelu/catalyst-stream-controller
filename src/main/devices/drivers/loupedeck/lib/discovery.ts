import {
  LoupedeckDevice,
  LoupedeckLive,
  LoupedeckLiveS,
  LoupedeckCT,
  RazerStreamController,
  RazerStreamControllerX
} from './devices/index';
import type {
  DeviceDescriptor,
  DeviceOptions,
  DiscoveredDevice,
  DiscoveryOptions,
  LoupedeckDeviceLike,
  TransportType
} from './types';

/** All known device classes, indexed by productId */
const DEVICE_CLASSES: (typeof LoupedeckDevice)[] = [
  LoupedeckLive,
  LoupedeckLiveS,
  LoupedeckCT,
  RazerStreamController,
  RazerStreamControllerX
];

function findDeviceClass(productId: number): typeof LoupedeckDevice | undefined {
  return DEVICE_CLASSES.find((cls) => cls.productId === productId);
}

// ─── Platform-aware transport priority ────────────────────────

/**
 * Default transport priority based on the current platform.
 *
 * Serial is preferred on all platforms — on Linux the serial transport
 * handles both commands and input events when udev rules grant proper
 * access to the ttyACM device.
 */
export function defaultTransportPriority(): TransportType[] {
  return ['serial', 'hid', 'websocket'];
}

// ─── Deduplication ────────────────────────────────────────────

/**
 * Create a stable key for deduplication.
 *
 * Two {@link DiscoveredDevice} entries are considered the "same physical
 * device" when they share `vendorId + productId + serialNumber`.  When
 * `serialNumber` is absent we fall back to the raw address — this is
 * less reliable but the best we can do.
 */
function deviceKey(d: DiscoveredDevice): string {
  if (d.serialNumber) {
    return `${d.vendorId}:${d.productId}:${d.serialNumber}`;
  }
  return `${d.vendorId}:${d.productId}:addr:${d.address ?? 'unknown'}`;
}

/**
 * Deduplicate a set of discovered devices, preferring whichever
 * transport appears first in `priority`.
 *
 * Returns _all_ alternatives grouped by physical device, with the
 * preferred transport first.  Callers can read the first element as
 * the "best" choice and treat the rest as fallbacks.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function deduplicateDevices(
  devices: DiscoveredDevice[],
  priority: readonly TransportType[]
): { best: DiscoveredDevice; alternatives: DiscoveredDevice[] }[] {
  const groups = new Map<string, DiscoveredDevice[]>();

  for (const d of devices) {
    const key = deviceKey(d);
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(d);
  }

  const results: { best: DiscoveredDevice; alternatives: DiscoveredDevice[] }[] = [];

  for (const group of groups.values()) {
    // Sort by transport priority (lower index = higher priority)
    group.sort((a, b) => {
      const ra = priority.indexOf(a.transport);
      const rb = priority.indexOf(b.transport);
      return (ra === -1 ? priority.length : ra) - (rb === -1 ? priority.length : rb);
    });
    results.push({ best: group[0], alternatives: group.slice(1) });
  }

  // Sort results by primary transport priority
  results.sort((a, b) => {
    const ra = priority.indexOf(a.best.transport);
    const rb = priority.indexOf(b.best.transport);
    return (ra === -1 ? priority.length : ra) - (rb === -1 ? priority.length : rb);
  });

  return results;
}

// ─── Public API ───────────────────────────────────────────────

/**
 * List all connected Loupedeck-protocol devices without connecting to them.
 *
 * Returns `DeviceDescriptor` objects that include transport type, device
 * metadata, and a `connect()` method.
 *
 * When the same physical device is found on multiple transports, only
 * the one with the highest priority is returned (see
 * {@link DiscoveryOptions.transportPriority}).
 */
export async function listDevices(options: DiscoveryOptions = {}): Promise<DeviceDescriptor[]> {
  const priority = options.transportPriority ?? defaultTransportPriority();

  const discovered = await LoupedeckDevice.list({
    ignoreSerial: options.ignoreSerial,
    ignoreWebsocket: options.ignoreWebsocket,
    ignoreHid: options.ignoreHid
  });

  const unique = deduplicateDevices(discovered, priority);

  return unique
    .map(({ best: d, alternatives }) => {
      const DeviceClass = findDeviceClass(d.productId);
      if (!DeviceClass) return null;
      const type = (DeviceClass as unknown as { prototype: { type?: string } }).prototype.type ?? 'Unknown';

      // On Linux, if we have both serial and HID for the same device,
      // capture the HID path.  Some firmware requires the HID interface
      // to be opened before serial delivers input events.
      let hidAddress: string | undefined;
      const isLinux = typeof process !== 'undefined' && process.platform === 'linux';
      if (isLinux) {
        const hidAlt = alternatives.find((a) => a.transport === 'hid');
        if (d.transport === 'serial' && hidAlt) {
          hidAddress = hidAlt.address;
        }
      }

      // Build fallback list from alternative transports.
      const fallbackTransports = alternatives.map((alt) => ({
        transport: alt.transport,
        address: alt.address,
        portRef: alt.portRef
      }));

      const descriptor: DeviceDescriptor = {
        productId: d.productId,
        vendorId: d.vendorId,
        serialNumber: d.serialNumber,
        address: d.address,
        portRef: d.portRef,
        type,
        transport: d.transport,
        fallbackTransports: fallbackTransports.length > 0 ? fallbackTransports : undefined,
        connect: async (connectOpts?: Partial<DeviceOptions>): Promise<LoupedeckDeviceLike> => {
          const device = new (DeviceClass as unknown as new (opts: DeviceOptions) => LoupedeckDevice)({
            address: d.address,
            portRef: d.portRef,
            transport: d.transport,
            hidAddress,
            ...connectOpts
          });
          await device.connect();
          return device;
        }
      };
      return descriptor;
    })
    .filter((d): d is DeviceDescriptor => d !== null);
}

/**
 * Discover and connect to the first available device.
 *
 * Convenience function matching the original `discover()` API.
 */
export async function discover(options?: Partial<DeviceOptions> & DiscoveryOptions): Promise<LoupedeckDevice> {
  const descriptors = await listDevices(options);
  if (descriptors.length === 0) {
    throw new Error('No devices found');
  }
  const desc = descriptors[0];
  // Use the descriptor's connect() which already has hidAddress
  // and fallback logic baked in.
  return (await desc.connect(options)) as LoupedeckDevice;
}
