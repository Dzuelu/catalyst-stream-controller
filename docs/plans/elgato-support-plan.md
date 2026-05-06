# Elgato Stream Deck Support Plan

## Goal

Add support for Elgato Stream Deck devices alongside the existing Loupedeck/Razer driver. The app already has a clean `DeviceDriver` / `ManagedDevice` abstraction, so this is primarily about writing a new driver implementation and handling the differences in how Elgato devices accept rendered images.

---

## Current Architecture

```
DeviceManager
  ├── drivers: DeviceDriver[]  (currently only LoupedeckDriver)
  ├── devices: Map<string, ManagedDevice>
  └── events: device-connected, device-disconnected, button-down, button-up, knob-rotate, knob-press
```

- **DeviceDriver** interface: `name`, `discover()`, `dispose(deviceId?)`
- **ManagedDevice** interface: `id`, `getInfo()`, `setBrightness()`, `drawKey()`, `drawCalibration()`, `setKeyInsets()`, `disconnect()`, `on(event, handler)`
- **KeyRenderer**: Renders `ButtonAppearance` layer stacks → **PNG data URI** via node-canvas
- **Loupedeck rendering path**: KeyRenderer → PNG → decode to image → `rawDevice.drawKey(index, canvasCallback)` (library uses its own canvas context)
- **DeviceInfo** includes: `rows`, `cols`, `keySize`, `controls: Control[]`, `safeAreaInsets`

---

## Elgato Device Family

| Device | Keys | Layout | Key Size | Knobs | LCD Strip | HID Interface |
|--------|------|--------|----------|-------|-----------|---------------|
| Stream Deck Mini | 6 | 2×3 | 80×80 | — | — | USB HID |
| Stream Deck MK.1 | 15 | 3×5 | 72×72 | — | — | USB HID |
| Stream Deck MK.2 | 15 | 3×5 | 72×72 | — | — | USB HID |
| Stream Deck XL | 32 | 4×8 | 96×96 | — | — | USB HID |
| Stream Deck + | 8 | 2×4 | 120×120 | 4 | Yes (800×100) | USB HID |
| Stream Deck Neo | 8 | 2×4 | 72×72 | — | LCD strip (2 info bars) | USB HID |
| Stream Deck Pedal | 3 | — | — | — | — | USB HID (no display) |

**Key difference from Loupedeck**: Elgato devices accept **raw image buffers** (JPEG or BMP depending on model) per-key, not canvas draw callbacks. The `@elgato-stream-deck/node` library handles the HID transport and exposes a buffer-based `fillKeyBuffer()` / `fillKeyColor()` API.

---

## NPM Package

Use **`@elgato-stream-deck/node`** (maintained by Julusian, same author as other stream deck libs used across the community).

```
npm install @elgato-stream-deck/node
```

Key APIs:
- `listStreamDecks()` — enumerate connected devices
- `openStreamDeck(path)` — open a specific device by HID path
- `device.fillKeyBuffer(keyIndex, buffer, {format})` — draw raw pixel buffer to a key
- `device.setBrightness(percent)` — 0-100 brightness
- `device.on('down', cb)` / `device.on('up', cb)` — button events
- `device.on('rotateLeft'/'rotateRight', cb)` — knob events (Stream Deck +)
- `device.on('error', cb)` / `device.on('disconnect', cb)`
- `device.close()` — release the device

Image format varies by model (JPEG/BMP, RGB/BGRA) — the library handles encoding internally via `fillKeyBuffer`.

---

## Implementation Plan

### Phase 1: ElgatoDriver Scaffold

**Files to create:**
- `src/main/devices/drivers/elgato/ElgatoDriver.ts`

**Files to modify:**
- `src/main/devices/DeviceManager.ts` — register the new driver
- `package.json` — add `@elgato-stream-deck/node` dependency

**Tasks:**
1. Install `@elgato-stream-deck/node` and `@elgato-stream-deck/tcp` (if needed for network models)
2. Create `ElgatoDriver` implementing `DeviceDriver`
3. Implement `discover()` using `listStreamDecks()` + `openStreamDeck(path)`
4. Implement `dispose()` for cleanup
5. Create `ElgatoManagedDevice` implementing `ManagedDevice`
6. Register `new ElgatoDriver()` in `DeviceManager` constructor

