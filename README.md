# Catalyst Stream Controller

A vibe-coded open-source stream controller configuration tool for 
**Elgato Stream Deck**,
**Razer Stream Controller**,
**Loupedeck**, and more.

Built with Electron, Svelte 5, TypeScript, and Tailwind CSS.

---

## Features

### 🎛️ Device Support

Two driver families with automatic detection and hot-plug:

**Elgato** — via `@elgato-stream-deck/node`

| Device | Grid | Key Size | Extras |
|--------|------|----------|--------|
| Stream Deck Mini | 2×3 | 80px | — |
| Stream Deck / MK.2 | 3×5 | 72px | — |
| Stream Deck XL | 4×8 | 96px | — |
| Stream Deck + | 2×4 | 120px | 4 encoders |
| Stream Deck Neo | 2×4 | 72px | — |
| Stream Deck Studio | 4×8 | 72px | — |
| Stream Deck Pedal | — | — | 3 foot switches |

**Loupedeck / Razer** — via the `loupedeck` npm package

| Device | Grid | Key Size | Extras |
|--------|------|----------|--------|
| Razer Stream Controller X | 3×5 | 96px | — |
| Razer Stream Controller | 3×4 | 90px | 6 knobs |
| Loupedeck Live / Live S | 3×5 | 90px | 2 knobs |
| Loupedeck CT | 3×4 | 90px | 6 knobs, touchscreen |

### 🎨 Layer-Stack Button Rendering

Buttons use a **layer-stack model** — up to 8 composited layers per key, rendered bottom-to-top with the **node-canvas (Cairo)** KeyRenderer:

| Layer | Description |
|-------|-------------|
| **Fill** | Solid background color |
| **Image** | Static image (data URI or built-in icon), with fit / scale / offset controls |
| **Text** | Label with font size, bold, color, position (9-point anchor), auto word-wrap |
| **Plugin** | Dynamic image resolved at runtime from a connected plugin |

Each layer has independent visibility, opacity (0–1), and lock controls. The same renderer drives both the physical device display and the real-time UI preview.

### 🔌 Plugin System

**6 built-in plugins** with **69 total actions**, plus a plugin store for community packages:

| Plugin | Actions | Highlights |
|--------|---------|------------|
| **OBS Studio** | 12 | Scene switching, stream / record toggle, mute, source visibility, replay buffer, virtual camera, screenshots |
| **Twitch** | 14 | Create clips, stream markers, run ads, chat messages, chat modes (emote-only, sub-only, slow, follower-only), polls, predictions |
| **YouTube** | 11 | Broadcast lifecycle, title / description updates, live chat messages, chat modes, ad cue points, slates |
| **Philips Hue** | 12 | Light power / toggle, brightness, color, color temperature, room groups, scenes, effects, alerts |
| **MIDI** | 12 | Note on/off, CC, CC toggle (0↔127), program change, pitch bend, MMC transport (play/stop/record/rewind/FF), knob→CC encoder mapping |
| **Discord** | 8 | Toggle mute / deafen, set mute / deafen, join / leave voice channel, input / output volume |

Each plugin ships its own **SVG icon pack** for the icon picker and provides **dynamic dropdown queries** for connected resources (OBS scenes, Hue lights, MIDI ports, etc).

#### Plugin Store

Install community plugins directly from npm — no CLI required:

- Browse and search the npm registry for `catalyst-stream-controller-plugin` packages
- One-click install, update, and uninstall
- Version management with rollback support
- Direct URL / tarball install for private or beta plugins
- Plugin sandbox with rate limiting, timeouts, and error boundaries

### ⚡ Actions

**10 built-in action types** + 69 plugin actions:

| Type | Description |
|------|-------------|
| Hotkey | Keystroke sequences with modifier support |
| Launch | Open an application or URL (with optional args) |
| Command | Execute a shell command |
| Multimedia | Play/pause, next, prev, volume up/down, mute |
| Go to Page | Navigate to a specific page |
| Go Back | Return to the previous page |
| Switch Profile | Activate a different profile |
| Set Brightness | Set device brightness (0–100%) |
| Multi-Action | Sequence of sub-actions with configurable delays |
| None | No-op placeholder |

