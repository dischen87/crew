import type { Sql } from "postgres";
import { createId } from "./auth";
import type {
	AuthResult,
	Device,
	DeviceInput,
	IdempotencyInput,
	IdempotencyResult,
	MagicLinkWithDeliveryInput,
	MemberDirectoryProfile,
	Profile,
	ProfilePatch,
	PushNotificationIngressInput,
	RedeemMagicLinkInput,
	RefreshResult,
	StoredResponse,
	User,
	UserRepository,
} from "./repository";
import {
	MAX_PUSH_FANOUT_DEVICES,
	PushFanoutLimitExceededError,
} from "./repository";

type AuthRow = {
	id: string;
	email: string;
	createdAt: Date;
	profileUserId: string;
	displayName: string | null;
	avatarUrl: string | null;
	locale: string;
	timeZone: string;
	reduceMotion: boolean;
	eventReminders: boolean;
	productUpdates: boolean;
	version: number;
	updatedAt: Date;
};

type ProfileRow = Omit<Profile, "userId"> & { userId: string };
type DeviceRow = Omit<Device, "userId"> & { userId: string };
type IdempotencyRow = {
	fingerprint: string;
	state: "pending" | "completed";
	responseStatus: number | null;
	responsePayload: string | null;
	responseHeaders: Record<string, string> | null;
	active: boolean;
};

async function cleanupExpiredIdempotency(
	sql: Sql,
	input: Pick<IdempotencyInput, "scope" | "operationId" | "key">,
) {
	await sql`
		DELETE FROM user_idempotency_records
		WHERE scope = ${input.scope}
			AND operation_id = ${input.operationId}
			AND idempotency_key = ${input.key}
			AND expires_at <= clock_timestamp()
	`;
	await sql`
		DELETE FROM user_idempotency_records
		WHERE ctid IN (
			SELECT ctid FROM user_idempotency_records
			WHERE expires_at <= clock_timestamp()
			ORDER BY expires_at
			LIMIT 100
			FOR UPDATE SKIP LOCKED
		)
	`;
}

type EligiblePushDeviceRow = {
	id: string;
	pushToken: string;
	locale: string;
};

export class PostgresUserRepository implements UserRepository {
	constructor(
		private readonly sql: Sql,
		private readonly inTransaction = false,
	) {}

	async executeIdempotent(
		input: IdempotencyInput,
		operation: (repository: UserRepository) => Promise<StoredResponse>,
		replayGuard?: (
			repository: UserRepository,
			response: StoredResponse,
		) => Promise<void>,
	): Promise<IdempotencyResult> {
		return this.transaction(async (sql) => {
			const lockName = JSON.stringify([
				input.scope,
				input.operationId,
				input.key,
			]);
			const [lock] = await sql<{ acquired: boolean }[]>`
				SELECT pg_try_advisory_xact_lock(
					hashtextextended(${lockName}, 0)
				) AS acquired
			`;
			if (!lock?.acquired) return { kind: "in_progress" };
			await cleanupExpiredIdempotency(sql, input);

			const [existing] = await sql<IdempotencyRow[]>`
				SELECT
					fingerprint,
					state,
					response_status AS "responseStatus",
					response_payload AS "responsePayload",
					response_headers AS "responseHeaders",
					expires_at > clock_timestamp() AS active
				FROM user_idempotency_records
				WHERE scope = ${input.scope}
					AND operation_id = ${input.operationId}
					AND idempotency_key = ${input.key}
				FOR UPDATE
			`;
			if (existing) {
				if (!existing.active)
					throw new Error("Expired idempotency cleanup invariant failed");
				if (existing.fingerprint !== input.fingerprint)
					return { kind: "conflict" };
				if (
					existing.state !== "completed" ||
					existing.responseStatus === null ||
					existing.responsePayload === null ||
					existing.responseHeaders === null
				) {
					return { kind: "in_progress" };
				}
				const response = {
					status: existing.responseStatus,
					body: existing.responsePayload,
					headers: existing.responseHeaders,
				};
				await replayGuard?.(new PostgresUserRepository(sql, true), response);
				return {
					kind: "replayed",
					response,
				};
			}

			await sql`
				INSERT INTO user_idempotency_records (
					scope,
					operation_id,
					idempotency_key,
					fingerprint,
					state,
					created_at,
					expires_at
				)
				VALUES (
					${input.scope},
					${input.operationId},
					${input.key},
					${input.fingerprint},
					'pending',
						clock_timestamp(),
						clock_timestamp() + interval '30 days'
				)
			`;
			const response = await operation(new PostgresUserRepository(sql, true));
			await sql`
				UPDATE user_idempotency_records
				SET state = 'completed',
					response_status = ${response.status},
					response_payload = ${response.body},
					response_headers = ${sql.json(response.headers)},
					completed_at = clock_timestamp()
				WHERE scope = ${input.scope}
					AND operation_id = ${input.operationId}
					AND idempotency_key = ${input.key}
			`;
			return { kind: "executed", response };
		});
	}