### Phase 2: Device Discovery & Connection

**In `ElgatoDriver.discover()`:**
1. Call `listStreamDecks()` to enumerate available HID devices
2. Filter out already-managed paths
3. `openStreamDeck(path)` for each new device
4. Wrap in `ElgatoManagedDevice`, store in internal map
5. Set up disconnect/error handlers

**In `ElgatoManagedDevice` constructor:**
- Map the device model to `rows`, `cols`, `keySize`
- Build `DeviceInfo` with correct `controls` array (buttons + knobs for SD+)
- Set `safeAreaInsets` to `{ top: 0, bottom: 0, left: 0, right: 0 }` (Elgato keys have no bezel overlap — the display is inset from the physical frame)
- Generate stable ID from serial number: `elgato-${serial}`

### Phase 3: Key Rendering Bridge

**The rendering gap:**
- Our `KeyRenderer.renderKey()` outputs a **PNG data URI**
- Elgato devices want a **raw pixel buffer** (RGBA or BGRA depending on model)
- The `@elgato-stream-deck/node` library's `fillKeyBuffer(index, buffer, {format: 'rgba'})` accepts raw RGBA

**Solution — convert PNG → raw RGBA buffer:**
```typescript
// In ElgatoManagedDevice.drawKey():
const pngDataUri = await keyRendererRenderKey(appearance, insets, keySize, keySize, pluginImageDataUri);
const matches = pngDataUri.match(/^data:([^;]+);base64,(.+)$/);
const pngBuffer = Buffer.from(matches[2], 'base64');

// Use node-canvas to decode PNG → raw pixel buffer
const img = await canvasModule.loadImage(pngBuffer);
const canvas = canvasModule.createCanvas(keySize, keySize);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0, keySize, keySize);
const imageData = ctx.getImageData(0, 0, keySize, keySize);
const rgbaBuffer = Buffer.from(imageData.data);

await this.rawDevice.fillKeyBuffer(keyIndex, rgbaBuffer, { format: 'rgba' });
```

**Alternative (more efficient):** Modify `KeyRenderer.renderKey()` to optionally return a raw `Buffer` instead of a data URI, avoiding the base64 encode → decode round trip. This is an optimization we can do later if performance is an issue.

### Phase 4: Event Forwarding

Map Elgato SDK events to our `ManagedDevice` event interface:

| Elgato Event | Our Event | Notes |
|---|---|---|
| `down` (keyIndex) | `down` ({ buttonIndex }) | Direct mapping |
| `up` (keyIndex) | `up` ({ buttonIndex }) | Direct mapping |
| `rotateLeft` (knobIndex, amount) | `rotate` ({ knobId, delta: -amount }) | Stream Deck + only, map index → knobId |
| `rotateRight` (knobIndex, amount) | `rotate` ({ knobId, delta: +amount }) | Stream Deck + only |
| `error` | trigger `handleDisconnect()` | Same pattern as Loupedeck |
| `disconnect` | `disconnect` | Same pattern |

**Knob ID mapping for Stream Deck +:**
- Knob 0 → `knob0`, Knob 1 → `knob1`, etc. (or a more descriptive scheme)
- The SD+ has 4 knobs in a row at the bottom — all `side: 'bottom'`
- This requires adding `'bottom'` to the `KnobControl.side` union type in `types.ts`

### Phase 5: Stream Deck + LCD Strip (Optional / Deferred)

The Stream Deck + has an 800×100 LCD strip below the buttons. This is a unique control not present on Loupedeck devices. Options:

1. **Ignore initially** — just support the 8 keys + 4 knobs
2. **Later**: Add a `StripControl` type and rendering support

**Recommendation:** Defer LCD strip to a future phase. Keys + knobs are the priority.

### Phase 6: Stream Deck Pedal (Optional / Deferred)

The Stream Deck Pedal has 3 foot switches and no display. It would use the same driver but `drawKey` would be a no-op. The `DeviceInfo` would have `rows: 0, cols: 0` with 3 button controls.

**Recommendation:** Defer to a future phase. Focus on LCD-equipped devices first.

### Phase 7: Type Declaration File

