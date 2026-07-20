import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { loadAttachmentWorkerConfig } from "./attachment-worker-config";
import { loadConfig } from "./config";
import { loadEventNotificationWorkerConfig } from "./event-notification-worker-config";

describe("event-service scaffold", () => {
	test("validates service and worker configuration", () => {
		const api = loadConfig({
			EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY_ID: "api-current-v2",
			EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
				"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
		});
		expect(api.notificationPayloadCurrentKeyId).toBe("api-current-v2");
		expect(api.invitationKeyId).toBe("legacy-invitation-v1");
		expect(api.recapShareTokenCurrentKeyId).toBe("development-v1");
		expect(
			loadConfig({
				RECAP_SHARE_TOKEN_PREVIOUS_KEY_ID: "",
				RECAP_SHARE_TOKEN_PREVIOUS_KEY: "",
				RECAP_SHARE_TOKEN_PREVIOUS_NOT_AFTER: "",
			}).recapShareTokenPreviousKeyId,
		).toBeUndefined();
		expect(api.placeCandidateServiceCurrentKeyId).toBe("development-v1");
		expect(Object.hasOwn(api, "notificationPayloadPreviousKey")).toBe(false);
		expect(() =>
			loadConfig({
				PLACE_CANDIDATE_SERVICE_PREVIOUS_KEY_ID: "previous-only",
			}),
		).toThrow("configured together");
		expect(() =>
			loadConfig({
				RECAP_SHARE_TOKEN_PREVIOUS_KEY_ID: "previous-only",
			}),
		).toThrow("configured together");
		expect(() =>
			loadConfig({
				INVITATION_TOKEN_PREVIOUS_KEY_ID: "previous-only",
			}),
		).toThrow("configured together");
		expect(() =>
			loadConfig({
				INVITATION_TOKEN_CURRENT_KEY_ID: "same",
				INVITATION_TOKEN_PREVIOUS_KEY_ID: "same",
				INVITATION_TOKEN_PREVIOUS_KEY:
					"previous-invitation-token-key-with-32-characters",
			}),
		).toThrow("KIDs must differ");
		expect(() =>
			loadConfig({
				INVITATION_TOKEN_KEY:
					"same-invitation-token-key-with-at-least-32-characters",
				INVITATION_TOKEN_PREVIOUS_KEY_ID: "previous",
				INVITATION_TOKEN_PREVIOUS_KEY:
					"same-invitation-token-key-with-at-least-32-characters",
			}),
		).toThrow("keys must differ");
		expect(() =>
			loadConfig({
				INVITATION_TOKEN_KEY:
					"shared-recap-and-invitation-key-with-32-characters",
				RECAP_SHARE_TOKEN_CURRENT_KEY:
					"shared-recap-and-invitation-key-with-32-characters",
			}),
		).toThrow("separate secret domain");
		expect(() =>
			loadConfig({
				PLACE_CANDIDATE_SERVICE_CURRENT_KEY:
					"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
			}),
		).toThrow("separate secret domain");
		for (const env of [
			{
				EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				INVITATION_TOKEN_KEY: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			},
			{
				EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				INVITATION_TOKEN_PREVIOUS_KEY_ID: "invitation-v1",
				INVITATION_TOKEN_PREVIOUS_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			},
			{
				EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				ATTACHMENT_GRANT_KEY: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			},
			{
				EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				ATTACHMENT_PREVIOUS_GRANT_KID: "grant-v1",
				ATTACHMENT_PREVIOUS_GRANT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			},
		]) {
			expect(() => loadConfig(env)).toThrow(
				"Notification payload encryption must differ",
			);
		}
		expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
			"PLACE_CANDIDATE_SERVICE_CURRENT_KEY",
		);
		const productionApi = {
			NODE_ENV: "production",
			EVENT_DATABASE_URL: "postgres://event:secret@db.internal/crew_event",
			INVITATION_TOKEN_CURRENT_KEY_ID: "invitation-v2",
			INVITATION_TOKEN_KEY:
				"production-invitation-token-key-at-least-32-characters",
			RECAP_SHARE_TOKEN_CURRENT_KEY_ID: "recap-v2",
			RECAP_SHARE_TOKEN_CURRENT_KEY:
				"production-recap-share-token-key-at-least-32-characters",
			SYNC_CURSOR_KEY: "production-sync-cursor-key-at-least-32-characters",
			USER_SERVICE_JWKS_URL: "https://user.internal/.well-known/jwks.json",
			ATTACHMENT_GRANT_KID: "attachment-v2",
			ATTACHMENT_GRANT_KEY:
				"production-attachment-grant-key-at-least-32-characters",
			EVENT_OBJECT_STORE_ENDPOINT: "https://objects.internal",
			EVENT_OBJECT_STORE_REGION: "eu-central-1",
			EVENT_OBJECT_STORE_BUCKET: "crew-event-production",
			EVENT_OBJECT_STORE_ACCESS_KEY_ID: "production-access",
			EVENT_OBJECT_STORE_SECRET_ACCESS_KEY:
				"production-object-secret-at-least-16",
			EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY_ID: "notification-v2",
			EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY:
				"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			PLACE_CANDIDATE_SERVICE_CURRENT_KEY_ID: "place-service-v2",
			PLACE_CANDIDATE_SERVICE_CURRENT_KEY:
				"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			PLACE_SEARCH_CURSOR_KEY:
				"production-place-search-cursor-key-at-least-32-characters",
			PLACE_SEARCH_TYPESENSE_URL: "https://typesense.internal",
			PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY:
				"production-typesense-search-key-at-least-16",
		};
		expect(loadConfig(productionApi).environment).toBe("production");
		expect(() =>
			loadConfig({
				...productionApi,
				INVITATION_TOKEN_PREVIOUS_KEY_ID: "invitation-v1",
				INVITATION_TOKEN_PREVIOUS_KEY:
					"crew-development-invitation-key-change-me",
			}),
		).toThrow("must not use development material");
		expect(() =>
			loadAttachmentWorkerConfig({
				EVENT_ATTACHMENT_WORKER_POLL_INTERVAL_MS: "1",
			}),
		).toThrow();
		expect(
			loadAttachmentWorkerConfig({
				EVENT_ATTACHMENT_WORKER_ID: "worker-test",
			}).workerId,
		).toBe("worker-test");
		expect(() =>
			loadConfig({
				NODE_ENV: "production",
				EVENT_DATABASE_URL: "postgres://db.internal/crew_event",
				INVITATION_TOKEN_KEY: "production-invitation-key-with-32-characters",
				USER_SERVICE_JWKS_URL: "http://user-service/.well-known/jwks.json",
			}),
		).toThrow("HTTPS");
		expect(() =>
			loadAttachmentWorkerConfig({
				NODE_ENV: "production",
				EVENT_DATABASE_URL: "postgres://api-db.internal/crew_event",
				EVENT_OBJECT_STORE_ENDPOINT: "https://api-objects.internal",
				EVENT_OBJECT_STORE_REGION: "eu-central-1",
				EVENT_OBJECT_STORE_BUCKET: "api-bucket",
				EVENT_OBJECT_STORE_ACCESS_KEY_ID: "api-access",
				EVENT_OBJECT_STORE_SECRET_ACCESS_KEY:
					"api-secret-does-not-authorize-worker",
			}),
		).toThrow();
		const worker = loadAttachmentWorkerConfig({
			NODE_ENV: "production",
			EVENT_ATTACHMENT_WORKER_DATABASE_URL:
				"postgres://worker-db.internal/crew_event",
			EVENT_ATTACHMENT_WORKER_OBJECT_STORE_ENDPOINT:
				"https://worker-objects.internal",
			EVENT_ATTACHMENT_WORKER_OBJECT_STORE_REGION: "eu-central-1",
			EVENT_ATTACHMENT_WORKER_OBJECT_STORE_BUCKET: "worker-bucket",
			EVENT_ATTACHMENT_WORKER_OBJECT_STORE_ACCESS_KEY_ID: "worker-access",
			EVENT_ATTACHMENT_WORKER_OBJECT_STORE_SECRET_ACCESS_KEY:
				"worker-secret-with-least-privilege",
		});
		expect(worker).toMatchObject({
			verifyMaxAttempts: 5,
			cleanupRetentionSeconds: 86_400,
			objectStoreAccessKeyId: "worker-access",
		});
		expect(() =>
			loadEventNotificationWorkerConfig({
				EVENT_NOTIFICATION_WORKER_LEASE_MS: "5250",
				EVENT_NOTIFICATION_WORKER_TIMEOUT_MS: "5000",
			}),
		).toThrow("buffer");
		expect(() =>
			loadEventNotificationWorkerConfig({
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			}),
		).toThrow("must differ");
		expect(() =>
			loadEventNotificationWorkerConfig({
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID: "payload-v2",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY_ID: "payload-v1",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			}),
		).toThrow("material must differ");
		expect(() =>
			loadEventNotificationWorkerConfig({
				NODE_ENV: "production",
				EVENT_NOTIFICATION_WORKER_DATABASE_URL:
					"postgres://worker-db.internal/crew_event",
				EVENT_NOTIFICATION_WORKER_USER_SERVICE_URL:
					"http://user-service.internal",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID: "payload-v2",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY_ID: "service-v2",
				EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY:
					"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			}),
		).toThrow("HTTPS");
		expect(() =>
			loadEventNotificationWorkerConfig({
				NODE_ENV: "production",
				EVENT_NOTIFICATION_WORKER_DATABASE_URL:
					"postgres://worker-db.internal/crew_event",
				EVENT_NOTIFICATION_WORKER_USER_SERVICE_URL:
					"https://user-service.internal",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID: "payload-v2",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY:
					"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY_ID: "payload-v1",
				EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY:
					"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
				EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY_ID: "service-v2",
				EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY:
					"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			}),
		).toThrow("must be configured in production");
		const notifications = loadEventNotificationWorkerConfig({
			NODE_ENV: "production",
			EVENT_NOTIFICATION_WORKER_DATABASE_URL:
				"postgres://notification-worker.internal/crew_event",
			EVENT_NOTIFICATION_WORKER_USER_SERVICE_URL:
				"https://user-service.internal",
			EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID: "payload-v2",
			EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY:
				"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
			EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY_ID: "service-v2",
			EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY:
				"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			INVITATION_TOKEN_KEY: "must-not-be-read-by-notification-worker",
			USER_SERVICE_JWKS_URL: "must-not-be-read-by-notification-worker",
			EVENT_OBJECT_STORE_SECRET_ACCESS_KEY:
				"must-not-be-read-by-notification-worker",
		});
		expect(notifications).toMatchObject({
			serviceAuthCurrentKeyId: "service-v2",
			payloadCurrentKeyId: "payload-v2",
		});
		expect(JSON.stringify(notifications)).not.toContain("must-not-be-read");
	});

	test("serves health and OpenAPI 3.1", async () => {
		const app = createApp();
		const live = await app.request("/internal/live");
		expect(live.status).toBe(200);
		expect(await live.json()).toEqual({
			service: "event-service",
			status: "ok",
		});
		const document = await (await app.request("/docs/openapi.json")).json();
		expect(document.openapi).toBe("3.1.0");
	});

	test("never accepts share tokens as correlation or idempotency identifiers", async () => {
		const app = createApp({
			verifyUserToken: async () => ({
				id: "usr_00000000000000000000000000000001",
			}),
		});
		for (const token of [`cin_${"A".repeat(43)}`, `crs_${"B".repeat(43)}`]) {
			const live = await app.request("/internal/live", {
				headers: { "X-Request-ID": token },
			});
			expect(live.headers.get("X-Request-ID")).toMatch(
				/^[0-9a-f]{8}-[0-9a-f-]{27}$/,
			);
			expect(live.headers.get("X-Request-ID")).not.toBe(token);

			const command = await app.request(
				"/v1/event-roots/evt_sensitive/recap/share-links",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer actor",
						"Idempotency-Key": token,
					},
				},
			);
			expect(command.status).toBe(400);
			expect(await command.json()).toMatchObject({
				error: { code: "VALIDATION_FAILED" },
			});
		}
	});

	test("publishes canonical positive decimal sort-key response contracts", async () => {
		const app = createApp();
		const document = (await (
			await app.request("/docs/openapi.json")
		).json()) as {
			components: {
				schemas: Record<
					string,
					{ properties?: Record<string, Record<string, unknown>> }
				>;
			};
		};
		const sortKeySchemas = [
			"Event",
			"ItineraryItem",
			"SyncEventData",
			"SyncItineraryData",
		].map((name) => document.components.schemas[name]?.properties?.sortKey);

		expect(sortKeySchemas).toHaveLength(4);
		for (const schema of sortKeySchemas) {
			expect(schema).toEqual({ type: "string", pattern: "^[1-9]\\d*$" });
		}

		const matchesContract = (value: unknown) =>
			typeof value === "string" && /^[1-9]\d*$/.test(value);
		expect(matchesContract("9".repeat(10_000))).toBe(true);
		for (const value of ["a0", "02", "", 2]) {
			expect(matchesContract(value)).toBe(false);
		}
	});

	test("publishes exact template collection and event-ID map bounds", async () => {
		const app = createApp();
		const document = await (await app.request("/docs/openapi.json")).json();
		const templates =
			document.paths["/v1/event-templates"].get.responses["200"].content[
				"application/json"
			].schema.properties.templates;
		expect(templates).toMatchObject({ minItems: 3, maxItems: 3 });

		const eventIds =
			document.paths["/v1/event-roots"].post.requestBody.content[
				"application/json"
			].schema.properties.template.properties.eventIds;
		expect(eventIds).toMatchObject({
			maxProperties: 16,
			propertyNames: {
				type: "string",
				pattern: "^[a-z][a-z0-9-]{0,31}$",
			},
		});
		expect(
			document.paths["/v1/event-roots"].post.requestBody.content[
				"application/json"
			].schema.properties.status,
		).toEqual({ type: "string", enum: ["draft"], default: "draft" });
	});

	test("publishes the finite capability blocker target contract", async () => {
		const document = await (
			await createApp().request("/docs/openapi.json")
		).json();
		const reason = document.components.schemas.EventPublishReadinessReason;
		expect(reason.properties.meta).toMatchObject({
			type: "object",
			additionalProperties: false,
			properties: {
				eventId: {
					type: "string",
					pattern: "^evt_[A-Za-z0-9._:-]{1,96}$",
				},
				capabilityType: {
					type: "string",
					enum: ["travel", "lodging", "transport", "golf", "team"],
				},
			},
		});
		expect(reason.required).toEqual(["code", "path", "message"]);
	});

	test("rejects direct root publication before invoking the service", async () => {
		const response = await createApp({
			verifyUserToken: async (token) => ({ id: token }),
		}).request("/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer usr_00000000000000000000000000000001",
				"Content-Type": "application/json",
				"Idempotency-Key": "root-published-contract-01",
			},
			body: JSON.stringify({
				id: "evt_published_contract",
				kind: "team_event",
				title: "Published bypass",
				timeZone: "Europe/Zurich",
				status: "published",
			}),
		});
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
	});

	test("rejects client-supplied sort keys in strict sync mutations", async () => {
		const app = createApp({
			verifyUserToken: async (token) => ({ id: token }),
		});
		for (const [index, sortKey] of [
			"9".repeat(10_000),
			"a0",
			"02",
			"",
			2,
		].entries()) {
			const response = await app.request("/v1/sync/push", {
				method: "POST",
				headers: {
					Authorization: "Bearer usr_00000000000000000000000000000001",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					protocolVersion: 1,
					rootEventId: "evt_sortkeyroot",
					deviceId: "dvc_00000000-0000-4000-8000-000000000001",
					mutations: [
						{
							clientMutationId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
							clientSequence: index + 1,
							kind: "event.create",
							entityId: `evt_sortkeychild${index}`,
							payload: {
								parentEventId: "evt_sortkeyroot",
								kind: "day",
								title: "Strict sort-key contract",
								timeZone: "Europe/Zurich",
								sortKey,
							},
						},
					],
				}),
			});

			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				error: { code: "VALIDATION_FAILED" },
			});
		}
	});
});
