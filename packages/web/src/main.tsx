import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { isNativeApp } from "./lib/native";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Native app: configure StatusBar & Keyboard
if (isNativeApp()) {
  import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
    StatusBar.setStyle({ style: Style.Light });
    StatusBar.setBackgroundColor({ color: "#f0ddf5" });
  });
  import("@capacitor/keyboard").then(({ Keyboard }) => {
    Keyboard.setAccessoryBarVisible({ isVisible: true });
  });
}

// Register Service Worker for PWA (skip in native app — Capacitor handles caching)
if (!isNativeApp() && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
