import type { OSCApi } from '../preload/preload';

declare global {
  interface Window {
    osc: OSCApi;
  }
}
