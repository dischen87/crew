import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type { InvitationAdminSummary } from "./domain";
import type { EventRepository } from "./repository";
import { EventService } from "./service";

const ownerId = "usr_00000000000000000000000000000001";
const organizerId = "usr_00000000000000000000000000000002";
const rootEventId = "evt_invitation_list";
const otherRootEventId = "evt_invitation_other";
const createdAt = new Date("2026-07-18T08:00:00.000Z");
const invitations: InvitationAdminSummary[] = [
	{
		id: "inv_list_alpha",
		rootEventId,
		role: "participant",
		emailBound: true,
		expiresAt: new Date("2026-08-18T08:00:00.000Z"),
		maxUses: 4,
		useCount: 1,
		status: "active",
		version: 2,
		createdAt,
		updatedAt: createdAt,
	},
	{
		id: "inv_list_bravo",
		rootEventId,
		role: "viewer",
		emailBound: false,
		expiresAt: new Date("2026-08-18T08:00:00.000Z"),
		maxUses: 1,
		useCount: 0,
		status: "revoked",
		version: 2,
		createdAt,
		updatedAt: createdAt,
	},
];

describe("invitation administration collection API", () => {
	test("authenticates, sanitizes summaries and binds cursors to actor and root", async () => {
		const repository = {
			listInvitations: async (
				_actor: { id: string },
				_rootEventId: string,
				page: { limit: number; after: { id: string } | null },
			) => {
				const start = page.after
					? invitations.findIndex(({ id }) => id === page.after?.id) + 1
					: 0;
				return {
					items: invitations.slice(start, start + page.limit),
					hasMore: start + page.limit < invitations.length,
				};
			},
		} as unknown as EventRepository;
		const service = new EventService(
			repository,
			"invitation-list-test-key-with-at-least-32-characters",
		);
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const path = `/v1/event-roots/${rootEventId}/invitations`;

		expect((await app.request(path)).status).toBe(401);
		const first = await app.request(`${path}?limit=1`, {
			headers: { Authorization: `Bearer ${ownerId}` },
		});
		expect(first.status).toBe(200);
		const firstBody = await first.json();
		expect(firstBody).toMatchObject({
			items: [
				{
					id: "inv_list_alpha",
					emailBound: true,
					useCount: 1,
				},
			],
			pageInfo: { hasMore: true },
		});
		expect(firstBody.items[0].createdAt).toBe(createdAt.toISOString());
		for (const field of [
			"normalizedEmailHint",
			"createdBy",
			"token",
			"tokenHash",
		]) {
			expect(Object.hasOwn(firstBody.items[0], field)).toBe(false);
		}

		const cursor = firstBody.pageInfo.nextCursor as string;
		const second = await app.request(
			`${path}?limit=1&cursor=${encodeURIComponent(cursor)}`,
			{ headers: { Authorization: `Bearer ${ownerId}` } },
		);
		expect(await second.json()).toMatchObject({
			items: [{ id: "inv_list_bravo", status: "revoked" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});

		for (const [actorId, targetRoot] of [
			[organizerId, rootEventId],
			[ownerId, otherRootEventId],
		] as const) {
			const invalid = await app.request(
				`/v1/event-roots/${targetRoot}/invitations?limit=1&cursor=${encodeURIComponent(cursor)}`,
				{ headers: { Authorization: `Bearer ${actorId}` } },
			);
			expect(invalid.status).toBe(400);
			expect((await invalid.json()).error.code).toBe("CURSOR_INVALID");
		}
	});

	test("publishes a bounded privacy-safe administration contract", async () => {
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
		const operation =
			document.paths["/v1/event-roots/{rootEventId}/invitations"]?.get;
		expect(operation?.operationId).toBe("eventInvitationsList");
		expect(operation?.["x-pagination"]).toEqual({
			strategy: "signed-keyset",
			defaultLimit: 50,
			maxLimit: 200,
			order: "id ASC",
			cursorBinding: ["principal", "rootEventId", "operation"],
		});

		const summary = document.components.schemas.EventInvitationAdminSummary;
		expect(summary?.required).toContain("emailBound");
		expect(Object.keys(summary?.properties ?? {})).toEqual([
			"id",
			"rootEventId",
			"role",
			"emailBound",
			"expiresAt",
			"maxUses",
			"useCount",
			"status",
			"version",
			"createdAt",
			"updatedAt",
		]);
		for (const field of [
			"normalizedEmailHint",
			"createdBy",
			"token",
			"tokenHash",
		]) {
			expect(Object.hasOwn(summary?.properties ?? {}, field)).toBe(false);
		}
	});
});
