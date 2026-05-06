<script lang="ts">
  import { untrack } from 'svelte';

  /**
   * Plugin Store — Browse, install, update, and manage external plugins.
   *
   * Renders as a full-screen modal overlay (same pattern as LogPanel, CalibrationPanel).
   * Talks to the main process via IPC for registry search, install, and uninstall.
   */

  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  const { visible, onClose }: Props = $props();

  // ─── Types ────────────────────────────────────────────────

  interface SearchResult {
    name: string;
    version: string;
    description: string;
    downloads: number;
    author: string;
    modified: string;
    keywords: string[];
  }

  interface InstalledEntry {
    version: string;
    source: string;
    installedAt: string;
    packageName?: string;
    /** Display name (populated for built-in plugins) */
    name?: string;
    /** Short description (populated for built-in plugins) */
    description?: string;
  }

  interface UpdateInfo {
    pluginId: string;
    currentVersion: string;
    latestVersion: string;
    packageName?: string;
  }

  interface VersionInfo {
    version: string;
    tarballUrl: string;
    published: string;
    isLatest: boolean;
  }

  interface PackageMetadata {
    name: string;
    description: string;
    versions: VersionInfo[];
    latestVersion: string;
    author: string;
    repository?: string;
    homepage?: string;
    license?: string;
  }

  // ─── State ────────────────────────────────────────────────

  /** Current view: 'browse' or 'installed' */
  let activeTab = $state<'browse' | 'installed'>('browse');
  let searchQuery = $state('');
  let searchResults = $state<SearchResult[]>([]);
  let installed = $state<Record<string, InstalledEntry>>({});
  let updates = $state<UpdateInfo[]>([]);
  let loading = $state(false);
  let error = $state('');

  /** Package selected for version details */
  let selectedPackage = $state<PackageMetadata | null>(null);
  let selectedVersion = $state('');
  let loadingVersions = $state(false);

  /** Install / uninstall in-progress tracking */
  let installingPackages = $state<Set<string>>(new Set());
  let uninstallingPlugins = $state<Set<string>>(new Set());

  /** Direct URL install */
  let showUrlInstall = $state(false);
  let urlInput = $state('');

  // ─── Lifecycle ────────────────────────────────────────────

  $effect(() => {
    if (visible) {
      // Use untrack so async calls don't add reactive dependencies
      // (doSearch reads searchQuery, which would cause re-triggering)
      untrack(() => {
        loadInstalled();
        doSearch();
      });
    }
  });

  // ─── Actions ──────────────────────────────────────────────

  async function doSearch() {
    loading = true;
    error = '';
    try {
      const results = (await window.osc.pluginStoreSearch(searchQuery || undefined)) as SearchResult[];
      searchResults = results;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Search failed';
      searchResults = [];
    } finally {
      loading = false;
    }
  }

  async function loadInstalled() {
    try {
      installed = (await window.osc.pluginStoreGetInstalled()) as Record<string, InstalledEntry>;
    } catch {
      installed = {};
    }
  }

  async function checkForUpdates() {
    try {
      updates = (await window.osc.pluginStoreCheckUpdates()) as UpdateInfo[];
    } catch {
      updates = [];
    }
  }

  async function loadVersions(packageName: string) {
    loadingVersions = true;
    try {
      const meta = (await window.osc.pluginStoreGetVersions(packageName)) as PackageMetadata | null;
      if (meta) {
        selectedPackage = meta;
        selectedVersion = meta.latestVersion;
      }
    } catch {
      selectedPackage = null;
    } finally {
      loadingVersions = false;
    }
  }

  async function installPlugin(packageName: string, version: string) {
    installingPackages = new Set([...installingPackages, packageName]);
    error = '';
    try {
      const result = await window.osc.pluginStoreInstall(packageName, version);
      if (!result.success) {
        error = result.error ?? 'Install failed';
      }
      await loadInstalled();
      await checkForUpdates();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Install failed';
    } finally {
      installingPackages = new Set([...installingPackages].filter((p) => p !== packageName));
    }
  }

  async function installFromUrl() {
    if (!urlInput.trim()) return;
    const url = urlInput.trim();
    installingPackages = new Set([...installingPackages, url]);
    error = '';
    try {
      const result = await window.osc.pluginStoreInstallUrl(url);
      if (!result.success) {
        error = result.error ?? 'Install failed';
      } else {
        urlInput = '';
        showUrlInstall = false;
      }
      await loadInstalled();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Install failed';
    } finally {
      installingPackages = new Set([...installingPackages].filter((p) => p !== url));
    }
  }

  async function uninstallPlugin(pluginId: string) {
    uninstallingPlugins = new Set([...uninstallingPlugins, pluginId]);
    error = '';
    try {
      const result = await window.osc.pluginStoreUninstall(pluginId);
      if (!result.success) {
        error = result.error ?? 'Uninstall failed';
      }
      await loadInstalled();
      selectedPackage = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Uninstall failed';
    } finally {
      uninstallingPlugins = new Set([...uninstallingPlugins].filter((p) => p !== pluginId));
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (selectedPackage) {
        selectedPackage = null;
      } else {
        onClose();
      }
    }
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      doSearch();
    }
  }

  function getInstalledVersion(packageName: string): string | undefined {
    const entry = Object.entries(installed).find(([_id, e]) => e.packageName === packageName);
    return entry?.[1]?.version;
  }

  function getUpdateForPlugin(pluginId: string): UpdateInfo | undefined {
    return updates.find((u) => u.pluginId === pluginId);
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
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
      class="w-[800px] h-[85vh] bg-[var(--color-surface-1)] border border-[var(--color-border)]
             rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
        <div class="flex items-center gap-3">
          <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">🔌 Plugin Store</h2>

          <!-- Tab switcher -->
          <div class="flex items-center gap-0.5 text-[11px] font-medium">
            <button
              onclick={() => (activeTab = 'browse')}
              class="px-2 py-1 rounded transition-colors
                     {activeTab === 'browse'
                ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              Browse
            </button>
            <button
              onclick={() => {
                activeTab = 'installed';
                loadInstalled();
              }}
              class="px-2 py-1 rounded transition-colors
                     {activeTab === 'installed'
                ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              Installed
              {#if Object.keys(installed).length > 0}
                <span class="ml-1 text-[9px] bg-[var(--color-surface-3)] px-1 rounded">
                  {Object.keys(installed).length}
                </span>
              {/if}
              {#if updates.length > 0}
                <span class="ml-1 text-[9px] bg-[var(--color-accent)] text-white px-1 rounded">
                  {updates.length} update{updates.length > 1 ? 's' : ''}
                </span>
              {/if}
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <button
            onclick={() => (showUrlInstall = !showUrlInstall)}
            class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                   bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]"
            title="Install from URL"
          >
            🔗 URL
          </button>
          <button
            onclick={() => {
              doSearch();
              loadInstalled();
              checkForUpdates();
            }}
            class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                   bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-3)]"
            title="Refresh"
          >
            ⟳
          </button>
          <button
            onclick={onClose}
            class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- URL Install bar (collapsible) -->
      {#if showUrlInstall}
        <div
          class="flex items-center gap-2 px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]"
        >
          <span class="text-[10px] text-[var(--color-text-muted)]">URL:</span>
          <input
            type="text"
            bind:value={urlInput}
            placeholder="https://github.com/user/catalyst-stream-controller-plugin-foo/releases/download/v1.0.0/plugin.tgz"
            class="flex-1 px-2 py-1 text-xs bg-[var(--color-surface-1)] text-[var(--color-text-primary)]
                   border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
            onkeydown={(e) => e.key === 'Enter' && installFromUrl()}
          />
          <button
            onclick={installFromUrl}
            disabled={!urlInput.trim() || installingPackages.has(urlInput.trim())}
            class="px-3 py-1 rounded text-[10px] font-medium transition-colors
                   bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
          >
            {installingPackages.has(urlInput.trim()) ? 'Installing...' : 'Install'}
          </button>
        </div>
      {/if}

      <!-- Error banner -->
      {#if error}
        <div class="flex items-center justify-between px-5 py-2 bg-red-500/10 border-b border-red-500/20">
          <span class="text-xs text-red-400">{error}</span>
          <button onclick={() => (error = '')} class="text-red-400 hover:text-red-300 text-xs">✕</button>
        </div>
      {/if}

      <!-- Content -->
      <div class="flex-1 overflow-y-auto">
        {#if activeTab === 'browse'}
          <!-- Search bar -->
          <div class="px-5 py-3 border-b border-[var(--color-border)]">
            <div class="flex items-center gap-2">
              <input
                type="text"
                bind:value={searchQuery}
                placeholder="Search plugins..."
                class="flex-1 px-3 py-1.5 text-xs bg-[var(--color-surface-2)] text-[var(--color-text-primary)]
                       border border-[var(--color-border)] rounded-lg focus:outline-none focus:border-[var(--color-accent)]"
                onkeydown={handleSearchKeydown}
              />
              <button
                onclick={doSearch}
                disabled={loading}
                class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
                       bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {loading ? '...' : '🔍'}
              </button>
            </div>
          </div>

          <!-- Search results -->
          {#if loading}
            <div class="flex items-center justify-center py-12 text-[var(--color-text-muted)] text-sm">
              Searching npm registry...
            </div>
          {:else if searchResults.length === 0}
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <div class="text-3xl mb-2 opacity-50">🔌</div>
              <p class="text-sm text-[var(--color-text-muted)]">
                {searchQuery ? 'No plugins found' : 'Search for plugins or browse available ones'}
              </p>
            </div>
          {:else}
            <div class="divide-y divide-[var(--color-border)]">
              {#each searchResults as result (result.name)}
                {@const installedVer = getInstalledVersion(result.name)}
                <div class="px-5 py-3 hover:bg-[var(--color-surface-2)] transition-colors">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <button
                          class="text-sm font-medium text-[var(--color-accent)] hover:underline cursor-pointer"
                          onclick={() => loadVersions(result.name)}
                        >
                          {result.name}
                        </button>
                        <span
                          class="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-1.5 rounded"
                        >
                          v{result.version}
                        </span>
                      </div>
                      <p class="text-xs text-[var(--color-text-secondary)] mt-0.5 line-clamp-2">
                        {result.description || 'No description'}
                      </p>
                      <div class="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-muted)]">
                        <span>by {result.author}</span>
                        {#if result.modified}
                          <span>{formatDate(result.modified)}</span>
                        {/if}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      {#if installedVer}
                        <span class="text-[10px] text-[var(--color-success)]">✓ v{installedVer}</span>
                        <button
                          onclick={() => loadVersions(result.name)}
                          class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                                 bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                        >
                          Manage
                        </button>
                      {:else}
                        <button
                          onclick={() => installPlugin(result.name, result.version)}
                          disabled={installingPackages.has(result.name)}
                          class="px-3 py-1 rounded text-[10px] font-medium transition-colors
                                 bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {installingPackages.has(result.name) ? 'Installing...' : 'Install'}
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Installed plugins list -->
          {#if Object.keys(installed).length === 0}
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <div class="text-3xl mb-2 opacity-50">📦</div>
              <p class="text-sm text-[var(--color-text-muted)]">No plugins installed</p>
              <p class="text-xs text-[var(--color-text-muted)] mt-1">Browse the store to find and install plugins</p>
            </div>
          {:else}
            <div class="divide-y divide-[var(--color-border)]">
              {#each Object.entries(installed) as [pluginId, entry] (pluginId)}
                {@const update = getUpdateForPlugin(pluginId)}
                {@const isBuiltIn = entry.source === 'built-in'}
                <div class="px-5 py-3 hover:bg-[var(--color-surface-2)] transition-colors">
                  <div class="flex items-start justify-between gap-3">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-[var(--color-text-primary)]">
                          {entry.name || pluginId}
                        </span>
                        <span
                          class="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-1.5 rounded"
                        >
                          v{entry.version}
                        </span>
                        {#if isBuiltIn}
                          <span
                            class="text-[10px] text-[var(--color-text-muted)] bg-[var(--color-surface-3)] px-1.5 rounded font-medium"
                            >Built-in</span
                          >
                        {:else if entry.source === 'url'}
                          <span class="text-[10px] text-[var(--color-text-muted)]">📎 URL</span>
                        {/if}
                        {#if update}
                          <span class="text-[10px] text-[var(--color-accent)] font-medium">
                            → v{update.latestVersion} available
                          </span>
                        {/if}
                      </div>
                      <div class="flex items-center gap-3 mt-1 text-[10px] text-[var(--color-text-muted)]">
                        {#if isBuiltIn && entry.description}
                          <span>{entry.description}</span>
                        {:else}
                          <span>Installed {formatDate(entry.installedAt)}</span>
                          {#if entry.packageName}
                            <span>npm: {entry.packageName}</span>
                          {/if}
                        {/if}
                      </div>
                    </div>
                    <div class="flex items-center gap-2 flex-shrink-0">
                      {#if !isBuiltIn}
                        {#if update && entry.packageName}
                          <button
                            onclick={() => installPlugin(entry.packageName!, update!.latestVersion)}
                            disabled={installingPackages.has(entry.packageName)}
                            class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                                   bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
                          >
                            {installingPackages.has(entry.packageName) ? '...' : 'Update'}
                          </button>
                        {/if}
                        {#if entry.packageName}
                          <button
                            onclick={() => loadVersions(entry.packageName!)}
                            class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                                   bg-[var(--color-surface-3)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]"
                          >
                            Versions
                          </button>
                        {/if}
                        <button
                          onclick={() => uninstallPlugin(pluginId)}
                          disabled={uninstallingPlugins.has(pluginId)}
                          class="px-2 py-1 rounded text-[10px] font-medium transition-colors
                                 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {uninstallingPlugins.has(pluginId) ? '...' : 'Uninstall'}
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- Version picker overlay -->
{#if selectedPackage}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
    onclick={() => (selectedPackage = null)}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-[500px] max-h-[70vh] bg-[var(--color-surface-1)] border border-[var(--color-border)]
             rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
        <div>
          <h3 class="text-sm font-semibold text-[var(--color-text-primary)]">{selectedPackage.name}</h3>
          <p class="text-[10px] text-[var(--color-text-muted)] mt-0.5">{selectedPackage.description}</p>
        </div>
        <button
          onclick={() => (selectedPackage = null)}
          class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          ✕
        </button>
      </div>

      <!-- Metadata -->
      <div class="px-5 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div class="flex items-center gap-4 text-[10px] text-[var(--color-text-muted)]">
          <span>Author: {selectedPackage.author}</span>
          {#if selectedPackage.license}
            <span>License: {selectedPackage.license}</span>
          {/if}
          <span>Latest: v{selectedPackage.latestVersion}</span>
        </div>
      </div>

      <!-- Version selector + install button -->
      <div class="flex items-center gap-3 px-5 py-3 border-b border-[var(--color-border)]">
        <label class="text-xs text-[var(--color-text-secondary)]" for="version-select">Version:</label>
        <select
          id="version-select"
          bind:value={selectedVersion}
          class="flex-1 px-2 py-1 text-xs bg-[var(--color-surface-2)] text-[var(--color-text-primary)]
                 border border-[var(--color-border)] rounded focus:outline-none focus:border-[var(--color-accent)]"
        >
          {#each selectedPackage.versions as ver (ver.version)}
            <option value={ver.version}>
              v{ver.version}
              {ver.isLatest ? ' (latest)' : ''}
              {ver.published ? ` — ${formatDate(ver.published)}` : ''}
            </option>
          {/each}
        </select>
        <button
          onclick={() => installPlugin(selectedPackage!.name, selectedVersion)}
          disabled={installingPackages.has(selectedPackage.name)}
          class="px-4 py-1 rounded text-xs font-medium transition-colors
                 bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-50"
        >
          {installingPackages.has(selectedPackage.name)
            ? 'Installing...'
            : getInstalledVersion(selectedPackage.name) === selectedVersion
              ? 'Reinstall'
              : getInstalledVersion(selectedPackage.name)
                ? 'Switch Version'
                : 'Install'}
        </button>
      </div>

      <!-- Version list -->
      <div class="flex-1 overflow-y-auto max-h-[40vh]">
        {#if loadingVersions}
          <div class="flex items-center justify-center py-8 text-sm text-[var(--color-text-muted)]">
            Loading versions...
          </div>
        {:else}
          <div class="divide-y divide-[var(--color-border)]">
            {#each selectedPackage.versions as ver (ver.version)}
              {@const isCurrent = getInstalledVersion(selectedPackage!.name) === ver.version}
              <button
                class="w-full px-5 py-2 text-left hover:bg-[var(--color-surface-2)] transition-colors
                       {selectedVersion === ver.version ? 'bg-[var(--color-surface-2)]' : ''}"
                onclick={() => (selectedVersion = ver.version)}
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-[var(--color-text-primary)]">v{ver.version}</span>
                    {#if ver.isLatest}
                      <span
                        class="text-[9px] bg-[var(--color-accent)]/20 text-[var(--color-accent)] px-1 rounded font-medium"
                      >
                        latest
                      </span>
                    {/if}
                    {#if isCurrent}
                      <span
                        class="text-[9px] bg-[var(--color-success)]/20 text-[var(--color-success)] px-1 rounded font-medium"
                      >
                        installed
                      </span>
                    {/if}
                  </div>
                  {#if ver.published}
                    <span class="text-[10px] text-[var(--color-text-muted)]">{formatDate(ver.published)}</span>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}
