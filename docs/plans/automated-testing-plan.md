# Automated Testing — Architecture Plan

## 1. Why Now

The project has strong static analysis (`typecheck` + `svelte-check` + `eslint`)
but **zero automated tests**. Before the plugin system refactor — which touches
every layer of the app — we need a safety net that verifies:

- Action dispatch routes to the correct integration client
- Profile data loads, saves, migrates, and merges defaults correctly
- IPC handlers validate arguments and delegate properly
- Integration clients manage connection state and reconnection
- Button interaction timing (long-press, double-tap) fires the right callbacks
- Multi-action sequences execute in order with delays
- UI components render correct fields for each action type

Without this, the plugin migration will be a "hope nothing broke" exercise.

---

## 2. Framework Choice: Vitest

| Criterion | Vitest | Jest |
|---|---|---|
| Vite-native | ✅ Shares config, aliases, plugins | ❌ Needs babel/SWC transform |
| `@shared/*` alias | ✅ Reads from existing `vite.*.config.ts` | ❌ Needs `moduleNameMapper` |
| `moduleResolution: "bundler"` | ✅ Native support | ⚠️ Needs extra config |
| `isolatedModules: true` | ✅ Compatible | ✅ Compatible (with SWC) |
| ESM support | ✅ Native | ⚠️ Experimental |
| Speed | ✅ Vite's dev server + esbuild | ⚠️ Slower transforms |
| Svelte component testing | ✅ Via `@testing-library/svelte` | ⚠️ Possible but less common |
| Watch mode | ✅ HMR-aware | ✅ Good |
| Coverage | ✅ Built-in (c8/istanbul) | ✅ Built-in |
| Electron compatibility | ⚠️ Needs mocking (same as Jest) | ⚠️ Same |
| Community + ecosystem | ✅ Growing fast, Vite-aligned | ✅ Mature |

**Verdict**: Vitest is the natural fit — it eliminates the config duplication that
Jest would require and shares the existing Vite pipeline.

---

## 3. Test Categories

### 3.1 Unit Tests (main process)

Test individual classes/modules in isolation with mocked dependencies. These are
the highest-value, lowest-effort tests.

| Module | What to test | Mocks needed |
|---|---|---|
| `ActionExecutor` | Correct client method called for each ActionType; unknown type throws; multi-action sequencing; set-brightness dispatch | OBS client, Discord client, DeviceManager, shell, child_process |
| `ProfileManager` | Load/save/create/delete profiles; default merging; migration from v2→v3; page CRUD; connection settings get/set; app switch settings | `fs` (via memfs or manual mock), `electron.app` |
| `ButtonInteractionManager` | Single tap, long-press, double-tap timing; configurable thresholds; cancel scenarios | Timer mocks (`vi.useFakeTimers`) |
| `LogCollector` | Log capture, rotation, max entries, retrieval by level | None (pure logic) |
| `OBSWebSocketClient` | Connect/disconnect state transitions; reconnect timer; state change callbacks; action dispatch to correct OBS methods; error handling | `obs-websocket-js` (mock class) |
| `DiscordRPCClient` | Connect/disconnect state; port scanning; auth flow; nonce-based response matching; event subscriptions; action dispatch | `ws` (mock WebSocket), `net`, `https` |
| `DeviceManager` | Device add/remove; serial fallback IDs; brightness persistence; multi-device tracking | `loupedeck` (mock) |
| `ForegroundAppMonitor` | App change detection; profile switching triggers; platform-specific command mocking | `child_process.exec` |

### 3.2 Integration Tests (IPC layer)

Test that IPC handlers correctly wire requests to the right manager/client
methods and return the expected shapes. These use Vitest but mock `electron`'s
`ipcMain` with a simple event emitter.

