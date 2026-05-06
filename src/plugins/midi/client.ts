import type { PluginClient, PluginClientFactory, PluginHostAPI } from '../../shared/plugin-types';

// ─── MIDI Protocol ─────────────────────────────────────────────
//
// MIDI output is handled via the Web MIDI API (navigator.requestMIDIAccess)
// when running in the renderer, or via a native MIDI library in the main
// process.  Because this plugin runs in the main process (Electron), we
// rely on the `midi` npm package (or similar) which exposes virtual and
// hardware MIDI ports.
//
// However — to keep the plugin unit-testable and free of native deps at
// build time — the client constructs raw MIDI byte arrays and writes them
// through a thin, injectable transport layer.  In production the transport
// calls the native MIDI library; in tests it can be swapped for a mock.
//
// Message format reference (status byte | data bytes):
//   Note On:        0x90+ch, note, velocity
//   Note Off:       0x80+ch, note, velocity(0)
//   Control Change: 0xB0+ch, controller, value
//   Program Change: 0xC0+ch, program
//   Pitch Bend:     0xE0+ch, lsb, msb
//   MMC (SysEx):    0xF0, 0x7F, 0x7F, 0x06, command, 0xF7
// ────────────────────────────────────────────────────────────────

// ─── State ─────────────────────────────────────────────────────

interface MidiState {
  connected: boolean;
  outputPortName: string | null;
  outputPortCount: number;
}

const DEFAULT_STATE: MidiState = {
  connected: false,
  outputPortName: null,
  outputPortCount: 0
};

const RECONNECT_INTERVAL_MS = 10_000;

// ─── MMC command bytes ─────────────────────────────────────────

const MMC_PLAY = 0x02;
const MMC_STOP = 0x01;
const MMC_RECORD_STROBE = 0x06;
const MMC_REWIND = 0x05;
const MMC_FAST_FORWARD = 0x04;

// ─── MIDI output abstraction ───────────────────────────────────
//
// The native `midi` package (node-midi) is optional.  We dynamically
// require() it so the plugin can be type-checked and tested without a
// native build.  If the package isn't installed, port enumeration and
// output calls are no-ops.

interface MidiOutputPort {
  /** Open the port at the given index (0-based). */
  openPort(index: number): void;
  /** Close the currently-open port. */
  closePort(): void;
  /** Send a raw MIDI message (array of bytes). */
  sendMessage(message: number[]): void;
  /** Return the number of available output ports. */
  getPortCount(): number;
  /** Return the name of the port at the given index. */
  getPortName(index: number): string;
}

/** Attempt to load the native `midi` package. Returns null if unavailable. */
function tryLoadMidiOutput(): MidiOutputPort | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const midi = require('midi');
    return new midi.Output() as MidiOutputPort;
  } catch {
    return null;
  }
}

// ─── CC toggle state (per channel/controller) ──────────────────

type CcKey = `${number}:${number}`;

// ─── Client Implementation ─────────────────────────────────────

class MidiPluginClient implements PluginClient {
  private state: MidiState = { ...DEFAULT_STATE };
  private settings: Record<string, unknown> | null = null;
  private onStateChangedHandler: ((state: Record<string, unknown>) => void) | null = null;
  private hostAPI: PluginHostAPI;

  private intentionalDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  /** Native MIDI output — null when the midi package is not installed. */
  private midiOutput: MidiOutputPort | null = null;

  /** Index of the currently open output port (-1 = none). */
  private openPortIndex = -1;

  /** Toggle state for send-cc-toggle action (keyed by "channel:cc"). */
  private ccToggleState: Map<CcKey, boolean> = new Map();

  /** Cumulative knob CC values (keyed by "channel:cc"), clamped 0–127. */
  private knobCcValues: Map<CcKey, number> = new Map();

  constructor(hostAPI: PluginHostAPI) {
    this.hostAPI = hostAPI;
  }

  // ─── PluginClient interface ────────────────────────────────

