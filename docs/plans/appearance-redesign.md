# Appearance Tab Redesign — Design Document

> **Status**: Draft  
> **Created**: 2026-02-20  
> **Last updated**: 2026-02-20

---

## 1. Problem Statement

The current `ButtonAppearance` model has three **fixed, implicit layers** — a background
colour, a single optional icon/image, and a single label. This is limiting in several ways:

- **No multi-layer compositing**: You can't stack multiple images, add multiple text labels
  at different positions, or blend a user icon with a plugin's dynamic image.
- **Plugin images replace the user icon entirely**: When a plugin pushes a dynamic image,
  the user's static icon is completely displaced rather than composited alongside it.
- **UI ↔ device rendering desync**: The renderer preview (CSS-based in `ButtonCell`) and
  the device output (Cairo canvas in `LoupedeckDriver.renderKey`) use completely different
  rendering engines, causing visible differences in font sizing, word wrapping, image
  positioning, safe area handling, and plugin image visibility.

### Documented Desync Issues (Current)

| Issue | Severity | Root Cause |
|-------|----------|------------|
| Auto font size: 12px (UI) vs ~16px (device) | 🔴 High | Two renderers with different auto-size logic |
| Word-wrap: CSS natural vs manual space-split | 🔴 High | Different wrapping algorithms |
| Safe area insets ignored in UI | 🟡 Medium | ButtonCell has fixed 6px padding |
| Plugin image never shown in UI preview | 🟡 Medium | Composited only in main process |
| Bold weight mismatch (font-semibold vs bold) | 🟢 Low | CSS 600 vs canvas 700 weight |
| Background fills whole cell (UI) vs safe area (device) | 🟢 Low | Different area semantics |
| Line height mismatch (1.25 vs 1.4) | 🟢 Low | Different defaults |
| Font family mismatch (system font vs Cairo sans-serif) | 🟡 Medium | Different engines/fonts |

---

## 2. Design Goals

1. **Arbitrary layer stack** — Support an ordered list of fill, image, text, and plugin
   layers. Users can add, remove, reorder, and toggle visibility.
2. **Pixel-perfect UI ↔ device sync** — A single rendering engine (`node-canvas` /
   Cairo) produces the image used by *both* the device and the UI preview.
3. **Plugin-aware compositing** — Plugin dynamic images occupy an explicit layer in the
   stack, with a user-controllable z-order, visibility, opacity, and fit mode.
4. **Safe area awareness** — Rendering respects per-device calibration insets. The preview
   reflects the actual visible area for the currently selected device.
5. **Clean break** — No legacy users exist yet, so the old flat `ButtonAppearance` is
   replaced outright. No migration code needed.

---

## 3. Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Compositing model | Opacity only (no blend modes) | Simplest to implement; `globalAlpha` in canvas. Blend modes (`globalCompositeOperation`) can be added later if needed. |
| Max layers | 8 | Keeps config size reasonable, rendering fast, and the UI manageable. |
| Per-device preview | Show preview for the **selected** device's insets | Current UI is a single-device tab-switch model — no multi-grid view. The preview adapts when the user switches device tabs. |
| Renderer-side canvas fallback | Wait and see | If IPC round-trip latency is perceptible during slider dragging, we'll port `KeyRenderer` to OffscreenCanvas in the renderer. The existing 50ms debounce should make this unnecessary. |
| `node-canvas` dependency | Add as direct dependency | Already present transitively via `loupedeck`. Adding it directly gives us version control and explicit API access. |

---

## 4. Data Model

### 4.1 Layer Types

