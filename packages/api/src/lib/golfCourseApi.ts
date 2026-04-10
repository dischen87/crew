/**
 * Client for GolfCourseAPI.com — golf course data worldwide.
 * Free tier: 300 req/day. Pro: $6.99/mo, 10K req/day.
 * Docs: https://api.golfcourseapi.com/docs/api/
 */

const BASE_URL = "https://api.golfcourseapi.com/v1";
const API_KEY = process.env.GOLF_COURSE_API_KEY || "";

interface GolfCourseSearchResult {
  id: string;
  courseName: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  numberOfHoles?: number;
}

interface GolfCourseDetail {
  id: string;
  courseName: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  numberOfHoles?: number;
  scorecard?: {
    holes: {
      hole: number;
      par: number;
      handicap?: number;
      tees?: Record<string, { yards?: number; meters?: number }>;
    }[];
  };
  teeBoxes?: {
    name: string;
    color?: string;
    courseRating?: number;
    slopeRating?: number;
    totalYards?: number;
  }[];
}

async function apiFetch<T>(path: string): Promise<T> {
  if (!API_KEY) {
    throw new Error("GOLF_COURSE_API_KEY nicht konfiguriert. Bitte in .env setzen.");
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Key ${API_KEY}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GolfCourseAPI error ${res.status}: ${text}`);
  }

  return res.json();
}

/** Search courses by name, country, or coordinates */
export async function searchCourses(params: {
  query?: string;
  country?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radius_km?: number;
  limit?: number;
}): Promise<GolfCourseSearchResult[]> {
  const searchParams = new URLSearchParams();
  if (params.query) searchParams.set("query", params.query);
  if (params.country) searchParams.set("country", params.country);
  if (params.city) searchParams.set("city", params.city);
  if (params.lat) searchParams.set("lat", String(params.lat));
  if (params.lng) searchParams.set("lng", String(params.lng));
  if (params.radius_km) searchParams.set("radius_km", String(params.radius_km));
  if (params.limit) searchParams.set("limit", String(params.limit));

  const data = await apiFetch<{ courses?: GolfCourseSearchResult[] }>(
    `/courses?${searchParams.toString()}`
  );
  return data.courses || [];
}

/** Get full course detail including scorecard */
export async function getCourseDetail(courseId: string): Promise<GolfCourseDetail> {
  return apiFetch<GolfCourseDetail>(`/courses/${courseId}`);
}

/**
 * Convert external API course data to our internal format.
 * Returns null if course doesn't have complete hole data.
 */
export function toInternalCourse(course: GolfCourseDetail): {
  name: string;
  location: string | null;
  country: string | null;
  par_total: number;
  course_rating: number | null;
  slope_rating: number | null;
  latitude: number | null;
  longitude: number | null;
  external_id: string;
  holes: { hole_number: number; par: number; distance_m: number; handicap_index: number }[];
} | null {
  const holes = course.scorecard?.holes;
  if (!holes || holes.length < 18) return null;

  const mapped = holes.slice(0, 18).map((h) => {
    // Find distance: prefer meters, convert from yards if needed
    let distance_m = 0;
    if (h.tees) {
      const firstTee = Object.values(h.tees)[0];
      if (firstTee?.meters) {
        distance_m = firstTee.meters;
      } else if (firstTee?.yards) {
        distance_m = Math.round(firstTee.yards * 0.9144);
      }
    }

    return {
      hole_number: h.hole,
      par: h.par,
      distance_m,
      handicap_index: h.handicap || h.hole, // fallback to hole number if no handicap
    };
  });

  const par_total = mapped.reduce((sum, h) => sum + h.par, 0);

  // Get course/slope rating from first tee box
  const firstTee = course.teeBoxes?.[0];

  return {
    name: course.courseName,
    location: [course.city, course.state].filter(Boolean).join(", ") || course.address || null,
    country: course.country || null,
    par_total,
    course_rating: firstTee?.courseRating || null,
    slope_rating: firstTee?.slopeRating || null,
    latitude: course.latitude || null,
    longitude: course.longitude || null,
    external_id: course.id,
    holes: mapped,
  };
}