	async isRefreshSessionActive(refreshTokenHash: string, _now: Date) {
		const [result] = await this.sql<{ active: boolean }[]>`
			SELECT EXISTS (
				SELECT 1
				FROM user_sessions session
				JOIN user_session_families family ON family.id = session.family_id
				WHERE session.refresh_token_hash = ${refreshTokenHash}
					AND session.expires_at > clock_timestamp()
					AND session.revoked_at IS NULL
					AND session.replaced_by_session_id IS NULL
					AND session.rotated_at IS NULL
					AND family.revoked_at IS NULL
			) AS active
		`;
		return result?.active ?? false;
	}

	async createMagicLink(input: {
		id: string;
		email: string;
		tokenHash: string;
		expiresAt: Date;
	}) {
		await this.sql`
      INSERT INTO user_magic_links (id, email, token_hash, expires_at)
      VALUES (
        ${input.id},
        ${normalizeEmail(input.email)},
        ${input.tokenHash},
        ${input.expiresAt}
      )
    `;
	}

	async createMagicLinkWithDelivery(input: MagicLinkWithDeliveryInput) {
		await this.transaction(async (sql) => {
			await sql`
				INSERT INTO user_magic_links (id, email, token_hash, expires_at, created_at)
				VALUES (
					${input.link.id},
					${normalizeEmail(input.link.email)},
					${input.link.tokenHash},
					${input.link.expiresAt},
					${input.delivery.createdAt}
				)
			`;
			await sql`
				INSERT INTO user_delivery_outbox (
					id,
					magic_link_id,
					kind,
					sealed_payload,
					token_expires_at,
					available_at,
					created_at,
					updated_at
				)
				VALUES (
					${input.delivery.id},
					${input.link.id},
					'magic_link',
					${input.delivery.sealedPayload},
					${input.link.expiresAt},
					${input.delivery.createdAt},
					${input.delivery.createdAt},
					${input.delivery.createdAt}
				)
			`;
		});
	}

	async enqueuePushNotification(input: PushNotificationIngressInput) {
		if (input.expiresAt <= input.createdAt) return 0;
		return this.transaction(async (sql) => {
			await lockPushFanout(sql, input.recipientUserId);
			const devices = await sql<EligiblePushDeviceRow[]>`
				SELECT
					d.id,
					d.push_token AS "pushToken",
					d.locale
				FROM user_profiles AS p
				JOIN user_devices AS d ON d.user_id = p.user_id
				WHERE p.user_id = ${input.recipientUserId}
					AND p.event_reminders = TRUE
					AND d.notifications_enabled = TRUE
					AND d.push_token IS NOT NULL
					AND d.push_token <> ''
				ORDER BY d.id
				LIMIT ${MAX_PUSH_FANOUT_DEVICES + 1}
				FOR SHARE OF p, d
			`;
			if (devices.length > MAX_PUSH_FANOUT_DEVICES) {
				throw new PushFanoutLimitExceededError();
			}
			let queued = 0;
			for (const device of devices) {
				const id = createId("pjob");
				const sealedPayload = input.payloads.seal(
					{
						jobId: id,
						eventJobId: input.eventJobId,
						recipientUserId: input.recipientUserId,
						deviceId: device.id,
						requestId: input.requestId,
						causationRequestId: input.causationRequestId,
						expiresAt: input.expiresAt,
					},
					{
						pushToken: device.pushToken,
						category: input.category,
						templateKey: input.templateKey,
						deepLink: input.deepLink,
						locale: device.locale,
						expiresAt: input.expiresAt,
					},
				);
				const inserted = await sql<{ id: string }[]>`
					INSERT INTO user_push_outbox (
						id,
						event_job_id,
						recipient_user_id,
						device_id,
						request_id,
						causation_request_id,
						sealed_payload,
						expires_at,
						available_at,
						created_at,
						updated_at
					)
					VALUES (
						${id},
						${input.eventJobId},
						${input.recipientUserId},
						${device.id},
						${input.requestId},
						${input.causationRequestId},
						${sealedPayload},
						${input.expiresAt},
						${input.createdAt},
						${input.createdAt},
						${input.createdAt}
					)
					ON CONFLICT (event_job_id, device_id) DO NOTHING
					RETURNING id
				`;
				queued += inserted.length;
			}
			return queued;
		});
	}

