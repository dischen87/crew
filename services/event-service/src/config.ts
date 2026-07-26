import { z } from "zod";
import { isEventNotificationPayloadKey } from "./event-notification-payload";

const DEVELOPMENT_DATABASE_URL = "postgres://localhost/crew_event";
const DEVELOPMENT_INVITATION_KEY = "crew-development-invitation-key-change-me";
const DEVELOPMENT_RECAP_SHARE_TOKEN_KEY =
	"crew-development-recap-share-token-key-change-me";
const DEVELOPMENT_RECAP_CAPTION_FIELD_REF_KEY =
	"crew-development-recap-caption-field-ref-key-change-me";
const COMPOSE_LOCAL_RECAP_CAPTION_FIELD_REF_KEY =
	"crew-local-recap-caption-field-ref-key-change-2026";
const DEVELOPMENT_GRANT_KEY = "crew-development-upload-grant-key-change-me";
const DEVELOPMENT_OBJECT_ENDPOINT = "http://localhost:9000";
const DEVELOPMENT_OBJECT_ACCESS_KEY = "crew-development-object-access";
const DEVELOPMENT_OBJECT_SECRET_KEY = "crew-development-object-secret";
const DEVELOPMENT_NOTIFICATION_PAYLOAD_KEY =
	"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const DEVELOPMENT_SYNC_CURSOR_KEY =
	"crew-development-sync-cursor-key-change-me";
const DEVELOPMENT_PLACE_CANDIDATE_SERVICE_KEY =
	"CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const DEVELOPMENT_PLACE_SEARCH_CURSOR_KEY =
	"crew-development-place-search-cursor-key-change-me";
const DEVELOPMENT_TYPESENSE_URL = "http://localhost:8108";
const DEVELOPMENT_TYPESENSE_SEARCH_API_KEY =
	"crew-local-typesense-key-change-2026";
const KeyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const PayloadKey = z.string().refine(isEventNotificationPayloadKey);

const ConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		host: z.string().min(1),
		port: z.coerce.number().int().min(1).max(65_535),
		databaseUrl: z.string().url(),
		invitationKeyId: KeyId,
		invitationKey: z.string().min(32),
		invitationPreviousKeyId: KeyId.optional(),
		invitationPreviousKey: z.string().min(32).optional(),
		recapShareTokenCurrentKeyId: KeyId,
		recapShareTokenCurrentKey: z.string().min(32),
		recapShareTokenPreviousKeyId: KeyId.optional(),
		recapShareTokenPreviousKey: z.string().min(32).optional(),
		recapShareTokenPreviousNotAfter: z.coerce.date().optional(),
		recapExternalCaptionsEnabled: z
			.enum(["true", "false"])
			.transform((value) => value === "true"),
		recapCaptionFieldRefCurrentKey: z.string().min(32),
		recapCaptionFieldRefPreviousKey: z.string().min(32).optional(),
		syncCursorKey: z.string().min(32),
		userServiceJwksUrl: z.string().url(),
		userTokenIssuer: z.string().min(1),
		userTokenAudience: z.string().min(1),
		jwksCacheMs: z.coerce.number().int().min(1_000).max(86_400_000),
		jwksCooldownMs: z.coerce.number().int().min(100).max(60_000),
		jwksTimeoutMs: z.coerce.number().int().min(100).max(30_000),
		attachmentGrantKey: z.string().min(32),
		attachmentGrantKid: z.string().min(1).max(64),
		attachmentPreviousGrantKey: z.string().min(32).optional(),
		attachmentPreviousGrantKid: z.string().min(1).max(64).optional(),
		objectStoreEndpoint: z.string().url(),
		objectStoreRegion: z.string().min(1).max(64),
		objectStoreBucket: z.string().min(3).max(63),
		objectStoreAccessKeyId: z.string().min(8).max(256),
		objectStoreSecretAccessKey: z.string().min(16).max(512),
		attachmentUploadTtlSeconds: z.coerce.number().int().min(60).max(900),
		attachmentDownloadTtlSeconds: z.coerce.number().int().min(10).max(300),
		notificationPayloadCurrentKeyId: KeyId,
		notificationPayloadCurrentKey: PayloadKey,
		placeCandidateServiceIssuer: z.string().min(1).max(200),
		placeCandidateServiceAudience: z.string().min(1).max(200),
		placeCandidateServiceCurrentKeyId: KeyId,
		placeCandidateServiceCurrentKey: PayloadKey,
		placeCandidateServicePreviousKeyId: KeyId.optional(),
		placeCandidateServicePreviousKey: PayloadKey.optional(),
		placeSearchCursorKey: z.string().min(32),
		typesenseUrl: z.string().url(),
		typesenseSearchApiKey: z.string().min(16).max(512),
		typesensePlaceAlias: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
		typesenseTimeoutMs: z.coerce.number().int().min(100).max(10_000),
		placeEnrichmentEnabled: z
			.enum(["true", "false"])
			.transform((value) => value === "true"),
	})
	.superRefine((value, context) => {
		if (
			(value.invitationPreviousKeyId === undefined) !==
			(value.invitationPreviousKey === undefined)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["invitationPreviousKey"],
				message:
					"Previous invitation token key and KID must be configured together",
			});
		}
		if (value.invitationPreviousKeyId === value.invitationKeyId) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["invitationPreviousKeyId"],
				message: "Current and previous invitation token KIDs must differ",
			});
		}
		if (value.invitationPreviousKey === value.invitationKey) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["invitationPreviousKey"],
				message: "Current and previous invitation token keys must differ",
			});
		}
		const previousRecapFields = [
			value.recapShareTokenPreviousKeyId,
			value.recapShareTokenPreviousKey,
			value.recapShareTokenPreviousNotAfter,
		];
		if (
			previousRecapFields.some((item) => item !== undefined) &&
			previousRecapFields.some((item) => item === undefined)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recapShareTokenPreviousKey"],
				message:
					"Previous recap-share key, KID and retirement must be configured together",
			});
		}
		if (
			value.recapShareTokenPreviousKeyId ===
				value.recapShareTokenCurrentKeyId ||
			value.recapShareTokenPreviousKey === value.recapShareTokenCurrentKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recapShareTokenPreviousKeyId"],
				message: "Current and previous recap-share keys must differ",
			});
		}
		if (
			value.recapShareTokenCurrentKey === value.invitationKey ||
			value.recapShareTokenCurrentKey === value.invitationPreviousKey ||
			value.recapShareTokenCurrentKey === value.syncCursorKey ||
			value.recapShareTokenCurrentKey === value.attachmentGrantKey ||
			value.recapShareTokenCurrentKey === value.notificationPayloadCurrentKey ||
			value.recapShareTokenCurrentKey === value.placeSearchCursorKey ||
			value.recapShareTokenCurrentKey === value.placeCandidateServiceCurrentKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recapShareTokenCurrentKey"],
				message: "Recap-share tokens must have a separate secret domain",
			});
		}
		if (
			value.recapCaptionFieldRefPreviousKey ===
			value.recapCaptionFieldRefCurrentKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recapCaptionFieldRefPreviousKey"],
				message:
					"Current and previous recap-caption field-ref keys must differ",
			});
		}
		const otherSecretDomains = [
			value.invitationKey,
			value.invitationPreviousKey,
			value.recapShareTokenCurrentKey,
			value.recapShareTokenPreviousKey,
			value.syncCursorKey,
			value.attachmentGrantKey,
			value.attachmentPreviousGrantKey,
			value.notificationPayloadCurrentKey,
			value.placeSearchCursorKey,
			value.placeCandidateServiceCurrentKey,
			value.placeCandidateServicePreviousKey,
		];
		if (
			otherSecretDomains.includes(value.recapCaptionFieldRefCurrentKey) ||
			(value.recapCaptionFieldRefPreviousKey !== undefined &&
				otherSecretDomains.includes(value.recapCaptionFieldRefPreviousKey))
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["recapCaptionFieldRefCurrentKey"],
				message: "Recap-caption field refs must have a separate secret domain",
			});
		}
		if (
			value.syncCursorKey === value.invitationKey ||
			value.syncCursorKey === value.invitationPreviousKey ||
			value.syncCursorKey === value.attachmentGrantKey ||
			value.syncCursorKey === value.notificationPayloadCurrentKey ||
			value.syncCursorKey === value.placeSearchCursorKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["syncCursorKey"],
				message:
					"SYNC_CURSOR_KEY must differ from invitation, grant, notification and place-search keys",
			});
		}
		if (
			value.placeSearchCursorKey === value.invitationKey ||
			value.placeSearchCursorKey === value.invitationPreviousKey ||
			value.placeSearchCursorKey === value.attachmentGrantKey ||
			value.placeSearchCursorKey === value.notificationPayloadCurrentKey ||
			value.placeSearchCursorKey === value.placeCandidateServiceCurrentKey ||
			value.placeSearchCursorKey === value.placeCandidateServicePreviousKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["placeSearchCursorKey"],
				message: "Place-search cursors must have a separate secret domain",
			});
		}
		if (
			(value.placeCandidateServicePreviousKeyId === undefined) !==
			(value.placeCandidateServicePreviousKey === undefined)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["placeCandidateServicePreviousKey"],
				message:
					"Previous place-candidate service-auth key and KID must be configured together",
			});
		}
		if (
			value.placeCandidateServicePreviousKeyId !== undefined &&
			value.placeCandidateServicePreviousKeyId ===
				value.placeCandidateServiceCurrentKeyId
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["placeCandidateServicePreviousKeyId"],
				message:
					"Current and previous place-candidate service-auth KIDs must differ",
			});
		}
		if (
			value.placeCandidateServiceCurrentKey === value.invitationKey ||
			value.placeCandidateServiceCurrentKey === value.invitationPreviousKey ||
			value.placeCandidateServiceCurrentKey === value.syncCursorKey ||
			value.placeCandidateServiceCurrentKey === value.attachmentGrantKey ||
			value.placeCandidateServiceCurrentKey ===
				value.notificationPayloadCurrentKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["placeCandidateServiceCurrentKey"],
				message:
					"Place-candidate service-auth key must have a separate secret domain",
			});
		}
		if (
			value.placeCandidateServicePreviousKey !== undefined &&
			(value.placeCandidateServicePreviousKey ===
				value.placeCandidateServiceCurrentKey ||
				value.placeCandidateServicePreviousKey === value.invitationKey ||
				value.placeCandidateServicePreviousKey ===
					value.invitationPreviousKey ||
				value.placeCandidateServicePreviousKey === value.syncCursorKey ||
				value.placeCandidateServicePreviousKey === value.attachmentGrantKey ||
				value.placeCandidateServicePreviousKey ===
					value.notificationPayloadCurrentKey)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["placeCandidateServicePreviousKey"],
				message:
					"Previous place-candidate service-auth key must differ from current and other secret domains",
			});
		}
		if (
			(value.attachmentPreviousGrantKey === undefined) !==
			(value.attachmentPreviousGrantKid === undefined)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["attachmentPreviousGrantKey"],
				message:
					"Previous upload-grant key and KID must be configured together",
			});
		}
		if (
			value.attachmentPreviousGrantKid !== undefined &&
			value.attachmentPreviousGrantKid === value.attachmentGrantKid
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["attachmentPreviousGrantKid"],
				message: "Current and previous upload-grant KIDs must differ",
			});
		}
		if (
			value.attachmentPreviousGrantKey !== undefined &&
			value.attachmentPreviousGrantKey === value.attachmentGrantKey
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["attachmentPreviousGrantKey"],
				message: "Current and previous upload-grant keys must differ",
			});
		}
		if (
			[
				value.invitationKey,
				value.invitationPreviousKey,
				value.attachmentGrantKey,
				value.attachmentPreviousGrantKey,
			].includes(value.notificationPayloadCurrentKey)
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["notificationPayloadCurrentKey"],
				message:
					"Notification payload encryption must differ from invitation and attachment-grant domains",
			});
		}
		if (value.environment === "production") {
			if (new URL(value.userServiceJwksUrl).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["userServiceJwksUrl"],
					message: "USER_SERVICE_JWKS_URL must use HTTPS in production",
				});
			}
			if (value.databaseUrl === DEVELOPMENT_DATABASE_URL) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["databaseUrl"],
					message: "EVENT_DATABASE_URL must be configured in production",
				});
			}
			if (value.invitationKey === DEVELOPMENT_INVITATION_KEY) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["invitationKey"],
					message: "INVITATION_TOKEN_KEY must be configured in production",
				});
			}
			if (value.invitationPreviousKey === DEVELOPMENT_INVITATION_KEY) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["invitationPreviousKey"],
					message:
						"INVITATION_TOKEN_PREVIOUS_KEY must not use development material in production",
				});
			}
			if (
				value.recapShareTokenCurrentKey === DEVELOPMENT_RECAP_SHARE_TOKEN_KEY
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["recapShareTokenCurrentKey"],
					message:
						"RECAP_SHARE_TOKEN_CURRENT_KEY must be configured in production",
				});
			}
			if (value.recapExternalCaptionsEnabled) {
				const insecureKeys = [
					DEVELOPMENT_RECAP_CAPTION_FIELD_REF_KEY,
					COMPOSE_LOCAL_RECAP_CAPTION_FIELD_REF_KEY,
				];
				for (const [path, envName, key] of [
					[
						"recapCaptionFieldRefCurrentKey",
						"RECAP_CAPTION_FIELD_REF_CURRENT_KEY",
						value.recapCaptionFieldRefCurrentKey,
					],
					[
						"recapCaptionFieldRefPreviousKey",
						"RECAP_CAPTION_FIELD_REF_PREVIOUS_KEY",
						value.recapCaptionFieldRefPreviousKey,
					],
				] as const) {
					if (key !== undefined && insecureKeys.includes(key)) {
						context.addIssue({
							code: z.ZodIssueCode.custom,
							path: [path],
							message: `${envName} must not use development or Compose-local material when captions are enabled in production`,
						});
					}
				}
			}
			if (value.syncCursorKey === DEVELOPMENT_SYNC_CURSOR_KEY) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["syncCursorKey"],
					message: "SYNC_CURSOR_KEY must be configured in production",
				});
			}
			if (new URL(value.objectStoreEndpoint).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["objectStoreEndpoint"],
					message: "EVENT_OBJECT_STORE_ENDPOINT must use HTTPS in production",
				});
			}
			if (
				value.attachmentGrantKey === DEVELOPMENT_GRANT_KEY ||
				value.attachmentPreviousGrantKey === DEVELOPMENT_GRANT_KEY ||
				value.objectStoreAccessKeyId === DEVELOPMENT_OBJECT_ACCESS_KEY ||
				value.objectStoreSecretAccessKey === DEVELOPMENT_OBJECT_SECRET_KEY
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["objectStoreAccessKeyId"],
					message:
						"Object-store and upload-grant secrets must be configured in production",
				});
			}
			if (
				value.notificationPayloadCurrentKey ===
				DEVELOPMENT_NOTIFICATION_PAYLOAD_KEY
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["notificationPayloadCurrentKey"],
					message:
						"EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY must be configured in production",
				});
			}
			if (
				value.placeCandidateServiceCurrentKey ===
				DEVELOPMENT_PLACE_CANDIDATE_SERVICE_KEY
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["placeCandidateServiceCurrentKey"],
					message:
						"PLACE_CANDIDATE_SERVICE_CURRENT_KEY must be configured in production",
				});
			}
			if (new URL(value.typesenseUrl).protocol !== "https:") {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["typesenseUrl"],
					message: "PLACE_SEARCH_TYPESENSE_URL must use HTTPS in production",
				});
			}
			if (value.placeSearchCursorKey === DEVELOPMENT_PLACE_SEARCH_CURSOR_KEY) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["placeSearchCursorKey"],
					message: "PLACE_SEARCH_CURSOR_KEY must be configured in production",
				});
			}
			if (
				value.typesenseSearchApiKey === DEVELOPMENT_TYPESENSE_SEARCH_API_KEY
			) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["typesenseSearchApiKey"],
					message:
						"PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY must be configured in production",
				});
			}
		}
	});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(
	env: Record<string, string | undefined> = Bun.env,
): Config {
	return ConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		host: env.HOST ?? "0.0.0.0",
		port: env.PORT ?? "3002",
		databaseUrl:
			env.EVENT_DATABASE_URL ?? env.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
		invitationKeyId:
			env.INVITATION_TOKEN_CURRENT_KEY_ID ?? "legacy-invitation-v1",
		invitationKey: env.INVITATION_TOKEN_KEY ?? DEVELOPMENT_INVITATION_KEY,
		invitationPreviousKeyId: optionalEnv(env.INVITATION_TOKEN_PREVIOUS_KEY_ID),
		invitationPreviousKey: optionalEnv(env.INVITATION_TOKEN_PREVIOUS_KEY),
		recapShareTokenCurrentKeyId:
			env.RECAP_SHARE_TOKEN_CURRENT_KEY_ID ?? "development-v1",
		recapShareTokenCurrentKey:
			env.RECAP_SHARE_TOKEN_CURRENT_KEY ?? DEVELOPMENT_RECAP_SHARE_TOKEN_KEY,
		recapShareTokenPreviousKeyId: optionalEnv(
			env.RECAP_SHARE_TOKEN_PREVIOUS_KEY_ID,
		),
		recapShareTokenPreviousKey: optionalEnv(env.RECAP_SHARE_TOKEN_PREVIOUS_KEY),
		recapShareTokenPreviousNotAfter: optionalEnv(
			env.RECAP_SHARE_TOKEN_PREVIOUS_NOT_AFTER,
		),
		recapExternalCaptionsEnabled:
			env.RECAP_EXTERNAL_CAPTIONS_ENABLED ?? "false",
		recapCaptionFieldRefCurrentKey:
			env.RECAP_CAPTION_FIELD_REF_CURRENT_KEY ??
			DEVELOPMENT_RECAP_CAPTION_FIELD_REF_KEY,
		recapCaptionFieldRefPreviousKey: optionalEnv(
			env.RECAP_CAPTION_FIELD_REF_PREVIOUS_KEY,
		),
		syncCursorKey: env.SYNC_CURSOR_KEY ?? DEVELOPMENT_SYNC_CURSOR_KEY,
		userServiceJwksUrl:
			env.USER_SERVICE_JWKS_URL ??
			"http://localhost:3001/.well-known/jwks.json",
		userTokenIssuer: env.USER_TOKEN_ISSUER ?? "crew-user-service",
		userTokenAudience: env.USER_TOKEN_AUDIENCE ?? "crew-mobile",
		jwksCacheMs: env.JWKS_CACHE_MS ?? "600000",
		jwksCooldownMs: env.JWKS_COOLDOWN_MS ?? "30000",
		jwksTimeoutMs: env.JWKS_TIMEOUT_MS ?? "2000",
		attachmentGrantKey: env.ATTACHMENT_GRANT_KEY ?? DEVELOPMENT_GRANT_KEY,
		attachmentGrantKid: env.ATTACHMENT_GRANT_KID ?? "development-v1",
		attachmentPreviousGrantKey: env.ATTACHMENT_PREVIOUS_GRANT_KEY,
		attachmentPreviousGrantKid: env.ATTACHMENT_PREVIOUS_GRANT_KID,
		objectStoreEndpoint:
			env.EVENT_OBJECT_STORE_ENDPOINT ?? DEVELOPMENT_OBJECT_ENDPOINT,
		objectStoreRegion: env.EVENT_OBJECT_STORE_REGION ?? "us-east-1",
		objectStoreBucket:
			env.EVENT_OBJECT_STORE_BUCKET ?? "crew-event-development",
		objectStoreAccessKeyId:
			env.EVENT_OBJECT_STORE_ACCESS_KEY_ID ?? DEVELOPMENT_OBJECT_ACCESS_KEY,
		objectStoreSecretAccessKey:
			env.EVENT_OBJECT_STORE_SECRET_ACCESS_KEY ?? DEVELOPMENT_OBJECT_SECRET_KEY,
		attachmentUploadTtlSeconds:
			env.ATTACHMENT_UPLOAD_PRESIGN_TTL_SECONDS ?? "300",
		attachmentDownloadTtlSeconds:
			env.ATTACHMENT_DOWNLOAD_PRESIGN_TTL_SECONDS ?? "60",
		notificationPayloadCurrentKeyId:
			env.EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY_ID ?? "development-v1",
		notificationPayloadCurrentKey:
			env.EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY ??
			DEVELOPMENT_NOTIFICATION_PAYLOAD_KEY,
		placeCandidateServiceIssuer:
			env.PLACE_CANDIDATE_SERVICE_ISSUER ?? "crew-place-catalog",
		placeCandidateServiceAudience:
			env.PLACE_CANDIDATE_SERVICE_AUDIENCE ?? "crew-event-service",
		placeCandidateServiceCurrentKeyId:
			env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY_ID ?? "development-v1",
		placeCandidateServiceCurrentKey:
			env.PLACE_CANDIDATE_SERVICE_CURRENT_KEY ??
			DEVELOPMENT_PLACE_CANDIDATE_SERVICE_KEY,
		placeCandidateServicePreviousKeyId:
			env.PLACE_CANDIDATE_SERVICE_PREVIOUS_KEY_ID,
		placeCandidateServicePreviousKey: env.PLACE_CANDIDATE_SERVICE_PREVIOUS_KEY,
		placeSearchCursorKey:
			env.PLACE_SEARCH_CURSOR_KEY ?? DEVELOPMENT_PLACE_SEARCH_CURSOR_KEY,
		typesenseUrl: env.PLACE_SEARCH_TYPESENSE_URL ?? DEVELOPMENT_TYPESENSE_URL,
		typesenseSearchApiKey:
			env.PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY ??
			DEVELOPMENT_TYPESENSE_SEARCH_API_KEY,
		typesensePlaceAlias: env.PLACE_SEARCH_TYPESENSE_ALIAS ?? "crew_places",
		typesenseTimeoutMs: env.PLACE_SEARCH_TYPESENSE_TIMEOUT_MS ?? "2000",
		placeEnrichmentEnabled: env.EVENT_ENRICHMENT_ENABLED ?? "false",
	});
}

function optionalEnv(value: string | undefined) {
	return value?.trim() || undefined;
}