| Area | What to test |
|---|---|
| Profile IPC | `get-profiles`, `set-active-profile`, `create-profile`, `delete-profile`, `import-profile`, `export-profile` all delegate correctly |
| OBS IPC | `obs:connect`, `obs:disconnect`, `obs:get-state`, `obs:get-scenes`, `obs:get-inputs` |
| Discord IPC | `discord:connect`, `discord:disconnect`, `discord:get-state`, `discord:get-voice-channels` |
| Device IPC | `get-devices`, `set-brightness`, `get-brightness` |
| Action IPC | `execute-action` routes through ActionExecutor |
| Settings IPC | Connection settings round-trip correctly |

### 3.3 Component Tests (renderer)

Test Svelte components render correctly and respond to user interaction. Uses
`@testing-library/svelte` + `jsdom`.

| Component | What to test |
|---|---|
| `ActionPanel` | Correct fields shown for each action type; action type dropdown population; save produces correct config shape; load populates fields from config |
| `ProfileSwitcher` | Profile list renders; create/delete/rename interactions |
| `DeviceGrid` | Correct grid layout for device type; button click dispatches |
| `ButtonCell` | Image rendering; label display; empty state |
| `PageBar` | Page tabs; add/remove/reorder |
| `StatusBar` | Connection status indicators; device count |
| `IconPicker` | Icon pack loading; search/filter; selection callback |
| `LogPanel` | Log entries render; level filter; auto-scroll |

### 3.4 E2E Tests (future — Phase 5)

Full Electron app tests using Playwright + Electron. Deferred because:
- Requires real or emulated Loupedeck hardware (complex mocking)
- Slower to run, harder to maintain
- The unit + integration + component layers cover the plugin refactor needs

---

## 4. Project Structure

```
catalyst-stream-controller/
├── src/                          # Production code (unchanged)
├── tests/
│   ├── unit/
│   │   ├── main/
│   │   │   ├── ActionExecutor.test.ts
│   │   │   ├── ProfileManager.test.ts
│   │   │   ├── ButtonInteractionManager.test.ts
│   │   │   ├── LogCollector.test.ts
│   │   │   ├── OBSWebSocketClient.test.ts
│   │   │   ├── DiscordRPCClient.test.ts
│   │   │   ├── DeviceManager.test.ts
│   │   │   └── ForegroundAppMonitor.test.ts
│   │   └── shared/
│   │       └── types.test.ts        # Type guard / default value tests
│   ├── integration/
│   │   └── ipc/
│   │       └── handlers.test.ts     # IPC wiring tests
│   ├── components/
│   │   ├── ActionPanel.test.ts
│   │   ├── ProfileSwitcher.test.ts
│   │   ├── DeviceGrid.test.ts
│   │   ├── ButtonCell.test.ts
│   │   └── ...
│   ├── mocks/
│   │   ├── electron.ts              # Mock ipcMain, ipcRenderer, app, shell, etc.
│   │   ├── obs-websocket-js.ts      # Mock OBSWebSocketClient's dependency
│   │   ├── ws.ts                    # Mock WebSocket for Discord
│   │   ├── loupedeck.ts             # Mock device driver
│   │   ├── fs.ts                    # In-memory filesystem for ProfileManager
│   │   └── child_process.ts         # Mock exec for ForegroundAppMonitor
│   ├── fixtures/
│   │   ├── profiles/                # Sample profile JSON files for testing
│   │   │   ├── v2-profile.json      # Old format for migration testing
│   │   │   ├── v3-profile.json      # Current format
│   │   │   └── minimal-profile.json # Bare minimum valid profile
│   │   └── actions/                 # Sample action configs
│   │       ├── obs-actions.json
│   │       ├── discord-actions.json
│   │       └── multi-actions.json
│   └── setup.ts                     # Global test setup (mocks, globals)
├── vitest.config.ts                 # Main process tests
├── vitest.config.renderer.ts        # Renderer/component tests (jsdom)
└── ...
```

---

## 5. Configuration

