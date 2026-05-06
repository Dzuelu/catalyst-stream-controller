<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Layer, LayerType } from '../../shared/types';
  import { MAX_LAYERS } from '../../shared/types';

  export let layers: Layer[] = [];
  export let selectedLayerId: string | null = null;
  export let hasPluginAction: boolean = false;

  const dispatch = createEventDispatcher();

  // Display in reverse order: top of list = highest z-order (drawn last)
  $: displayLayers = [...layers].reverse();
  $: atMaxLayers = layers.length >= MAX_LAYERS;

  let showAddMenu = false;

  // ─── Drag state ───────────────────────────────────────────
  let dragLayerId: string | null = null;
  let dragOverLayerId: string | null = null;

  // ─── Actions ──────────────────────────────────────────────

  function handleSelect(layerId: string) {
    dispatch('select', layerId);
  }

  function toggleVisibility(e: Event, layerId: string) {
    e.stopPropagation();
    dispatch('toggle-visibility', layerId);
  }

  function toggleLock(e: Event, layerId: string) {
    e.stopPropagation();
    dispatch('toggle-lock', layerId);
  }

  function addLayer(type: LayerType) {
    showAddMenu = false;
    dispatch('add', type);
  }

  // ─── Drag handlers ───────────────────────────────────────

  function handleDragStart(e: DragEvent, layerId: string) {
    dragLayerId = layerId;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('application/x-osc-layer', layerId);
  }

  function handleDragOver(e: DragEvent, layerId: string) {
    if (!dragLayerId || dragLayerId === layerId) return;
    e.preventDefault();
    dragOverLayerId = layerId;
  }

  function handleDragEnter(e: DragEvent, layerId: string) {
    if (!dragLayerId || dragLayerId === layerId) return;
    e.preventDefault();
    dragOverLayerId = layerId;
  }

  function handleDragLeave() {
    dragOverLayerId = null;
  }

  function handleDrop(e: DragEvent, targetLayerId: string) {
    e.preventDefault();
    dragOverLayerId = null;
    if (!dragLayerId || dragLayerId === targetLayerId) return;

    // Convert from display (reversed) to array indices
    const fromIdx = layers.findIndex((l) => l.id === dragLayerId);
    const toIdx = layers.findIndex((l) => l.id === targetLayerId);
    if (fromIdx !== -1 && toIdx !== -1) {
      dispatch('reorder', { fromIndex: fromIdx, toIndex: toIdx });
    }
    dragLayerId = null;
  }

  function handleDragEnd() {
    dragLayerId = null;
    dragOverLayerId = null;
  }

  function closeAddMenu(e: MouseEvent) {
    // Close if click is outside the add menu
    const target = e.target as HTMLElement;
    if (!target.closest('.add-menu-container')) {
      showAddMenu = false;
    }
  }
</script>

<svelte:window on:click={closeAddMenu} />

<div class="space-y-1">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold">Layers</span>
    <div class="relative add-menu-container">
      <button
        on:click|stopPropagation={() => (showAddMenu = !showAddMenu)}
        disabled={atMaxLayers}
        class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-accent)]
               hover:bg-[var(--color-surface-3)] transition-colors
               disabled:opacity-40 disabled:cursor-not-allowed"
      >
        + Add ▾
      </button>
      {#if showAddMenu}
        <div
          class="absolute right-0 top-full mt-1 z-20 bg-[var(--color-surface-2)] border border-[var(--color-border)]
                 rounded-md shadow-lg py-1 min-w-[140px]"
        >
          <button
            class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
            on:click={() => addLayer('fill')}
          >
            Fill
          </button>
          <button
            class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
            on:click={() => addLayer('image')}
          >
            Image
          </button>
          <button
            class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
            on:click={() => addLayer('text')}
          >
            Text
          </button>
          {#if hasPluginAction}
            <button
              class="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-3)] transition-colors"
              on:click={() => addLayer('plugin')}
            >
              Plugin Image
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- Layer list -->
  <div class="rounded-lg border border-[var(--color-border)] overflow-hidden bg-[var(--color-surface-0)]">
    {#if displayLayers.length === 0}
      <div class="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">No layers</div>
    {:else}
      {#each displayLayers as layer (layer.id)}
        <!-- svelte-ignore a11y-no-static-element-interactions a11y-click-events-have-key-events -->
        <div
          class="flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors group
                 {selectedLayerId === layer.id
            ? 'bg-[var(--color-accent)]/10 border-l-2 border-l-[var(--color-accent)]'
            : 'border-l-2 border-l-transparent hover:bg-[var(--color-surface-1)]'}
                 {dragOverLayerId === layer.id
            ? 'bg-[var(--color-success)]/10 border-t-2 border-t-[var(--color-success)]'
            : 'border-t border-t-[var(--color-border)]'}
                 {dragLayerId === layer.id ? 'opacity-40' : ''}"
          on:click={() => handleSelect(layer.id)}
          draggable="true"
          on:dragstart={(e) => handleDragStart(e, layer.id)}
          on:dragover={(e) => handleDragOver(e, layer.id)}
          on:dragenter={(e) => handleDragEnter(e, layer.id)}
          on:dragleave={handleDragLeave}
          on:drop={(e) => handleDrop(e, layer.id)}
          on:dragend={handleDragEnd}
        >
          <!-- Visibility toggle -->
          <button
            class="text-[11px] w-5 h-5 flex items-center justify-center rounded transition-colors
                   {layer.visible
              ? 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] opacity-40 hover:opacity-70'}"
            on:click={(e) => toggleVisibility(e, layer.id)}
            title={layer.visible ? 'Hide layer' : 'Show layer'}
          >
            {layer.visible ? '👁' : '👁'}
          </button>

          <!-- Lock toggle -->
          <button
            class="text-[11px] w-5 h-5 flex items-center justify-center rounded transition-colors
                   {layer.locked
              ? 'text-[var(--color-warning)]'
              : 'text-[var(--color-text-muted)] opacity-30 hover:opacity-70'}"
            on:click={(e) => toggleLock(e, layer.id)}
            title={layer.locked ? 'Unlock layer' : 'Lock layer'}
          >
            {layer.locked ? '🔒' : '🔓'}
          </button>

          <!-- Name -->
          <span
            class="flex-1 text-xs truncate {layer.visible
              ? 'text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] line-through'}"
          >
            {layer.name}
          </span>

          <!-- Type badge -->
          <span class="text-[9px] text-[var(--color-text-muted)] uppercase tracking-wider px-1">
            {layer.type}
          </span>

          <!-- Drag handle -->
          <span
            class="text-[var(--color-text-muted)] opacity-30 group-hover:opacity-70 cursor-grab text-sm select-none"
            title="Drag to reorder"
          >
            ≡
          </span>
        </div>
      {/each}
    {/if}
  </div>

  {#if layers.length > 0}
    <p class="text-[9px] text-[var(--color-text-muted)] text-center">
      Top = front · Bottom = back · {layers.length}/{MAX_LAYERS} layers
    </p>
  {/if}
</div>
