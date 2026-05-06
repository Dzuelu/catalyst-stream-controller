<script lang="ts">
  /**
   * WebCompanionPanel — Settings panel for the Web Companion server.
   *
   * Shows server status, start/stop toggle, port configuration,
   * PIN management, connection URL, QR code, and connected client count.
   */
  import { onDestroy } from 'svelte';

  interface Props {
    visible: boolean;
    onClose: () => void;
  }

  const { visible, onClose }: Props = $props();

  // ─── State ────────────────────────────────────────────────
  let running = $state(false);
  let url = $state<string | null>(null);
  let connectedClients = $state(0);
  let pin = $state('0000');
  let qrCodeDataUri = $state<string | null>(null);
  let error = $state('');
  let loading = $state(false);

  // Form fields for editing
  let editPort = $state(9120);
  let editPin = $state('0000');

  // ─── Effects ──────────────────────────────────────────────
  $effect(() => {
    if (visible) {
      loadStatus();
    }
  });

  // Listen for status changes from the main process
  const cleanupStatusListener = window.osc.onWebServerStatusChanged?.((status) => {
    running = status.running;
    url = status.url;
    connectedClients = status.connectedClients;
    pin = status.pin;
    if (!running) {
      qrCodeDataUri = null;
    }
  });

  onDestroy(() => {
    cleanupStatusListener?.();
  });

  // ─── Helpers ──────────────────────────────────────────────
  async function loadStatus() {
    if (!window.osc) return;
    try {
      const status = await window.osc.webServerGetStatus();
      running = status.running;
      url = status.url;
      connectedClients = status.connectedClients;
      pin = status.pin;
      editPort = status.port;
      editPin = status.pin;
      error = '';

      if (running) {
        await loadQrCode();
      }
    } catch (err) {
      error = String(err);
    }
  }

  async function loadQrCode() {
    if (!window.osc) return;
    qrCodeDataUri = await window.osc.webServerGetQrCode();
  }

  async function toggleServer() {
    if (!window.osc) return;
    loading = true;
    error = '';
    try {
      if (running) {
        await window.osc.webServerStop();
        qrCodeDataUri = null;
      } else {
        await window.osc.webServerStart(editPort);
        await loadQrCode();
      }
      await loadStatus();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function savePin() {
    if (!window.osc) return;
    error = '';
    try {
      await window.osc.webServerSetPin(editPin);
      await loadStatus();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

{#if visible}
  <!-- Backdrop -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center"
    onkeydown={(e) => e.key === 'Escape' && onClose()}
  >
    <!-- Panel -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="bg-[var(--color-surface-1)] rounded-xl border border-[var(--color-border)] shadow-2xl w-[480px] max-h-[85vh] overflow-y-auto"
      onkeydown={(e) => e.stopPropagation()}
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
        <div class="flex items-center gap-2">
          <span class="text-lg">🌐</span>
          <h2 class="text-base font-semibold text-[var(--color-text-primary)]">Web Companion</h2>
        </div>
        <button
          onclick={onClose}
          class="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] text-lg leading-none p-1"
        >
          ✕
        </button>
      </div>

      <!-- Content -->
      <div class="px-6 py-4 space-y-5">
        <!-- Server Status -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span
              class="w-2.5 h-2.5 rounded-full {running
                ? 'bg-[var(--color-success)] animate-pulse'
                : 'bg-[var(--color-text-muted)]'}"
            ></span>
            <span class="text-sm font-medium text-[var(--color-text-primary)]">
              {running ? 'Server Running' : 'Server Stopped'}
            </span>
            {#if running && connectedClients > 0}
              <span class="text-xs text-[var(--color-text-muted)]">
                • {connectedClients} client{connectedClients !== 1 ? 's' : ''}
              </span>
            {/if}
          </div>
          <button
            onclick={toggleServer}
            disabled={loading}
            class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                   {running
              ? 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
              : 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/30'}
                   disabled:opacity-50"
          >
            {loading ? '...' : running ? 'Stop Server' : 'Start Server'}
          </button>
        </div>

        <!-- Connection URL & QR Code -->
        {#if running && url}
          <div class="bg-[var(--color-surface-2)] rounded-lg p-4 space-y-3">
            <div>
              <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider"
                >Connection URL</span
              >
              <div
                class="mt-1 px-3 py-2 bg-[var(--color-surface-3)] rounded-md text-sm font-mono text-[var(--color-accent)] select-all"
              >
                {url}
              </div>
            </div>

            {#if qrCodeDataUri}
              <div class="flex flex-col items-center gap-2">
                <span class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider"
                  >Scan with your phone</span
                >
                <img src={qrCodeDataUri} alt="QR Code for Web Companion" class="w-48 h-48 rounded-lg" />
              </div>
            {/if}
          </div>
        {:else if !running}
          <div class="bg-[var(--color-surface-2)] rounded-lg p-4 text-center">
            <p class="text-sm text-[var(--color-text-muted)]">
              Start the server to generate a connection URL and QR code.
            </p>
          </div>
        {/if}

        <!-- Port Configuration -->
        <div>
          <label class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider" for="web-port"
            >Port</label
          >
          <div class="mt-1 flex items-center gap-2">
            <input
              id="web-port"
              type="number"
              min="1024"
              max="65535"
              bind:value={editPort}
              disabled={running}
              class="w-24 px-2 py-1.5 rounded-md text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)]
                     text-[var(--color-text-primary)] disabled:opacity-50 disabled:cursor-not-allowed
                     focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            {#if running}
              <span class="text-xs text-[var(--color-text-muted)]">Stop server to change port</span>
            {/if}
          </div>
        </div>

        <!-- PIN Configuration -->
        <div>
          <label class="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider" for="web-pin"
            >Authentication PIN</label
          >
          <p class="text-xs text-[var(--color-text-muted)] mt-0.5 mb-1.5">
            4–8 digit code required to connect from a web browser.
          </p>
          <div class="flex items-center gap-2">
            <input
              id="web-pin"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              minlength={4}
              maxlength={8}
              bind:value={editPin}
              class="w-28 px-2 py-1.5 rounded-md text-sm font-mono bg-[var(--color-surface-2)] border border-[var(--color-border)]
                     text-[var(--color-text-primary)] tracking-widest text-center
                     focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            />
            <button
              onclick={savePin}
              disabled={editPin === pin}
              class="px-3 py-1.5 rounded-md text-xs font-medium transition-colors
                     bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]
                     hover:bg-[var(--color-surface-3)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save PIN
            </button>
          </div>
        </div>

        <!-- Error display -->
        {#if error}
          <div class="bg-red-600/10 border border-red-600/20 rounded-lg px-4 py-2 text-sm text-red-400">
            {error}
          </div>
        {/if}

        <!-- Help text -->
        <div class="text-xs text-[var(--color-text-muted)] leading-relaxed border-t border-[var(--color-border)] pt-4">
          <p>
            The Web Companion lets you control your virtual devices from any browser on your local network. Open the
            connection URL on your phone or tablet, enter the PIN, and you'll have a touch-friendly controller.
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}