  async connect(settings: Record<string, unknown>): Promise<void> {
    this.settings = settings;
    this.intentionalDisconnect = false;
    this.clearReconnectTimer();

    const outputPort = settings.outputPort as string;
    if (!outputPort && outputPort !== '0') {
      throw new Error('MIDI output port is required — select a port from the dropdown');
    }

    // Load native midi if not already loaded
    if (!this.midiOutput) {
      this.midiOutput = tryLoadMidiOutput();
    }

    if (!this.midiOutput) {
      throw new Error(
        'MIDI library not available — install the "midi" npm package (' +
          'npm install midi) and restart the application'
      );
    }

    try {
      this.hostAPI.log('info', `Opening MIDI output port "${outputPort}"…`);

      const portCount = this.midiOutput.getPortCount();
      this.updateState({ outputPortCount: portCount });

      // Find the port by name
      let portIndex = -1;
      for (let i = 0; i < portCount; i++) {
        if (this.midiOutput.getPortName(i) === outputPort) {
          portIndex = i;
          break;
        }
      }

      // Fall back to numeric index if name didn't match
      if (portIndex === -1) {
        const parsed = parseInt(outputPort, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < portCount) {
          portIndex = parsed;
        }
      }

      if (portIndex === -1) {
        throw new Error(`MIDI output port "${outputPort}" not found. ${portCount} port(s) available.`);
      }

      this.midiOutput.openPort(portIndex);
      this.openPortIndex = portIndex;

      const portName = this.midiOutput.getPortName(portIndex);
      this.updateState({
        connected: true,
        outputPortName: portName,
        outputPortCount: portCount
      });

      this.hostAPI.log('info', `MIDI output opened: ${portName}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hostAPI.log('error', `MIDI connection failed: ${msg}`);
      this.updateState({ connected: false });
      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.midiOutput && this.openPortIndex >= 0) {
      try {
        this.midiOutput.closePort();
      } catch {
        // Ignore close errors
      }
    }
    this.openPortIndex = -1;
    this.ccToggleState.clear();
    this.knobCcValues.clear();
    this.state = { ...DEFAULT_STATE };
    this.emitStateChanged();
    this.hostAPI.log('info', 'MIDI output closed');
  }

  isConnected(): boolean {
    return this.state.connected;
  }

  getState(): Record<string, unknown> {
    return { ...this.state } as unknown as Record<string, unknown>;
  }

  setOnStateChanged(handler: ((state: Record<string, unknown>) => void) | null): void {
    this.onStateChangedHandler = handler;
  }

  async executeAction(config: Record<string, unknown>): Promise<void> {
    if (!this.state.connected) {
      this.hostAPI.log('warn', 'Cannot execute MIDI action — not connected');
      return;
    }

    const action = (config.pluginAction as string) ?? '';

    try {
      switch (action) {
        case 'send-note-on':
          this.sendNoteOn(this.parseChannel(config.channel), Number(config.note ?? 60), Number(config.velocity ?? 100));
          break;

        case 'send-note-off':
          this.sendNoteOff(this.parseChannel(config.channel), Number(config.note ?? 60));
          break;

        case 'send-cc':
          this.sendCC(this.parseChannel(config.channel), Number(config.controller ?? 1), Number(config.value ?? 64));
          break;

        case 'send-cc-toggle': {
          const ch = this.parseChannel(config.channel);
          const cc = Number(config.controller ?? 64);
          const key: CcKey = `${ch}:${cc}`;
          const current = this.ccToggleState.get(key) ?? false;
          const newVal = !current;
          this.ccToggleState.set(key, newVal);
          this.sendCC(ch, cc, newVal ? 127 : 0);
          break;
        }

        case 'send-program-change':
          this.sendProgramChange(this.parseChannel(config.channel), Number(config.program ?? 0));
          break;

        case 'send-pitch-bend':
          this.sendPitchBend(this.parseChannel(config.channel), Number(config.value ?? 8192));
          break;

        case 'transport-play':
          this.sendMMC(MMC_PLAY);
          break;

        case 'transport-stop':
          this.sendMMC(MMC_STOP);
          break;

        case 'transport-record':
          this.sendMMC(MMC_RECORD_STROBE);
          break;

        case 'transport-rewind':
          this.sendMMC(MMC_REWIND);
          break;

        case 'transport-fast-forward':
          this.sendMMC(MMC_FAST_FORWARD);
          break;

        case 'knob-cc': {
          const ch = this.parseChannel(config.channel);
          const cc = Number(config.controller ?? 1);
          const step = Number(config.stepSize ?? 4);
          const direction = config.direction as string | undefined;
          const key: CcKey = `${ch}:${cc}`;
          const current = this.knobCcValues.get(key) ?? 64;
          const delta = direction === 'ccw' ? -step : step;
          const next = Math.max(0, Math.min(127, current + delta));
          this.knobCcValues.set(key, next);
          this.sendCC(ch, cc, next);
          break;
        }

        default:
          this.hostAPI.log('warn', `Unknown MIDI action: ${action}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.hostAPI.log('error', `MIDI action "${action}" failed: ${msg}`);
    }
  }

  destroy(): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    if (this.midiOutput && this.openPortIndex >= 0) {
      try {
        this.midiOutput.closePort();
      } catch {
        // Ignore close errors on shutdown
      }
    }
    this.openPortIndex = -1;
  }

