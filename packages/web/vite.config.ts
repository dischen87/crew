import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

// Plugin: inject build version into sw.js so every deploy produces a
// byte-different service worker → browser detects update automatically
function swVersionPlugin() {
  const version = Date.now().toString(36);
  return {
    name: "sw-version",
    writeBundle(options: { dir?: string }) {
      const outDir = options.dir || "dist";
      const swPath = resolve(outDir, "sw.js");
      try {
        let sw = readFileSync(swPath, "utf-8");
        sw = sw.replace("__BUILD_VERSION__", version);
        writeFileSync(swPath, sw);
        console.log(`[sw-version] Injected build version: ${version}`);
      } catch {
        // sw.js not found in output — skip
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
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
