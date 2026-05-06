<script lang="ts">
  /**
   * VirtualDeckSlider — A linear fader widget for the virtual deck.
   *
   * Renders a vertical track with a draggable thumb. The user can:
   * - Click anywhere on the track to jump to that value
   * - Drag the thumb to scrub smoothly
   * Emits slider-change events with a normalized 0–127 value.
   */
  import type { SliderControl } from '../../../shared/types';

  interface Props {
    deviceId: string;
    control: SliderControl;
    value?: number;
  }

  // eslint-disable-next-line prefer-const -- value is reassigned on drag
  let { deviceId, control, value = 0 }: Props = $props();

  let isDragging = $state(false);
  let trackElement: HTMLElement | null = null;

  /** Convert a clientY position to a 0–127 slider value (bottom = 0, top = 127) */
  function clientYToValue(clientY: number): number {
    if (!trackElement) return 0;
    const rect = trackElement.getBoundingClientRect();
    const ratio = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.round(ratio * 127);
  }

  function setSliderValue(newValue: number) {
    const clamped = Math.max(0, Math.min(127, newValue));
    if (clamped !== value) {
      value = clamped;
      window.osc.virtualDeviceSliderChange(deviceId, control.id, clamped);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    isDragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    trackElement = e.currentTarget as HTMLElement;
    setSliderValue(clientYToValue(e.clientY));
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    e.preventDefault();
    setSliderValue(clientYToValue(e.clientY));
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging) return;
    e.preventDefault();
    isDragging = false;
  }

  function handlePointerCancel() {
    isDragging = false;
  }

  // Reactive: thumb position as percentage (0 at bottom, 100 at top)
  const thumbPercent = $derived((value / 127) * 100);
</script>

<div class="vd-slider-wrapper">
  <span class="vd-slider-label">{control.label}</span>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="vd-slider-track"
    class:dragging={isDragging}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
  >
    <!-- Fill bar -->
    <div class="vd-slider-fill" style="height: {thumbPercent}%;"></div>

    <!-- Thumb -->
    <div class="vd-slider-thumb" style="bottom: {thumbPercent}%;">
      <div class="vd-slider-thumb-grip"></div>
    </div>
  </div>

  <span class="vd-slider-value">{value}</span>
</div>

<style>
  .vd-slider-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .vd-slider-track {
    position: relative;
    width: 28px;
    height: 120px;
    border-radius: 14px;
    background: var(--color-surface-0);
    border: 2px solid var(--color-border);
    cursor: pointer;
    overflow: hidden;
    transition: border-color 120ms ease;
  }

  .vd-slider-track:hover {
    border-color: var(--color-text-muted);
  }

  .vd-slider-track.dragging {
    border-color: var(--color-accent);
    box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
  }

  .vd-slider-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--color-accent);
    opacity: 0.25;
    border-radius: 0 0 12px 12px;
    transition: height 30ms ease-out;
    pointer-events: none;
  }

  .vd-slider-thumb {
    position: absolute;
    left: 50%;
    transform: translate(-50%, 50%);
    width: 24px;
    height: 14px;
    border-radius: 7px;
    background: var(--color-surface-3);
    border: 2px solid var(--color-text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    transition: bottom 30ms ease-out;
  }

  .vd-slider-track.dragging .vd-slider-thumb {
    border-color: var(--color-accent);
  }

  .vd-slider-thumb-grip {
    width: 10px;
    height: 2px;
    background: var(--color-text-muted);
    border-radius: 1px;
  }

  .vd-slider-label {
    font-size: 10px;
    color: var(--color-text-muted);
    text-align: center;
    max-width: 48px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .vd-slider-value {
    font-size: 9px;
    color: var(--color-text-muted);
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
  }
</style>
