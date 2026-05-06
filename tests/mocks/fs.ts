import { vi } from 'vitest';

/**
 * In-memory filesystem mock for `node:fs` (promises API).
 *
 * Covers the surface area used by ProfileManager:
 *   - fs.promises.readFile
 *   - fs.promises.writeFile
 *   - fs.promises.mkdir
 *   - fs.existsSync (sync, still used in some places)
 *
 * Usage in tests:
 *   import { mockFs, resetMockFs } from '../mocks/fs';
 *   mockFs.setFile('/path/to/file.json', '{"version": 3}');
 *   const content = await fs.promises.readFile('/path/to/file.json', 'utf-8');
 */

/** In-memory file storage */
const files = new Map<string, string>();

/** In-memory directory set */
const dirs = new Set<string>();

// ─── Promises API (used by ProfileManager) ──────────────────────

const readFile = vi.fn(async (filePath: string, _encoding?: string): Promise<string> => {
  const p = String(filePath);
  if (!files.has(p)) {
    const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  return files.get(p)!;
});

const writeFile = vi.fn(async (filePath: string, data: string): Promise<void> => {
  files.set(String(filePath), String(data));
});

const mkdir = vi.fn(async (_dirPath: string, _options?: Record<string, unknown>): Promise<void> => {
  dirs.add(String(_dirPath));
});

const readdir = vi.fn(async (dirPath: string): Promise<string[]> => {
  const p = String(dirPath);
  const entries: string[] = [];
  for (const filePath of files.keys()) {
    if (filePath.startsWith(p + '/')) {
      const relative = filePath.slice(p.length + 1);
      const topLevel = relative.split('/')[0];
      if (!entries.includes(topLevel)) {
        entries.push(topLevel);
      }
    }
  }
  return entries;
});

const unlink = vi.fn(async (filePath: string): Promise<void> => {
  files.delete(String(filePath));
});

const access = vi.fn(async (filePath: string): Promise<void> => {
  if (!files.has(String(filePath)) && !dirs.has(String(filePath))) {
    const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
});

const stat = vi.fn(async (filePath: string) => {
  const p = String(filePath);
  const isDir = dirs.has(p) || Array.from(files.keys()).some((f) => f.startsWith(p + '/'));
  const isFile = files.has(p);
  if (!isDir && !isFile) {
    const err = new Error(`ENOENT: no such file or directory, stat '${p}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  return {
    isDirectory: () => isDir,
    isFile: () => isFile,
    size: isFile ? (files.get(p)?.length ?? 0) : 0,
    mtime: new Date()
  };
});

const rm = vi.fn(async (filePath: string, _options?: Record<string, unknown>): Promise<void> => {
  const p = String(filePath);
  // Remove the file itself
  files.delete(p);
  dirs.delete(p);
  // Remove all files under this path (recursive)
  for (const key of Array.from(files.keys())) {
    if (key.startsWith(p + '/')) files.delete(key);
  }
  for (const key of Array.from(dirs)) {
    if (key.startsWith(p + '/') || key === p) dirs.delete(key);
  }
});

const rename = vi.fn(async (oldPath: string, newPath: string): Promise<void> => {
  const op = String(oldPath);
  const np = String(newPath);
  // Move all files under oldPath to newPath
  for (const [key, value] of Array.from(files.entries())) {
    if (key === op) {
      files.delete(key);
      files.set(np, value);
    } else if (key.startsWith(op + '/')) {
      files.delete(key);
      files.set(np + key.slice(op.length), value);
    }
  }
  for (const key of Array.from(dirs)) {
    if (key === op || key.startsWith(op + '/')) {
      dirs.delete(key);
      dirs.add(np + key.slice(op.length));
    }
  }
});

export const promises = {
  readFile,
  writeFile,
  mkdir,
  readdir,
  unlink,
  access,
  stat,
  rm,
  rename
};

// ─── Sync API (some modules use sync fs methods) ────────────────

export const existsSync = vi.fn((filePath: string): boolean => {
  return files.has(String(filePath)) || dirs.has(String(filePath));
});

export const readFileSync = vi.fn((filePath: string, _encoding?: string): string => {
  const p = String(filePath);
  if (!files.has(p)) {
    const err = new Error(`ENOENT: no such file or directory, open '${p}'`) as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    throw err;
  }
  return files.get(p)!;
});

export const writeFileSync = vi.fn((filePath: string, data: string): void => {
  files.set(String(filePath), String(data));
});

export const mkdirSync = vi.fn((_dirPath: string, _options?: Record<string, unknown>): void => {
  dirs.add(String(_dirPath));
});

// ─── Test Helpers ────────────────────────────────────────────────

/** Set a file's contents in the mock filesystem */
export function setFile(filePath: string, content: string): void {
  files.set(filePath, content);
}

/** Get a file's contents from the mock filesystem (or undefined if absent) */
export function getFile(filePath: string): string | undefined {
  return files.get(filePath);
}

/** Check if a file exists in the mock filesystem */
export function hasFile(filePath: string): boolean {
  return files.has(filePath);
}

/** Get all file paths in the mock filesystem */
export function getAllFiles(): string[] {
  return Array.from(files.keys());
}

/** Reset all mock filesystem state */
export function resetMockFs(): void {
  files.clear();
  dirs.clear();
  readFile.mockClear();
  writeFile.mockClear();
  mkdir.mockClear();
  readdir.mockClear();
  unlink.mockClear();
  access.mockClear();
  stat.mockClear();
  rm.mockClear();
  rename.mockClear();
  existsSync.mockClear();
  readFileSync.mockClear();
  writeFileSync.mockClear();
  mkdirSync.mockClear();
}

/** Export as a namespace that matches `import { promises as fs } from 'node:fs'` */
export default {
  promises,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync
};
