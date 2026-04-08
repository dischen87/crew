import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.crewhaus.app",
  appName: "CREW",
  webDir: "dist",
  server: {
    // In production, the app loads from the built assets bundled inside the native app.
    // Set this to your API server so relative /v2 calls resolve correctly.
    // For development, you can use your local IP instead.
    url: process.env.CAPACITOR_SERVER_URL,
    // Allow navigation to external URLs (e.g. maps, links)
    allowNavigation: ["*.crew-haus.com"],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: "#f0ddf5",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#f0ddf5",
    },
    Keyboard: {
      resize: "body",
      scrollAssist: true,
      scrollPadding: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  ios: {
    scheme: "CREW",
    contentInset: "automatic",
    preferredContentMode: "mobile",
    backgroundColor: "#f0ddf5",
  },
};

export default config;
