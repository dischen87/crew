import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
	type BoundedFetch,
	BoundedFetchError,
	boundedFetch,
	dependencyUrl,
} from "./bounded-fetch";
import { DomainError } from "./domain";
import type { PlaceCandidateKind } from "./place-candidate";

export const MAX_PLACE_SEARCH_PAGE_SIZE = 50;
const MAX_TYPESENSE_SEARCH_RESPONSE_BYTES = 1_048_576;
const PLACE_SEARCH_OPERATION = "places.search";
const PLACE_SEARCH_SORT = "_text_match:desc,confidence:desc,sortId:asc";
const INDEXED_QUERY_FIELDS = "name,locality,region";
const INCLUDED_DOCUMENT_FIELDS = [
	"id",
	"kind",
	"name",
	"locality",
	"region",
	"countryCode",
	"latitude",
	"longitude",
	"status",
	"source",
	"sourceRecordUrl",
	"licenseCode",
	"licenseUrl",
	"attribution",
	"retrievedAt",
	"confidence",
	"version",
].join(",");

export type PlaceSearchStatus = "pending" | "enriched";
export type PlaceSearchResult = {
	id: string;
	kind: PlaceCandidateKind;
	name: string;
	locality: string | null;
	region: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	status: PlaceSearchStatus;
	source: string;
	sourceRecordUrl: string | null;
	licenseCode: string;
	licenseUrl: string | null;
	attribution: string;
	retrievedAt: string;
	confidence: number;
	version: number;
};

export type PlaceSearchInput = {
	actorId: string;
	query: string;
	kind?: PlaceCandidateKind;
	countryCode?: string;
	status?: PlaceSearchStatus;
	limit: number;
	cursor?: string;
};

export interface PlaceSearchIndex {
	search(input: {
		query: string;
		kind?: PlaceCandidateKind;
		countryCode?: string;
		status?: PlaceSearchStatus;
		page: number;
		limit: number;
	}): Promise<{ items: PlaceSearchResult[]; found: number }>;
}

const PlaceSearchDocumentSchema = z
	.object({
		id: z.string().min(1).max(128),
		kind: z.enum(["golf_course", "venue"]),
		name: z.string().min(1).max(300),
		locality: z.string().min(1).max(200).optional(),
		region: z.string().min(1).max(200).optional(),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().min(-90).max(90).optional(),
		longitude: z.number().min(-180).max(180).optional(),
		status: z.enum(["pending", "enriched"]),
		source: z.string().regex(/^[a-z][a-z0-9._-]{0,63}$/),
		sourceRecordUrl: z.string().url().max(2048).optional(),
		licenseCode: z.string().min(1).max(128),
		licenseUrl: z.string().url().max(2048).optional(),
		attribution: z.string().min(1).max(500),
		retrievedAt: z.string().datetime({ offset: true }),
		confidence: z.number().min(0).max(1),
		version: z.number().int().positive(),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.latitude === undefined) !== (value.longitude === undefined)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["latitude"],
				message: "Coordinates must be supplied together",
			});
		}
	});
const TypesenseSearchSchema = z
	.object({
		found: z.number().int().nonnegative(),
		hits: z
			.array(z.object({ document: PlaceSearchDocumentSchema }).passthrough())
			.max(MAX_PLACE_SEARCH_PAGE_SIZE),
	})
	.passthrough();

export class TypesensePlaceSearchIndex implements PlaceSearchIndex {
	private readonly fetcher: BoundedFetch;

	constructor(
		private readonly options: {
			url: string;
			apiKey: string;
			collectionAlias: string;
			timeoutMs: number;
			fetch?: BoundedFetch;
		},
	) {
		this.fetcher = options.fetch ?? fetch;
	}