	async redeemMagicLink(
		input: RedeemMagicLinkInput,
	): Promise<AuthResult | null> {
		return this.transaction(async (sql) => {
			const [link] = await sql<{ email: string }[]>`
        UPDATE user_magic_links
        SET consumed_at = ${input.now}
        WHERE token_hash = ${input.tokenHash}
          AND consumed_at IS NULL
          AND expires_at > ${input.now}
        RETURNING email
      `;
			if (!link) return null;

			const [user] = await sql<User[]>`
        INSERT INTO users (id, email, email_verified_at, created_at)
        VALUES (${input.newUserId}, ${link.email}, ${input.now}, ${input.now})
        ON CONFLICT (email) DO UPDATE
        SET email_verified_at = COALESCE(users.email_verified_at, EXCLUDED.email_verified_at)
        RETURNING id, email, created_at AS "createdAt"
      `;
			if (!user) throw new Error("User repository invariant failed");

			await sql`
        INSERT INTO user_profiles (user_id, updated_at)
        VALUES (${user.id}, ${input.now})
        ON CONFLICT (user_id) DO NOTHING
      `;
			await sql`
        INSERT INTO user_session_families (id, user_id, created_at)
        VALUES (${input.newSessionId}, ${user.id}, ${input.now})
      `;
			await sql`
        INSERT INTO user_sessions (
          id,
          user_id,
          family_id,
          refresh_token_hash,
          expires_at,
          created_at
        )
        VALUES (
          ${input.newSessionId},
          ${user.id},
          ${input.newSessionId},
          ${input.refreshTokenHash},
          ${input.sessionExpiresAt},
          ${input.now}
        )
      `;

			const [auth] = await sql<AuthRow[]>`
        SELECT
          users.id,
          users.email,
          users.created_at AS "createdAt",
          user_profiles.user_id AS "profileUserId",
          user_profiles.display_name AS "displayName",
          user_profiles.avatar_url AS "avatarUrl",
          user_profiles.locale,
          user_profiles.time_zone AS "timeZone",
          user_profiles.reduce_motion AS "reduceMotion",
          user_profiles.event_reminders AS "eventReminders",
          user_profiles.product_updates AS "productUpdates",
          user_profiles.version,
          user_profiles.updated_at AS "updatedAt"
        FROM users
        JOIN user_profiles ON user_profiles.user_id = users.id
        WHERE users.id = ${user.id}
      `;
			if (!auth) throw new Error("User repository invariant failed");
			return toAuthResult(auth, input.newSessionId);
		});
	}

	async rotateRefreshToken(input: {
		tokenHash: string;
		now: Date;
		newSessionId: string;
		newRefreshTokenHash: string;
		sessionExpiresAt: Date;
	}): Promise<RefreshResult> {
		return this.transaction(async (sql) => {
			const [candidate] = await sql<{ familyId: string }[]>`
        SELECT family_id AS "familyId"
        FROM user_sessions
        WHERE refresh_token_hash = ${input.tokenHash}
      `;
			if (!candidate) return { kind: "invalid" };

			const [family] = await sql<{ revokedAt: Date | null }[]>`
        SELECT revoked_at AS "revokedAt"
        FROM user_session_families
        WHERE id = ${candidate.familyId}
        FOR UPDATE
      `;
			const [session] = await sql<
				{
					userId: string;
					familyId: string;
					expiresAt: Date;
					replacedBySessionId: string | null;
					rotatedAt: Date | null;
					revokedAt: Date | null;
				}[]
			>`
        SELECT
          user_id AS "userId",
          family_id AS "familyId",
          expires_at AS "expiresAt",
          replaced_by_session_id AS "replacedBySessionId",
          rotated_at AS "rotatedAt",
          revoked_at AS "revokedAt"
        FROM user_sessions
        WHERE refresh_token_hash = ${input.tokenHash}
        FOR UPDATE
      `;
			if (!family || !session || session.expiresAt <= input.now) {
				return { kind: "invalid" };
			}

			if (
				family.revokedAt ||
				session.revokedAt ||
				session.replacedBySessionId
			) {
				await sql`
          UPDATE user_session_families
          SET revoked_at = COALESCE(revoked_at, ${input.now})
          WHERE id = ${session.familyId}
        `;
				await sql`
          UPDATE user_sessions
          SET revoked_at = COALESCE(revoked_at, ${input.now})
          WHERE family_id = ${session.familyId}
        `;
				return { kind: "reuse" };
			}

			await sql`
        INSERT INTO user_sessions (
          id,
          user_id,
          family_id,
          refresh_token_hash,
          expires_at,
          created_at
        )
        VALUES (
          ${input.newSessionId},
          ${session.userId},
          ${session.familyId},
          ${input.newRefreshTokenHash},
          ${input.sessionExpiresAt},
          ${input.now}
        )
      `;
			await sql`
        UPDATE user_sessions
        SET replaced_by_session_id = ${input.newSessionId}, rotated_at = ${input.now}
        WHERE refresh_token_hash = ${input.tokenHash}
      `;

			const [auth] = await sql<AuthRow[]>`
        SELECT
          users.id,
          users.email,
          users.created_at AS "createdAt",
          user_profiles.user_id AS "profileUserId",
          user_profiles.display_name AS "displayName",
          user_profiles.avatar_url AS "avatarUrl",
          user_profiles.locale,
          user_profiles.time_zone AS "timeZone",
          user_profiles.reduce_motion AS "reduceMotion",
          user_profiles.event_reminders AS "eventReminders",
          user_profiles.product_updates AS "productUpdates",
          user_profiles.version,
          user_profiles.updated_at AS "updatedAt"
        FROM users
        JOIN user_profiles ON user_profiles.user_id = users.id
        WHERE users.id = ${session.userId}
      `;
			if (!auth) throw new Error("User repository invariant failed");
			return { kind: "ok", ...toAuthResult(auth, input.newSessionId) };
		});
	}

