import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	type BoundedFetch,
	boundedFetch,
	dependencyUrl,
} from "./bounded-fetch";
import { issuePlaceCandidateServiceToken } from "./place-candidate-auth";
import type { PlaceSearchReindexConfig } from "./place-search-reindex-config";

const MAX_FEED_RESPONSE_BYTES = 2_097_152;
const MAX_TYPESENSE_RESPONSE_BYTES = 1_048_576;
const LOCK_COLLECTION = "crew_place_reindex_locks";
const LOCK_TTL_MS = 7_200_000;

export class PlaceSearchReindexError extends Error {}

const CandidateSchema = z
	.object({
		id: z.string().regex(/^pcd_[a-f0-9]{64}$/),
		source: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
		sourceRecordId: z.string().min(1).max(512),
		kind: z.enum(["golf_course", "venue"]),
		name: z.string().min(1).max(300),
		locality: z.string().min(1).max(200).nullable(),
		region: z.string().min(1).max(200).nullable(),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().min(-90).max(90).nullable(),
		longitude: z.number().min(-180).max(180).nullable(),
		sourceRecordUrl: z.string().url().max(2048).nullable(),
		license: z
			.object({
				code: z.string().min(1).max(128),
				url: z.string().url().max(2048).nullable(),
				attribution: z.string().min(1).max(500),
				allowsSearchIndex: z.literal(true),
			})
			.strict(),
		retrievedAt: z.string().datetime({ offset: true }),
		confidence: z.number().min(0).max(1),
		expiresAt: z.string().datetime({ offset: true }).nullable(),
		retirement: z.null(),
		version: z.number().int().positive(),
		createdAt: z.string().datetime({ offset: true }),
		updatedAt: z.string().datetime({ offset: true }),
		status: z.enum(["pending", "enriched"]),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.latitude === null) !== (value.longitude === null)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["latitude"],
				message: "Coordinates must be supplied together",
			});
		}
	});
const FeedPageSchema = z
	.object({
		items: z.array(CandidateSchema).max(100),
		pageInfo: z
			.object({
				nextCursor: z.string().min(16).max(512).nullable(),
				hasMore: z.boolean(),
			})
			.strict(),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.pageInfo.hasMore !== (value.pageInfo.nextCursor !== null)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["pageInfo"],
				message: "Feed pagination state is inconsistent",
			});
		}
	});

type Candidate = z.infer<typeof CandidateSchema>;
type SearchDocument = ReturnType<typeof candidateDocument>;

export async function reindexPlaceSearch(
	config: PlaceSearchReindexConfig,
	dependencies: {
		fetch?: BoundedFetch;
		now?: () => Date;
		randomId?: () => string;
	} = {},
) {
	const fetcher = dependencies.fetch ?? fetch;
	const now = dependencies.now ?? (() => new Date());
	const runId = dependencies.randomId?.() ?? randomUUID();
	const typesense = new TypesenseAdminClient(config, fetcher);
	const feed = new PlaceCandidateFeedClient(config, fetcher);
	await typesense.acquireLock(
		config.collectionAlias,
		runId,
		now().getTime() + LOCK_TTL_MS,
	);

	try {
		const previousCollectionName = await typesense.resolveAlias(
			config.collectionAlias,
		);
		const collectionName = versionedCollectionName(
			config.collectionAlias,
			now(),
			runId,
		);
		let collectionCreated = false;
		let aliasSwapStarted = false;
		try {
			await typesense.createPlaceCollection(collectionName);
			collectionCreated = true;
			let cursor: string | undefined;
			let documentCount = 0;
			let sample: SearchDocument | undefined;
			const seenCursors = new Set<string>();
			const seenIds = new Set<string>();
			for (;;) {
				const page = await feed.page(config.batchSize, cursor);
				if (page.items.length === 0 && page.pageInfo.hasMore) {
					throw new PlaceSearchReindexError(
						"Place-candidate feed returned an empty non-terminal page",
					);
				}
				if (documentCount + page.items.length > config.maxDocuments) {
					throw new PlaceSearchReindexError(
						`Place index exceeds the configured ${config.maxDocuments}-document limit`,
					);
				}
				const documents = page.items.map((candidate) => {
					if (seenIds.has(candidate.id)) {
						throw new PlaceSearchReindexError(
							"Place-candidate feed returned a duplicate record",
						);
					}
					seenIds.add(candidate.id);
					return candidateDocument(candidate);
				});
				if (documents.length) {
					await typesense.importDocuments(collectionName, documents);
					sample ??= documents[0];
				}
				documentCount += documents.length;
				if (!page.pageInfo.hasMore) break;
				const nextCursor = page.pageInfo.nextCursor;
				if (!nextCursor || seenCursors.has(nextCursor)) {
					throw new PlaceSearchReindexError(
						"Place-candidate feed repeated its cursor",
					);
				}
				seenCursors.add(nextCursor);
				cursor = nextCursor;
			}

			await typesense.verifyCollection(collectionName, documentCount, sample);
			// Once this call starts its outcome can be unknown after a timeout. Never
			// delete the new collection after this point: the alias may already target it.
			aliasSwapStarted = true;
			await typesense.swapAlias(config.collectionAlias, collectionName);
			await typesense.verifyAlias(
				config.collectionAlias,
				collectionName,
				documentCount,
				sample,
			);
			return {
				alias: config.collectionAlias,
				collectionName,
				previousCollectionName,
				documentCount,
			};
		} catch (error) {
			if (collectionCreated && !aliasSwapStarted) {
				await typesense.deleteCollection(collectionName).catch(() => undefined);
			}
			throw error;
		}
	} finally {
		await typesense
			.releaseLock(config.collectionAlias, runId)
			.catch(() => undefined);
	}
}

