import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // Relative asset URLs: the static build works from any sub-path (e.g. GitHub Pages /plc-world/); routing is
  // hash-based, so the page itself is always index.html.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // The 3D stack is only loaded by 3D routes; split it so no chunk is huge and the libraries cache
          // independently of the app code: React · three core · React Three Fiber + helpers · post-processing.
          // Priorities matter: a group also takes its modules' dependencies unless a higher-priority group already
          // claimed them, so React (needed by the entry) is claimed first and never lands in a 3D chunk.
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|use-sync-external-store|zustand)[\\/]/, priority: 40 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
            { name: 'r3f', test: /node_modules[\\/](@react-three[\\/](fiber|drei)|three-stdlib|camera-controls|maath|@monogrid)[\\/]/, priority: 25 },
            { name: 'postfx', test: /node_modules[\\/](postprocessing|n8ao|@react-three[\\/]postprocessing)[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
});
