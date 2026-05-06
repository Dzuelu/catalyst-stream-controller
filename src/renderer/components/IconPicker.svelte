<script lang="ts">
  import { ICON_PACKS, svgToDataUri, mergeIconPacks, type IconDefinition } from '../icons/icon-packs';
  import type { PluginIconPack } from '../../shared/plugin-types';

  interface Props {
    visible: boolean;
    pluginIconPacks?: PluginIconPack[];
    onSelect: (_dataUri: string) => void;
    onClose: () => void;
  }

  const { visible, pluginIconPacks = [], onSelect, onClose }: Props = $props();

  // ─── State ────────────────────────────────────────────────
  let activePack = $state(ICON_PACKS[0].id);
  let searchQuery = $state('');

  // ─── Derived ──────────────────────────────────────────────
  const allPacks = $derived(pluginIconPacks.length > 0 ? mergeIconPacks(pluginIconPacks) : ICON_PACKS);

  const currentPack = $derived(allPacks.find((p) => p.id === activePack) ?? allPacks[0]);

  const filteredIcons = $derived(
    searchQuery
      ? allPacks.flatMap((p) => p.icons).filter((icon) => icon.label.toLowerCase().includes(searchQuery.toLowerCase()))
      : currentPack.icons
  );

  // ─── Handlers ─────────────────────────────────────────────

  /** Rasterise an SVG to a 96×96 PNG data URI so the main-process (node-canvas) can load it.
   *  node-canvas only supports base64-encoded raster images; SVG data URIs are silently ignored. */
  function rasteriseSvg(svgMarkup: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const svgDataUri = svgToDataUri(svgMarkup);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, 96, 96);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to rasterise SVG icon'));
      img.src = svgDataUri;
    });
  }

  async function selectIcon(icon: IconDefinition) {
    try {
      const pngDataUri = await rasteriseSvg(icon.svg);
      onSelect(pngDataUri);
    } catch {
      // Fallback: pass SVG data URI directly (will show in UI but not on device)
      onSelect(svgToDataUri(icon.svg));
    }
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    onclick={onClose}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-[520px] h-[70vh] bg-[var(--color-surface-1)] border border-[var(--color-border)]
             rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Icon Library</h2>
        <button
          onclick={onClose}
          title="Close"
          class="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]
                 hover:bg-[var(--color-surface-2)] transition-colors"
        >
          <svg class="w-4 h-4" viewBox="0 0 16 16" fill="none">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- Search -->
      <div class="px-4 py-2 border-b border-[var(--color-border)]">
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search icons…"
          class="w-full px-3 py-1.5 text-sm rounded-md border bg-[var(--color-surface-2)]
                 border-[var(--color-border)] text-[var(--color-text-primary)]
                 placeholder:text-[var(--color-text-muted)]
                 focus:outline-none focus:border-[var(--color-accent)]"
        />
      </div>

      <!-- Category tabs -->
      {#if !searchQuery}
        <div class="flex gap-0.5 px-4 py-2 border-b border-[var(--color-border)] overflow-x-auto">
          {#each allPacks as pack (pack.id)}
            <button
              onclick={() => (activePack = pack.id)}
              class="px-2 py-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap
                     {activePack === pack.id
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}"
            >
              {pack.label}
              <span class="opacity-60 ml-0.5">{pack.icons.length}</span>
            </button>
          {/each}
        </div>
      {/if}

      <!-- Icon grid -->
      <div class="flex-1 overflow-y-auto p-4">
        {#if searchQuery}
          <p class="text-[10px] text-[var(--color-text-muted)] mb-2">
            {filteredIcons.length} result{filteredIcons.length !== 1 ? 's' : ''} for "{searchQuery}"
          </p>
        {/if}

        {#if filteredIcons.length === 0}
          <div class="flex items-center justify-center h-32 text-[var(--color-text-muted)] text-xs">No icons found</div>
        {:else}
          <div class="grid grid-cols-6 gap-2">
            {#each filteredIcons as icon (icon.id)}
              <button
                onclick={() => selectIcon(icon)}
                title={icon.label}
                class="flex flex-col items-center gap-1 p-2 rounded-lg border border-transparent
                       hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-2)]
                       transition-colors group cursor-pointer"
              >
                <div
                  class="w-12 h-12 rounded-md bg-[var(--color-surface-0)] border border-[var(--color-border)]
                         flex items-center justify-center p-1.5
                         group-hover:border-[var(--color-accent)] transition-colors"
                >
                  <img src={svgToDataUri(icon.svg)} alt={icon.label} class="w-full h-full object-contain" />
                </div>
                <span class="text-[9px] text-[var(--color-text-muted)] truncate w-full text-center leading-tight">
                  {icon.label}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Footer -->
      <div
        class="px-4 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)] text-center"
      >
        Click an icon to apply it to the button
      </div>
    </div>
  </div>
{/if}
