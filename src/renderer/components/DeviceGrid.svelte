<script lang="ts">
  import ButtonCell from './ButtonCell.svelte';
  import KnobCell from './KnobCell.svelte';
  import { deviceInfo } from '../stores/device';
  import {
    currentPage,
    selectedButtonIndex,
    selectedKnobId,
    selectButton,
    selectKnob,
    livePreview,
    keyPreviews,
    swapBindings
  } from '../stores/profile';
  import type { KnobControl } from '../../shared/types';

  // Reactive: rebuild grid when device info changes
  $: rows = $deviceInfo?.rows ?? 3;
  $: cols = $deviceInfo?.cols ?? 5;
  $: controls = $deviceInfo?.controls ?? [];

  // Separate button controls from knob controls
  $: buttonControls = controls.filter((c) => c.type === 'button');
  $: knobControls = controls.filter((c): c is KnobControl => c.type === 'knob');
  $: leftKnobs = knobControls.filter((k) => k.side === 'left');
  $: rightKnobs = knobControls.filter((k) => k.side === 'right');
  $: bottomKnobs = knobControls.filter((k) => k.side === 'bottom');
  $: hasKnobs = knobControls.length > 0;
  $: hasSideKnobs = leftKnobs.length > 0 || rightKnobs.length > 0;
  $: hasBottomKnobs = bottomKnobs.length > 0;
</script>

<div class="flex flex-col items-center gap-2">
  <!-- Device name -->
  <div class="text-sm text-[var(--color-text-secondary)] mb-2">
    {$deviceInfo?.name ?? 'Unknown Device'}
  </div>

  <!-- Device body: dark bezel wrapping all controls -->
  <div class="device-body">
    <!-- Main row: optional left knobs | button grid | optional right knobs -->
    <div class="device-main-row">
      {#if hasSideKnobs && leftKnobs.length > 0}
        <div class="knob-column">
          {#each leftKnobs as knob (knob.id)}
            <KnobCell
              control={knob}
              binding={$currentPage?.knobBindings?.[knob.id] ?? null}
              isSelected={$selectedKnobId === knob.id}
              on:select={(e) => selectKnob(e.detail.knobId)}
            />
          {/each}
        </div>
      {/if}

      <!-- Button grid -->
      {#if buttonControls.length > 0}
        <div class="button-grid" style="grid-template-columns: repeat({cols}, 1fr);">
          {#each buttonControls as control (control.index)}
            {#if control.type === 'button'}
              <ButtonCell
                index={control.index}
                binding={$currentPage?.bindings[control.index] ?? null}
                isSelected={$selectedButtonIndex === control.index}
                previewDataUri={$livePreview?.buttonIndex === control.index
                  ? $livePreview.dataUri
                  : ($keyPreviews.get(control.index) ?? null)}
                on:select={() => selectButton(control.index)}
                on:drop-binding={(e) => swapBindings(e.detail.fromIndex, e.detail.toIndex, e.detail.mode)}
              />
            {/if}
          {/each}
        </div>
      {/if}

      {#if hasSideKnobs && rightKnobs.length > 0}
        <div class="knob-column">
          {#each rightKnobs as knob (knob.id)}
            <KnobCell
              control={knob}
              binding={$currentPage?.knobBindings?.[knob.id] ?? null}
              isSelected={$selectedKnobId === knob.id}
              on:select={(e) => selectKnob(e.detail.knobId)}
            />
          {/each}
        </div>
      {/if}
    </div>

    <!-- Bottom knobs row (e.g. Stream Deck + encoders) -->
    {#if hasBottomKnobs}
      <div class="knob-row-bottom">
        {#each bottomKnobs as knob (knob.id)}
          <KnobCell
            control={knob}
            binding={$currentPage?.knobBindings?.[knob.id] ?? null}
            isSelected={$selectedKnobId === knob.id}
            on:select={(e) => selectKnob(e.detail.knobId)}
          />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Quick info -->
  <div class="text-xs text-[var(--color-text-muted)] mt-1">
    {rows}×{cols}{hasKnobs ? ` • ${knobControls.length} knob${knobControls.length !== 1 ? 's' : ''}` : ''} • Click to configure
    • Drag to rearrange
  </div>
</div>

<style>
  .device-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px;
    border-radius: 16px;
    background: var(--color-surface-1);
    border: 2px solid var(--color-border);
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  }

  .device-main-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .button-grid {
    display: grid;
    gap: 8px;
    padding: 8px;
    border-radius: 10px;
    background: var(--color-surface-0);
  }

  .knob-column {
    display: flex;
    flex-direction: column;
    gap: 4px;
    justify-content: space-around;
    min-height: 100%;
  }

  .knob-row-bottom {
    display: flex;
    flex-direction: row;
    gap: 8px;
    justify-content: center;
    padding-top: 4px;
    border-top: 1px solid var(--color-border);
    width: 100%;
  }
</style>
