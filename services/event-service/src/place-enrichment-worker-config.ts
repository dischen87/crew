import { z } from "zod";
import type { PlaceEnrichmentPolicy } from "./place-enrichment";

const DEVELOPMENT_DATABASE_URL = "postgres://localhost/crew_event";
const ACK_BUFFER_MS = 1_000;
const APPROVED_EXA_ORIGIN = "https://api.exa.ai";

const PlaceEnrichmentPolicySchema = z.object({
	pipelineVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
	model: z.string().min(1).max(128),
	promptVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
	maxAttempts: z.coerce.number().int().min(1).max(10),
	maxExaCalls: z.coerce.number().int().min(1).max(4),
	maxLlmCalls: z.coerce.number().int().min(1).max(4),
	maxInputTokens: z.coerce.number().int().min(1_000).max(100_000),
	maxOutputTokens: z.coerce.number().int().min(64).max(4_096),
	maxCostMicros: z.coerce.number().int().min(1_000).max(1_000_000),
	providerTimeoutMs: z.coerce.number().int().min(100).max(30_000),
	maxResponseBytes: z.coerce.number().int().min(1_024).max(1_048_576),
});

const PlaceEnrichmentWorkerConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		databaseUrl: z.string().url(),
		workerId: z.string().min(1).max(128),
		pollIntervalMs: z.coerce.number().int().min(100).max(60_000),
		leaseMs: z.coerce.number().int().min(1_000).max(300_000),
		pipelineVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
		model: z.string().min(1).max(128),
		promptVersion: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
		maxAttempts: z.coerce.number().int().min(1).max(10),
		maxExaCalls: z.coerce.number().int().min(1).max(4),
		maxLlmCalls: z.coerce.number().int().min(1).max(4),
		maxInputTokens: z.coerce.number().int().min(1_000).max(100_000),
		maxOutputTokens: z.coerce.number().int().min(64).max(4_096),
		maxCostMicros: z.coerce.number().int().min(1_000).max(1_000_000),
		providerTimeoutMs: z.coerce.number().int().min(100).max(30_000),
		maxResponseBytes: z.coerce.number().int().min(1_024).max(1_048_576),
		exaBaseUrl: z.string().url(),
		exaApiKey: z.string().min(16).max(512),
		exaMaxResults: z.coerce.number().int().min(1).max(5),
		exaMaxCostMicrosPerCall: z.coerce.number().int().min(1).max(100_000),
		llmUrl: z.string().url(),
		llmApiKey: z.string().min(16).max(512),
		llmMaxOutputTokensPerCall: z.coerce.number().int().min(64).max(4_096),
		llmInputCostMicrosPerMillionTokens: z.coerce
			.number()
			.int()
			.min(1)
			.max(100_000_000),
		llmOutputCostMicrosPerMillionTokens: z.coerce
			.number()
			.int()
			.min(1)
			.max(100_000_000),
		maxEvidenceCharacters: z.coerce.number().int().min(1_000).max(40_000),
		baseBackoffMs: z.coerce.number().int().min(100).max(300_000),
		maxBackoffMs: z.coerce.number().int().min(100).max(3_600_000),
	})
	.superRefine((value, context) => {
		if (value.baseBackoffMs > value.maxBackoffMs) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["baseBackoffMs"],
				message: "Base backoff must not exceed maximum backoff",
			});
		}
		if (value.llmMaxOutputTokensPerCall > value.maxOutputTokens) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["llmMaxOutputTokensPerCall"],
				message: "Per-call LLM output must fit the cumulative job budget",
			});
		}
		if (value.leaseMs <= value.providerTimeoutMs * 2 + ACK_BUFFER_MS) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["leaseMs"],
				message:
					"Enrichment lease must cover both provider timeouts and acknowledgment",
			});
		}
		if (
			value.exaMaxCostMicrosPerCall * value.maxExaCalls >=
			value.maxCostMicros
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["exaMaxCostMicrosPerCall"],
				message:
					"Exa reservations must leave budget for bounded LLM extraction",
			});
		}
		if (value.environment !== "production") return;
		for (const [field, url] of [
			["exaBaseUrl", value.exaBaseUrl],
			["llmUrl", value.llmUrl],
		] as const) {
			if (new URL(url).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: [field],
					message: `${field} must use HTTPS in production`,
				});
			}
		}
	});

