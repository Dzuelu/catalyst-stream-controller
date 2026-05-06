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

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Catalyst Stream Controller',
    executableName: 'catalyst-stream-controller',
    icon: path.resolve(__dirname, 'build/icon'),
    extraResource: [
      ...(process.platform === 'linux' ? [path.resolve(__dirname, 'build/linux/scripts/active-window')] : [])
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
