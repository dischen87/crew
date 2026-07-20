import { describe, expect, test } from "bun:test";
import {
	loadPlaceEnrichmentPolicy,
	loadPlaceEnrichmentWorkerConfig,
} from "./place-enrichment-worker-config";

describe("place enrichment configuration", () => {
	test("loads enqueue policy without provider credentials", () => {
		const policy = loadPlaceEnrichmentPolicy({
			EVENT_ENRICHMENT_LLM_MODEL: "bounded-model",
		});
		expect(policy).toMatchObject({
			pipelineVersion: "place-v1",
			model: "bounded-model",
			promptVersion: "place-v1",
			maxExaCalls: 2,
			maxLlmCalls: 2,
			maxOutputTokens: 1_024,
			maxCostMicros: 50_000,
		});
		expect(JSON.stringify(policy)).not.toContain("apiKey");
	});

	test("requires provider credentials only in the worker runtime", () => {
		expect(() =>
			loadPlaceEnrichmentWorkerConfig({
				NODE_ENV: "development",
				EVENT_ENRICHMENT_LLM_MODEL: "bounded-model",
			}),
		).toThrow();
		const config = loadPlaceEnrichmentWorkerConfig(workerEnv());
		expect(config.llmMaxOutputTokensPerCall).toBe(512);
		expect(config.maxOutputTokens).toBe(1_024);
	});

	test("rejects short leases, non-TLS production providers and impossible budgets", () => {
		expect(() =>
			loadPlaceEnrichmentWorkerConfig({
				...workerEnv(),
				EVENT_ENRICHMENT_WORKER_LEASE_MS: "10000",
			}),
		).toThrow("both provider timeouts");
		expect(() =>
			loadPlaceEnrichmentWorkerConfig({
				...workerEnv(),
				NODE_ENV: "production",
				EVENT_ENRICHMENT_WORKER_DATABASE_URL:
					"postgres://database.example/crew_event",
				EVENT_ENRICHMENT_EXA_BASE_URL: "http://exa.example",
			}),
		).toThrow("HTTPS");
		expect(() =>
			loadPlaceEnrichmentWorkerConfig({
				...workerEnv(),
				EVENT_ENRICHMENT_MAX_OUTPUT_TOKENS: "256",
				EVENT_ENRICHMENT_LLM_MAX_OUTPUT_TOKENS_PER_CALL: "512",
			}),
		).toThrow("cumulative job budget");
	});
});

function workerEnv() {
	return {
		NODE_ENV: "test",
		EVENT_ENRICHMENT_LLM_MODEL: "bounded-model",
		EVENT_ENRICHMENT_EXA_API_KEY: "exa-test-key-1234567890",
		EVENT_ENRICHMENT_LLM_URL: "https://llm.example/v1/chat/completions",
		EVENT_ENRICHMENT_LLM_API_KEY: "llm-test-key-1234567890",
	};
}
