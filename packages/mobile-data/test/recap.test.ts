import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	GatewayClient,
	type Session,
	type SessionStore,
} from "@crew/mobile-client";
import {
	type EventRecap,
	EventRecapController,
	EventRecapExternalApprovalsRequiredError,
	type EventRecapExternalField,
	EventRecapManagerRequiredError,
	EventRecapOnlineRequiredError,
	EventRecapRootAccessDeniedError,
	type EventRecapSnapshot,
	EventRecapUnavailableError,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
} from "../src/index.ts";

const accountA = `usr_${"1".repeat(32)}`;
const accountB = `usr_${"2".repeat(32)}`;
const rootEventId = "evt_recap_trip";
const now = "2026-07-19T10:00:00.000Z";
const shareLinkId = `rsh_${"a".repeat(24)}`;
const shareToken = `crs_${"b".repeat(43)}`;
const idempotencyKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const eventBodyField: EventRecapExternalField = {
	field: "body",
	sourceId: rootEventId,
	sourceType: "event",
	sourceVersion: 3,
};
const feedBodyField: EventRecapExternalField = {
	field: "body",
	sourceId: "fed_recap_dinner",
	sourceType: "feedEntry",
	sourceVersion: 2,
};
const captionFieldRef = `rcf_${"c".repeat(43)}`;
const feedCaptionField: EventRecapExternalField = {
	field: "caption",
	fieldRef: captionFieldRef,
	sourceId: feedBodyField.sourceId,
	sourceType: "feedEntry",
	sourceVersion: feedBodyField.sourceVersion,
};

class BunDatabase implements SqlDatabase {
	readonly sqlite = new Database(":memory:", { create: true });

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		this.sqlite.query(sql).run(...parameters);
	}

	async all<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<readonly Row[]> {
		return this.sqlite.query(sql).all(...parameters) as Row[];
	}

	async first<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<Row | null> {
		return (this.sqlite.query(sql).get(...parameters) as Row | null) ?? null;
	}

	async transaction<Result>(
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result> {
		this.sqlite.exec("BEGIN IMMEDIATE");
		try {
			const result = await work(this);
			this.sqlite.exec("COMMIT");
			return result;
		} catch (error) {
			this.sqlite.exec("ROLLBACK");
			throw error;
		}
	}
}

class MemorySessionStore implements SessionStore {
	public session: Session | null;

	constructor(initialSession: Session | null = session()) {
		this.session = initialSession;
	}

	async get() {
		return this.session;
	}

	async compareAndSet(expected: Session | null, replacement: Session | null) {
		if (this.session !== expected) return false;
		this.session = replacement;
		return true;
	}
}

