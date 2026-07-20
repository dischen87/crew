import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { EventInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { PostgresRecapExternalRetention } from "./recap-external-retention";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const invitationKey =
	"recap-retention-test-invitation-key-with-at-least-32-characters";
const day = 24 * 60 * 60 * 1_000;
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(821) };
const organizer = { id: userId(822) };
const participant = { id: userId(823) };
const apiAclRole = "crew_recap_retention_api_acl_test";
const workerAclRole = "crew_recap_retention_worker_acl_test";

let sql: Sql;
let service: EventService;
let app: ReturnType<typeof createApp>;
let linkSequence = 0;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 16, onnotice: () => {} });
	await migrate(sql);
	await sql.unsafe(`
		DO $body$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${apiAclRole}') THEN
				CREATE ROLE ${apiAclRole} NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${workerAclRole}') THEN
				CREATE ROLE ${workerAclRole} NOLOGIN;
			END IF;
		END;
		$body$;
		GRANT USAGE ON SCHEMA public TO ${apiAclRole}, ${workerAclRole};
		GRANT SELECT, DELETE ON event_recap_external_grant_decisions,
			event_recap_external_share_fields,
			event_recap_external_share_audit_events,
			event_recap_share_links
		TO ${apiAclRole};
		REVOKE ALL ON event_recap_external_retention_state
		FROM ${apiAclRole}, ${workerAclRole};
		REVOKE EXECUTE ON FUNCTION event_recap_external_link_metadata_complete(TEXT)
		FROM ${apiAclRole}, ${workerAclRole};
		REVOKE EXECUTE ON FUNCTION purge_event_recap_external_metadata(INTEGER)
		FROM ${apiAclRole};
		GRANT EXECUTE ON FUNCTION purge_event_recap_external_metadata(INTEGER)
		TO ${workerAclRole};
	`);
	service = new EventService(
		new PostgresEventRepository(
			sql,
			new EventNotificationPayloadCodec({
				kid: "recap-retention-test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		invitationKey,
	);
	installPublishedRootFixtures(service, sql);
	app = createApp({
		service,
		verifyUserToken: async (token) => ({ id: token }),
	});
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
	await sql`
		UPDATE event_recap_external_retention_state
		SET link_cursor_terminal_at = NULL, link_cursor_id = NULL,
			decision_cursor_decided_at = NULL, decision_cursor_id = NULL,
			updated_at = clock_timestamp()
	`;
});

afterEach(async () => {
	await sql`DROP TRIGGER IF EXISTS test_recap_retention_failure ON event_recap_share_links`;
	await sql`DROP TRIGGER IF EXISTS test_recap_retention_delay ON event_recap_share_links`;
	await sql`DROP FUNCTION IF EXISTS test_recap_retention_failure()`;
	await sql`DROP FUNCTION IF EXISTS test_recap_retention_delay()`;
});

afterAll(async () => {
	await sql.unsafe(`
		DROP OWNED BY ${apiAclRole};
		DROP OWNED BY ${workerAclRole};
		DROP ROLE ${apiAclRole};
		DROP ROLE ${workerAclRole};
	`);
	await sql.end();
});

describe("bounded external recap retention against PostgreSQL 17", () => {
	test("uses the DB 90-day boundary and leaves recent, active, title-only and ambiguous chains", async () => {
		const now = await databaseNow();
		const boundary = await createEventRecap("evt_retention_boundary");
		const recent = await createEventRecap("evt_retention_recent");
		const active = await createEventRecap("evt_retention_active");
		const ambiguous = await createEventRecap("evt_retention_ambiguous");
		const titleOnly = await createEventRecap("evt_retention_title_only");
		for (const recap of [boundary, recent, active, ambiguous])
			await insertDecision(recap, "manager", owner.id, "grant", ago(now, 100));

		const boundaryLink = await insertLink(boundary, {
			createdAt: ago(now, 97),
			expiresAt: ago(now, 90),
		});
		const recentLink = await insertLink(recent, {
			createdAt: new Date(now.getTime() - 97 * day + 60_000),
			expiresAt: new Date(now.getTime() - 90 * day + 60_000),
		});
		const activeLink = await insertLink(active, {
			createdAt: ago(now, 1),
			expiresAt: new Date(now.getTime() + 6 * day),
		});
		const ambiguousCreatedAt = ago(now, 98);
		const ambiguousLink = await insertLink(ambiguous, {
			createdAt: ambiguousCreatedAt,
			expiresAt: ago(now, 91),
			createAudit: false,
		});
		const titleLink = await insertLink(titleOnly, {
			createdAt: ago(now, 98),
			expiresAt: ago(now, 91),
			projection: "title-only-reviewed",
		});
		const sourceCountsBefore = await sourceCounts();

		const stats = await new PostgresRecapExternalRetention(sql).purge(10);
		expect(stats).toMatchObject({
			leaseAcquired: 1,
			scannedLinks: 2,
			purgedLinks: 1,
			purgedFields: 1,
			purgedAuditEvents: 1,
			purgedGrantDecisions: 1,
			ambiguousLinks: 1,
			scanSaturated: 0,
		});
		expect(stats.oldestScannedAgeSeconds).toBeGreaterThanOrEqual(90 * 86_400);
		expect(await linkExists(boundaryLink)).toBe(false);
		for (const id of [recentLink, activeLink, ambiguousLink, titleLink])
			expect(await linkExists(id)).toBe(true);
		expect(await sourceCounts()).toEqual(sourceCountsBefore);

		for (const mutation of [
			() => sql`
				UPDATE event_recap_external_grant_decisions
				SET decision = decision WHERE root_event_id = ${recent.rootEventId}
			`,
			() => sql`
				DELETE FROM event_recap_external_share_fields
				WHERE link_id = ${recentLink}
			`,
			() => sql`
				DELETE FROM event_recap_external_share_audit_events
				WHERE link_id = ${recentLink}
			`,
			() => sql`DELETE FROM event_recap_share_links WHERE id = ${recentLink}`,
		])
			expect(await databaseErrorCode(mutation)).toBe("55000");

		const [functionAcl] = await sql<{ publicCanExecute: boolean }[]>`
			SELECT has_function_privilege(
				'public', 'purge_event_recap_external_metadata(integer)', 'EXECUTE'
			) AS "publicCanExecute"
		`;
		expect(functionAcl?.publicCanExecute).toBe(false);

		await sql`
			INSERT INTO event_recap_external_share_audit_events (
				root_event_id, link_id, action, actor_id, occurred_at
			) VALUES (
				${ambiguous.rootEventId}, ${ambiguousLink}, 'create', ${owner.id},
				${ambiguousCreatedAt}
			)
		`;
		expect(
			(await new PostgresRecapExternalRetention(sql).purge(10)).scannedLinks,
		).toBe(0);
		expect(
			(await new PostgresRecapExternalRetention(sql).purge(10)).purgedLinks,
		).toBe(1);
		expect(await linkExists(ambiguousLink)).toBe(false);
		expect(await sourceCounts()).toEqual(sourceCountsBefore);
	});

	test("retains shared grants through recent and active rotated dependents, then removes the last old chain", async () => {
		const now = await databaseNow();
		const shared = await createEventRecap("evt_retention_shared");
		await insertDecision(shared, "manager", owner.id, "grant", ago(now, 100));
		const oldShared = await insertLink(shared, {
			createdAt: ago(now, 99),
			expiresAt: ago(now, 92),
			revokedAt: ago(now, 92),
			terminalAction: "rotate",
		});
		const recentShared = await insertLink(shared, {
			createdAt: ago(now, 96),
			expiresAt: ago(now, 89),
			revokedAt: ago(now, 89),
		});

		const rotated = await createEventRecap("evt_retention_rotated");
		await insertDecision(rotated, "manager", owner.id, "grant", ago(now, 100));
		const oldRotated = await insertLink(rotated, {
			createdAt: ago(now, 99),
			expiresAt: ago(now, 92),
			revokedAt: ago(now, 92),
			terminalAction: "rotate",
		});
		const activeReplacement = await insertLink(rotated, {
			createdAt: ago(now, 1),
			expiresAt: new Date(now.getTime() + 6 * day),
		});

		await new PostgresRecapExternalRetention(sql).purge(10);
		expect(await linkExists(oldShared)).toBe(false);
		expect(await linkExists(oldRotated)).toBe(false);
		expect(await linkExists(recentShared)).toBe(true);
		expect(await linkExists(activeReplacement)).toBe(true);
		expect(await decisionCount(shared)).toBe(1);
		expect(await decisionCount(rotated)).toBe(1);

		await sql`
			UPDATE event_recap_share_links
			SET revoked_at = ${ago(now, 91)}
			WHERE id = ${recentShared}
		`;
		await new PostgresRecapExternalRetention(sql).purge(10);
		expect(await linkExists(recentShared)).toBe(false);
		expect(await decisionCount(shared)).toBe(1);
		await new PostgresRecapExternalRetention(sql).purge(10);
		expect(await decisionCount(shared)).toBe(0);
		expect(await decisionCount(rotated)).toBe(1);
	});

	test("bounds zero-link old decision cleanup without exposing an older grant and keeps recent unused decisions", async () => {
		const now = await databaseNow();
		const old = await createFeedRecap("evt_retention_unused_old");
		const recent = await createEventRecap("evt_retention_unused_recent");
		for (const [authority, actor, decision] of [
			["manager", owner.id, "grant"],
			["author", participant.id, "grant"],
			["manager", owner.id, "withdraw"],
			["author", participant.id, "withdraw"],
		] as const)
			await insertDecision(old, authority, actor, decision, ago(now, 100));
		await insertDecision(recent, "manager", owner.id, "grant", ago(now, 1));

		const first = await new PostgresRecapExternalRetention(sql).purge(2);
		expect(first).toMatchObject({
			scannedLinks: 0,
			scannedGrantDecisions: 2,
			purgedGrantDecisions: 2,
			scanSaturated: 1,
		});
		expect(await latestDecisions(old)).toEqual([
			{ authority: "author", decision: "withdraw" },
			{ authority: "manager", decision: "withdraw" },
		]);
		expect(await decisionCount(recent)).toBe(1);

		const second = await new PostgresRecapExternalRetention(sql).purge(2);
		expect(second.purgedGrantDecisions).toBe(2);
		expect(await decisionCount(old)).toBe(0);
		expect(await decisionCount(recent)).toBe(1);
	});

	test("retains a young author chain while deleting the independently old manager chain", async () => {
		const now = await databaseNow();
		const recap = await createFeedRecap("evt_retention_staggered_authority");
		await insertDecision(recap, "manager", owner.id, "grant", ago(now, 101));
		await insertDecision(recap, "manager", owner.id, "withdraw", ago(now, 100));
		await insertDecision(
			recap,
			"author",
			participant.id,
			"grant",
			ago(now, 100),
		);
		await insertDecision(
			recap,
			"author",
			participant.id,
			"withdraw",
			ago(now, 1),
		);

		const stats = await new PostgresRecapExternalRetention(sql).purge(10);
		expect(stats.purgedGrantDecisions).toBe(2);
		expect(await decisionCount(recap)).toBe(2);
		expect(await latestDecisions(recap)).toEqual([
			{ authority: "author", decision: "withdraw" },
		]);
	});

	test("enforces the API-negative and purge-only worker roles at runtime", async () => {
		const recap = await createEventRecap("evt_retention_acl_roles");
		await insertDecision(
			recap,
			"manager",
			owner.id,
			"grant",
			await databaseNow(),
		);
		const now = await databaseNow();
		const linkId = await insertLink(recap, {
			createdAt: ago(now, 1),
			expiresAt: new Date(now.getTime() + 6 * day),
		});
		const [privileges] = await sql<
			{
				apiPurge: boolean;
				apiHelper: boolean;
				apiStateSelect: boolean;
				apiStateUpdate: boolean;
				workerPurge: boolean;
				workerHelper: boolean;
				workerStateSelect: boolean;
				workerStateUpdate: boolean;
				workerDelete: boolean;
			}[]
		>`
			SELECT
				has_function_privilege(
					${apiAclRole}, 'purge_event_recap_external_metadata(integer)', 'EXECUTE'
				) AS "apiPurge",
				has_function_privilege(
					${apiAclRole}, 'event_recap_external_link_metadata_complete(text)', 'EXECUTE'
				) AS "apiHelper",
				has_table_privilege(
					${apiAclRole}, 'event_recap_external_retention_state', 'SELECT'
				) AS "apiStateSelect",
				has_table_privilege(
					${apiAclRole}, 'event_recap_external_retention_state', 'UPDATE'
				) AS "apiStateUpdate",
				has_function_privilege(
					${workerAclRole}, 'purge_event_recap_external_metadata(integer)', 'EXECUTE'
				) AS "workerPurge",
				has_function_privilege(
					${workerAclRole}, 'event_recap_external_link_metadata_complete(text)', 'EXECUTE'
				) AS "workerHelper",
				has_table_privilege(
					${workerAclRole}, 'event_recap_external_retention_state', 'SELECT'
				) AS "workerStateSelect",
				has_table_privilege(
					${workerAclRole}, 'event_recap_external_retention_state', 'UPDATE'
				) AS "workerStateUpdate",
				has_table_privilege(
					${workerAclRole}, 'event_recap_share_links', 'DELETE'
				) AS "workerDelete"
		`;
		expect(privileges).toEqual({
			apiPurge: false,
			apiHelper: false,
			apiStateSelect: false,
			apiStateUpdate: false,
			workerPurge: true,
			workerHelper: false,
			workerStateSelect: false,
			workerStateUpdate: false,
			workerDelete: false,
		});

		let apiCallCode = "";
		try {
			await sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx.unsafe(`SET LOCAL ROLE ${apiAclRole}`);
				await tx`SELECT * FROM purge_event_recap_external_metadata(1)`;
			});
		} catch (error) {
			apiCallCode = (error as { code?: string }).code ?? "";
		}
		expect(apiCallCode).toBe("42501");

		let spoofedDeleteCode = "";
		try {
			await sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx.unsafe(`SET LOCAL ROLE ${apiAclRole}`);
				await tx`
					SELECT set_config(
						'crew.recap_external_retention_delete', 'enabled', true
					)
				`;
				await tx`DELETE FROM event_recap_share_links WHERE id = ${linkId}`;
			});
		} catch (error) {
			spoofedDeleteCode = (error as { code?: string }).code ?? "";
		}
		expect(spoofedDeleteCode).toBe("55000");
		expect(await linkExists(linkId)).toBe(true);

		const workerStats = await sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			await tx.unsafe(`SET LOCAL ROLE ${workerAclRole}`);
			const [stats] = await tx<{ leaseAcquired: number }[]>`
				SELECT lease_acquired AS "leaseAcquired"
				FROM purge_event_recap_external_metadata(1)
			`;
			return stats;
		});
		expect(workerStats?.leaseAcquired).toBe(1);
		expect(await linkExists(linkId)).toBe(true);
	});

	test("rolls back a failed purge and serializes concurrent workers with the singleton lease", async () => {
		const now = await databaseNow();
		const failed = await createEventRecap("evt_retention_rollback");
		await insertDecision(failed, "manager", owner.id, "grant", ago(now, 100));
		const failedLink = await insertLink(failed, {
			createdAt: ago(now, 98),
			expiresAt: ago(now, 91),
		});
		await sql.unsafe(`
			CREATE FUNCTION test_recap_retention_failure()
			RETURNS TRIGGER LANGUAGE plpgsql AS $body$
			BEGIN
				RAISE EXCEPTION 'forced retention rollback';
			END;
			$body$;
			CREATE TRIGGER test_recap_retention_failure
			BEFORE DELETE ON event_recap_share_links
			FOR EACH ROW EXECUTE FUNCTION test_recap_retention_failure();
		`);
		await expect(
			new PostgresRecapExternalRetention(sql).purge(10),
		).rejects.toThrow("forced retention rollback");
		expect(await linkExists(failedLink)).toBe(true);
		expect(await metadataCounts(failedLink)).toEqual({ fields: 1, audits: 1 });
		expect(await decisionCount(failed)).toBe(1);
		await sql`DROP TRIGGER test_recap_retention_failure ON event_recap_share_links`;
		await sql`DROP FUNCTION test_recap_retention_failure()`;

		const concurrent = await createEventRecap("evt_retention_concurrent");
		await insertDecision(
			concurrent,
			"manager",
			owner.id,
			"grant",
			ago(now, 100),
		);
		const concurrentLink = await insertLink(concurrent, {
			createdAt: ago(now, 98),
			expiresAt: ago(now, 91),
		});
		await sql.unsafe(`
			CREATE FUNCTION test_recap_retention_delay()
			RETURNS TRIGGER LANGUAGE plpgsql AS $body$
			BEGIN
				PERFORM pg_sleep(0.15);
				RETURN OLD;
			END;
			$body$;
			CREATE TRIGGER test_recap_retention_delay
			BEFORE DELETE ON event_recap_share_links
			FOR EACH ROW EXECUTE FUNCTION test_recap_retention_delay();
		`);
		const clientA = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		const clientB = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		try {
			const [a, b] = await Promise.all([
				new PostgresRecapExternalRetention(clientA).purge(10),
				new PostgresRecapExternalRetention(clientB).purge(10),
			]);
			expect(a.leaseAcquired + b.leaseAcquired).toBe(1);
			expect(a.purgedLinks + b.purgedLinks).toBe(2);
		} finally {
			await Promise.all([clientA.end(), clientB.end()]);
		}
		expect(await linkExists(failedLink)).toBe(false);
		expect(await linkExists(concurrentLink)).toBe(false);
	});

	test("proves a non-manager feed author and a separate manager grant without widening authority", async () => {
		const recap = await createFeedRecap("evt_retention_nonmanager_author");
		const wrongAuthor = await decideGrant(
			owner.id,
			recap,
			"retention-wrong-author",
			"author",
		);
		expect(wrongAuthor.status).toBe(404);
		const wrongManager = await decideGrant(
			participant.id,
			recap,
			"retention-wrong-manager",
			"manager",
		);
		expect(wrongManager.status).toBe(404);
		expect(
			(
				await decideGrant(
					participant.id,
					recap,
					"retention-feed-author",
					"author",
				)
			).status,
		).toBe(200);
		expect(
			(
				await decideGrant(
					organizer.id,
					recap,
					"retention-feed-manager",
					"manager",
				)
			).status,
		).toBe(200);

		const createdResponse = await app.request(
			`/v1/event-roots/${recap.rootEventId}/recap/external-share-links`,
			{
				method: "POST",
				headers: commandHeaders(organizer.id, "retention-feed-link"),
				body: JSON.stringify({
					recapVersion: 1,
					projectionConsent: "exact-fields-reviewed-v1",
					fields: [externalField(recap)],
				}),
			},
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { token: string };
		const resolved = await app.request(
			"/v1/recap-external-share-links/resolve",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: created.token }),
			},
		);
		expect(resolved.status).toBe(200);
		const text = await resolved.text();
		expect(text).toContain("NON_MANAGER_APPROVED_EXTERNAL_BODY");
		for (const forbidden of [participant.id, organizer.id, recap.sourceId])
			expect(text).not.toContain(forbidden);
	});

	test("keeps the scan plans capped and on the retention indexes", async () => {
		const plans = await sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			await tx`SET LOCAL enable_seqscan = off`;
			const link = await tx<{ "QUERY PLAN": unknown }[]>`
				EXPLAIN (FORMAT JSON)
				SELECT id FROM event_recap_share_links
				WHERE projection_consent = 'exact-fields-reviewed-v1'
					AND LEAST(expires_at, COALESCE(revoked_at, expires_at))
						<= clock_timestamp() - interval '90 days'
				ORDER BY LEAST(expires_at, COALESCE(revoked_at, expires_at)), id
				LIMIT 7
			`;
			const decision = await tx<{ "QUERY PLAN": unknown }[]>`
				EXPLAIN (FORMAT JSON)
				SELECT id FROM event_recap_external_grant_decisions
				WHERE decided_at <= clock_timestamp() - interval '90 days'
				ORDER BY decided_at, id
				LIMIT 7
			`;
			return JSON.stringify([link, decision]);
		});
		expect(plans).toContain("Limit");
		expect(plans).toContain("event_recap_share_links_external_retention");
		expect(plans).toContain(
			"event_recap_external_grant_decisions_retention_scan",
		);
	});
});

