import { describe, expect, test } from "bun:test";
import type {
	AttachmentVerificationClaim,
	PostgresAttachmentJobRepository,
} from "./attachment-jobs";
import { createAttachmentWorker } from "./attachment-worker";
import { EventNotificationIngressError } from "./event-notification-ingress";
import type { PostgresEventNotificationOutbox } from "./event-notification-outbox";
import type {
	EventNotificationPayload,
	EventNotificationPayloadCodec,
} from "./event-notification-payload";
import { createEventNotificationWorker } from "./event-notification-worker";
import type { AttachmentWorkerObjectStore } from "./object-store";

const maintenance = {
	purgedDelivered: 1,
	purgedSuppressed: 2,
	purgedInvalid: 3,
	purgedDead: 4,
	purgedExpired: 5,
	backlog: 6,
	oldestActiveAgeSeconds: 7,
};

describe("worker operations instrumentation", () => {
	test("reports fixed notification outcomes and applies deterministic jitter", async () => {
		let retryDelay = 0;
		const expiresAt = new Date(Date.now() + 60_000);
		const payload: EventNotificationPayload = {
			recipientUserId: "usr_00000000000000000000000000000001",
			category: "feed_update",
			templateKey: "feed_entry_created",
			deepLink: {
				rootEventId: "evt_worker-operations",
				feedEntryId: "fed_worker-operations",
			},
			expiresAt: expiresAt.toISOString(),
			requestId: "job_00000000000000000000000000000001",
			causationRequestId: "worker.operations.request",
		};
		const outbox = {
			async maintain() {
				return maintenance;
			},
			async claim() {
				return {
					id: payload.requestId,
					payloadKid: "payload-v1",
					payloadCiphertext: "ciphertext",
					expiresAt,
					workerId: "notification-worker-safe",
					fence: "1",
					attempts: 0,
					keyFailures: 0,
				};
			},
			async renewForDelivery(claim: { fence: string }) {
				return { ...claim, fence: "2", attempt: 1 };
			},
			async retryDelivery(_claim: unknown, input: { delayMs: number }) {
				retryDelay = input.delayMs;
				return "retry" as const;
			},
		} as unknown as PostgresEventNotificationOutbox;
		const worker = createEventNotificationWorker(
			{
				workerId: "notification-worker-safe",
				pollIntervalMs: 50,
				leaseMs: 5_000,
				timeoutMs: 100,
				maxAttempts: 3,
				baseBackoffMs: 1_000,
				maxBackoffMs: 10_000,
				random: () => 0,
			},
			outbox,
			{ open: () => payload } as unknown as EventNotificationPayloadCodec,
			{
				async deliver() {
					throw new EventNotificationIngressError(
						"NOTIFICATION_INGRESS_TIMEOUT",
						true,
					);
				},
			},
		);

		expect(await worker.tick()).toEqual({
			...maintenance,
			claimed: 1,
			delivered: 0,
			suppressed: 0,
			invalid: 0,
			dead: 0,
			expired: 0,
			retried: 1,
			payloadKeyUnavailable: 0,
			retryTimeout: 1,
			retryRateLimited: 0,
			retryIngress: 0,
			staleResults: 0,
		});
		expect(retryDelay).toBe(750);
	});

	test("reports attachment timeouts and keeps cleanup retry limits distinct", async () => {
		let cleanupMaxAttempts = 0;
		let verificationFailureCode = "";
		const claim = attachmentClaim();
		let claimed = false;
		const jobs = {
			async maintain() {
				return {
					verificationExhausted: 0,
					cleanupExhausted: 0,
					verificationBacklog: 1,
					cleanupBacklog: 0,
					oldestVerificationAgeSeconds: 12,
					oldestCleanupAgeSeconds: 0,
				};
			},
			async claimVerification() {
				if (claimed) return null;
				claimed = true;
				return claim;
			},
			async retryVerification(_claim: unknown, input: { errorCode: string }) {
				verificationFailureCode = input.errorCode;
				return "retry" as const;
			},
			async claimCleanup(input: { maxAttempts: number }) {
				cleanupMaxAttempts = input.maxAttempts;
				return null;
			},
		} as unknown as PostgresAttachmentJobRepository;
		const worker = createAttachmentWorker(
			{
				workerId: "attachment-worker-safe",
				pollIntervalMs: 100,
				verifyLeaseSeconds: 5,
				verifyMaxAttempts: 2,
				verifyConcurrency: 1,
				cleanupLeaseSeconds: 5,
				cleanupMaxAttempts: 7,
				cleanupRetentionSeconds: 86_400,
				objectIoTimeoutMs: 100,
				random: () => 0,
			},
			jobs,
			{
				async verifyAndCommit() {
					return new Promise<void>(() => {});
				},
				async deleteQuarantine() {},
				async deleteCommittedFeedback() {},
			} as AttachmentWorkerObjectStore,
		);

		const stats = await worker.tick();
		expect(stats).toMatchObject({
			verificationClaimed: 1,
			verificationRetried: 1,
			verificationTimeouts: 1,
			verificationBacklog: 1,
			oldestVerificationAgeSeconds: 12,
		});
		expect(cleanupMaxAttempts).toBe(7);
		expect(verificationFailureCode).toBe("ATTACHMENT_STORE_TIMEOUT");
	});

	test("interrupts idle notification and attachment polling immediately", async () => {
		const notificationAbort = new AbortController();
		const noNotifications = {
			async maintain() {
				return {
					purgedDelivered: 0,
					purgedSuppressed: 0,
					purgedInvalid: 0,
					purgedDead: 0,
					purgedExpired: 0,
					backlog: 0,
					oldestActiveAgeSeconds: 0,
				};
			},
			async claim() {
				return null;
			},
		} as unknown as PostgresEventNotificationOutbox;
		const notification = createEventNotificationWorker(
			{
				workerId: "notification-worker-idle",
				pollIntervalMs: 10_000,
				leaseMs: 5_000,
				timeoutMs: 100,
				maxAttempts: 3,
				baseBackoffMs: 100,
				maxBackoffMs: 1_000,
			},
			noNotifications,
			{} as EventNotificationPayloadCodec,
			{
				async deliver() {
					return { status: 202 as const };
				},
			},
		);
		const notificationStarted = performance.now();
		const notificationRun = notification.run(notificationAbort.signal);
		setTimeout(() => notificationAbort.abort(), 20);
		await notificationRun;
		expect(performance.now() - notificationStarted).toBeLessThan(500);

		const attachmentAbort = new AbortController();
		const noAttachments = {
			async claimVerification() {
				return null;
			},
			async claimCleanup() {
				return null;
			},
		} as unknown as PostgresAttachmentJobRepository;
		const attachment = createAttachmentWorker(
			{
				workerId: "attachment-worker-idle",
				pollIntervalMs: 10_000,
				verifyLeaseSeconds: 5,
				verifyMaxAttempts: 2,
				verifyConcurrency: 1,
				cleanupLeaseSeconds: 5,
				cleanupRetentionSeconds: 86_400,
			},
			noAttachments,
			{} as AttachmentWorkerObjectStore,
		);
		const attachmentStarted = performance.now();
		const attachmentRun = attachment.run(attachmentAbort.signal);
		setTimeout(() => attachmentAbort.abort(), 20);
		await attachmentRun;
		expect(performance.now() - attachmentStarted).toBeLessThan(500);
	});

	test("rejects unsafe worker IDs before they can reach logs or leases", () => {
		expect(() =>
			createAttachmentWorker(
				{
					workerId: "unsafe\nprivate-id",
					pollIntervalMs: 100,
					verifyLeaseSeconds: 5,
					verifyMaxAttempts: 2,
					verifyConcurrency: 1,
					cleanupLeaseSeconds: 5,
					cleanupRetentionSeconds: 86_400,
				},
				{} as PostgresAttachmentJobRepository,
				{} as AttachmentWorkerObjectStore,
			),
		).toThrow("Invalid attachment worker ID");
		expect(() =>
			createEventNotificationWorker(
				{
					workerId: "unsafe private-id",
					pollIntervalMs: 50,
					leaseMs: 5_000,
					timeoutMs: 100,
					maxAttempts: 3,
					baseBackoffMs: 100,
					maxBackoffMs: 1_000,
				},
				{} as PostgresEventNotificationOutbox,
				{} as EventNotificationPayloadCodec,
				{
					async deliver() {
						return { status: 202 as const };
					},
				},
			),
		).toThrow("Invalid event notification worker ID");
	});
});

function attachmentClaim(): AttachmentVerificationClaim {
	const createdAt = new Date();
	return {
		upload: {
			id: "upl_worker-operations",
			attachmentId: "att_worker-operations",
			rootEventId: "evt_worker-operations",
			target: { kind: "feedEntry", entryId: "fed_worker-operations" },
			targetEntryId: "fed_worker-operations",
			createdBy: "usr_00000000000000000000000000000001",
			quarantineObjectKey:
				"quarantine/evt_worker-operations/att_worker-operations/upl_worker-operations/1-" +
				"a".repeat(64),
			contentType: "image/png",
			byteCount: 1,
			sha256: "a".repeat(64),
			grantKid: "grant-v1",
			grantCiphertext: "x".repeat(32),
			state: "prepared",
			expiresAt: new Date(createdAt.getTime() + 60_000),
			committedAt: null,
			createdAt,
		},
		committedObjectKey:
			"committed/evt_worker-operations/att_worker-operations/upl_worker-operations/" +
			"a".repeat(64),
		workerId: "attachment-worker-safe",
		fence: "1",
		attempt: 1,
	};
}
