/**
 * GPS-based golf course proximity detection.
 * Checks location periodically and shows a notification when near a course.
 * One-time per visit: user must leave (>1km) before re-notification.
 */

const PROXIMITY_RADIUS_M = 500;
const LEAVE_RADIUS_M = 1000;
const CHECK_INTERVAL_MS = 120_000; // 2 minutes
const COURSES_CACHE_KEY = "crew_courses_geo";
const NOTIFIED_KEY = "crew_notified_courses";

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "/v2";

interface CourseLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

interface NotifiedCourse {
  courseId: string;
  notifiedAt: number;
  hasLeft: boolean;
}

// ── Haversine ───────────────────────────────────────────────────

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Course data ─────────────────────────────────────────────────

async function fetchAndCacheCourses(
  eventId: string
): Promise<CourseLocation[]> {
  try {
    const token = localStorage.getItem("crew_token");
    const res = await fetch(`${API_BASE}/golf/courses/nearby?event_id=${eventId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      const data = await res.json();
      const courses: CourseLocation[] = data.courses || [];
      localStorage.setItem(COURSES_CACHE_KEY, JSON.stringify(courses));
      return courses;
    }
  } catch {
    // Offline — use cache
  }
  try {
    return JSON.parse(localStorage.getItem(COURSES_CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}

// ── Notified tracking ───────────────────────────────────────────

function getNotifiedCourses(): NotifiedCourse[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "[]");
  } catch {
    return [];
  }
}

function setNotifiedCourse(courseId: string): void {
  const list = getNotifiedCourses();
  const idx = list.findIndex((n) => n.courseId === courseId);
  const entry: NotifiedCourse = {
    courseId,
    notifiedAt: Date.now(),
    hasLeft: false,
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(list));
}

function markCourseLeft(courseId: string): void {
  const list = getNotifiedCourses();
  const entry = list.find((n) => n.courseId === courseId);
  if (entry) {
    entry.hasLeft = true;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(list));
  }
}

function shouldNotifyForCourse(courseId: string): boolean {
  const list = getNotifiedCourses();
  const entry = list.find((n) => n.courseId === courseId);
  if (!entry) return true; // Never notified
  return entry.hasLeft; // Only re-notify if user has left
}

// ── Proximity check ─────────────────────────────────────────────

function checkProximityAgainstCourses(
  lat: number,
  lng: number,
  courses: CourseLocation[]
): CourseLocation | null {
  let closest: CourseLocation | null = null;
  let closestDist = Infinity;

  for (const course of courses) {
    const dist = haversineDistance(lat, lng, course.latitude, course.longitude);

    // Mark courses as "left" if user is beyond LEAVE_RADIUS_M
    if (dist > LEAVE_RADIUS_M) {
      const notified = getNotifiedCourses().find(
        (n) => n.courseId === course.id
      );
      if (notified && !notified.hasLeft) {
        markCourseLeft(course.id);
      }
    }

    // Check if within proximity radius and should notify
    if (dist <= PROXIMITY_RADIUS_M && dist < closestDist) {
      if (shouldNotifyForCourse(course.id)) {
        closest = course;
        closestDist = dist;
      }
    }
  }

  return closest;
}

// ── Notification ────────────────────────────────────────────────

function showCourseNotification(course: CourseLocation): void {
  if ("Notification" in window && Notification.permission === "granted") {
    const n = new Notification("Golfplatz in der Naehe!", {
      body: course.name,
      icon: "/icon-192.png",
      tag: "course-" + course.id,
    });
    n.onclick = () => {
      window.focus();
      window.dispatchEvent(
        new CustomEvent("course-notification-tap", {
          detail: { courseId: course.id, courseName: course.name },
        })
      );
      n.close();
    };
  } else {
    // Fallback: in-app event for toast banner
    window.dispatchEvent(
      new CustomEvent("course-nearby", {
        detail: { courseId: course.id, courseName: course.name },
      })
    );
  }
  setNotifiedCourse(course.id);
}

// ── Get current position (promisified) ──────────────────────────

function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });
}

// ── Single check (used on visibility change) ────────────────────

export async function checkProximityOnce(
  eventId: string
): Promise<CourseLocation | null> {
  if (!("geolocation" in navigator)) return null;

  const courses = await fetchAndCacheCourses(eventId);
  if (courses.length === 0) return null;

  try {
    const pos = await getCurrentPosition();
    const course = checkProximityAgainstCourses(
      pos.coords.latitude,
      pos.coords.longitude,
      courses
    );
    if (course) {
      showCourseNotification(course);
    }
    return course;
  } catch {
    return null;
  }
}

// ── Continuous monitoring ───────────────────────────────────────

export function startProximityMonitoring(eventId: string): () => void {
  if (!("geolocation" in navigator)) return () => {};

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let courses: CourseLocation[] = [];

  const doCheck = async () => {
    if (courses.length === 0) {
      courses = await fetchAndCacheCourses(eventId);
      if (courses.length === 0) return;
    }

    try {
      const pos = await getCurrentPosition();
      const course = checkProximityAgainstCourses(
        pos.coords.latitude,
        pos.coords.longitude,
        courses
      );
      if (course) {
        showCourseNotification(course);
      }
    } catch {
      // Geolocation denied or unavailable — silently skip
    }
  };

  // Request notification permission (non-blocking)
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Immediate check + periodic
  doCheck();
  intervalId = setInterval(doCheck, CHECK_INTERVAL_MS);

  return () => {
    if (intervalId) clearInterval(intervalId);
  };
}
