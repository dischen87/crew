import postgres from "postgres";
import { EventNotificationIngressClient } from "./event-notification-ingress";
import { PostgresEventNotificationOutbox } from "./event-notification-outbox";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { createEventNotificationWorker } from "./event-notification-worker";
import { loadEventNotificationWorkerConfig } from "./event-notification-worker-config";

export { createEventNotificationWorker } from "./event-notification-worker";

if (import.meta.main) {
	const config = loadEventNotificationWorkerConfig();
	const sql = postgres(config.databaseUrl, { max: 2, onnotice: () => {} });
	const codec = new EventNotificationPayloadCodec(
		{
			kid: config.payloadCurrentKeyId,
			key: config.payloadCurrentKey,
		},
		config.payloadPreviousKeyId && config.payloadPreviousKey
			? {
					kid: config.payloadPreviousKeyId,
					key: config.payloadPreviousKey,
				}
			: undefined,
	);
	const worker = createEventNotificationWorker(
		config,
		new PostgresEventNotificationOutbox(sql),
		codec,
		new EventNotificationIngressClient({
			baseUrl: config.userServiceUrl,
			timeoutMs: config.timeoutMs,
			issuer: config.serviceAuthIssuer,
			audience: config.serviceAuthAudience,
			serviceAuthKeyId: config.serviceAuthCurrentKeyId,
			serviceAuthKey: config.serviceAuthCurrentKey,
		}),
	);
	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());
	process.once("SIGTERM", () => controller.abort());
	console.info(`Crew event notification worker ${worker.id} started`);
	try {
		await worker.run(controller.signal);
	} finally {
		await sql.end({ timeout: 5 });
	}
}