type RecapFixture = {
	rootEventId: string;
	ordinal: number;
	sourceType: "event" | "feedEntry";
	sourceId: string;
	sourceVersion: number;
};

async function createEventRecap(rootEventId: string): Promise<RecapFixture> {
	await createRoot(rootEventId);
	await installRecap(rootEventId);
	return {
		rootEventId,
		ordinal: 0,
		sourceType: "event",
		sourceId: rootEventId,
		sourceVersion: 1,
	};
}

async function createFeedRecap(rootEventId: string): Promise<RecapFixture> {
	await createRoot(rootEventId);
	await addMember(rootEventId, organizer.id, "organizer");
	await addMember(rootEventId, participant.id, "participant");
	const feed = await service.createFeedEntry(participant, rootEventId, {
		id: `fed_${rootEventId.slice(4)}`,
		eventId: rootEventId,
		parentEntryId: null,
		kind: "message",
		body: "NON_MANAGER_APPROVED_EXTERNAL_BODY",
	});
	await installRecap(rootEventId, feed.id);
	return {
		rootEventId,
		ordinal: 1,
		sourceType: "feedEntry",
		sourceId: feed.id,
		sourceVersion: feed.version,
	};
}

async function createRoot(rootEventId: string) {
	await service.createRoot(owner, publishedRoot(rootEventId));
}

