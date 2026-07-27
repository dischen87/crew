import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GatewayClient,
	GatewayClientError,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor, SqlValue } from "../src/database.ts";
import {
	FeedbackAttachmentUploadError,
	type FeedbackAttachmentUploadInput,
	type FeedbackScreenshotState,
	FeedbackScreenshotStore,
	FeedbackSubmissionAccountChangedError,
	FeedbackSubmissionController,
	type FeedbackSubmissionInput,
	LocalAttachmentStore,
	listFeedbackScreenshotFileKeysForPurge,
	MobileDataStore,
	migrate,
	migrations,
} from "../src/index.ts";

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;

	constructor(path = ":memory:") {
		this.sqlite = new Database(path, { create: true });
	}

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

	close(): void {
		this.sqlite.close();
	}
}

type FeedbackClient = Pick<
	GatewayClient,
	"assertSessionSubject" | "requestAsUser" | "sessionSubject"
>;

interface Attempt {
	operationId: string;
	request: {
		body?: unknown;
		headers?: Record<string, string>;
		path?: Record<string, string>;
	};
}

const accountA = `usr_${"a".repeat(32)}`;
const accountB = `usr_${"b".repeat(32)}`;
const rootEventId = "evt_feedback_trip";
const baseTime = Date.parse("2026-07-19T12:00:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("durable feedback screenshot delivery", () => {
	test("builds the complete account-private media logout allow-list without another account", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		await seedRoot(database, accountB);
		const attachmentStore = new LocalAttachmentStore(database);
		const accountAMediaKey = `${"a".repeat(64)}.jpg`;
		const accountBMediaKey = `${"b".repeat(64)}.webp`;
		await attachmentStore.retain({
			accountUserId: accountA,
			attachmentId: "att_logout_account_a",
			rootEventId,
			targetEntryId: "fed_logout_account_a",
			retainedFileKey: accountAMediaKey,
			contentType: "image/jpeg",
			byteCount: 2_048,
			sha256: "a".repeat(64),
			pixelWidth: 1_200,
			pixelHeight: 800,
			wasNormalized: true,
			retainedAt: new Date(baseTime).toISOString(),
		});
		await attachmentStore.retain({
			accountUserId: accountB,
			attachmentId: "att_logout_account_b",
			rootEventId,
			targetEntryId: "fed_logout_account_b",
			retainedFileKey: accountBMediaKey,
			contentType: "image/webp",
			byteCount: 2_048,
			sha256: "b".repeat(64),
			pixelWidth: 800,
			pixelHeight: 1_200,
			wasNormalized: true,
			retainedAt: new Date(baseTime).toISOString(),
		});
		const states = [
			"retained",
			"consented",
			"prepared",
			"uploaded",
			"committed",
			"attention",
			"omitted",
		] as const;
		for (const [index, state] of states.entries()) {
			await seedScreenshotState(database, accountA, state, index);
		}
		await seedScreenshotState(database, accountA, "retained", 7, 0);
		await seedScreenshotState(database, accountB, "committed", 0, 8);

		const screenshotKeys = states.map(
			(_, index) => `${`${index}`.repeat(64)}.png`,
		);
		expect(
			await listFeedbackScreenshotFileKeysForPurge(database, accountA),
		).toEqual(screenshotKeys);
		const accountALogoutKeys = [
			...new Set([
				...(await attachmentStore.listRetainedFileKeys(accountA)),
				...(await listFeedbackScreenshotFileKeysForPurge(database, accountA)),
			]),
		].sort();
		expect(accountALogoutKeys).toEqual(
			[accountAMediaKey, ...screenshotKeys].sort(),
		);
		expect(accountALogoutKeys).not.toContain(accountBMediaKey);
		expect(accountALogoutKeys).not.toContain(`${"8".repeat(64)}.png`);
		database.close();
	});

	test("returns no screenshot files when the account has none", async () => {
		const database = new BunDatabase();
		await migrate(database);
		expect(
			await listFeedbackScreenshotFileKeysForPurge(database, accountA),
		).toEqual([]);
		database.close();
	});

	test("rejects an invalid screenshot purge account", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await expect(
			listFeedbackScreenshotFileKeysForPurge(database, "usr_invalid"),
		).rejects.toThrow("Invalid account ID");
		database.close();
	});

	test("upgrades populated v18 feedback losslessly and backfills its root scope", async () => {
		const database = new BunDatabase();
		await migrateThrough(database, 18);
		await seedRoot(database, accountA);
		const command = JSON.stringify({
			id: "fbk_v18_pending",
			title: "Before v19",
			body: "This durable command must survive migration.",
			visibility: "private",
			rootEventId,
			eventId: null,
			screenKey: null,
			diagnostics: null,
			attachmentIds: [],
		});
		await database.run(
			`INSERT INTO feedback_submissions (
  account_user_id, feedback_id, command_json, command_fingerprint,
  idempotency_key, state, created_at, updated_at
) VALUES (?, 'fbk_v18_pending', ?, ?, 'feedback-fbk_v18_pending',
  'pending', ?, ?)`,
			[
				accountA,
				command,
				"a".repeat(64),
				new Date(baseTime).toISOString(),
				new Date(baseTime).toISOString(),
			],
		);

		await migrate(database);
		expect(
			await database.first<{
				command_json: string;
				root_event_id: string | null;
				screenshot_attachment_id: string | null;
			}>(
				`SELECT command_json, root_event_id, screenshot_attachment_id
FROM feedback_submissions WHERE feedback_id = 'fbk_v18_pending'`,
			),
		).toEqual({
			command_json: command,
			root_event_id: rootEventId,
			screenshot_attachment_id: null,
		});
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		await expect(
			database.run(
				"UPDATE feedback_submissions SET root_event_id = 'evt_other'",
			),
		).rejects.toThrow("feedback root scope is immutable");
		database.close();
	});

	test("restarts between verification attempts and creates feedback only after exact commit", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-feedback-media-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "account.sqlite");
		const active = { value: accountA };
		const clock = { value: baseTime };
		const attempts: Attempt[] = [];
		const uploads: FeedbackAttachmentUploadInput[] = [];
		let finalizeAttempts = 0;

		let database = new BunDatabase(path);
		await migrate(database);
		await seedRoot(database, accountA);
		const screenshot = screenshotInput("fbk_restart", "att_restart");
		await new FeedbackScreenshotStore(database).retain(screenshot);
		expect(
			await new LocalAttachmentStore(database).listRetainedFileKeys(accountA),
		).toEqual([screenshot.retainedFileKey]);
		let controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsPrepare") {
					return prepared(screenshot, "upl_restart", clock.value + 60_000);
				}
				if (attempt.operationId === "eventAttachmentUploadsFinalize") {
					finalizeAttempts += 1;
					return finalizeAttempts === 1
						? pending("upl_restart")
						: committed(screenshot);
				}
				return feedbackCreated(screenshot.feedbackId);
			}),
			active,
			clock,
			async (input) => {
				uploads.push(input);
			},
		);
		await controller.enqueue(
			accountA,
			feedbackInput(screenshot.feedbackId, screenshot.attachmentId),
		);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			attempts: 1,
			failure: "service_unavailable",
			state: "pending",
		});
		expect(attempts.map(({ operationId }) => operationId)).toEqual([
			"eventAttachmentUploadsPrepare",
			"eventAttachmentUploadsFinalize",
		]);
		expect(uploads).toHaveLength(1);
		expect(
			await new FeedbackScreenshotStore(database).get(
				accountA,
				screenshot.feedbackId,
			),
		).toMatchObject({
			failure: "verification_pending",
			state: "uploaded",
		});
		database.close();

		clock.value += 2_000;
		database = new BunDatabase(path);
		await migrate(database);
		controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsFinalize") {
					return committed(screenshot);
				}
				if (attempt.operationId === "feedbackCreate") {
					return feedbackCreated(screenshot.feedbackId);
				}
				throw new Error("prepare must not replay after durable upload");
			}),
			active,
			clock,
			async (input) => {
				uploads.push(input);
			},
		);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			attempts: 2,
			state: "delivered",
		});
		const feedbackAttempt = required(
			attempts.find(({ operationId }) => operationId === "feedbackCreate"),
		);
		expect(feedbackAttempt.request.body).toMatchObject({
			attachmentIds: [screenshot.attachmentId],
			id: screenshot.feedbackId,
		});
		expect(
			attempts
				.filter(
					({ operationId }) => operationId === "eventAttachmentUploadsFinalize",
				)
				.map(({ request }) => request.headers?.["idempotency-key"]),
		).toEqual([
			`fbatt-f-1-${screenshot.attachmentId}`,
			`fbatt-f-1-${screenshot.attachmentId}`,
		]);
		expect(
			await new FeedbackScreenshotStore(database).listRetainedFileKeys(
				accountA,
			),
		).toEqual([]);
		expect(
			await new LocalAttachmentStore(database).listRetainedFileKeys(accountA),
		).toEqual([]);
		const durable = JSON.stringify(
			await database.all("SELECT * FROM feedback_screenshot_attachments"),
		);
		expect(durable).not.toContain("uploads.example.test");
		expect(durable).not.toContain("signed-secret");
		expect(
			await new FeedbackScreenshotStore(database).get(
				accountA,
				screenshot.feedbackId,
			),
		).toMatchObject({
			feedbackSendStartedAt: expect.any(String),
			state: "committed",
		});
		database.close();
	});

	test("requires an explicit text-only fallback after a missing retained file", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const active = { value: accountA };
		const clock = { value: baseTime };
		const screenshot = screenshotInput("fbk_missing", "att_missing");
		const attempts: Attempt[] = [];
		await new FeedbackScreenshotStore(database).retain(screenshot);
		const controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsPrepare") {
					return prepared(screenshot, "upl_missing", clock.value + 60_000);
				}
				if (attempt.operationId === "feedbackCreate") {
					return feedbackCreated(screenshot.feedbackId);
				}
				throw new Error("finalize must not run without local bytes");
			}),
			active,
			clock,
			async () => {
				throw new FeedbackAttachmentUploadError("missing_file");
			},
		);
		await controller.enqueue(
			accountA,
			feedbackInput(screenshot.feedbackId, screenshot.attachmentId),
		);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			failure: "invalid",
			state: "attention",
		});
		expect(attempts.map(({ operationId }) => operationId)).toEqual([
			"eventAttachmentUploadsPrepare",
		]);
		expect(
			await new FeedbackScreenshotStore(database).get(
				accountA,
				screenshot.feedbackId,
			),
		).toMatchObject({ failure: "attachment_missing", state: "attention" });

		expect(
			await controller.sendWithoutScreenshot(accountA, screenshot.feedbackId),
		).toMatchObject({ state: "pending" });
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
		});
		const feedbackAttempt = required(
			attempts.find(({ operationId }) => operationId === "feedbackCreate"),
		);
		expect(feedbackAttempt.request.body).toMatchObject({ attachmentIds: [] });
		expect(
			await new FeedbackScreenshotStore(database).get(
				accountA,
				screenshot.feedbackId,
			),
		).toMatchObject({
			feedbackSendStartedAt: expect.any(String),
			state: "omitted",
		});
		await expect(
			controller.sendWithoutScreenshot(accountA, screenshot.feedbackId),
		).rejects.toThrow("can no longer change");
		database.close();
	});

	test("never silently downgrades a durably bound screenshot when its row disappears", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const active = { value: accountA };
		const screenshot = screenshotInput("fbk_missing_row", "att_missing_row");
		const attempts: Attempt[] = [];
		await new FeedbackScreenshotStore(database).retain(screenshot);
		const controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				return feedbackCreated(screenshot.feedbackId);
			}),
			active,
			{ value: baseTime },
		);
		await controller.enqueue(
			accountA,
			feedbackInput(screenshot.feedbackId, screenshot.attachmentId),
		);
		await database.run(
			"DELETE FROM feedback_screenshot_attachments WHERE feedback_id = ?",
			[screenshot.feedbackId],
		);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			failure: "invalid",
			state: "attention",
		});
		expect(attempts).toEqual([]);
		database.close();
	});

	test("replays upload after an account switch without committing local state", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const active = { value: accountA };
		const clock = { value: baseTime };
		const screenshot = screenshotInput("fbk_switch", "att_switch");
		const attempts: Attempt[] = [];
		let uploadCount = 0;
		await new FeedbackScreenshotStore(database).retain(screenshot);
		let controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsPrepare") {
					return prepared(screenshot, "upl_switch", clock.value + 60_000);
				}
				throw new Error("account switch must stop later requests");
			}),
			active,
			clock,
			async () => {
				uploadCount += 1;
				active.value = accountB;
			},
		);
		await controller.enqueue(
			accountA,
			feedbackInput(screenshot.feedbackId, screenshot.attachmentId),
		);
		await expect(controller.drain(accountA)).rejects.toBeInstanceOf(
			FeedbackSubmissionAccountChangedError,
		);
		expect(
			await database.first<{ attempts: number; state: string }>(
				"SELECT state, attempts FROM feedback_submissions",
			),
		).toEqual({ attempts: 0, state: "sending" });
		expect(
			await new FeedbackScreenshotStore(database).get(
				accountA,
				screenshot.feedbackId,
			),
		).toMatchObject({ feedbackSendStartedAt: null, state: "prepared" });

		active.value = accountA;
		clock.value += 2 * 60 * 1000 + 1;
		controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsPrepare") {
					return prepared(screenshot, "upl_switch", clock.value + 60_000);
				}
				if (attempt.operationId === "eventAttachmentUploadsFinalize") {
					return committed(screenshot);
				}
				return feedbackCreated(screenshot.feedbackId);
			}),
			active,
			clock,
			async () => {
				uploadCount += 1;
			},
		);
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
		});
		expect(uploadCount).toBe(2);
		expect(
			attempts
				.filter(
					({ operationId }) => operationId === "eventAttachmentUploadsPrepare",
				)
				.map(({ request }) => request.headers?.["idempotency-key"]),
		).toEqual([
			`fbatt-p-1-${screenshot.attachmentId}`,
			`fbatt-p-1-${screenshot.attachmentId}`,
		]);
		database.close();
	});

	test("rotates the prepare generation only after the server expires the old upload", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const active = { value: accountA };
		const clock = { value: baseTime };
		const screenshot = screenshotInput("fbk_expired", "att_expired");
		const attempts: Attempt[] = [];
		let generation = 1;
		let uploads = 0;
		await new FeedbackScreenshotStore(database).retain(screenshot);
		const controller = controllerFor(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (attempt.operationId === "eventAttachmentUploadsPrepare") {
					return prepared(
						screenshot,
						generation === 1 ? "upl_expired_one" : "upl_expired_two",
						generation === 1 ? clock.value - 1 : clock.value + 60_000,
					);
				}
				if (
					attempt.operationId === "eventAttachmentUploadsFinalize" &&
					generation === 1
				) {
					generation = 2;
					throw uploadExpired();
				}
				if (attempt.operationId === "eventAttachmentUploadsFinalize") {
					return committed(screenshot);
				}
				return feedbackCreated(screenshot.feedbackId);
			}),
			active,
			clock,
			async () => {
				uploads += 1;
			},
		);
		await controller.enqueue(
			accountA,
			feedbackInput(screenshot.feedbackId, screenshot.attachmentId),
		);
		expect((await controller.drain(accountA))[0]).toMatchObject({
			failure: "service_unavailable",
			state: "pending",
		});
		expect(
			await database.first<{
				state: string;
				upload_generation: number;
				upload_id: string | null;
			}>(
				"SELECT state, upload_generation, upload_id FROM feedback_screenshot_attachments",
			),
		).toEqual({ state: "consented", upload_generation: 2, upload_id: null });
		expect(uploads).toBe(0);

		clock.value += 2_000;
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
		});
		expect(uploads).toBe(1);
		expect(
			attempts
				.filter(
					({ operationId }) => operationId === "eventAttachmentUploadsPrepare",
				)
				.map(({ request }) => request.headers?.["idempotency-key"]),
		).toEqual([
			`fbatt-p-1-${screenshot.attachmentId}`,
			`fbatt-p-2-${screenshot.attachmentId}`,
		]);
		database.close();
	});

	test("requires explicit consent or discard and purges root-scoped private state", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const active = { value: accountA };
		const store = new FeedbackScreenshotStore(database);
		const screenshot = screenshotInput("fbk_choice", "att_choice");
		await store.retain(screenshot);
		const controller = controllerFor(database, null, active, {
			value: baseTime,
		});
		await expect(
			controller.enqueue(accountA, feedbackInput(screenshot.feedbackId)),
		).rejects.toThrow("explicit consent or discard");
		expect(await store.discard(accountA, screenshot.feedbackId)).toBe(true);
		expect(
			await controller.enqueue(accountA, feedbackInput(screenshot.feedbackId)),
		).toMatchObject({ state: "pending" });

		const second = screenshotInput("fbk_purge", "att_purge");
		await store.retain(second);
		await controller.enqueue(
			accountA,
			feedbackInput(second.feedbackId, second.attachmentId),
		);
		expect(await store.listRetainedFileKeys(accountA)).toEqual([
			second.retainedFileKey,
		]);
		await new MobileDataStore(database).clearRootData(accountA, rootEventId);
		expect(await store.get(accountA, second.feedbackId)).toBeNull();
		expect(await store.listRetainedFileKeys(accountA)).toEqual([]);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM feedback_submissions",
			),
		).toEqual({ count: 0 });
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});
});

