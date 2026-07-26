import { z } from "zod";
import {
	type BoundedFetch,
	BoundedFetchError,
	boundedFetch,
	dependencyUrl,
} from "./bounded-fetch";
import { isEventNotificationPayloadKey } from "./event-notification-payload";
import type { PlaceCandidateInput } from "./place-candidate";
import { issuePlaceCandidateServiceToken } from "./place-candidate-auth";

const DEVELOPMENT_EVENT_SERVICE_URL = "http://localhost:3002";
const DEVELOPMENT_SERVICE_AUTH_KEY =
	"CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_USER_AGENT = "CrewPlaceCatalog/1.0 (+https://crew-haus.com)";
const MAX_OVERPASS_RESPONSE_BYTES = 2_097_152;
const MAX_EVENT_RESPONSE_BYTES = 2_097_152;
const MAX_GOLF_CANDIDATES = 100;
const SOURCE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const Latitude = z.number().finite().min(-90).max(90);
const Longitude = z.number().finite().min(-180).max(180);
const Bounds = z
	.tuple([Latitude, Longitude, Latitude, Longitude])
	.superRefine(([south, west, north, east], context) => {
		if (south >= north || west >= east) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Golf-candidate bounds must be ordered south,west,north,east",
			});
		}
		if (north - south > 2 || east - west > 2) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Golf-candidate bounds may span at most two degrees per axis",
			});
		}
	});

const ConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		eventServiceUrl: z.string().url(),
		overpassUrl: z.string().url(),
		bounds: Bounds,
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		locality: z.string().trim().min(1).max(200).nullable(),
		region: z.string().trim().min(1).max(200).nullable(),
		timeoutMs: z.number().int().min(1_000).max(30_000),
		serviceIssuer: z.string().min(1).max(200),
		serviceAudience: z.string().min(1).max(200),
		serviceKeyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
		serviceKey: z.string().refine(isEventNotificationPayloadKey),
	})
	.superRefine((value, context) => {
		if (value.environment !== "production") return;
		for (const [field, url] of [
			["eventServiceUrl", value.eventServiceUrl],
			["overpassUrl", value.overpassUrl],
		] as const) {
			if (new URL(url).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `${field} must use HTTPS in production`,
				});
			}
		}
		if (value.serviceKey === DEVELOPMENT_SERVICE_AUTH_KEY) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["serviceKey"],
				message:
					"Golf-candidate import credentials must be configured in production",
			});
		}
	});

const OsmElementSchema = z
	.object({
		type: z.enum(["node", "way", "relation"]),
		id: z.number().int().safe().positive(),
		lat: Latitude.optional(),
		lon: Longitude.optional(),
		center: z.object({ lat: Latitude, lon: Longitude }).strict().optional(),
		tags: z.record(z.string(), z.string()),
	})
	.passthrough();

const OsmResponseSchema = z
	.object({
		elements: z.array(OsmElementSchema).max(MAX_GOLF_CANDIDATES + 1),
	})
	.passthrough();

const ImportResponseSchema = z
	.object({
		results: z
			.array(
				z
					.object({
						outcome: z.enum(["inserted", "updated", "unchanged", "stale"]),
						candidate: z
							.object({
								id: z.string().regex(/^pcd_[a-f0-9]{64}$/),
								source: z.literal("osm"),
								sourceRecordId: z.string().regex(/^(node|way|relation)\/\d+$/),
							})
							.passthrough(),
					})
					.strict(),
			)
			.max(MAX_GOLF_CANDIDATES),
	})
	.strict();

export type GolfCandidateImportConfig = z.infer<typeof ConfigSchema>;

export class GolfCandidateSourceError extends Error {
	constructor(
		message: string,
		readonly sourceUnavailable = false,
	) {
		super(message);
	}
}

export function loadGolfCandidateImportConfig(
	env: Record<string, string | undefined> = Bun.env,
): GolfCandidateImportConfig {
	const environment = env.NODE_ENV ?? "development";
	const local = environment !== "production";
	return ConfigSchema.parse({
		environment,
		eventServiceUrl:
			env.PLACE_GOLF_IMPORT_EVENT_SERVICE_URL ??
			(local ? DEVELOPMENT_EVENT_SERVICE_URL : undefined),
		overpassUrl: env.PLACE_GOLF_IMPORT_OVERPASS_URL ?? DEFAULT_OVERPASS_URL,
		bounds: (env.PLACE_GOLF_IMPORT_BOUNDS ?? "")
			.split(",")
			.map((value) => Number(value.trim())),
		countryCode: env.PLACE_GOLF_IMPORT_COUNTRY_CODE,
		locality: env.PLACE_GOLF_IMPORT_LOCALITY ?? null,
		region: env.PLACE_GOLF_IMPORT_REGION ?? null,
		timeoutMs: Number(env.PLACE_GOLF_IMPORT_TIMEOUT_MS ?? "30000"),
		serviceIssuer:
			env.PLACE_GOLF_IMPORT_SERVICE_ISSUER ??
			env.PLACE_CANDIDATE_SERVICE_ISSUER ??
			"crew-place-catalog",
		serviceAudience:
			env.PLACE_GOLF_IMPORT_SERVICE_AUDIENCE ??
			env.PLACE_CANDIDATE_SERVICE_AUDIENCE ??
			"crew-event-service",
		serviceKeyId:
			env.PLACE_GOLF_IMPORT_SERVICE_KEY_ID ??
			env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY_ID ??
			(local ? "development-v1" : undefined),
		serviceKey:
			env.PLACE_GOLF_IMPORT_SERVICE_KEY ??
			(local
				? (env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY ??
					DEVELOPMENT_SERVICE_AUTH_KEY)
				: undefined),
	});
}

