<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ImageLayer, ImageFit } from '../../shared/types';

  export let layer: ImageLayer;
  export let onChange: (_layer: ImageLayer) => void = () => {};
  export let onInput: (_layer: ImageLayer) => void = () => {};

  const dispatch = createEventDispatcher();

  function update(fields: Partial<ImageLayer>) {
    onInput({ ...layer, ...fields });
  }

  function commit(fields: Partial<ImageLayer>) {
    onChange({ ...layer, ...fields });
  }
</script>

<div class="space-y-2">
  {#if layer.dataUri}
    <!-- Image preview -->
    <div class="flex items-start gap-3">
      <div
        class="w-16 h-16 rounded border border-[var(--color-border)] overflow-hidden flex-shrink-0 flex items-center justify-center bg-[var(--color-surface-0)]"
      >
        <img src={layer.dataUri} alt="Layer icon" class="max-w-full max-h-full object-contain" />
      </div>
      <div class="flex flex-col gap-1">
        <button
          on:click={() => dispatch('pick-icon')}
          class="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          Browse Icons
        </button>
        <button
          on:click={() => dispatch('pick-image')}
          class="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
        >
          Upload Image
        </button>
        <button
          on:click={() => dispatch('remove-image')}
          class="text-xs text-[var(--color-danger)] hover:opacity-80 transition-colors"
        >
          Remove Image
        </button>
      </div>
    </div>

    <!-- Fit mode -->
    <div>
      <label for="img-fit" class="block text-xs text-[var(--color-text-secondary)] mb-1">Fit Mode</label>
      <select
        id="img-fit"
        value={layer.fit}
        on:change={(e) => commit({ fit: e.currentTarget.value as ImageFit })}
        class="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
      >
        <option value="contain">Contain (fit inside)</option>
        <option value="cover">Cover (fill, may crop)</option>
        <option value="stretch">Stretch (distort to fill)</option>
        <option value="none">None (original size)</option>
      </select>
    </div>

    <!-- Scale -->
    <div class="flex items-center gap-2">
      <label for="img-scale" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Scale</label>
      <input
        id="img-scale"
        type="range"
        min="0.1"
        max="2"
        step="0.05"
        value={layer.scale}
        on:input={(e) => update({ scale: parseFloat(e.currentTarget.value) })}
        on:change={(e) => commit({ scale: parseFloat(e.currentTarget.value) })}
        class="flex-1 accent-[var(--color-accent)]"
      />
      <span class="text-xs text-[var(--color-text-muted)] w-10 text-right">{layer.scale.toFixed(2)}</span>
    </div>

    <!-- Offset X -->
    <div class="flex items-center gap-2">
      <label for="img-ox" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Offset X</label>
      <input
        id="img-ox"
        type="range"
        min="-48"
        max="48"
        step="1"
        value={layer.offsetX}
        on:input={(e) => update({ offsetX: parseInt(e.currentTarget.value, 10) })}
        on:change={(e) => commit({ offsetX: parseInt(e.currentTarget.value, 10) })}
        class="flex-1 accent-[var(--color-accent)]"
      />
      <span class="text-xs text-[var(--color-text-muted)] w-8 text-right">{layer.offsetX}</span>
    </div>

    <!-- Offset Y -->
    <div class="flex items-center gap-2">
      <label for="img-oy" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Offset Y</label>
      <input
        id="img-oy"
        type="range"
        min="-48"
        max="48"
        step="1"
        value={layer.offsetY}
        on:input={(e) => update({ offsetY: parseInt(e.currentTarget.value, 10) })}
        on:change={(e) => commit({ offsetY: parseInt(e.currentTarget.value, 10) })}
        class="flex-1 accent-[var(--color-accent)]"
      />
      <span class="text-xs text-[var(--color-text-muted)] w-8 text-right">{layer.offsetY}</span>
    </div>
  {:else}
    <!-- No image set -->
    <div class="flex gap-2">
      <button
        on:click={() => dispatch('pick-icon')}
        class="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed
               border-[var(--color-border)] text-[var(--color-text-muted)]
               hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
      >
        <span class="text-lg">📦</span>
        <span class="text-xs">Browse Icons</span>
      </button>
      <button
        on:click={() => dispatch('pick-image')}
        class="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed
               border-[var(--color-border)] text-[var(--color-text-muted)]
               hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
      >
        <span class="text-lg">🖼️</span>
        <span class="text-xs">Upload Image</span>
      </button>
    </div>
  {/if}
</div>
