import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GatewayClient,
	GatewayClientError,
	type GatewayErrorCode,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor, SqlValue } from "../src/database.ts";
import {
	FeedbackScreenshotStore,
	FeedbackSubmissionAccountChangedError,
	FeedbackSubmissionAuthenticationError,
	FeedbackSubmissionController,
	type FeedbackSubmissionDiagnostics,
	type FeedbackSubmissionInput,
	MobileDataStore,
	migrate,
	sha256Hex,
} from "../src/index.ts";

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;
	afterRun: ((sql: string) => void) | null = null;
	transactionCount = 0;

	constructor(path = ":memory:") {
		this.sqlite = new Database(path, { create: true });
	}

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		this.sqlite.query(sql).run(...parameters);
		this.afterRun?.(sql);
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
		this.transactionCount += 1;
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
	body: unknown;
	key: string;
}

const accountA = `usr_${"a".repeat(32)}`;
const accountB = `usr_${"b".repeat(32)}`;
const baseTime = Date.parse("2026-07-19T12:00:00.000Z");
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("durable feedback submissions", () => {
	test("exposes read-only domain-separated evidence without local secrets", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const controller = testController(database, null, active);
		const rootEventId = "evt_trip";
		const feedbackId = "fbk_private_evidence";
		const attachmentId = "att_private_evidence";
		const screenshotSha = "4".repeat(64);
		await database.run(
			`INSERT INTO root_sync_state (
  account_user_id, root_event_id, authorization_scope_version
) VALUES (?, ?, 1)`,
			[accountA, rootEventId],
		);
		await new FeedbackScreenshotStore(database).retain({
			accountUserId: accountA,
			feedbackId,
			rootEventId,
			attachmentId,
			retainedFileKey: `${screenshotSha}.png`,
			contentType: "image/png",
			byteCount: 256,
			sha256: screenshotSha,
			pixelWidth: 16,
			pixelHeight: 16,
			wasNormalized: true,
			retainedAt: new Date(baseTime).toISOString(),
		});
		await controller.enqueue(
			accountA,
			feedbackInput(feedbackId, { attachmentId, rootEventId }),
		);
		await database.run(
			`INSERT INTO root_sync_state (
  account_user_id, root_event_id, authorization_scope_version
) VALUES (?, ?, 1)`,
			[accountA, "evt_foreign"],
		);
		await controller.enqueue(
			accountA,
			feedbackInput("fbk_foreign_evidence", {
				eventId: null,
				rootEventId: "evt_foreign",
			}),
		);
		const stored = required(
			await database.first<{
				command_fingerprint: string;
				idempotency_key: string;
			}>(
				`SELECT command_fingerprint, idempotency_key
FROM feedback_submissions WHERE feedback_id = ?`,
				[feedbackId],
			),
		);
		database.afterRun = () => {
			throw new Error("Evidence must be SELECT-only");
		};
		const transactionCount = database.transactionCount;
		const evidence = await controller.readEvidence(accountA, rootEventId);
		database.afterRun = null;

		expect(database.transactionCount).toBe(transactionCount + 1);
		expect(evidence).toEqual({
			pendingCount: 1,
			sendingCount: 0,
			attentionCount: 0,
			deliveredCount: 0,
			truncated: false,
			rows: [
				{
					state: "pending",
					screenshotState: "consented",
					submissionFingerprint: await sha256Hex(
						`crew.feedback.command.evidence.v1\u0000${stored.command_fingerprint}`,
					),
					idempotencyFingerprint: await sha256Hex(
						`crew.feedback.idempotency.evidence.v1\u0000${stored.idempotency_key}`,
					),
					screenshotFingerprint: await sha256Hex(
						`crew.feedback.screenshot.evidence.v1\u0000image/png\u0000256\u0000${screenshotSha}`,
					),
					commandFingerprintMatches: true,
					screenshotBindingMatches: true,
					screenshotMetadataMatches: true,
				},
			],
		});
		const serialized = JSON.stringify(evidence);
		for (const secret of [
			accountA,
			rootEventId,
			"evt_foreign",
			feedbackId,
			"fbk_foreign_evidence",
			attachmentId,
			"Feedback title",
			"Feedback body",
			stored.command_fingerprint,
			stored.idempotency_key,
			`${screenshotSha}.png`,
			screenshotSha,
			"token-private",
		]) {
			expect(serialized).not.toContain(secret);
		}
		active.value = accountB;
		await expect(
			controller.readEvidence(accountA, rootEventId),
		).rejects.toBeInstanceOf(FeedbackSubmissionAccountChangedError);
		database.close();
	});

	test("conceals mismatched screenshot rows instead of fingerprinting foreign metadata", async () => {
		const database = new BunDatabase();
		await migrate(database);
		for (const rootEventId of ["evt_trip", "evt_foreign"]) {
			await database.run(
				`INSERT INTO root_sync_state (
  account_user_id, root_event_id, authorization_scope_version
) VALUES (?, ?, 1)`,
				[accountA, rootEventId],
			);
		}
		const feedbackId = "fbk_mismatched_screenshot";
		const foreignSha = "9".repeat(64);
		await new FeedbackScreenshotStore(database).retain({
			accountUserId: accountA,
			feedbackId,
			rootEventId: "evt_foreign",
			attachmentId: "att_foreign",
			retainedFileKey: `${foreignSha}.png`,
			contentType: "image/png",
			byteCount: 512,
			sha256: foreignSha,
			pixelWidth: 16,
			pixelHeight: 16,
			wasNormalized: true,
			retainedAt: new Date(baseTime).toISOString(),
		});
		await insertEvidenceSubmission(database, {
			createdAt: new Date(baseTime).toISOString(),
			feedbackId,
			marker: "private-mismatched-command",
			rootEventId: "evt_trip",
			screenshotAttachmentId: "att_expected",
			state: "pending",
		});

		const evidence = await testController(database, null, {
			value: accountA,
		}).readEvidence(accountA, "evt_trip");

		expect(evidence.rows).toHaveLength(1);
		expect(evidence.rows[0]).toMatchObject({
			state: "pending",
			screenshotState: null,
			screenshotFingerprint: null,
			screenshotBindingMatches: false,
			screenshotMetadataMatches: null,
		});
		const serialized = JSON.stringify(evidence);
		for (const secret of [
			"evt_foreign",
			"att_foreign",
			`${foreignSha}.png`,
			foreignSha,
		]) {
			expect(serialized).not.toContain(secret);
		}
		database.close();
	});

	test("caps newest-first evidence after prioritizing actionable states", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const rootEventId = "evt_evidence_cap";
		await insertEvidenceSubmission(database, {
			createdAt: new Date(baseTime).toISOString(),
			feedbackId: "fbk_priority_attention",
			marker: "attention",
			rootEventId,
			state: "attention",
		});
		await insertEvidenceSubmission(database, {
			createdAt: new Date(baseTime + 1).toISOString(),
			feedbackId: "fbk_priority_sending",
			marker: "sending",
			rootEventId,
			state: "sending",
		});
		for (let index = 1; index <= 100; index += 1) {
			await insertEvidenceSubmission(database, {
				createdAt: new Date(baseTime + index * 1_000).toISOString(),
				feedbackId: `fbk_pending_${String(index).padStart(3, "0")}`,
				marker: `pending-${index}`,
				rootEventId,
				state: "pending",
			});
		}
		await insertEvidenceSubmission(database, {
			createdAt: new Date(baseTime + 200_000).toISOString(),
			feedbackId: "fbk_priority_delivered",
			marker: "delivered",
			rootEventId,
			state: "delivered",
		});

		const evidence = await testController(database, null, {
			value: accountA,
		}).readEvidence(accountA, rootEventId);

		expect(evidence).toMatchObject({
			pendingCount: 100,
			sendingCount: 1,
			attentionCount: 1,
			deliveredCount: 1,
			truncated: true,
		});
		expect(evidence.rows).toHaveLength(100);
		expect(evidence.rows.slice(0, 2).map(({ state }) => state)).toEqual([
			"attention",
			"sending",
		]);
		expect(
			evidence.rows.slice(2).every(({ state }) => state === "pending"),
		).toBe(true);
		expect(evidence.rows[2]?.submissionFingerprint).toBe(
			await evidenceSubmissionFingerprint("pending-100"),
		);
		expect(evidence.rows[99]?.submissionFingerprint).toBe(
			await evidenceSubmissionFingerprint("pending-3"),
		);
		database.close();
	});

	test("binds one feedback identity to canonical text and allow-listed diagnostics", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const controller = testController(database, null, active);
		const unsafeDiagnostics = {
			appVersion: " 1.4.0 ",
			buildNumber: " 82 ",
			deviceModel: "serial-like-free-form-value",
			email: "private@example.test",
			locale: " de-CH ",
			osVersion: " 26.2 ",
			platform: "ios",
			rawError: "Bearer secret-token",
			requestBody: { password: "secret" },
		} as unknown as FeedbackSubmissionDiagnostics;
		const input = feedbackInput("fbk_duplicate", {
			diagnostics: unsafeDiagnostics,
		});

		expect(await controller.enqueue(accountA, input)).toMatchObject({
			feedbackId: input.id,
			state: "pending",
			attempts: 0,
			failure: null,
		});
		expect(await controller.enqueue(accountA, input)).toMatchObject({
			feedbackId: input.id,
			state: "pending",
		});
		await expect(
			controller.enqueue(accountA, { ...input, body: "Changed duplicate" }),
		).rejects.toThrow("already bound to different content");

		const row = await database.first<{
			command_json: string;
			idempotency_key: string;
		}>("SELECT command_json, idempotency_key FROM feedback_submissions");
		expect(JSON.parse(required(row).command_json)).toEqual({
			id: "fbk_duplicate",
			title: "Feedback title",
			body: "Feedback body",
			visibility: "private",
			rootEventId: "evt_trip",
			eventId: "evt_day",
			screenKey: "event/detail",
			diagnostics: {
				appVersion: "1.4.0",
				buildNumber: "82",
				locale: "de-CH",
				osVersion: "26.2",
				platform: "ios",
			},
			attachmentIds: [],
		});
		expect(row?.idempotency_key).toBe("feedback-fbk_duplicate");
		expect(row?.command_json).not.toContain("private@example.test");
		expect(row?.command_json).not.toContain("secret-token");
		expect(row?.command_json).not.toContain("deviceModel");
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM feedback_submissions",
			),
		).toEqual({ count: 1 });
		database.close();
	});

	test("rejects secret, PII, request, error, and device-shaped diagnostic values", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const controller = testController(database, null, active);
		const invalidDiagnostics = [
			{ locale: "private@example.test" },
			{ appVersion: "eyJhbGciOiJIUzI1NiJ9.secret.signature" },
			{ osVersion: '{"accessToken":"secret"}' },
			{ buildNumber: "Error: request failed" },
			{ buildNumber: "iPhone16,1" },
		] as const;

		for (const [index, diagnostics] of invalidDiagnostics.entries()) {
			await expect(
				controller.enqueue(
					accountA,
					feedbackInput(`fbk_unsafe_diagnostic_${index}`, {
						diagnostics,
					}),
				),
			).rejects.toThrow("Invalid");
		}
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM feedback_submissions",
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("persists and delivers with the default hash when Web Crypto digest is absent", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const originalCrypto = globalThis.crypto;
		Object.defineProperty(globalThis, "crypto", {
			configurable: true,
			value: { randomUUID: () => "unused-by-the-test-controller" },
			writable: true,
		});
		try {
			const active = { value: accountA };
			const input = feedbackInput("fbk_no_subtle");
			const controller = testController(
				database,
				client(accountA, async () => input.id),
				active,
			);
			await controller.enqueue(accountA, input);
			const persisted = required(
				await database.first<{
					command_fingerprint: string;
					command_json: string;
				}>(
					"SELECT command_fingerprint, command_json FROM feedback_submissions",
				),
			);
			expect(persisted.command_fingerprint).toBe(
				new Bun.CryptoHasher("sha256")
					.update(persisted.command_json)
					.digest("hex"),
			);
			expect((await controller.drain(accountA))[0]).toMatchObject({
				state: "delivered",
			});
		} finally {
			Object.defineProperty(globalThis, "crypto", {
				configurable: true,
				value: originalCrypto,
				writable: true,
			});
			database.close();
		}
	});

	test("survives an offline database restart and delivers through generated feedbackCreate", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-feedback-offline-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "account.sqlite");
		const active = { value: accountA };
		const input = feedbackInput("fbk_offline_restart");

		let database = new BunDatabase(path);
		await migrate(database);
		await testController(database, null, active).enqueue(accountA, input);
		database.close();

		const attempts: Attempt[] = [];
		database = new BunDatabase(path);
		await migrate(database);
		const controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				return input.id;
			}),
			active,
		);
		expect((await controller.list(accountA))[0]).toMatchObject({
			feedbackId: input.id,
			state: "pending",
		});
		expect((await controller.drain(accountA))[0]).toMatchObject({
			feedbackId: input.id,
			state: "delivered",
			attempts: 1,
		});
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({
			operationId: "feedbackCreate",
			key: `feedback-${input.id}`,
		});
		expect(
			await database.first<{
				command_json: string | null;
				command_fingerprint: string;
			}>("SELECT command_json, command_fingerprint FROM feedback_submissions"),
		).toMatchObject({
			command_json: null,
			command_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(await controller.enqueue(accountA, input)).toMatchObject({
			state: "delivered",
		});
		await expect(
			controller.enqueue(accountA, { ...input, title: "Different title" }),
		).rejects.toThrow("already bound to different content");
		database.close();
	});

	test("replays the exact body and idempotency key after a lost response and restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-feedback-replay-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "account.sqlite");
		const active = { value: accountA };
		const clock = { value: baseTime };
		const input = feedbackInput("fbk_lost_response");
		const attempts: Attempt[] = [];

		let database = new BunDatabase(path);
		await migrate(database);
		let controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				throw new Error("connection lost after commit");
			}),
			active,
			clock,
		);
		await controller.enqueue(accountA, input);
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "pending",
			attempts: 1,
			failure: "network",
		});
		database.close();

		clock.value += 2_000;
		database = new BunDatabase(path);
		await migrate(database);
		controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				return input.id;
			}),
			active,
			clock,
		);
		expect((await controller.resumeAndDrain(accountA))[0]).toMatchObject({
			state: "delivered",
			attempts: 2,
		});
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		database.close();
	});

	test("exposes pending, sending and delivered without waiting in the source flow", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const input = feedbackInput("fbk_honest_states");
		let resolveRequest = (_feedbackId: string) => {};
		let requestStarted = () => {};
		const request = new Promise<string>((resolve) => {
			resolveRequest = resolve;
		});
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const controller = testController(
			database,
			client(accountA, async () => {
				requestStarted();
				return request;
			}),
			active,
		);

		expect(await controller.submit(accountA, input)).toMatchObject({
			state: "pending",
		});
		await started;
		const delivery = controller.drain(accountA);
		expect(await controller.get(accountA, input.id)).toMatchObject({
			state: "sending",
		});
		resolveRequest(input.id);
		expect((await delivery)[0]).toMatchObject({
			state: "delivered",
			attempts: 1,
		});
		database.close();
	});

	test("never accepts a mismatched feedback identity and retries the same request", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const clock = { value: baseTime };
		const input = feedbackInput("fbk_strict_response");
		const attempts: Attempt[] = [];
		let match = false;
		const controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				return match ? input.id : "fbk_wrong_identity";
			}),
			active,
			clock,
		);
		await controller.enqueue(accountA, input);
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "pending",
			attempts: 1,
			failure: "invalid_response",
		});
		clock.value += 2_000;
		match = true;
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
			attempts: 2,
		});
		expect(attempts[1]).toEqual(attempts[0]);
		database.close();
	});

	test("keeps a malformed success response pending for an exact retry", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const input = feedbackInput("fbk_malformed_response");
		const controller = testController(
			database,
			malformedClient(accountA),
			active,
		);
		await controller.enqueue(accountA, input);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			attempts: 1,
			failure: "invalid_response",
			state: "pending",
		});
		database.close();
	});

	test("keeps terminal denial and idempotency conflict visible without automatic retry", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const attempts: Attempt[] = [];
		const controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if ((attempt.body as { id: string }).id === "fbk_denied") {
					throw gatewayError(403, "FORBIDDEN");
				}
				throw gatewayError(409, "IDEMPOTENCY_KEY_REUSED");
			}),
			active,
		);
		await controller.enqueue(accountA, feedbackInput("fbk_denied"));
		await controller.enqueue(accountA, feedbackInput("fbk_conflict"));
		const receipts = await controller.drain(accountA);
		expect(receipts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					feedbackId: "fbk_denied",
					state: "attention",
					failure: "denied",
				}),
				expect.objectContaining({
					feedbackId: "fbk_conflict",
					state: "attention",
					failure: "invalid",
				}),
			]),
		);
		expect(attempts).toHaveLength(2);
		await controller.drain(accountA);
		expect(attempts).toHaveLength(2);
		database.close();
	});

	test("retries an in-progress idempotent request at its exact due time", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const clock = { value: baseTime };
		const input = feedbackInput("fbk_in_progress");
		const attempts: Attempt[] = [];
		let inProgress = true;
		const controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (inProgress) {
					throw new GatewayClientError({
						code: "IDEMPOTENCY_IN_PROGRESS",
						operationId: "feedbackCreate",
						requestId: "req_feedback_in_progress",
						retryable: false,
						retryAfterSeconds: 5,
						status: 409,
					});
				}
				return input.id;
			}),
			active,
			clock,
		);
		await controller.enqueue(accountA, input);

		expect((await controller.drain(accountA))[0]).toMatchObject({
			attempts: 1,
			failure: "service_unavailable",
			nextAttemptAt: "2026-07-19T12:00:05.000Z",
			state: "pending",
		});
		clock.value += 4_999;
		await controller.drain(accountA);
		expect(attempts).toHaveLength(1);

		clock.value += 1;
		inProgress = false;
		expect((await controller.drain(accountA))[0]).toMatchObject({
			attempts: 2,
			state: "delivered",
		});
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		database.close();
	});

	test("marks a final 401 as attention and resumes safely after authentication", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const input = feedbackInput("fbk_auth_retry");
		const attempts: Attempt[] = [];
		let authenticated = false;
		const controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				if (!authenticated) throw gatewayError(401, "UNAUTHENTICATED");
				return input.id;
			}),
			active,
		);
		await controller.enqueue(accountA, input);
		await expect(controller.drain(accountA)).rejects.toBeInstanceOf(
			FeedbackSubmissionAuthenticationError,
		);
		expect(await controller.get(accountA, input.id)).toMatchObject({
			state: "attention",
			attempts: 1,
			failure: "auth_required",
		});
		authenticated = true;
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
			attempts: 2,
		});
		expect(attempts[1]).toEqual(attempts[0]);
		database.close();
	});

	test("fails closed on CAS loss and reclaims the same leased request after restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-feedback-cas-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "account.sqlite");
		const active = { value: accountA };
		const clock = { value: baseTime };
		const input = feedbackInput("fbk_cas_loss");
		const attempts: Attempt[] = [];

		let database = new BunDatabase(path);
		await migrate(database);
		let controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				throw gatewayError(null, "session_changed");
			}),
			active,
			clock,
		);
		await controller.enqueue(accountA, input);
		await expect(controller.drain(accountA)).rejects.toBeInstanceOf(
			FeedbackSubmissionAccountChangedError,
		);
		expect(
			await database.first<{ state: string; attempts: number }>(
				"SELECT state, attempts FROM feedback_submissions",
			),
		).toEqual({ state: "sending", attempts: 0 });
		database.close();

		clock.value += 2 * 60 * 1000 + 1;
		database = new BunDatabase(path);
		await migrate(database);
		controller = testController(
			database,
			client(accountA, async (attempt) => {
				attempts.push(attempt);
				return input.id;
			}),
			active,
			clock,
		);
		expect((await controller.drain(accountA))[0]).toMatchObject({
			state: "delivered",
			attempts: 1,
		});
		expect(attempts[1]).toEqual(attempts[0]);
		database.close();
	});

	test("does not commit an in-flight response after an account switch", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const input = feedbackInput("fbk_account_switch");
		const controller = testController(
			database,
			client(accountA, async () => {
				active.value = accountB;
				return input.id;
			}),
			active,
		);
		await controller.enqueue(accountA, input);
		await expect(controller.drain(accountA)).rejects.toBeInstanceOf(
			FeedbackSubmissionAccountChangedError,
		);
		expect(
			await database.first<{ state: string; delivered_at: string | null }>(
				"SELECT state, delivered_at FROM feedback_submissions",
			),
		).toEqual({ state: "sending", delivered_at: null });
		database.close();
	});

	test("rolls back delivery, failure, and auth writes on a mid-commit account switch", async () => {
		for (const scenario of ["delivery", "failure", "auth"] as const) {
			const database = new BunDatabase();
			await migrate(database);
			const active = { value: accountA };
			const input = feedbackInput(`fbk_commit_race_${scenario}`);
			const feedbackClient =
				scenario === "auth"
					? unauthenticatedClient()
					: client(accountA, async () => {
							if (scenario === "failure") {
								throw gatewayError(403, "FORBIDDEN");
							}
							return input.id;
						});
			const controller = testController(database, feedbackClient, active);
			await controller.enqueue(accountA, input);
			const target =
				scenario === "delivery"
					? "state = 'delivered'"
					: scenario === "failure"
						? "SET state = ?, attempts = ?"
						: "last_error_code = 'auth_required'";
			database.afterRun = (sql) => {
				if (!sql.includes(target)) return;
				database.afterRun = null;
				active.value = accountB;
			};

			await expect(controller.drain(accountA)).rejects.toBeInstanceOf(
				FeedbackSubmissionAccountChangedError,
			);
			expect(
				await database.first<{
					attempts: number;
					command_json: string | null;
					last_error_code: string | null;
					state: string;
				}>(
					"SELECT state, attempts, command_json, last_error_code FROM feedback_submissions",
				),
			).toMatchObject({
				attempts: 0,
				command_json: expect.any(String),
				last_error_code: null,
				state: scenario === "auth" ? "pending" : "sending",
			});
			database.close();
		}
	});

	test("does not report delivery after losing the SQLite lease", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const input = feedbackInput("fbk_lease_loss");
		let resolveRequest = (_feedbackId: string) => {};
		let requestStarted = () => {};
		const request = new Promise<string>((resolve) => {
			resolveRequest = resolve;
		});
		const started = new Promise<void>((resolve) => {
			requestStarted = resolve;
		});
		const controller = testController(
			database,
			client(accountA, async () => {
				requestStarted();
				return request;
			}),
			active,
		);
		await controller.enqueue(accountA, input);
		const delivery = controller.drain(accountA);
		await started;
		await database.run(
			"UPDATE feedback_submissions SET lease_owner = 'another-worker' WHERE feedback_id = ?",
			[input.id],
		);
		resolveRequest(input.id);

		expect((await delivery)[0]).toMatchObject({
			attempts: 0,
			deliveredAt: null,
			state: "sending",
		});
		expect(
			await database.first<{ command_json: string | null }>(
				"SELECT command_json FROM feedback_submissions WHERE feedback_id = ?",
				[input.id],
			),
		).toMatchObject({ command_json: expect.any(String) });
		database.close();
	});

	test("logout purge removes only the signed-out account submissions", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const active = { value: accountA };
		const controller = testController(database, null, active);
		await controller.enqueue(accountA, feedbackInput("fbk_alice"));
		active.value = accountB;
		await controller.enqueue(accountB, feedbackInput("fbk_bob"));

		await new MobileDataStore(database).clearUserData(accountA);
		expect(
			await database.all<{ account_user_id: string; feedback_id: string }>(
				"SELECT account_user_id, feedback_id FROM feedback_submissions",
			),
		).toEqual([{ account_user_id: accountB, feedback_id: "fbk_bob" }]);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});
});

