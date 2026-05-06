<script lang="ts">
  /**
   * VirtualDeckButton — An interactive button cell in the virtual deck.
   *
   * Shows the rendered key image from KeyRenderer and sends interaction
   * events (key-down / key-up) to the main process via IPC.
   * The actual press/longPress/doubleTap detection is handled by
   * ButtonInteractionManager on the main process side.
   */

  interface Props {
    deviceId: string;
    keyIndex: number;
    imageDataUri?: string | null;
    keySize?: number;
  }

  const { deviceId, keyIndex, imageDataUri = null, keySize = 96 }: Props = $props();

  let isPressed = $state(false);

  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    isPressed = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    window.osc.virtualDeviceKeyDown(deviceId, keyIndex);
  }

  function handlePointerUp(e: PointerEvent) {
    e.preventDefault();
    if (!isPressed) return;
    isPressed = false;
    window.osc.virtualDeviceKeyUp(deviceId, keyIndex);
  }

  function handlePointerCancel(_e: PointerEvent) {
    if (!isPressed) return;
    isPressed = false;
    window.osc.virtualDeviceKeyUp(deviceId, keyIndex);
  }
</script>

<button
  class="vd-button"
  class:pressed={isPressed}
  style="width: {keySize}px; height: {keySize}px;"
  onpointerdown={handlePointerDown}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerCancel}
  onpointerleave={handlePointerCancel}
>
  {#if imageDataUri}
    <img src={imageDataUri} alt="Key {keyIndex + 1}" class="vd-button-image" draggable="false" />
  {:else}
    <span class="vd-button-index">{keyIndex + 1}</span>
  {/if}
</button>

<style>
  .vd-button {
    position: relative;
    border: 2px solid var(--color-border);
    border-radius: 10px;
    background: var(--color-surface-0);
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 80ms ease,
      border-color 120ms ease;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .vd-button:hover {
    border-color: var(--color-text-muted);
  }

  .vd-button.pressed {
    transform: scale(0.93);
    border-color: var(--color-accent);
    box-shadow: 0 0 12px rgba(99, 102, 241, 0.3);
  }

  .vd-button-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 8px;
    pointer-events: none;
  }

  .vd-button-index {
    font-size: 11px;
    color: var(--color-text-muted);
    opacity: 0.5;
  }
</style>
