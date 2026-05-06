<script lang="ts">
  import {
    breadcrumbs,
    currentPageId,
    activeProfile,
    isOnRootPage,
    allPages,
    navigateToPage,
    navigateBack,
    createPage,
    deletePage,
    renamePage
  } from '../stores/profile';

  let showPageMenu = $state(false);
  let isCreating = $state(false);
  let editingPageId = $state<string | null>(null);
  let inputValue = $state('');
  let menuEl: HTMLDivElement | undefined = $state();

  function togglePageMenu() {
    showPageMenu = !showPageMenu;
    if (!showPageMenu) cancelEditing();
  }

  function cancelEditing() {
    isCreating = false;
    editingPageId = null;
    inputValue = '';
  }

  async function handleCreatePage() {
    const name = inputValue.trim();
    if (!name) return;
    await createPage(name);
    cancelEditing();
  }

  async function handleRenamePage() {
    if (!editingPageId) return;
    const name = inputValue.trim();
    if (!name) return;
    await renamePage(editingPageId, name);
    cancelEditing();
  }

  async function handleDeletePage(pageId: string) {
    const page = $allPages.find((p) => p.id === pageId);
    const confirmed = confirm(
      `Delete page "${page?.name ?? pageId}"? Any "Go to Page" buttons pointing here will be removed.`
    );
    if (!confirmed) return;
    await deletePage(pageId);
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      if (isCreating) handleCreatePage();
      else if (editingPageId) handleRenamePage();
    } else if (event.key === 'Escape') {
      cancelEditing();
    }
  }

  function handleClickOutside(event: MouseEvent) {
    if (menuEl && !menuEl.contains(event.target as Node)) {
      showPageMenu = false;
      cancelEditing();
    }
  }

  $effect(() => {
    if (showPageMenu) {
      document.addEventListener('click', handleClickOutside, true);
      return () => document.removeEventListener('click', handleClickOutside, true);
    }
  });
</script>

<div class="flex items-center gap-2 text-sm">
  <!-- Breadcrumb trail -->
  <nav class="flex items-center gap-1 text-[var(--color-text-muted)]">
    {#each $breadcrumbs as crumb, i (crumb.pageId)}
      {#if i > 0}
        <span class="text-[var(--color-text-muted)] opacity-50">›</span>
      {/if}
      {#if crumb.pageId === $currentPageId}
        <span class="text-[var(--color-text-primary)] font-medium">{crumb.pageName}</span>
      {:else}
        <button
          onclick={() => navigateToPage(crumb.pageId)}
          class="hover:text-[var(--color-text-secondary)] transition-colors"
        >
          {crumb.pageName}
        </button>
      {/if}
    {/each}
  </nav>

  <!-- Back button (only shown when not on root) -->
  {#if !$isOnRootPage}
    <button
      onclick={() => navigateBack()}
      class="px-1.5 py-0.5 rounded text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]
             hover:bg-[var(--color-surface-2)] transition-colors"
      title="Go back"
    >
      ← Back
    </button>
  {/if}

  <!-- Spacer -->
  <div class="flex-1"></div>

  <!-- Pages menu -->
  <div class="relative" bind:this={menuEl}>
    <button
      onclick={togglePageMenu}
      class="px-2 py-0.5 rounded text-xs font-medium transition-colors
             bg-[var(--color-surface-2)] text-[var(--color-text-muted)]
             hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-secondary)]"
    >
      Pages ({$allPages.length})
    </button>

    {#if showPageMenu}
      <div
        class="absolute right-0 top-full mt-1 w-56 rounded-lg shadow-xl border
               bg-[var(--color-surface-1)] border-[var(--color-border)] overflow-hidden z-50"
      >
        <!-- Page list -->
        <div class="max-h-48 overflow-y-auto py-1">
          {#each $allPages as page (page.id)}
            <div
              class="group flex items-center gap-1 px-2 py-1.5 text-xs transition-colors
                     {page.id === $currentPageId
                ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]'}"
            >
              {#if editingPageId === page.id}
                <!-- svelte-ignore a11y_autofocus -->
                <input
                  type="text"
                  bind:value={inputValue}
                  onkeydown={handleInputKeydown}
                  autofocus
                  class="flex-1 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-xs
                         px-2 py-0.5 rounded border border-[var(--color-accent)] outline-none"
                />
                <button onclick={handleRenamePage} class="text-[var(--color-success)]" title="Confirm">✓</button>
                <button onclick={cancelEditing} class="text-[var(--color-text-muted)]" title="Cancel">✕</button>
              {:else}
                <!-- Current page indicator -->
                <span class="w-3 text-center text-[10px]">
                  {page.id === $currentPageId ? '●' : ''}
                </span>

                <!-- Page name (click to navigate) -->
                <button
                  onclick={() => {
                    navigateToPage(page.id);
                    showPageMenu = false;
                  }}
                  class="flex-1 text-left truncate hover:text-[var(--color-text-primary)]"
                >
                  {page.name}
                  {#if page.id === $activeProfile?.rootPageId}
                    <span class="text-[var(--color-text-muted)] opacity-60 ml-1">(root)</span>
                  {/if}
                </button>

                <!-- Actions on hover -->
                <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onclick={() => {
                      editingPageId = page.id;
                      isCreating = false;
                      inputValue = page.name;
                    }}
                    class="p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                    title="Rename"
                  >
                    ✏️
                  </button>
                  {#if page.id !== $activeProfile?.rootPageId}
                    <button
                      onclick={() => handleDeletePage(page.id)}
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

        <!-- New page -->
        <div class="border-t border-[var(--color-border)] p-1.5">
          {#if isCreating}
            <div class="flex items-center gap-1">
              <!-- svelte-ignore a11y_autofocus -->
              <input
                type="text"
                bind:value={inputValue}
                onkeydown={handleInputKeydown}
                autofocus
                placeholder="Page name…"
                class="flex-1 bg-[var(--color-surface-2)] text-[var(--color-text-primary)] text-xs
                       px-2 py-1 rounded border border-[var(--color-accent)] outline-none
                       placeholder:text-[var(--color-text-muted)]"
              />
              <button
                onclick={handleCreatePage}
                class="px-2 py-1 text-xs rounded font-medium
                       bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
              >
                Add
              </button>
              <button onclick={cancelEditing} class="px-1 py-1 text-xs text-[var(--color-text-muted)]"> ✕ </button>
            </div>
          {:else}
            <button
              onclick={() => {
                isCreating = true;
                editingPageId = null;
                inputValue = '';
              }}
              class="w-full flex items-center gap-2 px-2 py-1 text-xs rounded transition-colors
                     text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]"
            >
              <span>+</span>
              <span>New Page</span>
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
