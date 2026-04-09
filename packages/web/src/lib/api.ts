import {
  MOCK_GOLF_DATA,
  MOCK_ROUND_DETAIL,
  MOCK_MEMBERS,
  MOCK_MESSAGES,
  MOCK_FLIGHTS,
  MOCK_LOCATIONS,
  MOCK_ROUNDS,
} from "./mock-data";

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
    window.location.reload();
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
  try {
    return await apiFetch(`/groups/${groupId}`);
  } catch {
    return { members: MOCK_MEMBERS };
  }
}

// Events
export async function getEvent(eventId: string) {
  return apiFetch(`/events/${eventId}`);
}

// Golf
export async function getGolfData(eventId: string) {
  try {
    return await apiFetch(`/golf/event/${eventId}`);
  } catch {
    return MOCK_GOLF_DATA;
  }
}

export async function getRoundDetails(roundId: string) {
  try {
    return await apiFetch(`/golf/round/${roundId}`);
  } catch {
    const round = MOCK_ROUNDS.find((r) => r.id === roundId) || MOCK_ROUNDS[0];
    return { ...MOCK_ROUND_DETAIL, round };
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

export async function getHandicap(eventId: string) {
  return apiFetch(`/golf/handicap/${eventId}`);
}

export async function setHandicap(eventId: string, handicap: number) {
  return apiFetch(`/golf/handicap/${eventId}`, {
    method: "POST",
    body: JSON.stringify({ handicap }),
  });
}

export async function submitScore(eventId: string, data: {
  round_id: string;
  hole: number;
  strokes: number;
  putts?: number;
}) {
  return apiFetch(`/golf/event/${eventId}/score`, {
    method: "POST",
    body: JSON.stringify(data),
  });
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
  try {
    return await apiFetch(`/flights/event/${eventId}`);
  } catch {
    return MOCK_FLIGHTS;
  }
}

// Chat
export async function getMessages(groupId: string, limit = 50, offset = 0) {
  try {
    return await apiFetch(`/chat/${groupId}/messages?limit=${limit}&offset=${offset}`);
  } catch {
    return { messages: [...MOCK_MESSAGES].reverse().slice(0, limit) };
  }
}

export async function sendMessage(groupId: string, content: string, eventId?: string) {
  return apiFetch(`/chat/${groupId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content, event_id: eventId }),
  });
}

// Locations (mock fallback)
export async function getLocations(eventId: string) {
  try {
    const token = getToken();
    const res = await fetch(`${API_BASE}/locations/${eventId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      return data.locations || [];
    }
    return MOCK_LOCATIONS;
  } catch {
    return MOCK_LOCATIONS;
  }
}
