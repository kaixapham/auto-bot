import { defineConfig } from 'vite';
export default defineConfig({
  base: './',   // relative asset URLs: the build runs from any sub-path (GitHub Pages project site)
  build: { target: 'esnext' },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
