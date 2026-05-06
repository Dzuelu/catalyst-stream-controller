<script lang="ts">
  import type { LogEntry } from '../../shared/log-types';

  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  const { visible, onClose }: Props = $props();

  // ─── State ────────────────────────────────────────────────
  let entries = $state<LogEntry[]>([]);
  let filterLevel = $state<'all' | 'info' | 'warn' | 'error'>('all');
  let searchQuery = $state('');
  let autoScroll = $state(true);
  let copied = $state(false);
  let logCleanup: (() => void) | null = null;
  let scrollContainer: HTMLDivElement | undefined = $state();

  // ─── Derived ──────────────────────────────────────────────
  const filteredEntries = $derived(
    entries.filter((e) => {
      if (filterLevel !== 'all' && e.level !== filterLevel) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q);
      }
      return true;
    })
  );

  const counts = $derived({
    info: entries.filter((e) => e.level === 'info').length,
    warn: entries.filter((e) => e.level === 'warn').length,
    error: entries.filter((e) => e.level === 'error').length
  });

  // ─── Effects ──────────────────────────────────────────────
  $effect(() => {
    if (visible) {
      loadEntries();

      if (window.osc) {
        logCleanup = window.osc.onLogEntry((entry: LogEntry) => {
          entries = [...entries, entry];
          if (autoScroll) {
            requestAnimationFrame(scrollToBottom);
          }
        });
      }

      return () => {
        logCleanup?.();
        logCleanup = null;
      };
    }
  });

  // ─── Actions ──────────────────────────────────────────────
  async function loadEntries() {
    if (!window.osc) return;
    entries = await window.osc.logGetEntries();
    requestAnimationFrame(scrollToBottom);
  }

  async function clearLogs() {
    if (!window.osc) return;
    await window.osc.logClear();
    entries = [];
  }

  async function copyLogs() {
    const text = filteredEntries
      .map((e) => {
        const time = formatTime(e.timestamp);
        const level = levelBadge(e.level);
        const src = e.source ? ` [${e.source}]` : '';
        return `${time} ${level}${src} ${e.message.replace(`[${e.source}] `, '')}`;
      })
      .join('\n');
    await navigator.clipboard.writeText(text);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function scrollToBottom() {
    if (scrollContainer) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }
  }

  function handleScroll() {
    if (!scrollContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
    // Auto-scroll is on if the user is near the bottom
    autoScroll = scrollHeight - scrollTop - clientHeight < 40;
  }

  function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function levelColor(level: LogEntry['level']): string {
    switch (level) {
      case 'warn':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-[var(--color-text-muted)]';
    }
  }

  function levelBadge(level: LogEntry['level']): string {
    switch (level) {
      case 'warn':
        return 'WRN';
      case 'error':
        return 'ERR';
      default:
        return 'INF';
    }
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
      class="w-[720px] h-[80vh] bg-[var(--color-surface-1)] border border-[var(--color-border)]
             rounded-xl shadow-2xl flex flex-col overflow-hidden"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Application Logs</h2>
        <div class="flex items-center gap-2">
          <!-- Level filter buttons -->
          <div class="flex items-center gap-0.5 text-[10px] font-medium">
            <button
              onclick={() => (filterLevel = 'all')}
              class="px-1.5 py-0.5 rounded transition-colors
                     {filterLevel === 'all'
                ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              All
            </button>
            <button
              onclick={() => (filterLevel = 'info')}
              class="px-1.5 py-0.5 rounded transition-colors
                     {filterLevel === 'info'
                ? 'bg-blue-500/20 text-blue-400'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              Info {counts.info}
            </button>
            <button
              onclick={() => (filterLevel = 'warn')}
              class="px-1.5 py-0.5 rounded transition-colors
                     {filterLevel === 'warn'
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              Warn {counts.warn}
            </button>
            <button
              onclick={() => (filterLevel = 'error')}
              class="px-1.5 py-0.5 rounded transition-colors
                     {filterLevel === 'error'
                ? 'bg-red-500/20 text-red-400'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}"
            >
              Error {counts.error}
            </button>
          </div>

          <!-- Search -->
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Filter…"
            aria-label="Filter logs"
            class="w-32 px-2 py-0.5 text-[11px] rounded border bg-[var(--color-surface-2)]
                   border-[var(--color-border)] text-[var(--color-text-primary)]
                   placeholder:text-[var(--color-text-muted)]
                   focus:outline-none focus:border-[var(--color-accent)]"
          />

          <!-- Copy -->
          <button
            onclick={copyLogs}
            title="Copy logs to clipboard"
            class="px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors
                   {copied
              ? 'text-green-400'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}
                   hover:bg-[var(--color-surface-2)]"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>

          <!-- Clear -->
          <button
            onclick={clearLogs}
            title="Clear logs"
            class="px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors
                   text-[var(--color-text-muted)] hover:text-[var(--color-danger)]
                   hover:bg-[var(--color-surface-2)]"
          >
            Clear
          </button>

          <!-- Close -->
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
      </div>

      <!-- Log entries -->
      <div
        bind:this={scrollContainer}
        onscroll={handleScroll}
        class="flex-1 overflow-y-auto font-mono text-[11px] leading-[1.6] select-text cursor-text"
      >
        {#if filteredEntries.length === 0}
          <div class="flex items-center justify-center h-full text-[var(--color-text-muted)] text-xs">
            {searchQuery ? 'No matching log entries' : 'No log entries yet'}
          </div>
        {:else}
          <table class="w-full">
            <tbody>
              {#each filteredEntries as entry (entry.id)}
                <tr class="hover:bg-[var(--color-surface-2)]/50 border-b border-[var(--color-border)]/30">
                  <!-- Time -->
                  <td class="px-2 py-0.5 text-[var(--color-text-muted)] whitespace-nowrap align-top w-[60px]">
                    {formatTime(entry.timestamp)}
                  </td>
                  <!-- Level -->
                  <td class="px-1 py-0.5 whitespace-nowrap align-top w-[32px] {levelColor(entry.level)}">
                    {levelBadge(entry.level)}
                  </td>
                  <!-- Source -->
                  {#if entry.source}
                    <td class="px-1 py-0.5 text-[var(--color-accent)] whitespace-nowrap align-top w-[100px] truncate">
                      {entry.source}
                    </td>
                  {:else}
                    <td class="px-1 py-0.5 w-[100px]"></td>
                  {/if}
                  <!-- Message -->
                  <td class="px-2 py-0.5 text-[var(--color-text-secondary)] break-all whitespace-pre-wrap">
                    {entry.source ? entry.message.replace(`[${entry.source}] `, '') : entry.message}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Footer status -->
      <div
        class="flex items-center justify-between px-4 py-1.5 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-muted)]"
      >
        <span>
          {filteredEntries.length}{filteredEntries.length !== entries.length ? ` / ${entries.length}` : ''} entries
        </span>
        <button
          onclick={() => {
            autoScroll = true;
            scrollToBottom();
          }}
          class="px-1.5 py-0.5 rounded transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text-secondary)]
                 {autoScroll ? 'text-[var(--color-accent)]' : ''}"
          title="Scroll to bottom"
        >
          ↓ {autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
        </button>
      </div>
    </div>
  </div>
{/if}
