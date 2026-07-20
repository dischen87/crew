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
import type { EventInput, ItineraryInput } from "./domain";
import {
	type EventNotificationPayload,
	EventNotificationPayloadCodec,
} from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import {
	type SystemFeedPayload,
	systemFeedEntryId,
	systemFeedPayloadJson,
} from "./system-feed";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const payloadKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };

let sql: Sql;
let codec: EventNotificationPayloadCodec;
let service: EventService;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
});

beforeEach(async () => {
	await sql`
		TRUNCATE event_notification_outbox, event_idempotency_records,
			event_roots CASCADE
	`;
	codec = new EventNotificationPayloadCodec({
		kid: "system-feed-test-v1",
		key: payloadKey,
	});
	service = new EventService(
		new PostgresEventRepository(sql, codec),
		"system-feed-test-invitation-key-with-at-least-32-characters",
	);
	installPublishedRootFixtures(service, sql);
});

afterAll(async () => {
	await sql.end();
});

describe("curated system feed projection against PostgreSQL", () => {
	test("stores canonical root publication once across exact command replay", async () => {
		const rootEventId = "evt_sys-root-replay";
		const organizer = userId(2);
		const participant = userId(3);
		const viewer = userId(4);
		await service.createRoot(
			owner,
			{
				...rootInput(rootEventId, "draft"),
				description: "Ready for publication",
				startsAt: new Date("2026-08-01T08:00:00+02:00"),
				endsAt: new Date("2026-08-01T18:00:00+02:00"),
			},
			{
				id: "team-event",
				version: 1,
				eventIds: {
					root: rootEventId,
					agenda: "evt_sys-root-replay-agenda",
					activity: "evt_sys-root-replay-activity",
				},
			},
		);
		await service.createPlace(owner, rootEventId, {
			id: "plc_sys-root-replay-venue",
			name: "Publication venue",
			locality: "Zurich",
			countryCode: "CH",
			latitude: null,
			longitude: null,
		});
		await service.replaceCapability(owner, rootEventId, rootEventId, 1, {
			type: "team",
			schemaVersion: 1,
			config: {
				venuePlaceId: "plc_sys-root-replay-venue",
				assignmentMode: "organizer",
				capacityPerTeam: 6,
				facilitator: null,
			},
		});
		await addMember(rootEventId, organizer, "organizer");
		await addMember(rootEventId, participant, "participant");
		await addMember(rootEventId, viewer, "viewer");

		const readiness = await service.getPublishReadiness(owner, rootEventId);
		const request = {
			rootEventId,
			baseVersion: readiness.rootVersion,
			baseRevision: readiness.rootRevision,
		};
		const publish = () =>
			service.command(
				owner,
				"eventsPublish",
				"system-root-replay-0001",
				request,
				async (scoped) => {
					const event = await scoped.publishRoot(
						owner,
						rootEventId,
						request.baseVersion,
						request.baseRevision,
					);
					return {
						status: 200,
						body: { eventId: event.id, version: event.version },
						headers: {},
					};
				},
			);

		const first = await publish();
		expect(first.replayed).toBe(false);
		const payload = {
			schemaVersion: 1,
			type: "event.published",
			actorUserId: owner.id,
			eventId: rootEventId,
			entityVersion: 2,
		} satisfies SystemFeedPayload;
		const entryId = systemFeedEntryId(rootEventId, payload);
		const firstProof = await projectionProof(rootEventId, entryId);
		const firstJobs = await notificationRows();

		const replay = await publish();
		expect(replay).toMatchObject({ replayed: true, body: first.body });
		expect(await projectionProof(rootEventId, entryId)).toEqual(firstProof);
		expect(await notificationRows()).toEqual(firstJobs);
		expect(firstProof).toEqual({
			id: entryId,
			kind: "system",
			authorUserId: null,
			body: systemFeedPayloadJson(payload),
			version: 1,
			revisions: 1,
			changes: 1,
		});
		const notifications = firstJobs.map(openNotification);
		expect(
			notifications.map(({ recipientUserId }) => recipientUserId).sort(),
		).toEqual([organizer, participant, viewer].sort());
		for (const notification of notifications) {
			expect(notification.causationRequestId).toBe(entryId);
			expect(notification.deepLink).toEqual({
				rootEventId,
				feedEntryId: entryId,
			});
		}
	});

	test("keeps invitation activation manager-only and records ownership transfer", async () => {
		const rootEventId = "evt_sys-membership";
		const organizer = userId(10);
		const participant = userId(11);
		const viewer = userId(12);
		const newcomer = { id: userId(13) };
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, organizer, "organizer");
		await addMember(rootEventId, participant, "participant");
		await addMember(rootEventId, viewer, "viewer");

		const activationInvite = await service.createInvitation(
			owner,
			rootEventId,
			{
				id: "inv_sys-member-activation",
				role: "participant",
				expiresAt: new Date(Date.now() + 60_000),
				maxUses: 1,
			},
		);
		await service.redeemInvitation(
			newcomer,
			activationInvite.token,
			new Date(),
		);
		await service.redeemInvitation(
			newcomer,
			activationInvite.token,
			new Date(),
		);

		const activationRows = (await systemRows(rootEventId)).filter(
			({ payload }) => payload.type === "membership.activated",
		);
		expect(activationRows).toHaveLength(1);
		const activationId = activationRows[0]?.id;
		if (!activationId) throw new Error("Expected membership activation entry");
		const activationRecipients = (await notificationRows())
			.map(openNotification)
			.filter(({ deepLink }) => deepLink.feedEntryId === activationId)
			.map(({ recipientUserId }) => recipientUserId)
			.sort();
		expect(activationRecipients).toEqual([owner.id, organizer].sort());

		const upgradeInvite = await service.createInvitation(owner, rootEventId, {
			id: "inv_sys-member-upgrade",
			role: "organizer",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		await service.redeemInvitation(
			{ id: participant },
			upgradeInvite.token,
			new Date(),
		);
		expect(
			(await systemRows(rootEventId)).filter(
				({ payload }) => payload.type === "membership.activated",
			),
		).toHaveLength(1);

		await service.transferOwnership(owner, rootEventId, organizer, 1, 1);
		const ownershipRows = (await systemRows(rootEventId)).filter(
			({ payload }) => payload.type === "ownership.transferred",
		);
		expect(ownershipRows).toHaveLength(1);
		expect(ownershipRows[0]?.payload).toEqual({
			schemaVersion: 1,
			type: "ownership.transferred",
			actorUserId: owner.id,
			fromUserId: owner.id,
			toUserId: organizer,
			entityVersion: 2,
		});
	});

	test("rolls the originating event publication back when outbox fanout fails", async () => {
		const rootEventId = "evt_sys-rollback";
		const childEventId = "evt_sys-rollback-child";
		await service.createRoot(owner, rootInput(rootEventId, "draft"));
		await addMember(rootEventId, userId(20), "organizer");
		const child = await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			childInput(childEventId, "draft"),
		);
		const before = await rootProof(rootEventId);

		await sql.unsafe(`
			CREATE FUNCTION fail_system_notification_fanout()
			RETURNS TRIGGER LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'forced system notification rollback';
			END;
			$$;
			CREATE TRIGGER fail_system_notification_fanout_trigger
				BEFORE INSERT ON event_notification_outbox
				FOR EACH ROW EXECUTE FUNCTION fail_system_notification_fanout();
		`);
		try {
			await expect(
				service.updateEvent(owner, rootEventId, childEventId, child.version, {
					status: "published",
				}),
			).rejects.toThrow("forced system notification rollback");
		} finally {
			await sql.unsafe(`
				DROP TRIGGER IF EXISTS fail_system_notification_fanout_trigger
					ON event_notification_outbox;
				DROP FUNCTION IF EXISTS fail_system_notification_fanout();
			`);
		}

		expect(await rootProof(rootEventId)).toEqual(before);
		expect(
			await service.getEvent(owner, rootEventId, childEventId),
		).toMatchObject({
			status: "draft",
			version: child.version,
		});
		expect(await systemRows(rootEventId, childEventId)).toHaveLength(0);
	});

	test("enforces draft, viewer, tombstone, noise and immutable-system matrices", async () => {
		const rootEventId = "evt_sys-matrix";
		const childEventId = "evt_sys-matrix-child";
		const siblingEventId = "evt_sys-matrix-sibling";
		const participant = { id: userId(30) };
		const viewer = { id: userId(31) };
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			childInput(childEventId, "draft"),
		);
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			childInput(siblingEventId, "draft"),
		);
		await service.createItineraryItem(
			owner,
			rootEventId,
			itineraryInput("iti_sys-draft", childEventId),
		);
		let child = await service.getEvent(owner, rootEventId, childEventId);
		await service.updateEvent(owner, rootEventId, childEventId, child.version, {
			title: "Noise-only title",
		});
		const root = await service.getEvent(owner, rootEventId, rootEventId);
		await service.reorderEvents(
			owner,
			rootEventId,
			rootEventId,
			root.childOrderVersion,
			[siblingEventId, childEventId],
		);
		expect(await systemRows(rootEventId, childEventId)).toHaveLength(0);

		child = await service.getEvent(owner, rootEventId, childEventId);
		await service.updateEvent(owner, rootEventId, childEventId, child.version, {
			status: "published",
		});
		const added = await service.createItineraryItem(
			owner,
			rootEventId,
			itineraryInput("iti_sys-live", childEventId),
		);
		const titleOnly = await service.updateItineraryItem(
			owner,
			rootEventId,
			added.id,
			added.version,
			{ title: "Noise-only itinerary title" },
		);
		await service.updateItineraryItem(
			owner,
			rootEventId,
			added.id,
			titleOnly.version,
			{ status: "cancelled" },
		);

		const liveRows = await systemRows(rootEventId, childEventId);
		expect(liveRows.map(({ payload }) => payload.type).sort()).toEqual([
			"event.published",
			"itinerary.added",
			"itinerary.cancelled",
		]);
		const eventEntry = liveRows.find(
			({ payload }) => payload.type === "event.published",
		);
		if (!eventEntry) throw new Error("Expected child publication entry");
		await expect(
			service.reviseFeedEntry(owner, rootEventId, eventEntry.id, 1, "mutated"),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			service.removeFeedEntry(owner, rootEventId, eventEntry.id, 1),
		).rejects.toMatchObject({ status: 403 });
		expect(await projectionProof(rootEventId, eventEntry.id)).toMatchObject({
			body: eventEntry.body,
			version: 1,
			revisions: 1,
		});

		const viewerBefore = await service.listFeedEntries(viewer, rootEventId, {
			limit: 20,
			eventId: childEventId,
		});
		expect(viewerBefore.items).toHaveLength(3);
		const childNotifications = (await notificationRows())
			.map(openNotification)
			.filter(({ deepLink }) => deepLink.eventId === childEventId);
		expect(childNotifications).toHaveLength(6);
		expect(
			new Set(childNotifications.map(({ recipientUserId }) => recipientUserId)),
		).toEqual(new Set([participant.id, viewer.id]));

		child = await service.getEvent(owner, rootEventId, childEventId);
		await service.tombstoneEvent(
			owner,
			rootEventId,
			childEventId,
			child.version,
			true,
		);
		expect(
			(
				await service.listFeedEntries(viewer, rootEventId, {
					limit: 20,
					eventId: childEventId,
				})
			).items,
		).toHaveLength(0);
		expect(
			(
				await service.listFeedEntries(owner, rootEventId, {
					limit: 20,
					eventId: childEventId,
				})
			).items,
		).toHaveLength(3);
		const [visible] = await sql<{ allowed: boolean }[]>`
			SELECT event_feed_recipient_can_read(
				${rootEventId}, ${eventEntry.id}, ${viewer.id}
			) AS allowed
		`;
		expect(visible?.allowed).toBe(false);
		expect(await systemRows(rootEventId, childEventId)).toHaveLength(3);
	});
});