```typescript
/** shared/types.ts */

type LayerType = 'fill' | 'image' | 'text' | 'plugin';

interface LayerBase {
  id: string;            // Stable UUID for reordering / editing
  type: LayerType;
  name: string;          // User-editable label ("Background", "Icon", "Title")
  visible: boolean;      // Toggle without deleting
  opacity: number;       // 0–1, default 1
  locked: boolean;       // Prevent accidental edits
}

interface FillLayer extends LayerBase {
  type: 'fill';
  color: string;         // CSS hex colour
}

interface ImageLayer extends LayerBase {
  type: 'image';
  dataUri: string;       // data:image/png;base64,... or icon:<id> reference
  fit: ImageFit;         // contain | cover | stretch | none
  scale: number;         // 0.1–2.0, default 1.0
  offsetX: number;       // Pixel offset from centre (-48..+48 on 96px canvas)
  offsetY: number;
}

interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;      // 0 = auto (~20% of safe area width)
  bold: boolean;
  positionV: PositionAnchorV;  // top | center | bottom
  positionH: PositionAnchorH;  // left | center | right
}

interface PluginLayer extends LayerBase {
  type: 'plugin';
  fit: ImageFit;         // How the plugin-provided image is fitted
  imageId?: string;      // Optional: references a named image in the plugin's image
                         // registry (e.g. 'scene-preview', 'album-art'). If omitted,
                         // falls back to the legacy per-button image from
                         // setButtonImage(). See §7.1 for the image registry API.
  // dataUri is NOT persisted — resolved at render time from plugin image registry
}

type Layer = FillLayer | ImageLayer | TextLayer | PluginLayer;

/** Max number of layers per button appearance */
const MAX_LAYERS = 8;
```

### 4.2 Updated ButtonAppearance

```typescript
interface ButtonAppearance {
  layers: Layer[];
}
```

The old flat fields (`backgroundColor`, `label`, `icon`, `pluginImage`) are removed.

### 4.3 Default Layer Stack

When a button has no stored appearance:

```typescript
const DEFAULT_APPEARANCE: ButtonAppearance = {
  layers: [
    {
      id: uuid(), type: 'fill', name: 'Background',
      visible: true, opacity: 1, locked: false,
      color: '#1a1a2e'
    },
    {
      id: uuid(), type: 'text', name: 'Label',
      visible: true, opacity: 1, locked: false,
      text: '', color: '#ffffff', fontSize: 0,
      bold: true, positionV: 'center', positionH: 'center'
    }
  ]
};
```

### 4.4 Plugin Default Appearance

`ActionDefinition.defaultAppearance` changes from `Partial<ButtonAppearance>` (old flat
structure) to an array of partial layers:

```typescript
interface ActionDefinition {
  label: string;
  params?: Record<string, ParamFieldDef>;
  defaultAppearance?: {
    layers: Array<Partial<Layer> & Pick<LayerBase, 'type'>>;
  };
}
```

Omitted fields on each layer inherit from type-specific defaults. Example plugin:

```typescript
defaultAppearance: {
  layers: [
    { type: 'fill', color: '#1a237e' },
    { type: 'plugin', fit: 'cover' },
    { type: 'text', text: 'Scene', positionV: 'bottom', color: '#ffffff' }
  ]
}
```

---

## 5. Rendering Architecture

### 5.1 Single Source of Truth: `KeyRenderer`

A new module in the main process that is the **only** code path that produces key images:

```
                    ┌──────────────────────────┐
  ButtonAppearance  │   KeyRenderer (main)     │
  + pluginImage ──► │   node-canvas (Cairo)    │──► PNG data URI
  + safeAreaInsets   │   renderKey(appearance,  │       │
                    │     insets, w, h): string │       │
                    └──────────────────────────┘       │
                              │                        │
                    ┌─────────┴────────┐     ┌────────┴────────┐
                    │  LoupedeckDriver │     │  Renderer (IPC) │
                    │  device.drawKey  │     │  ButtonCell <img>│
                    │  (raw buffer)    │     │  (data URI)      │
                    └──────────────────┘     └─────────────────┘
```

**Location**: `src/main/rendering/KeyRenderer.ts`

**Public API**:

```typescript
/**
 * Render a button appearance to a PNG data URI.
 *
 * @param appearance - The layer stack to render
 * @param insets     - Device-specific safe area insets
 * @param width      - Canvas width in pixels (e.g. 96)
 * @param height     - Canvas height in pixels (e.g. 96)
 * @param pluginImageDataUri - Optional resolved plugin image data URI to inject
 *                             into any visible PluginLayer. The caller is responsible
 *                             for resolving imageId → data URI via the plugin registry
 *                             before calling this function.
 * @returns data:image/png;base64,... string
 */
export function renderKey(
  appearance: ButtonAppearance,
  insets: SafeAreaInsets,
  width: number,
  height: number,
  pluginImageDataUri?: string
): string;
```

