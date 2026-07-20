import { describe, expect, test } from "bun:test";
import {
	GolfCandidateSourceError,
	importOsmGolfCandidates,
	loadGolfCandidateImportConfig,
	osmGolfCandidates,
} from "./golf-candidate-source";
import { placeCandidateId } from "./place-candidate";
import {
	createPlaceCandidateServiceAuth,
	PLACE_CANDIDATE_WRITE_SCOPE,
} from "./place-candidate-auth";

const SERVICE_KEY = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";

describe("OpenStreetMap golf-candidate source", () => {
	test("imports a bounded stable ODbL candidate without provider credentials", async () => {
		let overpassCalls = 0;
		let importCalls = 0;
		const verifier = createPlaceCandidateServiceAuth({
			issuer: "crew-place-catalog",
			audience: "crew-event-service",
			current: { id: "golf-import-v1", key: SERVICE_KEY },
		});
		const result = await importOsmGolfCandidates(config(), {
			now: () => new Date("2026-07-19T00:00:00.000Z"),
			fetch: async (input, init) => {
				const url = new URL(input instanceof Request ? input.url : input);
				if (url.hostname === "overpass.test") {
					overpassCalls += 1;
					expect(new Headers(init?.headers).has("authorization")).toBe(false);
					const query = new URLSearchParams(String(init?.body)).get("data");
					expect(query).toContain(
						'nwr["leisure"="golf_course"]["name"](36.78,30.9,36.95,31.3)',
					);
					expect(query).toContain("out center tags qt 101");
					return Response.json({
						elements: [
							{
								type: "way",
								id: 169450196,
								center: { lat: 36.8665457, lon: 31.0116798 },
								tags: { name: "Carya Golf Club" },
							},
						],
					});
				}

				importCalls += 1;
				const token = /^Bearer (.+)$/.exec(
					new Headers(init?.headers).get("authorization") ?? "",
				)?.[1];
				expect(token).toBeTruthy();
				expect(
					await verifier(token as string, PLACE_CANDIDATE_WRITE_SCOPE),
				).toBe(true);
				const body = JSON.parse(String(init?.body)) as {
					candidates: Array<Record<string, unknown>>;
				};
				expect(body.candidates).toEqual([
					expect.objectContaining({
						source: "osm",
						sourceRecordId: "way/169450196",
						name: "Carya Golf Club",
						locality: "Belek",
						region: "Antalya",
						countryCode: "TR",
						sourceRecordUrl: "https://www.openstreetmap.org/way/169450196",
						license: {
							code: "ODbL-1.0",
							url: "https://www.openstreetmap.org/copyright",
							attribution: "© OpenStreetMap contributors",
							allowsSearchIndex: true,
						},
					}),
				]);
				expect(JSON.stringify(body)).not.toContain("website");
				expect(JSON.stringify(body)).not.toContain("description");
				return Response.json({
					results: [
						{
							outcome: "inserted",
							candidate: {
								id: placeCandidateId("osm", "way/169450196"),
								source: "osm",
								sourceRecordId: "way/169450196",
							},
						},
					],
				});
			},
		});

		expect(result.results).toHaveLength(1);
		expect(overpassCalls).toBe(1);
		expect(importCalls).toBe(1);
	});

	test("rejects oversized tiles and unsafe production configuration", () => {
		expect(() =>
			osmGolfCandidates(
				{
					elements: Array.from({ length: 101 }, (_, id) => ({
						type: "node",
						id: id + 1,
						lat: 36.8,
						lon: 31,
						tags: { name: `Course ${id}` },
					})),
				},
				{ countryCode: "TR", locality: "Belek", region: "Antalya" },
				new Date("2026-07-19T00:00:00.000Z"),
			),
		).toThrow(GolfCandidateSourceError);
		expect(() =>
			loadGolfCandidateImportConfig({
				NODE_ENV: "production",
				PLACE_GOLF_IMPORT_EVENT_SERVICE_URL: "http://event.test",
				PLACE_GOLF_IMPORT_BOUNDS: "36.78,30.9,39.1,31.3",
				PLACE_GOLF_IMPORT_COUNTRY_CODE: "TR",
				PLACE_GOLF_IMPORT_SERVICE_KEY_ID: "golf-import-v1",
				PLACE_GOLF_IMPORT_SERVICE_KEY: SERVICE_KEY,
			}),
		).toThrow();
	});
});

function config() {
	return loadGolfCandidateImportConfig({
		NODE_ENV: "test",
		PLACE_GOLF_IMPORT_EVENT_SERVICE_URL: "https://event.test",
		PLACE_GOLF_IMPORT_OVERPASS_URL: "https://overpass.test/interpreter",
		PLACE_GOLF_IMPORT_BOUNDS: "36.78,30.90,36.95,31.30",
		PLACE_GOLF_IMPORT_COUNTRY_CODE: "TR",
		PLACE_GOLF_IMPORT_LOCALITY: "Belek",
		PLACE_GOLF_IMPORT_REGION: "Antalya",
		PLACE_GOLF_IMPORT_SERVICE_ISSUER: "crew-place-catalog",
		PLACE_GOLF_IMPORT_SERVICE_AUDIENCE: "crew-event-service",
		PLACE_GOLF_IMPORT_SERVICE_KEY_ID: "golf-import-v1",
		PLACE_GOLF_IMPORT_SERVICE_KEY: SERVICE_KEY,
	});
}
