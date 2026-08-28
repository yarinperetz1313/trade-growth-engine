import {
  defineConfig
} from "vite";

import react from
  "@vitejs/plugin-react";

export default defineConfig({
  cacheDir:
    process.env.VITE_CACHE_DIR ||
    "node_modules/.vite",
  plugins: [
    react()
  ],

  build: {
    emptyOutDir: false
  },

  server: {
    port: 5173
  }
});