function testController(
	database: SqlDatabase,
	feedbackClient: FeedbackClient | null,
	active: { value: string },
	clock: { value: number } = { value: baseTime },
) {
	let sequence = 0;
	return new FeedbackSubmissionController(database, feedbackClient, {
		activeAccountUserId: () => active.value,
		now: () => new Date(clock.value),
		randomUUID: () =>
			`00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
	});
}

function client(
	accountUserId: string,
	handler: (attempt: Attempt) => Promise<string>,
): FeedbackClient {
	const subject = Object.freeze({
		userId: accountUserId,
	}) as GatewaySessionSubject;
	return {
		async sessionSubject() {
			return subject;
		},
		async assertSessionSubject(candidate: GatewaySessionSubject) {
			if (candidate !== subject) throw gatewayError(null, "session_changed");
		},
		async requestAsUser(
			_subject: GatewaySessionSubject,
			operationId: string,
			request: {
				body?: unknown;
				headers?: Record<string, string>;
			},
		) {
			const feedbackId = await handler({
				operationId,
				body: request.body,
				key: String(request.headers?.["idempotency-key"]),
			});
			return {
				data: { feedback: { id: feedbackId } },
				requestId: "req_feedback_test",
				status: 201,
			};
		},
	} as unknown as FeedbackClient;
}

function unauthenticatedClient(): FeedbackClient {
	return {
		async sessionSubject() {
			return null;
		},
		async assertSessionSubject() {
			throw gatewayError(401, "UNAUTHENTICATED");
		},
		async requestAsUser() {
			throw new Error("requestAsUser must not be called without a subject");
		},
	} as unknown as FeedbackClient;
}

function malformedClient(accountUserId: string): FeedbackClient {
	const subject = Object.freeze({
		userId: accountUserId,
	}) as GatewaySessionSubject;
	return {
		async sessionSubject() {
			return subject;
		},
		async assertSessionSubject(candidate: GatewaySessionSubject) {
			if (candidate !== subject) throw gatewayError(null, "session_changed");
		},
		async requestAsUser() {
			return { data: {}, requestId: "req_malformed", status: 201 };
		},
	} as unknown as FeedbackClient;
}

function gatewayError(
	status: number | null,
	code: GatewayErrorCode,
): GatewayClientError {
	return new GatewayClientError({
		operationId: "feedbackCreate",
		status,
		requestId: "req_feedback_failure",
		code,
		retryable: false,
		retryAfterSeconds: null,
	});
}

function feedbackInput(
	id: string,
	overrides: Partial<FeedbackSubmissionInput> = {},
): FeedbackSubmissionInput {
	return {
		id,
		title: " Feedback title ",
		body: " Feedback body ",
		visibility: "private",
		rootEventId: "evt_trip",
		eventId: "evt_day",
		screenKey: "event/detail",
		diagnostics: {
			appVersion: "1.4.0",
			buildNumber: "82",
			locale: "de-CH",
			osVersion: "26.2",
			platform: "ios",
		},
		...overrides,
	};
}

async function insertEvidenceSubmission(
	database: SqlDatabase,
	input: {
		createdAt: string;
		feedbackId: string;
		marker: string;
		rootEventId: string;
		screenshotAttachmentId?: string;
		state: "attention" | "delivered" | "pending" | "sending";
	},
): Promise<void> {
	const commandJson = JSON.stringify({ marker: input.marker });
	await database.run(
		`INSERT INTO feedback_submissions (
  account_user_id, feedback_id, command_json, command_fingerprint,
  idempotency_key, screenshot_attachment_id, root_event_id, state,
  lease_owner, lease_expires_at, created_at, updated_at, delivered_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			accountA,
			input.feedbackId,
			input.state === "delivered" ? null : commandJson,
			await sha256Hex(commandJson),
			`evidence-${input.feedbackId}`,
			input.screenshotAttachmentId ?? null,
			input.rootEventId,
			input.state,
			input.state === "sending" ? "lease-evidence" : null,
			input.state === "sending"
				? new Date(Date.parse(input.createdAt) + 60_000).toISOString()
				: null,
			input.createdAt,
			input.createdAt,
			input.state === "delivered" ? input.createdAt : null,
		],
	);
}

async function evidenceSubmissionFingerprint(marker: string): Promise<string> {
	const commandFingerprint = await sha256Hex(JSON.stringify({ marker }));
	return sha256Hex(
		`crew.feedback.command.evidence.v1\u0000${commandFingerprint}`,
	);
}

function required<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("test value missing");
	return value;
}