### 5.1 `vitest.config.ts` — Main Process Tests

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/unit/main/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['src/main/types/**', '**/*.d.ts'],
      reporter: ['text', 'lcov'],
      thresholds: {
        // Start modest, increase as coverage grows
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
    },
    // Mock native modules that can't be loaded in test env
    alias: {
      'electron': path.resolve(__dirname, 'tests/mocks/electron.ts'),
    },
  },
});
```

### 5.2 `vitest.config.renderer.ts` — Component Tests

```typescript
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    include: ['tests/components/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/renderer/**/*.{ts,svelte}'],
      reporter: ['text', 'lcov'],
    },
  },
});
```

### 5.3 `package.json` Script Additions

```jsonc
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:unit": "vitest run --config vitest.config.ts",
    "test:components": "vitest run --config vitest.config.renderer.ts",
    "test:coverage": "vitest run --coverage",
    "validate": "npm run typecheck && npm run check && npm run lint:fix && npm run test"
    //                                                        add test ───────────────^
  }
}
```

### 5.4 ESLint Update

Add test file globals so `describe`, `it`, `expect`, `vi` don't trigger
lint errors:

```typescript
// eslint.config.mjs — add to languageOptions.globals for test files
{
  files: ['tests/**/*.ts'],
  languageOptions: {
    globals: {
      describe: 'readonly',
      it: 'readonly',
      expect: 'readonly',
      vi: 'readonly',
      beforeEach: 'readonly',
      afterEach: 'readonly',
      beforeAll: 'readonly',
      afterAll: 'readonly',
    },
  },
},
```

---

## 6. Mock Strategy

### 6.1 Electron Mock (`tests/mocks/electron.ts`)

The biggest challenge: most main-process code imports from `electron`. We need a
comprehensive mock that covers the surface area actually used.

```typescript
// Covers: app, ipcMain, ipcRenderer, BrowserWindow, shell, dialog, nativeImage
export const app = {
  getPath: vi.fn((name: string) => `/mock/${name}`),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
  on: vi.fn(),
  isReady: vi.fn(() => true),
  requestSingleInstanceLock: vi.fn(() => true),
  // ...
};

export const ipcMain = {
  handle: vi.fn(),
  on: vi.fn(),
  removeHandler: vi.fn(),
};

// Helper: extract registered handlers for integration testing
export function getRegisteredHandler(channel: string) {
  const call = ipcMain.handle.mock.calls.find(c => c[0] === channel);
  return call ? call[1] : undefined;
}

export const BrowserWindow = vi.fn(() => ({
  webContents: { send: vi.fn() },
  loadURL: vi.fn(),
  on: vi.fn(),
  show: vi.fn(),
  // ...
}));