class PlaceCandidateFeedClient {
	constructor(
		private readonly config: PlaceSearchReindexConfig,
		private readonly fetcher: BoundedFetch,
	) {}

	async page(limit: number, cursor?: string) {
		const url = dependencyUrl(
			this.config.eventServiceUrl,
			"internal/v1/place-candidates/index-feed",
		);
		url.searchParams.set("limit", String(limit));
		if (cursor) url.searchParams.set("cursor", cursor);
		const token = await issuePlaceCandidateServiceToken({
			issuer: this.config.serviceIssuer,
			audience: this.config.serviceAudience,
			key: {
				id: this.config.serviceKeyId,
				key: this.config.serviceKey,
			},
			scope: "event:place-candidates:read",
		});
		const { response, text } = await boundedFetch(
			this.fetcher,
			url,
			{
				method: "GET",
				headers: {
					Accept: "application/json",
					Authorization: `Bearer ${token}`,
				},
			},
			{
				timeoutMs: this.config.timeoutMs,
				maxResponseBytes: MAX_FEED_RESPONSE_BYTES,
			},
		);
		if (!response.ok) {
			throw new PlaceSearchReindexError(
				`Place-candidate feed failed with status ${response.status}`,
			);
		}
		return parseJson(FeedPageSchema, text, "place-candidate feed");
	}
}

class TypesenseAdminClient {
	constructor(
		private readonly config: PlaceSearchReindexConfig,
		private readonly fetcher: BoundedFetch,
	) {}

	async createPlaceCollection(name: string) {
		const value = await this.json("collections", {
			method: "POST",
			body: JSON.stringify({
				name,
				fields: [
					{ name: "kind", type: "string", facet: true },
					{ name: "name", type: "string" },
					{ name: "locality", type: "string", optional: true },
					{ name: "region", type: "string", optional: true },
					{ name: "countryCode", type: "string", facet: true },
					{ name: "status", type: "string", facet: true },
					{ name: "confidence", type: "float", sort: true },
					{ name: "sortId", type: "string", sort: true },
				],
				default_sorting_field: "confidence",
			}),
		});
		const parsed = z
			.object({ name: z.literal(name) })
			.passthrough()
			.safeParse(value);
		if (!parsed.success)
			throw new PlaceSearchReindexError(
				"Typesense returned an invalid collection response",
			);
	}

	async importDocuments(collection: string, documents: SearchDocument[]) {
		const url = `collections/${encodeURIComponent(collection)}/documents/import?action=upsert&dirty_values=reject&return_id=true`;
		const { response, text } = await this.request(url, {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: `${documents.map((document) => JSON.stringify(document)).join("\n")}\n`,
		});
		if (!response.ok) this.failed(response, "document import");
		const lines = text.trimEnd().split("\n");
		if (lines.length !== documents.length) {
			throw new PlaceSearchReindexError(
				"Typesense returned an incomplete document-import result",
			);
		}
		for (const [index, line] of lines.entries()) {
			const result = parseJson(
				z.object({ success: z.literal(true), id: z.string() }).passthrough(),
				line ?? "",
				"Typesense document-import result",
			);
			if (result.id !== documents[index]?.id) {
				throw new PlaceSearchReindexError(
					"Typesense returned a mismatched imported document ID",
				);
			}
		}
	}

