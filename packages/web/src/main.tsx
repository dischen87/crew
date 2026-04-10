import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// ---------- PWA update system ----------
// Ensures every deploy reaches all local PWA installations reliably.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");

      // --- Periodic update checks ---
      setInterval(() => reg.update(), 30_000); // every 30 s while open

      // --- Check on app focus / visibility (e.g. PWA brought back) ---
      const checkOnFocus = () => reg.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") checkOnFocus();
      });
      window.addEventListener("focus", checkOnFocus);

      // --- Check when device comes back online ---
      window.addEventListener("online", checkOnFocus);

      // --- Handle new SW found ---
      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;

        newSW.addEventListener("statechange", () => {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            // New SW is installed but waiting — tell it to activate now
            newSW.postMessage("SKIP_WAITING");
          }
        });
      });

      // --- Reload when a new SW takes over ---
      // This fires once when controllerchange happens — reliable across all browsers
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      // --- Listen for SW messages ---
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "SW_UPDATED" && !refreshing) {
          refreshing = true;
          window.location.reload();
        }
        // Background Sync: SW delegates score sync to main thread
        if (event.data?.type === "SYNC_SCORES") {
          import("./lib/syncEngine").then((m) => m.syncPendingScores());
        }
      });

      // Setup fallback sync for browsers without Background Sync (iOS Safari)
      import("./lib/syncEngine").then((m) => m.setupFallbackSync());
    } catch {
      // SW registration failed — app works without it
    }
  });
}