Create `src/main/types/elgato-stream-deck.d.ts` for any type augmentations needed (the `@elgato-stream-deck/node` package ships its own types, so this may not be necessary — verify first).

### Phase 8: Testing

1. **Unit tests for ElgatoDriver** — mock the `@elgato-stream-deck/node` APIs:
   - Discovery returns correct `ManagedDevice[]`
   - Dispose cleans up properly
   - Duplicate detection works
2. **Unit tests for ElgatoManagedDevice**:
   - `getInfo()` returns correct layout for each model
   - `drawKey()` calls `fillKeyBuffer` with correct RGBA buffer
   - Event forwarding maps correctly
   - Disconnect/error handling
   - Draw queue serialization (reuse same pattern as Loupedeck)
3. **Integration with DeviceManager**:
   - Both drivers discovered in parallel
   - Mixed device types coexist

---

## Shared Types Changes

### `types.ts` — KnobControl.side

Add `'bottom'` for Stream Deck + knobs:

```diff
 export interface KnobControl {
   type: 'knob';
   id: string;
   label: string;
-  side: 'left' | 'right';
+  side: 'left' | 'right' | 'bottom';
 }
```

### UI Impact

The renderer UI uses `side` to position knobs in the device grid. The `'bottom'` value will need handling in `DeviceGrid.svelte` or wherever knobs are rendered — likely a row of knobs below the button grid.

---

## File Tree (New / Modified)

```
src/main/devices/drivers/elgato/
  └── ElgatoDriver.ts          ← NEW: ElgatoDriver + ElgatoManagedDevice

src/main/devices/DeviceManager.ts   ← MODIFY: register ElgatoDriver
src/shared/types.ts                 ← MODIFY: KnobControl.side adds 'bottom'

src/renderer/components/DeviceGrid.svelte  ← MODIFY: handle 'bottom' knobs (SD+)
src/renderer/components/KnobCell.svelte    ← MODIFY: if bottom knob layout differs

tests/unit/main/ElgatoDriver.test.ts       ← NEW: unit tests

package.json                        ← MODIFY: add @elgato-stream-deck/node
```

---

## Risk / Considerations

1. **USB HID permissions on macOS**: Elgato devices use raw HID, which may require the app to be signed or the user to grant Input Monitoring permissions. The `@elgato-stream-deck/node` package uses `node-hid` under the hood — this works in Electron but may need `rebuild` for the Electron Node ABI.

2. **Electron native module rebuild**: `@elgato-stream-deck/node` depends on `node-hid` which is a native module. We'll need to ensure `electron-rebuild` or Forge's rebuild step handles it. Add to `forge.config.ts` if needed.

3. **Image format performance**: The PNG → RGBA conversion adds overhead. If key updates feel sluggish, we can:
   - Add a `renderKeyBuffer()` export to `KeyRenderer` that returns raw RGBA directly (skip PNG encoding)
   - Or cache rendered buffers per-key

4. **Key index mapping**: Elgato numbers keys left-to-right, top-to-bottom (0-indexed). Verify this matches our `buildButtonGrid()` convention.

5. **Stream Deck + knob press**: The SD+ knobs can be pressed (they're push-encoders). The library emits `down`/`up` events with the encoder index. Make sure these route to `knob-press` events, not button events.

6. **Hot-plug**: The library emits disconnect events. Our polling-based discovery in `DeviceManager` handles reconnection — same pattern as Loupedeck should work.

---

## Suggested Order of Work

| Step | Description | Est. Effort |
|------|-------------|-------------|
| 1 | Install `@elgato-stream-deck/node`, verify it builds with Electron | Small |
| 2 | Create `ElgatoDriver` scaffold with `discover()` + `dispose()` | Medium |
| 3 | Create `ElgatoManagedDevice` with `getInfo()` for all models | Medium |
| 4 | Implement `drawKey()` with PNG → RGBA bridge | Medium |
| 5 | Implement event forwarding (buttons + knobs) | Small |
| 6 | Register driver in `DeviceManager` | Small |
| 7 | Add `'bottom'` to `KnobControl.side`, update UI for SD+ | Small |
| 8 | Write unit tests | Medium |
| 9 | Draw queue + timeout handling (mirror Loupedeck pattern) | Medium |
| 10 | End-to-end testing with physical device | Manual |
