# Catalyst Stream Controller — Project Plan

## 1. Vision

A cross-platform, open-source Electron + TypeScript application that lets users configure and control stream controller hardware (buttons, knobs, sliders). Initial support targets the **Razer Stream Controller X** (15 buttons, 3×5 grid) with an architecture designed to support arbitrary devices in the future.

---

## 2. Hardware Overview

### Razer Stream Controller X (confirmed specs)

| Property        | Value                                     |
| --------------- | ----------------------------------------- |
| Connection      | USB Serial (via `loupedeck` library)       |
| Layout          | 3 rows × 5 columns (15 LCD keys)          |
| Key resolution  | **96×96px** per key                        |
| Screen total    | 480×288px (center)                         |
| Pixel format    | RGB565 (16-bit, little-endian)             |
| Knobs/Sliders   | None                                       |
| Vibration       | Not supported on RSCX                      |
| Button colors   | Not supported on RSCX (LCD only)           |
| Firmware tested | 0.1.3, 0.1.79, 0.2.5, 0.2.8, 0.2.23       |

### Future Devices (architecture considerations)

| Control Type | Examples                         |
| ------------ | -------------------------------- |
| LCD Buttons  | Elgato Stream Deck, Loupedeck   |
| Knobs        | Loupedeck, Razer Stream Controller |
| Sliders      | Loupedeck                        |
| Touchscreen  | Loupedeck CT                     |

---

## 3. Tech Stack