	async revokeSessionFamily(userId: string, sessionId: string, now: Date) {
		await this.transaction(async (sql) => {
			const [candidate] = await sql<{ familyId: string }[]>`
				SELECT family_id AS "familyId"
				FROM user_sessions
				WHERE user_id = ${userId} AND id = ${sessionId}
			`;
			if (!candidate) return;
			const [family] = await sql<{ id: string }[]>`
				SELECT id
				FROM user_session_families
				WHERE id = ${candidate.familyId} AND user_id = ${userId}
				FOR UPDATE
			`;
			if (!family) return;
			await sql`
				UPDATE user_session_families
				SET revoked_at = COALESCE(revoked_at, ${now})
				WHERE id = ${family.id}
			`;
			await sql`
				UPDATE user_sessions
				SET revoked_at = COALESCE(revoked_at, ${now})
				WHERE family_id = ${family.id}
			`;
		});
	}

	async getUser(userId: string): Promise<User | null> {
		const [user] = await this.sql<User[]>`
      SELECT id, email, created_at AS "createdAt"
      FROM users
      WHERE id = ${userId}
    `;
		return user ?? null;
	}

	async getProfile(userId: string): Promise<Profile | null> {
		const [profile] = await this.sql<ProfileRow[]>`
      SELECT
        user_id AS "userId",
        display_name AS "displayName",
        avatar_url AS "avatarUrl",
        locale,
        time_zone AS "timeZone",
        reduce_motion AS "reduceMotion",
        event_reminders AS "eventReminders",
        product_updates AS "productUpdates",
        version,
        updated_at AS "updatedAt"
      FROM user_profiles
      WHERE user_id = ${userId}
    `;
		return profile ?? null;
	}

	async resolveMemberDirectoryProfiles(
		userIds: readonly string[],
	): Promise<MemberDirectoryProfile[]> {
		if (userIds.length === 0) return [];
		return this.sql<MemberDirectoryProfile[]>`
			SELECT
				profile.user_id AS "userId",
				profile.display_name AS "displayName",
				profile.version
			FROM unnest(${this.sql.array([...userIds])}::text[]) WITH ORDINALITY requested(user_id, ordinal)
			JOIN user_profiles profile ON profile.user_id = requested.user_id
			ORDER BY requested.ordinal
		`;
	}