function publishedRoot(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: "Retention-safe event title",
		description: "Retention-safe event body",
		timeZone: "Europe/Zurich",
		startsAt: new Date("2026-07-01T08:00:00.000Z"),
		endsAt: new Date("2026-07-01T18:00:00.000Z"),
		status: "published",
	};
}

async function addMember(
	rootEventId: string,
	actorId: string,
	role: "organizer" | "participant",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${actorId}, ${role}, 'active')
	`;
}

async function installRecap(rootEventId: string, feedEntryId?: string) {
	const [root] = await sql<
		{
			revision: string;
			eventRevision: string;
			title: string;
			body: string;
		}[]
	>`
		SELECT root.revision::text AS revision,
			change.root_revision::text AS "eventRevision",
			event.title, event.description AS body
		FROM event_roots AS root
		JOIN events AS event ON event.id = root.root_event_id
		JOIN LATERAL (
			SELECT root_revision FROM event_root_changes
			WHERE root_event_id = root.root_event_id
				AND entity_type = 'event' AND entity_id = root.root_event_id
			ORDER BY root_revision DESC, ordinal DESC LIMIT 1
		) AS change ON TRUE
		WHERE root.root_event_id = ${rootEventId}
	`;
	if (!root) throw new Error("Missing retention root fixture");
	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`
			INSERT INTO event_recap_snapshots (
				root_event_id, version, source_root_revision, title,
				title_source_version, title_source_revision, generated_by
			) VALUES (
				${rootEventId}, 1, ${root.revision}, ${root.title},
				1, ${root.eventRevision}, ${owner.id}
			)
		`;
		await tx`
			INSERT INTO event_recap_items (
				root_event_id, recap_version, ordinal, source_type, source_id,
				source_version, source_revision, source_visibility, consent_basis,
				consented_by_user_id, consent_membership_version, source_title,
				source_body
			) VALUES (
				${rootEventId}, 1, 0, 'event', ${rootEventId}, 1,
				${root.eventRevision}, 'members', 'event-publication', NULL, NULL,
				${root.title}, ${root.body}
			)
		`;
		if (feedEntryId) {
			const [feed] = await tx<
				{
					version: number;
					revision: string;
					body: string;
					memberVersion: number;
				}[]
			>`
				SELECT current.version, current.root_revision::text AS revision,
					current.body, membership.version AS "memberVersion"
				FROM event_feed_entry_current AS current
				JOIN event_feed_entries AS entry
					ON entry.root_event_id = current.root_event_id
					AND entry.id = current.entry_id
				JOIN event_memberships AS membership
					ON membership.root_event_id = entry.root_event_id
					AND membership.user_id = entry.author_user_id
				WHERE current.root_event_id = ${rootEventId}
					AND current.entry_id = ${feedEntryId}
			`;
			if (!feed) throw new Error("Missing retention feed fixture");
			await tx`
				INSERT INTO event_recap_items (
					root_event_id, recap_version, ordinal, source_type, source_id,
					source_version, source_revision, source_visibility, consent_basis,
					consented_by_user_id, consent_membership_version, source_title,
					source_body
				) VALUES (
					${rootEventId}, 1, 1, 'feedEntry', ${feedEntryId}, ${feed.version},
					${feed.revision}, 'members', 'source-author', ${participant.id},
					${feed.memberVersion}, NULL, ${feed.body}
				)
			`;
		}
		await tx`
			INSERT INTO event_recap_heads (
				root_event_id, latest_version, published_version, lifecycle_version,
				published_at, published_by
			) VALUES (${rootEventId}, 1, 1, 2, clock_timestamp(), ${owner.id})
		`;
		await tx`
			INSERT INTO event_recap_audit_events (
				root_event_id, lifecycle_version, action, recap_version, actor_id
			) VALUES
				(${rootEventId}, 1, 'generate', 1, ${owner.id}),
				(${rootEventId}, 2, 'publish', 1, ${owner.id})
		`;
	});
}

async function insertDecision(
	recap: RecapFixture,
	authority: "author" | "manager",
	actorId: string,
	decision: "grant" | "withdraw",
	decidedAt: Date,
) {
	await sql`
		INSERT INTO event_recap_external_grant_decisions (
			root_event_id, recap_version, recap_ordinal, source_type, source_id,
			source_version, field_name, authority, decision, actor_id,
			actor_membership_version, decided_at
		) VALUES (
			${recap.rootEventId}, 1, ${recap.ordinal}, ${recap.sourceType},
			${recap.sourceId}, ${recap.sourceVersion}, 'body', ${authority},
			${decision}, ${actorId}, 1, ${decidedAt}
		)
	`;
}

async function insertLink(
	recap: RecapFixture,
	input: {
		createdAt: Date;
		expiresAt: Date;
		revokedAt?: Date;
		terminalAction?: "rotate" | "revoke";
		createAudit?: boolean;
		projection?: "exact-fields-reviewed-v1" | "title-only-reviewed";
	},
) {
	linkSequence += 1;
	const id = `rsh_${linkSequence.toString().padStart(24, "0")}`;
	const projection = input.projection ?? "exact-fields-reviewed-v1";
	await sql`
		INSERT INTO event_recap_share_links (
			id, root_event_id, recap_version, token_hash, token_key_id,
			projection_consent, created_by, created_by_membership_version,
			created_at, expires_at, revoked_at, revoked_by
		) VALUES (
			${id}, ${recap.rootEventId}, 1,
			${createHash("sha256").update(id).digest("hex")}, 'test-v1',
			${projection}, ${owner.id},
			${projection === "exact-fields-reviewed-v1" ? 1 : null},
			${input.createdAt}, ${input.expiresAt}, ${input.revokedAt ?? null},
			${input.revokedAt ? owner.id : null}
		)
	`;
	if (projection === "title-only-reviewed") return id;
	await sql`
		INSERT INTO event_recap_external_share_fields (
			link_id, root_event_id, recap_version, recap_ordinal, source_type,
			source_id, source_version, field_name
		) VALUES (
			${id}, ${recap.rootEventId}, 1, ${recap.ordinal}, ${recap.sourceType},
			${recap.sourceId}, ${recap.sourceVersion}, 'body'
		)
	`;
	if (input.createAudit !== false)
		await sql`
			INSERT INTO event_recap_external_share_audit_events (
				root_event_id, link_id, action, actor_id, occurred_at
			) VALUES (
				${recap.rootEventId}, ${id}, 'create', ${owner.id}, ${input.createdAt}
			)
		`;
	if (input.revokedAt)
		await sql`
			INSERT INTO event_recap_external_share_audit_events (
				root_event_id, link_id, action, actor_id, occurred_at
			) VALUES (
				${recap.rootEventId}, ${id}, ${input.terminalAction ?? "revoke"},
				${owner.id}, ${input.revokedAt}
			)
		`;
	return id;
}

function externalField(recap: RecapFixture) {
	return {
		sourceType: recap.sourceType,
		sourceId: recap.sourceId,
		sourceVersion: recap.sourceVersion,
		field: "body",
	};
}

function decideGrant(
	actorId: string,
	recap: RecapFixture,
	key: string,
	authority: "author" | "manager",
) {
	return app.request(
		`/v1/event-roots/${recap.rootEventId}/recap/external-grants`,
		{
			method: "POST",
			headers: commandHeaders(actorId, key),
			body: JSON.stringify({
				recapVersion: 1,
				...externalField(recap),
				authority,
				decision: "grant",
			}),
		},
	);
}

function commandHeaders(actorId: string, key: string) {
	return {
		Authorization: `Bearer ${actorId}`,
		"Content-Type": "application/json",
		"Idempotency-Key": key,
	};
}

async function databaseNow() {
	const [clock] = await sql<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
	if (!clock) throw new Error("Missing PostgreSQL clock");
	return clock.now;
}

async function databaseErrorCode(work: () => Promise<unknown>) {
	try {
		await work();
		return "";
	} catch (error) {
		return (error as { code?: string }).code ?? "";
	}
}

function ago(now: Date, days: number) {
	return new Date(now.getTime() - days * day);
}

async function linkExists(id: string) {
	const [row] = await sql<{ exists: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM event_recap_share_links WHERE id = ${id}
		) AS exists
	`;
	return row?.exists ?? false;
}

