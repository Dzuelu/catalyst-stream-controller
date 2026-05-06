<script lang="ts">
  /**
   * VirtualDeckKnob — A rotary encoder widget with circular-drag interaction.
   *
   * The user presses on the knob and drags in a circular motion to rotate.
   * Each 15° of rotation emits one tick via encoder-rotate IPC.
   * A click (press + release without significant drag) emits encoder-press.
   */
  import type { KnobControl } from '../../../shared/types';

  interface Props {
    deviceId: string;
    control: KnobControl;
    /** 'circular' (default) or 'vertical' swipe mode */
    interactionMode?: 'circular' | 'vertical';
  }

  const { deviceId, control, interactionMode = 'circular' }: Props = $props();

  let isPressed = $state(false);
  let rotationVisual = $state(0); // visual rotation angle in degrees
  let flashDirection: 'cw' | 'ccw' | null = $state(null);

  // Drag tracking state (not reactive — ephemeral)
  let dragActive = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let lastAngle = 0;
  let accumulatedAngle = 0;
  let dragDistance = 0;
  let knobElement: HTMLElement | null = null;

  const TICK_THRESHOLD_DEG = 15;
  const CLICK_THRESHOLD_PX = 6;
  const VERTICAL_PX_PER_TICK = 12;

  function getKnobCenter(): { cx: number; cy: number } {
    if (!knobElement) return { cx: 0, cy: 0 };
    const rect = knobElement.getBoundingClientRect();
    return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
  }

  function getAngle(cx: number, cy: number, x: number, y: number): number {
    return Math.atan2(y - cy, x - cx);
  }

  function emitRotate(delta: number) {
    window.osc.virtualDeviceEncoderRotate(deviceId, control.id, delta);
    flashDirection = delta > 0 ? 'cw' : 'ccw';
    rotationVisual += delta * TICK_THRESHOLD_DEG;
    setTimeout(() => {
      flashDirection = null;
    }, 200);
  }

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    isPressed = true;
    dragActive = true;
    dragDistance = 0;
    accumulatedAngle = 0;

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    knobElement = el;

    if (interactionMode === 'circular') {
      const { cx, cy } = getKnobCenter();
      lastAngle = getAngle(cx, cy, e.clientX, e.clientY);
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragActive) return;
    e.preventDefault();

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    dragDistance = Math.sqrt(dx * dx + dy * dy);

    if (interactionMode === 'circular') {
      const { cx, cy } = getKnobCenter();
      const currentAngle = getAngle(cx, cy, e.clientX, e.clientY);

      let delta = currentAngle - lastAngle;
      // Handle wrap-around at ±π
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;

      accumulatedAngle += delta;
      lastAngle = currentAngle;

      // Convert accumulated angle to ticks
      const tickThresholdRad = (TICK_THRESHOLD_DEG * Math.PI) / 180;
      const ticks = Math.trunc(accumulatedAngle / tickThresholdRad);
      if (ticks !== 0) {
        accumulatedAngle -= ticks * tickThresholdRad;
        emitRotate(ticks);
      }
    } else {
      // Vertical swipe mode: up = CW (+), down = CCW (-)
      const verticalDelta = -(e.clientY - dragStartY);
      const ticks = Math.trunc(verticalDelta / VERTICAL_PX_PER_TICK);
      if (ticks !== 0) {
        dragStartY = e.clientY; // Reset for next tick
        emitRotate(ticks);
      }
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragActive) return;
    e.preventDefault();

    // If the user didn't drag much, treat it as a press (click)
    if (dragDistance < CLICK_THRESHOLD_PX) {
      window.osc.virtualDeviceEncoderPress(deviceId, control.id);
    }

    isPressed = false;
    dragActive = false;
  }

  function handlePointerCancel() {
    isPressed = false;
    dragActive = false;
  }
</script>

<div class="vd-knob-wrapper">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="vd-knob"
    class:pressed={isPressed}
    class:flash-cw={flashDirection === 'cw'}
    class:flash-ccw={flashDirection === 'ccw'}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
  >
    <div class="vd-knob-ring">
      <div class="vd-knob-inner" style="transform: rotate({rotationVisual}deg);">
        <div class="vd-knob-indicator"></div>
      </div>
    </div>
  </div>
  <span class="vd-knob-label">{control.label}</span>
</div>

<style>
  .vd-knob-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .vd-knob {
    width: 56px;
    height: 56px;
    cursor: grab;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vd-knob.pressed {
    cursor: grabbing;
  }

  .vd-knob-ring {
    width: 50px;
    height: 50px;
    border-radius: 50%;
    border: 3px solid var(--color-border);
    background: var(--color-surface-2);
    display: flex;
    align-items: center;
    justify-content: center;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .vd-knob:hover .vd-knob-ring {
    border-color: var(--color-text-muted);
  }

  .vd-knob.pressed .vd-knob-ring {
    border-color: var(--color-accent);
    box-shadow: 0 0 10px rgba(99, 102, 241, 0.3);
  }

  .vd-knob.flash-cw .vd-knob-ring {
    border-color: var(--color-success);
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.3);
  }

  .vd-knob.flash-ccw .vd-knob-ring {
    border-color: var(--color-warning);
    box-shadow: 0 0 8px rgba(234, 179, 8, 0.3);
  }

  .vd-knob-inner {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--color-surface-3);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    transition: transform 60ms ease-out;
  }

  .vd-knob-indicator {
    width: 4px;
    height: 10px;
    border-radius: 2px;
    background: var(--color-text-secondary);
    margin-top: 3px;
  }

  .vd-knob-label {
    font-size: 10px;
    color: var(--color-text-muted);
    text-align: center;
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