export type PlaceEnrichmentWorkerConfig = z.infer<
	typeof PlaceEnrichmentWorkerConfigSchema
>;

export function placeEnrichmentPolicy(
	config: PlaceEnrichmentWorkerConfig,
): PlaceEnrichmentPolicy {
	return {
		pipelineVersion: config.pipelineVersion,
		model: config.model,
		promptVersion: config.promptVersion,
		maxAttempts: config.maxAttempts,
		maxExaCalls: config.maxExaCalls,
		maxLlmCalls: config.maxLlmCalls,
		maxInputTokens: config.maxInputTokens,
		maxOutputTokens: config.maxOutputTokens,
		maxCostMicros: config.maxCostMicros,
		providerTimeoutMs: config.providerTimeoutMs,
		maxResponseBytes: config.maxResponseBytes,
	};
}

export function loadPlaceEnrichmentPolicy(
	env: Record<string, string | undefined> = Bun.env,
): PlaceEnrichmentPolicy {
	return PlaceEnrichmentPolicySchema.parse({
		pipelineVersion: env.EVENT_ENRICHMENT_PIPELINE_VERSION ?? "place-v1",
		model: env.EVENT_ENRICHMENT_LLM_MODEL,
		promptVersion: env.EVENT_ENRICHMENT_PROMPT_VERSION ?? "place-v1",
		maxAttempts: env.EVENT_ENRICHMENT_MAX_ATTEMPTS ?? "3",
		maxExaCalls: env.EVENT_ENRICHMENT_MAX_EXA_CALLS ?? "2",
		maxLlmCalls: env.EVENT_ENRICHMENT_MAX_LLM_CALLS ?? "2",
		maxInputTokens: env.EVENT_ENRICHMENT_MAX_INPUT_TOKENS ?? "20000",
		maxOutputTokens: env.EVENT_ENRICHMENT_MAX_OUTPUT_TOKENS ?? "1024",
		maxCostMicros: env.EVENT_ENRICHMENT_MAX_COST_MICROS ?? "50000",
		providerTimeoutMs: env.EVENT_ENRICHMENT_PROVIDER_TIMEOUT_MS ?? "5000",
		maxResponseBytes: env.EVENT_ENRICHMENT_MAX_RESPONSE_BYTES ?? "262144",
	});
}

export function loadPlaceEnrichmentWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): PlaceEnrichmentWorkerConfig {
	const environment = env.NODE_ENV ?? "development";
	const config = PlaceEnrichmentWorkerConfigSchema.parse({
		environment,
		databaseUrl:
			env.EVENT_ENRICHMENT_WORKER_DATABASE_URL ??
			(environment === "production"
				? undefined
				: (env.EVENT_DATABASE_URL ?? DEVELOPMENT_DATABASE_URL)),
		workerId:
			env.EVENT_ENRICHMENT_WORKER_ID ??
			`event-enrichment-worker-${crypto.randomUUID()}`,
		pollIntervalMs: env.EVENT_ENRICHMENT_WORKER_POLL_INTERVAL_MS ?? "1000",
		leaseMs: env.EVENT_ENRICHMENT_WORKER_LEASE_MS ?? "15000",
		pipelineVersion: env.EVENT_ENRICHMENT_PIPELINE_VERSION ?? "place-v1",
		model: env.EVENT_ENRICHMENT_LLM_MODEL,
		promptVersion: env.EVENT_ENRICHMENT_PROMPT_VERSION ?? "place-v1",
		maxAttempts: env.EVENT_ENRICHMENT_MAX_ATTEMPTS ?? "3",
		maxExaCalls: env.EVENT_ENRICHMENT_MAX_EXA_CALLS ?? "2",
		maxLlmCalls: env.EVENT_ENRICHMENT_MAX_LLM_CALLS ?? "2",
		maxInputTokens: env.EVENT_ENRICHMENT_MAX_INPUT_TOKENS ?? "20000",
		maxOutputTokens: env.EVENT_ENRICHMENT_MAX_OUTPUT_TOKENS ?? "1024",
		maxCostMicros: env.EVENT_ENRICHMENT_MAX_COST_MICROS ?? "50000",
		providerTimeoutMs: env.EVENT_ENRICHMENT_PROVIDER_TIMEOUT_MS ?? "5000",
		maxResponseBytes: env.EVENT_ENRICHMENT_MAX_RESPONSE_BYTES ?? "262144",
		exaBaseUrl: env.EVENT_ENRICHMENT_EXA_BASE_URL ?? "https://api.exa.ai",
		exaApiKey: env.EVENT_ENRICHMENT_EXA_API_KEY,
		exaMaxResults: env.EVENT_ENRICHMENT_EXA_MAX_RESULTS ?? "3",
		exaMaxCostMicrosPerCall:
			env.EVENT_ENRICHMENT_EXA_MAX_COST_MICROS_PER_CALL ?? "10000",
		llmUrl: env.EVENT_ENRICHMENT_LLM_URL,
		llmApiKey: env.EVENT_ENRICHMENT_LLM_API_KEY,
		llmMaxOutputTokensPerCall:
			env.EVENT_ENRICHMENT_LLM_MAX_OUTPUT_TOKENS_PER_CALL ?? "512",
		llmInputCostMicrosPerMillionTokens:
			env.EVENT_ENRICHMENT_LLM_INPUT_COST_MICROS_PER_MILLION ?? "150000",
		llmOutputCostMicrosPerMillionTokens:
			env.EVENT_ENRICHMENT_LLM_OUTPUT_COST_MICROS_PER_MILLION ?? "600000",
		maxEvidenceCharacters:
			env.EVENT_ENRICHMENT_MAX_EVIDENCE_CHARACTERS ?? "12000",
		baseBackoffMs: env.EVENT_ENRICHMENT_BASE_BACKOFF_MS ?? "1000",
		maxBackoffMs: env.EVENT_ENRICHMENT_MAX_BACKOFF_MS ?? "60000",
	});
	if (config.environment === "production") {
		assertApprovedProviderDestination({
			name: "EVENT_ENRICHMENT_EXA_BASE_URL",
			value: config.exaBaseUrl,
			allowedOrigin: APPROVED_EXA_ORIGIN,
			originOnly: true,
		});
		assertApprovedProviderDestination({
			name: "EVENT_ENRICHMENT_LLM_URL",
			value: config.llmUrl,
			allowedOrigin: env.EVENT_ENRICHMENT_LLM_ALLOWED_ORIGIN,
			originOnly: false,
		});
	}
	return config;
}

function assertApprovedProviderDestination(input: {
	name: string;
	value: string;
	allowedOrigin: string | undefined;
	originOnly: boolean;
}) {
	if (!input.allowedOrigin) {
		throw new Error(`${input.name} requires an explicitly approved origin`);
	}
	let approved: URL;
	try {
		approved = new URL(input.allowedOrigin);
	} catch {
		throw new Error(`${input.name} approved origin is invalid`);
	}
	if (
		approved.protocol !== "https:" ||
		approved.username ||
		approved.password ||
		input.allowedOrigin !== approved.origin
	) {
		throw new Error(
			`${input.name} approved origin must be one canonical HTTPS origin`,
		);
	}

	const destination = new URL(input.value);
	if (
		destination.username ||
		destination.password ||
		input.value.includes("?") ||
		input.value.includes("#")
	) {
		throw new Error(
			`${input.name} must not contain userinfo, query parameters or a fragment`,
		);
	}
	if (destination.origin !== approved.origin) {
		throw new Error(`${input.name} origin is not approved`);
	}
	if (input.originOnly) {
		if (input.value !== destination.origin) {
			throw new Error(`${input.name} must be one canonical origin`);
		}
	} else if (destination.pathname === "/" || input.value !== destination.href) {
		throw new Error(`${input.name} must be one canonical endpoint URL`);
	}
}
