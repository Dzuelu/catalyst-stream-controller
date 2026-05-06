# Discord Integration Plan

## Overview

Add Discord voice control to Catalyst Stream Controller via Discord's local RPC server. This follows the exact same architectural pattern as the existing OBS integration — a client class in `main/integrations/`, shared types, IPC channels, preload bridge, and ActionPanel UI.

Discord's desktop app runs a local WebSocket RPC server on `127.0.0.1` (ports 6463–6472). We connect to it, authenticate via OAuth2, and then can read/write voice settings, join/leave channels, and subscribe to live state updates.

> **Note:** Discord RPC is technically in "private beta" but the local server runs on every Discord desktop client. Users create a free Application at https://discord.com/developers/applications and paste their Client ID into our settings panel — same approach all stream deck Discord plugins use.

---

## Actions

| Action | RPC Command | Params | Notes |
|---|---|---|---|
| Toggle Mute | `SET_VOICE_SETTINGS` | — | Reads current `mute`, sends opposite |
| Toggle Deafen | `SET_VOICE_SETTINGS` | — | Reads current `deaf`, sends opposite |
| Set Mute | `SET_VOICE_SETTINGS` | `muted: bool` | Explicit on/off |
| Set Deafen | `SET_VOICE_SETTINGS` | `deafened: bool` | Explicit on/off |
| Join Voice Channel | `SELECT_VOICE_CHANNEL` | `channelId` | User picks from live list |
| Leave Voice Channel | `SELECT_VOICE_CHANNEL` | `null` | Leaves current channel |
| Set Input Volume | `SET_VOICE_SETTINGS` | `volume: 0–100` | Mic volume (good for knobs) |
| Set Output Volume | `SET_VOICE_SETTINGS` | `volume: 0–200` | Speaker volume (good for knobs) |
| Toggle Push-to-Talk | `SET_VOICE_SETTINGS` | — | Swap PTT ↔ Voice Activity mode |

---

## Live State

Subscribe to these RPC events to get real-time state for reactive button visuals:

| Event | State Updated |
|---|---|
| `VOICE_SETTINGS_UPDATE` | `muted`, `deafened`, `inputVolume`, `outputVolume`, `voiceMode` |
| `VOICE_CONNECTION_STATUS` | `voiceConnectionState` |
| `VOICE_CHANNEL_SELECT` | `currentVoiceChannelId` |

This enables buttons that show 🔴 when muted, 🟢 when live — changing appearance automatically.

---

## Auth Flow

Discord RPC uses OAuth2 for authorization. Unlike OBS (which just connects with a password), Discord requires a two-step auth:

1. **Connect** — scan ports 6463–6472 for the local RPC server
2. **AUTHORIZE** — send `{ cmd: 'AUTHORIZE', args: { client_id, scopes: ['rpc', 'rpc.voice.read', 'rpc.voice.write'] } }` → Discord shows an "Authorize?" modal to the user (first time only)
3. **Token exchange** — POST the returned `code` to `https://discord.com/api/oauth2/token` with client ID + secret to get an `access_token`
4. **AUTHENTICATE** — send `{ cmd: 'AUTHENTICATE', args: { access_token } }` → fully connected
5. **Persist** — store `access_token` in profile settings for auto-reconnect (no re-auth modal)

> **Simplification option:** Since this is a local-only app (not a web service), we can use the Implicit grant flow or store the token locally. The user only sees the Discord auth modal once.

---

## Architecture

### File Map

```
src/shared/discord-types.ts                    — NEW: types, action labels, state
src/main/integrations/DiscordRPCClient.ts      — NEW: client class
src/shared/types.ts                            — MODIFY: ActionType, IPC channels, ProfileData
src/main/actions/ActionExecutor.ts             — MODIFY: add 'discord' no-op case
src/main/ipc/handlers.ts                       — MODIFY: add Discord IPC handlers
src/preload/preload.ts                         — MODIFY: add Discord API methods
src/main/index.ts                              — MODIFY: instantiate + wire client
src/renderer/components/ActionPanel.svelte     — MODIFY: add Discord UI section
package.json                                   — MODIFY: add discord RPC dependency
```

### Data Flow (mirrors OBS exactly)

