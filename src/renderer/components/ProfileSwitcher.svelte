<script lang="ts">
  import {
    profiles,
    activeProfileId,
    switchProfile,
    createProfile,
    deleteProfile,
    renameProfile,
    loadProfiles
  } from '../stores/profile';
  import AppSwitchPanel from './AppSwitchPanel.svelte';

  let isOpen = $state(false);
  let isCreating = $state(false);
  let editingId = $state<string | null>(null);
  let inputValue = $state('');
  let dropdownEl: HTMLDivElement | undefined = $state();
  let showAppSwitch = $state(false);

  function toggleDropdown() {
    isOpen = !isOpen;
    if (!isOpen) {
      cancelEditing();
    }
  }

  function closeDropdown() {
    isOpen = false;
    cancelEditing();
  }

  function cancelEditing() {
    isCreating = false;
    editingId = null;
    inputValue = '';
  }

  async function handleSwitch(id: string) {
    if (id === $activeProfileId) return;
    await switchProfile(id);
    closeDropdown();
  }

  function startCreating() {
    isCreating = true;
    editingId = null;
    inputValue = '';
  }

  async function confirmCreate() {
    const name = inputValue.trim();
    if (!name) return;
    const profile = await createProfile(name);
    cancelEditing();
    await switchProfile(profile.id);
    closeDropdown();
  }

  function startRenaming(id: string, currentName: string) {
    editingId = id;
    isCreating = false;
    inputValue = currentName;
  }

  async function confirmRename() {
    if (!editingId) return;
    const name = inputValue.trim();
    if (!name) return;
    await renameProfile(editingId, name);
    cancelEditing();
  }

  async function handleDelete(id: string) {
    if ($profiles.length <= 1) return;

    const profile = $profiles.find((p) => p.id === id);
    const confirmed = confirm(`Delete profile "${profile?.name ?? id}"?`);
    if (!confirmed) return;

    await deleteProfile(id);
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      if (isCreating) confirmCreate();
      else if (editingId) confirmRename();
    } else if (event.key === 'Escape') {
      cancelEditing();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (dropdownEl && !dropdownEl.contains(event.target as Node)) {
      closeDropdown();
    }
  }

  async function handleExport(id: string) {
    const result = await window.osc.exportProfile(id);
    if (result.error) {
      alert(`Export failed: ${result.error}`);
    }
  }

  async function handleImport() {
    const result = await window.osc.importProfile();
    if (result.success) {
      await loadProfiles();
    }
    if (result.errors && result.errors.length > 0) {
      alert(`Import errors:\n${result.errors.join('\n')}`);
    }
  }

  $effect(() => {
    if (isOpen) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });

  const activeProfileName = $derived($profiles.find((p) => p.id === $activeProfileId)?.name ?? '—');
</script>

<div class="relative titlebar-no-drag" bind:this={dropdownEl}>
  <!-- Trigger button -->
  <button
    onclick={toggleDropdown}
    class="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium transition-colors
           bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]
           hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]"
  >
    <span class="text-[var(--color-text-muted)]">Profile:</span>
    <span>{activeProfileName}</span>
    <svg class="w-3 h-3 transition-transform" class:rotate-180={isOpen} viewBox="0 0 12 12" fill="none">
      <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </button>

  <!-- Dropdown -->
  {#if isOpen}
    <div
      class="absolute right-0 bottom-full mb-1 w-64 rounded-lg shadow-xl border
             bg-[var(--color-surface-1)] border-[var(--color-border)] overflow-hidden z-50"
    >
      <!-- Profile list -->
      <div class="max-h-60 overflow-y-auto py-1">
        {#each $profiles as profile (profile.id)}
          <div
            class="group flex items-center gap-1 px-2 py-1.5 text-sm transition-colors
                   {profile.id === $activeProfileId
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}"
          >
            {#if editingId === profile.id}
              <!-- Rename input -->
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="text"
                bind:value={inputValue}
                onkeydown={handleInputKeydown}
                autofocus
                class="flex-1 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm
                       px-2 py-0.5 rounded border border-[var(--color-accent)] outline-none"
              />
              <button
                onclick={confirmRename}
                class="p-0.5 text-[var(--color-success)] hover:text-[var(--color-success)]/80"
                title="Confirm"
              >
                ✓
              </button>
              <button
                onclick={cancelEditing}
                class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                title="Cancel"
              >
                ✕
              </button>
            {:else}
              <!-- Active indicator -->
              <span class="w-4 text-center text-xs">
                {profile.id === $activeProfileId ? '●' : ''}
              </span>

              <!-- Profile name (clickable to switch) -->
              <button
                onclick={() => handleSwitch(profile.id)}
                class="flex-1 text-left truncate hover:text-[var(--color-text-primary)]"
              >
                {profile.name}
              </button>

              <!-- Actions (visible on hover) -->
              <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onclick={() => handleExport(profile.id)}
                  class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  title="Export"
                >
                  📤
                </button>
                <button
                  onclick={() => startRenaming(profile.id, profile.name)}
                  class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  title="Rename"
                >
                  ✏️
                </button>
                {#if $profiles.length > 1}
                  <button
                    onclick={() => handleDelete(profile.id)}
                    class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                    title="Delete"
                  >
                    🗑️
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Divider + New Profile -->
      <div class="border-t border-[var(--color-border)] p-1.5">
        {#if isCreating}
          <div class="flex items-center gap-1">
            <!-- svelte-ignore a11y_autofocus -->
            <input
              type="text"
              bind:value={inputValue}
              onkeydown={handleInputKeydown}
              autofocus
              placeholder="Profile name…"
              class="flex-1 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-sm
                     px-2 py-1 rounded border border-[var(--color-accent)] outline-none
                     placeholder:text-[var(--color-text-muted)]"
            />
            <button
              onclick={confirmCreate}
              class="px-2 py-1 text-xs rounded font-medium
                     bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
            >
              Create
            </button>
            <button
              onclick={cancelEditing}
              class="px-1.5 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            >
              ✕
            </button>
          </div>
        {:else}
          <div class="flex gap-1">
            <button
              onclick={startCreating}
              class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded transition-colors
                     text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]"
            >
              <span class="text-base">+</span>
              <span>New</span>
            </button>
            <button
              onclick={handleImport}
              class="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-sm rounded transition-colors
                     text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]"
            >
              <span class="text-base">📥</span>
              <span>Import</span>
            </button>
          </div>
          <!-- App Switch Settings Link -->
          <button
            onclick={() => {
              closeDropdown();
              showAppSwitch = true;
            }}
            class="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 mt-1 text-sm rounded transition-colors
                   text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]"
          >
            <span class="text-base">🔄</span>
            <span>App Switching…</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<AppSwitchPanel visible={showAppSwitch} onClose={() => (showAppSwitch = false)} />