### 5.2 Rendering Algorithm

```
for each layer in appearance.layers (bottom to top):
  if !layer.visible → skip
  set globalAlpha = layer.opacity

  switch layer.type:
    case 'fill':
      fill safe area rect with layer.color

    case 'image':
      load image from layer.dataUri (cached)
      compute draw rect from fit/scale/offset relative to safe area
      clip to safe area
      drawImage()

    case 'plugin':
      resolve pluginDataUri from:
        1. layer.imageId → plugin image registry lookup
        2. fallback → legacy per-button setButtonImage() data
      if pluginDataUri exists:
        load image from pluginDataUri (cached)
        compute draw rect from layer.fit relative to safe area
        clip to safe area
        drawImage()
      else:
        skip (transparent — plugin hasn't registered this image yet)

    case 'text':
      compute font size (auto = ~20% of safe area width)
      word-wrap against safe area width - 8px padding
      compute baseline from positionV/positionH
      fillText() for each wrapped line

  reset globalAlpha = 1
```

**Margin handling**: Before painting any layers, the full canvas is filled with `#1a1a2e`
(neutral dark) so that margins outside the safe area don't show through to adjacent keys
on the device.

### 5.3 Image Caching

`KeyRenderer` maintains an LRU cache of loaded images (keyed by data URI hash) to avoid
re-decoding PNGs on every render. Cache capacity: ~64 entries. Cleared on profile switch.

### 5.4 LoupedeckDriver Changes

`LoupedeckManagedDevice.renderKey()` is replaced:

```typescript
// Before (today): manually paints bg → image → label inside rawDevice.drawKey() callback
// After: delegates to KeyRenderer, blits result into callback

private async renderKey(keyIndex: number, appearance: ButtonAppearance): Promise<void> {
  const pngDataUri = KeyRenderer.renderKey(
    appearance, this.insets,
    this.deviceInfo.keySize, this.deviceInfo.keySize,
    pluginImageDataUri  // injected by caller
  );
  // Decode and blit into the loupedeck callback context
  const buf = Buffer.from(pngDataUri.split(',')[1], 'base64');
  const img = await loadImage(buf);
  await this.rawDevice.drawKey(keyIndex, (ctx, w, h) => {
    ctx.drawImage(img, 0, 0, w, h);
  });
}
```

### 5.5 UI Preview via IPC

**New IPC channel**: `KEY_RENDER_PREVIEW`

**Flow**:
1. Renderer calls `pushLivePreview()` → sends `ButtonAppearance` to main via
   `KEY_RENDER_PREVIEW` IPC.
2. Main process calls `KeyRenderer.renderKey()` with the selected device's insets and
   key size.
3. Main returns the PNG data URI to the renderer.
4. `ButtonCell.svelte` displays it as `<img src={previewDataUri}>`.

**Existing `PREVIEW_KEY` channel** is repurposed: instead of receiving an appearance
object and calling `device.drawKey()` directly, it now calls `KeyRenderer.renderKey()`
and sends the result to both the device *and* back to the renderer.

**Result**: ButtonCell shows the exact same pixels that appear on the device — no more
CSS approximation.

**Latency**: The 50ms debounce on slider inputs limits IPC rate. `KeyRenderer.renderKey()`
on a 96×96 canvas with `node-canvas` takes <1ms. IPC round-trip in Electron is <1ms for
small payloads (~15KB base64 PNG). Total perceived latency: imperceptible.

---

## 6. UI Design

### 6.1 Appearance Tab Layout

The appearance tab in `ActionPanel` (right sidebar, 280px wide) is redesigned from a flat
form to a **layer list + inspector** pattern:

```
┌─ Appearance ─────────────────────────────┐
│                                          │
│  Layers                    [+ Add ▾]     │
│  ┌──────────────────────────────────┐    │
│  │ 👁 🔒  Title          text   ≡   │    │  ← top (drawn last)
│  │ 👁 🔒  Plugin Image   plugin ≡   │    │
│  │ 👁 🔒  Logo           image  ≡   │    │
│  │ 👁 🔒  Background     fill   ≡   │    │  ← bottom (drawn first)
│  └──────────────────────────────────┘    │
│                                          │
│  ─── Selected: Title ─────────────────   │
│                                          │
│  Text  [Play/Pause              ]        │
│  Color [#fff ■]    Bold [✓]              │
│  Size  [────●──────────── 0 Auto]        │
│  Position  [3×3 anchor grid     ]        │
│  Opacity   [────────────●── 100%]        │
│                                          │
└──────────────────────────────────────────┘
```

