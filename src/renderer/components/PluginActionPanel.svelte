<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PluginManifest, ParamFieldDef } from '../../shared/plugin-types';

  // ─── Props ──────────────────────────────────────────────────
  export let pluginId: string;
  export let manifest: PluginManifest;
  export let actionConfig: Record<string, unknown>;
  export let pluginState: Record<string, unknown> | null;
  export let onDirty: () => void = () => {};
  export let onActionChanged: (_actionId: string) => void = () => {};

  // ─── CSS class helpers (inherited from ActionPanel) ─────────
  const inputClass =
    'w-full bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent)]';
  const labelClass = 'block text-xs text-[var(--color-text-secondary)] mb-1';
  const sectionClass = 'text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] font-semibold mt-2 mb-1';

  // ─── Connection state (reactive to manifest/pluginId changes) ─
  $: hasConnection = !!manifest.connection;
  let connectionSettings: Record<string, unknown> = {};
  let connecting = false;
  let connectionError = '';
  let showSettings = false;

  // Dynamic options cache: queryName → options[]
  let dynamicOptions: Record<string, Array<{ value: string; label: string }>> = {};

  // ─── Plugin initialization (re-runs when pluginId changes) ──
  let _stateCleanup: (() => void) | null = null;
  let _lastInitPluginId: string | null = null;

  $: if (pluginId !== _lastInitPluginId) {
    // pluginId changed — reinitialize
    initPlugin(pluginId, manifest);
  }

  async function initPlugin(pid: string, m: PluginManifest) {
    // Clean up previous plugin subscription
    if (_stateCleanup) {
      _stateCleanup();
      _stateCleanup = null;
    }

    _lastInitPluginId = pid;

    // Reset transient state
    connectionSettings = { ...(m.connection?.defaults ?? {}) };
    connecting = false;
    connectionError = '';
    showSettings = false;
    dynamicOptions = {};

    if (!window.osc) return;

    // Load saved settings
    const saved = await window.osc.pluginGetSettings(pid);
    // Guard: pluginId may have changed while we were awaiting
    if (pid !== pluginId) return;
    if (saved && Object.keys(saved).length > 0) {
      connectionSettings = { ...(m.connection?.defaults ?? {}), ...saved };
    }

    // Get initial plugin state
    pluginState = await window.osc.pluginGetState(pid);
    if (pid !== pluginId) return;

    // Subscribe to state changes
    _stateCleanup = window.osc.onPluginStateChanged(pid, (state: Record<string, unknown>) => {
      // Only apply if this subscription is still for the active plugin
      if (pid === pluginId) {
        pluginState = state;
      }
    });

    // Auto-connect for connection-less plugins (they're always "connected")
    const connRequired = !!m.connection;
    if (!connRequired) {
      await window.osc.pluginConnect(pid, {});
      if (pid !== pluginId) return;
    }

    // Fetch dynamic options if connected
    if (pluginState && (pluginState.connected || pluginState.authenticated)) {
      await refreshDynamicOptions();
    }
  }

  onDestroy(() => {
    if (_stateCleanup) {
      _stateCleanup();
      _stateCleanup = null;
    }
  });

  // Reactively refresh dynamic options when plugin connects
  $: if (pluginState && (pluginState.connected || pluginState.authenticated)) {
    refreshDynamicOptions();
  }

  async function refreshDynamicOptions() {
    if (!window.osc) return;
    const pid = pluginId;
    const m = manifest;
    for (const action of Object.values(m.actions)) {
      if (!action.params) continue;
      for (const [key, field] of Object.entries(action.params)) {
        if (field.dynamicOptionsQuery) {
          try {
            const options = await window.osc.pluginQuery(pid, field.dynamicOptionsQuery);
            if (pid !== pluginId) return; // stale
            dynamicOptions[key] = options as Array<{ value: string; label: string }>;
          } catch {
            // Ignore query errors (plugin may not be connected)
          }
        }
      }
    }
    dynamicOptions = dynamicOptions; // Trigger reactivity
  }

  async function connect() {
    if (!window.osc) return;
    connecting = true;
    connectionError = '';
    const result = await window.osc.pluginConnect(pluginId, connectionSettings);
    connecting = false;
    if (result.success) {
      connectionError = '';
      pluginState = await window.osc.pluginGetState(pluginId);
    } else {
      connectionError = result.error || 'Connection failed';
    }
  }

  async function disconnect() {
    if (!window.osc) return;
    await window.osc.pluginDisconnect(pluginId);
    pluginState = await window.osc.pluginGetState(pluginId);
  }

  async function saveSettings() {
    if (!window.osc) return;
    await window.osc.pluginSetSettings(pluginId, connectionSettings);
  }

  // ─── Action selection ───────────────────────────────────────
  // Reactively ensure pluginAction is always a valid action for the current
  // manifest.  When the manifest changes (different plugin) or actionConfig
  // is reset, this block defaults to the first available action.
  $: {
    const actions = Object.keys(manifest.actions);
    const current = actionConfig.pluginAction as string;
    if (!current || !actions.includes(current)) {
      const first = actions[0] ?? '';
      if (first) {
        actionConfig.pluginAction = first;
        actionConfig = actionConfig; // trigger reactivity
      }
    }
  }

  $: selectedAction = (actionConfig.pluginAction as string) ?? Object.keys(manifest.actions)[0] ?? '';

  function setSelectedAction(value: string) {
    actionConfig.pluginAction = value;
    // Clear params that don't belong to the new action
    const paramKeys = Object.keys(manifest.actions[value]?.params ?? {});
    for (const key of Object.keys(actionConfig)) {
      if (key !== 'pluginAction' && !paramKeys.includes(key)) {
        delete actionConfig[key];
      }
    }
    actionConfig = actionConfig; // Trigger reactivity
    onActionChanged(value);
    onDirty();
  }

  // ─── Field value helpers ────────────────────────────────────
  function getFieldValue(field: ParamFieldDef): unknown {
    return actionConfig[field.key] ?? getDefault(field);
  }

  function setFieldValue(field: ParamFieldDef, value: unknown) {
    actionConfig[field.key] = value;
    actionConfig = actionConfig;
    onDirty();
  }

  function getDefault(field: ParamFieldDef): unknown {
    switch (field.type) {
      case 'text':
      case 'password':
        return '';
      case 'number':
      case 'range':
        return field.min ?? 0;
      case 'boolean':
        return false;
      case 'select':
        return field.options?.[0]?.value ?? '';
      case 'image':
        return '';
      default:
        return '';
    }
  }

  function getConnectionFieldValue(field: ParamFieldDef): unknown {
    return connectionSettings[field.key] ?? getDefault(field);
  }

  function setConnectionFieldValue(field: ParamFieldDef, value: unknown) {
    connectionSettings[field.key] = value;
    connectionSettings = connectionSettings;
  }

  // ─── Status display formatting ──────────────────────────────
  function formatStateValue(value: unknown, format?: string): string {
    if (value == null) return '—';
    switch (format) {
      case 'boolean-on-off':
        return value ? 'On' : 'Off';
      case 'percent':
        return `${value}%`;
      case 'text':
      default:
        return String(value);
    }
  }

  // ─── Params for current action ──────────────────────────────
  $: currentParams = Object.values(manifest.actions[selectedAction]?.params ?? {}) as ParamFieldDef[];

  // Connection-less plugins are always "connected"; others check state
  $: isConnected = !hasConnection || !!(pluginState && (pluginState.connected || pluginState.authenticated));