export const shell = {
  openExternal: vi.fn(),
  openPath: vi.fn(),
};
```

### 6.2 OBS WebSocket Mock (`tests/mocks/obs-websocket-js.ts`)

```typescript
export class OBSWebSocket {
  connected = false;
  on = vi.fn();
  off = vi.fn();
  connect = vi.fn(async () => { this.connected = true; });
  disconnect = vi.fn(async () => { this.connected = false; });
  call = vi.fn(async (method: string) => {
    // Return sensible defaults per method
    if (method === 'GetSceneList') return { scenes: [], currentProgramSceneName: '' };
    if (method === 'GetInputList') return { inputs: [] };
    return {};
  });
}
export default { OBSWebSocket };
```

### 6.3 WebSocket Mock for Discord (`tests/mocks/ws.ts`)

```typescript
export default class MockWebSocket {
  readyState = 1; // OPEN
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Error) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });

  // Test helper: simulate receiving a message
  _receive(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
```

### 6.4 Loupedeck Mock (`tests/mocks/loupedeck.ts`)

```typescript
export const LoupedeckDevice = vi.fn(() => ({
  on: vi.fn(),
  close: vi.fn(),
  drawKey: vi.fn(),
  drawScreen: vi.fn(),
  setBrightness: vi.fn(),
  vibrate: vi.fn(),
}));

export const discover = vi.fn(async () => []);
```

### 6.5 Filesystem Mock for ProfileManager

Two options:

1. **`memfs`** — drop-in `fs` replacement backed by an in-memory volume.
   Pro: realistic. Con: extra dependency.
2. **Manual mock** — `vi.mock('fs')` with a simple `Map<string, string>`.
   Pro: no dependency. Con: must track read/write/exists/mkdir.

**Recommendation**: Start with manual mock since ProfileManager only uses
`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`, and `readdirSync`.
Switch to `memfs` later if the mock grows unwieldy.

---

## 7. Example Test Cases

### 7.1 ActionExecutor Unit Test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionExecutor } from '@/main/actions/ActionExecutor';

describe('ActionExecutor', () => {
  let executor: ActionExecutor;
  let mockOBSClient: any;
  let mockDiscordClient: any;
  let mockDeviceManager: any;

  beforeEach(() => {
    mockOBSClient = {
      executeAction: vi.fn(),
      isConnected: vi.fn(() => true),
    };
    mockDiscordClient = {
      executeAction: vi.fn(),
      isConnected: vi.fn(() => true),
    };
    mockDeviceManager = {
      setBrightness: vi.fn(),
    };
    executor = new ActionExecutor(/* ... */);
    executor.setOBSClient(mockOBSClient);
    executor.setDiscordClient(mockDiscordClient);
  });

  it('routes obs actions to OBS client', async () => {
    await executor.execute({
      type: 'obs',
      config: { obsAction: 'switch-scene', sceneName: 'Gaming' },
    });
    expect(mockOBSClient.executeAction).toHaveBeenCalledWith(
      expect.objectContaining({ obsAction: 'switch-scene' })
    );
  });

  it('routes discord actions to Discord client', async () => {
    await executor.execute({
      type: 'discord',
      config: { discordAction: 'toggle-mute' },
    });
    expect(mockDiscordClient.executeAction).toHaveBeenCalledWith(
      expect.objectContaining({ discordAction: 'toggle-mute' })
    );
  });

  it('throws for unknown action type', async () => {
    await expect(
      executor.execute({ type: 'nonexistent' as any, config: {} })
    ).rejects.toThrow();
  });

  it('executes multi-action steps in order', async () => {
    const order: string[] = [];
    mockOBSClient.executeAction.mockImplementation(async () => {
      order.push('obs');
    });
    mockDiscordClient.executeAction.mockImplementation(async () => {
      order.push('discord');
    });
    await executor.execute({
      type: 'multi-action',
      config: {
        steps: [
          { type: 'obs', config: { obsAction: 'switch-scene', sceneName: 'A' }, delayMs: 0 },
          { type: 'discord', config: { discordAction: 'toggle-mute' }, delayMs: 0 },
        ],
      },
    });
    expect(order).toEqual(['obs', 'discord']);
  });
});
```

### 7.2 ProfileManager Unit Test

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProfileManager } from '@/main/profiles/ProfileManager';

