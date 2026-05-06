<script lang="ts">
  import { deviceInfo, selectedDeviceId } from '../stores/device';
  import type { SafeAreaInsets } from '../../shared/types';

  export let visible: boolean;
  export let onClose: () => void;
  export let onReapplyKeys: () => void;

  let insets: SafeAreaInsets = { top: 2, bottom: 20, left: 10, right: 10 };
  let showPattern = false;

  // Sync insets from device info
  $: if ($deviceInfo?.safeAreaInsets) {
    insets = { ...$deviceInfo.safeAreaInsets };
  }

  async function togglePattern() {
    if (showPattern) {
      showPattern = false;
      // Re-apply normal keys without closing the modal
      onReapplyKeys();
    } else {
      showPattern = true;
      const deviceId = $selectedDeviceId;
      console.debug('[CalibrationPanel] drawCalibration deviceId=', deviceId);
      if (deviceId) await window.osc.drawCalibration(deviceId);
    }
  }

  async function applyInsets() {
    const deviceId = $selectedDeviceId;
    console.debug('[CalibrationPanel] setKeyInsets deviceId=', deviceId, 'insets=', insets);
    if (!deviceId) return;
    await window.osc.setKeyInsets(insets, deviceId);
    if (showPattern) {
      // Redraw calibration with new insets
      await window.osc.drawCalibration(deviceId);
    }
  }

  async function handleClose() {
    if (showPattern) {
      showPattern = false;
    }
    onClose();
  }

  const sliderClass = 'flex-1 accent-[var(--color-accent)]';
  const labelClass = 'text-xs text-[var(--color-text-secondary)] w-14 text-right';
  const valueClass = 'text-xs text-[var(--color-text-muted)] w-8 text-right font-mono';
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="fixed inset-0 bg-black/50 z-40 flex items-center justify-center" on:click|self={handleClose}>
    <div
      class="bg-[var(--color-surface-1)] border border-[var(--color-border)] rounded-xl shadow-2xl w-96 max-h-[80vh] overflow-y-auto"
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
        <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">⚙ Calibration Settings</h3>
        <button
          on:click={handleClose}
          class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors text-lg leading-none"
        >
          ✕
        </button>
      </div>

      <div class="p-4 flex flex-col gap-4">
        <p class="text-xs text-[var(--color-text-muted)]">
          Adjust how much of each key's edge is hidden by the bezel. The green outline on the device shows the current
          safe area.
        </p>

        <!-- Calibration pattern toggle -->
        <button
          on:click={togglePattern}
          class="w-full py-2 rounded-md text-sm font-medium transition-colors
                 {showPattern
            ? 'bg-[var(--color-warning)] text-[var(--color-surface-0)]'
            : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'}"
        >
          {showPattern ? '✓ Calibration Pattern Active' : '🎨 Show Calibration Pattern'}
        </button>

        {#if showPattern}
          <p class="text-[10px] text-[var(--color-text-muted)]">
            A grid is drawn on each key with the green outline showing the current safe area. Adjust the insets below
            until the green outline lines up with the visible edge of each key.
          </p>
        {/if}

        <!-- Inset sliders -->
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <span class={labelClass}>Top</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              bind:value={insets.top}
              on:input={applyInsets}
              class={sliderClass}
            />
            <span class={valueClass}>{insets.top}px</span>
          </div>
          <div class="flex items-center gap-2">
            <span class={labelClass}>Bottom</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              bind:value={insets.bottom}
              on:input={applyInsets}
              class={sliderClass}
            />
            <span class={valueClass}>{insets.bottom}px</span>
          </div>
          <div class="flex items-center gap-2">
            <span class={labelClass}>Left</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              bind:value={insets.left}
              on:input={applyInsets}
              class={sliderClass}
            />
            <span class={valueClass}>{insets.left}px</span>
          </div>
          <div class="flex items-center gap-2">
            <span class={labelClass}>Right</span>
            <input
              type="range"
              min="0"
              max="30"
              step="1"
              bind:value={insets.right}
              on:input={applyInsets}
              class={sliderClass}
            />
            <span class={valueClass}>{insets.right}px</span>
          </div>
        </div>

        <!-- Preview -->
        <div class="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface-0)]">
          <p class="text-[10px] text-[var(--color-text-muted)] mb-2">Preview (96×96 key canvas)</p>
          <div class="relative mx-auto" style="width: 96px; height: 96px;">
            <!-- Full key background -->
            <div class="absolute inset-0 bg-[var(--color-surface-2)] rounded-sm"></div>
            <!-- Bezel overlay (semi-transparent) -->
            <div class="absolute bg-red-900/30" style="top: 0; left: 0; right: 0; height: {insets.top}px;"></div>
            <div class="absolute bg-red-900/30" style="bottom: 0; left: 0; right: 0; height: {insets.bottom}px;"></div>
            <div class="absolute bg-red-900/30" style="top: 0; bottom: 0; left: 0; width: {insets.left}px;"></div>
            <div class="absolute bg-red-900/30" style="top: 0; bottom: 0; right: 0; width: {insets.right}px;"></div>
            <!-- Safe area outline -->
            <div
              class="absolute border-2 border-green-500"
              style="top: {insets.top}px; left: {insets.left}px; right: {insets.right}px; bottom: {insets.bottom}px;"
            ></div>
            <!-- Center label -->
            <span
              class="absolute text-[8px] text-[var(--color-text-muted)] flex items-center justify-center"
              style="top: {insets.top}px; left: {insets.left}px; right: {insets.right}px; bottom: {insets.bottom}px;"
            >
              Safe Area
            </span>
          </div>
        </div>

        <!-- Current values summary -->
        <div class="text-[10px] text-[var(--color-text-muted)] text-center">
          Safe area: {96 - insets.left - insets.right}×{96 - insets.top - insets.bottom}px (from 96×96 key)
        </div>
      </div>
    </div>
  </div>
{/if}
