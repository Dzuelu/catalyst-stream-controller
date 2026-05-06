<script lang="ts">
  import { onMount } from 'svelte';
  import { deviceInfo, isConnected, deviceCount, selectedDeviceId } from '../stores/device';
  import ProfileSwitcher from './ProfileSwitcher.svelte';
  import CalibrationPanel from './CalibrationPanel.svelte';
  import LogPanel from './LogPanel.svelte';
  import PluginStore from './PluginStore.svelte';
  import VirtualDevicePanel from './VirtualDevicePanel.svelte';
  import WebCompanionPanel from './WebCompanionPanel.svelte';

  let showCalibration = $state(false);
  let showLogs = $state(false);
  let showPluginStore = $state(false);
  let showVirtualDevices = $state(false);
  let showWebCompanion = $state(false);

  /** Brightness as a percentage 0-100 for the slider; device API takes 0-1 */
  let brightness = $state(100);

  /** Load saved brightness from backend */
  async function loadBrightness() {
    if (!window.osc || !$selectedDeviceId) return;
    const saved = await window.osc.getBrightness($selectedDeviceId);
    brightness = Math.round(saved * 100);
  }

  onMount(() => {
    loadBrightness();

    // Listen for brightness changes from button actions
    const cleanup = window.osc.onBrightnessChanged?.((value: number) => {
      brightness = value;
    });
    return () => cleanup?.();
  });

  // Reload when selected device changes
  $effect(() => {
    // Subscribe to selectedDeviceId changes
    const _id = $selectedDeviceId;
    loadBrightness();
  });

  async function handleBrightnessChange(event: Event) {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    brightness = value;
    if ($selectedDeviceId) {
      await window.osc.setBrightness(value / 100, $selectedDeviceId);
    }
  }

  /** Re-draw all keys on the device(s) using the canonical profile data.
   *  Delegates to the main process which uses binding.appearance (the
   *  layer-based source of truth) and also pushes fresh previews to the UI. */
  async function reapplyKeys() {
    if (!window.osc) return;
    await window.osc.rendererReady();
  }

  async function handleCalibrationClose() {
    showCalibration = false;
    await reapplyKeys();
  }
</script>

<footer
  class="flex items-center justify-between px-4 py-1.5 bg-[var(--color-surface-1)] border-t border-[var(--color-border)] text-xs text-[var(--color-text-muted)]"
>
  <!-- Left: connection status -->
  <div class="flex items-center gap-2">
    <span class="w-2 h-2 rounded-full {$isConnected ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-muted)]'}"
    ></span>
    <span>
      {#if $isConnected}
        {$deviceInfo?.name}
        {#if $deviceCount > 1}
          <span class="text-[var(--color-text-muted)]">• {$deviceCount} devices</span>
        {/if}
        {#if $deviceInfo?.serial}
          <span class="text-[var(--color-text-muted)]">• {$deviceInfo.serial}</span>
        {/if}
      {:else}
        Disconnected
      {/if}
    </span>
  </div>

  <!-- Center: brightness + calibration + logs -->
  <div class="flex items-center gap-3">
    {#if $isConnected}
      <div class="flex items-center gap-1.5">
        <span class="text-[10px] text-[var(--color-text-muted)]" title="Screen brightness">☀</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={brightness}
          oninput={handleBrightnessChange}
          class="brightness-slider"
          title="Screen brightness: {brightness}%"
        />
        <span class="text-[10px] text-[var(--color-text-muted)] w-7 tabular-nums">{brightness}%</span>
      </div>
      <button
        onclick={() => (showCalibration = true)}
        class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
               bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
      >
        ⚙ Calibrate Keys
      </button>
    {/if}
    <button
      onclick={() => (showLogs = true)}
      class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
             bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
    >
      📋 Logs
    </button>
    <button
      onclick={() => (showPluginStore = true)}
      class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
             bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
    >
      🔌 Plugins
    </button>
    <button
      onclick={() => (showVirtualDevices = true)}
      class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
             bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
    >
      🖥 Virtual Decks
    </button>
    <button
      onclick={() => (showWebCompanion = true)}
      class="px-2 py-0.5 rounded text-[10px] font-medium transition-colors
             bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
    >
      🌐 Web Companion
    </button>
  </div>

  <!-- Right: profile switcher -->
  <ProfileSwitcher />
</footer>

<CalibrationPanel visible={showCalibration} onClose={handleCalibrationClose} onReapplyKeys={reapplyKeys} />
<LogPanel visible={showLogs} onClose={() => (showLogs = false)} />
<PluginStore visible={showPluginStore} onClose={() => (showPluginStore = false)} />
<VirtualDevicePanel visible={showVirtualDevices} onClose={() => (showVirtualDevices = false)} />
<WebCompanionPanel visible={showWebCompanion} onClose={() => (showWebCompanion = false)} />

<style>
  .brightness-slider {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 4px;
    border-radius: 2px;
    background: var(--color-surface-3);
    outline: none;
    cursor: pointer;
  }
  .brightness-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--color-text-secondary);
    cursor: pointer;
    transition: background 0.15s;
  }
  .brightness-slider::-webkit-slider-thumb:hover {
    background: var(--color-text-primary);
  }
</style>
