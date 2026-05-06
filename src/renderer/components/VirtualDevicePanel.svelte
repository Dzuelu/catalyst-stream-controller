<script lang="ts">
  /**
   * VirtualDevicePanel — Settings panel for creating and managing virtual devices.
   *
   * List existing virtual devices, create new ones, edit, delete, and
   * open a virtual deck window for each.
   */
  import type { VirtualDeviceConfig } from '../../main/devices/virtual/VirtualDeviceConfig';

  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  const { visible, onClose }: Props = $props();

  // ─── State ────────────────────────────────────────────────
  let devices = $state<VirtualDeviceConfig[]>([]);
  let editingDevice = $state<VirtualDeviceConfig | null>(null);
  let isCreating = $state(false);
  let formError = $state('');
  let deleteConfirmId = $state<string | null>(null);

  // Form fields
  let formName = $state('Virtual Deck');
  let formRows = $state(3);
  let formColumns = $state(5);
  let formKeySize = $state(96);
  let formEncoders = $state(0);
  let formEncoderPosition = $state<'left' | 'right' | 'bottom' | 'none'>('none');
  let formSliders = $state(0);
  let formSliderPosition = $state<'left' | 'right' | 'bottom' | 'none'>('none');

  // ─── Effects ──────────────────────────────────────────────
  $effect(() => {
    if (visible) {
      loadDevices();
    }
  });

  // ─── Helpers ──────────────────────────────────────────────
  async function loadDevices() {
    if (!window.osc) return;
    devices = await window.osc.virtualDeviceGetConfigs();
  }

  function resetForm(config?: VirtualDeviceConfig) {
    formName = config?.name ?? 'Virtual Deck';
    formRows = config?.rows ?? 3;
    formColumns = config?.columns ?? 5;
    formKeySize = config?.keySize ?? 96;
    formEncoders = config?.encoders ?? 0;
    formEncoderPosition = config?.encoderPosition ?? 'none';
    formSliders = config?.sliders ?? 0;
    formSliderPosition = config?.sliderPosition ?? 'none';
    formError = '';
  }

  function startCreate() {
    resetForm();
    editingDevice = null;
    isCreating = true;
  }

  function startEdit(device: VirtualDeviceConfig) {
    resetForm(device);
    editingDevice = device;
    isCreating = true;
  }

  function cancelForm() {
    isCreating = false;
    editingDevice = null;
    formError = '';
  }

  function validateForm(): string | null {
    if (!formName.trim()) return 'Name is required';
    if (formRows < 1 || formRows > 8) return 'Rows must be 1–8';
    if (formColumns < 1 || formColumns > 12) return 'Columns must be 1–12';
    if (formKeySize < 32 || formKeySize > 256) return 'Key size must be 32–256';
    if (formEncoders < 0 || formEncoders > 6) return 'Encoders must be 0–6';
    if (formSliders < 0 || formSliders > 8) return 'Sliders must be 0–8';
    if (formEncoders > 0 && formEncoderPosition === 'none') return 'Select encoder position';
    if (formSliders > 0 && formSliderPosition === 'none') return 'Select slider position';
    return null;
  }

  async function handleSubmit() {
    const err = validateForm();
    if (err) {
      formError = err;
      return;
    }

    const config: VirtualDeviceConfig = {
      id: editingDevice?.id ?? '', // server generates on create
      name: formName.trim(),
      rows: formRows,
      columns: formColumns,
      keySize: formKeySize,
      encoders: formEncoders,
      encoderPosition: formEncoders > 0 ? formEncoderPosition : 'none',
      sliders: formSliders,
      sliderPosition: formSliders > 0 ? formSliderPosition : 'none'
    };

    try {
      if (editingDevice) {
        config.id = editingDevice.id;
        await window.osc.virtualDeviceUpdate(config);
      } else {
        await window.osc.virtualDeviceCreate(config);
      }
      isCreating = false;
      editingDevice = null;
      await loadDevices();
    } catch (e) {
      formError = `${e}`;
    }
  }

  async function handleDelete(deviceId: string) {
    try {
      await window.osc.virtualDeviceDelete(deviceId);
      deleteConfirmId = null;
      await loadDevices();
    } catch (e) {
      formError = `Delete failed: ${e}`;
    }
  }

  async function openDeck(deviceId: string) {
    await window.osc.virtualDeckOpen(deviceId);
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="vdp-overlay" onclick={onClose}>
    <div class="vdp-panel" onclick={(e) => e.stopPropagation()}>
      <!-- Header -->
      <div class="vdp-header">
        <h2>Virtual Devices</h2>
        <button class="vdp-close" onclick={onClose}>✕</button>
      </div>

      {#if isCreating}
        <!-- Create / Edit form -->
        <div class="vdp-form">
          <h3 class="vdp-form-title">{editingDevice ? 'Edit Device' : 'New Virtual Device'}</h3>

          {#if formError}
            <div class="vdp-error">{formError}</div>
          {/if}

          <div class="vdp-field">
            <label for="vdp-name">Name</label>
            <input id="vdp-name" type="text" bind:value={formName} maxlength="40" />
          </div>

          <div class="vdp-row">
            <div class="vdp-field">
              <label for="vdp-rows">Rows</label>
              <input id="vdp-rows" type="number" bind:value={formRows} min="1" max="8" />
            </div>
            <div class="vdp-field">
              <label for="vdp-cols">Columns</label>
              <input id="vdp-cols" type="number" bind:value={formColumns} min="1" max="12" />
            </div>
            <div class="vdp-field">
              <label for="vdp-keysize">Key Size</label>
              <input id="vdp-keysize" type="number" bind:value={formKeySize} min="32" max="256" step="8" />
            </div>
          </div>

          <div class="vdp-row">
            <div class="vdp-field">
              <label for="vdp-encoders">Encoders</label>
              <input id="vdp-encoders" type="number" bind:value={formEncoders} min="0" max="6" />
            </div>
            <div class="vdp-field">
              <label for="vdp-enc-pos">Encoder Position</label>
              <select id="vdp-enc-pos" bind:value={formEncoderPosition} disabled={formEncoders === 0}>
                <option value="none">None</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>
          </div>

          <div class="vdp-row">
            <div class="vdp-field">
              <label for="vdp-sliders">Sliders</label>
              <input id="vdp-sliders" type="number" bind:value={formSliders} min="0" max="8" />
            </div>
            <div class="vdp-field">
              <label for="vdp-sld-pos">Slider Position</label>
              <select id="vdp-sld-pos" bind:value={formSliderPosition} disabled={formSliders === 0}>
                <option value="none">None</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          <!-- Preview -->
          <div class="vdp-preview">
            <span class="vdp-preview-label">
              {formRows}×{formColumns} grid
              {#if formEncoders > 0}· {formEncoders} encoder{formEncoders > 1 ? 's' : ''} ({formEncoderPosition}){/if}
              {#if formSliders > 0}· {formSliders} slider{formSliders > 1 ? 's' : ''} ({formSliderPosition}){/if}
            </span>
          </div>

          <div class="vdp-form-actions">
            <button class="vdp-btn vdp-btn-secondary" onclick={cancelForm}>Cancel</button>
            <button class="vdp-btn vdp-btn-primary" onclick={handleSubmit}>
              {editingDevice ? 'Save Changes' : 'Create Device'}
            </button>
          </div>
        </div>
      {:else}
        <!-- Device list -->
        <div class="vdp-body">
          {#if devices.length === 0}
            <div class="vdp-empty">
              <p class="vdp-empty-icon">🖥️</p>
              <p>No virtual devices yet.</p>
              <p class="vdp-empty-hint">Create a software-only deck that works without physical hardware.</p>
            </div>
          {:else}
            <div class="vdp-list">
              {#each devices as device (device.id)}
                <div class="vdp-device">
                  <div class="vdp-device-info">
                    <span class="vdp-device-name">{device.name}</span>
                    <span class="vdp-device-meta">
                      {device.rows}×{device.columns}
                      {#if device.encoders > 0}· {device.encoders}E{/if}
                      {#if device.sliders > 0}· {device.sliders}S{/if}
                    </span>
                  </div>
                  <div class="vdp-device-actions">
                    {#if deleteConfirmId === device.id}
                      <button class="vdp-btn vdp-btn-danger" onclick={() => handleDelete(device.id)}>Confirm</button>
                      <button class="vdp-btn vdp-btn-secondary" onclick={() => (deleteConfirmId = null)}>Cancel</button>
                    {:else}
                      <button class="vdp-btn vdp-btn-primary" onclick={() => openDeck(device.id)}>Open</button>
                      <button class="vdp-btn vdp-btn-secondary" onclick={() => startEdit(device)}>Edit</button>
                      <button class="vdp-btn vdp-btn-secondary" onclick={() => (deleteConfirmId = device.id)}
                        >Delete</button
                      >
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <div class="vdp-footer">
            <button class="vdp-btn vdp-btn-primary" onclick={startCreate}>+ New Virtual Device</button>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .vdp-overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .vdp-panel {
    width: 480px;
    max-height: 80vh;
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .vdp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
  }

  .vdp-header h2 {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }

  .vdp-close {
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 4px;
  }

  .vdp-close:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
  }

  .vdp-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
  }

  .vdp-empty {
    text-align: center;
    padding: 24px 0;
    color: var(--color-text-muted);
    font-size: 13px;
  }

  .vdp-empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }

  .vdp-empty-hint {
    font-size: 11px;
    margin-top: 4px;
    opacity: 0.7;
  }

  .vdp-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .vdp-device {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: var(--color-surface-2);
    border-radius: 8px;
    border: 1px solid var(--color-border);
  }

  .vdp-device-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .vdp-device-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-primary);
  }

  .vdp-device-meta {
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .vdp-device-actions {
    display: flex;
    gap: 4px;
  }

  .vdp-footer {
    padding-top: 12px;
    display: flex;
    justify-content: center;
  }

  /* Form */
  .vdp-form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .vdp-form-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--color-text-primary);
    margin: 0;
  }

  .vdp-error {
    font-size: 12px;
    color: var(--color-danger);
    padding: 6px 10px;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 6px;
  }

  .vdp-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }

  .vdp-field label {
    font-size: 11px;
    color: var(--color-text-muted);
    font-weight: 500;
  }

  .vdp-field input,
  .vdp-field select {
    padding: 6px 8px;
    font-size: 13px;
    border-radius: 6px;
    border: 1px solid var(--color-border);
    background: var(--color-surface-0);
    color: var(--color-text-primary);
    outline: none;
    transition: border-color 120ms;
  }

  .vdp-field input:focus,
  .vdp-field select:focus {
    border-color: var(--color-accent);
  }

  .vdp-field input[type='number'] {
    width: 100%;
  }

  .vdp-row {
    display: flex;
    gap: 10px;
  }

  .vdp-preview {
    padding: 8px 12px;
    background: var(--color-surface-0);
    border-radius: 6px;
    border: 1px solid var(--color-border);
  }

  .vdp-preview-label {
    font-size: 11px;
    color: var(--color-text-secondary);
  }

  .vdp-form-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }

  /* Buttons */
  .vdp-btn {
    padding: 5px 12px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 120ms;
  }

  .vdp-btn-primary {
    background: var(--color-accent);
    color: white;
  }

  .vdp-btn-primary:hover {
    filter: brightness(1.1);
  }

  .vdp-btn-secondary {
    background: var(--color-surface-2);
    color: var(--color-text-secondary);
    border-color: var(--color-border);
  }

  .vdp-btn-secondary:hover {
    background: var(--color-surface-3);
    color: var(--color-text-primary);
  }

  .vdp-btn-danger {
    background: var(--color-danger);
    color: white;
  }

  .vdp-btn-danger:hover {
    filter: brightness(1.1);
  }
</style>
