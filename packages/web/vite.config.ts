import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v2": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  // SPA fallback — /join/:code etc. all resolve to index.html
  appType: "spa",
});
