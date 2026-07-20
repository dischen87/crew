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
import { DomainError, type EventInput, type ItineraryInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { InvitationTokenCodec } from "./invitation-token";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };
const organizer = { id: userId(2) };
const participant = { id: userId(3) };
const secondParticipant = { id: userId(4) };
let sql: Sql;
let service: EventService;
const notificationPayloads = () =>
	new EventNotificationPayloadCodec({
		kid: "test-v1",
		key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
	});

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12 });
	await migrate(sql);
	service = new EventService(
		new PostgresEventRepository(sql, notificationPayloads()),
		"test-invitation-key-with-at-least-32-characters",
	);
	installPublishedRootFixtures(service, sql);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
});

afterAll(async () => {
	await sql.end();
});

describe("event service against PostgreSQL 17", () => {
	test("serves authenticated OpenAPI routes and exact durable idempotency replay", async () => {
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const payload = {
			id: "evt_root0001",
			kind: "team_event",
			title: "Crew Offsite",
			description: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			status: "draft",
		};
		const send = (body = payload, requestId?: string) =>
			app.request("/v1/event-roots", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${owner.id}`,
					"Content-Type": "application/json",
					"Idempotency-Key": "root-create-0001",
					...(requestId ? { "X-Request-ID": requestId } : {}),
				},
				body: JSON.stringify(body),
			});

		const first = await send(payload, "request-success-first");
		expect(first.status).toBe(201);
		expect(first.headers.get("location")).toBe("/v1/event-roots/evt_root0001");
		expect(first.headers.get("idempotency-replayed")).toBe("false");
		const firstText = await first.text();
		const firstBody = JSON.parse(firstText);

		const replay = await send(payload, "request-success-replay");
		expect(replay.status).toBe(201);
		expect(replay.headers.get("location")).toBe(first.headers.get("location"));
		expect(first.headers.get("x-request-id")).toBe("request-success-first");
		expect(replay.headers.get("x-request-id")).toBe("request-success-replay");
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		const replayText = await replay.text();
		expect(replayText).toBe(firstText);
		expect(JSON.parse(replayText)).toEqual(firstBody);

		const changed = await send({ ...payload, title: "Different" });
		expect(changed.status).toBe(409);
		expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

		const [proof] = await sql<
			{
				count: number;
				revision: string;
				retained: boolean;
				headers: Record<string, string>;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_roots) AS count,
				(SELECT max(revision)::text FROM event_roots) AS revision,
				(SELECT bool_and(expires_at >= created_at + interval '30 days') FROM event_idempotency_records) AS retained,
				(SELECT response_headers FROM event_idempotency_records LIMIT 1) AS headers
    `;
		expect(proof).toMatchObject({ count: 1, revision: "1", retained: true });
		expect(proof?.headers.Location).toBe("/v1/event-roots/evt_root0001");
		expect(proof?.headers["X-Request-ID"]).toBeUndefined();
		const membershipPageResponse = await app.request(
			"/v1/event-roots/evt_root0001/memberships?limit=1",
			{ headers: { Authorization: `Bearer ${owner.id}` } },
		);
		expect(membershipPageResponse.status).toBe(200);
		expect(await membershipPageResponse.json()).toMatchObject({
			items: [{ userId: owner.id, role: "owner" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});

		const invitationPayload = {
			id: "inv_route001",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			maxUses: 2,
		};
		const inviteRequest = (targetApp = app, input = invitationPayload) =>
			targetApp.request("/v1/event-roots/evt_root0001/invitations", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${owner.id}`,
					"Content-Type": "application/json",
					"Idempotency-Key":
						input.id === invitationPayload.id
							? "invite-create-0001"
							: "invite-create-rotated-0001",
				},
				body: JSON.stringify(input),
			});
		const inviteFirst = await inviteRequest();
		expect(inviteFirst.status).toBe(201);
		expect(inviteFirst.headers.get("cache-control")).toBe("private, no-store");
		const inviteBody = await inviteFirst.json();
		expect(inviteBody.token).toStartWith("cin_");
		expect(inviteBody.invitation).not.toHaveProperty("tokenKeyId");
		const inviteReplay = await inviteRequest();
		expect(inviteReplay.headers.get("cache-control")).toBe("private, no-store");
		expect(await inviteReplay.json()).toEqual(inviteBody);
		const [storedInviteResponse] = await sql<
			{ body: string; hash: string; cacheControl: string }[]
		>`
			SELECT response_body::text AS body,
				response_headers->>'Cache-Control' AS "cacheControl",
				(SELECT token_hash FROM event_invitations WHERE id = 'inv_route001') AS hash
			FROM event_idempotency_records
			WHERE operation_id = 'eventInvitationsCreate'
		`;
		expect(storedInviteResponse?.cacheControl).toBe("private, no-store");
		expect(storedInviteResponse?.body).not.toContain("cin_");
		expect(storedInviteResponse?.body).not.toContain("tokenKeyId");
		expect(storedInviteResponse?.hash).not.toBe(inviteBody.token);

		const rotatedInvitationTokens = new InvitationTokenCodec(
			{
				id: "rotated-invitation-v2",
				secret: "rotated-test-invitation-key-with-at-least-32-characters",
			},
			{
				id: "legacy-invitation-v1",
				secret: "test-invitation-key-with-at-least-32-characters",
			},
		);
		const rotatedService = new EventService(
			new PostgresEventRepository(sql, notificationPayloads()),
			rotatedInvitationTokens,
		);
		const rotatedApp = createApp({
			service: rotatedService,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const rotatedReplay = await inviteRequest(rotatedApp);
		expect(rotatedReplay.status).toBe(201);
		expect(rotatedReplay.headers.get("idempotency-replayed")).toBe("true");
		expect(await rotatedReplay.json()).toEqual(inviteBody);
		expect(
			await rotatedService.previewInvitation(inviteBody.token, new Date()),
		).toMatchObject({ usable: true });
		const rotatedInvitationPayload = {
			...invitationPayload,
			id: "inv_route002",
		};
		const rotatedInvite = await inviteRequest(
			rotatedApp,
			rotatedInvitationPayload,
		);
		expect(rotatedInvite.status).toBe(201);
		const rotatedInviteBody = await rotatedInvite.json();
		expect(rotatedInviteBody.token).toBe(
			rotatedInvitationTokens.currentToken(rotatedInvitationPayload.id).token,
		);
		const storedTokenKeys = await sql<{ id: string; tokenKeyId: string }[]>`
			SELECT id, token_key_id AS "tokenKeyId"
			FROM event_invitations
			WHERE id IN (${invitationPayload.id}, ${rotatedInvitationPayload.id})
			ORDER BY id
		`;
		expect([...storedTokenKeys]).toEqual([
			{ id: invitationPayload.id, tokenKeyId: "legacy-invitation-v1" },
			{ id: rotatedInvitationPayload.id, tokenKeyId: "rotated-invitation-v2" },
		]);

		const unauthenticated = await app.request("/v1/event-roots/evt_root0001");
		expect(unauthenticated.status).toBe(401);
		expect((await unauthenticated.json()).error.requestId).toBeString();
	});

	test("checks current manager and membership authority after matching idempotency fingerprints", async () => {
		const rootEventId = "evt_replayauth1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES (${rootEventId}, ${organizer.id}, 'organizer', 'active')
		`;
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const headers = (actorId: string, key: string, requestId: string) => ({
			Authorization: `Bearer ${actorId}`,
			"Content-Type": "application/json",
			"Idempotency-Key": key,
			"X-Request-ID": requestId,
		});
		const childRequest = (title: string, requestId: string) =>
			app.request(`/v1/event-roots/${rootEventId}/events`, {
				method: "POST",
				headers: headers(organizer.id, "replay-manager-child-0001", requestId),
				body: JSON.stringify({
					...childInput("evt_replaychild1", "published"),
					parentEventId: rootEventId,
					title,
				}),
			});
		const invitePayload = {
			id: "inv_replaymanager1",
			role: "participant" as const,
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			maxUses: 1,
		};
		const inviteRequest = (maxUses: number, requestId: string) =>
			app.request(`/v1/event-roots/${rootEventId}/invitations`, {
				method: "POST",
				headers: headers(organizer.id, "replay-manager-invite-0001", requestId),
				body: JSON.stringify({ ...invitePayload, maxUses }),
			});

		const childFirst = await childRequest(
			"Manager-only draft",
			"manager-child-first",
		);
		expect(childFirst.status).toBe(201);
		const childFirstBody = await childFirst.json();
		const inviteFirst = await inviteRequest(1, "manager-invite-first");
		expect(inviteFirst.status).toBe(201);
		const inviteFirstBody = await inviteFirst.json();
		expect(inviteFirstBody.token).toStartWith("cin_");
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			childInput("evt_replaydraft1", "draft"),
		);
		const orderedIds = ["evt_replaydraft1", "evt_replaychild1"];
		const reorderRequest = (ids: string[], requestId: string) =>
			app.request(
				`/v1/event-roots/${rootEventId}/events/${rootEventId}/children/reorder`,
				{
					method: "POST",
					headers: headers(
						organizer.id,
						"replay-manager-conflict-0001",
						requestId,
					),
					body: JSON.stringify({ baseOrderVersion: 1, orderedIds: ids }),
				},
			);
		const reorderConflict = await reorderRequest(
			orderedIds,
			"manager-conflict-first",
		);
		expect(reorderConflict.status).toBe(409);
		const reorderConflictText = await reorderConflict.text();
		expect(reorderConflictText).toContain("VERSION_CONFLICT");
		expect(reorderConflictText).toContain("evt_replaydraft1");

		await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			1,
			"participant",
			"active",
			"manager replay revoked",
		);
		const reorderConcealed = await reorderRequest(
			orderedIds,
			"manager-conflict-concealed",
		);
		expect(reorderConcealed.status).toBe(404);
		const reorderConcealedText = await reorderConcealed.text();
		expect(reorderConcealedText).not.toContain("VERSION_CONFLICT");
		expect(reorderConcealedText).not.toContain("evt_replaydraft1");
		expect(reorderConcealed.headers.get("idempotency-replayed")).toBeNull();
		const reorderChanged = await reorderRequest(
			[...orderedIds].reverse(),
			"manager-conflict-changed",
		);
		expect(reorderChanged.status).toBe(409);
		expect(await reorderChanged.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});
		const childConcealed = await childRequest(
			"Manager-only draft",
			"manager-child-concealed",
		);
		expect(childConcealed.status).toBe(404);
		const childConcealedBody = await childConcealed.json();
		expect(childConcealedBody).toMatchObject({ error: { code: "NOT_FOUND" } });
		expect(childConcealedBody).not.toEqual(childFirstBody);
		expect(JSON.stringify(childConcealedBody)).not.toContain(
			"Manager-only draft",
		);
		const childChanged = await childRequest(
			"Changed manager request",
			"manager-child-changed",
		);
		expect(childChanged.status).toBe(409);
		expect(await childChanged.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});

		const inviteConcealed = await inviteRequest(1, "manager-invite-concealed");
		expect(inviteConcealed.status).toBe(404);
		const inviteConcealedText = await inviteConcealed.text();
		expect(inviteConcealedText).not.toContain(inviteFirstBody.token);
		expect(inviteConcealedText).not.toContain(rootEventId);
		const inviteChanged = await inviteRequest(2, "manager-invite-changed");
		expect(inviteChanged.status).toBe(409);
		expect(await inviteChanged.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});

		const participantInvite = await service.createInvitation(
			owner,
			rootEventId,
			{
				id: "inv_replaymember01",
				role: "participant",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		const alternateInvite = await service.createInvitation(owner, rootEventId, {
			id: "inv_replaymember02",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		const redeem = (token: string, requestId: string) =>
			app.request("/v1/invitations/redeem", {
				method: "POST",
				headers: headers(
					participant.id,
					"replay-member-redeem-0001",
					requestId,
				),
				body: JSON.stringify({ token }),
			});
		const redeemed = await redeem(
			participantInvite.token,
			"member-redeem-first",
		);
		expect(redeemed.status).toBe(200);
		const redeemedBody = await redeemed.json();
		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			1,
			"participant",
			"removed",
			"membership replay revoked",
		);
		const redeemedConcealed = await redeem(
			participantInvite.token,
			"member-redeem-concealed",
		);
		expect(redeemedConcealed.status).toBe(404);
		const redeemedConcealedBody = await redeemedConcealed.json();
		expect(redeemedConcealedBody).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
		expect(redeemedConcealedBody).not.toEqual(redeemedBody);
		expect(JSON.stringify(redeemedConcealedBody)).not.toContain(rootEventId);
		const redeemedChanged = await redeem(
			alternateInvite.token,
			"member-redeem-changed",
		);
		expect(redeemedChanged.status).toBe(409);
		expect(await redeemedChanged.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});

		const emailBoundInvite = await service.createInvitation(
			owner,
			rootEventId,
			{
				id: "inv_replayemail01",
				role: "participant",
				normalizedEmailHint: "member@example.test",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		const redeemMismatch = (token: string, requestId: string) =>
			app.request("/v1/invitations/redeem", {
				method: "POST",
				headers: headers(
					secondParticipant.id,
					"replay-member-mismatch-0001",
					requestId,
				),
				body: JSON.stringify({ token }),
			});
		const mismatchFirst = await redeemMismatch(
			emailBoundInvite.token,
			"member-mismatch-first",
		);
		expect(mismatchFirst.status).toBe(403);
		expect(await mismatchFirst.json()).toMatchObject({
			error: { code: "INVITATION_EMAIL_MISMATCH" },
		});
		const mismatchConcealed = await redeemMismatch(
			emailBoundInvite.token,
			"member-mismatch-concealed",
		);
		expect(mismatchConcealed.status).toBe(404);
		expect(await mismatchConcealed.json()).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
		expect(mismatchConcealed.headers.get("idempotency-replayed")).toBeNull();
		const mismatchChanged = await redeemMismatch(
			alternateInvite.token,
			"member-mismatch-changed",
		);
		expect(mismatchChanged.status).toBe(409);
		expect(await mismatchChanged.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});
		const [proof] = await sql<
			{ childCount: number; participantStatus: string }[]
		>`
			SELECT
				(SELECT count(*)::int FROM events WHERE id = 'evt_replaychild1') AS "childCount",
				(SELECT status FROM event_memberships
				 WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}) AS "participantStatus"
		`;
		expect(proof).toEqual({ childCount: 1, participantStatus: "removed" });
	});

	test("pages only active root members with actor and root bound cursors", async () => {
		const rootEventId = "evt_directory1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES
				(${rootEventId}, ${organizer.id}, 'organizer', 'active'),
				(${rootEventId}, ${participant.id}, 'participant', 'active'),
				(${rootEventId}, ${secondParticipant.id}, 'participant', 'removed')
		`;

		const first = await service.listMemberDirectorySource(owner, rootEventId, {
			limit: 2,
		});
		expect(first.items.map(({ userId }) => userId)).toEqual([
			owner.id,
			organizer.id,
		]);
		expect(first.pageInfo.hasMore).toBe(true);
		const second = await service.listMemberDirectorySource(owner, rootEventId, {
			limit: 2,
			cursor: first.pageInfo.nextCursor as string,
		});
		expect(second.items.map(({ userId }) => userId)).toEqual([participant.id]);
		expect(second.pageInfo).toEqual({ hasMore: false, nextCursor: null });

		for (const actor of [organizer, participant]) {
			expect(
				(
					await service.listMemberDirectorySource(actor, rootEventId, {
						limit: 200,
					})
				).items.map(({ userId }) => userId),
			).toEqual([owner.id, organizer.id, participant.id]);
		}
		for (const actor of [secondParticipant, { id: userId(5) }]) {
			await expect(
				service.listMemberDirectorySource(actor, rootEventId),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		}

		await expect(
			service.listMemberDirectorySource(participant, rootEventId, {
				cursor: first.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });
		await service.createRoot(owner, rootInput("evt_directory2", "published"));
		await expect(
			service.listMemberDirectorySource(owner, "evt_directory2", {
				cursor: first.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });

		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const response = await app.request(
			`/v1/event-roots/${rootEventId}/member-directory-source?limit=2`,
			{ headers: { Authorization: `Bearer ${owner.id}` } },
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.json()).toMatchObject({
			schemaVersion: 1,
			rootEventId,
			userIds: [owner.id, organizer.id],
			pageInfo: { hasMore: true },
		});
	});

	test("returns an immediate in-progress conflict and rolls claim back with domain failure", async () => {
		const repository = new PostgresEventRepository(sql, notificationPayloads());
		let release!: () => void;
		let entered!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const input = {
			actor: owner,
			operationId: "eventsCreate",
			idempotencyKey: "concurrent-key-0001",
			requestHash: "a".repeat(64),
		};
		const first = repository.runIdempotent(input, async () => {
			entered();
			await waiting;
			return {
				status: 201,
				body: { ok: true },
				headers: { Location: "/same" },
			};
		});
		await started;
		const beganAt = performance.now();
		try {
			await repository.runIdempotent(input, async () => ({
				status: 201,
				body: { ok: false },
				headers: {},
			}));
			throw new Error("Expected idempotency conflict");
		} catch (error) {
			expect(error).toBeInstanceOf(DomainError);
			expect((error as DomainError).code).toBe("IDEMPOTENCY_IN_PROGRESS");
			expect((error as DomainError).headers["Retry-After"]).toBe("1");
		}
		expect(performance.now() - beganAt).toBeLessThan(500);
		release();
		expect(await first).toMatchObject({
			replayed: false,
			headers: { Location: "/same" },
		});
		expect(
			await repository.runIdempotent(input, async () => ({
				status: 201,
				body: { ok: false },
				headers: {},
			})),
		).toEqual({
			status: 201,
			body: { ok: true },
			headers: { Location: "/same" },
			replayed: true,
		});

		await expect(
			repository.runIdempotent(
				{
					...input,
					idempotencyKey: "rollback-key-0001",
					requestHash: "b".repeat(64),
				},
				async (scoped) => {
					await scoped.createRoot(owner, rootInput("evt_rollback1"));
					throw new Error("forced rollback");
				},
			),
		).rejects.toThrow("forced rollback");
		const [rolledBack] = await sql<{ roots: number; records: number }[]>`
      SELECT
			(SELECT count(*)::int FROM event_roots WHERE root_event_id = 'evt_rollback1') AS roots,
			(SELECT count(*)::int FROM event_idempotency_records WHERE idempotency_key = 'rollback-key-0001') AS records
    `;
		expect(rolledBack).toEqual({ roots: 0, records: 0 });
	});

	test("serializes recursive moves, prevents cycles and enforces the role matrix", async () => {
		await service.createRoot(owner, rootInput("evt_graph001", "published"));
		await service.createEvent(
			owner,
			"evt_graph001",
			"evt_graph001",
			childInput("evt_child001", "published"),
		);
		await service.createEvent(
			owner,
			"evt_graph001",
			"evt_graph001",
			childInput("evt_child002", "published"),
		);

		const results = await Promise.allSettled([
			service.reparentEvent(
				owner,
				"evt_graph001",
				"evt_child001",
				"evt_child002",
				1,
			),
			service.reparentEvent(
				owner,
				"evt_graph001",
				"evt_child002",
				"evt_child001",
				1,
			),
		]);
		expect(
			results.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(["HIERARCHY_CYCLE", "VERSION_CONFLICT"]).toContain(
			(rejected as PromiseRejectedResult).reason.code,
		);

		const invite = await service.createInvitation(owner, "evt_graph001", {
			id: "inv_member001",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 2,
		});
		await service.redeemInvitation(participant, invite.token, new Date());
		await service.createEvent(
			owner,
			"evt_graph001",
			"evt_graph001",
			childInput("evt_draft001", "draft"),
		);
		await service.createEvent(
			owner,
			"evt_graph001",
			"evt_draft001",
			childInput("evt_hidden001", "published"),
		);
		await expect(
			service.createEvent(
				participant,
				"evt_graph001",
				"evt_graph001",
				childInput("evt_forbidden"),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		const visibleIds = (
			await service.getRoot(participant, "evt_graph001")
		).events.map((event) => event.id);
		expect(visibleIds).not.toContain("evt_draft001");
		expect(visibleIds).not.toContain("evt_hidden001");

		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const forbiddenRequest = (requestId: string) =>
			app.request("/v1/event-roots/evt_graph001/events", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${participant.id}`,
					"Content-Type": "application/json",
					"Idempotency-Key": "participant-forbidden-0001",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					id: "evt_denied001",
					parentEventId: "evt_graph001",
					kind: "session",
					title: "Denied",
					description: null,
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					status: "draft",
				}),
			});
		const denied = await forbiddenRequest("request-error-first");
		expect(denied.status).toBe(403);
		const deniedBody = await denied.json();
		const deniedReplay = await forbiddenRequest("request-error-replay");
		const deniedReplayBody = await deniedReplay.json();
		expect(deniedBody.error.requestId).toBe("request-error-first");
		expect(deniedReplayBody).toMatchObject({
			error: { code: "NOT_FOUND", requestId: "request-error-replay" },
		});
		expect(deniedReplayBody).not.toEqual(deniedBody);
		expect(deniedReplay.headers.get("idempotency-replayed")).toBeNull();
		expect(deniedReplay.headers.get("x-request-id")).toBe(
			"request-error-replay",
		);
		const [storedDenial] = await sql<
			{ responseStatus: number; body: Record<string, unknown> }[]
		>`
			SELECT response_status AS "responseStatus", response_body AS body
			FROM event_idempotency_records
			WHERE operation_id = 'eventChildrenCreate' AND idempotency_key = 'participant-forbidden-0001'
		`;
		expect(storedDenial?.responseStatus).toBe(403);
		expect(JSON.stringify(storedDenial?.body)).not.toContain("requestId");

		await service.createRoot(owner, rootInput("evt_other001", "published"));
		await expect(
			service.reparentEvent(
				owner,
				"evt_graph001",
				"evt_child001",
				"evt_other001",
				2,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		await expect(
			sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`UPDATE event_memberships SET status = 'removed' WHERE root_event_id = 'evt_graph001' AND user_id = ${owner.id}`;
			}),
		).rejects.toThrow("exactly one active owner");
	});

	test("orders invite locks, upgrades roles and seals archived roots without leaking existence", async () => {
		await expect(
			service.createRoot(owner, rootInput("evt_badroot1", "archived")),
		).rejects.toMatchObject({ code: "INVALID_ROOT_STATUS" });
		await service.createRoot(owner, rootInput("evt_lifecycle", "published"));
		const ownerMembership = (
			await service.listMemberships(owner, "evt_lifecycle")
		).items[0];
		if (!ownerMembership) throw new Error("Owner fixture missing");
		expect(
			await service.transferOwnership(
				owner,
				"evt_lifecycle",
				owner.id,
				ownerMembership.version,
				ownerMembership.version,
			),
		).toHaveLength(1);

		const contested = await service.createInvitation(owner, "evt_lifecycle", {
			id: "inv_contested",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 2,
		});
		const race = Promise.allSettled([
			service.redeemInvitation(participant, contested.token, new Date()),
			service.revokeInvitation(
				owner,
				"evt_lifecycle",
				contested.invitation.id,
				1,
			),
		]);
		const raceResult = await Promise.race([
			race,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("invite lock-order timeout")), 1_000),
			),
		]);
		expect(raceResult).toHaveLength(2);
		expect(raceResult.some((result) => result.status === "fulfilled")).toBe(
			true,
		);

		const participantInvite = await service.createInvitation(
			owner,
			"evt_lifecycle",
			{
				id: "inv_upgrade_p",
				role: "participant",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		expect(
			(
				await service.redeemInvitation(
					organizer,
					participantInvite.token,
					new Date(),
				)
			).role,
		).toBe("participant");
		const organizerInvite = await service.createInvitation(
			owner,
			"evt_lifecycle",
			{
				id: "inv_upgrade_o",
				role: "organizer",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		expect(
			(
				await service.redeemInvitation(
					organizer,
					organizerInvite.token,
					new Date(),
				)
			).role,
		).toBe("organizer");
		const [inviteChange] = await sql<{ maxVersion: number }[]>`
			SELECT max(entity_version)::int AS "maxVersion" FROM event_root_changes
			WHERE root_event_id = 'evt_lifecycle' AND entity_type = 'invitation'
				AND entity_id = 'inv_upgrade_o'
		`;
		expect(inviteChange?.maxVersion).toBe(2);

		const archiveInvite = await service.createInvitation(
			owner,
			"evt_lifecycle",
			{
				id: "inv_archived1",
				role: "participant",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 2,
			},
		);
		await service.redeemInvitation(
			secondParticipant,
			archiveInvite.token,
			new Date(),
		);
		const rootVersion = (
			await service.getEvent(owner, "evt_lifecycle", "evt_lifecycle")
		).version;
		await service.archiveEvent(
			owner,
			"evt_lifecycle",
			"evt_lifecycle",
			rootVersion,
		);
		expect(
			await service.previewInvitation(archiveInvite.token, new Date()),
		).toBeNull();
		await expect(
			service.redeemInvitation(
				{ id: userId(5) },
				archiveInvite.token,
				new Date(),
			),
		).rejects.toMatchObject({ code: "INVITATION_UNAVAILABLE" });
		await expect(
			service.createPlace(owner, "evt_lifecycle", {
				id: "plc_afterarchive",
				name: "Blocked",
				locality: null,
				countryCode: "CH",
				latitude: null,
				longitude: null,
			}),
		).rejects.toMatchObject({ code: "ROOT_ARCHIVED" });
		await expect(
			service.getRoot(secondParticipant, "evt_lifecycle"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service.createPlace({ id: userId(6) }, "evt_lifecycle", {
				id: "plc_concealed1",
				name: "Concealed",
				locality: null,
				countryCode: "CH",
				latitude: null,
				longitude: null,
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	test("binds invitations to verified normalized email and keeps membership roots immutable", async () => {
		await expect(
			service.createRoot(owner, {
				...rootInput("evt_badtime01"),
				startsAt: new Date("2026-10-12T10:00:00Z"),
				endsAt: new Date("2026-10-12T09:00:00Z"),
			}),
		).rejects.toMatchObject({ status: 400, code: "INVALID_TIME_RANGE" });

		await service.createRoot(owner, rootInput("evt_email001", "published"));
		await service.createRoot(owner, rootInput("evt_email002", "published"));
		const bound = await service.createInvitation(owner, "evt_email001", {
			id: "inv_email001",
			role: "participant",
			normalizedEmailHint: " Target@Example.COM ",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		await expect(
			service.createInvitation(owner, "evt_email001", {
				id: "inv_email_long",
				role: "participant",
				normalizedEmailHint: `${"a".repeat(250)}@x.com`,
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "INVITATION_EMAIL_INVALID",
		});
		expect(bound.invitation.normalizedEmailHint).toBe("target@example.com");
		expect(
			await service.previewInvitation(bound.token, new Date()),
		).toMatchObject({
			emailBound: true,
			usable: true,
		});

		await expect(
			service.redeemInvitation({ id: userId(7) }, bound.token, new Date()),
		).rejects.toMatchObject({
			status: 403,
			code: "INVITATION_EMAIL_MISMATCH",
		});
		await expect(
			service.redeemInvitation(
				{ id: userId(8), email: "wrong@example.com" },
				bound.token,
				new Date(),
			),
		).rejects.toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
		const [beforeMatch] = await sql<{ uses: number; redemptions: number }[]>`
			SELECT invitation.use_count AS uses,
				(SELECT count(*)::int FROM event_invitation_redemptions
				 WHERE invitation_id = invitation.id) AS redemptions
			FROM event_invitations invitation WHERE id = 'inv_email001'
		`;
		expect(beforeMatch).toEqual({ uses: 0, redemptions: 0 });

		const member = await service.redeemInvitation(
			{ id: userId(9), email: "target@example.com" },
			bound.token,
			new Date(),
		);
		expect(member.role).toBe("participant");
		expect(
			(
				await service.redeemInvitation(
					{ id: userId(9) },
					bound.token,
					new Date(),
				)
			).userId,
		).toBe(userId(9));
		expect(
			(
				await service.redeemInvitation(
					{ id: userId(9), email: "changed@example.com" },
					bound.token,
					new Date(),
				)
			).userId,
		).toBe(userId(9));
		const [afterMatch] = await sql<{ uses: number; redemptions: number }[]>`
			SELECT invitation.use_count AS uses,
				(SELECT count(*)::int FROM event_invitation_redemptions
				 WHERE invitation_id = invitation.id) AS redemptions
			FROM event_invitations invitation WHERE id = 'inv_email001'
		`;
		expect(afterMatch).toEqual({ uses: 1, redemptions: 1 });
		const membershipFirst = await service.listMemberships(
			owner,
			"evt_email001",
			{ limit: 1 },
		);
		expect(membershipFirst.pageInfo.hasMore).toBe(true);
		const membershipSecond = await service.listMemberships(
			owner,
			"evt_email001",
			{
				limit: 1,
				cursor: membershipFirst.pageInfo.nextCursor as string,
			},
		);
		expect(membershipSecond.items).toHaveLength(1);
		expect(membershipSecond.pageInfo.nextCursor).toBeNull();
		await expect(
			service.listMemberships(owner, "evt_email002", {
				limit: 1,
				cursor: membershipFirst.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });

		try {
			await sql`UPDATE event_memberships SET root_event_id = 'evt_email002'
				WHERE root_event_id = 'evt_email001' AND user_id = ${userId(9)}`;
			throw new Error("Expected immutable membership root failure");
		} catch (error) {
			expect(String(error)).toContain("membership root_event_id is immutable");
		}
	});

	test("materializes typed itinerary references and conceals draft-only places", async () => {
		await service.createRoot(owner, rootInput("evt_refs0001", "published"));
		await service.createEvent(
			owner,
			"evt_refs0001",
			"evt_refs0001",
			childInput("evt_public01", "published"),
		);
		await service.createEvent(
			owner,
			"evt_refs0001",
			"evt_public01",
			childInput("evt_session01", "published"),
		);
		await service.createEvent(
			owner,
			"evt_refs0001",
			"evt_refs0001",
			childInput("evt_private01", "draft"),
		);
		const invite = await service.createInvitation(owner, "evt_refs0001", {
			id: "inv_refs0001",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		await service.redeemInvitation(participant, invite.token, new Date());

		for (const place of [
			{
				id: "plc_origin001",
				name: "Alpha Airport",
				locality: "Alpha",
				countryCode: "CH",
				latitude: 47.45,
				longitude: 8.56,
			},
			{
				id: "plc_dest0001",
				name: "Beta Airport",
				locality: "Beta",
				countryCode: "TR",
				latitude: 36.89,
				longitude: 30.8,
			},
			{
				id: "plc_secret001",
				name: "Secret Draft Venue",
				locality: null,
				countryCode: "CH",
				latitude: null,
				longitude: null,
			},
			{
				id: "plc_archived1",
				name: "Archived Venue",
				locality: null,
				countryCode: "CH",
				latitude: null,
				longitude: null,
			},
		]) {
			await service.createPlace(owner, "evt_refs0001", place);
		}

		const flight = await service.createItineraryItem(owner, "evt_refs0001", {
			id: "iti_flight001",
			eventId: "evt_public01",
			title: "Outbound flight",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "flight",
				originPlaceId: "plc_origin001",
				destinationPlaceId: "plc_dest0001",
				flightDesignator: "LX8174",
			},
			placeId: null,
		});
		expect(flight.details.type).toBe("flight");
		if (flight.details.type !== "flight")
			throw new Error("Flight fixture lost");
		expect(flight.details.originPlaceSnapshot.name).toBe("Alpha Airport");
		expect(flight.details.destinationPlaceSnapshot.name).toBe("Beta Airport");

		await service.createItineraryItem(owner, "evt_refs0001", {
			id: "iti_private01",
			eventId: "evt_private01",
			title: "Draft meeting",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: { schemaVersion: 1, type: "note" },
			placeId: "plc_secret001",
		});
		await service.createItineraryItem(owner, "evt_refs0001", {
			id: "iti_session01",
			eventId: "evt_public01",
			title: "Opening session",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "session",
				descendantEventId: "evt_session01",
			},
			placeId: null,
		});
		await service.createItineraryItem(owner, "evt_refs0001", {
			id: "iti_archived1",
			eventId: "evt_public01",
			title: "Archived internal stop",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "archived",
			details: { schemaVersion: 1, type: "note" },
			placeId: "plc_archived1",
		});

		await service.createRoot(owner, rootInput("evt_refs0002", "published"));
		await service.createEvent(
			owner,
			"evt_refs0002",
			"evt_refs0002",
			childInput("evt_foreign01", "published"),
		);
		await service.createPlace(owner, "evt_refs0002", {
			id: "plc_foreign01",
			name: "Foreign place",
			locality: null,
			countryCode: "DE",
			latitude: null,
			longitude: null,
		});
		await expect(
			service.createItineraryItem(owner, "evt_refs0001", {
				id: "iti_badplace1",
				eventId: "evt_public01",
				title: "Invalid trip",
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				allDay: false,
				status: "active",
				details: {
					schemaVersion: 1,
					type: "rail",
					originPlaceId: "plc_foreign01",
					destinationPlaceId: "plc_dest0001",
				},
				placeId: null,
			}),
		).rejects.toMatchObject({ status: 400, code: "PLACE_INVALID" });
		await expect(
			service.createItineraryItem(owner, "evt_refs0001", {
				id: "iti_badevent1",
				eventId: "evt_public01",
				title: "Invalid session",
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				allDay: false,
				status: "active",
				details: {
					schemaVersion: 1,
					type: "session",
					descendantEventId: "evt_foreign01",
				},
				placeId: null,
			}),
		).rejects.toMatchObject({
			status: 400,
			code: "DETAILS_REFERENCE_INVALID",
		});

		const firstPlaces = await service.listPlaces(participant, "evt_refs0001", {
			limit: 1,
		});
		expect(firstPlaces.pageInfo).toMatchObject({ hasMore: true });
		expect(firstPlaces.pageInfo.nextCursor).toBeString();
		await expect(
			service.listPlaces(owner, "evt_refs0001", {
				limit: 1,
				cursor: firstPlaces.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });
		await expect(
			service.listPlaces(participant, "evt_refs0002", {
				limit: 1,
				cursor: firstPlaces.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });
		const secondPlaces = await service.listPlaces(participant, "evt_refs0001", {
			limit: 1,
			cursor: firstPlaces.pageInfo.nextCursor as string,
		});
		expect([
			...firstPlaces.items.map((place) => place.id),
			...secondPlaces.items.map((place) => place.id),
		]).toEqual(["plc_origin001", "plc_dest0001"]);
		expect(secondPlaces.pageInfo).toEqual({
			hasMore: false,
			nextCursor: null,
		});

		await expect(
			service.updatePlace(owner, "evt_refs0001", "plc_origin001", 1, {
				latitude: null,
			}),
		).rejects.toMatchObject({ code: "INVALID_COORDINATES" });
		await service.updatePlace(owner, "evt_refs0001", "plc_origin001", 1, {
			name: "Renamed Airport",
		});
		await service.updateItineraryItem(
			owner,
			"evt_refs0001",
			"iti_flight001",
			1,
			{ title: "Updated outbound flight" },
		);
		await service.updateItineraryItem(
			owner,
			"evt_refs0001",
			"iti_flight001",
			2,
			{
				details: {
					schemaVersion: 1,
					type: "flight",
					originPlaceId: "plc_origin001",
					destinationPlaceId: "plc_dest0001",
					flightDesignator: "LX8175",
				},
			},
		);
		const itineraryPage = await service.listItinerary(
			participant,
			"evt_refs0001",
			"evt_public01",
			{ limit: 1 },
		);
		expect(itineraryPage.pageInfo.hasMore).toBe(true);
		const itinerarySecondPage = await service.listItinerary(
			participant,
			"evt_refs0001",
			"evt_public01",
			{
				limit: 1,
				cursor: itineraryPage.pageInfo.nextCursor as string,
			},
		);
		expect(itinerarySecondPage.items[0]?.id).not.toBe(
			itineraryPage.items[0]?.id,
		);
		const storedFlight = itineraryPage.items.find(
			(item) => item.id === "iti_flight001",
		);
		if (storedFlight?.details.type !== "flight")
			throw new Error("Flight page fixture missing");
		expect(storedFlight.details.originPlaceSnapshot.name).toBe("Alpha Airport");
		const participantItems = await service.listItinerary(
			participant,
			"evt_refs0001",
			"evt_public01",
			{ limit: 200 },
		);
		expect(participantItems.items.map((item) => item.id)).not.toContain(
			"iti_archived1",
		);
		const managerItems = await service.listItinerary(
			owner,
			"evt_refs0001",
			"evt_public01",
			{ limit: 200 },
		);
		expect(managerItems.items.map((item) => item.id)).toContain(
			"iti_archived1",
		);
	});

	test("keeps live session references descendant and participant-safe across lifecycle writes", async () => {
		await service.createRoot(owner, rootInput("evt_refsafe01", "published"));
		const invite = await service.createInvitation(owner, "evt_refsafe01", {
			id: "inv_refsafe01",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		await service.redeemInvitation(participant, invite.token, new Date());
		await service.createEvent(
			owner,
			"evt_refsafe01",
			"evt_refsafe01",
			childInput("evt_ref_public", "published"),
		);
		await service.createEvent(
			owner,
			"evt_refsafe01",
			"evt_ref_public",
			childInput("evt_ref_draft", "draft"),
		);

		await expect(
			service.createItineraryItem(
				owner,
				"evt_refsafe01",
				itineraryInput("iti_ref_bad01", "evt_ref_public", {
					schemaVersion: 1,
					type: "session",
					descendantEventId: "evt_ref_draft",
				}),
			),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });

		const note = await service.createItineraryItem(
			owner,
			"evt_refsafe01",
			itineraryInput("iti_ref_note01", "evt_ref_public"),
		);
		await expect(
			service.updateItineraryItem(
				owner,
				"evt_refsafe01",
				note.id,
				note.version,
				{
					details: {
						schemaVersion: 1,
						type: "session",
						descendantEventId: "evt_ref_draft",
					},
				},
			),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		expect(
			(
				await service.listItinerary(
					participant,
					"evt_refsafe01",
					"evt_ref_public",
					{ limit: 200 },
				)
			).items.map((item) => item.id),
		).toEqual(["iti_ref_note01"]);

		await service.createEvent(
			owner,
			"evt_refsafe01",
			"evt_ref_public",
			childInput("evt_ref_target", "published"),
		);
		await service.createEvent(
			owner,
			"evt_refsafe01",
			"evt_ref_public",
			childInput("evt_ref_branch", "draft"),
		);
		await service.createEvent(
			owner,
			"evt_refsafe01",
			"evt_refsafe01",
			childInput("evt_ref_outside", "published"),
		);
		await service.createItineraryItem(
			owner,
			"evt_refsafe01",
			itineraryInput("iti_ref_live01", "evt_ref_public", {
				schemaVersion: 1,
				type: "session",
				descendantEventId: "evt_ref_target",
			}),
		);

		for (const status of ["draft", "cancelled", "archived"] as const) {
			await expect(
				service.updateEvent(owner, "evt_refsafe01", "evt_ref_target", 1, {
					status,
				}),
			).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		}
		await expect(
			service.archiveEvent(owner, "evt_refsafe01", "evt_ref_target", 1),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		await expect(
			service.reparentEvent(
				owner,
				"evt_refsafe01",
				"evt_ref_target",
				"evt_ref_branch",
				1,
			),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		await expect(
			service.reparentEvent(
				owner,
				"evt_refsafe01",
				"evt_ref_target",
				"evt_ref_outside",
				1,
			),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		await expect(
			service.tombstoneEvent(owner, "evt_refsafe01", "evt_ref_target", 1, true),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });

		expect(
			(await service.getEvent(participant, "evt_refsafe01", "evt_ref_target"))
				.status,
		).toBe("published");
		expect(
			JSON.stringify(
				await service.listItinerary(
					participant,
					"evt_refsafe01",
					"evt_ref_public",
					{ limit: 200 },
				),
			).includes("evt_ref_target"),
		).toBe(true);

		const publicEvent = await service.getEvent(
			owner,
			"evt_refsafe01",
			"evt_ref_public",
		);
		await service.tombstoneEvent(
			owner,
			"evt_refsafe01",
			"evt_ref_public",
			publicEvent.version,
			true,
		);
		expect(
			(await service.getRoot(participant, "evt_refsafe01")).events.map(
				(event) => event.id,
			),
		).not.toContain("evt_ref_target");

		await sql`
			INSERT INTO event_itinerary_items (
				id, root_event_id, event_id, title, time_zone, all_day, status, details
			) VALUES (
				'iti_ref_corrupt', 'evt_refsafe01', 'evt_ref_outside',
				'Corrupt session', 'Europe/Zurich', false, 'active',
				'{"schemaVersion":1,"type":"session","descendantEventId":"evt_ref_target"}'::jsonb
			)
		`;
		expect(
			JSON.stringify(
				await service.listItinerary(
					participant,
					"evt_refsafe01",
					"evt_ref_outside",
					{ limit: 200 },
				),
			).includes("evt_ref_target"),
		).toBe(false);
		expect(
			(
				await service.listItinerary(owner, "evt_refsafe01", "evt_ref_outside", {
					limit: 200,
				})
			).items.map((item) => item.id),
		).toContain("iti_ref_corrupt");

		await service.createRoot(owner, rootInput("evt_publish01", "published"));
		const publishInvite = await service.createInvitation(
			owner,
			"evt_publish01",
			{
				id: "inv_publish01",
				role: "participant",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		await service.redeemInvitation(
			participant,
			publishInvite.token,
			new Date(),
		);
		await service.createEvent(
			owner,
			"evt_publish01",
			"evt_publish01",
			childInput("evt_publish_p", "draft"),
		);
		await service.createEvent(
			owner,
			"evt_publish01",
			"evt_publish_p",
			childInput("evt_publish_t", "draft"),
		);
		await service.createItineraryItem(
			owner,
			"evt_publish01",
			itineraryInput("iti_publish01", "evt_publish_p", {
				schemaVersion: 1,
				type: "session",
				descendantEventId: "evt_publish_t",
			}),
		);
		const draftParent = await service.getEvent(
			owner,
			"evt_publish01",
			"evt_publish_p",
		);
		await expect(
			service.updateEvent(
				owner,
				"evt_publish01",
				"evt_publish_p",
				draftParent.version,
				{ status: "published" },
			),
		).rejects.toMatchObject({ status: 409, code: "DEPENDENCY_EXISTS" });
		await service.updateEvent(owner, "evt_publish01", "evt_publish_t", 1, {
			status: "published",
		});
		await service.updateEvent(
			owner,
			"evt_publish01",
			"evt_publish_p",
			draftParent.version,
			{ status: "published" },
		);
		expect(
			(
				await service.listItinerary(
					participant,
					"evt_publish01",
					"evt_publish_p",
					{ limit: 200 },
				)
			).items.map((item) => item.id),
		).toEqual(["iti_publish01"]);
		expect(
			(await service.getEvent(participant, "evt_publish01", "evt_publish_t"))
				.status,
		).toBe("published");
	});

	test("serializes concurrent event and itinerary reorders with authoritative conflicts", async () => {
		await service.createRoot(owner, rootInput("evt_order0001", "published"));
		const eventIds = ["evt_order_a1", "evt_order_b1", "evt_order_c1"];
		for (const eventId of eventIds) {
			await service.createEvent(
				owner,
				"evt_order0001",
				"evt_order0001",
				childInput(eventId, "published"),
			);
		}
		const rootBefore = await service.getEvent(
			owner,
			"evt_order0001",
			"evt_order0001",
		);
		const eventRace = await Promise.allSettled([
			service.reorderEvents(
				owner,
				"evt_order0001",
				"evt_order0001",
				rootBefore.childOrderVersion,
				[eventIds[1] as string, eventIds[0] as string, eventIds[2] as string],
			),
			service.reorderEvents(
				owner,
				"evt_order0001",
				"evt_order0001",
				rootBefore.childOrderVersion,
				[eventIds[2] as string, eventIds[1] as string, eventIds[0] as string],
			),
		]);
		expect(
			eventRace.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const eventConflict = eventRace.find(
			(result) => result.status === "rejected",
		) as PromiseRejectedResult;
		expect(eventConflict.reason.code).toBe("VERSION_CONFLICT");
		const eventOrder = (await service.getRoot(owner, "evt_order0001")).events
			.filter((event) => event.parentEventId === "evt_order0001")
			.map((event) => event.id);
		expect(
			eventConflict.reason.details.find(
				(detail: { code: string }) => detail.code === "AUTHORITATIVE_ORDER",
			).meta.orderedIds,
		).toBe(eventOrder.join(","));
		const rootAfter = await service.getEvent(
			owner,
			"evt_order0001",
			"evt_order0001",
		);
		await expect(
			service.reorderEvents(
				owner,
				"evt_order0001",
				"evt_order0001",
				rootAfter.childOrderVersion,
				[
					eventOrder[0] as string,
					eventOrder[0] as string,
					eventOrder[2] as string,
				],
			),
		).rejects.toMatchObject({ code: "INVALID_ORDER" });

		const itemIds = ["iti_order_a1", "iti_order_b1", "iti_order_c1"];
		for (const itemId of itemIds) {
			await service.createItineraryItem(owner, "evt_order0001", {
				id: itemId,
				eventId: "evt_order_a1",
				title: itemId,
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				allDay: false,
				status: "active",
				details: { schemaVersion: 1, type: "note" },
				placeId: null,
			});
		}
		const eventBefore = await service.getEvent(
			owner,
			"evt_order0001",
			"evt_order_a1",
		);
		const itineraryRace = await Promise.allSettled([
			service.reorderItinerary(
				owner,
				"evt_order0001",
				"evt_order_a1",
				eventBefore.itineraryOrderVersion,
				[itemIds[1] as string, itemIds[0] as string, itemIds[2] as string],
			),
			service.reorderItinerary(
				owner,
				"evt_order0001",
				"evt_order_a1",
				eventBefore.itineraryOrderVersion,
				[itemIds[2] as string, itemIds[1] as string, itemIds[0] as string],
			),
		]);
		expect(
			itineraryRace.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		const itineraryConflict = itineraryRace.find(
			(result) => result.status === "rejected",
		) as PromiseRejectedResult;
		expect(itineraryConflict.reason.code).toBe("VERSION_CONFLICT");
		const itineraryOrder = (
			await service.listItinerary(owner, "evt_order0001", "evt_order_a1", {
				limit: 200,
			})
		).items.map((item) => item.id);
		expect(
			itineraryConflict.reason.details.find(
				(detail: { code: string }) => detail.code === "AUTHORITATIVE_ORDER",
			).meta.orderedIds,
		).toBe(itineraryOrder.join(","));
		const eventAfter = await service.getEvent(
			owner,
			"evt_order0001",
			"evt_order_a1",
		);
		await expect(
			service.reorderItinerary(
				owner,
				"evt_order0001",
				"evt_order_a1",
				eventAfter.itineraryOrderVersion,
				[
					itineraryOrder[0] as string,
					itineraryOrder[0] as string,
					itineraryOrder[2] as string,
				],
			),
		).rejects.toMatchObject({ code: "INVALID_ORDER" });
	});

	test("caps roots and per-event itinerary at 500 under concurrent creates", async () => {
		await service.createRoot(owner, rootInput("evt_caproot01", "published"));
		await sql`
			INSERT INTO events (
				id, root_event_id, parent_event_id, kind, title,
				time_zone, sort_position, status
			)
			SELECT 'evt_cap_e_' || lpad(value::text, 4, '0'),
				'evt_caproot01', 'evt_caproot01', 'session',
				'Capacity event ' || value, 'UTC', value * 1024, 'published'
			FROM generate_series(1, 498) AS generated(value)
		`;
		const eventCapacityRace = await Promise.allSettled([
			service.createEvent(
				owner,
				"evt_caproot01",
				"evt_caproot01",
				childInput("evt_cap_race1", "published"),
			),
			service.createEvent(
				owner,
				"evt_caproot01",
				"evt_caproot01",
				childInput("evt_cap_race2", "published"),
			),
		]);
		expect(
			eventCapacityRace.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			(
				eventCapacityRace.find(
					(result) => result.status === "rejected",
				) as PromiseRejectedResult
			).reason,
		).toMatchObject({ status: 409, code: "COLLECTION_LIMIT_REACHED" });
		const [eventCount] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM events
			WHERE root_event_id = 'evt_caproot01' AND deleted_at IS NULL
		`;
		expect(eventCount?.count).toBe(500);
		await expect(
			service.createEvent(
				owner,
				"evt_caproot01",
				"evt_caproot01",
				childInput("evt_cap_after", "published"),
			),
		).rejects.toMatchObject({
			status: 409,
			code: "COLLECTION_LIMIT_REACHED",
		});

		await service.createRoot(owner, rootInput("evt_capitems1", "published"));
		await service.createEvent(
			owner,
			"evt_capitems1",
			"evt_capitems1",
			childInput("evt_cap_day01", "published"),
		);
		await sql`
			INSERT INTO event_itinerary_items (
				id, root_event_id, event_id, title, time_zone,
				all_day, sort_position, status, details
			)
			SELECT 'iti_cap_' || lpad(value::text, 4, '0'),
				'evt_capitems1', 'evt_cap_day01', 'Capacity item ' || value,
				'UTC', false, value * 1024, 'active',
				'{"schemaVersion":1,"type":"note"}'::jsonb
			FROM generate_series(1, 499) AS generated(value)
		`;
		const itineraryCapacityRace = await Promise.allSettled([
			service.createItineraryItem(
				owner,
				"evt_capitems1",
				itineraryInput("iti_cap_race1", "evt_cap_day01"),
			),
			service.createItineraryItem(
				owner,
				"evt_capitems1",
				itineraryInput("iti_cap_race2", "evt_cap_day01"),
			),
		]);
		expect(
			itineraryCapacityRace.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			(
				itineraryCapacityRace.find(
					(result) => result.status === "rejected",
				) as PromiseRejectedResult
			).reason,
		).toMatchObject({ status: 409, code: "COLLECTION_LIMIT_REACHED" });
		const [itineraryCount] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_itinerary_items
			WHERE root_event_id = 'evt_capitems1' AND event_id = 'evt_cap_day01'
				AND deleted_at IS NULL
		`;
		expect(itineraryCount?.count).toBe(500);
		await expect(
			service.createItineraryItem(
				owner,
				"evt_capitems1",
				itineraryInput("iti_cap_after", "evt_cap_day01"),
			),
		).rejects.toMatchObject({
			status: 409,
			code: "COLLECTION_LIMIT_REACHED",
		});
	});

	test("atomically exhausts invites, preserves place snapshots and emits subtree tombstones", async () => {
		await service.createRoot(owner, rootInput("evt_trip0001", "published"));
		const invite = await service.createInvitation(owner, "evt_trip0001", {
			id: "inv_single001",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		const preview = await service.previewInvitation(invite.token, new Date());
		expect(preview).toMatchObject({
			title: "Root",
			usable: true,
			role: "participant",
		});
		const redemption = await Promise.allSettled([
			service.redeemInvitation(participant, invite.token, new Date()),
			service.redeemInvitation(secondParticipant, invite.token, new Date()),
		]);
		expect(
			redemption.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			(
				redemption.find(
					(result) => result.status === "rejected",
				) as PromiseRejectedResult
			).reason.code,
		).toBe("INVITATION_UNAVAILABLE");
		const winner = redemption.find(
			(result) => result.status === "fulfilled",
		) as PromiseFulfilledResult<MembershipRecordLike>;
		expect(
			(
				await service.redeemInvitation(
					{ id: winner.value.userId },
					invite.token,
					new Date(),
				)
			).userId,
		).toBe(winner.value.userId);

		await service.createEvent(
			owner,
			"evt_trip0001",
			"evt_trip0001",
			childInput("evt_day00001", "published"),
		);
		await service.createPlace(owner, "evt_trip0001", {
			id: "plc_course001",
			name: "Old Course Name",
			locality: "Belek",
			countryCode: "TR",
			latitude: 36.86,
			longitude: 31.05,
		});
		const item = await service.createItineraryItem(owner, "evt_trip0001", {
			id: "iti_tee00001",
			eventId: "evt_day00001",
			title: "Tee time",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "golf_round",
				roundReference: "round-1",
				teeTime: "2026-10-12T06:10:00Z",
			},
			placeId: "plc_course001",
		});
		expect(item.placeSnapshot?.name).toBe("Old Course Name");
		const [orderChange] = await sql<{ found: boolean }[]>`
			SELECT EXISTS(
				SELECT 1 FROM event_root_changes
				WHERE root_event_id = 'evt_trip0001' AND entity_type = 'event'
					AND entity_id = 'evt_day00001'
					AND (data->>'itineraryOrderVersion')::int = 2
			) AS found
		`;
		expect(orderChange?.found).toBe(true);
		await service.updatePlace(owner, "evt_trip0001", "plc_course001", 1, {
			name: "New Course Name",
		});
		await service.updateItineraryItem(
			owner,
			"evt_trip0001",
			"iti_tee00001",
			1,
			{ title: "Updated tee time" },
		);
		const [stored] = await sql<{ name: string }[]>`
      SELECT place_snapshot->>'name' AS name FROM event_itinerary_items WHERE id = 'iti_tee00001'
    `;
		expect(stored?.name).toBe("Old Course Name");

		const dayVersion = (
			await service.getEvent(owner, "evt_trip0001", "evt_day00001")
		).version;
		await expect(
			service.tombstoneEvent(
				owner,
				"evt_trip0001",
				"evt_day00001",
				dayVersion,
				false,
			),
		).rejects.toMatchObject({ code: "LIVE_DEPENDENCIES" });
		await service.tombstoneEvent(
			owner,
			"evt_trip0001",
			"evt_day00001",
			dayVersion,
			true,
		);
		const tombstones = await sql<{ entityType: string }[]>`
      SELECT entity_type AS "entityType" FROM event_root_changes
			WHERE root_event_id = 'evt_trip0001' AND operation = 'tombstone'
			ORDER BY ordinal
    `;
		expect(tombstones.map((row) => row.entityType)).toEqual([
			"event",
			"itineraryItem",
		]);
		const revisions = await sql<{ ordered: boolean }[]>`
      SELECT bool_and(root_revision > previous) AS ordered FROM (
			SELECT root_revision, lag(root_revision) OVER (ORDER BY root_revision) AS previous
			FROM (SELECT DISTINCT root_revision FROM event_root_changes WHERE root_event_id = 'evt_trip0001') revisions
		) values WHERE previous IS NOT NULL
    `;
		expect(revisions[0]?.ordered).toBe(true);
	});
});

type MembershipRecordLike = { userId: string };

function rootInput(
	id: string,
	status: EventInput["status"] = "draft",
): EventInput {
	return {
		id,
		kind: "team_event",
		title: "Root",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status,
	};
}

function childInput(
	id: string,
	status: EventInput["status"] = "draft",
): EventInput {
	return { ...rootInput(id, status), kind: "session", title: id };
}

function itineraryInput(
	id: string,
	eventId: string,
	details: ItineraryInput["details"] = { schemaVersion: 1, type: "note" },
	status: ItineraryInput["status"] = "active",
): ItineraryInput {
	return {
		id,
		eventId,
		title: id,
		notes: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		allDay: false,
		status,
		details,
		placeId: null,
	};
}
