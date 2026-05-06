import { vi } from 'vitest';
import { EventEmitter } from 'node:events';

/**
 * Mock for the `obs-websocket-js` module.
 *
 * Usage in tests:
 *   import { getMockOBSInstance } from '../mocks/obs-websocket-js';
 *   const obs = getMockOBSInstance();
 *   obs.call.mockResolvedValueOnce({ scenes: [...], currentProgramSceneName: 'Scene1' });
 */

/** Tracks the last-created mock instance so tests can grab it */
let lastInstance: MockOBSWebSocket | null = null;

class MockOBSWebSocket extends EventEmitter {
  connected = false;

  connect = vi.fn(async (_url?: string, _password?: string, _options?: Record<string, unknown>) => {
    this.connected = true;
  });

  disconnect = vi.fn(async () => {
    this.connected = false;
    this.emit('ConnectionClosed');
  });

  call = vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    // Return sensible defaults based on method name
    switch (method) {
      case 'GetSceneList':
        return { scenes: [], currentProgramSceneName: '' };
      case 'GetCurrentProgramScene':
        return { currentProgramSceneName: 'Scene 1', sceneName: 'Scene 1' };
      case 'GetInputList':
        return { inputs: [] };
      case 'GetStreamStatus':
        return { outputActive: false, outputReconnecting: false, outputTimecode: '00:00:00', outputBytes: 0 };
      case 'GetRecordStatus':
        return { outputActive: false, outputPaused: false, outputTimecode: '00:00:00', outputBytes: 0 };
      case 'GetVirtualCamStatus':
        return { outputActive: false };
      case 'GetReplayBufferStatus':
        return { outputActive: false };
      case 'GetInputMute':
        return { inputMuted: false };
      case 'GetSceneItemId':
        return { sceneItemId: 1 };
      case 'GetSceneItemEnabled':
        return { sceneItemEnabled: true };
      default:
        return {};
    }
  });

  constructor() {
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastInstance = this;
  }
}

/** Get the most recently created mock OBS instance (for test assertions) */
export function getMockOBSInstance(): MockOBSWebSocket {
  if (!lastInstance) {
    throw new Error('No MockOBSWebSocket instance created yet — has OBSWebSocketClient been instantiated?');
  }
  return lastInstance;
}

/** Reset the instance tracker between tests */
export function resetMockOBS(): void {
  lastInstance = null;
}

// Default export matches the real module's `import OBSWebSocket from 'obs-websocket-js'`
export default MockOBSWebSocket;
