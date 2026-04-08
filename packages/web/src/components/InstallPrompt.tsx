import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { isNativeApp } from "../lib/native";

/**
 * Shows a subtle "Add to Home Screen" prompt for users who haven't installed the PWA.
 * - Android: Uses native beforeinstallprompt event
 * - iOS: Shows manual instructions (iOS doesn't support beforeinstallprompt)
 * - Native app (Capacitor): Never shown — already installed via App Store.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Never show in native app — already installed via App Store
    if (isNativeApp()) return;
    // Don't show if already dismissed or already installed
    if (localStorage.getItem("crew_pwa_dismissed")) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Android/Chrome: listen for install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    // iOS Safari: detect and show manual prompt
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isSafari = /safari/i.test(navigator.userAgent) && !/chrome|crios/i.test(navigator.userAgent);
    if (isIos && isSafari) {
      // Show after 3 seconds
      const timer = setTimeout(() => setShowIosPrompt(true), 3000);
      return () => { clearTimeout(timer); window.removeEventListener("beforeinstallprompt", handler); };
    }

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") {
      setDeferredPrompt(null);
    }
    dismiss();
  };

  const dismiss = () => {
    setDismissed(true);
    setShowIosPrompt(false);
    setDeferredPrompt(null);
    localStorage.setItem("crew_pwa_dismissed", "1");
  };

  const show = !dismissed && (deferredPrompt || showIosPrompt);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed bottom-20 left-4 right-4 z-[9998] max-w-lg mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3 }}
        >
          <div className="card p-4 shadow-brutal flex items-start gap-3">
            <div className="w-10 h-10 bg-gold-400 border-2 border-dark rounded-xl flex items-center justify-center text-lg shrink-0">
              C
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-sm tracking-tight">App installieren</p>
              {deferredPrompt ? (
                <p className="text-xs text-dark/50 mt-0.5 font-medium">
                  Füge CREW zu deinem Homescreen hinzu für den vollen App-Effekt.
                </p>
              ) : (
                <p className="text-xs text-dark/50 mt-0.5 font-medium">
                  Tippe auf <span className="inline-flex items-center mx-0.5 font-bold">
                    <svg className="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 3h-2v7h-2V5H9l3-3zm-7 9v10h14V11h-2v8H7v-8H5z"/></svg>
                  </span> und dann <span className="font-bold">"Zum Home-Bildschirm"</span>.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              {deferredPrompt && (
                <button
                  onClick={handleInstall}
                  className="btn-gold text-[10px] px-3 py-1.5 uppercase tracking-wider"
                >
                  OK
                </button>
              )}
              <button
                onClick={dismiss}
                className="text-[10px] text-dark/30 font-bold uppercase tracking-wider hover:text-dark/60 transition-colors px-2 py-1"
              >
                Später
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
