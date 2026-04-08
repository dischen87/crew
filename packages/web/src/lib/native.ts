import { Capacitor } from "@capacitor/core";

/**
 * Returns true when running inside a native iOS/Android shell (Capacitor).
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Returns the platform: 'ios', 'android', or 'web'.
 */
export function getPlatform(): string {
  return Capacitor.getPlatform();
}
