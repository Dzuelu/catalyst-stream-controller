/** Vite raw-import suffixes (e.g. `import svg from './file.svg?raw'`) */
declare module '*.svg?raw' {
  const content: string;
  export default content;
}
