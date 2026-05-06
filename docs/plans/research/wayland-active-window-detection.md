# Wayland Active Window Detection: Comprehensive Research

> Research date: February 2026

## Executive Summary

Wayland **intentionally** prevents applications from seeing other windows (client isolation for security). There is **no universal Wayland API** for getting the focused window. However, multiple compositor-specific and protocol-based workarounds exist that, when combined, can cover **all major Linux desktop environments**.

**Recommended strategy**: Build a cascading detector that tries compositor-specific approaches in order of specificity, falling back to X11 tools as a last resort.

---

## 1. Wayland Protocol-Level Approaches

### 1a. `wlr-foreign-toplevel-management-unstable-v1` (wlroots)

**Status**: Unstable (wlr-protocols), but widely deployed  
**Source**: [wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1](https://wayland.app/protocols/wlr-foreign-toplevel-management-unstable-v1)

**What it provides**:
- List of all toplevel windows
- Per-window: `title`, `app_id`, output enter/leave
- Per-window **state** including: `maximized`, `minimized`, **`activated`** (= focused), `fullscreen`
- Can also **control** windows (maximize, minimize, activate, close, fullscreen)
- Parent-child relationships (v3)

**The `activated` state is the key** — it tells you which window is currently focused.

**Compositor support** (confirmed from wayland.app):

| Compositor | Version | Protocol Version |
|---|---|---|
| **Sway** | 1.11 | v3 |
| **Hyprland** | 0.52.1 | v3 |
| **KWin (KDE)** | 6.4 | ❌ (not supported) |
| **Mutter (GNOME)** | 49.2 | ❌ (not supported) |
| **COSMIC** | 1.0.0~beta.8 | ❌ (not supported) |
| niri | 25.11 | v3 |
| river | 0.3.13 | v3 |
| Wayfire | 0.9.0 | v3 |
| Labwc | 0.9.2 | v3 |
| Mir | 2.19 | v2 |
| phoc (Phosh) | 0.52 | v3 |
| Muffin (Cinnamon) | 6.6.0 | ❌ |
| Weston | 14.0.2 | ❌ |

**Key insight**: This covers the **wlroots ecosystem** (Sway, Hyprland, river, Wayfire, Labwc, niri) very well, but **NOT GNOME or KDE**.

**How to consume from Node.js**: Requires a native Wayland client — would need a C/Rust addon that connects to the Wayland display and binds this protocol. Not trivially accessible from JS.

**Permissions**: No special permissions — any Wayland client can bind it (on compositors that support it). Some compositors (like Hyprland 0.44+) have a permissions system that may gate access.

---

### 1b. `ext-foreign-toplevel-list-v1` (Standardized/Staging)

**Status**: **Staging** in official wayland-protocols (the path to becoming standard)  
**Source**: [wayland.app/protocols/ext-foreign-toplevel-list-v1](https://wayland.app/protocols/ext-foreign-toplevel-list-v1)

**What it provides**:
- List of all mapped toplevel windows
- Per-window: `title`, `app_id`, `identifier` (stable cross-process identifier)
- **Does NOT expose window state** (no `activated`/`focused` flag!)
- **Does NOT provide window control** (read-only list)
- Designed as a building block for extension protocols

**Compositor support** (from wayland.app):

| Compositor | Supported |
|---|---|
| COSMIC | v1 |
| Hyprland | v1 |
| Jay | v1 |
| Labwc | v1 |
| Louvre | v1 |
| niri | v1 |
| river | v1 |
| Sway | v1 |
| Treeland | v1 |
| KWin (KDE) | ❌ |
| Mutter (GNOME) | ❌ |

**Critical limitation**: This protocol intentionally **does not include focus/activation state**. It only lists windows. It's meant to be combined with future extension protocols. As of Feb 2026, there is no `ext-foreign-toplevel-state` or similar staging protocol that adds focus info.

**Verdict**: Useful for listing windows, but **cannot determine the focused window** by itself.

---

## 2. Compositor-Specific CLI/IPC Approaches

### 2a. Hyprland: `hyprctl activewindow`

**Works on**: Hyprland only  
**Stability**: Stable (documented in official wiki)  
**Permissions**: None (uses Unix socket IPC)

**Command**: `hyprctl -j activewindow`

**Returns (JSON)**:
```json
{
  "address": "0x...",
  "mapped": true,
  "hidden": false,
  "at": [x, y],
  "size": [w, h],
  "workspace": { "id": 1, "name": "1" },
  "floating": false,
  "monitor": 0,
  "class": "firefox",
  "title": "GitHub - Mozilla Firefox",
  "initialClass": "firefox",
  "initialTitle": "Mozilla Firefox",
  "pid": 12345,
  "xwayland": false,
  "pinned": false,
  "fullscreen": false,
  "fullscreenMode": 0,
  "grouped": [],
  "swallowing": "0x0"
}
```

**Data available**: Window class (`class`), title, PID, position, size, workspace, monitor, whether it's XWayland, fullscreen state

**Detection method from Node.js**: 
```js
const { execSync } = require('child_process');
const result = JSON.parse(execSync('hyprctl -j activewindow').toString());
```

**How to detect Hyprland is running**: Check `$HYPRLAND_INSTANCE_SIGNATURE` env var, or check if `hyprctl` socket exists.

---

### 2b. Sway: `swaymsg -t get_tree`

**Works on**: Sway only  
**Stability**: Stable (i3-compatible IPC)  
**Permissions**: None (uses Unix socket IPC)

**Command**: `swaymsg -t get_tree`

Returns a full tree of containers. The focused window has `"focused": true` in the tree. To find it:

```js
const { execSync } = require('child_process');
const tree = JSON.parse(execSync('swaymsg -t get_tree').toString());

function findFocused(node) {
  if (node.focused) return node;
  for (const child of (node.nodes || []).concat(node.floating_nodes || [])) {
    const found = findFocused(child);
    if (found) return found;
  }
  return null;
}

const focused = findFocused(tree);
// focused.app_id (Wayland) or focused.window_properties.class (XWayland)
// focused.name (title)
// focused.pid
```

**Data available**: app_id (Wayland native), window_properties.class (XWayland), title (name), PID, geometry, workspace, fullscreen state

**Detection**: Check `$SWAYSOCK` env var.

---

### 2c. GNOME/Mutter: D-Bus / Shell Extensions

**Works on**: GNOME (Mutter compositor)  
**Stability**: ⚠️ Fragile — GNOME has been removing/restricting this

#### Approach 1: `org.gnome.Shell.Eval` D-Bus method (deprecated/removed)

```bash
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell \
  --method org.gnome.Shell.Eval \
  "global.display.focus_window.get_wm_class()"
```

**Status**: GNOME disabled `Eval` in GNOME 41+ for security reasons. **This no longer works on modern GNOME.**

#### Approach 2: GNOME Shell Extension (current recommended approach)

Install a GNOME Shell extension that exposes window info via D-Bus:

- **[Window Calls Extended](https://extensions.gnome.org/extension/4974/window-calls-extended/)** — Exposes methods like `FocusPID`, `FocusClass`, `FocusTitle` via D-Bus
- **[Focused Window D-Bus](https://extensions.gnome.org/extension/5592/focused-window-d-bus/)** — Similar approach

Usage with Window Calls Extended:
```bash
# Get PID of focused window
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/WindowsExt \
  --method org.gnome.Shell.Extensions.WindowsExt.FocusPID

# Get WM class
gdbus call --session \
  --dest org.gnome.Shell \
  --object-path /org/gnome/Shell/Extensions/WindowsExt \
  --method org.gnome.Shell.Extensions.WindowsExt.FocusClass
```

**Data available**: PID, WM class, window title  
**Permissions**: Requires user to install and enable a GNOME Shell extension  
**Stability**: Extensions break between GNOME versions. Need to track compatibility.

#### Approach 3: What `@miniben90/x-win` does for GNOME Wayland

The `x-win` npm package installs its own GNOME Shell extension (`x-win@miniben90.org`) programmatically. The extension exposes window data that the native Rust addon then reads. This works for **GNOME ≤ 45** (tested on Fedora 39, Ubuntu 22.04, Debian 12).

**Detection**: Check `$XDG_CURRENT_DESKTOP` for `GNOME` and `$XDG_SESSION_TYPE` for `wayland`.

---

### 2d. KDE Plasma: D-Bus / KWin Scripting

**Works on**: KDE Plasma (KWin compositor)  
**Stability**: Moderately stable

#### Approach 1: KWin Scripting API via D-Bus

KWin has a scripting API that allows getting `workspace.activeClient` (now `workspace.activeWindow` in Plasma 6). You can load a KWin script via D-Bus that emits the active window info:

```bash
# Register a KWin script that outputs active window
# The script can use workspace.activeWindow.caption, .resourceClass, .pid, etc.
```

This is more complex — you need to:
1. Write a small KWin JS script
2. Load it via `dbus-send` or `qdbus` to `org.kde.KWin`
3. Have the script emit results back via D-Bus

#### Approach 2: `kdotool` (community tool)

```bash
kdotool getactivewindow getwindowclassname
kdotool getactivewindow getwindowname
kdotool getactivewindow getwindowpid
```

`kdotool` is a `xdotool`-like tool for KDE Wayland, using the KWin virtual desktop protocol and DBus.

#### Approach 3: KDE's `org.kde.KWin` D-Bus interface

```bash
qdbus org.kde.KWin /KWin org.kde.KWin.activeWindow
# Returns a D-Bus object path to the active window
```

Or via `gdbus`:
```bash
gdbus call --session --dest org.kde.KWin \
  --object-path /KWin \
  --method org.freedesktop.DBus.Properties.Get \
  org.kde.KWin activeWindow
```

**Data available**: Window class, title, PID, geometry  
**Permissions**: None (session D-Bus)  
**Detection**: Check `$XDG_CURRENT_DESKTOP` for `KDE` and `$KDE_SESSION_VERSION`.

---

### 2e. COSMIC Desktop

**Works on**: System76's COSMIC Desktop  
**Status**: Beta (as of 2026)

COSMIC has its own toplevel protocols:
- `cosmic-toplevel-info-unstable-v1`
- `cosmic-toplevel-management-unstable-v1`

These are COSMIC-specific but follow similar patterns to `wlr-foreign-toplevel-management`. The `cosmic-toplevel-info` protocol includes window state (including activated).

No CLI tool research found yet, but COSMIC is wlroots-inspired and may support `wlr-foreign-toplevel-management` in some form.

---

## 3. Fallback: X11 / XWayland

### 3a. `xdotool` / `xprop` / `xwininfo`

**Works on**: X11 sessions, XWayland windows  
**Stability**: Stable and mature

```bash
# Get active window ID
xdotool getactivewindow

# Get window name
xdotool getactivewindow getwindowname

# Get window class  
xprop -id $(xdotool getactivewindow) WM_CLASS

# Get PID
xprop -id $(xdotool getactivewindow) _NET_WM_PID
```

**Important**: These **do NOT work under pure Wayland**. They only work if:
1. Running under X11/Xorg session, OR
2. The focused window is an XWayland window AND the compositor sets up XWayland compatibility

Most Wayland compositors running XWayland do NOT expose the active Wayland-native window to X11 clients.

**Detection**: Check `$XDG_SESSION_TYPE` — if `x11`, use these tools.

---

## 4. The `/proc` Approach

**Verdict**: Not directly useful for determining the *focused* window.

`/proc` can give you:
- List of all running processes and their names/cmdlines
- Which processes have open file descriptors to Wayland sockets

But it **cannot tell you which window is focused** — that's compositor state, not kernel state.

**However**, if you already have a PID from another method, `/proc/<pid>/cmdline`, `/proc/<pid>/exe`, and `/proc/<pid>/comm` can give you more info about the process (executable path, command name).

---

## 5. XDG Desktop Portal

**Status**: No portal for window enumeration/focus exists

The `org.freedesktop.portal.*` interfaces provide sandboxed access to things like:
- Screen capture (`org.freedesktop.portal.ScreenCast`)
- File dialogs
- Notifications

**There is no portal for getting the active window**. The portal concept is designed around user-consented access, but no one has proposed a window-info portal yet.

---

## 6. npm Packages

### 6a. `get-windows` (sindresorhus)

- **Wayland support**: ❌ **Explicitly not supported**
- README states: *"Wayland is not supported. For security reasons, Wayland does not provide a way to identify the active window."*
- Linux implementation uses `xprop`/`xwininfo` (X11 only)
- **Should NOT be used for Wayland**

### 6b. `@miniben90/x-win` ⭐ **Most Promising**

- **Wayland support**: ✅ **GNOME Wayland only** (via custom GNOME Shell extension)
- Written in Rust with napi-rs bindings
- Provides: `activeWindow()`, `openWindows()`, `subscribeActiveWindow()`, icon retrieval
- Returns: title, app name, process ID, executable path, window position/size, memory usage
- **Limitation**: Only works on **GNOME ≤ 45** for Wayland. Does NOT support Sway, Hyprland, KDE Wayland, etc.
- Requires installing a GNOME Shell extension + session restart
- Good Electron support documentation
- MIT license, actively maintained (v3.3.0, Jan 2026)

### 6c. `is-wayland` (sindresorhus)

- Simple detection of whether session is Wayland: `import isWayland from 'is-wayland'`
- Useful for branching logic

---

## 7. Recommended Architecture: Multi-Strategy Detector

A cascading approach that tries the best method for the detected environment:

```
┌─────────────────────────────────┐
│ Detect Environment              │
│ $XDG_SESSION_TYPE               │
│ $XDG_CURRENT_DESKTOP            │
│ $HYPRLAND_INSTANCE_SIGNATURE    │
│ $SWAYSOCK                       │
│ $KDE_SESSION_VERSION            │
└──────────┬──────────────────────┘
           │
           ▼
┌─── Is X11? ──────── YES ──→ Use xdotool/xprop
│          │
│          NO (Wayland)
│          │
│          ▼
│   ┌── Hyprland? ─── YES ──→ hyprctl -j activewindow
│   │      │
│   │      NO
│   │      ▼
│   ├── Sway? ─────── YES ──→ swaymsg -t get_tree
│   │      │
│   │      NO
│   │      ▼
│   ├── GNOME? ────── YES ──→ D-Bus extension (Window Calls Extended)
│   │      │                   OR @miniben90/x-win
│   │      NO
│   │      ▼
│   ├── KDE? ──────── YES ──→ D-Bus org.kde.KWin / kdotool
│   │      │
│   │      NO
│   │      ▼
│   └── Other wlroots ────→ Try wlr-foreign-toplevel-management
│          │                   (niri, river, Wayfire, Labwc)
│          │
│          ▼
│   ┌── Fallback ─────────→ Return "unknown" / warn user
│   └──────────────────────────────────────┘
```

### Implementation from Node.js/Electron:

```typescript
interface ActiveWindow {
  title: string;
  appName: string;     // app_id / WM_CLASS / class
  pid?: number;
  executablePath?: string;
}

async function getActiveWindow(): Promise<ActiveWindow | null> {
  const sessionType = process.env.XDG_SESSION_TYPE;
  const desktop = process.env.XDG_CURRENT_DESKTOP;
  
  if (sessionType === 'x11') {
    return getActiveWindowX11();      // xdotool + xprop
  }
  
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    return getActiveWindowHyprland(); // hyprctl -j activewindow
  }
  
  if (process.env.SWAYSOCK) {
    return getActiveWindowSway();     // swaymsg -t get_tree
  }
  
  if (desktop?.includes('GNOME')) {
    return getActiveWindowGnome();    // D-Bus extension
  }
  
  if (desktop?.includes('KDE')) {
    return getActiveWindowKDE();      // D-Bus org.kde.KWin
  }
  
  // Could try wlr-foreign-toplevel-management for other wlroots compositors
  // But this requires native Wayland client code
  
  return null; // Unknown compositor
}
```

Each sub-function shells out to the appropriate CLI tool and parses the JSON/text output. This is simple and requires no native addons.

---

## 8. Comparison Matrix

| Approach | GNOME | KDE | Sway | Hyprland | niri/river/etc | Permissions | Focus Detection | Stability |
|---|---|---|---|---|---|---|---|---|
| `wlr-foreign-toplevel-mgmt` | ❌ | ❌ | ✅ | ✅ | ✅ | None | ✅ `activated` state | Unstable protocol |
| `ext-foreign-toplevel-list` | ❌ | ❌ | ✅ | ✅ | ✅ | None | ❌ No focus state | Staging |
| `hyprctl -j activewindow` | ❌ | ❌ | ❌ | ✅ | ❌ | None | ✅ | Stable |
| `swaymsg -t get_tree` | ❌ | ❌ | ✅ | ❌ | ❌ | None | ✅ `focused` flag | Stable |
| GNOME Shell Extension D-Bus | ✅ | ❌ | ❌ | ❌ | ❌ | Extension install | ✅ | ⚠️ Breaks between versions |
| KDE D-Bus / kdotool | ❌ | ✅ | ❌ | ❌ | ❌ | None | ✅ | Moderate |
| xdotool (X11 fallback) | X11 only | X11 only | X11 only | X11 only | X11 only | None | ✅ | Stable (X11) |
| `@miniben90/x-win` npm | ✅ GNOME only | ❌ | ❌ | ❌ | ❌ | Extension install | ✅ | ⚠️ GNOME ≤ 45 |

---

## 9. Data Returned by Each Method

| Method | App Name/Class | Title | PID | Position/Size | Executable Path |
|---|---|---|---|---|---|
| hyprctl | ✅ `class` | ✅ `title` | ✅ `pid` | ✅ | Via /proc |
| swaymsg | ✅ `app_id` | ✅ `name` | ✅ `pid` | ✅ | Via /proc |
| GNOME ext | ✅ WM class | ✅ title | ✅ PID | ❓ Depends | Via /proc |
| KDE D-Bus | ✅ resourceClass | ✅ caption | ✅ pid | ✅ | Via /proc |
| xdotool | ✅ WM_CLASS | ✅ title | ✅ _NET_WM_PID | ✅ | Via /proc |
| x-win npm | ✅ execName | ✅ title | ✅ processId | ✅ | ✅ path |

---

## 10. Recommendations for catalyst-stream-controller

1. **For MVP**: Use the CLI-shelling approach — detect compositor via env vars, call `hyprctl`/`swaymsg`/D-Bus as appropriate. This covers ~90% of Linux Wayland users with pure JS.

2. **For GNOME support**: Either require users to install a GNOME Shell extension, or consider bundling `@miniben90/x-win` as an optional dependency (it handles the GNOME extension installation).

3. **For maximum coverage without native code**: The CLI approach handles Hyprland, Sway, GNOME (with extension), KDE, and X11. That covers essentially all mainstream Linux desktops.

4. **For maximum reliability**: Consider `@miniben90/x-win` for GNOME + custom CLI parsing for Hyprland/Sway/KDE. The x-win package is written in Rust (napi-rs) and handles the GNOME complexity well.

5. **Poll interval**: Since we're shelling out, keep polling reasonable (250ms-1000ms). Both `hyprctl` and `swaymsg` are fast (Unix socket IPC), but `gdbus` calls have more overhead.