describe('ProfileManager', () => {
  let pm: ProfileManager;
  let mockFs: Record<string, string>;

  beforeEach(() => {
    mockFs = {};
    vi.mock('fs', () => ({
      existsSync: (p: string) => p in mockFs,
      readFileSync: (p: string) => mockFs[p] ?? (() => { throw new Error('ENOENT'); })(),
      writeFileSync: (p: string, data: string) => { mockFs[p] = data; },
      mkdirSync: vi.fn(),
    }));
    vi.mock('electron', () => ({
      app: { getPath: () => '/mock/userData' },
    }));
    pm = new ProfileManager();
  });

  it('creates a default profile when none exist', () => {
    pm.init();
    const profiles = pm.getProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0].name).toBe('Default');
  });

  it('round-trips OBS connection settings', async () => {
    pm.init();
    const settings = { url: 'ws://localhost:4455', password: 'secret', autoConnect: true };
    await pm.setOBSConnectionSettings(settings);
    const result = pm.getOBSConnectionSettings();
    expect(result).toMatchObject(settings);
  });

  it('merges defaults for missing OBS fields', () => {
    pm.init();
    const result = pm.getOBSConnectionSettings();
    expect(result.url).toBe('ws://localhost:4455');
    expect(result.autoConnect).toBe(false);
  });

  it('survives corrupted profile file', () => {
    mockFs['/mock/userData/profiles.json'] = '{ invalid json !!!';
    expect(() => pm.init()).not.toThrow();
  });
});
```

### 7.3 Component Test (ActionPanel — action type dropdown)

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ActionPanel from '@/renderer/components/ActionPanel.svelte';

describe('ActionPanel', () => {
  it('shows OBS option in action type dropdown', () => {
    render(ActionPanel, { props: { /* ... */ } });
    const select = screen.getByLabelText('Action Type');
    expect(select).toContainHTML('<option value="obs">');
  });

  it('shows OBS fields when OBS action type is selected', async () => {
    const { component } = render(ActionPanel, { props: { /* ... */ } });
    // simulate selecting OBS
    await component.$set({ /* trigger obs selection */ });
    expect(screen.getByLabelText('OBS Action')).toBeInTheDocument();
  });
});
```

---

## 8. Implementation Phases

### Phase 1: Tooling Setup

| Step | Description |
|---|---|
| 1a | `npm install -D vitest @vitest/coverage-v8` |
| 1b | `npm install -D @testing-library/svelte @testing-library/jest-dom jsdom` |
| 1c | Create `vitest.config.ts` (main process / unit + integration) |
| 1d | Create `vitest.config.renderer.ts` (component tests with jsdom + Svelte) |
| 1e | Create `tests/setup.ts` — global mocks, custom matchers |
| 1f | Create `tests/mocks/electron.ts` — core Electron API mock |
| 1g | Add `test`, `test:watch`, `test:unit`, `test:components`, `test:coverage` scripts |
| 1h | Update `validate` script to include `npm run test` |
| 1i | Update ESLint config with test globals |
| 1j | Add `tests/` to tsconfig `include` if needed |
| 1k | Verify: `npm run test` runs and exits cleanly (0 tests, 0 failures) |

### Phase 2: Core Mocks

| Step | Description |
|---|---|
| 2a | `tests/mocks/electron.ts` — ipcMain, ipcRenderer, app, shell, BrowserWindow, nativeImage, dialog |
| 2b | `tests/mocks/obs-websocket-js.ts` — mock OBSWebSocket class |
| 2c | `tests/mocks/ws.ts` — mock WebSocket for Discord RPC |
| 2d | `tests/mocks/loupedeck.ts` — mock device discovery and device class |
| 2e | `tests/mocks/child_process.ts` — mock exec for command actions & app monitor |
| 2f | `tests/mocks/fs.ts` — lightweight in-memory fs for ProfileManager |
| 2g | Create `tests/fixtures/profiles/` — sample JSON profiles (v2, v3, minimal, corrupted) |
| 2h | Create `tests/fixtures/actions/` — sample action config objects |

### Phase 3: Main Process Unit Tests (highest value)

Priority order based on plugin refactor risk:

| Step | Module | Est. Test Count | Why This Order |
|---|---|---|---|
| 3a | `ActionExecutor` | ~15 tests | Core dispatch logic — plugin system replaces this routing |
| 3b | `ProfileManager` | ~20 tests | Data persistence — plugin migration touches this deeply |
| 3c | `ButtonInteractionManager` | ~12 tests | Timing-sensitive logic — easy to break, pure logic |
| 3d | `LogCollector` | ~6 tests | Pure logic, quick win |
| 3e | `OBSWebSocketClient` | ~15 tests | Integration client — becomes a plugin |
| 3f | `DiscordRPCClient` | ~15 tests | Integration client — becomes a plugin |
| 3g | `DeviceManager` | ~10 tests | Device lifecycle — less affected by plugin refactor |
| 3h | `ForegroundAppMonitor` | ~8 tests | App switching — not plugin-affected but valuable |

