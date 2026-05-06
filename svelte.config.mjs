import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  onwarn(warning, handler) {
    // Autofocus is intentional for inline rename/create inputs
    if (warning.code === 'a11y_autofocus') return;
    handler(warning);
  }
};
