<script lang="ts">
  import type { KnobControl, KnobBinding } from '../../shared/types';
  import { createEventDispatcher } from 'svelte';
  import { lastKnobEvent } from '../stores/device';

  export let control: KnobControl;
  export let binding: KnobBinding | null = null;
  export let isSelected = false;

  const dispatch = createEventDispatcher<{ select: { knobId: string } }>();

  // Show a brief rotation indicator when this knob is rotated
  let rotationIndicator: 'cw' | 'ccw' | null = null;
  let indicatorTimeout: ReturnType<typeof setTimeout> | null = null;

  // Subscribe to the store directly to avoid reactive loop
  const unsubKnob = lastKnobEvent.subscribe((event) => {
    if (event?.knobId === control.id) {
      rotationIndicator = event.delta > 0 ? 'cw' : 'ccw';
      if (indicatorTimeout) clearTimeout(indicatorTimeout);
      indicatorTimeout = setTimeout(() => {
        rotationIndicator = null;
      }, 300);
    }
  });

  import { onDestroy } from 'svelte';
  onDestroy(unsubKnob);

  // Check if this knob has any bindings configured
  $: hasBinding = binding && (binding.rotateClockwise || binding.rotateCounterClockwise || binding.press);

  // Build a summary label from the binding
  $: summaryLabel = (() => {
    if (!binding) return '';
    // Show the CW action label if available, else CCW, else Press
    const action = binding.rotateClockwise ?? binding.rotateCounterClockwise ?? binding.press;
    return action?.label ?? '';
  })();
</script>

<button
  class="knob-cell"
  class:selected={isSelected}
  class:has-binding={hasBinding}
  class:rotating-cw={rotationIndicator === 'cw'}
  class:rotating-ccw={rotationIndicator === 'ccw'}
  on:click={() => dispatch('select', { knobId: control.id })}
  title="{control.label} knob"
>
  <!-- Knob visual -->
  <div class="knob-ring">
    <div class="knob-inner">
      <!-- Rotation arrow indicators -->
      {#if rotationIndicator === 'cw'}
        <span class="rotation-arrow">↻</span>
      {:else if rotationIndicator === 'ccw'}
        <span class="rotation-arrow">↺</span>
      {:else if summaryLabel}
        <span class="knob-label">{summaryLabel}</span>
      {:else}
        <span class="knob-dot"></span>
      {/if}
    </div>
  </div>

  <!-- Label underneath -->
  <span class="knob-name">{control.label}</span>
</button>

<style>
  .knob-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: 8px;
    border: 2px solid transparent;
    background: transparent;
    cursor: pointer;
    transition: all 0.15s ease;
    min-width: 56px;
  }

  .knob-cell:hover {
    background: var(--color-surface-2);
  }

  .knob-cell.selected {
    border-color: var(--color-accent);
    background: var(--color-surface-2);
  }

  .knob-ring {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 3px solid var(--color-border);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }

  .knob-cell.has-binding .knob-ring {
    border-color: var(--color-accent);
  }

  .knob-cell.rotating-cw .knob-ring {
    border-color: var(--color-success, #4ade80);
    box-shadow: 0 0 8px color-mix(in srgb, var(--color-success, #4ade80) 40%, transparent);
  }

  .knob-cell.rotating-ccw .knob-ring {
    border-color: var(--color-warning, #fbbf24);
    box-shadow: 0 0 8px color-mix(in srgb, var(--color-warning, #fbbf24) 40%, transparent);
  }

  .knob-inner {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-surface-1);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .knob-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-muted);
  }

  .knob-label {
    font-size: 8px;
    color: var(--color-text-secondary);
    text-align: center;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 28px;
    white-space: nowrap;
  }

  .rotation-arrow {
    font-size: 18px;
    color: var(--color-text-primary);
    animation: pulse 0.3s ease;
  }

  .knob-name {
    font-size: 9px;
    color: var(--color-text-muted);
    text-align: center;
    line-height: 1.2;
    white-space: nowrap;
  }

  @keyframes pulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.2);
    }
    100% {
      transform: scale(1);
    }
  }
</style>