async function decisionCount(recap: RecapFixture) {
	const [row] = await sql<{ count: number }[]>`
		SELECT count(*)::INTEGER AS count
		FROM event_recap_external_grant_decisions
		WHERE root_event_id = ${recap.rootEventId}
			AND recap_version = 1 AND recap_ordinal = ${recap.ordinal}
			AND source_type = ${recap.sourceType} AND source_id = ${recap.sourceId}
			AND source_version = ${recap.sourceVersion} AND field_name = 'body'
	`;
	return row?.count ?? 0;
}

async function latestDecisions(recap: RecapFixture) {
	return [
		...(await sql<{ authority: string; decision: string }[]>`
		SELECT DISTINCT ON (authority) authority, decision
		FROM event_recap_external_grant_decisions
		WHERE root_event_id = ${recap.rootEventId}
			AND recap_version = 1 AND recap_ordinal = ${recap.ordinal}
			AND source_type = ${recap.sourceType} AND source_id = ${recap.sourceId}
			AND source_version = ${recap.sourceVersion} AND field_name = 'body'
		ORDER BY authority, id DESC
	`),
	];
}

async function metadataCounts(linkId: string) {
	const [row] = await sql<{ fields: number; audits: number }[]>`
		SELECT
			(SELECT count(*)::INTEGER FROM event_recap_external_share_fields
				WHERE link_id = ${linkId}) AS fields,
			(SELECT count(*)::INTEGER FROM event_recap_external_share_audit_events
				WHERE link_id = ${linkId}) AS audits
	`;
	return row ?? { fields: 0, audits: 0 };
}

async function sourceCounts() {
	const [row] = await sql<
		{ events: number; snapshots: number; items: number }[]
	>`
		SELECT
			(SELECT count(*)::INTEGER FROM events) AS events,
			(SELECT count(*)::INTEGER FROM event_recap_snapshots) AS snapshots,
			(SELECT count(*)::INTEGER FROM event_recap_items) AS items
	`;
	return row ?? { events: 0, snapshots: 0, items: 0 };
}