**5 trigger types** per key:

| Trigger | Behavior |
|---------|----------|
| **Press** | Standard tap |
| **Long Press** | Hold ≥ 500ms (configurable) |
| **Double Tap** | Two taps within 300ms (configurable) |
| **Down** | Immediate physical button-down (zero latency) |
| **Up** | Immediate physical button-up (zero latency) |

Down/Up triggers bypass the interaction state machine — ideal for push-to-talk, hold-to-record, and similar hold-for-action patterns.

### 📂 Profiles & Pages

- Multiple profiles with create, rename, duplicate, delete
- Multi-page support with page tree navigation and breadcrumbs
- Profile import / export as `.json` files
- Per-profile plugin connection settings
- Per-device brightness and calibration persistence
- Data migration across profile format versions (v1 → v2 → v3)

### 🔄 Per-Application Profile Switching

Automatically switch profiles based on the foreground application — **cross-platform with no external dependencies**:

| Platform | Method |
|----------|--------|
| **macOS** | NSWorkspace via osascript |
| **Windows** | PowerShell + Win32 API |
| **Linux / Wayland** | Hyprland, Sway, KDE Plasma, GNOME (compositor-native) |
| **Linux / X11** | xdotool + xprop |

- App → profile rules with bundleId, name, and path matching
- Default profile fallback when no rule matches
- Manual override protection (pauses auto-switch until the app changes)
- Configurable poll interval (200ms–3000ms)

### 🖥️ UI

19 Svelte 5 components including:

- **Device Grid** — visual key grid with knob rows (left, right, and bottom positions)
- **Layer Editors** — dedicated editors for fill, image, text, and plugin layers
- **Layer List** — drag-to-reorder layer stack with visibility / lock toggles
- **Icon Picker** — browse built-in and plugin icon packs
- **Plugin Action Panel** — data-driven UI generated entirely from plugin manifests
- **Plugin Store** — browse, install, update, and uninstall community plugins
- **Log Panel** — real-time application log viewer
- **Calibration Panel** — per-device safe-area inset calibration for edge-bleed correction
- **App Switch Panel** — configure app-to-profile auto-switching rules

### 🔧 Key Calibration

Per-device safe-area insets correct edge-bleeding on LCD keys — set top, bottom, left, right pixel insets and preview the result live.

---

## Development

### Prerequisites

#### Linux Device Permissions

The `.deb` and `.rpm` packages install udev rules automatically so that
stream deck devices are accessible without root. If you are running from
source, install the rules using the same script the packages use
([`build/linux/scripts/postinstall`](build/linux/scripts/postinstall)):

```bash
# Install udev rules
sudo ./build/linux/scripts/postinstall

# Uninstall udev rules
sudo ./build/linux/scripts/postremove
```

The rules cover USB, serial (`ttyACM`), and HID (`hidraw`) interfaces so that
both serial-transport and HID-transport devices work out of the box.

**If `TAG+="uaccess"` doesn't work** (non-systemd distros), the ttyACM and
hidraw rules also set `GROUP="dialout"`. Add your user to that group (or
`uucp` on Arch):

```bash
sudo usermod -aG dialout "$USER"   # Debian / Ubuntu / Fedora
sudo usermod -aG uucp "$USER"      # Arch Linux
```

Log out and back in for the group change to take effect. You can verify with
`groups` after re-login.

You can run the validation script to check that your devices are accessible:

```bash
./build/linux/scripts/validate-udev
```

#### Build dependencies

Native modules (`node-hid`, `canvas`, `@serialport/bindings-cpp`) are compiled
from source when prebuilt binaries don't match Electron's Node ABI. Install the
required system libraries for your platform **before** running `npm install`.

#### Linux (Debian / Ubuntu)

```bash
sudo apt install -y \
  libudev-dev \
  libusb-1.0-0-dev \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  pkg-config \
  build-essential
```

