import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register Service Worker for PWA — auto-reload on update
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // Check for updates every 60 seconds
      setInterval(() => reg.update(), 60_000);

      reg.addEventListener("updatefound", () => {
        const newSW = reg.installing;
        if (!newSW) return;
        newSW.addEventListener("statechange", () => {
          // New SW activated and there was a previous one → reload
          if (newSW.state === "activated" && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {});
  });
}
