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

const databaseUrl = Bun.env.EVENT_ROOT_LIST_TEST_DATABASE_URL;
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };
const member = { id: userId(2) };
const outsider = { id: userId(3) };

if (!databaseUrl) {
	describe.skip("event-root list against PostgreSQL (set EVENT_ROOT_LIST_TEST_DATABASE_URL)", () => {});
} else {
	describe("event-root list against PostgreSQL", () => {
		let sql: Sql;
		let service: EventService;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 8, onnotice: () => {} });
			await migrate(sql);
			service = new EventService(
				new PostgresEventRepository(
					sql,
					new EventNotificationPayloadCodec({
						kid: "event-root-list-v1",
						key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
					}),
				),
				"event-root-list-integration-key-with-at-least-32-characters",
			);
			installPublishedRootFixtures(service, sql);
		});

		beforeEach(async () => {
			await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
		});

		afterAll(async () => {
			await sql.end();
		});

		test("isolates tenants and paginates active memberships without leaking root details", async () => {
			await service.createRoot(
				owner,
				rootInput("evt_list_alpha", "Alpha", "secret-alpha"),
			);
			await service.createRoot(
				owner,
				rootInput("evt_list_charlie", "Charlie", "secret-charlie"),
			);
			await service.createRoot(
				owner,
				rootInput("evt_list_delta", "Delta", "secret-delta"),
			);
			await service.createRoot(
				outsider,
				rootInput("evt_list_foreign", "Foreign", "secret-foreign"),
			);

			await join(member, "evt_list_alpha", "participant", "inv_list_alpha");
			await join(member, "evt_list_charlie", "organizer", "inv_list_charlie");
			await join(member, "evt_list_delta", "viewer", "inv_list_delta");
			await service.archiveEvent(owner, "evt_list_delta", "evt_list_delta", 1);

			const app = createApp({
				service,
				verifyUserToken: async (token) => ({ id: token }),
			});
			const first = await get(app, member, "/v1/event-roots?limit=1");
			expect(first.status).toBe(200);
			const firstBody = await first.json();
			expect(firstBody).toMatchObject({
				items: [
					{
						rootEventId: "evt_list_alpha",
						role: "participant",
						membershipStatus: "active",
					},
				],
				pageInfo: { hasMore: true },
			});
			expect(JSON.stringify(firstBody)).not.toContain("secret-alpha");
			expect(JSON.stringify(firstBody)).not.toContain("description");

			const cursor = firstBody.pageInfo.nextCursor as string;
			const second = await get(
				app,
				member,
				`/v1/event-roots?limit=1&cursor=${encodeURIComponent(cursor)}`,
			);
			expect(await second.json()).toMatchObject({
				items: [
					{
						rootEventId: "evt_list_charlie",
						role: "organizer",
					},
				],
				pageInfo: { hasMore: false, nextCursor: null },
			});

			const archived = await get(
				app,
				member,
				"/v1/event-roots?includeArchived=true",
			);
			expect((await archived.json()).items).toEqual([
				expect.objectContaining({ rootEventId: "evt_list_alpha" }),
				expect.objectContaining({ rootEventId: "evt_list_charlie" }),
				expect.objectContaining({
					rootEventId: "evt_list_delta",
					status: "archived",
					role: "viewer",
				}),
			]);

			for (const [actor, includeArchived] of [
				[outsider, "false"],
				[member, "true"],
			] as const) {
				const invalid = await get(
					app,
					actor,
					`/v1/event-roots?limit=1&includeArchived=${includeArchived}&cursor=${encodeURIComponent(cursor)}`,
				);
				expect(invalid.status).toBe(400);
				expect((await invalid.json()).error.code).toBe("CURSOR_INVALID");
			}

			const outsiderRoots = await get(app, outsider, "/v1/event-roots");
			expect((await outsiderRoots.json()).items).toEqual([
				expect.objectContaining({
					rootEventId: "evt_list_foreign",
					role: "owner",
				}),
			]);

			await service.updateMembership(
				owner,
				"evt_list_charlie",
				member.id,
				1,
				"organizer",
				"removed",
				"integration test",
			);
			const afterRemoval = await get(
				app,
				member,
				"/v1/event-roots?includeArchived=true",
			);
			expect(
				(await afterRemoval.json()).items.map(
					(item: { rootEventId: string }) => item.rootEventId,
				),
			).toEqual(["evt_list_alpha", "evt_list_delta"]);
		});

		async function join(
			actor: Actor,
			rootEventId: string,
			role: Exclude<Role, "owner">,
			invitationId: string,
		) {
			const invitation = await service.createInvitation(owner, rootEventId, {
				id: invitationId,
				role,
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			});
			await service.redeemInvitation(actor, invitation.token, new Date());
		}
	});
}

function rootInput(id: string, title: string, description: string): EventInput {
	return {
		id,
		kind: "team_event",
		title,
		description,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}

function get(app: ReturnType<typeof createApp>, actor: Actor, path: string) {
	return app.request(path, {
		headers: { Authorization: `Bearer ${actor.id}` },
	});
}
