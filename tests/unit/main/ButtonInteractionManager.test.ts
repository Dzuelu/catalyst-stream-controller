import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ButtonInteractionManager, type TriggerCallback } from '../../../src/main/devices/ButtonInteractionManager';

describe('ButtonInteractionManager', () => {
  let bim: ButtonInteractionManager;
  let callback: ReturnType<typeof vi.fn<TriggerCallback>>;
  const DEVICE_ID = 'mock-device-001';

  beforeEach(() => {
    vi.useFakeTimers();
    callback = vi.fn();
    bim = new ButtonInteractionManager(callback);
  });

  afterEach(() => {
    bim.destroy();
    vi.useRealTimers();
  });

  // ─── Instant Press (no bindings) ──────────────────────────

  describe('instant press (no special bindings)', () => {
    it('should fire press instantly on down when no longPress/doubleTap binding', () => {
      bim.handleDown(DEVICE_ID, 0);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'press');
    });

    it('should not fire again on up when press was instant', () => {
      bim.handleDown(DEVICE_ID, 0);
      callback.mockClear();

      bim.handleUp(DEVICE_ID, 0);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ─── Long Press ───────────────────────────────────────────

  describe('long press', () => {
    beforeEach(() => {
      bim.updateBindingHints([0], []); // button 0 has longPress
    });

    it('should fire longPress after holding for 500ms (default)', () => {
      bim.handleDown(DEVICE_ID, 0);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'longPress');
    });

    it('should fire press on up if released before longPress threshold', () => {
      bim.handleDown(DEVICE_ID, 0);
      vi.advanceTimersByTime(200); // release early
      bim.handleUp(DEVICE_ID, 0);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'press');
    });

    it('should not fire press on up after longPress already fired', () => {
      bim.handleDown(DEVICE_ID, 0);
      vi.advanceTimersByTime(500); // longPress fires
      callback.mockClear();

      bim.handleUp(DEVICE_ID, 0);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should respect custom longPress timing', () => {
      bim.setTimings({ longPressMs: 1000, doubleTapMs: 300 });
      bim.handleDown(DEVICE_ID, 0);

      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'longPress');
    });
  });

  // ─── Double Tap ───────────────────────────────────────────

  describe('double tap', () => {
    beforeEach(() => {
      bim.updateBindingHints([], [0]); // button 0 has doubleTap
    });

    it('should fire doubleTap on two quick taps', () => {
      // First tap
      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);

      // Second tap (within 300ms)
      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'doubleTap');
    });

    it('should fire deferred press if no second tap within window', () => {
      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);

      expect(callback).not.toHaveBeenCalled();

      // Wait out the double-tap window
      vi.advanceTimersByTime(300);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'press');
    });

    it('should respect custom doubleTap timing', () => {
      bim.setTimings({ longPressMs: 500, doubleTapMs: 500 });

      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);

      vi.advanceTimersByTime(300);
      expect(callback).not.toHaveBeenCalled(); // Still within wider window

      vi.advanceTimersByTime(200);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'press');
    });
  });

  // ─── Combined Bindings ────────────────────────────────────

  describe('combined longPress + doubleTap bindings', () => {
    beforeEach(() => {
      bim.updateBindingHints([0], [0]); // button 0 has both
    });

    it('should fire longPress when held (takes priority over doubleTap)', () => {
      bim.handleDown(DEVICE_ID, 0);
      vi.advanceTimersByTime(500);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'longPress');
    });

    it('should fire doubleTap for two quick taps', () => {
      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);
      bim.handleDown(DEVICE_ID, 0);
      bim.handleUp(DEVICE_ID, 0);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(DEVICE_ID, 0, 'doubleTap');
    });
  });

  // ─── Multi-device Isolation ───────────────────────────────

  describe('multi-device isolation', () => {
    it('should track state independently per device', () => {
      bim.handleDown('device-A', 0);
      expect(callback).toHaveBeenCalledWith('device-A', 0, 'press');

      callback.mockClear();
      bim.handleDown('device-B', 0);
      expect(callback).toHaveBeenCalledWith('device-B', 0, 'press');
    });
  });

  // ─── Reset ────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all state and cancel pending timers', () => {
      bim.updateBindingHints([0], []);
      bim.handleDown(DEVICE_ID, 0);

      bim.reset();
      vi.advanceTimersByTime(1000);

      // longPress should not fire after reset
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle up without prior down gracefully', () => {
      expect(() => bim.handleUp(DEVICE_ID, 5)).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
    });
  });
});