export async function importOsmGolfCandidates(
	config: GolfCandidateImportConfig,
	dependencies: { fetch?: BoundedFetch; now?: () => Date } = {},
) {
	const fetcher = dependencies.fetch ?? fetch;
	const retrievedAt = dependencies.now?.() ?? new Date();
	let sourceResponse: Awaited<ReturnType<typeof boundedFetch>>;
	try {
		sourceResponse = await boundedFetch(
			fetcher,
			config.overpassUrl,
			{
				method: "POST",
				headers: {
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": OVERPASS_USER_AGENT,
				},
				body: new URLSearchParams({
					data: osmGolfCandidateQuery(config.bounds),
				}).toString(),
			},
			{
				timeoutMs: config.timeoutMs,
				maxResponseBytes: MAX_OVERPASS_RESPONSE_BYTES,
			},
		);
	} catch (error) {
		throw new GolfCandidateSourceError(
			"OpenStreetMap candidate query was unavailable",
			error instanceof BoundedFetchError && error.transient,
		);
	}
	const { response, text } = sourceResponse;
	if (!response.ok) {
		throw new GolfCandidateSourceError(
			`OpenStreetMap candidate query failed with status ${response.status}`,
			response.status === 408 ||
				response.status === 429 ||
				response.status >= 500,
		);
	}

	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new GolfCandidateSourceError(
			"OpenStreetMap candidate response was not valid JSON",
		);
	}
	const candidates = osmGolfCandidates(value, config, retrievedAt);
	const token = await issuePlaceCandidateServiceToken({
		issuer: config.serviceIssuer,
		audience: config.serviceAudience,
		key: { id: config.serviceKeyId, key: config.serviceKey },
		scope: "event:place-candidates:write",
	});
	const imported = await boundedFetch(
		fetcher,
		dependencyUrl(
			config.eventServiceUrl,
			"internal/v1/place-candidates/import",
		),
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ candidates }),
		},
		{ timeoutMs: config.timeoutMs, maxResponseBytes: MAX_EVENT_RESPONSE_BYTES },
	);
	if (!imported.response.ok) {
		throw new GolfCandidateSourceError(
			`Event candidate import failed with status ${imported.response.status}`,
		);
	}

	let importValue: unknown;
	try {
		importValue = JSON.parse(imported.text);
	} catch {
		throw new GolfCandidateSourceError(
			"Event candidate import response was not valid JSON",
		);
	}
	const parsed = ImportResponseSchema.safeParse(importValue);
	if (!parsed.success || parsed.data.results.length !== candidates.length) {
		throw new GolfCandidateSourceError(
			"Event candidate import response did not match the source batch",
		);
	}
	return parsed.data;
}

export function osmGolfCandidateQuery([
	south,
	west,
	north,
	east,
]: GolfCandidateImportConfig["bounds"]) {
	return `[out:json][timeout:25];nwr["leisure"="golf_course"]["name"](${south},${west},${north},${east});out center tags qt ${MAX_GOLF_CANDIDATES + 1};`;
}

export function osmGolfCandidates(
	value: unknown,
	context: Pick<
		GolfCandidateImportConfig,
		"countryCode" | "locality" | "region"
	>,
	retrievedAt: Date,
): PlaceCandidateInput[] {
	const parsed = OsmResponseSchema.safeParse(value);
	if (!parsed.success) {
		throw new GolfCandidateSourceError(
			"OpenStreetMap candidate response had an invalid shape",
		);
	}
	if (parsed.data.elements.length > MAX_GOLF_CANDIDATES) {
		throw new GolfCandidateSourceError(
			"OpenStreetMap candidate query exceeded the 100-record tile limit",
		);
	}
	const expiresAt = new Date(retrievedAt.getTime() + SOURCE_TTL_MS);
	const candidates = parsed.data.elements.flatMap((element) => {
		const name = boundedText(element.tags["name:en"] ?? element.tags.name, 200);
		const latitude = element.lat ?? element.center?.lat;
		const longitude = element.lon ?? element.center?.lon;
		if (!name || latitude === undefined || longitude === undefined) return [];
		const sourceRecordId = `${element.type}/${element.id}`;
		return [
			{
				source: "osm",
				sourceRecordId,
				kind: "golf_course" as const,
				name,
				locality:
					context.locality ?? boundedText(element.tags["addr:city"], 200),
				region:
					context.region ??
					boundedText(
						element.tags["addr:province"] ?? element.tags["addr:state"],
						200,
					),
				countryCode: context.countryCode,
				latitude,
				longitude,
				sourceRecordUrl: `https://www.openstreetmap.org/${sourceRecordId}`,
				license: {
					code: "ODbL-1.0",
					url: "https://www.openstreetmap.org/copyright",
					attribution: "© OpenStreetMap contributors",
					allowsSearchIndex: true,
				},
				retrievedAt,
				confidence: 0.9,
				expiresAt,
				retirement: null,
			},
		];
	});
	if (candidates.length === 0) {
		throw new GolfCandidateSourceError(
			"OpenStreetMap candidate query returned no usable named golf courses",
		);
	}
	return candidates.sort((left, right) =>
		left.sourceRecordId.localeCompare(right.sourceRecordId),
	);
}

function boundedText(value: string | undefined, maxLength: number) {
	const text = value?.trim();
	return text && text.length <= maxLength && !/[\p{Cc}\p{Cf}]/u.test(text)
		? text
		: null;
}