</script>

<!-- Connection Status Card (only shown for plugins with connection config) -->
{#if hasConnection}
  <div class="rounded-lg border border-[var(--color-border)] p-2.5 space-y-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full {isConnected ? 'bg-green-400' : 'bg-red-400'}"></span>
        <span class="text-xs text-[var(--color-text-secondary)]">
          {isConnected ? `Connected to ${manifest.name}` : 'Not connected'}
        </span>
      </div>
      {#if isConnected}
        <button on:click={disconnect} class="text-[10px] text-[var(--color-danger)] hover:opacity-80 transition-colors">
          Disconnect
        </button>
      {:else}
        <button
          on:click={connect}
          disabled={connecting}
          class="text-[10px] text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
        >
          {connecting ? 'Connecting...' : 'Connect'}
        </button>
      {/if}
    </div>

    {#if connectionError}
      <div class="rounded-md bg-red-500/10 border border-red-500/30 p-2">
        <p class="text-[11px] text-red-400 font-medium">⚠ {connectionError}</p>
      </div>
    {/if}

    <!-- Connection settings toggle -->
    <button
      on:click={() => (showSettings = !showSettings)}
      class="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
    >
      {showSettings ? '▾ Hide Settings' : '▸ Connection Settings'}
    </button>

    {#if showSettings}
      <div class="space-y-2 pt-1">
        {#each manifest.connection?.fields ?? [] as field (field.key)}
          {#if field.type === 'text' || field.type === 'password'}
            <div>
              <label for="conn-{field.key}" class={labelClass}>{field.label}</label>
              <input
                id="conn-{field.key}"
                type={field.type}
                value={getConnectionFieldValue(field)}
                on:input={(e) => setConnectionFieldValue(field, e.currentTarget.value)}
                on:blur={saveSettings}
                placeholder={field.placeholder ?? ''}
                class={inputClass}
              />
              {#if field.helpText}
                <p class="text-[10px] text-[var(--color-text-muted)] mt-1 leading-snug">{field.helpText}</p>
              {/if}
            </div>
          {:else if field.type === 'boolean'}
            <label class="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                checked={!!getConnectionFieldValue(field)}
                on:change={(e) => {
                  setConnectionFieldValue(field, e.currentTarget.checked);
                  saveSettings();
                }}
                class="rounded bg-[var(--color-surface-2)] border-[var(--color-border)]"
              />
              {field.label}
            </label>
          {:else if field.type === 'number'}
            <div>
              <label for="conn-{field.key}" class={labelClass}>{field.label}</label>
              <input
                id="conn-{field.key}"
                type="number"
                value={getConnectionFieldValue(field)}
                on:input={(e) => setConnectionFieldValue(field, Number(e.currentTarget.value))}
                on:blur={saveSettings}
                min={field.min}
                max={field.max}
                step={field.step}
                class={inputClass}
              />
            </div>
          {:else if field.type === 'select'}
            <div>
              <label for="conn-{field.key}" class={labelClass}>{field.label}</label>
              <select
                id="conn-{field.key}"
                value={getConnectionFieldValue(field)}
                on:change={(e) => {
                  setConnectionFieldValue(field, e.currentTarget.value);
                  saveSettings();
                }}
                class={inputClass}
              >
                {#each field.options ?? [] as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{/if}

<!-- Action Selector -->
<div>
  <label for="plugin-action" class={labelClass}>{manifest.name} Command</label>
  <select
    id="plugin-action"
    value={selectedAction}
    on:change={(e) => setSelectedAction(e.currentTarget.value)}
    class={inputClass}
  >
    {#each Object.entries(manifest.actions) as [value, action] (value)}
      <option {value}>{action.label}</option>
    {/each}
  </select>
</div>

<!-- Action-specific Parameter Fields -->
{#each currentParams as field (field.key)}
  {#if field.type === 'text'}
    <div>
      <label for="param-{field.key}" class={labelClass}>{field.label}</label>
      <input
        id="param-{field.key}"
        type="text"
        value={getFieldValue(field) ?? ''}
        on:input={(e) => setFieldValue(field, e.currentTarget.value)}
        placeholder={field.placeholder ?? ''}
        class={inputClass}
      />
      {#if field.helpText}
        <p class="text-[10px] text-[var(--color-text-muted)] mt-1">{field.helpText}</p>
      {/if}
    </div>
  {:else if field.type === 'password'}
    <div>
      <label for="param-{field.key}" class={labelClass}>{field.label}</label>
      <input
        id="param-{field.key}"
        type="password"
        value={getFieldValue(field) ?? ''}
        on:input={(e) => setFieldValue(field, e.currentTarget.value)}
        placeholder={field.placeholder ?? ''}
        class={inputClass}
      />
    </div>
  {:else if field.type === 'number'}
    <div>
      <label for="param-{field.key}" class={labelClass}>{field.label}</label>
      <input
        id="param-{field.key}"
        type="number"
        value={getFieldValue(field) ?? 0}
        on:input={(e) => setFieldValue(field, Number(e.currentTarget.value))}
        min={field.min}
        max={field.max}
        step={field.step}
        class={inputClass}
      />
      {#if field.helpText}
        <p class="text-[10px] text-[var(--color-text-muted)] mt-1">{field.helpText}</p>
      {/if}
    </div>
  {:else if field.type === 'boolean'}
    <div class="flex items-center gap-2">
      <label for="param-{field.key}" class="text-xs text-[var(--color-text-secondary)]">{field.label}</label>
      <select
        id="param-{field.key}"
        value={getFieldValue(field)}
        on:change={(e) => setFieldValue(field, e.currentTarget.value === 'true')}
        class="{inputClass} w-auto"
      >
        <option value={true}>Yes</option>
        <option value={false}>No</option>
      </select>
    </div>
  {:else if field.type === 'select'}
    <div>
      <label for="param-{field.key}" class={labelClass}>{field.label}</label>
      {#if dynamicOptions[field.key] && dynamicOptions[field.key].length > 0}
        <!-- Dynamic options from plugin query -->
        <select
          id="param-{field.key}"
          value={getFieldValue(field) ?? ''}
          on:change={(e) => setFieldValue(field, e.currentTarget.value)}
          class={inputClass}
        >
          <option value="">— Select —</option>
          {#each dynamicOptions[field.key] as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else if field.options && field.options.length > 0}
        <!-- Static options -->
        <select
          id="param-{field.key}"
          value={getFieldValue(field) ?? ''}
          on:change={(e) => setFieldValue(field, e.currentTarget.value)}
          class={inputClass}
        >
          {#each field.options as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      {:else}
        <!-- Fallback: text input when no options available -->
        <input
          id="param-{field.key}"
          type="text"
          value={getFieldValue(field) ?? ''}
          on:input={(e) => setFieldValue(field, e.currentTarget.value)}
          placeholder={field.placeholder ?? `${field.label} (connect to browse)`}
          class={inputClass}
        />
      {/if}
    </div>
  {:else if field.type === 'range'}
    <div>
      <label for="param-{field.key}" class={labelClass}>{field.label}</label>
      <div class="flex items-center gap-2">
        <input
          id="param-{field.key}"
          type="range"
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          value={getFieldValue(field) ?? field.min ?? 0}
          on:input={(e) => setFieldValue(field, Number(e.currentTarget.value))}
          class="flex-1 accent-[var(--color-accent)]"
        />
        <span class="text-xs text-[var(--color-text-muted)] w-12 text-right tabular-nums">
          {getFieldValue(field) ?? field.min ?? 0}{field.suffix ?? ''}
        </span>
      </div>
    </div>
  {:else if field.type === 'image'}
    <div>
      <span class={labelClass}>{field.label}</span>
      {#if getFieldValue(field)}
        <div class="flex items-center gap-2">
          <div
            class="w-10 h-10 rounded border border-[var(--color-border)] overflow-hidden flex items-center justify-center bg-[var(--color-surface-0)]"
          >
            <img src={String(getFieldValue(field))} alt={field.label} class="max-w-full max-h-full object-contain" />
          </div>
          <button
            on:click={async () => {
              const dataUri = await window.osc.pickImage();
              if (dataUri) setFieldValue(field, dataUri);
            }}
            class="text-xs text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-colors"
          >
            Change
          </button>
          <button
            on:click={() => setFieldValue(field, '')}
            class="text-xs text-[var(--color-danger)] hover:opacity-80 transition-colors"
          >
            Remove
          </button>
        </div>
      {:else}
        <button
          on:click={async () => {
            const dataUri = await window.osc.pickImage();
            if (dataUri) setFieldValue(field, dataUri);
          }}
          class="w-full flex items-center justify-center gap-2 py-2 rounded-lg border-2 border-dashed
                 border-[var(--color-border)] text-[var(--color-text-muted)]
                 hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
        >
          <span class="text-sm">🖼️</span>
          <span class="text-xs">Choose Image</span>
        </button>
      {/if}
    </div>
  {/if}
{/each}

<!-- Live Status -->
{#if isConnected && manifest.state?.display && manifest.state.display.length > 0}
  <div class="rounded-lg bg-[var(--color-surface-0)] border border-[var(--color-border)] p-2 space-y-1">
    <p class={sectionClass}>{manifest.name} Status</p>
    <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--color-text-muted)]">
      {#each manifest.state.display as field (field.key)}
        <span>
          {#if field.icon}{field.icon}
          {/if}{field.label}: {formatStateValue(pluginState?.[field.key], field.format)}
        </span>
      {/each}
    </div>
  </div>
{/if}
