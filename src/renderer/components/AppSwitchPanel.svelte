<script lang="ts">
  import { profiles } from '../stores/profile';
  import type { AppSwitchSettings, AppProfileRule, ForegroundAppInfo } from '../../shared/app-switch-types';
  import { DEFAULT_APP_SWITCH_SETTINGS } from '../../shared/app-switch-types';

  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  const { visible, onClose }: Props = $props();

  // ─── State ────────────────────────────────────────────────
  let settings = $state<AppSwitchSettings>({ ...DEFAULT_APP_SWITCH_SETTINGS });
  let currentApp = $state<ForegroundAppInfo | null>(null);
  let detectionMethod = $state<string | null>(null);
  let saving = $state(false);
  let addingRule = $state(false);
  let editingRuleId = $state<string | null>(null);
  let ruleAppName = $state('');
  let ruleProfileId = $state('');
  let appCleanup: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // ─── Load / Reload ────────────────────────────────────────
  async function loadSettings() {
    if (!window.osc) return;
    settings = await window.osc.appSwitchGetSettings();
    await refreshCurrentApp();
  }

  async function refreshCurrentApp() {
    if (!window.osc) return;
    currentApp = await window.osc.appSwitchGetCurrentApp();
    detectionMethod = await window.osc.appSwitchGetDetectionMethod();
  }

  async function saveSettings() {
    if (!window.osc) return;
    saving = true;
    try {
      await window.osc.appSwitchSetSettings(settings);
      // After saving, give the monitor a moment to start polling, then refresh
      setTimeout(() => refreshCurrentApp(), 600);
    } finally {
      saving = false;
    }
  }

  // ─── Effects ──────────────────────────────────────────────
  $effect(() => {
    if (visible) {
      loadSettings();

      // Subscribe to foreground app changes from the monitor
      if (window.osc) {
        appCleanup = window.osc.onAppSwitchAppChanged((app: ForegroundAppInfo) => {
          currentApp = app;
          detectionMethod = app.detectionMethod;
        });
      }

      // Also poll periodically while the panel is open so the indicator stays fresh
      pollTimer = setInterval(() => refreshCurrentApp(), 1000);

      return () => {
        appCleanup?.();
        appCleanup = null;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    }
  });

  // ─── Toggle ───────────────────────────────────────────────
  async function toggleEnabled() {
    settings.enabled = !settings.enabled;
    await saveSettings();
  }

  // ─── Default Profile ─────────────────────────────────────
  async function setDefaultProfile(id: string) {
    settings.defaultProfileId = id || '';
    await saveSettings();
  }

  // ─── Poll Interval ───────────────────────────────────────
  async function setPollInterval(ms: number) {
    settings.pollIntervalMs = Math.max(200, Math.min(5000, ms));
    await saveSettings();
  }

  // ─── Rules CRUD ───────────────────────────────────────────
  function startAddRule() {
    addingRule = true;
    editingRuleId = null;
    ruleAppName = currentApp?.name ?? '';
    ruleProfileId = $profiles[0]?.id ?? '';
  }

  function startEditRule(rule: AppProfileRule) {
    addingRule = false;
    editingRuleId = rule.id;
    ruleAppName = rule.appName;
    ruleProfileId = rule.profileId;
  }

  function cancelRuleEdit() {
    addingRule = false;
    editingRuleId = null;
    ruleAppName = '';
    ruleProfileId = '';
  }

  async function confirmAddRule() {
    const name = ruleAppName.trim();
    if (!name || !ruleProfileId) return;

    const newRule: AppProfileRule = {
      id: crypto.randomUUID(),
      appName: name,
      bundleId: currentApp?.name === name ? currentApp.bundleId : undefined,
      appPath: currentApp?.name === name ? currentApp.path : undefined,
      profileId: ruleProfileId
    };

    settings.rules = [...settings.rules, newRule];
    await saveSettings();
    cancelRuleEdit();
  }

  async function confirmEditRule() {
    if (!editingRuleId) return;
    const name = ruleAppName.trim();
    if (!name || !ruleProfileId) return;

    settings.rules = settings.rules.map((r) =>
      r.id === editingRuleId ? { ...r, appName: name, profileId: ruleProfileId } : r
    );
    await saveSettings();
    cancelRuleEdit();
  }

  async function deleteRule(id: string) {
    settings.rules = settings.rules.filter((r) => r.id !== id);
    await saveSettings();
  }

  function useCurrentApp() {
    if (currentApp?.name) {
      ruleAppName = currentApp.name;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (addingRule) confirmAddRule();
      else if (editingRuleId) confirmEditRule();
    } else if (e.key === 'Escape') {
      cancelRuleEdit();
    }
  }

  function getProfileName(id: string): string {
    return $profiles.find((p) => p.id === id)?.name ?? '(deleted)';
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onclick={onClose} onkeydown={() => {}}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-[520px] max-h-[80vh] bg-[var(--color-surface-1)] border border-[var(--color-border)]
             rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3.5 border-b border-[var(--color-border)]">
        <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">App Profile Switching</h2>
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

      <!-- Content (scrollable) -->
      <div class="flex-1 overflow-y-auto p-5 space-y-5">
        <!-- Current App Indicator -->
        {#if currentApp}
          <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-2)] text-xs">
            <span class="text-[var(--color-text-muted)]">Foreground app:</span>
            <span class="font-medium text-[var(--color-text-primary)]">{currentApp.name}</span>
            {#if detectionMethod}
              <span class="ml-auto text-[10px] text-[var(--color-text-muted)] opacity-60">
                via {detectionMethod}
              </span>
            {/if}
          </div>
        {:else if settings.enabled}
          <div
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)]"
          >
            <span>No foreground app detected</span>
          </div>
        {/if}

        <!-- Enable Toggle -->
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-[var(--color-text-primary)]">Auto-switch profiles</p>
            <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
              Automatically switch profiles based on the active application
            </p>
          </div>
          <button
            onclick={toggleEnabled}
            aria-label="Toggle auto-switch"
            class="relative w-10 h-5 rounded-full transition-colors {settings.enabled
              ? 'bg-[var(--color-accent)]'
              : 'bg-[var(--color-surface-3)]'}"
            disabled={saving}
          >
            <span
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
                     {settings.enabled ? 'translate-x-5' : 'translate-x-0'}"
            ></span>
          </button>
        </div>

        <!-- Default Profile -->
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
            Default profile <span class="text-[var(--color-text-muted)] font-normal">(when no rule matches)</span>
          </label>
          <select
            aria-label="Default profile"
            value={settings.defaultProfileId ?? ''}
            onchange={(e) => setDefaultProfile((e.target as HTMLSelectElement).value)}
            class="w-full px-3 py-1.5 text-sm rounded-lg border bg-[var(--color-surface-2)]
                   border-[var(--color-border)] text-[var(--color-text-primary)]
                   focus:outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">None (keep current)</option>
            {#each $profiles as profile (profile.id)}
              <option value={profile.id}>{profile.name}</option>
            {/each}
          </select>
        </div>

        <!-- Poll Interval -->
        <div>
          <!-- svelte-ignore a11y_label_has_associated_control -->
          <label class="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
            Poll interval
            <span class="text-[var(--color-text-muted)] font-normal">({settings.pollIntervalMs}ms)</span>
          </label>
          <input
            aria-label="Poll interval"
            type="range"
            min="200"
            max="3000"
            step="100"
            value={settings.pollIntervalMs}
            oninput={(e) => setPollInterval(Number((e.target as HTMLInputElement).value))}
            class="w-full accent-[var(--color-accent)]"
          />
          <div class="flex justify-between text-[10px] text-[var(--color-text-muted)] mt-0.5">
            <span>200ms (fast)</span>
            <span>3000ms (slow)</span>
          </div>
        </div>

        <!-- Rules Section -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
              Switching Rules
            </h3>
            {#if !addingRule && !editingRuleId}
              <button
                onclick={startAddRule}
                class="px-2 py-0.5 text-xs rounded font-medium transition-colors
                       bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
              >
                + Add Rule
              </button>
            {/if}
          </div>

          <!-- Add / Edit Rule Form -->
          {#if addingRule || editingRuleId}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="p-3 rounded-lg border bg-[var(--color-surface-2)] border-[var(--color-border)] mb-2 space-y-2"
              onkeydown={handleKeydown}
            >
              <div>
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class="block text-[10px] font-medium text-[var(--color-text-muted)] mb-1">Application Name</label
                >
                <div class="flex gap-1.5">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    type="text"
                    bind:value={ruleAppName}
                    autofocus
                    placeholder="e.g. Firefox, Code, OBS…"
                    class="flex-1 px-2.5 py-1 text-sm rounded border bg-[var(--color-surface-1)]
                           border-[var(--color-border)] text-[var(--color-text-primary)]
                           placeholder:text-[var(--color-text-muted)]
                           focus:outline-none focus:border-[var(--color-accent)]"
                  />
                  {#if currentApp?.name}
                    <button
                      onclick={useCurrentApp}
                      class="px-2 py-1 text-[10px] rounded font-medium transition-colors whitespace-nowrap
                             bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]
                             hover:bg-[var(--color-surface-1)] hover:text-[var(--color-text-primary)]"
                      title="Use current foreground app"
                    >
                      ← {currentApp.name}
                    </button>
                  {/if}
                </div>
              </div>

              <div>
                <!-- svelte-ignore a11y_label_has_associated_control -->
                <label class="block text-[10px] font-medium text-[var(--color-text-muted)] mb-1"
                  >Switch to Profile</label
                >
                <select
                  aria-label="Switch to profile"
                  bind:value={ruleProfileId}
                  class="w-full px-2.5 py-1 text-sm rounded border bg-[var(--color-surface-1)]
                         border-[var(--color-border)] text-[var(--color-text-primary)]
                         focus:outline-none focus:border-[var(--color-accent)]"
                >
                  {#each $profiles as profile (profile.id)}
                    <option value={profile.id}>{profile.name}</option>
                  {/each}
                </select>
              </div>

              <div class="flex items-center gap-1.5 pt-1">
                <button
                  onclick={addingRule ? confirmAddRule : confirmEditRule}
                  disabled={!ruleAppName.trim() || !ruleProfileId}
                  class="px-3 py-1 text-xs rounded font-medium transition-colors
                         bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]
                         disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {addingRule ? 'Add' : 'Save'}
                </button>
                <button
                  onclick={cancelRuleEdit}
                  class="px-3 py-1 text-xs rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}

          <!-- Rule List -->
          {#if settings.rules.length === 0}
            <div class="text-center py-6 text-xs text-[var(--color-text-muted)]">
              <p>No switching rules yet.</p>
              <p class="mt-1">Add a rule to automatically switch profiles when an app is focused.</p>
            </div>
          {:else}
            <div class="space-y-1">
              {#each settings.rules as rule (rule.id)}
                <div
                  class="group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
                         bg-[var(--color-surface-2)] hover:bg-[var(--color-surface-3)]
                         {currentApp?.name?.toLowerCase() === rule.appName.toLowerCase()
                    ? 'ring-1 ring-[var(--color-accent)]/30'
                    : ''}"
                >
                  <!-- Active indicator -->
                  {#if currentApp?.name?.toLowerCase() === rule.appName.toLowerCase()}
                    <span class="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0"></span>
                  {:else}
                    <span class="w-1.5 h-1.5 rounded-full bg-transparent shrink-0"></span>
                  {/if}

                  <!-- App Name -->
                  <span class="text-sm text-[var(--color-text-primary)] truncate min-w-0 flex-1">
                    {rule.appName}
                  </span>

                  <!-- Arrow -->
                  <span class="text-[10px] text-[var(--color-text-muted)]">→</span>

                  <!-- Profile name -->
                  <span class="text-sm text-[var(--color-accent)] truncate max-w-[140px]">
                    {getProfileName(rule.profileId)}
                  </span>

                  <!-- Actions -->
                  <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onclick={() => startEditRule(rule)}
                      class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                      title="Edit rule"
                    >
                      ✏️
                    </button>
                    <button
                      onclick={() => deleteRule(rule.id)}
                      class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                      title="Delete rule"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