`python3` is also required (by `node-gyp`) but is pre-installed on most desktop
Distros. If missing:

```bash
sudo apt install -y python3
```

#### Linux (Fedora / RHEL)

```bash
sudo dnf install -y \
  libudev-devel \
  libusb1-devel \
  cairo-devel \
  pango-devel \
  libjpeg-turbo-devel \
  giflib-devel \
  librsvg2-devel \
  pkgconf-pkg-config \
  gcc-c++ \
  make
```

`python3` is also required (by `node-gyp`) but is pre-installed on most desktop
distros. If missing:

```bash
sudo dnf install -y python3
```

#### Windows

Install the C++ build toolchain needed by `node-gyp`:

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and select the **"Desktop development with C++"** workload.
2. Python 3 is bundled with the installer — if not, install it from
   [python.org](https://www.python.org/downloads/).

Or from an **elevated** PowerShell:

```powershell
npm install -g windows-build-tools
```

#### macOS

Xcode Command-Line Tools and Homebrew are sufficient:

```bash
xcode-select --install
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### Getting Started

```bash
# Install dependencies
npm install

# Start in development mode
npm start

# Build distributables
npm run make

# Run the full validation pipeline
npm run validate
```

### Available Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Launch in dev mode (Electron Forge) |
| `npm run make` | Build distributable packages |
| `npm run validate` | Full CI: typecheck → svelte-check → lint → deadcode → tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run check` | svelte-check (with `--fail-on-warnings`) |
| `npm run lint:fix` | ESLint with auto-fix |
| `npm run deadcode` | Detect unused files and unlisted deps (Knip) |
| `npm test` | Run all unit tests |
| `npm run test:components` | Run component tests (jsdom) |
| `npm run test:coverage` | Tests with coverage report |

### Testing

769 tests across 32 test files using **Vitest**, **@testing-library/svelte**, and **jsdom**:

- **Unit tests** — KeyRenderer, ButtonInteractionManager, DeviceManager, ProfileManager, ActionExecutor, PluginRegistry, PluginLoader, PluginSandbox, PluginInstaller, LogCollector, ForegroundAppMonitor, ElgatoDriver
- **Plugin tests** — OBS, Discord, Twitch, YouTube, Philips Hue, MIDI
- **Component tests** — ActionPanel, ButtonCell, CalibrationPanel, DeviceGrid, KnobCell, LogPanel, PageBar, PluginStore, ProfileSwitcher, StatusBar

---

## Project Structure

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # App entry, device & plugin wiring
│   ├── ipc/               # IPC handlers
│   ├── devices/           # DeviceManager, drivers (Elgato + Loupedeck)
│   ├── actions/           # ActionExecutor
│   ├── plugins/           # PluginRegistry, PluginLoader, PluginSandbox,
│   │                      #   PluginInstaller, PluginStoreClient
│   ├── rendering/         # KeyRenderer (node-canvas)
│   ├── integrations/      # ForegroundAppMonitor
│   ├── profiles/          # ProfileManager (JSON persistence)
│   └── logging/           # LogCollector
├── plugins/               # Built-in plugins (OBS, Discord, Twitch,
│   │                      #   YouTube, Hue, MIDI)
│   ├── manifest-helpers.ts  # Shared helpers (defaultLayers, svg)
│   └── {plugin}/
│       ├── manifest.ts    # Plugin manifest (actions, params, icons)
│       ├── client.ts      # Plugin client (connect, execute, queries)
│       └── index.ts       # PluginPackage re-export
├── renderer/              # Svelte 5 UI (renderer process)
│   ├── App.svelte         # Root component
│   ├── components/        # 19 UI components
│   ├── stores/            # Svelte stores
│   └── styles/            # Tailwind + dark theme
├── preload/               # Context bridge (secure IPC)
└── shared/                # Types shared across processes
    ├── types.ts           # Core types (actions, bindings, layers)
    └── plugin-types.ts    # Plugin contract (manifest, client, host API)
```

---

## License

MIT
