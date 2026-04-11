const API_BASE = import.meta.env.VITE_API_URL || "/v2";

function getToken(): string | null {
  return localStorage.getItem("crew_token");
}

export function setToken(token: string) {
  localStorage.setItem("crew_token", token);
}

export function clearToken() {
  localStorage.removeItem("crew_token");
  localStorage.removeItem("crew_member");
  localStorage.removeItem("crew_group");
  localStorage.removeItem("crew_event");
}

export function getStoredAuth() {
  const token = getToken();
  if (!token) return null;
  try {
    return {
      token,
      member: JSON.parse(localStorage.getItem("crew_member") || "null"),
      group: JSON.parse(localStorage.getItem("crew_group") || "null"),
      event: JSON.parse(localStorage.getItem("crew_event") || "null"),
    };
  } catch {
    clearToken();
    return null;
  }
}

export function storeAuth(data: { token: string; member: any; group: any; event: any }) {
  setToken(data.token);
  localStorage.setItem("crew_member", JSON.stringify(data.member));
  localStorage.setItem("crew_group", JSON.stringify(data.group));
  localStorage.setItem("crew_event", JSON.stringify(data.event));
}

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`);
  }
  return data;
}

// Auth
export async function login(name: string, pin: string) {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ name, pin, password: pin }),
  });
}

export async function register(name: string, password: string, groupName: string, emoji?: string) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, password, group_name: groupName, emoji }),
  });
}

export async function joinGroup(inviteCode: string, name: string, password: string, emoji?: string, pin?: string) {
  return apiFetch("/auth/join", {
    method: "POST",
    body: JSON.stringify({ invite_code: inviteCode, name, password, emoji, pin }),
  });
}

// Groups
export async function getGroup(groupId: string) {
  return apiFetch(`/groups/${groupId}`);
}

// Events
export async function getEvent(eventId: string) {
  return apiFetch(`/events/${eventId}`);
}

// Activities (Billiards, Darts, etc.)
export async function getActivityMatches(eventId: string, type: string) {
  return apiFetch(`/activities/event/${eventId}?type=${type}`);
}

export async function createActivityMatch(eventId: string, data: { type: string; player1_id: string; player2_id: string; notes?: string }) {
  return apiFetch(`/activities/event/${eventId}`, { method: "POST", body: JSON.stringify(data) });
}

export async function recordActivityResult(matchId: string, data: { winner_id: string; score_p1?: number; score_p2?: number }) {
  return apiFetch(`/activities/${matchId}/result`, { method: "POST", body: JSON.stringify(data) });
}

export async function deleteActivityMatch(matchId: string) {
  return apiFetch(`/activities/${matchId}`, { method: "DELETE" });
}

export async function getActivityLeaderboard(eventId: string, type: string) {
  return apiFetch(`/activities/event/${eventId}/leaderboard?type=${type}`);
}

// Offline support
import {
  addPendingScore,
  deletePendingByKey,
  cacheHolesForCourse,
  cacheRound,
  getCachedHoles,
  getCachedRound,
} from "./offlineDb";
import { computeScoreLocally } from "./stableford";
import { requestSync } from "./syncEngine";

// Golf
export async function getGolfData(eventId: string, courseId?: string) {
  const query = courseId ? `?course_id=${courseId}` : "";
  return apiFetch(`/golf/event/${eventId}${query}`);
}

export async function getRoundDetails(roundId: string) {
  try {
    const data = await apiFetch(`/golf/round/${roundId}`);
    // Cache for offline use
    try {
      if (data.round && data.holes) {
        await cacheRound({
          round_id: data.round.id,
          event_id: data.round.event_id,
          course_id: data.round.course_id,
          course_name: data.round.course_name || "",
          par_total: data.round.par_total || 72,
          date: data.round.date || "",
          tee_time: data.round.tee_time || "",
          player_handicap: data.my_handicap ?? data.round.player_handicap ?? 0,
          cached_at: Date.now(),
        });
        await cacheHolesForCourse(
          data.round.course_id,
          data.holes.map((h: any) => ({
            hole_number: h.hole_number,
            par: h.par,
            handicap_index: h.handicap_index,
            distance_m: h.distance_m || 0,
            name: h.name,
          }))
        );
      }
    } catch {
      // Cache write failed — non-critical
    }
    return data;
  } catch {
    // Try offline cache
    const cached = await getCachedRound(roundId);
    if (cached) {
      const holes = await getCachedHoles(cached.course_id);
      return {
        round: {
          id: cached.round_id,
          event_id: cached.event_id,
          course_id: cached.course_id,
          course_name: cached.course_name,
          par_total: cached.par_total,
          date: cached.date,
          tee_time: cached.tee_time,
        },
        holes: holes.map((h) => ({
          hole_number: h.hole_number,
          par: h.par,
          handicap_index: h.handicap_index,
          distance_m: h.distance_m,
          name: h.name,
        })),
        scores: [],
        members: [],
        my_handicap: cached.player_handicap,
        _offline: true,
      };
    }
    throw new Error("Offline und keine gecachten Daten verfuegbar");
  }
}

export async function getCourseDetail(courseId: string) {
  return apiFetch(`/golf/course/${courseId}`);
}

export async function getCourseTees(courseId: string) {
  return apiFetch(`/golf/course/${courseId}/tees`);
}

export async function getCourseHoles(courseId: string, teeId?: string) {
  const query = teeId ? `?tee_id=${teeId}` : "";
  return apiFetch(`/golf/course/${courseId}/holes${query}`);
}

export async function getRoundTeams(roundId: string) {
  return apiFetch(`/golf/round/${roundId}/teams`);
}

export async function updateRoundTeams(roundId: string, teams: { name: string; color?: string; member_ids: string[] }[]) {
  return apiFetch(`/golf/round/${roundId}/teams`, {
    method: "PUT",
    body: JSON.stringify({ teams }),
  });
}

export async function getHandicap(eventId: string) {
  return apiFetch(`/golf/handicap/${eventId}`);
}

export async function setHandicap(eventId: string, handicap: number) {
  return apiFetch(`/golf/handicap/${eventId}`, {
    method: "POST",
    body: JSON.stringify({ handicap }),
  });
}

export async function submitScore(
  eventId: string,
  data: {
    round_id: string;
    hole: number;
    strokes: number;
    putts?: number;
  },
  offlineContext?: {
    courseId: string;
    playingHandicap: number;
  }
) {
  // Compute locally for immediate UI feedback
  let localResult: { net_score: number; stableford: number } | null = null;
  if (offlineContext) {
    try {
      const holes = await getCachedHoles(offlineContext.courseId);
      const hole = holes.find((h) => h.hole_number === data.hole);
      if (hole) {
        localResult = computeScoreLocally(
          data.strokes,
          hole.par,
          hole.handicap_index,
          offlineContext.playingHandicap
        );
      }
    } catch {
      // Local computation failed — proceed without
    }
  }

  if (navigator.onLine) {
    try {
      const result = await apiFetch(`/golf/event/${eventId}/score`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      // Remove from pending queue if it was there
      await deletePendingByKey(data.round_id, data.hole).catch(() => {});
      return result;
    } catch (err) {
      // Network failed despite navigator.onLine — queue offline
      if (localResult) {
        await queueScoreOffline(eventId, data, localResult);
        return { score: { ...data, ...localResult, _offline: true } };
      }
      throw err;
    }
  } else {
    // Offline — queue and return local computation
    if (localResult) {
      await queueScoreOffline(eventId, data, localResult);
      return { score: { ...data, ...localResult, _offline: true } };
    }
    throw new Error("Offline und keine gecachten Daten verfuegbar");
  }
}

async function queueScoreOffline(
  eventId: string,
  data: { round_id: string; hole: number; strokes: number; putts?: number },
  localResult: { net_score: number; stableford: number }
) {
  const memberId = localStorage.getItem("crew_token") || "";
  await addPendingScore({
    event_id: eventId,
    round_id: data.round_id,
    hole: data.hole,
    strokes: data.strokes,
    putts: data.putts,
    member_id: memberId,
    net_score: localResult.net_score,
    stableford: localResult.stableford,
    created_at: Date.now(),
    status: "pending",
    retries: 0,
  });
  requestSync();
}

export async function deleteScore(eventId: string, data: {
  round_id: string;
  hole: number;
}) {
  return apiFetch(`/golf/event/${eventId}/score`, {
    method: "DELETE",
    body: JSON.stringify(data),
  });
}

// Flights
export async function getFlights(eventId: string) {
  return apiFetch(`/flights/event/${eventId}`);
}

// Chat
export async function getMessages(groupId: string, limit = 50, offset = 0) {
  return apiFetch(`/chat/${groupId}/messages?limit=${limit}&offset=${offset}`);
}

export async function sendMessage(groupId: string, content: string, eventId?: string) {
  return apiFetch(`/chat/${groupId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, event_id: eventId }),
  });
}

// Locations
export async function getLocations(eventId: string) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/locations/${eventId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch locations: ${res.status}`);
  }
  const data = await res.json();
  return data.locations || [];
}