```
┌──────────────────────────────────────────────────────────────┐
│                      Renderer (Svelte)                       │
│                                                              │
│  ActionPanel.svelte                                          │
│  ├─ discordConnect()                                         │
│  ├─ discordGetVoiceChannels()                                │
│  ├─ onDiscordStateChanged(cb) ←── live state updates         │
│  └─ saveAction() → type:'discord' config                     │
└──────────────────────┬───────────────────────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────────────────────┐
│                      Main Process                            │
│                                                              │
│  index.ts                                                    │
│  ├─ discordClient = new DiscordRPCClient()                   │
│  ├─ actionExecutor.setDiscordClient(discordClient)           │
│  ├─ discordClient.setOnStateChanged → webContents.send()     │
│  └─ registerIpcHandlers(..., discordClient)                   │
│                                                              │
│  DiscordRPCClient                                            │
│  ├─ WebSocket → Discord local RPC (ws://127.0.0.1:6463-72)  │
│  ├─ OAuth2 auth (AUTHORIZE → token exchange → AUTHENTICATE)  │
│  ├─ State cache + event subscriptions → updateState()        │
│  └─ Auto-reconnect (5s interval)                             │
└──────────────────────────────────────────────────────────────┘
```

---

## Phases

### Phase 1: Types & Client Foundation
> Goal: Shared types + client class that can connect, authenticate, and track state.

- [ ] **1a.** Create `src/shared/discord-types.ts`
  - `DiscordConnectionSettings` — `{ clientId: string, accessToken?: string, autoConnect: boolean }`
  - `DiscordActionType` union — `'toggle-mute' | 'toggle-deafen' | 'set-mute' | 'set-deafen' | 'join-voice-channel' | 'leave-voice-channel' | 'set-input-volume' | 'set-output-volume' | 'toggle-push-to-talk'`
  - `DISCORD_ACTION_LABELS` — human-readable names for each action
  - `DISCORD_ACTION_PARAMS` — which params each action needs (like OBS_ACTION_PARAMS)
  - `DiscordActionConfig` — `{ discordAction, channelId?, muted?, deafened?, volume? }`
  - `DiscordVoiceChannel` — `{ id: string, name: string, guildName: string }`
  - `DiscordState` — `{ connected, authenticated, username, muted, deafened, inputVolume, outputVolume, voiceMode, currentVoiceChannelId, voiceConnectionState }`
  - `DEFAULT_DISCORD_STATE`, `DEFAULT_DISCORD_CONNECTION_SETTINGS`

- [ ] **1b.** Create `src/main/integrations/DiscordRPCClient.ts`
  - Raw WebSocket connection (scan ports 6463–6472)
  - RPC message framing (JSON payloads with `cmd`, `nonce`, `args`)
  - `connect(settings)` → find port → WebSocket handshake
  - `authorize(clientId)` → sends AUTHORIZE command → returns auth code
  - `authenticate(accessToken)` → sends AUTHENTICATE command
  - Full auth flow: connect → authorize → exchange code → authenticate → persist token
  - `disconnect()` with intentional flag
  - `getState()` / `setOnStateChanged()` / `updateState()` — same pattern as OBS
  - Subscribe to `VOICE_SETTINGS_UPDATE`, `VOICE_CONNECTION_STATUS`, `VOICE_CHANNEL_SELECT`
  - `getVoiceSettings()` → `GET_VOICE_SETTINGS` command
  - `getVoiceChannels()` → `GET_CHANNELS` for each guild, filter voice type
  - `destroy()` cleanup
  - Auto-reconnect on unexpected disconnect (5s timer)

- [ ] **1c.** Install dependency
  - No heavy npm dependency needed — Discord RPC is a simple WebSocket protocol
  - We'll implement the client directly with Node's `ws` or the built-in WebSocket
  - (Electron 40 has built-in WebSocket support in Node)

### Phase 2: Action Execution
> Goal: Client can execute all 9 Discord actions.