	async search(input: {
		query: string;
		kind?: PlaceCandidateKind;
		countryCode?: string;
		status?: PlaceSearchStatus;
		page: number;
		limit: number;
	}) {
		const url = dependencyUrl(
			this.options.url,
			`collections/${encodeURIComponent(this.options.collectionAlias)}/documents/search`,
		);
		url.searchParams.set("q", input.query);
		url.searchParams.set("query_by", INDEXED_QUERY_FIELDS);
		url.searchParams.set("query_by_weights", "8,3,2");
		url.searchParams.set("num_typos", "2,1,1");
		url.searchParams.set("prefix", "true,true,true");
		url.searchParams.set("prioritize_exact_match", "true");
		url.searchParams.set("drop_tokens_threshold", "0");
		url.searchParams.set("sort_by", PLACE_SEARCH_SORT);
		url.searchParams.set("highlight_fields", "none");
		url.searchParams.set("include_fields", INCLUDED_DOCUMENT_FIELDS);
		url.searchParams.set("page", String(input.page));
		url.searchParams.set("per_page", String(input.limit));
		const filters = [
			input.kind ? `kind:=${input.kind}` : null,
			input.countryCode ? `countryCode:=${input.countryCode}` : null,
			input.status ? `status:=${input.status}` : null,
		].filter((value): value is string => value !== null);
		if (filters.length) url.searchParams.set("filter_by", filters.join(" && "));

		let value: unknown;
		try {
			const { response, text } = await boundedFetch(
				this.fetcher,
				url,
				{
					method: "GET",
					headers: {
						Accept: "application/json",
						"X-TYPESENSE-API-KEY": this.options.apiKey,
					},
				},
				{
					timeoutMs: this.options.timeoutMs,
					maxResponseBytes: MAX_TYPESENSE_SEARCH_RESPONSE_BYTES,
				},
			);
			if (!response.ok) throw new BoundedFetchError("Typesense search failed");
			value = JSON.parse(text);
		} catch {
			throw unavailable();
		}

		const parsed = TypesenseSearchSchema.safeParse(value);
		if (!parsed.success) throw unavailable();
		return {
			found: parsed.data.found,
			items: parsed.data.hits.map(({ document }) => ({
				...document,
				locality: document.locality ?? null,
				region: document.region ?? null,
				latitude: document.latitude ?? null,
				longitude: document.longitude ?? null,
				sourceRecordUrl: document.sourceRecordUrl ?? null,
				licenseUrl: document.licenseUrl ?? null,
			})),
		};
	}
}

export class PlaceSearchService {
	constructor(
		private readonly index: PlaceSearchIndex,
		private readonly cursorKey: string,
	) {}

	async search(input: PlaceSearchInput) {
		const normalized = {
			query: input.query.trim().replace(/\s+/g, " "),
			kind: input.kind ?? null,
			countryCode: input.countryCode ?? null,
			status: input.status ?? null,
			limit: input.limit,
		};
		const page = input.cursor
			? this.decodeCursor(input.cursor, input.actorId, normalized)
			: 1;
		const result = await this.index.search({
			query: normalized.query,
			...(normalized.kind ? { kind: normalized.kind } : {}),
			...(normalized.countryCode
				? { countryCode: normalized.countryCode }
				: {}),
			...(normalized.status ? { status: normalized.status } : {}),
			page,
			limit: normalized.limit,
		});
		const hasMore = page * normalized.limit < result.found;
		return {
			items: result.items,
			pageInfo: {
				hasMore,
				nextCursor: hasMore
					? this.encodeCursor(input.actorId, normalized, page + 1)
					: null,
			},
		};
	}

	private encodeCursor(
		actorId: string,
		filters: {
			query: string;
			kind: PlaceCandidateKind | null;
			countryCode: string | null;
			status: PlaceSearchStatus | null;
			limit: number;
		},
		page: number,
	) {
		const payload = Buffer.from(
			JSON.stringify({
				version: 1,
				operation: PLACE_SEARCH_OPERATION,
				sort: PLACE_SEARCH_SORT,
				actorId,
				...filters,
				page,
			}),
			"utf8",
		).toString("base64url");
		return `${payload}.${this.sign(payload)}`;
	}

	private decodeCursor(
		cursor: string,
		actorId: string,
		filters: {
			query: string;
			kind: PlaceCandidateKind | null;
			countryCode: string | null;
			status: PlaceSearchStatus | null;
			limit: number;
		},
	) {
		try {
			if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(cursor))
				throw new Error("shape");
			const [payload = "", signature = ""] = cursor.split(".");
			const expected = Buffer.from(this.sign(payload), "base64url");
			const actual = Buffer.from(signature, "base64url");
			if (
				expected.byteLength !== actual.byteLength ||
				!timingSafeEqual(expected, actual)
			)
				throw new Error("signature");
			const decoded: unknown = JSON.parse(
				Buffer.from(payload, "base64url").toString("utf8"),
			);
			const expectedFields = {
				version: 1,
				operation: PLACE_SEARCH_OPERATION,
				sort: PLACE_SEARCH_SORT,
				actorId,
				...filters,
			};
			if (
				!decoded ||
				typeof decoded !== "object" ||
				Array.isArray(decoded) ||
				Object.entries(expectedFields).some(
					([key, value]) => (decoded as Record<string, unknown>)[key] !== value,
				) ||
				!Number.isSafeInteger((decoded as Record<string, unknown>).page) ||
				((decoded as Record<string, number>).page ?? 0) < 2 ||
				Object.keys(decoded).sort().join(",") !==
					"actorId,countryCode,kind,limit,operation,page,query,sort,status,version"
			) {
				throw new Error("payload");
			}
			return (decoded as { page: number }).page;
		} catch {
			throw new DomainError(
				400,
				"CURSOR_INVALID",
				"The place-search cursor is invalid.",
			);
		}
	}

	private sign(payload: string) {
		return createHmac("sha256", this.cursorKey)
			.update(payload)
			.digest("base64url");
	}
}

function unavailable() {
	return new DomainError(
		503,
		"SERVICE_UNAVAILABLE",
		"Place search is temporarily unavailable.",
		{ "Retry-After": "1" },
	);
}
