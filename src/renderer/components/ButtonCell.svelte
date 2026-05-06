<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { pressedButtons } from '../stores/device';
  import { activeFeedbacks } from '../stores/feedback';
  import type { ButtonBinding } from '../../shared/types';

  export let index: number;
  export let binding: ButtonBinding | null;
  export let isSelected: boolean;
  /** Rendered preview PNG data URI — the pixel-perfect WYSIWYG preview from KeyRenderer */
  export let previewDataUri: string | null = null;

  const dispatch = createEventDispatcher();

  // Derive action from binding (press trigger is used for page-link indicators)
  $: action = binding?.press ?? null;

  $: isPressed = $pressedButtons.has(index);
  $: hasAction = action !== null && action.type !== 'none';
  $: hasAnyBinding = binding
    ? !!(binding.press || binding.longPress || binding.doubleTap || binding.down || binding.up || binding.appearance)
    : false;
  $: isPageLink = action?.type === 'go-to-page' || action?.type === 'go-to-back';
  $: feedbackType = $activeFeedbacks.get(index) ?? null;

  // ─── Drag-and-drop state ──────────────────────────────────
  let isDragging = false;
  let isDragOver = false;

  function handleDragStart(e: DragEvent) {
    if (!hasAnyBinding) {
      e.preventDefault();
      return;
    }
    isDragging = true;
    e.dataTransfer!.effectAllowed = 'copyMove';
    e.dataTransfer!.setData('application/x-osc-button', String(index));
  }

  function handleDragEnd() {
    isDragging = false;
  }

  function handleDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('application/x-osc-button')) return;
    const fromIndex = parseInt(e.dataTransfer.getData('application/x-osc-button') || '', 10);
    if (!isNaN(fromIndex) && fromIndex === index) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = e.altKey ? 'copy' : 'move';
  }

  function handleDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('application/x-osc-button')) return;
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave() {
    isDragOver = false;
  }

  function handleDrop(e: DragEvent) {
    isDragOver = false;
    const raw = e.dataTransfer?.getData('application/x-osc-button');
    if (raw == null) return;
    const fromIndex = parseInt(raw, 10);
    if (isNaN(fromIndex) || fromIndex === index) return;
    e.preventDefault();
    const mode = e.altKey ? 'copy' : 'swap';
    dispatch('drop-binding', { fromIndex, toIndex: index, mode });
  }
</script>

<button
  draggable={hasAnyBinding}
  class="
    relative w-20 h-20 rounded-lg border-2 transition-all duration-100
    flex flex-col items-center justify-center text-center
    cursor-pointer group overflow-hidden
    {isSelected
    ? 'border-[var(--color-accent)] shadow-lg shadow-indigo-500/20'
    : isDragOver
      ? 'border-[var(--color-success)] shadow-lg shadow-green-500/30'
      : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'}
    {isPressed ? 'bg-[var(--color-accent)] scale-95' : 'bg-[var(--color-surface-0)]'}
    {isDragging ? 'opacity-40' : ''}
  "
  on:click={() => dispatch('select')}
  on:dragstart={handleDragStart}
  on:dragend={handleDragEnd}
  on:dragover={handleDragOver}
  on:dragenter={handleDragEnter}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  <!-- Button index (subtle) -->
  <span
    class="absolute top-1 left-1.5 text-[9px] text-[var(--color-text-muted)] opacity-40 group-hover:opacity-100 transition-opacity z-10"
  >
    {index + 1}
  </span>

  <!-- Page link icon (top-right) -->
  {#if action?.type === 'go-to-back'}
    <span class="absolute top-1 right-1.5 text-[9px] text-[var(--color-accent)] opacity-70 z-10">↩</span>
  {:else if action?.type === 'go-to-page'}
    <span class="absolute top-1 right-1.5 text-[9px] text-[var(--color-accent)] opacity-70 z-10">📂</span>
  {/if}

  <!-- Rendered preview image from KeyRenderer (pixel-perfect WYSIWYG) -->
  {#if previewDataUri}
    <img src={previewDataUri} alt="" class="absolute inset-0 w-full h-full rounded-md pointer-events-none" />
  {:else if !hasAnyBinding}
    <span class="text-lg text-[var(--color-text-muted)] opacity-30 group-hover:opacity-60 transition-opacity"> + </span>
  {/if}

  <!-- Trigger indicators (bottom-right) -->
  {#if hasAnyBinding}
    <span class="absolute bottom-1 right-1 flex items-center gap-0.5 z-10">
      <!-- Primary action dot -->
      {#if hasAction}
        <span class="w-1.5 h-1.5 rounded-full {isPageLink ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-accent)]'}"
        ></span>
      {/if}
      <!-- Long-press indicator -->
      {#if binding?.longPress}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] opacity-80"></span>
      {/if}
      <!-- Double-tap indicator -->
      {#if binding?.doubleTap}
        <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] opacity-80"></span>
      {/if}
    </span>
  {/if}

  <!-- Feedback overlay (showOk / showAlert) -->
  {#if feedbackType}
    <span
      class="absolute inset-0 flex items-center justify-center rounded-lg z-20 pointer-events-none feedback-overlay
             {feedbackType === 'ok' ? 'bg-green-500/30' : 'bg-yellow-500/30'}"
    >
      <span class="text-2xl">
        {feedbackType === 'ok' ? '✓' : '⚠'}
      </span>
    </span>
  {/if}
</button>