  /** Dynamic dropdown queries for MIDI ports */
  queries: Record<string, () => Promise<Array<{ value: string; label: string }>>> = {
    getOutputPorts: async () => {
      if (!this.midiOutput) {
        // Try loading the library just for enumeration
        this.midiOutput = tryLoadMidiOutput();
      }
      if (!this.midiOutput) return [];

      const count = this.midiOutput.getPortCount();
      const ports: Array<{ value: string; label: string }> = [];
      for (let i = 0; i < count; i++) {
        const name = this.midiOutput.getPortName(i);
        ports.push({ value: name, label: name });
      }
      return ports;
    }
  };

  // ─── Internal: MIDI message senders ─────────────────────────

  private send(bytes: number[]): void {
    if (!this.midiOutput || this.openPortIndex < 0) {
      this.hostAPI.log('warn', 'MIDI output not open');
      return;
    }
    this.midiOutput.sendMessage(bytes);
  }

  private parseChannel(ch: unknown): number {
    const parsed = Number(ch ?? 1);
    return Math.max(0, Math.min(15, parsed - 1)); // 1-based → 0-based
  }

  /** Note On: 0x90 + channel, note, velocity */
  private sendNoteOn(channel: number, note: number, velocity: number): void {
    const n = Math.max(0, Math.min(127, note));
    const v = Math.max(1, Math.min(127, velocity));
    this.send([0x90 + channel, n, v]);
    this.hostAPI.log('info', `Note On: ch=${channel + 1} note=${n} vel=${v}`);
  }

  /** Note Off: 0x80 + channel, note, 0 */
  private sendNoteOff(channel: number, note: number): void {
    const n = Math.max(0, Math.min(127, note));
    this.send([0x80 + channel, n, 0]);
    this.hostAPI.log('info', `Note Off: ch=${channel + 1} note=${n}`);
  }

  /** Control Change: 0xB0 + channel, controller, value */
  private sendCC(channel: number, controller: number, value: number): void {
    const cc = Math.max(0, Math.min(127, controller));
    const val = Math.max(0, Math.min(127, value));
    this.send([0xb0 + channel, cc, val]);
    this.hostAPI.log('info', `CC: ch=${channel + 1} cc=${cc} val=${val}`);
  }

  /** Program Change: 0xC0 + channel, program */
  private sendProgramChange(channel: number, program: number): void {
    const p = Math.max(0, Math.min(127, program));
    this.send([0xc0 + channel, p]);
    this.hostAPI.log('info', `Program Change: ch=${channel + 1} prog=${p}`);
  }

  /** Pitch Bend: 0xE0 + channel, lsb, msb (14-bit value 0–16383, center=8192) */
  private sendPitchBend(channel: number, value: number): void {
    const clamped = Math.max(0, Math.min(16383, value));
    const lsb = clamped & 0x7f;
    const msb = (clamped >> 7) & 0x7f;
    this.send([0xe0 + channel, lsb, msb]);
    this.hostAPI.log('info', `Pitch Bend: ch=${channel + 1} val=${clamped}`);
  }

  /** MIDI Machine Control (SysEx): F0 7F 7F 06 <cmd> F7 */
  private sendMMC(command: number): void {
    this.send([0xf0, 0x7f, 0x7f, 0x06, command, 0xf7]);
    const names: Record<number, string> = {
      [MMC_STOP]: 'Stop',
      [MMC_PLAY]: 'Play',
      [MMC_FAST_FORWARD]: 'Fast Forward',
      [MMC_REWIND]: 'Rewind',
      [MMC_RECORD_STROBE]: 'Record'
    };
    this.hostAPI.log('info', `MMC: ${names[command] ?? `0x${command.toString(16)}`}`);
  }

  // ─── Internal: State Management ─────────────────────────────

  private updateState(partial: Partial<MidiState>): void {
    this.state = { ...this.state, ...partial };
    this.emitStateChanged();
  }

  private emitStateChanged(): void {
    if (this.onStateChangedHandler) {
      this.onStateChangedHandler({ ...this.state } as unknown as Record<string, unknown>);
    }
  }

  // ─── Internal: Reconnection ─────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.intentionalDisconnect || !this.settings) return;
    this.hostAPI.log('info', `Scheduling MIDI reconnect in ${RECONNECT_INTERVAL_MS}ms…`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.intentionalDisconnect || !this.settings) return;
      try {
        await this.connect(this.settings);
      } catch {
        // connect() schedules another reconnect on failure
      }
    }, RECONNECT_INTERVAL_MS);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// ─── Factory ───────────────────────────────────────────────────

export const createClient: PluginClientFactory = (hostAPI: PluginHostAPI): PluginClient => {
  return new MidiPluginClient(hostAPI);
};
