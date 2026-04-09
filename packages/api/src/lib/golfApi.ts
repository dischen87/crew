import { db } from "../db";
import {
  golfCourses,
  golfCourseHoles,
  golfCourseTees,
  golfTeeHoleDistances,
} from "../db/schema";
import { eq } from "drizzle-orm";

const API_BASE = "https://api.thegolfapi.com/v1";

interface ExternalCourse {
  id: string;
  name: string;
  location?: string;
  country?: string;
  totalHoles?: number;
  parTotal?: number;
  courseRating?: number;
  slopeRating?: number;
  lengthMeters?: number;
  latitude?: number;
  longitude?: number;
  website?: string;
  imageUrl?: string;
  tees?: ExternalTee[];
  holes?: ExternalHole[];
}

interface ExternalTee {
  name: string;
  color?: string;
  courseRating?: number;
  slopeRating?: number;
  lengthMeters?: number;
  holes?: { holeNumber: number; distanceM: number }[];
}

interface ExternalHole {
  holeNumber: number;
  par: number;
  distanceM?: number;
  handicapIndex?: number;
}

export async function searchCourses(
  query: string,
  country?: string
): Promise<ExternalCourse[]> {
  const apiKey = process.env.GOLF_API_KEY;
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({ name: query });
    if (country) params.set("country", country);

    const res = await fetch(`${API_BASE}/courses?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.courses || [];
  } catch {
    return [];
  }
}

export async function fetchCourseDetails(
  externalId: string
): Promise<ExternalCourse | null> {
  const apiKey = process.env.GOLF_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/courses/${externalId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function syncCourseToLocal(
  external: ExternalCourse
): Promise<string> {
  // Check if course already exists
  const existing = external.id
    ? await db
        .select({ id: golfCourses.id })
        .from(golfCourses)
        .where(eq(golfCourses.externalId, external.id))
        .limit(1)
    : [];

  if (existing.length > 0) {
    // Update existing course
    await db
      .update(golfCourses)
      .set({
        name: external.name,
        location: external.location,
        country: external.country,
        totalHoles: external.totalHoles || 18,
        parTotal: external.parTotal,
        courseRating: external.courseRating,
        slopeRating: external.slopeRating,
        lengthMeters: external.lengthMeters,
        websiteUrl: external.website,
        imageUrl: external.imageUrl,
        latitude: external.latitude,
        longitude: external.longitude,
      })
      .where(eq(golfCourses.id, existing[0].id));

    return existing[0].id;
  }

  // Insert new course
  const [course] = await db
    .insert(golfCourses)
    .values({
      name: external.name,
      location: external.location,
      country: external.country,
      totalHoles: external.totalHoles || 18,
      parTotal: external.parTotal,
      courseRating: external.courseRating,
      slopeRating: external.slopeRating,
      lengthMeters: external.lengthMeters,
      websiteUrl: external.website,
      imageUrl: external.imageUrl,
      latitude: external.latitude,
      longitude: external.longitude,
      externalId: external.id,
      source: "api",
    })
    .returning();

  // Sync holes
  if (external.holes) {
    for (const hole of external.holes) {
      await db
        .insert(golfCourseHoles)
        .values({
          courseId: course.id,
          holeNumber: hole.holeNumber,
          par: hole.par,
          distanceM: hole.distanceM,
          handicapIndex: hole.handicapIndex,
        })
        .onConflictDoUpdate({
          target: [golfCourseHoles.courseId, golfCourseHoles.holeNumber],
          set: {
            par: hole.par,
            distanceM: hole.distanceM,
            handicapIndex: hole.handicapIndex,
          },
        });
    }
  }

  // Sync tees
  if (external.tees) {
    for (const tee of external.tees) {
      const [createdTee] = await db
        .insert(golfCourseTees)
        .values({
          courseId: course.id,
          name: tee.name,
          color: tee.color,
          courseRating: tee.courseRating,
          slopeRating: tee.slopeRating,
          lengthMeters: tee.lengthMeters,
        })
        .returning();

      if (tee.holes) {
        for (const hole of tee.holes) {
          await db.insert(golfTeeHoleDistances).values({
            teeId: createdTee.id,
            holeNumber: hole.holeNumber,
            distanceM: hole.distanceM,
          });
        }
      }
    }
  }

  return course.id;
}
