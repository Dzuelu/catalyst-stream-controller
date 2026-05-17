import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'node:path';
import fs from 'node:fs';

// Native modules that Vite marks as external and must be available at runtime.
// The VitePlugin doesn't put node_modules in the asar, so we use afterCopy to
// copy them into the packaged app's node_modules alongside the asar.
const nativeModules = ['canvas', 'node-hid', 'serialport', '@serialport', '@elgato-stream-deck', 'bufferutil', 'utf-8-validate'];

/**
 * Recursively collect all production dependencies for the given module names.
 * Walks each module's package.json `dependencies` to discover transitive deps
 * (e.g. tslib) so we don't have to track them manually.
 */
function collectAllDeps(rootNodeModules: string, entryModules: string[]): Set<string> {
  const collected = new Set<string>();
  const queue = [...entryModules];

  while (queue.length > 0) {
    const mod = queue.pop()!;
    if (collected.has(mod)) continue;

    const modDir = path.join(rootNodeModules, mod);
    if (!fs.existsSync(modDir)) continue;

    collected.add(mod);

    const pkgPath = path.join(modDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.dependencies) {
        queue.push(...Object.keys(pkg.dependencies));
      }
    }

    // For scoped packages listed as a prefix (e.g. '@serialport'), also
    // discover all sub-packages under that scope in node_modules.
    if (mod.startsWith('@') && !mod.includes('/')) {
      const scopeDir = path.join(rootNodeModules, mod);
      if (fs.existsSync(scopeDir) && fs.statSync(scopeDir).isDirectory()) {
        for (const child of fs.readdirSync(scopeDir)) {
          queue.push(`${mod}/${child}`);
        }
      }
    }
  }

  return collected;
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: `**/node_modules/{${nativeModules.join(',')}}/**`
    },
    name: 'Catalyst Stream Controller',
    executableName: 'catalyst-stream-controller',
    icon: path.resolve(__dirname, 'build/icon'),
    extraResource: [
      ...(process.platform === 'linux' ? [path.resolve(__dirname, 'build/linux/scripts/active-window')] : [])
    ],
    afterCopy: [
      (
        buildPath: string,
        _electronVersion: string,
        _platform: string,
        _arch: string,
        callback: (err?: Error | null) => void
      ) => {
        const rootNodeModules = path.resolve(__dirname, 'node_modules');
        const targetNodeModules = path.join(buildPath, 'node_modules');
        fs.mkdirSync(targetNodeModules, { recursive: true });

        const allDeps = collectAllDeps(rootNodeModules, nativeModules);
        for (const mod of allDeps) {
          const src = path.join(rootNodeModules, mod);
          if (fs.existsSync(src)) {
            const dest = path.join(targetNodeModules, mod);
            fs.cpSync(src, dest, { recursive: true });
          }
        }
        callback();
      }
    ]
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDeb({
      options: {
        depends: [
          'libudev1',
          'libusb-1.0-0',
          'libcairo2',
          'libpango-1.0-0',
          'libpangocairo-1.0-0',
          'libjpeg62-turbo | libjpeg-turbo8',
          'libgif7',
          'librsvg2-2'
        ],
        scripts: {
          postinst: path.resolve(__dirname, 'build/linux/scripts/postinstall'),
          postrm: path.resolve(__dirname, 'build/linux/scripts/postremove')
        }
      }
    }),
    new MakerRpm({
      options: {
        requires: ['systemd-libs', 'libusb1', 'cairo', 'pango', 'libjpeg-turbo', 'giflib', 'librsvg2'],
        // scripts is supported by electron-installer-redhat but not in the typed config
        scripts: {
          post: path.resolve(__dirname, 'build/linux/scripts/postinstall'),
          postun: path.resolve(__dirname, 'build/linux/scripts/postremove')
        }
      } as Record<string, unknown>
    })
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts'
        }
      ]
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
