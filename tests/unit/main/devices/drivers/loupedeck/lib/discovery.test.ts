import { describe, it, expect } from 'vitest';
import {
  defaultTransportPriority,
  deduplicateDevices
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/discovery';
import type {
  DiscoveredDevice,
  TransportType
} from '../../../../../../../src/main/devices/drivers/loupedeck/lib/types';

// ─── Helpers ──────────────────────────────────────────────────

function mkDevice(overrides: Partial<DiscoveredDevice> & { transport: TransportType }): DiscoveredDevice {
  return {
    productId: 0x0004,
    vendorId: 0x2ec2,
    serialNumber: 'ABC123',
    address: '/dev/ttyACM0',
    ...overrides
  };
}

// ──────────────────────────────────────────────────────────────
describe('defaultTransportPriority', () => {
  it('returns an array of transport types', () => {
    const priority = defaultTransportPriority();
    expect(Array.isArray(priority)).toBe(true);
    expect(priority.length).toBeGreaterThanOrEqual(2);
    for (const t of priority) {
      expect(['serial', 'hid', 'websocket', 'web-serial']).toContain(t);
    }
  });

  it('includes both hid and serial', () => {
    const priority = defaultTransportPriority();
    expect(priority).toContain('hid');
    expect(priority).toContain('serial');
  });

  it('returns serial before hid on non-Linux (macOS)', () => {
    if (process.platform === 'linux') return;
    const priority = defaultTransportPriority();
    expect(priority.indexOf('serial')).toBeLessThan(priority.indexOf('hid'));
  });
});

// ──────────────────────────────────────────────────────────────
describe('deduplicateDevices', () => {
  it('returns a single entry when no duplicates exist', () => {
    const devices: DiscoveredDevice[] = [mkDevice({ transport: 'serial', address: '/dev/ttyACM0' })];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(1);
    expect(result[0].best.transport).toBe('serial');
    expect(result[0].alternatives).toEqual([]);
  });

  it('deduplicates by vendorId + productId + serialNumber', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', address: '/dev/ttyACM0', serialNumber: 'SN1' }),
      mkDevice({ transport: 'hid', address: '/dev/hidraw0', serialNumber: 'SN1' })
    ];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(1);
    expect(result[0].best.transport).toBe('serial');
    expect(result[0].alternatives.length).toBe(1);
    expect(result[0].alternatives[0].transport).toBe('hid');
  });

  it('prefers higher-priority transport', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', address: '/dev/ttyACM0', serialNumber: 'SN1' }),
      mkDevice({ transport: 'hid', address: '/dev/hidraw0', serialNumber: 'SN1' })
    ];
    const result = deduplicateDevices(devices, ['hid', 'serial']);
    expect(result.length).toBe(1);
    expect(result[0].best.transport).toBe('hid');
    expect(result[0].best.address).toBe('/dev/hidraw0');
    expect(result[0].alternatives[0].transport).toBe('serial');
  });

  it('keeps different physical devices (different serial numbers)', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', serialNumber: 'SN1' }),
      mkDevice({ transport: 'serial', serialNumber: 'SN2' })
    ];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(2);
  });

  it('keeps different products even with same serial', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', productId: 0x0004, serialNumber: 'SN1' }),
      mkDevice({ transport: 'serial', productId: 0x0003, serialNumber: 'SN1' })
    ];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(2);
  });

  it('falls back to address-based dedup when serialNumber is absent', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', address: '/dev/ttyACM0', serialNumber: undefined }),
      mkDevice({ transport: 'hid', address: '/dev/hidraw0', serialNumber: undefined })
    ];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(2);
  });

  it('deduplicates by address when serialNumber is absent and addresses match', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'serial', address: '/dev/ttyACM0', serialNumber: undefined }),
      mkDevice({ transport: 'hid', address: '/dev/ttyACM0', serialNumber: undefined })
    ];
    const result = deduplicateDevices(devices, ['hid', 'serial']);
    expect(result.length).toBe(1);
    expect(result[0].best.transport).toBe('hid');
  });

  it('sorts results by priority rank', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'websocket', serialNumber: 'SN_WS', address: 'ws://10.0.0.1' }),
      mkDevice({ transport: 'hid', serialNumber: 'SN_HID', address: '/dev/hidraw0' }),
      mkDevice({ transport: 'serial', serialNumber: 'SN_SER', address: '/dev/ttyACM0' })
    ];
    const result = deduplicateDevices(devices, ['hid', 'serial', 'websocket']);
    expect(result.length).toBe(3);
    expect(result[0].best.transport).toBe('hid');
    expect(result[1].best.transport).toBe('serial');
    expect(result[2].best.transport).toBe('websocket');
  });

  it('handles transports not in the priority list (appended at end)', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'web-serial', serialNumber: 'SN1', address: 'port1' }),
      mkDevice({ transport: 'serial', serialNumber: 'SN2', address: '/dev/ttyACM0' })
    ];
    const result = deduplicateDevices(devices, ['serial', 'hid']);
    expect(result.length).toBe(2);
    expect(result[0].best.transport).toBe('serial');
    expect(result[1].best.transport).toBe('web-serial');
  });

  it('handles an empty device list', () => {
    const result = deduplicateDevices([], ['serial', 'hid']);
    expect(result.length).toBe(0);
  });

  it('handles three transports for the same device', () => {
    const devices: DiscoveredDevice[] = [
      mkDevice({ transport: 'websocket', serialNumber: 'SN1', address: 'ws://10.0.0.1' }),
      mkDevice({ transport: 'serial', serialNumber: 'SN1', address: '/dev/ttyACM0' }),
      mkDevice({ transport: 'hid', serialNumber: 'SN1', address: '/dev/hidraw0' })
    ];
    const result = deduplicateDevices(devices, ['hid', 'serial', 'websocket']);
    expect(result.length).toBe(1);
    expect(result[0].best.transport).toBe('hid');
    expect(result[0].alternatives.length).toBe(2);
    expect(result[0].alternatives[0].transport).toBe('serial');
    expect(result[0].alternatives[1].transport).toBe('websocket');
  });
});
