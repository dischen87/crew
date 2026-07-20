import type { Sql } from "postgres";

const GLOBAL_SCOPE = "global";

export async function lockFeedbackDuplicateScopes(
	tx: Sql,
	rootEventIds: Array<string | null>,
) {
	const scopes = [
		...new Set(
			rootEventIds.map(
				(rootEventId) =>
					`event-feedback-duplicates:${rootEventId ?? GLOBAL_SCOPE}`,
			),
		),
	].sort();
	for (const scope of scopes) {
		await tx`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
	}
}
