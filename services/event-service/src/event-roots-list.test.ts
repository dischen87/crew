import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { EventRootSummary } from "./domain";
import type { EventRepository } from "./repository";
import { EventService } from "./service";

const ownerId = "usr_00000000000000000000000000000001";
const otherId = "usr_00000000000000000000000000000002";
const createdAt = new Date("2026-07-18T08:00:00.000Z");
const roots: EventRootSummary[] = [
	{
		rootEventId: "evt_list_alpha",
		kind: "team_event",
		title: "Alpha offsite",
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
		version: 1,
		createdAt,
		updatedAt: createdAt,
		role: "owner",
		membershipStatus: "active",
	},
	{
		rootEventId: "evt_list_bravo",
		kind: "trip",
		title: "Bravo trip",
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft",
		version: 1,
		createdAt,
		updatedAt: createdAt,
		role: "participant",
		membershipStatus: "active",
	},
];

describe("event-root collection API", () => {
	test("authenticates, exposes privacy-safe summaries and binds cursors", async () => {
		const repository = {
			listRoots: async (
				_actor: { id: string },
				query: {
					limit: number;
					after: { rootEventId: string } | null;
				},
			) => {
				const start = query.after
					? roots.findIndex(
							({ rootEventId }) => rootEventId === query.after?.rootEventId,
						) + 1
					: 0;
				return {
					items: roots.slice(start, start + query.limit),
					hasMore: start + query.limit < roots.length,
				};
			},
		} as unknown as EventRepository;
		const service = new EventService(
			repository,
			"event-root-list-test-key-with-at-least-32-characters",
		);
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});

		expect((await app.request("/v1/event-roots")).status).toBe(401);

		const first = await app.request("/v1/event-roots?limit=1", {
			headers: { Authorization: `Bearer ${ownerId}` },
		});
		expect(first.status).toBe(200);
		const firstBody = await first.json();
		expect(firstBody).toMatchObject({
			items: [
				{
					rootEventId: "evt_list_alpha",
					role: "owner",
					membershipStatus: "active",
				},
			],
			pageInfo: { hasMore: true },
		});
		expect(firstBody.items[0].createdAt).toBe(createdAt.toISOString());
		expect(Object.hasOwn(firstBody.items[0], "description")).toBe(false);
		const cursor = firstBody.pageInfo.nextCursor;
		expect(cursor).toBeString();

		const second = await app.request(
			`/v1/event-roots?limit=1&cursor=${encodeURIComponent(cursor)}`,
			{ headers: { Authorization: `Bearer ${ownerId}` } },
		);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({
			items: [{ rootEventId: "evt_list_bravo" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});

		for (const [actorId, includeArchived] of [
			[otherId, "false"],
			[ownerId, "true"],
		] as const) {
			const response = await app.request(
				`/v1/event-roots?limit=1&includeArchived=${includeArchived}&cursor=${encodeURIComponent(cursor)}`,
				{ headers: { Authorization: `Bearer ${actorId}` } },
			);
			expect(response.status).toBe(400);
			expect((await response.json()).error.code).toBe("CURSOR_INVALID");
		}
	});

	test("publishes the bounded actor-scoped collection contract", async () => {
		const document = (await (
			await createApp().request("/docs/openapi.json")
		).json()) as {
			paths: Record<string, { get?: Record<string, unknown> }>;
			components: {
				schemas: Record<
					string,
					{ properties?: Record<string, unknown>; required?: string[] }
				>;
			};
		};
		const operation = document.paths["/v1/event-roots"]?.get;
		expect(operation?.operationId).toBe("eventRootsList");
		expect(operation?.["x-pagination"]).toEqual({
			strategy: "signed-keyset",
			defaultLimit: 50,
			maxLimit: 200,
			order: "rootEventId ASC",
			cursorBinding: ["principal", "operation", "includeArchived"],
		});

		const parameters = operation?.parameters as
			| Array<{ name?: string; schema?: Record<string, unknown> }>
			| undefined;
		expect(
			parameters?.find(({ name }) => name === "includeArchived")?.schema,
		).toMatchObject({ enum: ["true", "false"], default: "false" });

		const summary = document.components.schemas.EventRootSummary;
		expect(summary?.required).toContain("membershipStatus");
		expect(Object.keys(summary?.properties ?? {})).toEqual([
			"rootEventId",
			"kind",
			"title",
			"timeZone",
			"startsAt",
			"endsAt",
			"status",
			"version",
			"createdAt",
			"updatedAt",
			"role",
			"membershipStatus",
		]);
		expect(Object.hasOwn(summary?.properties ?? {}, "description")).toBe(false);
	});
});