	async updateProfile(
		userId: string,
		baseVersion: number,
		patch: ProfilePatch,
		now: Date,
	): Promise<Profile | null> {
		const update: Record<string, string | number | boolean | Date | null> = {
			version: baseVersion + 1,
			updated_at: now,
		};
		if (Object.hasOwn(patch, "displayName"))
			update.display_name = patch.displayName ?? null;
		if (Object.hasOwn(patch, "avatarUrl"))
			update.avatar_url = patch.avatarUrl ?? null;
		if (patch.locale !== undefined) update.locale = patch.locale;
		if (patch.timeZone !== undefined) update.time_zone = patch.timeZone;
		if (patch.reduceMotion !== undefined)
			update.reduce_motion = patch.reduceMotion;
		if (patch.eventReminders !== undefined)
			update.event_reminders = patch.eventReminders;
		if (patch.productUpdates !== undefined)
			update.product_updates = patch.productUpdates;

		const [profile] = await this.sql<ProfileRow[]>`
      UPDATE user_profiles
      SET ${this.sql(update)}
      WHERE user_id = ${userId} AND version = ${baseVersion}
      RETURNING
        user_id AS "userId",
        display_name AS "displayName",
        avatar_url AS "avatarUrl",
        locale,
        time_zone AS "timeZone",
        reduce_motion AS "reduceMotion",
        event_reminders AS "eventReminders",
        product_updates AS "productUpdates",
        version,
        updated_at AS "updatedAt"
    `;
		return profile ?? null;
	}

	async listDevices(userId: string): Promise<Device[]> {
		return this.sql<DeviceRow[]>`
      SELECT
        id,
        user_id AS "userId",
        installation_id AS "installationId",
        platform,
        push_token AS "pushToken",
        locale,
        time_zone AS "timeZone",
        app_version AS "appVersion",
        notifications_enabled AS "notificationsEnabled",
        updated_at AS "updatedAt"
      FROM user_devices
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC, id DESC
    `;
	}

	async upsertDevice(
		userId: string,
		input: DeviceInput,
		now: Date,
	): Promise<Device> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			await lockPushFanout(sql, userId);
			if (input.pushToken) {
				await sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${input.pushToken}, 0))
        `;
				await sql`
          UPDATE user_devices
          SET push_token = NULL,
              notifications_enabled = FALSE,
              updated_at = ${now}
          WHERE push_token = ${input.pushToken}
            AND (user_id <> ${userId} OR installation_id <> ${input.installationId})
        `;
			}

			const [device] = await sql<DeviceRow[]>`
      INSERT INTO user_devices (
        id,
        user_id,
        installation_id,
        platform,
        push_token,
        locale,
        time_zone,
        app_version,
        notifications_enabled,
        updated_at
      )
      VALUES (
        ${createId("dev")},
        ${userId},
        ${input.installationId},
        ${input.platform},
        ${input.pushToken},
        ${input.locale},
        ${input.timeZone},
        ${input.appVersion},
        ${input.notificationsEnabled},
        ${now}
      )
      ON CONFLICT (user_id, installation_id) DO UPDATE SET
        platform = EXCLUDED.platform,
        push_token = EXCLUDED.push_token,
        locale = EXCLUDED.locale,
        time_zone = EXCLUDED.time_zone,
        app_version = EXCLUDED.app_version,
        notifications_enabled = EXCLUDED.notifications_enabled,
        updated_at = EXCLUDED.updated_at
      RETURNING
        id,
        user_id AS "userId",
        installation_id AS "installationId",
        platform,
        push_token AS "pushToken",
        locale,
        time_zone AS "timeZone",
        app_version AS "appVersion",
        notifications_enabled AS "notificationsEnabled",
        updated_at AS "updatedAt"
    `;
			if (!device) throw new Error("User repository invariant failed");
			return device;
		});
	}

	async removeDevice(userId: string, installationId: string): Promise<boolean> {
		const removed = await this.sql<{ id: string }[]>`
      DELETE FROM user_devices
      WHERE user_id = ${userId} AND installation_id = ${installationId}
      RETURNING id
    `;
		return removed.length > 0;
	}

	private transaction<T>(operation: (sql: Sql) => Promise<T>): Promise<T> {
		if (this.inTransaction) return operation(this.sql);
		return this.sql.begin((transaction) =>
			operation(transaction as unknown as Sql),
		) as Promise<T>;
	}
}

function normalizeEmail(email: string) {
	return email.trim().toLowerCase();
}

function lockPushFanout(sql: Sql, userId: string) {
	return sql`
		SELECT pg_advisory_xact_lock(
			hashtextextended(${`crew:user-service:push-fanout:${userId}`}, 0)
		)
	`;
}

function toAuthResult(row: AuthRow, sessionId: string): AuthResult {
	return {
		user: { id: row.id, email: row.email, createdAt: row.createdAt },
		profile: {
			userId: row.profileUserId,
			displayName: row.displayName,
			avatarUrl: row.avatarUrl,
			locale: row.locale,
			timeZone: row.timeZone,
			reduceMotion: row.reduceMotion,
			eventReminders: row.eventReminders,
			productUpdates: row.productUpdates,
			version: row.version,
			updatedAt: row.updatedAt,
		},
		sessionId,
	};
}
