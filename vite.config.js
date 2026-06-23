import { defineConfig } from 'vite';
import cesium from 'vite-plugin-cesium';
import { fileURLToPath, URL } from 'node:url';

// Resolve an HTML entry relative to this config file (ESM-safe; no __dirname).
const entry = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Relative base so the production build works under a subpath (e.g. GitHub Pages).
  base: './',
  plugins: [cesium()],
  build: {
    rollupOptions: {
      input: {
        main: entry('./index.html'),
        cesium: entry('./cesium.html'),
        three: entry('./three.html'),
        maplibre: entry('./maplibre.html'),
        fantasy: entry('./fantasy.html'),
      },
    },
  },
});
