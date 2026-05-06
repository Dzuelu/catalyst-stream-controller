import type { InteractionSettings, TriggerType } from '../../shared/types';
import { DEFAULT_INTERACTION_SETTINGS } from '../../shared/types';

/** Per-button state machine for interpreting raw down/up into semantic triggers */
interface ButtonState {
  /** Timestamp of the most recent 'down' event */
  downAt: number;
  /** Timer for long-press detection (fires while button is held) */
  longPressTimer: ReturnType<typeof setTimeout> | null;
  /** Timer for double-tap window (fires after window elapses with only one tap) */
  doubleTapTimer: ReturnType<typeof setTimeout> | null;
  /** Number of taps within the current double-tap window */
  tapCount: number;
  /** Whether long-press already fired for this hold (prevents subsequent press) */
  longPressFired: boolean;
}

export type TriggerCallback = (deviceId: string, buttonIndex: number, trigger: TriggerType) => void;

/**
 * Translates raw `down`/`up` button events into semantic trigger events:
 *   - `press`      — normal single tap
 *   - `longPress`  — held down for ≥ 500ms
 *   - `doubleTap`  — two taps within 300ms
 *
 * **Optimisation:** When a button has no `doubleTap` binding, the `press` trigger
 * fires **instantly** on the down event (zero latency).  The double-tap delay is
 * only introduced for buttons that actually use it.
 *
 * State is keyed by a composite `deviceId:buttonIndex` so multiple devices
 * can have independent interaction state.
 */
export class ButtonInteractionManager {
  private states: Map<string, ButtonState> = new Map();
  private callback: TriggerCallback;
  /** Set of button indices that have a doubleTap binding.  Updated by the caller
   *  whenever the active page/profile changes. */
  private doubleTapButtons: Set<number> = new Set();
  /** Set of button indices that have a longPress binding. */
  private longPressButtons: Set<number> = new Set();
  /** Set of button indices that have a down binding (immediate physical trigger). */
  private downButtons: Set<number> = new Set();
  /** Set of button indices that have an up binding (immediate physical trigger). */
  private upButtons: Set<number> = new Set();
  /** Configurable timing values */
  private longPressMs: number = DEFAULT_INTERACTION_SETTINGS.longPressMs;
  private doubleTapMs: number = DEFAULT_INTERACTION_SETTINGS.doubleTapMs;

  constructor(callback: TriggerCallback) {
    this.callback = callback;
  }

  /** Composite key for per-device per-button state */
  private stateKey(deviceId: string, buttonIndex: number): string {
    return `${deviceId}:${buttonIndex}`;
  }

  /** Update timing settings.  Takes effect on the next button interaction. */
  setTimings(settings: InteractionSettings): void {
    this.longPressMs = settings.longPressMs;
    this.doubleTapMs = settings.doubleTapMs;
    console.log(
      `[Buttons] Timings updated — longPress: ${settings.longPressMs}ms, doubleTap: ${settings.doubleTapMs}ms`
    );
  }

  /** Tell the manager which buttons have long-press, double-tap, down, and up bindings.
   *  Call this whenever the page or profile changes. */
  updateBindingHints(
    longPressIndices: number[],
    doubleTapIndices: number[],
    downIndices: number[] = [],
    upIndices: number[] = []
  ): void {
    this.longPressButtons = new Set(longPressIndices);
    this.doubleTapButtons = new Set(doubleTapIndices);
    this.downButtons = new Set(downIndices);
    this.upButtons = new Set(upIndices);
    const hasHints =
      longPressIndices.length > 0 || doubleTapIndices.length > 0 || downIndices.length > 0 || upIndices.length > 0;
    if (hasHints) {
      console.log(
        `[Buttons] Binding hints — longPress: [${longPressIndices.join(',')}], doubleTap: [${doubleTapIndices.join(',')}], down: [${downIndices.join(',')}], up: [${upIndices.join(',')}]`
      );
    }
  }

