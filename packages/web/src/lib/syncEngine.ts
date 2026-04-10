/**
 * Sync engine: flushes pending offline scores to the server.
 * Uses Background Sync API when available, falls back to online/visibility events.
 */

import {
  getPendingScores,
  updateScoreStatus,
  deletePendingScore,
} from "./offlineDb";

const API_BASE = import.meta.env.VITE_API_URL || "/v2";

function getToken(): string | null {
  return localStorage.getItem("crew_token");
}

async function sendScoreToServer(
  eventId: string,
  data: { round_id: string; hole: number; strokes: number; putts?: number }
): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  const res = await fetch(`${API_BASE}/golf/event/${eventId}/score`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  // 2xx = success, 409 = conflict (already exists, server upserted) — both OK
  return res.ok || res.status === 409;
}

export async function syncPendingScores(): Promise<{
  synced: number;
  failed: number;
}> {
  const pending = await getPendingScores();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const score of pending) {
    await updateScoreStatus(score.id!, "syncing");

    try {
      const ok = await sendScoreToServer(score.event_id, {
        round_id: score.round_id,
        hole: score.hole,
        strokes: score.strokes,
        putts: score.putts,
      });

      if (ok) {
        await deletePendingScore(score.id!);
        synced++;
      } else {
        await updateScoreStatus(score.id!, "pending", "Server rejected");
        failed++;
      }
    } catch {
      // Network error — leave as pending for next attempt
      await updateScoreStatus(score.id!, "pending");
      failed++;
    }
  }

  // Notify UI
  if (synced > 0) {
    window.dispatchEvent(new CustomEvent("scores-synced", { detail: { synced, failed } }));
  }

  return { synced, failed };
}

export async function requestSync(): Promise<void> {
  // Try Background Sync API first
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await (reg as any).sync.register("sync-scores");
      return;
    } catch {
      // Fall through to immediate sync
    }
  }

  // Fallback: sync immediately if online
  if (navigator.onLine) {
    await syncPendingScores();
  }
}

export function setupFallbackSync(): void {
  // Sync when device comes online
  window.addEventListener("online", () => {
    syncPendingScores();
  });

  // Sync when app becomes visible and is online
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      syncPendingScores();
    }
  });
}
