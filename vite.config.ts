import { defineConfig } from 'vitest/config';

// `base` relatif : le build marche sur GitHub Pages (/hns-web/) comme en local.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
