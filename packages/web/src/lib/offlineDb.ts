/**
 * Vanilla IndexedDB module for offline score storage and data caching.
 * DB: "crew_offline", stores: pendingScores, courseHoleCache, roundCache
 *
 * IMPORTANT: Keep stableford logic in sync with packages/api/src/routes/golf.ts
 */

const DB_NAME = "crew_offline";
const DB_VERSION = 1;

export interface PendingScore {
  id?: number;
  event_id: string;
  round_id: string;
  hole: number;
  strokes: number;
  putts?: number;
  member_id: string;
  net_score: number;
  stableford: number;
  created_at: number;
  status: "pending" | "syncing" | "failed";
  error?: string;
  retries: number;
}

export interface CachedHole {
  course_id: string;
  hole_number: number;
  par: number;
  handicap_index: number;
  distance_m: number;
  name?: string;
  cached_at: number;
}

export interface CachedRound {
  round_id: string;
  event_id: string;
  course_id: string;
  course_name: string;
  par_total: number;
  date: string;
  tee_time: string;
  player_handicap: number;
  cached_at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("pendingScores")) {
        const store = db.createObjectStore("pendingScores", {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("compositeKey", ["round_id", "hole"]);
        store.createIndex("status", "status");
        store.createIndex("roundId", "round_id");
      }

      if (!db.objectStoreNames.contains("courseHoleCache")) {
        db.createObjectStore("courseHoleCache", {
          keyPath: ["course_id", "hole_number"],
        });
      }

      if (!db.objectStoreNames.contains("roundCache")) {
        db.createObjectStore("roundCache", { keyPath: "round_id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Pending Scores ──────────────────────────────────────────────

export async function addPendingScore(
  score: Omit<PendingScore, "id">
): Promise<number> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readwrite");
  const store = tx.objectStore("pendingScores");

  // Dedup: remove existing entry for same round_id + hole
  const idx = store.index("compositeKey");
  const existing = await promisify(idx.get([score.round_id, score.hole]));
  if (existing) {
    store.delete((existing as PendingScore).id!);
  }

  const id = await promisify(store.add(score));
  db.close();
  return id as number;
}

export async function getPendingScores(): Promise<PendingScore[]> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readonly");
  const store = tx.objectStore("pendingScores");
  const all: PendingScore[] = await promisify(store.getAll());
  db.close();
  return all.filter((s) => s.status === "pending");
}

export async function getPendingScoresForRound(
  roundId: string
): Promise<PendingScore[]> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readonly");
  const store = tx.objectStore("pendingScores");
  const idx = store.index("roundId");
  const all: PendingScore[] = await promisify(idx.getAll(roundId));
  db.close();
  return all;
}

export async function updateScoreStatus(
  id: number,
  status: PendingScore["status"],
  error?: string
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readwrite");
  const store = tx.objectStore("pendingScores");
  const record: PendingScore | undefined = await promisify(store.get(id));
  if (record) {
    record.status = status;
    if (error) record.error = error;
    if (status === "failed") record.retries = (record.retries || 0) + 1;
    await promisify(store.put(record));
  }
  db.close();
}

export async function deletePendingScore(id: number): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readwrite");
  const store = tx.objectStore("pendingScores");
  await promisify(store.delete(id));
  db.close();
}

export async function deletePendingByKey(
  roundId: string,
  hole: number
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readwrite");
  const store = tx.objectStore("pendingScores");
  const idx = store.index("compositeKey");
  const existing = await promisify(idx.get([roundId, hole]));
  if (existing) {
    store.delete((existing as PendingScore).id!);
  }
  db.close();
}

export async function getTotalPendingCount(): Promise<number> {
  const db = await openDb();
  const tx = db.transaction("pendingScores", "readonly");
  const store = tx.objectStore("pendingScores");
  const all: PendingScore[] = await promisify(store.getAll());
  db.close();
  return all.filter((s) => s.status === "pending" || s.status === "failed").length;
}

// ── Course Hole Cache ───────────────────────────────────────────

export async function cacheHolesForCourse(
  courseId: string,
  holes: { hole_number: number; par: number; handicap_index: number; distance_m: number; name?: string }[]
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("courseHoleCache", "readwrite");
  const store = tx.objectStore("courseHoleCache");
  const now = Date.now();
  for (const h of holes) {
    await promisify(
      store.put({
        course_id: courseId,
        hole_number: h.hole_number,
        par: h.par,
        handicap_index: h.handicap_index,
        distance_m: h.distance_m,
        name: h.name,
        cached_at: now,
      })
    );
  }
  db.close();
}

export async function getCachedHoles(
  courseId: string
): Promise<CachedHole[]> {
  const db = await openDb();
  const tx = db.transaction("courseHoleCache", "readonly");
  const store = tx.objectStore("courseHoleCache");
  const all: CachedHole[] = await promisify(store.getAll());
  db.close();
  return all
    .filter((h) => h.course_id === courseId)
    .sort((a, b) => a.hole_number - b.hole_number);
}

// ── Round Cache ─────────────────────────────────────────────────

export async function cacheRound(round: CachedRound): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("roundCache", "readwrite");
  const store = tx.objectStore("roundCache");
  await promisify(store.put(round));
  db.close();
}

export async function getCachedRound(
  roundId: string
): Promise<CachedRound | null> {
  const db = await openDb();
  const tx = db.transaction("roundCache", "readonly");
  const store = tx.objectStore("roundCache");
  const result: CachedRound | undefined = await promisify(store.get(roundId));
  db.close();
  return result || null;
}
