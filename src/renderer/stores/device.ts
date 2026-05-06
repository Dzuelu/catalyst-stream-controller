import { writable, derived } from 'svelte/store';
import type { DeviceInfo, DeviceButtonEvent, DeviceKnobEvent } from '../../shared/types';

/** All currently connected devices, keyed by device ID */
export const connectedDevices = writable<Map<string, DeviceInfo>>(new Map());

/** The currently selected/focused device ID (for grid display & calibration) */
export const selectedDeviceId = writable<string | null>(null);

/** Convenience: the DeviceInfo for the selected device */
export const deviceInfo = derived([connectedDevices, selectedDeviceId], ([$devices, $selectedId]) => {
  if ($selectedId && $devices.has($selectedId)) {
    return $devices.get($selectedId)!;
  }
  // Fallback: return the first device if no selection
  const first = $devices.values().next();
  return first.done ? null : first.value;
});

/** Set of currently pressed button indices (per selected device) */
export const pressedButtons = writable<Set<number>>(new Set());

/** Last knob rotate event (for UI feedback — which knob, which direction) */
export const lastKnobEvent = writable<DeviceKnobEvent | null>(null);

/** Whether any device is connected */
export const isConnected = derived(connectedDevices, ($devices) => $devices.size > 0);

/** Number of connected devices */
export const deviceCount = derived(connectedDevices, ($devices) => $devices.size);

/** Callback invoked when a device first connects (for initializing per-device profile state) */
let _onFirstDeviceCallback: ((info: DeviceInfo) => void) | null = null;

/** Set a callback to be notified when the first device connects */
export function setOnFirstDeviceConnected(cb: (info: DeviceInfo) => void): void {
  _onFirstDeviceCallback = cb;
}

/** Initialize device event listeners from the preload API */
export function initDeviceListeners(): () => void {
  const unsubscribers: (() => void)[] = [];

  // Fetch all currently connected devices
  window.osc.getConnectedDevices().then((devices) => {
    const map = new Map<string, DeviceInfo>();
    for (const info of devices) {
      map.set(info.id, info);
    }
    connectedDevices.set(map);
    // Auto-select the first device if none selected
    if (devices.length > 0) {
      selectedDeviceId.update((current) => current ?? devices[0].id);
    }
  });

  // Listen for device connection
  unsubscribers.push(
    window.osc.onDeviceConnected((info) => {
      connectedDevices.update((devices) => {
        const next = new Map(devices);
        next.set(info.id, info);
        return next;
      });
      // Auto-select if this is the first device
      selectedDeviceId.update((current) => {
        if (current === null) {
          // First device — notify callback
          if (_onFirstDeviceCallback) {
            _onFirstDeviceCallback(info);
          }
          return info.id;
        }
        return current;
      });
    })
  );

  // Listen for device disconnection
  unsubscribers.push(
    window.osc.onDeviceDisconnected((deviceId) => {
      connectedDevices.update((devices) => {
        const next = new Map(devices);
        next.delete(deviceId);
        return next;
      });
      // If the selected device was disconnected, select another
      selectedDeviceId.update((current) => {
        if (current === deviceId) {
          let firstId: string | null = null;
          connectedDevices.subscribe((devices) => {
            const first = devices.values().next();
            firstId = first.done ? null : first.value.id;
          })();
          return firstId;
        }
        return current;
      });
      pressedButtons.set(new Set());
    })
  );

  // Listen for button presses (from any device, show on selected)
  unsubscribers.push(
    window.osc.onButtonDown((event: DeviceButtonEvent) => {
      pressedButtons.update((btns) => {
        const next = new Set(btns);
        next.add(event.buttonIndex);
        return next;
      });
    })
  );

  // Listen for button releases
  unsubscribers.push(
    window.osc.onButtonUp((event: DeviceButtonEvent) => {
      pressedButtons.update((btns) => {
        const next = new Set(btns);
        next.delete(event.buttonIndex);
        return next;
      });
    })
  );

  // Listen for knob rotation (for UI feedback)
  unsubscribers.push(
    window.osc.onKnobRotate((event: DeviceKnobEvent) => {
      lastKnobEvent.set(event);
    })
  );

  // Return cleanup function
  return () => {
    unsubscribers.forEach((unsub) => unsub());
  };
}
