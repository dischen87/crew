import postgres from "postgres";
import { createApp } from "./app";
import { createJwtVerifier } from "./auth";
import { loadConfig } from "./config";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { InvitationTokenCodec } from "./invitation-token";
import { BunS3PrivateObjectStore, UploadGrantCodec } from "./object-store";
import { PlaceCandidateService } from "./place-candidate";
import { createPlaceCandidateServiceAuth } from "./place-candidate-auth";
import { loadPlaceEnrichmentPolicy } from "./place-enrichment-worker-config";
import { PlaceSearchService, TypesensePlaceSearchIndex } from "./place-search";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";
import { PostgresEventRepository } from "./postgres-repository";
import { RecapCaptionFieldRefCodec } from "./recap-caption-field-ref";
import { RecapShareTokenCodec } from "./recap-share-token";
import { EventService } from "./service";

const config = loadConfig();
const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
const notificationPayloads = new EventNotificationPayloadCodec({
	kid: config.notificationPayloadCurrentKeyId,
	key: config.notificationPayloadCurrentKey,
});
const service = new EventService(
	new PostgresEventRepository(sql, notificationPayloads, false, {
		enabled: config.recapExternalCaptionsEnabled,
		fieldRefs: new RecapCaptionFieldRefCodec(
			config.recapCaptionFieldRefCurrentKey,
			config.recapCaptionFieldRefPreviousKey,
		),
	}),
	new InvitationTokenCodec(
		{ id: config.invitationKeyId, secret: config.invitationKey },
		config.invitationPreviousKeyId && config.invitationPreviousKey
			? {
					id: config.invitationPreviousKeyId,
					secret: config.invitationPreviousKey,
				}
			: undefined,
	),
	{
		objectStore: new BunS3PrivateObjectStore({
			endpoint: config.objectStoreEndpoint,
			region: config.objectStoreRegion,
			bucket: config.objectStoreBucket,
			accessKeyId: config.objectStoreAccessKeyId,
			secretAccessKey: config.objectStoreSecretAccessKey,
		}),
		grantCodec: new UploadGrantCodec(
			config.attachmentGrantKid,
			config.attachmentGrantKey,
			config.attachmentPreviousGrantKey && config.attachmentPreviousGrantKid
				? [
						{
							kid: config.attachmentPreviousGrantKid,
							secret: config.attachmentPreviousGrantKey,
						},
					]
				: [],
		),
		uploadTtlSeconds: config.attachmentUploadTtlSeconds,
		downloadTtlSeconds: config.attachmentDownloadTtlSeconds,
	},
	config.syncCursorKey,
	new RecapShareTokenCodec(
		{
			id: config.recapShareTokenCurrentKeyId,
			secret: config.recapShareTokenCurrentKey,
		},
		config.recapShareTokenPreviousKeyId &&
			config.recapShareTokenPreviousKey &&
			config.recapShareTokenPreviousNotAfter
			? {
					id: config.recapShareTokenPreviousKeyId,
					secret: config.recapShareTokenPreviousKey,
					notAfter: config.recapShareTokenPreviousNotAfter,
				}
			: undefined,
	),
	config.placeEnrichmentEnabled ? loadPlaceEnrichmentPolicy() : undefined,
);
const app = createApp({
	service,
	placeCandidates: new PlaceCandidateService(
		new PostgresPlaceCandidateRepository(sql),
	),
	placeSearch: new PlaceSearchService(
		new TypesensePlaceSearchIndex({
			url: config.typesenseUrl,
			apiKey: config.typesenseSearchApiKey,
			collectionAlias: config.typesensePlaceAlias,
			timeoutMs: config.typesenseTimeoutMs,
		}),
		config.placeSearchCursorKey,
	),
	verifyPlaceCandidateServiceToken: createPlaceCandidateServiceAuth({
		issuer: config.placeCandidateServiceIssuer,
		audience: config.placeCandidateServiceAudience,
		current: {
			id: config.placeCandidateServiceCurrentKeyId,
			key: config.placeCandidateServiceCurrentKey,
		},
		...(config.placeCandidateServicePreviousKeyId &&
		config.placeCandidateServicePreviousKey
			? {
					previous: {
						id: config.placeCandidateServicePreviousKeyId,
						key: config.placeCandidateServicePreviousKey,
					},
				}
			: {}),
	}),
	verifyUserToken: createJwtVerifier({
		jwksUrl: config.userServiceJwksUrl,
		issuer: config.userTokenIssuer,
		audience: config.userTokenAudience,
		cacheMaxAge: config.jwksCacheMs,
		cooldownDuration: config.jwksCooldownMs,
		timeoutDuration: config.jwksTimeoutMs,
	}),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, async () => {
		await sql.end({ timeout: 5 });
		process.exit(0);
	});
}

console.info(`Crew event service listening on ${config.host}:${config.port}`);

export default { hostname: config.host, port: config.port, fetch: app.fetch };