- [ ] **2a.** Add `executeAction(config: DiscordActionConfig)` to `DiscordRPCClient`
  - `toggle-mute` → `GET_VOICE_SETTINGS` → `SET_VOICE_SETTINGS { mute: !current }`
  - `toggle-deafen` → `GET_VOICE_SETTINGS` → `SET_VOICE_SETTINGS { deaf: !current }`
  - `set-mute` → `SET_VOICE_SETTINGS { mute: config.muted }`
  - `set-deafen` → `SET_VOICE_SETTINGS { deaf: config.deafened }`
  - `join-voice-channel` → `SELECT_VOICE_CHANNEL { channel_id: config.channelId }`
  - `leave-voice-channel` → `SELECT_VOICE_CHANNEL { channel_id: null }`
  - `set-input-volume` → `SET_VOICE_SETTINGS { input: { volume: config.volume } }`
  - `set-output-volume` → `SET_VOICE_SETTINGS { output: { volume: config.volume } }`
  - `toggle-push-to-talk` → `GET_VOICE_SETTINGS` → `SET_VOICE_SETTINGS { mode: { type: opposite } }`

### Phase 3: Wiring (IPC, Preload, Main)
> Goal: Renderer can connect/disconnect, execute actions, and receive state.

- [ ] **3a.** Update `src/shared/types.ts`
  - Add `'discord'` to `ActionType` union
  - Add IPC channels: `DISCORD_CONNECT`, `DISCORD_DISCONNECT`, `DISCORD_GET_STATE`, `DISCORD_GET_VOICE_CHANNELS`, `DISCORD_GET_CONNECTION_SETTINGS`, `DISCORD_SET_CONNECTION_SETTINGS`, `DISCORD_STATE_CHANGED`
  - Add `discordConnectionSettings?: DiscordConnectionSettings` to `ProfileData`

- [ ] **3b.** Update `src/main/actions/ActionExecutor.ts`
  - Add `'discord'` to the no-op case list (handled in index.ts, same as OBS)

- [ ] **3c.** Update `src/main/index.ts`
  - Import `DiscordRPCClient`
  - Instantiate: `discordClient = new DiscordRPCClient()`
  - Wire state broadcasting: `discordClient.setOnStateChanged(state => mainWindow.webContents.send(...))`
  - Call `actionExecutor.setDiscordClient(discordClient)`
  - Pass to `registerIpcHandlers(..., discordClient)`
  - Auto-connect on startup if `discordSettings.autoConnect && discordSettings.accessToken`
  - Add `'discord'` handling in `executeAction()` — delegate to `discordClient.executeAction(config)`

- [ ] **3d.** Update `src/main/ipc/handlers.ts`
  - Add `discordClient?: DiscordRPCClient` to `registerIpcHandlers` params
  - Add handlers for all Discord IPC channels (mirror OBS handlers)
  - `DISCORD_CONNECT` → `discordClient.connect(settings)` + persist settings
  - `DISCORD_DISCONNECT` → `discordClient.disconnect()`
  - `DISCORD_GET_STATE` → `discordClient.getState()`
  - `DISCORD_GET_VOICE_CHANNELS` → `discordClient.getVoiceChannels()`
  - `DISCORD_GET/SET_CONNECTION_SETTINGS` → `profileManager.get/setDiscordConnectionSettings()`

- [ ] **3e.** Update `src/preload/preload.ts`
  - Add `discordConnect()`, `discordDisconnect()`, `discordGetState()`, `discordGetVoiceChannels()`, `discordGetConnectionSettings()`, `discordSetConnectionSettings()`, `onDiscordStateChanged()`

- [ ] **3f.** Update `src/main/profiles/ProfileManager.ts`
  - Add `getDiscordConnectionSettings()` / `setDiscordConnectionSettings()` methods (mirror OBS pattern)

### Phase 4: ActionPanel UI
> Goal: Full Discord action configuration in the sidebar.

- [ ] **4a.** Add Discord connection panel (when `actionType === 'discord'`)
  - Connection status indicator (green/red dot + "Connected as Username" / "Not connected")
  - Connect / Disconnect button
  - Error display with troubleshooting ("Make sure Discord desktop app is running")
  - Collapsible settings panel:
    - Client ID text input (required — user gets this from Discord Developer Portal)
    - Auto-connect checkbox
    - Link to "Create a Discord Application" guide

- [ ] **4b.** Add Discord action selector
  - Dropdown populated from `DISCORD_ACTION_LABELS`
  - Dynamic parameter fields driven by `DISCORD_ACTION_PARAMS`:
    - `channelId` → `<select>` populated from live voice channel list (or manual input when disconnected)
    - `muted` / `deafened` → boolean dropdown (for set-mute / set-deafen)
    - `volume` → range slider 0–100 (input) or 0–200 (output)