function controllerFor(
	database: SqlDatabase,
	feedbackClient: FeedbackClient | null,
	active: { value: string },
	clock: { value: number },
	upload?: (input: FeedbackAttachmentUploadInput) => Promise<void>,
) {
	let sequence = 0;
	return new FeedbackSubmissionController(database, feedbackClient, {
		activeAccountUserId: () => active.value,
		attachmentUploadTransport: upload ? { upload } : null,
		now: () => new Date(clock.value),
		randomUUID: () =>
			`00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
	});
}

function client(
	accountUserId: string,
	handler: (attempt: Attempt) => Promise<{
		data: unknown;
		requestId: string;
		status: number;
	}>,
): FeedbackClient {
	const subject = Object.freeze({
		userId: accountUserId,
	}) as GatewaySessionSubject;
	return {
		async sessionSubject() {
			return subject;
		},
		async assertSessionSubject(candidate: GatewaySessionSubject) {
			if (candidate !== subject) throw sessionChanged();
		},
		async requestAsUser(
			_subject: GatewaySessionSubject,
			operationId: string,
			request: Attempt["request"],
		) {
			return handler({ operationId, request });
		},
	} as unknown as FeedbackClient;
}

function prepared(
	screenshot: ReturnType<typeof screenshotInput>,
	uploadId: string,
	expiresAt: number,
) {
	const expiry = new Date(expiresAt).toISOString();
	return Promise.resolve({
		data: {
			grant: {
				expiresAt: expiry,
				fields: { key: "signed-secret" },
				method: "POST",
				url: "https://uploads.example.test/private",
			},
			upload: {
				attachmentId: screenshot.attachmentId,
				byteCount: screenshot.byteCount,
				contentType: screenshot.contentType,
				createdAt: new Date(baseTime).toISOString(),
				expiresAt: expiry,
				id: uploadId,
				rootEventId: screenshot.rootEventId,
				sha256: screenshot.sha256,
				state: "prepared",
				target: { kind: "feedback", feedbackId: screenshot.feedbackId },
				targetEntryId: null,
			},
		},
		requestId: "req_prepare",
		status: 201,
	});
}

function pending(uploadId: string) {
	return Promise.resolve({
		data: {
			uploadId,
			verification: { retryable: true, state: "pending" },
		},
		requestId: "req_finalize_pending",
		status: 202,
	});
}

function committed(screenshot: ReturnType<typeof screenshotInput>) {
	return Promise.resolve({
		data: {
			attachment: {
				byteCount: screenshot.byteCount,
				caption: null,
				contentType: screenshot.contentType,
				createdAt: new Date(baseTime).toISOString(),
				id: screenshot.attachmentId,
				integrityStatus: "integrity_verified",
				rootEventId: screenshot.rootEventId,
				rootRevision: "1",
				sha256: screenshot.sha256,
				target: { kind: "feedback", feedbackId: screenshot.feedbackId },
				targetEntryId: null,
				version: 1,
			},
		},
		requestId: "req_finalize",
		status: 200,
	});
}

function feedbackCreated(feedbackId: string) {
	return Promise.resolve({
		data: { feedback: { id: feedbackId } },
		requestId: "req_feedback",
		status: 201,
	});
}

function uploadExpired(): GatewayClientError {
	return new GatewayClientError({
		operationId: "eventAttachmentUploadsFinalize",
		status: 409,
		requestId: "req_upload_expired",
		code: "UPLOAD_EXPIRED",
		retryable: false,
		retryAfterSeconds: null,
	});
}

function sessionChanged(): GatewayClientError {
	return new GatewayClientError({
		operationId: "feedbackCreate",
		status: null,
		requestId: "req_session_changed",
		code: "session_changed",
		retryable: false,
		retryAfterSeconds: null,
	});
}

function screenshotInput(feedbackId: string, attachmentId: string) {
	const sha256 = "c".repeat(64);
	return {
		accountUserId: accountA,
		feedbackId,
		rootEventId,
		attachmentId,
		retainedFileKey: `${sha256}.png`,
		contentType: "image/png" as const,
		byteCount: 12_345,
		sha256,
		pixelWidth: 1179,
		pixelHeight: 2048,
		wasNormalized: true as const,
		retainedAt: new Date(baseTime).toISOString(),
	};
}

function feedbackInput(
	id: string,
	attachmentId?: string,
): FeedbackSubmissionInput {
	return {
		id,
		title: "Screenshot feedback",
		body: "The source screen has a visible issue.",
		visibility: "private",
		rootEventId,
		eventId: null,
		screenKey: "event/detail",
		diagnostics: null,
		...(attachmentId === undefined ? {} : { attachmentId }),
	};
}

async function seedRoot(database: SqlDatabase, accountUserId: string) {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, authorization_scope_version
) VALUES (?, ?, 1)`,
		[accountUserId, rootEventId],
	);
}

async function seedScreenshotState(
	database: SqlDatabase,
	accountUserId: string,
	state: FeedbackScreenshotState,
	index: number,
	digestIndex = index,
) {
	const digest = String(digestIndex).repeat(64);
	const suffix = `${accountUserId.at(-1)}_${index}`;
	await new FeedbackScreenshotStore(database).retain({
		...screenshotInput(`fbk_logout_${suffix}`, `att_logout_${suffix}`),
		accountUserId,
		retainedFileKey: `${digest}.png`,
		sha256: digest,
	});
	if (state === "retained") return;
	await database.run(
		`UPDATE feedback_screenshot_attachments
SET state = ?, consented_at = ?, upload_id = ?, committed_at = ?, omitted_at = ?
WHERE account_user_id = ? AND feedback_id = ?`,
		[
			state,
			new Date(baseTime).toISOString(),
			["prepared", "uploaded", "committed"].includes(state)
				? `upl_logout_${suffix}`
				: null,
			state === "committed" ? new Date(baseTime).toISOString() : null,
			state === "omitted" ? new Date(baseTime).toISOString() : null,
			accountUserId,
			`fbk_logout_${suffix}`,
		],
	);
}

async function migrateThrough(database: SqlDatabase, maximumVersion: number) {
	await database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
	await database.exec(`
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
	for (const migration of migrations) {
		if (migration.version > maximumVersion) break;
		await database.transaction(async (transaction) => {
			await transaction.exec(migration.sql);
			for (const statement of migration.copyStatements ?? []) {
				await transaction.run(statement);
			}
			if (migration.finalizeSql) {
				await transaction.exec(migration.finalizeSql);
			}
			await transaction.run(
				"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
				[migration.version, migration.name],
			);
		});
	}
}

function required<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("test value missing");
	return value;
}