  /** Handle a raw button-down event */
  handleDown(deviceId: string, buttonIndex: number): void {
    // Fire 'down' trigger immediately (independent of press/longPress/doubleTap)
    if (this.downButtons.has(buttonIndex)) {
      console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → down`);
      this.callback(deviceId, buttonIndex, 'down');
    }

    const key = this.stateKey(deviceId, buttonIndex);
    let state = this.states.get(key);
    if (!state) {
      state = {
        downAt: 0,
        longPressTimer: null,
        doubleTapTimer: null,
        tapCount: 0,
        longPressFired: false
      };
      this.states.set(key, state);
    }

    state.downAt = Date.now();
    state.longPressFired = false;

    // Start long-press timer (only if a long-press binding exists)
    if (state.longPressTimer) clearTimeout(state.longPressTimer);
    if (this.longPressButtons.has(buttonIndex)) {
      state.longPressTimer = setTimeout(() => {
        state!.longPressFired = true;
        // Cancel any pending double-tap window since long-press takes priority
        if (state!.doubleTapTimer) {
          clearTimeout(state!.doubleTapTimer);
          state!.doubleTapTimer = null;
          state!.tapCount = 0;
        }
        console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → longPress`);
        this.callback(deviceId, buttonIndex, 'longPress');
      }, this.longPressMs);
    }

    // If this button does NOT use double-tap, fire press immediately on down
    if (!this.doubleTapButtons.has(buttonIndex) && !this.longPressButtons.has(buttonIndex)) {
      console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → press (instant)`);
      this.callback(deviceId, buttonIndex, 'press');
    }
  }

  /** Handle a raw button-up event */
  handleUp(deviceId: string, buttonIndex: number): void {
    // Fire 'up' trigger immediately (independent of press/longPress/doubleTap)
    if (this.upButtons.has(buttonIndex)) {
      console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → up`);
      this.callback(deviceId, buttonIndex, 'up');
    }

    const key = this.stateKey(deviceId, buttonIndex);
    const state = this.states.get(key);
    if (!state) return;

    // Cancel long-press timer
    if (state.longPressTimer) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }

    // If long-press already fired, don't also fire press/doubleTap
    if (state.longPressFired) {
      state.tapCount = 0;
      return;
    }

    const hasDoubleTap = this.doubleTapButtons.has(buttonIndex);
    const hasLongPress = this.longPressButtons.has(buttonIndex);

    if (!hasDoubleTap && !hasLongPress) {
      // Already fired on down — nothing to do
      return;
    }

    if (!hasDoubleTap && hasLongPress) {
      // No double-tap binding, but has long-press.  Fire press on up
      // (since we didn't fire it on down to allow the long-press window).
      console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → press (on-up)`);
      this.callback(deviceId, buttonIndex, 'press');
      return;
    }

    // Double-tap logic: count taps within the window
    state.tapCount++;

    if (state.tapCount === 2) {
      // Second tap — fire double-tap and reset
      if (state.doubleTapTimer) {
        clearTimeout(state.doubleTapTimer);
        state.doubleTapTimer = null;
      }
      state.tapCount = 0;
      console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → doubleTap`);
      this.callback(deviceId, buttonIndex, 'doubleTap');
    } else {
      // First tap — start window; if no second tap arrives, fire press
      if (state.doubleTapTimer) clearTimeout(state.doubleTapTimer);
      state.doubleTapTimer = setTimeout(() => {
        state!.doubleTapTimer = null;
        state!.tapCount = 0;
        console.log(`[Buttons] Key ${buttonIndex} (${deviceId}) → press (deferred)`);
        this.callback(deviceId, buttonIndex, 'press');
      }, this.doubleTapMs);
    }
  }

  /** Reset all state (e.g. on page change, profile switch) */
  reset(): void {
    for (const state of this.states.values()) {
      if (state.longPressTimer) clearTimeout(state.longPressTimer);
      if (state.doubleTapTimer) clearTimeout(state.doubleTapTimer);
    }
    this.states.clear();
    console.log('[Buttons] State reset (page/profile change)');
  }

  /** Clean up on shutdown */
  destroy(): void {
    this.reset();
  }
}