	async verifyCollection(
		collection: string,
		expectedCount: number,
		sample?: SearchDocument,
	) {
		const info = await this.collectionInfo(collection);
		if (info.num_documents !== expectedCount) {
			throw new PlaceSearchReindexError(
				"Typesense collection document count did not match the source feed",
			);
		}
		await this.verifySearch(collection, expectedCount);
		if (sample) await this.verifyDocument(collection, sample);
	}

	async swapAlias(alias: string, collection: string) {
		const value = await this.json(`aliases/${encodeURIComponent(alias)}`, {
			method: "PUT",
			body: JSON.stringify({ collection_name: collection }),
		});
		const result = z
			.object({
				name: z.literal(alias),
				collection_name: z.literal(collection),
			})
			.passthrough()
			.safeParse(value);
		if (!result.success)
			throw new PlaceSearchReindexError(
				"Typesense returned an invalid alias-swap response",
			);
	}

	async verifyAlias(
		alias: string,
		collection: string,
		expectedCount: number,
		sample?: SearchDocument,
	) {
		if ((await this.resolveAlias(alias)) !== collection) {
			throw new PlaceSearchReindexError(
				"Typesense alias does not target the verified collection",
			);
		}
		await this.verifySearch(alias, expectedCount);
		if (sample) await this.verifyDocument(alias, sample);
	}

	async resolveAlias(alias: string) {
		const { response, text } = await this.request(
			`aliases/${encodeURIComponent(alias)}`,
			{ method: "GET" },
		);
		if (response.status === 404) return null;
		if (!response.ok) this.failed(response, "alias lookup");
		return parseJson(
			z
				.object({
					name: z.literal(alias),
					collection_name: z.string().min(1),
				})
				.passthrough(),
			text,
			"Typesense alias response",
		).collection_name;
	}

	async deleteCollection(collection: string) {
		const { response } = await this.request(
			`collections/${encodeURIComponent(collection)}`,
			{ method: "DELETE" },
		);
		if (!response.ok && response.status !== 404)
			this.failed(response, "collection cleanup");
	}

