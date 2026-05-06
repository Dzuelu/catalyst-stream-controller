<script lang="ts">
  /**
   * VirtualDeckApp — Root component for the virtual deck window.
   *
   * Fetches the device config, subscribes to key-image updates,
   * and renders the modular layout: button grid + encoder row + slider row.
   */
  import { onMount, onDestroy } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import VirtualDeckButton from './VirtualDeckButton.svelte';
  import VirtualDeckKnob from './VirtualDeckKnob.svelte';
  import VirtualDeckSlider from './VirtualDeckSlider.svelte';
  import type { DeviceInfo, KnobControl, SliderControl, Control } from '../../../shared/types';

  interface Props {
    deviceId: string;
  }

  const { deviceId }: Props = $props();

  // ─── State ──────────────────────────────────────────────────

  let deviceInfo = $state<DeviceInfo | null>(null);
  const keyImages = new SvelteMap<number, string>();
  const sliderValues = new SvelteMap<string, number>();
  let loading = $state(true);
  let error: string | null = $state(null);

  // Derived — compute layout from device info in a single block
  const layout = $derived.by(() => {
    const di = deviceInfo;
    const r = di?.rows ?? 0;
    const c = di?.cols ?? 0;
    const ks = di?.keySize ?? 96;
    const ctrls = (di?.controls ?? []) as Control[];

    const knobs = ctrls.filter((x): x is KnobControl => x.type === 'knob');
    const sliders = ctrls.filter((x): x is SliderControl => x.type === 'slider');

    return {
      rows: r,
      cols: c,
      keySize: ks,
      cellSize: Math.min(ks, 120),
      leftKnobs: knobs.filter((k) => k.side === 'left'),
      rightKnobs: knobs.filter((k) => k.side === 'right'),
      bottomKnobs: knobs.filter((k) => k.side === 'bottom'),
      leftSliders: sliders.filter((s) => s.side === 'left'),
      rightSliders: sliders.filter((s) => s.side === 'right')
    };
  });

  // ─── Lifecycle ──────────────────────────────────────────────

  let cleanupKeyImage: (() => void) | null = null;
  let cleanupSliderValue: (() => void) | null = null;

  onMount(async () => {
    try {
      // Fetch all connected devices and find our virtual device
      const devices = await window.osc.getConnectedDevices();
      deviceInfo = devices.find((d) => d.id === deviceId) ?? null;

      if (!deviceInfo) {
        error = 'Virtual device not found. It may need to be created first.';
        loading = false;
        return;
      }

      // Fetch initial key images
      const images = await window.osc.virtualDeviceGetKeyImages(deviceId);
      for (const [key, value] of Object.entries(images)) {
        keyImages.set(Number(key), value);
      }

      // Fetch initial slider values
      const values = await window.osc.virtualDeviceGetSliderValues(deviceId);
      for (const [key, value] of Object.entries(values)) {
        sliderValues.set(key, value);
      }

      loading = false;

      // Subscribe to key-image updates
      cleanupKeyImage = window.osc.onVirtualDeviceKeyImage((data) => {
        if (data.deviceId !== deviceId) return;
        keyImages.set(data.keyIndex, data.dataUri);
      });

      // Subscribe to slider value updates
      cleanupSliderValue = window.osc.onVirtualDeviceSliderValue((data) => {
        if (data.deviceId !== deviceId) return;
        sliderValues.set(data.sliderId, data.value);
      });

      // Signal readiness so the main process pushes key images
      await window.osc.rendererReady();
    } catch (err) {
      error = `Failed to initialize: ${err}`;
      loading = false;
    }
  });

  onDestroy(() => {
    cleanupKeyImage?.();
    cleanupSliderValue?.();
  });
</script>

<div class="vd-root">
  {#if loading}
    <div class="vd-loading">
      <div class="vd-spinner"></div>
      <p>Loading virtual deck...</p>
    </div>
  {:else if error}
    <div class="vd-error">
      <p class="vd-error-icon">⚠️</p>
      <p>{error}</p>
    </div>
  {:else if deviceInfo}
    <div class="vd-device-name">{deviceInfo.name}</div>

    <div class="vd-layout">
      <!-- Left side: knobs + sliders -->
      {#if layout.leftKnobs.length > 0 || layout.leftSliders.length > 0}
        <div class="vd-side-column">
          {#each layout.leftKnobs as knob (knob.id)}
            <VirtualDeckKnob {deviceId} control={knob} />
          {/each}
          {#each layout.leftSliders as slider (slider.id)}
            <VirtualDeckSlider {deviceId} control={slider} value={sliderValues.get(slider.id) ?? 0} />
          {/each}
        </div>
      {/if}

      <!-- Center: button grid -->
      <div class="vd-center">
        <div
          class="vd-button-grid"
          style="grid-template-columns: repeat({layout.cols}, {layout.cellSize}px); grid-template-rows: repeat({layout.rows}, {layout.cellSize}px);"
        >
          {#each Array.from({ length: layout.rows * layout.cols }, (_, i) => i) as keyIndex (keyIndex)}
            <VirtualDeckButton
              {deviceId}
              {keyIndex}
              imageDataUri={keyImages.get(keyIndex) ?? null}
              keySize={layout.cellSize}
            />
          {/each}
        </div>

        <!-- Bottom knobs -->
        {#if layout.bottomKnobs.length > 0}
          <div class="vd-bottom-row">
            {#each layout.bottomKnobs as knob (knob.id)}
              <VirtualDeckKnob {deviceId} control={knob} />
            {/each}
          </div>
        {/if}
      </div>

      <!-- Right side: knobs + sliders -->
      {#if layout.rightKnobs.length > 0 || layout.rightSliders.length > 0}
        <div class="vd-side-column">
          {#each layout.rightKnobs as knob (knob.id)}
            <VirtualDeckKnob {deviceId} control={knob} />
          {/each}
          {#each layout.rightSliders as slider (slider.id)}
            <VirtualDeckSlider {deviceId} control={slider} value={sliderValues.get(slider.id) ?? 0} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .vd-root {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 16px;
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    user-select: none;
    -webkit-user-select: none;
  }

  .vd-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--color-text-muted);
  }

  .vd-spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .vd-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--color-text-secondary);
    text-align: center;
    max-width: 300px;
  }

  .vd-error-icon {
    font-size: 32px;
  }

  .vd-device-name {
    font-size: 13px;
    color: var(--color-text-secondary);
    margin-bottom: 12px;
  }

  .vd-layout {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .vd-side-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .vd-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .vd-button-grid {
    display: grid;
    gap: 4px;
  }

  .vd-bottom-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-top: 4px;
  }
</style>
