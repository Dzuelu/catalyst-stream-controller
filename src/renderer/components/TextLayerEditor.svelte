<script lang="ts">
  import type { TextLayer, PositionAnchorV, PositionAnchorH } from '../../shared/types';

  export let layer: TextLayer;
  export let onChange: (_layer: TextLayer) => void = () => {};
  export let onInput: (_layer: TextLayer) => void = () => {};

  function update(fields: Partial<TextLayer>) {
    onInput({ ...layer, ...fields });
  }

  function commit(fields: Partial<TextLayer>) {
    onChange({ ...layer, ...fields });
  }

  const positions: [PositionAnchorV, PositionAnchorH][] = [
    ['top', 'left'],
    ['top', 'center'],
    ['top', 'right'],
    ['center', 'left'],
    ['center', 'center'],
    ['center', 'right'],
    ['bottom', 'left'],
    ['bottom', 'center'],
    ['bottom', 'right']
  ];
</script>

<div class="space-y-2">
  <!-- Text -->
  <div>
    <label for="text-content" class="block text-xs text-[var(--color-text-secondary)] mb-1">Text</label>
    <input
      id="text-content"
      type="text"
      value={layer.text}
      on:input={(e) => update({ text: e.currentTarget.value })}
      on:change={(e) => commit({ text: e.currentTarget.value })}
      placeholder="e.g. Mute"
      class="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
    />
  </div>

  <!-- Color + Bold -->
  <div class="flex items-center gap-2">
    <label for="text-color" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Color</label>
    <input
      id="text-color"
      type="color"
      value={layer.color}
      on:input={(e) => update({ color: e.currentTarget.value })}
      on:change={(e) => commit({ color: e.currentTarget.value })}
      class="w-7 h-7 rounded border border-[var(--color-border)] bg-transparent cursor-pointer"
    />
    <input
      type="text"
      value={layer.color}
      on:input={(e) => update({ color: e.currentTarget.value })}
      on:change={(e) => commit({ color: e.currentTarget.value })}
      class="w-20 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] font-mono"
    />
    <label class="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] ml-auto">
      <input
        type="checkbox"
        checked={layer.bold}
        on:change={(e) => commit({ bold: e.currentTarget.checked })}
        class="rounded bg-[var(--color-surface-2)] border-[var(--color-border)]"
      />
      Bold
    </label>
  </div>

  <!-- Font size -->
  <div class="flex items-center gap-2">
    <label for="text-fontsize" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Size</label>
    <input
      id="text-fontsize"
      type="range"
      min="0"
      max="36"
      step="1"
      value={layer.fontSize}
      on:input={(e) => update({ fontSize: parseInt(e.currentTarget.value, 10) })}
      on:change={(e) => commit({ fontSize: parseInt(e.currentTarget.value, 10) })}
      class="flex-1 accent-[var(--color-accent)]"
    />
    <span class="text-xs text-[var(--color-text-muted)] w-8 text-right">{layer.fontSize || 'Auto'}</span>
  </div>

  <!-- Position grid -->
  <div>
    <span class="text-xs text-[var(--color-text-secondary)] mb-1 block">Position</span>
    <div class="grid grid-cols-3 gap-1">
      {#each positions as pos (`${pos[0]}-${pos[1]}`)}
        {@const v = pos[0]}
        {@const h = pos[1]}
        <button
          class="h-7 rounded text-[10px] transition-colors {layer.positionV === v && layer.positionH === h
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]'}"
          on:click={() => commit({ positionV: v, positionH: h })}
        >
          {v === 'center' && h === 'center' ? '●' : `${v[0].toUpperCase()}${h[0].toUpperCase()}`}
        </button>
      {/each}
    </div>
  </div>
</div>