	async acquireLock(alias: string, runId: string, expiresAt: number) {
		const created = await this.request("collections", {
			method: "POST",
			body: JSON.stringify({
				name: LOCK_COLLECTION,
				fields: [
					{ name: "runId", type: "string", index: false },
					{ name: "expiresAt", type: "int64", index: false },
				],
			}),
		});
		if (!created.response.ok && created.response.status !== 409)
			this.failed(created.response, "reindex lock initialization");

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const result = await this.request(
				`collections/${LOCK_COLLECTION}/documents?action=create`,
				{
					method: "POST",
					body: JSON.stringify({ id: alias, runId, expiresAt }),
				},
			);
			if (result.response.ok) return;
			if (result.response.status !== 409)
				this.failed(result.response, "reindex lock acquisition");
			const lock = await this.lock(alias);
			if (lock && lock.expiresAt > Date.now()) {
				throw new PlaceSearchReindexError(
					"Another place-search reindex is already running",
				);
			}
			await this.deleteLock(alias);
		}
		throw new PlaceSearchReindexError(
			"Could not acquire the place-search lock",
		);
	}

	async releaseLock(alias: string, runId: string) {
		const lock = await this.lock(alias);
		if (lock?.runId === runId) await this.deleteLock(alias);
	}

	private async collectionInfo(collection: string) {
		return parseJson(
			z
				.object({
					name: z.literal(collection),
					num_documents: z.number().int().nonnegative(),
				})
				.passthrough(),
			await this.jsonText(`collections/${encodeURIComponent(collection)}`, {
				method: "GET",
			}),
			"Typesense collection response",
		);
	}

	private async verifySearch(collection: string, expectedCount: number) {
		const url = `collections/${encodeURIComponent(collection)}/documents/search?q=*&query_by=name&per_page=1&include_fields=id`;
		const result = parseJson(
			z
				.object({
					found: z.number().int().nonnegative(),
					hits: z.array(z.unknown()),
				})
				.passthrough(),
			await this.jsonText(url, { method: "GET" }),
			"Typesense search probe",
		);
		if (
			result.found !== expectedCount ||
			result.hits.length !== Math.min(expectedCount, 1)
		) {
			throw new PlaceSearchReindexError(
				"Typesense search probe did not match the verified collection",
			);
		}
	}

	private async verifyDocument(collection: string, sample: SearchDocument) {
		const document = parseJson(
			z
				.object({
					id: z.literal(sample.id),
					status: z.literal(sample.status),
					version: z.literal(sample.version),
				})
				.passthrough(),
			await this.jsonText(
				`collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(sample.id)}`,
				{ method: "GET" },
			),
			"Typesense document probe",
		);
		if (!document.id)
			throw new PlaceSearchReindexError(
				"Typesense document verification failed",
			);
	}

	private async lock(alias: string) {
		const { response, text } = await this.request(
			`collections/${LOCK_COLLECTION}/documents/${encodeURIComponent(alias)}`,
			{ method: "GET" },
		);
		if (response.status === 404) return null;
		if (!response.ok) this.failed(response, "reindex lock lookup");
		return parseJson(
			z
				.object({
					id: z.literal(alias),
					runId: z.string().min(1),
					expiresAt: z.number().int().positive(),
				})
				.passthrough(),
			text,
			"Typesense reindex lock",
		);
	}

	private async deleteLock(alias: string) {
		const { response } = await this.request(
			`collections/${LOCK_COLLECTION}/documents/${encodeURIComponent(alias)}`,
			{ method: "DELETE" },
		);
		if (!response.ok && response.status !== 404)
			this.failed(response, "reindex lock release");
	}

	private async json(path: string, init: RequestInit) {
		return parseJson(
			z.unknown(),
			await this.jsonText(path, init),
			"Typesense response",
		);
	}

	private async jsonText(path: string, init: RequestInit) {
		const { response, text } = await this.request(path, init);
		if (!response.ok) this.failed(response, "request");
		return text;
	}

	private request(path: string, init: RequestInit) {
		const headers = new Headers(init.headers);
		headers.set("Accept", "application/json");
		headers.set("X-TYPESENSE-API-KEY", this.config.typesenseAdminApiKey);
		if (init.body && !headers.has("Content-Type"))
			headers.set("Content-Type", "application/json");
		return boundedFetch(
			this.fetcher,
			dependencyUrl(this.config.typesenseUrl, path),
			{ ...init, headers },
			{
				timeoutMs: this.config.timeoutMs,
				maxResponseBytes: MAX_TYPESENSE_RESPONSE_BYTES,
			},
		);
	}

	private failed(response: Response, operation: string): never {
		throw new PlaceSearchReindexError(
			`Typesense ${operation} failed with status ${response.status}`,
		);
	}
}

export function candidateDocument(candidate: Candidate) {
	return {
		id: candidate.id,
		kind: candidate.kind,
		name: candidate.name,
		...(candidate.locality ? { locality: candidate.locality } : {}),
		...(candidate.region ? { region: candidate.region } : {}),
		countryCode: candidate.countryCode,
		...(candidate.latitude !== null && candidate.longitude !== null
			? { latitude: candidate.latitude, longitude: candidate.longitude }
			: {}),
		status: candidate.status,
		source: candidate.source,
		...(candidate.sourceRecordUrl
			? { sourceRecordUrl: candidate.sourceRecordUrl }
			: {}),
		licenseCode: candidate.license.code,
		...(candidate.license.url ? { licenseUrl: candidate.license.url } : {}),
		attribution: candidate.license.attribution,
		retrievedAt: candidate.retrievedAt,
		confidence: candidate.confidence,
		version: candidate.version,
		sortId: candidate.id,
	};
}

function versionedCollectionName(alias: string, now: Date, runId: string) {
	const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 17);
	const suffix = runId.replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
	return `${alias}_${timestamp}_${suffix}`;
}

function parseJson<T>(schema: z.ZodType<T>, text: string, source: string): T {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new PlaceSearchReindexError(`${source} was not valid JSON`);
	}
	const result = schema.safeParse(value);
	if (!result.success)
		throw new PlaceSearchReindexError(`${source} did not match its contract`);
	return result.data;
}
