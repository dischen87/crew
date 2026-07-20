import { z } from "zod";
import { isEventNotificationPayloadKey } from "./event-notification-payload";

const DEVELOPMENT_EVENT_SERVICE_URL = "http://localhost:3002";
const DEVELOPMENT_TYPESENSE_URL = "http://localhost:8108";
const DEVELOPMENT_TYPESENSE_ADMIN_KEY = "crew-local-typesense-key-change-2026";
const DEVELOPMENT_SERVICE_AUTH_KEY =
	"CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";

const ReindexConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		eventServiceUrl: z.string().url(),
		typesenseUrl: z.string().url(),
		typesenseAdminApiKey: z.string().min(16).max(512),
		collectionAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
		timeoutMs: z.coerce.number().int().min(100).max(10_000),
		batchSize: z.coerce.number().int().min(1).max(100),
		maxDocuments: z.coerce.number().int().min(1).max(50_000),
		serviceIssuer: z.string().min(1).max(200),
		serviceAudience: z.string().min(1).max(200),
		serviceKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
		serviceKey: z.string().refine(isEventNotificationPayloadKey),
	})
	.superRefine((value, context) => {
		if (value.environment !== "production") return;
		for (const [field, url] of [
			["eventServiceUrl", value.eventServiceUrl],
			["typesenseUrl", value.typesenseUrl],
		] as const) {
			if (new URL(url).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `${field} must use HTTPS in production`,
				});
			}
		}
		if (
			value.typesenseAdminApiKey === DEVELOPMENT_TYPESENSE_ADMIN_KEY ||
			value.serviceKey === DEVELOPMENT_SERVICE_AUTH_KEY
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["typesenseAdminApiKey"],
				message: "Reindex credentials must be configured in production",
			});
		}
	});

export type PlaceSearchReindexConfig = z.infer<typeof ReindexConfigSchema>;

export function loadPlaceSearchReindexConfig(
	env: Record<string, string | undefined> = Bun.env,
): PlaceSearchReindexConfig {
	const environment = env.NODE_ENV ?? "development";
	const local = environment !== "production";
	return ReindexConfigSchema.parse({
		environment,
		eventServiceUrl:
			env.PLACE_SEARCH_REINDEX_EVENT_SERVICE_URL ??
			(local ? DEVELOPMENT_EVENT_SERVICE_URL : undefined),
		typesenseUrl:
			env.PLACE_SEARCH_REINDEX_TYPESENSE_URL ??
			env.PLACE_SEARCH_TYPESENSE_URL ??
			(local ? DEVELOPMENT_TYPESENSE_URL : undefined),
		typesenseAdminApiKey:
			env.PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY ??
			(local
				? (env.TYPESENSE_API_KEY ?? DEVELOPMENT_TYPESENSE_ADMIN_KEY)
				: undefined),
		collectionAlias:
			env.PLACE_SEARCH_REINDEX_ALIAS ??
			env.PLACE_SEARCH_TYPESENSE_ALIAS ??
			"crew_places",
		timeoutMs: env.PLACE_SEARCH_REINDEX_TIMEOUT_MS ?? "5000",
		batchSize: env.PLACE_SEARCH_REINDEX_BATCH_SIZE ?? "100",
		maxDocuments: env.PLACE_SEARCH_REINDEX_MAX_DOCUMENTS ?? "50000",
		serviceIssuer:
			env.PLACE_SEARCH_REINDEX_SERVICE_ISSUER ??
			env.PLACE_CANDIDATE_SERVICE_ISSUER ??
			"crew-place-catalog",
		serviceAudience:
			env.PLACE_SEARCH_REINDEX_SERVICE_AUDIENCE ??
			env.PLACE_CANDIDATE_SERVICE_AUDIENCE ??
			"crew-event-service",
		serviceKeyId:
			env.PLACE_SEARCH_REINDEX_SERVICE_KEY_ID ??
			env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY_ID ??
			(local ? "development-v1" : undefined),
		serviceKey:
			env.PLACE_SEARCH_REINDEX_SERVICE_KEY ??
			(local
				? (env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY ??
					DEVELOPMENT_SERVICE_AUTH_KEY)
				: undefined),
	});
}
