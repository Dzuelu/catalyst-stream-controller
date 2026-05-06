<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import DeviceGrid from './components/DeviceGrid.svelte';
  import ActionPanel from './components/ActionPanel.svelte';
  import PageBar from './components/PageBar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import VirtualDeckApp from './components/virtual-deck/VirtualDeckApp.svelte';
  import {
    initDeviceListeners,
    isConnected,
    connectedDevices,
    selectedDeviceId,
    setOnFirstDeviceConnected
  } from './stores/device';
  import {
    loadProfiles,
    initProfileListener,
    selectedButtonIndex,
    selectedKnobId,
    setCurrentDeviceKey,
    clearSelection
  } from './stores/profile';
  import { initFeedbackListener } from './stores/feedback';

  // ─── Hash routing ───────────────────────────────────────────
  let hashRoute = $state(window.location.hash);

  function onHashChange() {
    hashRoute = window.location.hash;
  }

  const isVirtualDeck = $derived(hashRoute.startsWith('#virtual-deck/'));
  const virtualDeckDeviceId = $derived(
    isVirtualDeck ? decodeURIComponent(hashRoute.replace('#virtual-deck/', '')) : null
  );

  // ─── Main app lifecycle (only when NOT a virtual deck window) ─
  let cleanupDevice: (() => void) | null = null;
  let cleanupProfile: (() => void) | null = null;
  let cleanupFeedback: (() => void) | null = null;

  /** Switch to a different device — load its profile/page/previews */
  async function switchDevice(deviceId: string) {
    console.debug(`[UI:switchDevice] deviceId="${deviceId}"`);
    selectedDeviceId.set(deviceId);
    clearSelection();

    // Get the device key (serial or ID) and load its state
    const devices = await window.osc.getConnectedDevices();
    const dev = devices.find((d) => d.id === deviceId);
    const dKey = dev?.serial || deviceId;
    console.debug(`[UI:switchDevice] resolved dKey="${dKey}"`);
    await setCurrentDeviceKey(dKey);

    // Signal main process to push key previews for this device
    await window.osc.rendererReady();
  }

  onMount(async () => {
    if (isVirtualDeck) return; // Virtual deck handles its own init

    // Set up callback for when the first device connects after app start
    setOnFirstDeviceConnected(async (info) => {
      const dKey = info.serial || info.id;
      await setCurrentDeviceKey(dKey);
      await loadProfiles();
      await window.osc.rendererReady();
    });

    cleanupDevice = initDeviceListeners();
    cleanupProfile = initProfileListener();
    cleanupFeedback = initFeedbackListener();

    // Initialize the device key for the first connected device
    const devices = await window.osc.getConnectedDevices();
    if (devices.length > 0) {
      const firstDev = devices[0];
      const dKey = firstDev.serial || firstDev.id;
      await setCurrentDeviceKey(dKey);
    }

    await loadProfiles();
    // Signal main process that the renderer is ready to receive push events.
    // This triggers key preview rendering for the current page, fixing the race
    // where the device may have connected before the renderer was listening.
    await window.osc.rendererReady();
  });

  onDestroy(() => {
    cleanupDevice?.();
    cleanupProfile?.();
    cleanupFeedback?.();
  });
</script>

<svelte:window onhashchange={onHashChange} />

{#if isVirtualDeck && virtualDeckDeviceId}
  <VirtualDeckApp deviceId={virtualDeckDeviceId} />
{:else}
  <div class="flex flex-col h-screen">
    <!-- Titlebar drag region (macOS frameless) -->
    <div class="titlebar-drag flex items-center px-4 bg-[var(--color-surface-1)] border-b border-[var(--color-border)]">
      <span class="text-sm font-semibold text-[var(--color-text-secondary)] pl-20"> Catalyst Stream Controller </span>
    </div>

    <!-- Main content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Device grid (center area) -->
      <main class="flex-1 flex flex-col items-center justify-center p-8">
        {#if $isConnected}
          <!-- Device selector tabs (visible when multiple devices connected) -->
          {#if $connectedDevices.size > 1}
            <div class="flex items-center gap-1 mb-3">
              {#each [...$connectedDevices.values()] as dev (dev.id)}
                <button
                  class="px-3 py-1 rounded-md text-xs font-medium transition-colors
                       {$selectedDeviceId === dev.id
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)]'}"
                  onclick={() => switchDevice(dev.id)}
                >
                  {dev.name}
                  {#if dev.serial}
                    <span class="opacity-60 ml-1">({dev.serial.slice(-4)})</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          <!-- Page breadcrumb / navigation bar -->
          <div class="w-full max-w-lg mb-4">
            <PageBar />
          </div>
          <DeviceGrid />
        {:else}
          <div class="text-center">
            <div class="text-6xl mb-4">🎛️</div>
            <h2 class="text-xl font-semibold text-[var(--color-text-primary)] mb-2">No Device Connected</h2>
            <p class="text-[var(--color-text-secondary)] max-w-md">
              Connect a Loupdeck or Elgato Stream Controller via USB. It will be detected automatically.
            </p>
            <div class="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span class="inline-block w-2 h-2 rounded-full bg-[var(--color-warning)] animate-pulse"></span>
              Waiting for device...
            </div>
          </div>
        {/if}
      </main>

      <!-- Action panel (right sidebar) — always visible when connected -->
      {#if $isConnected}
        <aside
          class="w-80 flex-shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface-1)] overflow-y-auto"
        >
          {#if $selectedButtonIndex !== null || $selectedKnobId !== null}
            <ActionPanel />
          {:else}
            <div class="h-full flex flex-col items-center justify-center p-6 text-center">
              <div class="text-4xl mb-3 opacity-60">🎛️</div>
              <p class="text-sm font-medium text-[var(--color-text-secondary)] mb-1">No Button Selected</p>
              <p class="text-xs text-[var(--color-text-muted)] leading-relaxed">
                Click a button or knob on the grid to configure its actions.
              </p>
            </div>
          {/if}
        </aside>
      {/if}
    </div>

    <!-- Status bar -->
    <StatusBar />
  </div>
{/if}