function rootInput(id: string, status: EventInput["status"]): EventInput {
	return {
		id,
		kind: "team_event",
		title: id,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status,
	};
}

function childInput(id: string, status: EventInput["status"]): EventInput {
	return { ...rootInput(id, status), kind: "session" };
}

function itineraryInput(id: string, eventId: string): ItineraryInput {
	return {
		id,
		eventId,
		title: id,
		notes: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		allDay: false,
		status: "active",
		details: { schemaVersion: 1, type: "note" },
		placeId: null,
	};
}

async function addMember(
	rootEventId: string,
	memberId: string,
	role: "organizer" | "participant" | "viewer",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${memberId}, ${role}, 'active')
	`;
}

type NotificationRow = {
	id: string;
	payloadKid: string;
	payloadCiphertext: string;
	expiresAt: Date;
};

function notificationRows() {
	return sql<NotificationRow[]>`
		SELECT id, payload_kid AS "payloadKid",
			payload_ciphertext AS "payloadCiphertext", expires_at AS "expiresAt"
		FROM event_notification_outbox ORDER BY id
	`;
}

function openNotification(row: NotificationRow): EventNotificationPayload {
	return codec.open(
		row.id,
		row.payloadKid,
		row.payloadCiphertext,
		row.expiresAt.toISOString(),
	);
}

function projectionProof(rootEventId: string, entryId: string) {
	return sql<
		{
			id: string;
			kind: string;
			authorUserId: string | null;
			body: string;
			version: number;
			revisions: number;
			changes: number;
		}[]
	>`
		SELECT entry.id, entry.kind, entry.author_user_id AS "authorUserId",
			current.body, current.version,
			(SELECT count(*)::int FROM event_feed_entry_revisions revision
			 WHERE revision.root_event_id = entry.root_event_id
				AND revision.entry_id = entry.id) AS revisions,
			(SELECT count(*)::int FROM event_root_changes change
			 WHERE change.root_event_id = entry.root_event_id
				AND change.entity_type = 'feedEntry'
				AND change.entity_id = entry.id) AS changes
		FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id
			AND current.entry_id = entry.id
		WHERE entry.root_event_id = ${rootEventId} AND entry.id = ${entryId}
	`.then(([row]) => row);
}

async function systemRows(rootEventId: string, eventId?: string) {
	const rows = await sql<{ id: string; body: string }[]>`
		SELECT entry.id, current.body
		FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id
			AND current.entry_id = entry.id
		WHERE entry.root_event_id = ${rootEventId} AND entry.kind = 'system'
			${eventId ? sql`AND entry.event_id = ${eventId}` : sql``}
		ORDER BY entry.created_root_revision, entry.id
	`;
	return rows.map((row) => ({
		...row,
		payload: JSON.parse(row.body) as SystemFeedPayload,
	}));
}

function rootProof(rootEventId: string) {
	return sql<
		{
			revision: string;
			changes: number;
			entries: number;
			jobs: number;
		}[]
	>`
		SELECT revision::text AS revision,
			(SELECT count(*)::int FROM event_root_changes
			 WHERE root_event_id = ${rootEventId}) AS changes,
			(SELECT count(*)::int FROM event_feed_entries
			 WHERE root_event_id = ${rootEventId}) AS entries,
			(SELECT count(*)::int FROM event_notification_outbox) AS jobs
		FROM event_roots WHERE root_event_id = ${rootEventId}
	`.then(([row]) => row);
}