| Layer              | Technology                                              |
| ------------------ | ------------------------------------------------------- |
| Runtime            | Electron (latest stable)                                |
| Language           | TypeScript (strict mode)                                |
| Build tooling      | Electron Forge + Vite                                   |
| UI framework       | **Svelte 5**                                            |
| Styling            | **Tailwind CSS** (dark mode only, theme-system-ready)   |
| Device comm        | **`loupedeck`** npm package (serial, not raw HID)       |
| Image rendering    | Canvas API (via `loupedeck`'s `drawKey` callback)       |
| State management   | Svelte stores (built-in)                                |
| IPC                | Electron IPC (main ↔ renderer)                          |
| Config persistence | JSON files in user data directory                       |
| Testing            | Vitest + Playwright (E2E)                               |
| Linting            | ESLint + Prettier                                       |
| Package manager    | **npm**                                                 |
| Packaging          | Electron Forge (DMG, NSIS, AppImage)                    |
| License            | **MIT**                                                 |

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Renderer Process                   │
│                                                      │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │  Device View  │  │ Action Edit │  │  Settings   │ │
│  │  (grid/knob)  │  │   Panel     │  │   Panel     │ │
│  └──────┬───────┘  └──────┬──────┘  └─────────────┘ │
│         │                 │                          │
│         └────────┬────────┘                          │
│                  │ IPC                               │
├──────────────────┼───────────────────────────────────┤
│                  │        Main Process               │
│                  ▼                                   │
│  ┌──────────────────────────────┐                    │
│  │       Device Manager         │                    │
│  │  (detect, connect, manage)   │                    │
│  └──────────┬───────────────────┘                    │
│             │                                        │
│  ┌──────────▼───────────────────┐                    │
│  │      Plugin / Driver Layer   │                    │
│  │                              │                    │
│  │  ┌────────────────────────┐  │                    │
│  │  │ RazerStreamControllerX │  │                    │
│  │  │       Driver           │  │                    │
│  │  └────────────────────────┘  │                    │
│  │  ┌────────────────────────┐  │                    │
│  │  │   Future Device Driver │  │                    │
│  │  └────────────────────────┘  │                    │
│  └──────────────────────────────┘                    │
│                                                      │
│  ┌──────────────────────────────┐                    │
│  │      Action Engine           │                    │
│  │  (execute actions on press)  │                    │
│  └──────────────────────────────┘                    │
│                                                      │
│  ┌──────────────────────────────┐                    │
│  │      Profile Manager         │                    │
│  │  (load/save/switch profiles) │                    │
│  └──────────────────────────────┘                    │
└──────────────────────────────────────────────────────┘
```

### Key Abstractions

```
Device (interface)
├── id: string
├── name: string
├── controls: Control[]
├── connect(): void
├── disconnect(): void
├── setButtonImage(index, buffer): void
└── on(event, handler): void

Control (union type)
├── ButtonControl   { type: 'button', row, col, index }
├── KnobControl     { type: 'knob', index }
└── SliderControl   { type: 'slider', index }

DeviceDriver (interface)
├── supportedDevices: { vid: number, pid: number }[]
├── createDevice(hidDevice): Device
└── name: string

Action (interface)
├── id: string
├── type: string   // 'hotkey', 'launch', 'obs', 'multimedia', etc.
├── label: string
├── icon?: string
├── execute(): Promise<void>
└── serialize(): object

Profile
├── id: string
├── name: string
├── deviceId: string
├── bindings: Map<controlIndex, Action>
└── pages?: Profile[]   // for multi-page support
```

---

## 5. Feature Roadmap

### Phase 1 — MVP 🎯

- [ ] Electron + TypeScript project scaffolding
- [ ] USB HID device detection & connection (Razer Stream Controller X)
- [ ] Read button press / release events
- [ ] Render button images to the device LCD keys
- [ ] Simple grid UI in renderer mirroring the 3×5 layout
- [ ] Assign actions to buttons (hotkey, launch app, multimedia keys)
- [ ] Save / load a single profile (JSON)
- [ ] System tray support (minimize to tray)

### Phase 2 — Core Features

- [ ] Multiple profiles with switching
- [ ] Multi-page support (folders / sub-pages)
- [ ] **Custom images on buttons** — upload images (PNG/JPG/SVG) and render them to LCD keys
- [ ] **Custom image positioning** — place/scale uploaded images at arbitrary positions within the key canvas
- [ ] **Custom label positioning** — place text labels at any position on the button (not just center)
- [ ] **Calibration settings UI** — view the bezel calibration pattern from the app and adjust safe-area insets per device via sliders/inputs
- [ ] Icon picker / image upload for buttons
- [ ] OBS Studio integration (scene switch, mute, stream start/stop)
- [ ] Long-press / double-tap actions
- [ ] Drag-and-drop action assignment in UI

### Phase 3 — Extensibility

- [ ] Plugin system for device drivers (load at runtime)
- [ ] Plugin system for action types
- [ ] Support for knobs (rotation, press) and sliders
- [ ] Second device driver (e.g., Elgato Stream Deck)

### Phase 4 — Polish

- [ ] Auto-update (electron-updater)
- [ ] Onboarding / first-run wizard
- [ ] Import / export profiles
- [ ] Community action / icon packs
- [ ] Per-application profile switching (detect foreground app)

---

## 6. Proposed Directory Structure

```
catalyst-stream-controller/
├── .github/                  # CI workflows
├── src/
│   ├── main/                 # Electron main process
│   │   ├── index.ts          # Entry point
│   │   ├── ipc/              # IPC handlers
│   │   ├── devices/
│   │   │   ├── DeviceManager.ts
│   │   │   ├── drivers/
│   │   │   │   └── razer-stream-controller-x/
│   │   │   │       ├── index.ts
│   │   │   │       ├── protocol.ts    # HID packet format
│   │   │   │       └── constants.ts   # VID, PID, image specs
│   │   │   └── types.ts      # Device, Control, Driver interfaces
│   │   ├── actions/
│   │   │   ├── ActionEngine.ts
│   │   │   ├── types.ts
│   │   │   └── builtins/
│   │   │       ├── hotkey.ts
│   │   │       ├── launch.ts
│   │   │       └── multimedia.ts
│   │   └── profiles/
│   │       ├── ProfileManager.ts
│   │       └── types.ts
│   ├── renderer/             # Electron renderer (UI)
│   │   ├── index.html
│   │   ├── main.ts
│   │   ├── App.svelte
│   │   ├── components/
│   │   │   ├── DeviceGrid.svelte
│   │   │   ├── ButtonCell.svelte
│   │   │   ├── ActionPanel.svelte
│   │   │   └── ProfileSwitcher.svelte
│   │   ├── stores/           # Svelte stores
│   │   │   ├── device.ts
│   │   │   ├── profile.ts
│   │   │   └── theme.ts
│   │   └── styles/
│   │       └── app.css        # Tailwind imports + theme vars
│   ├── shared/               # Types shared between main & renderer
│   │   └── types.ts
│   └── preload/
│       └── index.ts          # Context bridge
├── assets/                   # Default icons, images
├── profiles/                 # Default / example profiles
├── tests/
├── package.json
├── tsconfig.json
├── forge.config.ts
├── vite.main.config.ts
├── vite.renderer.config.ts
├── svelte.config.js
├── tailwind.config.ts
├── postcss.config.js
└── README.md
```

---

## 7. Device Communication — `loupedeck` Library

We will use the [`loupedeck`](https://github.com/foxxyz/loupedeck) npm package (MIT, v7.0.3) which already supports all our target devices over serial connection. **This eliminates the need for raw HID reverse-engineering.**

### Supported Devices (by the library)

| Device                    | Class Name              | LCD Keys | Key Size | Knobs | Extra Screens |
| ------------------------- | ----------------------- | -------- | -------- | ----- | ------------- |
| Razer Stream Controller X | `RazerStreamControllerX`| 15 (3×5) | 96×96px  | No    | center: 480×288px |
| Razer Stream Controller   | `RazerStreamController` | 12 (3×4) | 90×90px  | Yes   | left/center/right |
| Loupedeck Live             | `LoupedeckLive`         | 12 (3×4) | 90×90px  | Yes   | left/center/right |
| Loupedeck Live S           | `LoupedeckLiveS`        | 15 (3×5) | 90×90px  | No    | center: 480×270px |
| Loupedeck CT               | `LoupedeckCT`           | 12 (3×4) | 90×90px  | Yes   | left/center/right/knob |

### Key API Surface

```typescript
import { discover, RazerStreamControllerX } from 'loupedeck'

// Auto-discover first connected device
const device = await discover()

// Events
device.on('connect', ({ address }) => { ... })
device.on('disconnect', (error?) => { ... })
device.on('down', ({ id }) => { ... })         // button pressed
device.on('up', ({ id }) => { ... })           // button released
device.on('rotate', ({ id, delta }) => { ... }) // knob turned (±1)
device.on('touchstart' | 'touchmove' | 'touchend', ({ changedTouches, touches }) => { ... })

// Drawing
await device.drawKey(keyIndex, (ctx, w, h) => {
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#fff'
    ctx.font = '14px sans-serif'
    ctx.fillText('Mute', 10, 50)
})

// Brightness
await device.setBrightness(0.8)

// Device info
const { serial, version } = await device.getInfo()
```

### Integration Notes

- The library uses **serial port** communication (not raw HID), so `node-hid` is **not needed**.
- Drawing uses either **Canvas API callbacks** (requires `canvas` peer dep) or raw **RGB565 buffers**.
- The library is **pure ESM** (v7+), which we need to account for in our Electron main process config.
- It handles auto-reconnection out of the box (`reconnectInterval` option).
- The library communicates over serial, which is OS-agnostic (macOS, Linux, Windows).
- **Note:** Firmware 0.2.26 has a known Linux issue — recommend 0.2.23 for Linux.

### Our Adapter Layer

Even though `loupedeck` already provides a nice `LoupedeckDevice` interface, we will wrap it in our own `Device` / `DeviceDriver` abstraction. This lets us:

1. Add TypeScript types on top of the JS library
2. Keep the door open for non-loupedeck devices in the future (e.g., Elgato Stream Deck)
3. Normalize events into our own event schema
4. Decouple our action engine from any specific device library

---

## 8. Decisions Log ✅

> Answered on 2026-02-17.

| #  | Question | Decision |
| -- | -------- | -------- |
| 1  | UI Framework | **Svelte 5** |
| 2  | Styling | **Tailwind CSS** |
| 3  | Dark/light mode | **Dark only** for now; architect a theme system for future light mode |
| 4  | MVP actions | Hotkey, app launch, multimedia keys (OBS in Phase 2) |
| 5  | Multi-device Phase 1 | Single device; design for multi-device future |
| 6  | Button LCD | **Yes** — RSCX has 96×96px LCD behind each key |
| 7  | Own device | **Yes** — available for testing |
| 8  | Platform priority | **OS-agnostic** — develop on macOS, test on Linux, target all 3 |
| 9  | License | **MIT** |
| 10 | Package manager | **npm** |
| 11 | Monorepo | **No** — single package, keep it simple |
| 12 | Existing libs | **`loupedeck`** npm package — supports RSCX, RSC, Loupedeck Live/CT/S |
| 13 | HID approach | **`loupedeck`** lib (serial-based, not raw HID) — eliminates the question |

## 9. Remaining Open Questions ❓

> Items to resolve as we start building.

1. **Canvas peer dependency in Electron:** The `loupedeck` library uses the `canvas` npm package (node-canvas) for `drawKey`/`drawCanvas` callbacks. We need to verify this works cleanly in Electron with native addon compilation, or whether we should use raw RGB565 buffers and render with Electron's OffscreenCanvas instead.
2. **ESM compatibility:** `loupedeck` v7 is pure ESM. Electron's main process traditionally uses CJS. We need to confirm our Vite config handles this (likely fine with Vite, but worth verifying early).
3. **Theming system design:** Should we use Tailwind CSS variables with a theme provider, or a more structured approach like CSS custom properties with a theme config file? (Low priority — dark only for now.)
4. **Profile storage location:** `app.getPath('userData')` is standard, but should profiles be portable / sync-able (e.g., stored in a user-chosen directory)?
5. **Action system extensibility:** For Phase 3's plugin system, should action plugins be npm packages loaded at runtime, or script files in a plugins directory?

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| ~~HID protocol for Razer SCX is undocumented~~ | ~~High~~ | ✅ **Eliminated** — `loupedeck` library handles protocol |
| `canvas` native addon build issues in Electron | Medium | Fall back to raw RGB565 buffers; or use OffscreenCanvas in renderer and IPC the buffer |
| `loupedeck` is pure ESM, Electron main is traditionally CJS | Medium | Vite handles ESM→CJS bundling; verify early in scaffolding |
| `loupedeck` library is community-maintained (small team) | Medium | Our adapter layer isolates us; we can fork if needed |
| Electron app size is large | Low | Acceptable for desktop stream tool; optimize with Vite tree-shaking |
| Future device drivers may have very different protocols | Medium | Abstract `Device` and `Driver` interfaces early |
| Firmware 0.2.26 Linux issue | Low | Document recommended firmware; add detection warning |

---

## 11. Next Steps

All major decisions are made. Implementation order:

1. **Scaffold project** — Electron Forge + Vite + Svelte + TypeScript + Tailwind
2. **Integrate `loupedeck`** — device discovery, connect/disconnect in main process
3. **IPC bridge** — expose device events & drawing commands to renderer via preload
4. **Device grid UI** — Svelte component showing the 3×5 button layout with dark theme
5. **Button press → event flow** — press physical button → main process event → renderer update
6. **Action system** — define action types, assign hotkey action to a button, execute on press
7. **Draw to device** — render button labels/icons back to the RSCX LCD keys
8. **Profile save/load** — persist bindings to JSON in userData
9. **System tray** — minimize to tray, tray menu
10. **Package & test** — build DMG (macOS) + AppImage (Linux), manual test on both

---

*Last updated: 2026-02-17*