describe("authorized recap snapshots", () => {
	test("restarts from an account-scoped cache and never exposes drafts to participants", async () => {
		const database = await seededDatabase(accountA, "organizer");
		await seedRoot(database, accountB, "participant");
		const controller = new EventRecapController(
			database,
			gatewayClient(async () =>
				jsonResponse(200, { recap: recap("draft"), externalConsent: null }),
			),
			{ now: () => new Date(now) },
		);

		await expect(controller.refresh(rootEventId)).resolves.toEqual(
			expect.objectContaining({
				recap: expect.objectContaining({ state: "draft", version: 1 }),
				role: "organizer",
			}),
		);
		expect((await controller.getCached(rootEventId))?.recap.title).toBe(
			"Turkey Golf Tour",
		);
		expect(
			await new EventRecapController(database, gatewayClient()).getCached(
				rootEventId,
			),
		).toEqual(expect.objectContaining({ refreshedAt: now }));

		const accountBController = new EventRecapController(
			database,
			gatewayClient(undefined, new MemorySessionStore(session(accountB))),
		);
		expect(await accountBController.getCached(rootEventId)).toBeNull();

		await database.run(
			`UPDATE memberships SET role = 'participant'
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?`,
			[accountA, rootEventId, accountA],
		);
		expect(await controller.getCached(rootEventId)).toBeNull();
		expect(
			await database.first(
				"SELECT 1 FROM authorized_recap_cache WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("keeps consent ephemeral and binds only a complete ordinal projection", async () => {
		const database = await seededDatabase(accountA, "owner");
		const published = recapWithEventAndFeedBodies();
		let externalConsent: unknown = recapExternalConsent();
		const client = gatewayClient(async () =>
			jsonResponse(200, { recap: published, externalConsent }),
		);
		const controller = new EventRecapController(database, client, {
			now: () => new Date(now),
		});

		expect((await controller.refresh(rootEventId))?.externalConsent).toEqual(
			recapExternalConsent(),
		);
		expect(
			(await controller.getCached(rootEventId))?.externalConsent,
		).toBeNull();
		expect(
			(await new EventRecapController(database, client).getCached(rootEventId))
				?.externalConsent,
		).toBeNull();
		const stored = await database.first<{ snapshot_json: string }>(
			`SELECT snapshot_json FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountA, rootEventId],
		);
		expect(stored?.snapshot_json).not.toContain("managerDecision");
		expect(stored?.snapshot_json).not.toContain("actorCanDecide");
		externalConsent = recapExternalConsentWithCaption();
		expect((await controller.refresh(rootEventId))?.externalConsent).toEqual(
			recapExternalConsentWithCaption(),
		);
		const captionSafeCache = await database.first<{ snapshot_json: string }>(
			`SELECT snapshot_json FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountA, rootEventId],
		);
		expect(captionSafeCache?.snapshot_json).not.toContain(captionFieldRef);
		expect(captionSafeCache?.snapshot_json).not.toContain(
			"Sonnenuntergang am langen Tisch",
		);
		externalConsent = {
			fields: recapExternalConsentWithCaption().fields.map((field) =>
				field.field === "caption"
					? { ...field, fieldRef: "rcf_invalid" }
					: field,
			),
		};
		await expect(controller.refresh(rootEventId)).rejects.toMatchObject({
			code: "invalid_response",
		});
		externalConsent = {
			fields: recapExternalConsentWithCaption().fields.map((field) =>
				field.field === "caption" ? { ...field, attachmentOrdinal: 1 } : field,
			),
		};
		expect((await controller.refresh(rootEventId))?.externalConsent).toBeNull();

		externalConsent = {
			fields: recapExternalConsent().fields.slice(0, 1),
		};
		expect((await controller.refresh(rootEventId))?.externalConsent).toBeNull();
		externalConsent = {
			fields: [
				{
					...recapExternalConsent().fields[0],
					authorDecision: "grant",
					requiredAuthorities: ["author", "manager"],
				},
				recapExternalConsent().fields[1],
			],
		};
		expect((await controller.refresh(rootEventId))?.externalConsent).toBeNull();
		externalConsent = null;
		expect((await controller.refresh(rootEventId))?.externalConsent).toBeNull();
	});

	test("keeps participant published snapshots offline and purges removed, drifted or private data after authoritative sync", async () => {
		const database = await seededDatabase(accountA, "participant");
		let response: Response = jsonResponse(200, {
			recap: recap("published", { publishedVersion: 1 }),
			externalConsent: null,
		});
		const controller = new EventRecapController(
			database,
			gatewayClient(async () => response),
		);

		await controller.refresh(rootEventId);
		expect((await controller.getCached(rootEventId))?.recap.state).toBe(
			"published",
		);
		response = errorResponse(404, "NOT_FOUND");
		expect(await controller.refresh(rootEventId)).toBeNull();
		expect(await controller.getCached(rootEventId)).toBeNull();

		response = jsonResponse(200, {
			recap: recap("published", { version: 2, publishedVersion: 2 }),
			externalConsent: null,
		});
		await controller.refresh(rootEventId);
		response = jsonResponse(200, {
			recap: recap("published", { version: 3, publishedVersion: 3 }),
			externalConsent: null,
		});
		expect(await controller.refresh(rootEventId, 2)).toBeNull();
		expect(await controller.getCached(rootEventId)).toBeNull();

		response = jsonResponse(200, {
			recap: recap("published", { version: 2, publishedVersion: 2 }),
			externalConsent: null,
		});
		await controller.refresh(rootEventId);
		await database.run(
			`UPDATE memberships SET status = 'removed'
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?`,
			[accountA, rootEventId, accountA],
		);
		await expect(controller.getCached(rootEventId)).rejects.toBeInstanceOf(
			EventRecapRootAccessDeniedError,
		);
		expect(
			await database.first(
				"SELECT 1 FROM authorized_recap_cache WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("never queues online-only writes and enforces manager roles before a request", async () => {
		const database = await seededDatabase(accountA, "participant");
		let requests = 0;
		const client = gatewayClient(async () => {
			requests += 1;
			return jsonResponse(201, { recap: recap("draft") });
		});
		const offline = new EventRecapController(database, client, {
			isOnline: () => false,
		});
		await expect(offline.generate(rootEventId)).rejects.toBeInstanceOf(
			EventRecapOnlineRequiredError,
		);
		await expect(offline.publish(rootEventId, 1, 1)).rejects.toBeInstanceOf(
			EventRecapOnlineRequiredError,
		);
		await expect(offline.remove(rootEventId, 1)).rejects.toBeInstanceOf(
			EventRecapOnlineRequiredError,
		);
		await expect(
			offline.createShareLink(rootEventId, 1),
		).rejects.toBeInstanceOf(EventRecapOnlineRequiredError);
		await expect(
			offline.revokeShareLink(rootEventId, shareLinkId),
		).rejects.toBeInstanceOf(EventRecapOnlineRequiredError);
		expect(requests).toBe(0);
		expect(
			await database.first(
				"SELECT 1 FROM recap_command_attempts WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();

		const online = new EventRecapController(database, client);
		await expect(online.generate(rootEventId)).rejects.toBeInstanceOf(
			EventRecapManagerRequiredError,
		);
		expect(requests).toBe(0);
	});

	test("persists only stable idempotency attempts across restart and never stores a share token", async () => {
		const database = await seededDatabase(accountA, "owner");
		const seenKeys: string[] = [];
		const seenBodies: unknown[] = [];
		const client = gatewayClient(async (input, init) => {
			seenKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
			seenBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
			const path = new URL(String(input)).pathname;
			if (path.endsWith("/share-links")) {
				return jsonResponse(201, {
					shareLink: {
						createdAt: now,
						expiresAt: "2026-07-26T10:00:00.000Z",
						id: shareLinkId,
						recapVersion: 1,
					},
					token: shareToken,
				});
			}
			return jsonResponse(201, { recap: recap("draft") });
		});
		let generatedKeys = 0;
		const options = {
			idempotencyKey: () => `recap-command-${++generatedKeys}-stable`,
		};
		await new EventRecapController(database, client, options).generate(
			rootEventId,
		);
		await new EventRecapController(database, client, options).generate(
			rootEventId,
		);
		expect(seenKeys.slice(0, 2)).toEqual([
			"recap-command-1-stable",
			"recap-command-1-stable",
		]);
		expect(seenBodies[0]).toEqual({
			baseRevision: "7",
			sources: [
				{
					consentBasis: "event-publication",
					sourceId: rootEventId,
					sourceVersion: 3,
					type: "event",
				},
			],
		});
		const published = recap("published", { publishedVersion: 1 });
		await database.run(
			`UPDATE authorized_recap_cache SET state = 'published', snapshot_json = ?
WHERE account_user_id = ? AND root_event_id = ?`,
			[JSON.stringify(published), accountA, rootEventId],
		);

		const share = await new EventRecapController(
			database,
			client,
			options,
		).createShareLink(rootEventId, 1);
		expect(share.token).toBe(shareToken);
		const dump = database.sqlite
			.query(
				`SELECT fingerprint, idempotency_key FROM recap_command_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
			)
			.all(accountA, rootEventId);
		expect(JSON.stringify(dump)).not.toContain(shareToken);
		expect(
			await database.first(
				"SELECT name FROM sqlite_master WHERE name LIKE '%outbox%' AND name LIKE '%recap%'",
			),
		).toBeNull();
	});

	test("publishes, removes, shares and revokes through exact generated Gateway operations", async () => {
		const database = await seededDatabase(accountA, "organizer");
		const calls: Array<{ method: string; path: string }> = [];
		const client = gatewayClient(async (input, init) => {
			const path = new URL(String(input)).pathname;
			calls.push({ method: init?.method ?? "GET", path });
			if (path.endsWith("/publish")) {
				return jsonResponse(200, {
					recap: recap("published", {
						lifecycleVersion: 2,
						publishedVersion: 1,
					}),
				});
			}
			if (path.endsWith(`/share-links/${shareLinkId}`)) {
				return jsonResponse(200, { revoked: true });
			}
			if (path.endsWith("/share-links")) {
				return jsonResponse(201, {
					shareLink: {
						createdAt: now,
						expiresAt: "2026-07-26T10:00:00.000Z",
						id: shareLinkId,
						recapVersion: 1,
					},
					token: shareToken,
				});
			}
			return jsonResponse(200, { lifecycleVersion: 3, removed: true });
		});
		const controller = new EventRecapController(database, client, {
			idempotencyKey: () => `recap-exact-${calls.length + 1}-stable`,
		});
		expect((await controller.publish(rootEventId, 1, 1)).recap.state).toBe(
			"published",
		);
		await controller.createShareLink(rootEventId, 1);
		await controller.revokeShareLink(rootEventId, shareLinkId);
		await controller.remove(rootEventId, 2);
		expect(calls).toEqual([
			{
				method: "POST",
				path: `/core/v1/event-roots/${rootEventId}/recap/publish`,
			},
			{
				method: "POST",
				path: `/core/v1/event-roots/${rootEventId}/recap/share-links`,
			},
			{
				method: "DELETE",
				path: `/core/v1/event-roots/${rootEventId}/recap/share-links/${shareLinkId}`,
			},
			{
				method: "DELETE",
				path: `/core/v1/event-roots/${rootEventId}/recap`,
			},
		]);
		expect(await controller.getCached(rootEventId)).toBeNull();
	});

	test("keeps exact-field decisions and sharing stable without persisting selected IDs, bodies or tokens", async () => {
		const database = await seededDatabase(accountA, "owner");
		const published = recapWithEventAndFeedBodies();
		await seedPublishedRecap(database, published);
		const calls: Array<{
			body: Record<string, unknown>;
			key: string;
			path: string;
		}> = [];
		const client = gatewayClient(async (input, init) => {
			const path = new URL(String(input)).pathname;
			if (!init?.body) {
				return jsonResponse(200, {
					externalConsent: recapExternalConsent(),
					recap: published,
				});
			}
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			calls.push({
				body,
				key: new Headers(init?.headers).get("idempotency-key") ?? "",
				path,
			});
			if (path.endsWith("/external-grants")) {
				return jsonResponse(200, { decision: body.decision });
			}
			return jsonResponse(201, {
				shareLink: {
					createdAt: now,
					expiresAt: "2026-07-26T10:00:00.000Z",
					id: shareLinkId,
					recapVersion: 1,
				},
				token: shareToken,
			});
		});
		let keyNumber = 0;
		const controller = new EventRecapController(database, client, {
			idempotencyKey: () => `recap-external-${++keyNumber}-stable`,
		});
		await controller.refresh(rootEventId);

		await controller.decideExternalBody(
			rootEventId,
			1,
			eventBodyField,
			"manager",
			"grant",
		);
		await controller.decideExternalBody(
			rootEventId,
			1,
			eventBodyField,
			"manager",
			"grant",
		);
		await controller.decideExternalBody(
			rootEventId,
			1,
			eventBodyField,
			"manager",
			"withdraw",
		);
		await controller.decideExternalBody(
			rootEventId,
			1,
			eventBodyField,
			"manager",
			"grant",
		);
		await controller.decideExternalBody(
			rootEventId,
			1,
			feedBodyField,
			"manager",
			"grant",
		);
		await controller.createExactBodyShareLink(rootEventId, 1, [
			feedBodyField,
			eventBodyField,
		]);
		await controller.createExactBodyShareLink(rootEventId, 1, [
			eventBodyField,
			feedBodyField,
		]);
		await controller.createShareLink(rootEventId, 1);

		expect(calls.map(({ key }) => key)).toEqual([
			"recap-external-1-stable",
			"recap-external-1-stable",
			"recap-external-2-stable",
			"recap-external-3-stable",
			"recap-external-4-stable",
			"recap-external-5-stable",
			"recap-external-5-stable",
			"recap-external-6-stable",
		]);
		expect(calls[0]?.body).toEqual({
			...eventBodyField,
			authority: "manager",
			decision: "grant",
			recapVersion: 1,
		});
		expect(calls[5]?.body).toEqual({
			fields: [eventBodyField, feedBodyField],
			projectionConsent: "exact-fields-reviewed-v1",
			recapVersion: 1,
		});
		expect(calls.map(({ path }) => path)).toEqual([
			...Array.from(
				{ length: 5 },
				() => `/core/v1/event-roots/${rootEventId}/recap/external-grants`,
			),
			`/core/v1/event-roots/${rootEventId}/recap/external-share-links`,
			`/core/v1/event-roots/${rootEventId}/recap/external-share-links`,
			`/core/v1/event-roots/${rootEventId}/recap/share-links`,
		]);

		const externalAttempts = await database.all<{
			command_scope_hash: string;
			idempotency_key: string;
			request_fingerprint: string;
		}>(
			`SELECT command_scope_hash, request_fingerprint, idempotency_key
FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountA, rootEventId],
		);
		expect(externalAttempts).toHaveLength(3);
		for (const attempt of externalAttempts) {
			expect(attempt.command_scope_hash).toMatch(/^[a-f0-9]{64}$/);
			expect(attempt.request_fingerprint).toMatch(/^[a-f0-9]{64}$/);
		}
		const storedAttempts = JSON.stringify(externalAttempts);
		expect(storedAttempts).not.toContain(eventBodyField.sourceId);
		expect(storedAttempts).not.toContain(feedBodyField.sourceId);
		expect(storedAttempts).not.toContain("Willkommensabend");
		expect(storedAttempts).not.toContain(shareToken);
	});

	test("purges obsolete exact-field attempts on recap drift, removal and root access loss", async () => {
		const database = await seededDatabase(accountA, "owner");
		const version1 = recapWithEventAndFeedBodies();
		const version2 = recapWithEventAndFeedBodies({
			lifecycleVersion: 2,
			publishedVersion: 2,
			version: 2,
		});
		await seedPublishedRecap(database, version1);
		let refreshCount = 0;
		const client = gatewayClient(async (input, init) => {
			const path = new URL(String(input)).pathname;
			if (!init?.body && init?.method !== "DELETE") {
				const current = refreshCount++ === 0 ? version1 : version2;
				return jsonResponse(200, {
					externalConsent: recapExternalConsent(),
					recap: current,
				});
			}
			if (path.endsWith("/external-grants")) {
				const body = JSON.parse(String(init?.body)) as { decision: string };
				return jsonResponse(200, { decision: body.decision });
			}
			if (path.endsWith("/external-share-links")) {
				return jsonResponse(201, {
					shareLink: {
						createdAt: now,
						expiresAt: "2026-07-26T10:00:00.000Z",
						id: shareLinkId,
						recapVersion: 1,
					},
					token: shareToken,
				});
			}
			if (init?.method === "DELETE") {
				return jsonResponse(200, { lifecycleVersion: 3, removed: true });
			}
			return jsonResponse(200, { recap: version2, externalConsent: null });
		});
		let keyNumber = 0;
		const controller = new EventRecapController(database, client, {
			idempotencyKey: () => `recap-cleanup-${++keyNumber}-stable`,
		});
		await controller.refresh(rootEventId, 1);

		await controller.decideExternalBody(
			rootEventId,
			1,
			eventBodyField,
			"manager",
			"grant",
		);
		await controller.createExactBodyShareLink(rootEventId, 1, [eventBodyField]);
		expect(await countExternalAttempts(database)).toBe(2);

		await controller.refresh(rootEventId);
		expect(await countExternalAttempts(database)).toBe(0);

		await controller.decideExternalBody(
			rootEventId,
			2,
			eventBodyField,
			"manager",
			"grant",
		);
		expect(await countExternalAttempts(database)).toBe(1);
		await controller.remove(rootEventId, 2);
		expect(await countExternalAttempts(database)).toBe(0);

		await seedPublishedRecap(database, version2);
		await controller.refresh(rootEventId);
		await controller.decideExternalBody(
			rootEventId,
			2,
			eventBodyField,
			"manager",
			"grant",
		);
		expect(await countExternalAttempts(database)).toBe(1);
		await database.run(
			`UPDATE memberships SET status = 'removed'
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?`,
			[accountA, rootEventId, accountA],
		);
		await expect(controller.getCached(rootEventId)).rejects.toBeInstanceOf(
			EventRecapRootAccessDeniedError,
		);
		expect(await countExternalAttempts(database)).toBe(0);
	});

	test("allows server-owned author decisions and fails exact-field mutations closed for offline, stale and unapproved states", async () => {
		const participantDatabase = await seededDatabase(accountA, "participant");
		await seedPublishedRecap(
			participantDatabase,
			recapWithEventAndFeedBodies(),
		);
		let requests = 0;
		const requestKeys: string[] = [];
		const requestBodies: Array<Record<string, unknown>> = [];
		const client = gatewayClient(async (input, init) => {
			if (!init?.body) {
				return jsonResponse(200, {
					externalConsent: recapExternalConsent(),
					recap: recapWithEventAndFeedBodies(),
				});
			}
			requests += 1;
			requestKeys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
			const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			requestBodies.push(body);
			if (new URL(String(input)).pathname.endsWith("/external-grants")) {
				return jsonResponse(200, { decision: body.decision });
			}
			return errorResponse(409, "RECAP_EXTERNAL_GRANTS_REQUIRED");
		});
		const participant = new EventRecapController(participantDatabase, client);
		await participant.refresh(rootEventId);
		await expect(
			participant.decideExternalBody(
				rootEventId,
				1,
				feedBodyField,
				"author",
				"grant",
			),
		).resolves.toEqual({ decision: "grant" });
		expect(requestBodies[0]).toEqual({
			...feedBodyField,
			authority: "author",
			decision: "grant",
			recapVersion: 1,
		});
		await expect(
			participant.createExactBodyShareLink(rootEventId, 1, [eventBodyField]),
		).rejects.toBeInstanceOf(EventRecapManagerRequiredError);
		expect(requests).toBe(1);

		const offline = new EventRecapController(participantDatabase, client, {
			isOnline: () => false,
		});
		await expect(
			offline.decideExternalBody(
				rootEventId,
				1,
				eventBodyField,
				"manager",
				"grant",
			),
		).rejects.toBeInstanceOf(EventRecapOnlineRequiredError);
		requests = 0;
		requestKeys.length = 0;

		const accountAManagerDatabase = await seededDatabase(accountA, "organizer");
		await seedPublishedRecap(
			accountAManagerDatabase,
			recapWithEventAndFeedBodies(),
		);
		const accountAManager = new EventRecapController(
			accountAManagerDatabase,
			client,
		);
		await accountAManager.refresh(rootEventId);
		await expect(
			accountAManager.decideExternalBody(
				rootEventId,
				1,
				{ ...eventBodyField, sourceVersion: 99 },
				"manager",
				"grant",
			),
		).rejects.toBeInstanceOf(EventRecapUnavailableError);
		expect(requests).toBe(0);

		await seedPublishedRecap(
			accountAManagerDatabase,
			recapWithEventAndFeedBodies(),
		);
		await expect(
			accountAManager.createExactBodyShareLink(rootEventId, 1, [
				eventBodyField,
			]),
		).rejects.toBeInstanceOf(EventRecapExternalApprovalsRequiredError);
		await expect(
			accountAManager.createExactBodyShareLink(rootEventId, 1, [
				eventBodyField,
			]),
		).rejects.toBeInstanceOf(EventRecapExternalApprovalsRequiredError);
		expect(requests).toBe(2);
		expect(requestKeys[0]).toMatch(idempotencyKeyPattern);
		expect(requestKeys[1]).toBe(requestKeys[0]);
	});

	test("binds caption decisions to ephemeral opaque refs without persisting caption consent", async () => {
		const database = await seededDatabase(accountA, "owner");
		const published = recapWithEventAndFeedBodies();
		const mutations: Array<Record<string, unknown>> = [];
		const client = gatewayClient(async (input, init) => {
			if (!init?.body) {
				return jsonResponse(200, {
					externalConsent: recapExternalConsentWithCaption(),
					recap: published,
				});
			}
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			mutations.push(body);
			if (new URL(String(input)).pathname.endsWith("/external-grants")) {
				return jsonResponse(200, { decision: body.decision });
			}
			return jsonResponse(201, {
				shareLink: {
					createdAt: now,
					expiresAt: "2026-07-26T10:00:00.000Z",
					id: shareLinkId,
					recapVersion: 1,
				},
				token: shareToken,
			});
		});
		const controller = new EventRecapController(database, client);
		await controller.refresh(rootEventId);
		await controller.decideExternalBody(
			rootEventId,
			1,
			feedCaptionField,
			"author",
			"grant",
		);
		await controller.createExactBodyShareLink(rootEventId, 1, [
			feedCaptionField,
		]);

		expect(mutations[0]).toEqual({
			...feedCaptionField,
			authority: "author",
			decision: "grant",
			recapVersion: 1,
		});
		expect(mutations[1]).toEqual({
			fields: [feedCaptionField],
			projectionConsent: "exact-fields-reviewed-v1",
			recapVersion: 1,
		});
		const wire = JSON.stringify(mutations);
		expect(wire).not.toContain("Sonnenuntergang am langen Tisch");
		expect(wire).not.toContain("attachmentOrdinal");
		expect(wire).not.toContain("attachmentVersion");
		const stored = JSON.stringify(
			await database.all(
				`SELECT snapshot_json FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountA, rootEventId],
			),
		);
		expect(stored).not.toContain(captionFieldRef);
		expect(stored).not.toContain("Sonnenuntergang am langen Tisch");

		const restarted = new EventRecapController(database, client);
		await expect(
			restarted.decideExternalBody(
				rootEventId,
				1,
				feedCaptionField,
				"author",
				"grant",
			),
		).rejects.toBeInstanceOf(EventRecapUnavailableError);
		expect(mutations).toHaveLength(2);
	});

	test("adds only caller-authored live feed entries to recap generation", async () => {
		const database = await seededDatabase(accountA, "owner");
		for (const [id, actor, version, revision] of [
			["fed_recap_own", accountA, 2, "5"],
			["fed_recap_other", accountB, 4, "6"],
		] as const) {
			await database.run(
				`INSERT INTO feed_entries (
  account_user_id, id, root_event_id, event_id, parent_entry_id, actor_user_id,
  kind, payload_schema_version, payload_json, root_revision,
  created_root_revision, revision_ordinal, version, created_at, updated_at,
  deleted_at
) VALUES (?, ?, ?, ?, NULL, ?, 'message', 1, '{"text":"recap"}', ?, ?,
  NULL, ?, ?, ?, NULL)`,
				[
					accountA,
					id,
					rootEventId,
					rootEventId,
					actor,
					revision,
					revision,
					version,
					now,
					now,
				],
			);
		}
		let generatedBody: Record<string, unknown> | null = null;
		const client = gatewayClient(async (_input, init) => {
			generatedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return jsonResponse(201, { recap: recap("draft") });
		});
		await new EventRecapController(database, client).generate(rootEventId);
		const requestBody = generatedBody as unknown as Record<string, unknown>;
		expect(requestBody).toEqual({
			baseRevision: "7",
			sources: [
				{
					consentBasis: "event-publication",
					sourceId: rootEventId,
					sourceVersion: 3,
					type: "event",
				},
				{
					consentBasis: "source-author",
					sourceId: "fed_recap_own",
					sourceVersion: 2,
					type: "feedEntry",
				},
			],
		});
		expect(JSON.stringify(requestBody)).not.toContain("fed_recap_other");
	});
});

async function seededDatabase(
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
) {
	const database = new BunDatabase();
	await migrate(database);
	await seedRoot(database, accountUserId, role);
	return database;
}

async function seedRoot(
	database: SqlDatabase,
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
) {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id,
  snapshot_revision, authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, NULL, 'snapshot-recap', '7', '1', ?)`,
		[accountUserId, rootEventId, now],
	);
	await database.run(
		`INSERT INTO events (
  account_user_id, id, root_event_id, parent_event_id, kind, title, description,
  time_zone, starts_at, ends_at, sort_key, child_order_version,
  itinerary_order_version, status, version, created_at, updated_at, deleted_at
) VALUES (?, ?, ?, NULL, 'trip', 'Turkey Golf Tour', 'Crew trip',
  'Europe/Zurich', NULL, NULL, '1', '1', '1', 'published', 3, ?, ?, NULL)`,
		[accountUserId, rootEventId, rootEventId, now, now],
	);
	await database.run(
		`INSERT INTO memberships (
  account_user_id, root_event_id, member_user_id, role, status,
  version, created_at, updated_at
) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
		[accountUserId, rootEventId, accountUserId, role, now, now],
	);
}

function recap(
	state: "draft" | "published",
	overrides: Partial<EventRecap> = {},
): EventRecap {
	return {
		generatedAt: now,
		items: [
			{
				ordinal: 0,
				provenance: {
					consentBasis: "event-publication",
					sourceId: rootEventId,
					sourceRevision: "7",
					sourceType: "event",
					sourceVersion: 3,
					visibility: "members",
				},
				sourceBody: "Willkommensabend und erste Golfrunde.",
				sourceTitle: "Auftakt in Belek",
			},
		],
		lifecycleVersion: 1,
		publishedAt: state === "published" ? now : null,
		publishedVersion: state === "published" ? 1 : null,
		rootEventId,
		schemaVersion: 1,
		sourceRootRevision: "7",
		state,
		title: "Turkey Golf Tour",
		titleProvenance: {
			consentBasis: "event-publication",
			sourceId: rootEventId,
			sourceRevision: "7",
			sourceType: "event",
			sourceVersion: 3,
			visibility: "members",
		},
		version: 1,
		...overrides,
	};
}

function recapWithEventAndFeedBodies(
	overrides: Partial<EventRecap> = {},
): EventRecap {
	return recap("published", {
		items: [
			...recap("published").items,
			{
				ordinal: 1,
				provenance: {
					consentBasis: "source-author",
					sourceId: feedBodyField.sourceId,
					sourceRevision: "8",
					sourceType: "feedEntry",
					sourceVersion: feedBodyField.sourceVersion,
					visibility: "members",
				},
				sourceBody: "Gemeinsames Dinner am langen Tisch.",
				sourceTitle: "Crew-Dinner",
			},
		],
		publishedVersion: 1,
		...overrides,
	});
}

function recapExternalConsent(): NonNullable<
	EventRecapSnapshot["externalConsent"]
> {
	return {
		fields: [
			{
				actorCanDecide: ["manager"],
				authorDecision: "unknown",
				field: "body",
				managerDecision: "grant",
				ordinal: 0,
				requiredAuthorities: ["manager"],
			},
			{
				actorCanDecide: ["author"],
				authorDecision: "withdraw",
				field: "body",
				managerDecision: "grant",
				ordinal: 1,
				requiredAuthorities: ["author", "manager"],
			},
		],
	};
}

function recapExternalConsentWithCaption(): NonNullable<
	EventRecapSnapshot["externalConsent"]
> {
	const consent = recapExternalConsent();
	return {
		fields: [
			...consent.fields,
			{
				actorCanDecide: ["author"],
				attachmentOrdinal: 0,
				attachmentVersion: 1,
				authorDecision: "unknown",
				caption: "Sonnenuntergang am langen Tisch",
				field: "caption",
				fieldRef: captionFieldRef,
				managerDecision: "unknown",
				ordinal: 1,
				requiredAuthorities: ["author", "manager"],
			},
		],
	};
}

async function countExternalAttempts(database: SqlDatabase) {
	return (
		await database.first<{ count: number }>(
			"SELECT COUNT(*) AS count FROM recap_external_command_attempts",
		)
	)?.count;
}

async function seedPublishedRecap(database: SqlDatabase, value: EventRecap) {
	await database.run(
		`INSERT INTO authorized_recap_cache (
  account_user_id, root_event_id, recap_version, lifecycle_version,
  state, snapshot_json, refreshed_at
) VALUES (?, ?, ?, ?, 'published', ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  recap_version = excluded.recap_version,
  lifecycle_version = excluded.lifecycle_version,
  state = excluded.state,
  snapshot_json = excluded.snapshot_json,
  refreshed_at = excluded.refreshed_at`,
		[
			accountA,
			rootEventId,
			value.version,
			value.lifecycleVersion,
			JSON.stringify(value),
			now,
		],
	);
}

function gatewayClient(
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response> = async () => {
		throw new Error("Unexpected recap request");
	},
	sessionStore = new MemorySessionStore(),
) {
	let requestNumber = 0;
	return new GatewayClient({
		baseUrl: "https://gateway.test",
		fetch: (async (input, init) => {
			const response = await fetchImplementation(input, init);
			const requestId = new Headers(init?.headers).get("x-request-id");
			const headers = new Headers(response.headers);
			if (requestId) headers.set("x-request-id", requestId);
			return new Response(response.body, {
				headers,
				status: response.status,
				statusText: response.statusText,
			});
		}) as typeof fetch,
		idempotencyKey: () => "gateway-idempotency-stable",
		requestId: () => `request-${String(++requestNumber).padStart(8, "0")}`,
		sessionStore,
	});
}

function session(userId = accountA): Session {
	return {
		accessToken: `access-${userId}`,
		expiresInSeconds: 300,
		refreshToken: `refresh-${userId}`,
		tokenType: "Bearer",
		user: {
			email: "crew@example.com",
			id: userId,
			profile: {
				avatarUrl: null,
				displayName: "Crew",
				eventReminders: true,
				locale: "de-CH",
				productUpdates: false,
				reduceMotion: false,
				timeZone: "Europe/Zurich",
				updatedAt: now,
				version: 1,
			},
		},
	};
}

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "Content-Type": "application/json" },
		status,
	});
}

function errorResponse(status: number, code: string) {
	return jsonResponse(status, {
		error: {
			code,
			message: "Unavailable",
			requestId: "request-error-0001",
			retryable: false,
		},
	});
}
