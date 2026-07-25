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
import { DomainError } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };
const organizer = { id: userId(2) };
const otherOwner = { id: userId(3) };
let sql: Sql;
let service: EventService;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 4 });
	await migrate(sql);
	service = new EventService(
		new PostgresEventRepository(
			sql,
			new EventNotificationPayloadCodec({
				kid: "test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		"test-invitation-key-with-at-least-32-characters",
	);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
});

afterAll(async () => {
	await sql.end();
});

describe("root cutover ownership ledger", () => {
	test("defaults Crew Next roots to next and fails closed for legacy writes", async () => {
		await service.createRoot(owner, rootInput("evt_cutover_next"));
		expect(
			(await service.getRootCutoverOwnership(owner, "evt_cutover_next"))
				.ownership,
		).toMatchObject({
			revision: "1",
			state: "next",
			actorId: owner.id,
			reason: "Root created in Crew Next",
			sourceRelease: "crew-next",
			targetRelease: "crew-next",
		});
		await service.assertRootWriteAuthority("evt_cutover_next", "next");
		await expect(
			service.assertRootWriteAuthority("evt_cutover_next", "legacy"),
		).rejects.toMatchObject({ code: "ROOT_WRITE_NOT_AUTHORITATIVE" });
	});

	test("enforces pre-write rollback, owner scope, idempotency and immutable audit", async () => {
		await provisionLegacyRoot("evt_cutover_legacy", owner.id);
		await provisionLegacyRoot("evt_cutover_other", otherOwner.id);
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES ('evt_cutover_legacy', ${organizer.id}, 'organizer', 'active')
		`;

		await expect(
			service.getRootCutoverOwnership(organizer, "evt_cutover_legacy"),
		).rejects.toBeInstanceOf(DomainError);
		await expect(
			service.getRootCutoverOwnership(otherOwner, "evt_cutover_legacy"),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			service.createEvent(
				owner,
				"evt_cutover_legacy",
				"evt_cutover_legacy",
				rootInput("evt_cutover_blocked"),
			),
		).rejects.toMatchObject({ code: "ROOT_WRITE_NOT_AUTHORITATIVE" });

		const locked = {
			state: "migration_locked" as const,
			expectedRevision: "1",
			reason: "Final legacy delta export",
			sourceRelease: "legacy-2026.07.25",
			targetRelease: "next-2026.07.25",
		};
		const firstLock = await service.transitionRootCutoverOwnership(
			owner,
			"evt_cutover_legacy",
			locked,
		);
		expect(firstLock.revision).toBe("2");
		const lockReplay = await service.transitionRootCutoverOwnership(
			owner,
			"evt_cutover_legacy",
			locked,
		);
		expect(lockReplay.revision).toBe("2");
		await expect(
			service.transitionRootCutoverOwnership(owner, "evt_cutover_legacy", {
				...locked,
				state: "archived",
				expectedRevision: "2",
			}),
		).rejects.toMatchObject({ code: "CUTOVER_TRANSITION_INVALID" });
		const unlocked = {
			state: "legacy",
			expectedRevision: "2",
			reason: "Pre-write validation failed",
			sourceRelease: "legacy-2026.07.25",
			targetRelease: "next-2026.07.25",
		} as const;
		await service.transitionRootCutoverOwnership(
			owner,
			"evt_cutover_legacy",
			unlocked,
		);
		await expect(
			service.transitionRootCutoverOwnership(
				owner,
				"evt_cutover_legacy",
				locked,
			),
		).rejects.toMatchObject({ code: "CUTOVER_REVISION_CONFLICT" });
		await expect(
			service.createEvent(
				owner,
				"evt_cutover_legacy",
				"evt_cutover_legacy",
				rootInput("evt_cutover_still_blocked"),
			),
		).rejects.toMatchObject({ code: "ROOT_WRITE_NOT_AUTHORITATIVE" });
		await service.transitionRootCutoverOwnership(owner, "evt_cutover_legacy", {
			...locked,
			expectedRevision: "3",
		});
		await expect(
			service.transitionRootCutoverOwnership(
				owner,
				"evt_cutover_legacy",
				unlocked,
			),
		).rejects.toMatchObject({ code: "CUTOVER_REVISION_CONFLICT" });

		await service.transitionRootCutoverOwnership(owner, "evt_cutover_legacy", {
			state: "next",
			expectedRevision: "4",
			reason: "Reconciliation passed",
			sourceRelease: "legacy-2026.07.25",
			targetRelease: "next-2026.07.25",
		});
		await service.createEvent(
			owner,
			"evt_cutover_legacy",
			"evt_cutover_legacy",
			rootInput("evt_cutover_child"),
		);
		await expect(
			service.transitionRootCutoverOwnership(owner, "evt_cutover_legacy", {
				...locked,
				state: "legacy",
				expectedRevision: "5",
			}),
		).rejects.toMatchObject({ code: "CUTOVER_TRANSITION_INVALID" });

		const currentRoot = await service.getEvent(
			owner,
			"evt_cutover_legacy",
			"evt_cutover_legacy",
		);
		await service.archiveEvent(
			owner,
			"evt_cutover_legacy",
			"evt_cutover_legacy",
			currentRoot.version,
		);
		await service.transitionRootCutoverOwnership(owner, "evt_cutover_legacy", {
			state: "archived",
			expectedRevision: "5",
			reason: "Retention owner approved archive",
			sourceRelease: "next-2026.07.25",
			targetRelease: "archive-2026.07.25",
		});
		const ledger = await service.getRootCutoverOwnership(
			owner,
			"evt_cutover_legacy",
		);
		expect(ledger.ownership.state).toBe("archived");
		expect(
			ledger.audit.map(({ revision, fromState, state }) => [
				revision,
				fromState,
				state,
			]),
		).toEqual([
			["1", null, "legacy"],
			["2", "legacy", "migration_locked"],
			["3", "migration_locked", "legacy"],
			["4", "legacy", "migration_locked"],
			["5", "migration_locked", "next"],
			["6", "next", "archived"],
		]);
	}, 15_000);
});

function rootInput(id: string) {
	return {
		id,
		kind: "team_event" as const,
		title: id,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft" as const,
	};
}

async function provisionLegacyRoot(rootEventId: string, ownerId: string) {
	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`
			INSERT INTO event_roots (
				root_event_id, revision, ownership_state, ownership_actor_id,
				ownership_reason, ownership_source_release, ownership_target_release
			) VALUES (
				${rootEventId}, 1, 'legacy', 'system:legacy-import',
				'Legacy root provisioned atomically', 'legacy-2026.07.25',
				'next-2026.07.25'
			)
		`;
		await tx`
			INSERT INTO events (
				id, root_event_id, parent_event_id, kind, title, description,
				time_zone, starts_at, ends_at, status
			) VALUES (
				${rootEventId}, ${rootEventId}, NULL, 'team_event', ${rootEventId},
				NULL, 'Europe/Zurich', NULL, NULL, 'published'
			)
		`;
		await tx`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES (${rootEventId}, ${ownerId}, 'owner', 'active')
		`;
	});
}
