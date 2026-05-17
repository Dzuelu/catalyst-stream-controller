import { defineConfig } from 'vite';

// Resolve native modules from the app.asar.unpacked directory at runtime.
// When electron-forge packages the app, asar-unpacked native modules live
// outside the asar archive.  Vite's `external` emits bare require('canvas')
// which resolves relative to .vite/build/ inside the asar — missing the
// unpacked copy.  This plugin rewrites those imports to absolute paths.
function nativeExternalsPlugin() {
  const nativeModules = ['canvas', 'serialport', '@serialport/bindings-cpp', '@elgato-stream-deck/node', 'node-hid'];
  // Optional native modules that may not be installed (e.g., ws optional deps)
  const optionalModules = ['bufferutil', 'utf-8-validate'];
  return {
    name: 'native-externals',
    config() {
      return {
        build: {
          rollupOptions: {
            external: [...nativeModules, ...optionalModules]
          }
        }
      };
    },
    renderChunk(code: string) {
      let result = code;
      for (const mod of nativeModules) {
        // Match require("module") or require('module')
        const pattern = new RegExp(`require\\(["']${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\)`, 'g');
        // Wrap in a conditional: use asar.unpacked path if available (packaged app),
        // otherwise fall back to normal node_modules resolution (development mode)
        const resolutionCode = `(() => {
  try {
    const resourcesPath = require("node:process").resourcesPath;
    if (resourcesPath && require("node:fs").existsSync(require("node:path").join(resourcesPath, "app.asar.unpacked"))) {
      return require(require("node:path").join(resourcesPath, "app.asar.unpacked", "node_modules", "${mod}"));
    }
  } catch {}
  return require("${mod}");
})()`;
        result = result.replace(pattern, resolutionCode);
      }
      // Handle optional modules gracefully (fail silently if not installed)
      for (const mod of optionalModules) {
        const pattern = new RegExp(`require\\(["']${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']\\)`, 'g');
        const resolutionCode = `(() => {
  try {
    const resourcesPath = require("node:process").resourcesPath;
    if (resourcesPath && require("node:fs").existsSync(require("node:path").join(resourcesPath, "app.asar.unpacked"))) {
      try {
        return require(require("node:path").join(resourcesPath, "app.asar.unpacked", "node_modules", "${mod}"));
      } catch {}
    }
    return require("${mod}");
  } catch {
    return null;
  }
})()`;
        result = result.replace(pattern, resolutionCode);
      }
      return result === code ? null : result;
    }
  };
}

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@shared': '/src/shared'
    }
  },
  plugins: [nativeExternalsPlugin()]
});
