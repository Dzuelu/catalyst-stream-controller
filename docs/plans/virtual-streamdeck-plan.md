# Virtual Stream Deck — Feature Plan

## Overview

Add a **virtual stream deck** that works entirely in software — no physical hardware required. Two surfaces:

1. **In-app panel** — a clickable, interactive grid rendered directly in the Electron window
2. **Web companion** — a standalone web page (mobile-friendly) that connects to the running app over the local network

Both surfaces register as first-class devices in `DeviceManager`, reusing the existing profile/page/action/rendering pipeline.

---

## Goals

- Let users try the app and build profiles without owning hardware
- Provide a mobile/tablet companion deck for live use
- **Modular layout** — users compose their deck from a mix of buttons, knobs, and sliders
- Full interaction parity: all 5 trigger types (press, long-press, double-tap, down, up)
- Encoder/knob support with rotary drag and press
- Slider support with configurable axis, range, and bound actions
- User-configurable grid size (rows × columns)

---

## Architecture

### Virtual Device Driver

A new `VirtualDriver` that implements the same device-driver interface as `ElgatoDriver` and `LoupedeckDriver`:

```
src/main/devices/virtual/
├── VirtualDriver.ts        # Device driver (emits key events, accepts rendered frames)
├── VirtualDeviceConfig.ts  # Grid size, encoder count, key size config
└── VirtualWebServer.ts     # Express/WebSocket server for the web companion
```

**Key points:**

- `VirtualDriver` creates a logical device with a configurable grid (e.g. 3×5), optional encoders, and optional sliders
- It does **not** talk to USB/HID — it receives interaction events from the UI or WebSocket
- It pushes rendered key images (from `KeyRenderer`) to whichever surface(s) are connected
- Registered in `DeviceManager` alongside physical devices — appears in the device dropdown
- Multiple virtual devices can exist simultaneously (e.g. one in-app window, one for a phone, one for a tablet)

### Device Configuration

```ts
interface VirtualDeviceConfig {
  id: string;                // Unique device ID (e.g. "virtual-1")
  name: string;              // User-facing name (e.g. "My Virtual Deck")
  rows: number;              // 1–8
  columns: number;           // 1–12
  keySize: number;           // Rendered key resolution in px (default: 96)
  encoders: number;          // 0–6 rotary encoders
  encoderPosition: 'left' | 'right' | 'bottom' | 'none';
  sliders: number;           // 0–8 sliders
  sliderPosition: 'left' | 'right' | 'bottom' | 'none';
}
```

### Modular Layout

Virtual devices are **modular** — users compose their deck from three widget types:

| Widget | Description |
|--------|-------------|
| **Button** | Standard key with rendered image, supports all 5 trigger types |
| **Knob** | Rotary encoder with press — circular drag to rotate, click to press |
| **Slider** | Linear fader (vertical or horizontal) that emits a 0–127 value |

The configuration UI lets users place widgets in named regions (button grid, encoder row, slider row) and choose where each region is positioned relative to the grid.

Users can create, edit, and delete virtual devices from a settings panel. Each virtual device gets its own profile binding just like a physical device.

---

## Surface 1: In-App Panel

### UI Component

A new `VirtualDeck.svelte` component that renders the interactive grid inside the Electron window.

**Rendering:**

- Display rendered key images from `KeyRenderer` (same pipeline as physical keys)
- Keys are `<button>` elements with the rendered image as background
- Encoders rendered as draggable rotary widgets (CSS transforms for rotation)
- Sliders rendered as vertical/horizontal track + thumb elements

**Button Interactions:**

| Trigger | Mouse / Touch Gesture |
|---------|----------------------|
| Press | Click / tap |
| Long Press | Hold ≥ threshold (mousedown timer) |
| Double Tap | Two clicks within threshold |
| Down | mousedown / touchstart |
| Up | mouseup / touchend |

- Route all button interactions through `ButtonInteractionManager` — same state machine as physical devices

