/**
 * Augment Electron's App interface with our custom properties.
 * Kept in a standalone .d.ts file to avoid "Duplicate identifier" errors
 * that occur when module augmentation is inside a runtime .ts file.
 *
 * We augment the Electron namespace directly (where App is an interface)
 * rather than the 'electron' module (where App is a type alias).
 */
declare namespace Electron {
  interface App {
    isQuitting: boolean;
  }
}
