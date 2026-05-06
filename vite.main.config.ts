import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/src/shared'
    }
  },
  build: {
    rollupOptions: {
      external: [
        // Native addons and modules that shouldn't be bundled
        'canvas',
        'serialport',
        '@serialport/bindings-cpp',
        // Elgato Stream Deck — native HID/USB bindings
        '@elgato-stream-deck/node',
        'node-hid',
        'usb',
        // Optional native deps of ws (used by obs-websocket-js)
        'bufferutil',
        'utf-8-validate'
      ]
    }
  }
});