**Encoder Interactions:**

- **Circular drag** (default) — press and hold, then drag in a circular motion around the knob to rotate. Requires continuous press throughout the gesture.
- **Vertical swipe** (option) — press and drag up/down to rotate CW/CCW. Simpler but less intuitive for some users.
- User can choose their preferred mode in settings (per-device or global preference)
- Encoder press: click/tap on the knob center

> **Note:** Both encoder modes require the user to hold (mousedown/touchstart) while dragging. This is inherent to the virtual interaction — there is no passive "resting finger" like on a physical knob.

**Slider Interactions:**

- Click/tap anywhere on the track to jump to that value
- Drag the thumb to scrub smoothly (mousedown → mousemove → mouseup)
- Touch-drag for mobile
- Emits a normalized value (0–127) on change, mapped to a bound action (e.g. MIDI CC, volume, brightness)

**Layout:**

- **Default: separate window** (BrowserWindow) — can be moved/resized/minimized independently
- **Optional: docked panel** — embedded inside the main Electron window (side or bottom) for users who prefer a single-window workflow
- Responsive sizing based on available space
- Optional "always on top" mode for the floating window

### IPC Flow

```
VirtualDeck.svelte  →  IPC  →  VirtualDriver (main process)
                                     ↓
                              ButtonInteractionManager
                                     ↓
                              ActionExecutor
```

Rendered frames flow the other direction:

```
KeyRenderer  →  VirtualDriver  →  IPC  →  VirtualDeck.svelte
```

---

## Surface 2: Web Companion

### Server

`VirtualWebServer` starts a lightweight HTTP + WebSocket server on a configurable port (default: `9120`).

**HTTP endpoints:**

| Route | Purpose |
|-------|---------|
| `GET /` | Serve the companion web app (static HTML/JS/CSS) |
| `GET /api/devices` | List available virtual devices |
| `GET /api/device/:id/config` | Get device config (grid size, encoders) |

**WebSocket messages (bidirectional):**

| Direction | Message | Payload |
|-----------|---------|---------|
| Server → Client | `key-image` | `{ key, imageJpeg }` (binary JPEG frame) |
| Server → Client | `device-config` | `{ rows, cols, encoders, sliders, ... }` |
| Client → Server | `key-down` | `{ key }` |
| Client → Server | `key-up` | `{ key }` |
| Client → Server | `encoder-rotate` | `{ encoder, direction, delta }` |
| Client → Server | `encoder-press` | `{ encoder }` |
| Client → Server | `encoder-release` | `{ encoder }` |
| Client → Server | `slider-change` | `{ slider, value }` (0–127) |
| Server → Client | `slider-value` | `{ slider, value }` (sync state on connect) |

### Web App

A standalone, mobile-first web app (no framework dependency — vanilla HTML/JS or a small Svelte build) hosted by the main app — users simply navigate to the URL:

- Responsive grid that fills the viewport
- Renders buttons, knobs, and sliders matching the virtual device config
- Touch-optimized: supports all 5 trigger types via touch events
- Slider thumb drag with touch inertia
- Encoder circular-drag / vertical-swipe (user preference)
- Haptic feedback via `navigator.vibrate()` on supported devices
- Auto-reconnect on WebSocket disconnect
- QR code shown in the main app for easy mobile connection
- **PIN authentication** for LAN security (simple 4–8 digit code, no HTTPS/certs needed)
- JPEG image transport for lower bandwidth and latency on mobile

### Network Discovery

- Main app displays the connection URL + QR code in a "Web Companion" settings panel
- mDNS/Bonjour advertisement (optional, via `bonjour-service` npm) for automatic discovery
- Fallback: manual IP:port entry

---

## Implementation Phases

### Phase 1 — Virtual Driver Core