### 6.2 Layer List Interactions

| Action | Interaction |
|--------|-------------|
| **Select layer** | Click row → inspector shows that layer's properties |
| **Reorder** | Drag handle (≡) to reorder. Or keyboard ⌘↑ / ⌘↓ |
| **Toggle visibility** | Click 👁 icon. Hidden layers render as transparent |
| **Toggle lock** | Click 🔒 icon. Locked layers can't be edited |
| **Add layer** | "+ Add" dropdown → Fill / Image / Text / Plugin Image |
| **Delete layer** | Select → Delete key or context menu. Confirmation if it's the last of its type |
| **Rename layer** | Double-click layer name → inline edit |
| **Duplicate layer** | Context menu → Duplicate (copies all properties, new UUID) |

**Constraints**:
- Max 8 layers total. "Add" button disabled when at limit.
- Only one `PluginLayer` allowed (the plugin pushes a single image per button).
- `PluginLayer` option only appears in "Add" menu when a plugin action is bound.

### 6.3 Per-Layer Inspector

Each layer type shows its own set of controls when selected:

**FillLayer**:
- Colour picker + hex input

**ImageLayer**:
- Image source: "Browse Icons" / "Upload Image" / "Remove"
- Fit mode: contain / cover / stretch / none
- Scale: slider 0.1–2.0
- Offset X/Y: sliders -48..+48

**TextLayer**:
- Text input
- Colour picker + hex input
- Bold toggle
- Font size slider (0=auto, 8–48)
- Position: 3×3 anchor grid (V × H)

**PluginLayer**:
- Image ID: dropdown of available images from the plugin's registry (e.g.
  `scene:gaming`, `album-art`). "Auto" option uses the legacy per-button image.
- Fit mode: contain / cover / stretch / none
- Note: "(Image provided at runtime by {pluginName})"

**Common to all layers** (shown at bottom of inspector):
- Opacity slider: 0–100%
- Layer name (editable text field)

### 6.4 New Components

| Component | Purpose |
|-----------|---------|
| `LayerList.svelte` | Ordered list with drag-to-reorder, visibility/lock toggles |
| `LayerInspector.svelte` | Property editor for the selected layer (switches panel by type) |
| `FillLayerEditor.svelte` | Colour picker for fill layers |
| `ImageLayerEditor.svelte` | Image source + fit/scale/offset controls |
| `TextLayerEditor.svelte` | Text + font + position controls |
| `PluginLayerEditor.svelte` | Fit mode + info text |

`ActionPanel.svelte` coordinates these, replacing the current flat appearance form.

### 6.5 Device Preview

The current `ButtonCell.svelte` changes from CSS-rendered to `<img>`-rendered:

```svelte
<!-- Before: complex CSS layout with div/span/img -->
<!-- After: single image from KeyRenderer -->
<button class="..." style:background-color={previewDataUri ? undefined : '#1a1a2e'}>
  {#if previewDataUri}
    <img src={previewDataUri} alt="" class="w-full h-full rounded" />
  {/if}
</button>
```

The preview automatically reflects the selected device's safe area insets, since
`KeyRenderer` receives the actual insets for that device. When the user switches device
tabs, previews re-render with the new device's insets and key size.

---

## 7. Plugin Integration

### 7.1 Plugin Image Registry

The current `setButtonImage(keyIndex, dataUri)` API is push-per-button — if a plugin
wants the same image on 5 buttons, it pushes 5 copies. This redesign introduces a
**plugin image registry**: plugins register named images by ID, and `PluginLayer`s
reference them declaratively.

#### New Host API

```typescript
/** Register or update a named image in this plugin's image registry */
hostAPI.setPluginImage(imageId: string, dataUri: string): void;

/** Remove a named image from the registry */
hostAPI.clearPluginImage(imageId: string): void;
```

