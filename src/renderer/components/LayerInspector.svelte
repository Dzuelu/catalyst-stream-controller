<script lang="ts">
  import type { Layer } from '../../shared/types';
  import FillLayerEditor from './FillLayerEditor.svelte';
  import ImageLayerEditor from './ImageLayerEditor.svelte';
  import TextLayerEditor from './TextLayerEditor.svelte';
  import PluginLayerEditor from './PluginLayerEditor.svelte';

  export let layer: Layer;
  export let pluginName: string = 'plugin';
  export let onChange: (_layer: Layer) => void = () => {};
  export let onInput: (_layer: Layer) => void = () => {};
  export let onPickIcon: () => void = () => {};
  export let onPickImage: () => void = () => {};
  export let onRemoveImage: () => void = () => {};
  export let onDelete: () => void = () => {};
  export let onDuplicate: () => void = () => {};

  // ─── Opacity ──────────────────────────────────────────────
  function updateOpacity(value: number) {
    onInput({ ...layer, opacity: value });
  }

  function commitOpacity(value: number) {
    onChange({ ...layer, opacity: value });
  }

  // ─── Layer name ───────────────────────────────────────────
  let editingName = false;
  let nameValue = '';

  function startEditName() {
    if (layer.locked) return;
    editingName = true;
    nameValue = layer.name;
  }

  function finishEditName() {
    if (nameValue.trim() && nameValue.trim() !== layer.name) {
      onChange({ ...layer, name: nameValue.trim() });
    }
    editingName = false;
  }
</script>

<div class="space-y-3">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2 min-w-0">
      <span class="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold whitespace-nowrap">
        {layer.type}
      </span>
      <span class="text-xs text-[var(--color-text-primary)] truncate">
        {#if editingName}
          <!-- svelte-ignore a11y-autofocus -->
          <input
            type="text"
            bind:value={nameValue}
            on:blur={finishEditName}
            on:keydown={(e) => {
              if (e.key === 'Enter') finishEditName();
              if (e.key === 'Escape') {
                editingName = false;
              }
            }}
            class="bg-[var(--color-surface-2)] border border-[var(--color-accent)] rounded px-1 py-0.5 text-xs text-[var(--color-text-primary)] outline-none w-full"
            autofocus
          />
        {:else}
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <span
            class="cursor-pointer hover:text-[var(--color-accent)] transition-colors"
            on:dblclick={startEditName}
            title="Double-click to rename"
          >
            {layer.name}
          </span>
        {/if}
      </span>
    </div>
    <div class="flex items-center gap-1">
      <button
        on:click={onDuplicate}
        class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        title="Duplicate layer"
      >
        ⧉
      </button>
      <button
        on:click={onDelete}
        class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-danger)] hover:opacity-80 transition-colors"
        title="Delete layer"
      >
        ✕
      </button>
    </div>
  </div>

  <!-- Type-specific editor -->
  {#if layer.type === 'fill'}
    <FillLayerEditor {layer} {onChange} {onInput} />
  {:else if layer.type === 'text'}
    <TextLayerEditor {layer} {onChange} {onInput} />
  {:else if layer.type === 'image'}
    <ImageLayerEditor
      {layer}
      {onChange}
      {onInput}
      on:pick-icon={onPickIcon}
      on:pick-image={onPickImage}
      on:remove-image={onRemoveImage}
    />
  {:else if layer.type === 'plugin'}
    <PluginLayerEditor {layer} {pluginName} {onChange} />
  {/if}

  <!-- Common: Opacity -->
  <div class="flex items-center gap-2 pt-2 border-t border-[var(--color-border)]">
    <label for="layer-opacity" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Opacity</label>
    <input
      id="layer-opacity"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={layer.opacity}
      on:input={(e) => updateOpacity(parseFloat(e.currentTarget.value))}
      on:change={(e) => commitOpacity(parseFloat(e.currentTarget.value))}
      class="flex-1 accent-[var(--color-accent)]"
    />
    <span class="text-xs text-[var(--color-text-muted)] w-10 text-right">{Math.round(layer.opacity * 100)}%</span>
  </div>
</div>