- [ ] Define `VirtualDeviceConfig` type (buttons, encoders, sliders)
- [ ] Implement `VirtualDriver` (device interface, event emitting, frame receiving)
- [ ] Slider event model: `slider-change` with normalized 0–127 value
- [ ] Register virtual devices in `DeviceManager`
- [ ] Support multiple simultaneous virtual devices
- [ ] Add IPC handlers for virtual device CRUD (create, update, delete, list)
- [ ] Virtual device persistence (saved alongside profiles)
- [ ] Unit tests for `VirtualDriver`

### Phase 2 — In-App Panel

- [ ] `VirtualDeck.svelte` — modular layout with button grid, encoder row, slider row
- [ ] Mouse interaction handlers (all 5 button triggers via `ButtonInteractionManager`)
- [ ] Encoder knob widget (circular drag default, vertical swipe option)
- [ ] Slider widget (vertical/horizontal track + draggable thumb)
- [ ] IPC bridge: interactions → main process, rendered frames → renderer
- [ ] Default to separate BrowserWindow; optional docked panel mode
- [ ] Settings UI for creating/configuring virtual devices (rows, cols, encoders, sliders)
- [ ] Encoder interaction mode preference (circular drag / vertical swipe)
- [ ] Component tests

### Phase 3 — Web Companion Server

- [ ] `VirtualWebServer` — HTTP + WebSocket server
- [ ] Serve static web companion app
- [ ] WebSocket protocol: JPEG key images, interactions, slider values, device config
- [ ] PIN authentication handshake (4–8 digit code)
- [ ] Connection URL + QR code display in settings panel
- [ ] Server start/stop toggle in settings
- [ ] Port configuration
- [ ] Unit tests for server and WebSocket protocol

### Phase 4 — Web Companion Client

- [ ] Mobile-first responsive layout with buttons, knobs, and sliders
- [ ] Touch interaction handlers (all 5 button triggers)
- [ ] Encoder circular-drag + vertical-swipe option
- [ ] Slider touch-drag with smooth scrubbing
- [ ] Haptic feedback
- [ ] Auto-reconnect with connection status indicator
- [ ] PIN entry screen on first connect
- [ ] Cross-browser testing (Chrome, Safari, Firefox mobile)

### Phase 5 — Polish

- [ ] mDNS/Bonjour discovery (optional)
- [ ] Multiple simultaneous web companion connections
- [ ] Latency optimization (binary WebSocket frames for images)
- [ ] Slider action bindings (MIDI CC, volume, brightness, plugin params)
- [ ] Documentation and README update

---

## Decisions

1. **Separate window by default** — the in-app virtual deck opens as its own `BrowserWindow` (movable, resizable, always-on-top option). Users can optionally dock it as a panel inside the main window.
2. **JPEG image transport** — key images sent as binary JPEG over WebSocket for lower bandwidth and latency, especially on mobile.
3. **Multiple virtual devices supported** — users can create several simultaneously (e.g. one in-app window, one phone, one tablet), each with independent layouts and profile bindings.
4. **PIN-only security** — simple 4–8 digit PIN for web companion auth. No self-signed certs (avoids browser trust issues on varied LAN setups).
5. **Encoder UX: circular drag (default)** — press-and-drag in a circular motion around the knob. Vertical swipe available as an alternative preference per-device.

## Open Questions

1. **Slider action bindings** — should sliders bind to a generic 0–127 value action, or should specific action types (MIDI CC, volume, brightness) each have native slider support?
2. **Widget placement** — should users be able to freely place widgets on a 2D canvas, or stick with region-based layout (button grid + encoder row + slider row)?
3. **Slider visual style** — minimal track/thumb, or rendered with custom skins like the button layer stack?

---

## Dependencies

| Package | Purpose | Required Phase |
|---------|---------|---------------|
| `express` or `fastify` | HTTP server for web companion | Phase 3 |
| `ws` | WebSocket server | Phase 3 |
| `qrcode` | QR code generation for connection URL | Phase 3 |
| `bonjour-service` | mDNS network discovery (optional) | Phase 5 |

No new native dependencies required — `KeyRenderer` already handles all image generation.