When a plugin calls `setPluginImage('scene-preview', dataUri)`, the registry stores it
under the plugin's namespace (e.g. `obs:scene-preview`). Any button whose `PluginLayer`
has `imageId: 'scene-preview'` (and whose action belongs to that plugin) automatically
re-renders — the host finds all keys referencing that image ID on the current page and
calls `reapplyKey()` for each.

This means a plugin can update one image and every button using it refreshes, without
the plugin needing to know which buttons or key indices are involved.

#### Legacy API — Preserved

The existing per-button API continues to work for simple cases:

```typescript
hostAPI.setButtonImage(keyIndex, dataUri);   // Push image to a specific button
hostAPI.clearButtonImage(keyIndex);           // Clear it
```

The per-button image is used as a **fallback** when the `PluginLayer` has no `imageId`
(or the `imageId` hasn't been registered yet). This provides full backward compatibility.

#### Resolution Order

When rendering a `PluginLayer`, the image is resolved in this order:

1. **`imageId` lookup**: If `layer.imageId` is set, look up the plugin's image registry
   for that ID. If found, use it.
2. **Per-button fallback**: If no `imageId` is set (or the ID isn't registered yet), fall
   back to the legacy per-button image from `setButtonImage(keyIndex, ...)`.
3. **Transparent**: If neither exists, the layer renders as transparent (skipped).

#### Example: OBS Scene Switcher Plugin

```typescript
// Plugin registers scene preview images by name
hostAPI.setPluginImage('scene:gaming', gamingPreviewDataUri);
hostAPI.setPluginImage('scene:chatting', chattingPreviewDataUri);

// When the scene preview updates (e.g. from OBS websocket event):
hostAPI.setPluginImage('scene:gaming', updatedPreviewDataUri);
// → All buttons with PluginLayer imageId='scene:gaming' auto-refresh
```

```typescript
// Plugin's defaultAppearance uses imageId so buttons are wired up automatically:
defaultAppearance: {
  layers: [
    { type: 'fill', color: '#1a237e' },
    { type: 'plugin', fit: 'cover', imageId: 'scene:gaming' },
    { type: 'text', text: 'Gaming', positionV: 'bottom', color: '#fff' }
  ]
}
```

The `imageId` is set by the plugin's `defaultAppearance` at bind time, or the user can
pick from available plugin image IDs in the `PluginLayerEditor` UI (a dropdown populated
from the plugin's registry).

#### Registry Storage

The image registry lives in `PluginRegistry` on the main process, keyed by
`{pluginId}:{imageId}`. It is **in-memory only** — not persisted. Plugins re-register
their images on startup / connection. This keeps `profiles.json` small (only the
`imageId` string is stored, not the data URI).

#### Re-render Flow

```typescript
async function reapplyKey(keyIndex: number): Promise<void> {
  const binding = page.bindings[keyIndex];
  const appearance = binding?.appearance ?? defaultAppearance();

  // Resolve plugin image for any visible PluginLayer
  let pluginDataUri: string | undefined;
  const pluginLayer = appearance.layers.find(
    l => l.type === 'plugin' && l.visible
  ) as PluginLayer | undefined;

  if (pluginLayer) {
    if (pluginLayer.imageId) {
      // Look up by imageId in the plugin's image registry
      pluginDataUri = pluginRegistry.getPluginImageById(
        binding.pluginId, pluginLayer.imageId
      );
    }
    if (!pluginDataUri) {
      // Fallback: legacy per-button image
      pluginDataUri = pluginRegistry.getPluginImage(keyIndex)?.dataUri;
    }
  }

  // Render with KeyRenderer
  const pngDataUri = KeyRenderer.renderKey(
    appearance,
    device.getInfo().safeAreaInsets,
    device.getInfo().keySize,
    device.getInfo().keySize,
    pluginDataUri
  );

  // Send to device + UI
  await device.drawKey(keyIndex, pngDataUri);
  sendToRenderer('KEY_PREVIEW_IMAGE', { keyIndex, dataUri: pngDataUri });
}
```

### 7.2 `defaultAppearance` — Layer Format

Format:
```typescript
defaultAppearance: {
  layers: [
    { type: 'fill', color: '#1a237e' },
    { type: 'plugin', fit: 'cover' },
    { type: 'text', text: 'Scene', positionV: 'bottom', color: '#fff' }
  ]
}
```

`onActionTypeChanged()` in `ActionPanel.svelte` resolves partial layers into full `Layer`
objects by merging with type-specific defaults (missing fields get sensible defaults).

### 7.3 `PluginImageHelpers` — No Change

`solidColor()` and `textImage()` continue to produce `data:image/png;base64,...` strings.
Plugins call `setButtonImage()` with the result. No changes needed.

---

## 8. Implementation Phases

### Phase 1: Types + KeyRenderer
> **Goal**: New data model and single rendering engine, fully tested in isolation.

- [ ] Define `Layer`, `FillLayer`, `ImageLayer`, `TextLayer`, `PluginLayer` types in
      `shared/types.ts`
- [ ] Remove old flat `ButtonAppearance` fields (`backgroundColor`, `label`, `icon`,
      `pluginImage`) — replaced entirely by `layers[]`
- [ ] Add `canvas` as direct dependency in `package.json`
- [ ] Create `src/main/rendering/KeyRenderer.ts`:
  - `renderKey()` function
  - LRU image cache (keyed by data URI hash, ~64 entries)
  - Fill, image, text, plugin rendering with opacity support
  - Safe area inset handling (margin fill + content clipping)
- [ ] Unit tests: snapshot comparisons for each layer type, opacity blending, layer
      ordering, edge cases (empty layers, no visible layers, 8-layer stack)

### Phase 2: Driver Integration
> **Goal**: Device rendering delegates to `KeyRenderer`. Device output is unchanged.

- [ ] Refactor `LoupedeckManagedDevice.renderKey()` to call `KeyRenderer.renderKey()`
- [ ] Remove the inline canvas painting code from `renderKey()` (background, image, label)
- [ ] Keep `drawCalibration()` as-is (it's a special diagnostic mode, not user content)
- [ ] Verify device output matches previous behaviour with existing profiles
- [ ] Run full test suite

### Phase 3: UI Preview via IPC
> **Goal**: ButtonCell shows server-rendered PNG instead of CSS approximation.

- [ ] Add IPC channel `KEY_RENDER_PREVIEW` (request/response pattern)
- [ ] Update `ButtonCell.svelte` to display `<img src={previewDataUri}>` instead of CSS
      layout
- [ ] Update `pushLivePreview()` in `ActionPanel.svelte` to request render from main and
      update the preview store
- [ ] Update `applyCurrentPageToDevice()` to also send preview images to renderer
- [ ] Wire `reapplyKey()` to emit preview images on plugin state changes
- [ ] Verify visual parity: preview exactly matches device
- [ ] Remove old CSS rendering code from `ButtonCell.svelte`

### Phase 4: Appearance Tab UI
> **Goal**: Layer list + inspector replaces the flat form.

- [ ] Create `LayerList.svelte` — ordered list with drag-to-reorder, visibility toggle,
      lock toggle, selection
- [ ] Create `LayerInspector.svelte` — dispatches to type-specific editors
- [ ] Create `FillLayerEditor.svelte`, `ImageLayerEditor.svelte`,
      `TextLayerEditor.svelte`, `PluginLayerEditor.svelte`
- [ ] Update `ActionPanel.svelte`:
  - Replace flat appearance form with `LayerList` + `LayerInspector`
  - Update `buildAppearance()` to produce `{ layers: [...] }`
  - Update `saveAction()` to persist layers
  - Update `clearAll()` to reset to default layers
  - Add layer button (dropdown: Fill / Image / Text / Plugin)
  - Delete layer, duplicate layer
  - Enforce max 8 layers, max 1 PluginLayer
- [ ] Component tests for layer list interactions

### Phase 5: Plugin Default Layers
> **Goal**: Plugins can specify layer stacks in `defaultAppearance`.

- [ ] Update `ActionDefinition` type in `plugin-types.ts`
- [ ] Update `onActionTypeChanged()` to resolve partial layer specs into full Layer objects
- [ ] Update built-in plugins (if any) to use new format
- [ ] Tests for default appearance resolution

### Phase 6: Polish
> **Goal**: UX refinements and quality-of-life features.

- [ ] Keyboard shortcuts: ⌘↑/⌘↓ reorder, Delete to remove, ⌘D to duplicate
- [ ] Undo/redo within appearance editing session (local history, not global)
- [ ] Opacity slider with live preview during drag
- [ ] Layer thumbnails in the layer list (tiny ~24px rendered previews of each layer)
- [ ] Context menu on layer rows (rename, duplicate, delete, move to top/bottom)
- [ ] Accessibility: ARIA labels, keyboard navigation for layer list
- [ ] Performance: profile render times, optimize if needed

---

## 9. Testing Strategy

### Unit Tests (KeyRenderer)

- Each layer type renders correctly in isolation
- Layer ordering: bottom-to-top paint order verified
- Opacity: 50% fill over solid background produces expected colour
- Safe area: content clipped to inset boundaries, margins filled with neutral colour
- Plugin layer: renders when image provided, transparent when absent
- Image fit modes: contain, cover, stretch, none produce correct dimensions
- Text wrapping: long labels wrap correctly within safe area
- Auto font size: matches `~20% of safe area width` formula
- Max layers (8): renders without error
- Empty appearance: produces default dark key
- Round-trip: render → encode → decode → compare (snapshot tests)

### Component Tests

- LayerList: add, remove, reorder, toggle visibility, toggle lock
- LayerInspector: correct editor shown for each layer type
- ActionPanel: save/revert/clear work with layer data
- ButtonCell: displays rendered PNG, updates on preview change

### Integration Tests

- Full flow: edit appearance in UI → preview updates → save → device receives correct
  image → reload profile → appearance preserved
- Plugin image: plugin calls setButtonImage → PluginLayer visible on device + preview

---

## 10. Future Considerations (Out of Scope)

These are explicitly **not** part of the current redesign but are worth noting for future
planning:

- **Blend modes**: `globalCompositeOperation` support (multiply, screen, overlay, etc.)
  on each layer. The `LayerBase` type can be extended with a `blendMode` field.
- **Per-device profiles**: Assigning different profiles to different connected devices.
  Current architecture uses a single global active profile.
- **Multi-device grid view**: Showing all connected device grids simultaneously instead of
  tab-switching. Would require layout changes to the main app page.
- **Animated layers (GIF / MP4)**: Support animated image sources on `ImageLayer`. GIFs
  and short MP4/WebM clips would be decoded into frame sequences on import. A timer-driven
  render loop re-renders the key at the source frame rate (capped at the device's draw
  queue throughput — likely 15–30 FPS depending on USB bandwidth and key count).
  Considerations:
  - **GIF**: Decode with a library like `sharp` or `gif-frames` into per-frame PNGs.
    Store the frame sequence as an array of data URIs (or a single sprite sheet) in the
    profile. Frame delays are preserved from the GIF metadata.
  - **MP4 / WebM**: Decode with `ffmpeg` (bundled or `ffmpeg-static`) into frame PNGs at
    import time. Store the same way as GIF frames. This avoids runtime video decoding on
    the main thread. File size limits would be needed (e.g. max 5s, max 256×256 source).
  - **Storage**: Frame sequences can be large. May need to store them outside
    `profiles.json` (e.g. `{userData}/animations/{layerId}/` directory with frame PNGs)
    and reference by path, to avoid bloating the profile file.
  - **Render loop**: A shared `AnimationScheduler` ticks at the fastest active animation's
    frame rate, calling `KeyRenderer.renderKey()` for each key with an animated layer.
    Idle keys (no animation or animation paused) skip the loop entirely.
  - **Layer type**: Could be a new `'animation'` layer type or an extension of `ImageLayer`
    with an `animation?: { frames: string[], frameDelayMs: number[], loop: boolean }`
    field. The latter keeps the type system simpler.
- **OffscreenCanvas in renderer**: If IPC latency becomes an issue, port `KeyRenderer`
  logic to run in the renderer process using browser OffscreenCanvas for zero-latency
  preview during slider dragging.
- **Layer groups / presets**: Save a layer stack as a reusable "appearance preset" that
  can be applied to multiple buttons.
- **Text effects**: Stroke/outline, shadow, gradient fills on text layers.
- **Shape layers**: Rectangles, circles, lines — simple vector primitives.