- [ ] **4c.** Add Discord action options to multi-action step selector
  - Add `<option value="discord">Discord</option>` to both the main dropdown and the multi-action step dropdown
  - Add step config UI for Discord actions within multi-action steps

### Phase 5: Reactive Button State (Stretch Goal)
> Goal: Buttons change appearance based on live Discord state.

- [ ] **5a.** Design state-to-appearance mapping
  - When a button has a `discord:toggle-mute` action, and `discordState.muted === true`, show a red background / mute icon
  - When unmuted, show green background / mic icon
  - Same for deafen, voice connection, etc.

- [ ] **5b.** Implement state-driven button rendering
  - Subscribe to Discord state changes in the main process
  - When state changes, find all buttons with Discord actions and re-render their appearance
  - This affects both the physical device and the renderer preview

- [ ] **5c.** Knob volume control
  - When a knob is bound to `set-input-volume` or `set-output-volume`, rotating the knob adjusts the volume
  - The knob's rotate action sends relative volume changes (+/- per tick)

---

## Connection Settings UI

```
┌─────────────────────────────────────────┐
│ 🔴 Not connected to Discord            │
│                          [Connect]      │
│                                         │
│ ▸ Connection Settings                   │
│ ┌─────────────────────────────────────┐ │
│ │ Client ID: [_____________________] │ │
│ │ ☐ Auto-connect on startup          │ │
│ │                                     │ │
│ │ 💡 Create a free Discord app at     │ │
│ │    discord.com/developers           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ Discord Action: [Toggle Mute      ▾]   │
└─────────────────────────────────────────┘
```

When connected:
```
┌─────────────────────────────────────────┐
│ 🟢 Connected as Username     [Disconnect] │
│                                         │
│ Discord Action: [Join Voice Channel ▾]  │
│ Voice Channel:  [General          ▾]    │
└─────────────────────────────────────────┘
```

---

## Dependencies

**No new npm packages required.** Discord RPC is a straightforward WebSocket JSON protocol. We'll implement the client directly using Node.js WebSocket (available in Electron 40's Node.js runtime) to avoid depending on the unmaintained `discord-rpc` package.

The protocol is:
- Connect to `ws://127.0.0.1:{6463-6472}/?v=1&client_id={CLIENT_ID}`
- Send/receive JSON payloads with `{ cmd, nonce, args, evt, data }`
- Standard OAuth2 token exchange via HTTPS POST to `https://discord.com/api/oauth2/token`

We'll need `https` (Node built-in) for the token exchange.

---

## Token Storage

The OAuth2 `access_token` will be stored in `ProfileData.discordConnectionSettings.accessToken`. This means:
- Token persists across app restarts
- Token is included in profile export/import
- Different profiles can have different Discord configurations (unlikely but supported)

On auto-connect, if a stored token exists, we skip AUTHORIZE and go straight to AUTHENTICATE. If the token is expired/invalid, we fall back to the full auth flow.

---

## Risk & Complexity Assessment

| Area | Complexity | Risk | Notes |
|---|---|---|---|
| Types | Low | Low | Mirror OBS pattern |
| WebSocket client | Medium | Medium | Port scanning, message framing, nonce tracking |
| OAuth2 auth flow | High | Medium | Two-step auth, token exchange via HTTPS, token persistence |
| Action execution | Low | Low | Simple GET/SET voice settings commands |
| IPC + preload | Low | Low | Exact same pattern as OBS |
| ActionPanel UI | Medium | Low | Mirror OBS panel structure |
| Reactive buttons | High | Medium | New concept — state-driven appearance updates |
| Knob volume | Medium | Low | Extend existing knob binding model |

**Total estimate:** ~2x the OBS integration effort, primarily because of the OAuth2 auth flow and the reactive button state feature.

---

## Testing Checklist

- [ ] Connection succeeds when Discord desktop app is running
- [ ] Connection fails gracefully when Discord is not running (clear error message)
- [ ] Auth modal appears in Discord on first connect
- [ ] Token persists — subsequent connects skip the auth modal
- [ ] Auto-reconnect works when Discord restarts
- [ ] Toggle mute/deafen works and state updates reflect on the button
- [ ] Join/leave voice channel works
- [ ] Volume adjustment works via button and knob
- [ ] Settings persist across app restarts
- [ ] Profile export/import includes Discord settings
- [ ] Multi-action steps with Discord actions work
- [ ] Disconnecting from Discord doesn't crash the app
