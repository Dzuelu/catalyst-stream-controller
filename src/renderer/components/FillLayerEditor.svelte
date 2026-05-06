<script lang="ts">
  import type { FillLayer } from '../../shared/types';

  export let layer: FillLayer;
  export let onChange: (_layer: FillLayer) => void = () => {};
  export let onInput: (_layer: FillLayer) => void = () => {};

  function update(color: string) {
    onInput({ ...layer, color });
  }

  function commit(color: string) {
    onChange({ ...layer, color });
  }
</script>

<div class="space-y-2">
  <div class="flex items-center gap-2">
    <label for="fill-color" class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap">Color</label>
    <input
      id="fill-color"
      type="color"
      value={layer.color}
      on:input={(e) => update(e.currentTarget.value)}
      on:change={(e) => commit(e.currentTarget.value)}
      class="w-8 h-8 rounded border border-[var(--color-border)] bg-transparent cursor-pointer"
    />
    <input
      type="text"
      value={layer.color}
      on:input={(e) => update(e.currentTarget.value)}
      on:change={(e) => commit(e.currentTarget.value)}
      class="flex-1 bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] font-mono"
    />
  </div>
</div>
