import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { Actor, EventInput, Role } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl = Bun.env.EVENT_INVITATION_LIST_TEST_DATABASE_URL;
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };
const organizer = { id: userId(2) };
const participant = { id: userId(3) };
const redeemer = { id: userId(4) };
const outsider = { id: userId(5) };
const rootEventId = "evt_invitation_admin";
const foreignRootEventId = "evt_invitation_foreign";

if (!databaseUrl) {
	describe.skip("invitation administration list against PostgreSQL (set EVENT_INVITATION_LIST_TEST_DATABASE_URL)", () => {});
} else {
	describe("invitation administration list against PostgreSQL", () => {
		let sql: Sql;
		let service: EventService;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
			await migrate(sql);
			service = new EventService(
				new PostgresEventRepository(
					sql,
					new EventNotificationPayloadCodec({
						kid: "invitation-list-v1",
						key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
					}),
				),
				"invitation-list-integration-key-with-at-least-32-characters",
			);
			installPublishedRootFixtures(service, sql);
		});

		beforeEach(async () => {
			await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
		});

		afterAll(async () => {
			await sql.end();
		});

		test("allows managers while concealing tenants and all invitation secrets", async () => {
			await service.createRoot(owner, rootInput(rootEventId, "Main root"));
			await service.createRoot(
				outsider,
				rootInput(foreignRootEventId, "Foreign root"),
			);
			await join(
				owner,
				organizer,
				rootEventId,
				"organizer",
				"inv_member_organizer",
			);
			await join(
				owner,
				participant,
				rootEventId,
				"participant",
				"inv_member_participant",
			);

			await service.createInvitation(owner, rootEventId, {
				id: "inv_admin_alpha",
				role: "participant",
				normalizedEmailHint: "private-alpha@example.test",
				expiresAt: future(),
				maxUses: 4,
			});
			const used = await service.createInvitation(owner, rootEventId, {
				id: "inv_admin_bravo",
				role: "viewer",
				expiresAt: future(),
				maxUses: 3,
			});
			await service.redeemInvitation(redeemer, used.token, new Date());
			await service.createInvitation(owner, rootEventId, {
				id: "inv_admin_charlie",
				role: "participant",
				normalizedEmailHint: "private-charlie@example.test",
				expiresAt: future(),
				maxUses: 1,
			});
			await service.revokeInvitation(
				owner,
				rootEventId,
				"inv_admin_charlie",
				1,
			);
			await service.createInvitation(outsider, foreignRootEventId, {
				id: "inv_foreign_only",
				role: "viewer",
				normalizedEmailHint: "private-foreign@example.test",
				expiresAt: future(),
				maxUses: 1,
			});

			const app = createApp({
				service,
				verifyUserToken: async (token) => ({ id: token }),
			});
			const path = `/v1/event-roots/${rootEventId}/invitations`;
			expect((await app.request(path)).status).toBe(401);

			const ownerItems = await allPages(app, owner, path, 2);
			expect(ownerItems.map(({ id }) => id)).toEqual([
				"inv_admin_alpha",
				"inv_admin_bravo",
				"inv_admin_charlie",
				"inv_member_organizer",
				"inv_member_participant",
			]);
			expect(ownerItems).toContainEqual(
				expect.objectContaining({
					id: "inv_admin_alpha",
					emailBound: true,
					maxUses: 4,
					useCount: 0,
					status: "active",
				}),
			);
			expect(ownerItems).toContainEqual(
				expect.objectContaining({
					id: "inv_admin_bravo",
					emailBound: false,
					useCount: 1,
				}),
			);
			expect(ownerItems).toContainEqual(
				expect.objectContaining({
					id: "inv_admin_charlie",
					status: "revoked",
					version: 2,
				}),
			);

			const organizerResponse = await get(app, organizer, path);
			expect(organizerResponse.status).toBe(200);
			expect((await organizerResponse.json()).items).toHaveLength(5);
			for (const actor of [participant, outsider]) {
				const concealed = await get(app, actor, path);
				expect(concealed.status).toBe(404);
				expect((await concealed.json()).error.code).toBe("NOT_FOUND");
			}

			const foreign = await get(
				app,
				outsider,
				`/v1/event-roots/${foreignRootEventId}/invitations`,
			);
			expect((await foreign.json()).items).toEqual([
				expect.objectContaining({ id: "inv_foreign_only" }),
			]);

			const first = await get(app, owner, `${path}?limit=1`);
			const cursor = (await first.json()).pageInfo.nextCursor as string;
			for (const [actor, targetRoot] of [
				[organizer, rootEventId],
				[owner, foreignRootEventId],
			] as const) {
				const invalid = await get(
					app,
					actor,
					`/v1/event-roots/${targetRoot}/invitations?limit=1&cursor=${encodeURIComponent(cursor)}`,
				);
				expect(invalid.status).toBe(400);
				expect((await invalid.json()).error.code).toBe("CURSOR_INVALID");
			}

			const [stored] = await sql<
				{ tokenHash: string; normalizedEmailHint: string }[]
			>`
				SELECT token_hash AS "tokenHash",
					normalized_email_hint AS "normalizedEmailHint"
				FROM event_invitations WHERE id = 'inv_admin_alpha'
			`;
			const serialized = JSON.stringify(ownerItems);
			expect(serialized).not.toContain(stored?.tokenHash ?? "missing-token");
			expect(serialized).not.toContain(
				stored?.normalizedEmailHint ?? "missing-email",
			);
			for (const field of [
				"normalizedEmailHint",
				"createdBy",
				"token",
				"tokenHash",
			]) {
				expect(Object.hasOwn(ownerItems[0] ?? {}, field)).toBe(false);
			}
		});

		async function join(
			creator: Actor,
			actor: Actor,
			root: string,
			role: Exclude<Role, "owner">,
			invitationId: string,
		) {
			const invitation = await service.createInvitation(creator, root, {
				id: invitationId,
				role,
				expiresAt: future(),
				maxUses: 1,
			});
			await service.redeemInvitation(actor, invitation.token, new Date());
		}
	});
}

function rootInput(id: string, title: string): EventInput {
	return {
		id,
		kind: "team_event",
		title,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}

function future() {
	return new Date(Date.now() + 60_000);
}

function get(app: ReturnType<typeof createApp>, actor: Actor, path: string) {
	return app.request(path, {
		headers: { Authorization: `Bearer ${actor.id}` },
	});
}

async function allPages(
	app: ReturnType<typeof createApp>,
	actor: Actor,
	path: string,
	limit: number,
) {
	const items: Array<Record<string, unknown>> = [];
	let cursor: string | null = null;
	do {
		const response = await get(
			app,
			actor,
			`${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		items.push(...body.items);
		cursor = body.pageInfo.nextCursor;
	} while (cursor);
	return items;
}
