// ─── Domain & URLs ──────────────────────────────────────────
export const CREW_DOMAIN = "crew-haus.com";
export const CREW_WEB_URL = `https://${CREW_DOMAIN}`;
export const CREW_API_URL = `https://api.${CREW_DOMAIN}`;
export const CREW_APP_SCHEME = "crew";

// ─── Invite Links ───────────────────────────────────────────
export function buildInviteUrl(inviteCode: string): string {
  return `${CREW_WEB_URL}/join/${inviteCode}`;
}

export function buildDeepLink(inviteCode: string): string {
  return `${CREW_APP_SCHEME}://join/${inviteCode}`;
}

// ─── Design Tokens (shared between web + mobile) ───────────
export const brandColors = {
  navy: "#222432",
  navyLight: "#3A3C50",
  cream: "#FBF7F4",
  creamDark: "#F5EDE8",
  coral: "#FFC7B9",
  coralDark: "#F5A897",
  white: "#FFFFFF",
} as const;

// ─── Golf Game Modes ────────────────────────────────────────
export const GOLF_GAME_MODES = [
  "individual",
  "2v2",
  "4v4",
  "scramble",
  "best_ball",
] as const;

export type GolfGameMode = (typeof GOLF_GAME_MODES)[number];

export const GOLF_GAME_MODE_LABELS: Record<GolfGameMode, string> = {
  individual: "Einzel",
  "2v2": "2 vs 2",
  "4v4": "4 vs 4",
  scramble: "Scramble",
  best_ball: "Best Ball",
};
