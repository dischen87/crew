import { createId } from "./auth";
import type {
	PushCategory,
	PushDeepLink,
	PushPayloadKeyring,
	PushTemplateKey,
} from "./push-payload";

export const MAX_PUSH_FANOUT_DEVICES = 20;

export class PushFanoutLimitExceededError extends Error {}

export type User = {
	id: string;
	email: string;
	createdAt: Date;
};

export type Profile = {
	userId: string;
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

export type MemberDirectoryProfile = Pick<
	Profile,
	"userId" | "displayName" | "version"
>;

export type ProfilePatch = Partial<
	Pick<
		Profile,
		| "displayName"
		| "avatarUrl"
		| "locale"
		| "timeZone"
		| "reduceMotion"
		| "eventReminders"
		| "productUpdates"
	>
>;

export type Device = {
	id: string;
	userId: string;
	installationId: string;
	platform: "ios" | "android";
	pushToken: string | null;
	locale: string;
	timeZone: string;
	appVersion: string;
	notificationsEnabled: boolean;
	updatedAt: Date;
};

export type DeviceInput = Omit<Device, "id" | "userId" | "updatedAt">;

export type RedeemMagicLinkInput = {
	tokenHash: string;
	now: Date;
	newUserId: string;
	newSessionId: string;
	refreshTokenHash: string;
	sessionExpiresAt: Date;
};

export type AuthResult = {
	user: User;
	profile: Profile;
	sessionId: string;
};

export type RefreshResult =
	| ({ kind: "ok" } & AuthResult)
	| { kind: "invalid" }
	| { kind: "reuse" };

export type IdempotencyInput = {
	scope: string;
	operationId: string;
	key: string;
	fingerprint: string;
	now: Date;
	expiresAt: Date;
};

export type StoredResponse = {
	status: number;
	body: string;
	headers: Record<string, string>;
};

export type IdempotencyResult =
	| { kind: "executed" | "replayed"; response: StoredResponse }
	| { kind: "conflict" }
	| { kind: "in_progress" };

export type MagicLinkWithDeliveryInput = {
	link: {
		id: string;
		email: string;
		tokenHash: string;
		expiresAt: Date;
	};
	delivery: {
		id: string;
		sealedPayload: string;
		createdAt: Date;
	};
};

export type PushNotificationIngressInput = {
	eventJobId: string;
	recipientUserId: string;
	category: PushCategory;
	templateKey: PushTemplateKey;
	deepLink: PushDeepLink;
	expiresAt: Date;
	requestId: string;
	causationRequestId: string;
	createdAt: Date;
	payloads: PushPayloadKeyring;
};

export interface UserRepository {
	executeIdempotent(
		input: IdempotencyInput,
		operation: (repository: UserRepository) => Promise<StoredResponse>,
		replayGuard?: (
			repository: UserRepository,
			response: StoredResponse,
		) => Promise<void>,
	): Promise<IdempotencyResult>;
	isRefreshSessionActive(refreshTokenHash: string, now: Date): Promise<boolean>;
	createMagicLink(input: {
		id: string;
		email: string;
		tokenHash: string;
		expiresAt: Date;
	}): Promise<void>;
	createMagicLinkWithDelivery(input: MagicLinkWithDeliveryInput): Promise<void>;
	enqueuePushNotification(input: PushNotificationIngressInput): Promise<number>;
	redeemMagicLink(input: RedeemMagicLinkInput): Promise<AuthResult | null>;
	rotateRefreshToken(input: {
		tokenHash: string;
		now: Date;
		newSessionId: string;
		newRefreshTokenHash: string;
		sessionExpiresAt: Date;
	}): Promise<RefreshResult>;
	revokeSessionFamily(
		userId: string,
		sessionId: string,
		now: Date,
	): Promise<void>;
	getUser(userId: string): Promise<User | null>;
	getProfile(userId: string): Promise<Profile | null>;
	resolveMemberDirectoryProfiles(
		userIds: readonly string[],
	): Promise<MemberDirectoryProfile[]>;
	updateProfile(
		userId: string,
		baseVersion: number,
		patch: ProfilePatch,
		now: Date,
	): Promise<Profile | null>;
	listDevices(userId: string): Promise<Device[]>;
	upsertDevice(userId: string, input: DeviceInput, now: Date): Promise<Device>;
	removeDevice(userId: string, installationId: string): Promise<boolean>;
}

type MagicLink = {
	id: string;
	email: string;
	tokenHash: string;
	expiresAt: Date;
	consumedAt: Date | null;
};

export type InMemoryDeliveryJob = {
	id: string;
	magicLinkId: string;
	sealedPayload: string;
	expiresAt: Date;
	createdAt: Date;
};

export type InMemoryPushJob = {
	id: string;
	eventJobId: string;
	recipientUserId: string;
	deviceId: string;
	sealedPayload: string;
	expiresAt: Date;
	requestId: string;
	causationRequestId: string;
	createdAt: Date;
};

type Session = {
	id: string;
	userId: string;
	familyId: string;
	refreshTokenHash: string;
	expiresAt: Date;
	replacedBySessionId: string | null;
	rotatedAt: Date | null;
	revokedAt: Date | null;
};

type InMemoryIdempotencyRecord = {
	fingerprint: string;
	state: "pending" | "completed";
	response?: StoredResponse;
	expiresAt: Date;
};

export class InMemoryUserRepository implements UserRepository {
	readonly users = new Map<string, User>();
	readonly profiles = new Map<string, Profile>();
	readonly devices = new Map<string, Device>();
	private readonly userIdByEmail = new Map<string, string>();
	private readonly magicLinks = new Map<string, MagicLink>();
	readonly deliveryJobs = new Map<string, InMemoryDeliveryJob>();
	readonly pushJobs = new Map<string, InMemoryPushJob>();
	private readonly sessions = new Map<string, Session>();
	private readonly idempotency = new Map<string, InMemoryIdempotencyRecord>();

	async executeIdempotent(
		input: IdempotencyInput,
		operation: (repository: UserRepository) => Promise<StoredResponse>,
		replayGuard?: (
			repository: UserRepository,
			response: StoredResponse,
		) => Promise<void>,
	): Promise<IdempotencyResult> {
		const storageKey = `${input.scope}\0${input.operationId}\0${input.key}`;
		const existing = this.idempotency.get(storageKey);
		if (existing && existing.expiresAt > input.now) {
			if (existing.fingerprint !== input.fingerprint)
				return { kind: "conflict" };
			if (existing.state === "pending") return { kind: "in_progress" };
			if (!existing.response)
				throw new Error("Idempotency repository invariant failed");
			await replayGuard?.(this, existing.response);
			return {
				kind: "replayed",
				response: structuredClone(existing.response),
			};
		}
		if (existing) this.idempotency.delete(storageKey);

		this.idempotency.set(storageKey, {
			fingerprint: input.fingerprint,
			state: "pending",
			expiresAt: input.expiresAt,
		});
		const snapshot = structuredClone({
			users: this.users,
			profiles: this.profiles,
			devices: this.devices,
			userIdByEmail: this.userIdByEmail,
			magicLinks: this.magicLinks,
			deliveryJobs: this.deliveryJobs,
			pushJobs: this.pushJobs,
			sessions: this.sessions,
		});
		try {
			const response = await operation(this);
			this.idempotency.set(storageKey, {
				fingerprint: input.fingerprint,
				state: "completed",
				response: structuredClone(response),
				expiresAt: input.expiresAt,
			});
			return { kind: "executed", response };
		} catch (error) {
			restoreMap(this.users, snapshot.users);
			restoreMap(this.profiles, snapshot.profiles);
			restoreMap(this.devices, snapshot.devices);
			restoreMap(this.userIdByEmail, snapshot.userIdByEmail);
			restoreMap(this.magicLinks, snapshot.magicLinks);
			restoreMap(this.deliveryJobs, snapshot.deliveryJobs);
			restoreMap(this.pushJobs, snapshot.pushJobs);
			restoreMap(this.sessions, snapshot.sessions);
			this.idempotency.delete(storageKey);
			throw error;
		}
	}

	async isRefreshSessionActive(refreshTokenHash: string, now: Date) {
		const session = [...this.sessions.values()].find(
			(candidate) => candidate.refreshTokenHash === refreshTokenHash,
		);
		if (
			!session ||
			session.expiresAt <= now ||
			session.revokedAt !== null ||
			session.replacedBySessionId !== null ||
			session.rotatedAt !== null
		)
			return false;
		return ![...this.sessions.values()].some(
			(candidate) =>
				candidate.familyId === session.familyId && candidate.revokedAt !== null,
		);
	}

	async createMagicLink(input: Omit<MagicLink, "consumedAt">) {
		this.magicLinks.set(input.tokenHash, { ...input, consumedAt: null });
	}

	async createMagicLinkWithDelivery(input: MagicLinkWithDeliveryInput) {
		await this.createMagicLink(input.link);
		if (
			[...this.deliveryJobs.values()].some(
				(job) => job.magicLinkId === input.link.id,
			)
		) {
			throw new Error("A magic link can have only one delivery job");
		}
		this.deliveryJobs.set(input.delivery.id, {
			id: input.delivery.id,
			magicLinkId: input.link.id,
			sealedPayload: input.delivery.sealedPayload,
			expiresAt: input.link.expiresAt,
			createdAt: input.delivery.createdAt,
		});
	}

	async enqueuePushNotification(input: PushNotificationIngressInput) {
		if (input.expiresAt <= input.createdAt) return 0;
		const profile = this.profiles.get(input.recipientUserId);
		if (!profile?.eventReminders) return 0;
		const devices = [...this.devices.values()]
			.filter(
				(device) =>
					device.userId === input.recipientUserId &&
					device.notificationsEnabled &&
					Boolean(device.pushToken),
			)
			.sort((left, right) => left.id.localeCompare(right.id));
		if (devices.length > MAX_PUSH_FANOUT_DEVICES) {
			throw new PushFanoutLimitExceededError();
		}
		let queued = 0;
		for (const device of devices) {
			if (
				[...this.pushJobs.values()].some(
					(job) =>
						job.eventJobId === input.eventJobId && job.deviceId === device.id,
				)
			) {
				continue;
			}
			if (!device.pushToken) continue;
			const id = createId("pjob");
			this.pushJobs.set(id, {
				id,
				eventJobId: input.eventJobId,
				recipientUserId: input.recipientUserId,
				deviceId: device.id,
				sealedPayload: input.payloads.seal(
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
				),
				expiresAt: input.expiresAt,
				requestId: input.requestId,
				causationRequestId: input.causationRequestId,
				createdAt: input.createdAt,
			});
			queued += 1;
		}
		return queued;
	}

	async redeemMagicLink(input: RedeemMagicLinkInput) {
		const link = this.magicLinks.get(input.tokenHash);
		if (!link || link.consumedAt || link.expiresAt <= input.now) return null;
		link.consumedAt = input.now;

		let userId = this.userIdByEmail.get(link.email);
		if (!userId) {
			userId = input.newUserId;
			const user = { id: userId, email: link.email, createdAt: input.now };
			this.users.set(userId, user);
			this.userIdByEmail.set(link.email, userId);
			this.profiles.set(userId, defaultProfile(userId, input.now));
		}

		const session: Session = {
			id: input.newSessionId,
			userId,
			familyId: input.newSessionId,
			refreshTokenHash: input.refreshTokenHash,
			expiresAt: input.sessionExpiresAt,
			replacedBySessionId: null,
			rotatedAt: null,
			revokedAt: null,
		};
		this.sessions.set(session.id, session);

		const user = this.users.get(userId);
		const profile = this.profiles.get(userId);
		if (!user || !profile) throw new Error("User repository invariant failed");
		return {
			user: structuredClone(user),
			profile: structuredClone(profile),
			sessionId: session.id,
		};
	}

	async rotateRefreshToken(input: {
		tokenHash: string;
		now: Date;
		newSessionId: string;
		newRefreshTokenHash: string;
		sessionExpiresAt: Date;
	}): Promise<RefreshResult> {
		const session = [...this.sessions.values()].find(
			(candidate) => candidate.refreshTokenHash === input.tokenHash,
		);
		if (!session || session.expiresAt <= input.now) return { kind: "invalid" };
		if (session.revokedAt || session.replacedBySessionId) {
			for (const familySession of this.sessions.values()) {
				if (familySession.familyId === session.familyId)
					familySession.revokedAt = input.now;
			}
			return { kind: "reuse" };
		}

		session.replacedBySessionId = input.newSessionId;
		session.rotatedAt = input.now;
		const replacement: Session = {
			id: input.newSessionId,
			userId: session.userId,
			familyId: session.familyId,
			refreshTokenHash: input.newRefreshTokenHash,
			expiresAt: input.sessionExpiresAt,
			replacedBySessionId: null,
			rotatedAt: null,
			revokedAt: null,
		};
		this.sessions.set(replacement.id, replacement);

		const user = this.users.get(session.userId);
		const profile = this.profiles.get(session.userId);
		if (!user || !profile) throw new Error("User repository invariant failed");
		return {
			kind: "ok",
			user: structuredClone(user),
			profile: structuredClone(profile),
			sessionId: replacement.id,
		};
	}

	async revokeSessionFamily(userId: string, sessionId: string, now: Date) {
		const session = this.sessions.get(sessionId);
		if (session?.userId !== userId) return;
		for (const familySession of this.sessions.values()) {
			if (familySession.familyId === session.familyId)
				familySession.revokedAt ??= now;
		}
	}

	async getUser(userId: string) {
		const user = this.users.get(userId);
		return user ? structuredClone(user) : null;
	}

	async getProfile(userId: string) {
		const profile = this.profiles.get(userId);
		return profile ? structuredClone(profile) : null;
	}

	async resolveMemberDirectoryProfiles(userIds: readonly string[]) {
		return userIds.flatMap((userId) => {
			const profile = this.profiles.get(userId);
			return profile
				? [
						{
							userId: profile.userId,
							displayName: profile.displayName,
							version: profile.version,
						},
					]
				: [];
		});
	}

	async updateProfile(
		userId: string,
		baseVersion: number,
		patch: ProfilePatch,
		now: Date,
	) {
		const profile = this.profiles.get(userId);
		if (!profile || profile.version !== baseVersion) return null;
		const next = {
			...profile,
			...patch,
			version: profile.version + 1,
			updatedAt: now,
		};
		this.profiles.set(userId, next);
		return structuredClone(next);
	}

	async listDevices(userId: string) {
		return [...this.devices.values()]
			.filter((device) => device.userId === userId)
			.sort(
				(left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
			)
			.map((device) => structuredClone(device));
	}

	async upsertDevice(userId: string, input: DeviceInput, now: Date) {
		const key = `${userId}:${input.installationId}`;
		if (input.pushToken) {
			for (const [otherKey, otherDevice] of this.devices) {
				if (otherKey !== key && otherDevice.pushToken === input.pushToken) {
					this.devices.set(otherKey, {
						...otherDevice,
						pushToken: null,
						notificationsEnabled: false,
						updatedAt: now,
					});
				}
			}
		}
		const current = this.devices.get(key);
		const device: Device = {
			...input,
			id: current?.id ?? createId("dev"),
			userId,
			updatedAt: now,
		};
		this.devices.set(key, device);
		return structuredClone(device);
	}

	async removeDevice(userId: string, installationId: string) {
		return this.devices.delete(`${userId}:${installationId}`);
	}
}

export function defaultProfile(userId: string, now: Date): Profile {
	return {
		userId,
		displayName: null,
		avatarUrl: null,
		locale: "en",
		timeZone: "UTC",
		reduceMotion: false,
		eventReminders: true,
		productUpdates: false,
		version: 1,
		updatedAt: now,
	};
}

function restoreMap<K, V>(target: Map<K, V>, snapshot: Map<K, V>) {
	target.clear();
	for (const [key, value] of snapshot) target.set(key, value);
}
