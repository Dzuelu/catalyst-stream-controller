<script lang="ts">
  import type { PluginLayer, ImageFit } from '../../shared/types';

  export let layer: PluginLayer;
  export let pluginName: string = 'plugin';
  export let onChange: (_layer: PluginLayer) => void = () => {};

  function commitFit(fit: ImageFit) {
    onChange({ ...layer, fit });
  }
</script>

<div class="space-y-2">
  <!-- Fit mode -->
  <div>
    <label for="plugin-fit" class="block text-xs text-[var(--color-text-secondary)] mb-1">Fit Mode</label>
    <select
      id="plugin-fit"
      value={layer.fit}
      on:change={(e) => commitFit(e.currentTarget.value as ImageFit)}
      class="w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]"
    >
      <option value="contain">Contain (fit inside)</option>
      <option value="cover">Cover (fill, may crop)</option>
      <option value="stretch">Stretch (distort to fill)</option>
      <option value="none">None (original size)</option>
    </select>
  </div>

  <!-- Info -->
  <p class="text-[10px] text-[var(--color-text-muted)] leading-snug">
    Image provided at runtime by <strong>{pluginName}</strong>.
    {#if layer.pluginId}
      <span class="opacity-70">(plugin: {layer.pluginId})</span>
    {/if}
    The plugin pushes dynamic images (e.g. scene previews, status indicators) that appear in this layer.
  </p>
</div>