### Phase 4: Integration Tests (IPC Layer)

| Step | Description | Est. Test Count |
|---|---|---|
| 4a | Profile IPC handlers | ~10 tests |
| 4b | OBS IPC handlers | ~6 tests |
| 4c | Discord IPC handlers | ~6 tests |
| 4d | Device IPC handlers | ~5 tests |
| 4e | Action execution IPC | ~4 tests |

### Phase 5: Component Tests

| Step | Component | Est. Test Count |
|---|---|---|
| 5a | `ActionPanel` — action type selection + field rendering | ~12 tests |
| 5b | `ProfileSwitcher` — CRUD interactions | ~8 tests |
| 5c | `ButtonCell` — rendering states | ~5 tests |
| 5d | `DeviceGrid` — layout + interactions | ~6 tests |
| 5e | `StatusBar` — connection status display | ~4 tests |
| 5f | Remaining components | ~15 tests |

### Phase 6 (Future): E2E Tests

| Step | Description |
|---|---|
| 6a | Install Playwright + `electron` launcher |
| 6b | Create test for app startup → default profile loaded |
| 6c | Create test for profile CRUD workflow |
| 6d | Create test for OBS connection flow (with mock server) |

---

## 9. Coverage Strategy

### Starting Targets (Phase 3 complete)

| Metric | Target | Rationale |
|---|---|---|
| Statements | 50% | Main process core paths |
| Branches | 40% | Error paths + edge cases |
| Functions | 50% | All public API methods |
| Lines | 50% | Reasonable starting point |

### Post-Plugin Migration Targets

| Metric | Target |
|---|---|
| Statements | 70% |
| Branches | 60% |
| Functions | 75% |
| Lines | 70% |

Coverage is enforced in `vitest.config.ts` via `thresholds` — the build fails
if coverage drops below the targets.

### Files Excluded from Coverage

- `src/main/types/**` — declaration files
- `**/*.d.ts` — type declarations
- `src/renderer/main.ts` — Svelte app bootstrap (one line)
- `src/preload/preload.ts` — thin bridge layer (tested via integration tests)

---

## 10. CI Integration (future)

When CI is set up, the test step would be:

```yaml
- name: Test
  run: npm run test:coverage
- name: Upload coverage
  uses: codecov/codecov-action@v4
  with:
    file: coverage/lcov.info
```

For now, `npm run validate` (which will include `npm run test`) is the local
gate before committing.

---

## 11. Dependency Summary

### New devDependencies

| Package | Purpose |
|---|---|
| `vitest` | Test runner |
| `@vitest/coverage-v8` | Code coverage via V8 |
| `@testing-library/svelte` | Component test rendering |
| `@testing-library/jest-dom` | DOM assertion matchers |
| `jsdom` | Browser-like DOM for component tests |

### Estimated Total: ~5 new devDependencies

---

## 12. Relationship to Plugin System Plan

The testing phases are designed to **front-load coverage on the exact modules
the plugin system will refactor**:

| Module | Test Phase | Plugin Phase |
|---|---|---|
| `ActionExecutor` | 3a | Phase 1h (add plugin dispatch) |
| `ProfileManager` | 3b | Phase 1d (add generic settings), 3e (migrate data) |
| `OBSWebSocketClient` | 3e | Phase 3 (extract to plugin) |
| `DiscordRPCClient` | 3f | Phase 4 (extract to plugin) |
| IPC handlers | 4a-4e | Phase 1f (add generic handlers) |
| `ActionPanel` | 5a | Phase 2b (add plugin UI slot) |

After the plugin migration, the existing tests serve as regression tests — if
OBS still works as a plugin with the same test expectations, the migration is
correct.
