import type { GatewaySessionSubject } from "./client.ts";

export type ProductVertical = "golf" | "team_event" | "trip";
export type ProductPlatform = "android" | "ios";

export type ProductAnalyticsEvent =
	| Readonly<{
			name: "organizer_start";
			properties: Readonly<{
				vertical: ProductVertical;
				platform: ProductPlatform;
			}>;
	  }>
	| Readonly<{
			name: "initial_sync_completed";
			properties: Readonly<{
				vertical: ProductVertical;
				page_count_bucket: "1" | "2_5" | "6_plus";
				restart_count_bucket: "0" | "1" | "2_plus";
				platform: ProductPlatform;
			}>;
	  }>
	| Readonly<{
			name: "participant_first_value";
			properties: Readonly<{
				vertical: ProductVertical;
				entry_surface: "event_hub" | "now_next";
				platform: ProductPlatform;
			}>;
	  }>
	| Readonly<{
			name: "first_coordination_success";
			properties: Readonly<{
				vertical: ProductVertical;
				online_state: "offline_recovered" | "online";
				platform_mix: "android" | "ios" | "mixed";
			}>;
	  }>;

type EnvelopeFor<Event extends ProductAnalyticsEvent> =
	Event extends ProductAnalyticsEvent
		? Readonly<{
				schema_version: 1;
				event_name: Event["name"];
				actor_user_id: string;
				properties: Event["properties"];
				occurred_at: string;
			}>
		: never;

export type ProductAnalyticsEnvelope = EnvelopeFor<ProductAnalyticsEvent>;
export type ProductAnalyticsDelivery = "delivered" | "dropped";

export interface ProductAnalyticsSession {
	assertSessionSubject(subject: GatewaySessionSubject): Promise<void>;
}

export interface ProductAnalyticsSink {
	capture(event: ProductAnalyticsEnvelope): Promise<void> | void;
}

export interface ProductAnalyticsOptions {
	session: ProductAnalyticsSession;
	sink: ProductAnalyticsSink;
	now?: () => Date;
}

export class ProductAnalyticsValidationError extends TypeError {
	constructor() {
		super("Invalid product analytics input");
		this.name = "ProductAnalyticsValidationError";
	}
}

const userIdPattern = /^usr_[a-f0-9]{32}$/;
const verticals = ["golf", "team_event", "trip"] as const;
const platforms = ["android", "ios"] as const;

export class ProductAnalytics {
	readonly #session: ProductAnalyticsSession;
	readonly #sink: ProductAnalyticsSink;
	readonly #now: () => Date;

	constructor(options: ProductAnalyticsOptions) {
		this.#session = options.session;
		this.#sink = options.sink;
		this.#now = options.now ?? (() => new Date());
	}

	async capture(
		subject: GatewaySessionSubject,
		event: ProductAnalyticsEvent,
	): Promise<ProductAnalyticsDelivery> {
		const validatedEvent = validateEvent(event);
		await this.#session.assertSessionSubject(subject);
		if (!userIdPattern.test(subject.userId)) throw validationError();

		const occurredAt = this.#now();
		if (
			!(occurredAt instanceof Date) ||
			!Number.isFinite(occurredAt.getTime())
		) {
			throw validationError();
		}

		const envelope = Object.freeze({
			schema_version: 1 as const,
			event_name: validatedEvent.name,
			actor_user_id: subject.userId,
			properties: Object.freeze(validatedEvent.properties),
			occurred_at: occurredAt.toISOString(),
		}) as ProductAnalyticsEnvelope;

		try {
			await this.#sink.capture(envelope);
			return "delivered";
		} catch {
			return "dropped";
		}
	}
}

function validateEvent(value: unknown): ProductAnalyticsEvent {
	try {
		return validateEventUnsafe(value);
	} catch {
		throw validationError();
	}
}

function validateEventUnsafe(value: unknown): ProductAnalyticsEvent {
	if (!isExactRecord(value, ["name", "properties"])) {
		throw validationError();
	}
	const properties = value.properties;

	switch (value.name) {
		case "organizer_start": {
			if (
				!isExactRecord(properties, ["vertical", "platform"]) ||
				!isOneOf(properties.vertical, verticals) ||
				!isOneOf(properties.platform, platforms)
			) {
				throw validationError();
			}
			return {
				name: value.name,
				properties: {
					vertical: properties.vertical,
					platform: properties.platform,
				},
			};
		}
		case "initial_sync_completed": {
			if (
				!isExactRecord(properties, [
					"vertical",
					"page_count_bucket",
					"restart_count_bucket",
					"platform",
				]) ||
				!isOneOf(properties.vertical, verticals) ||
				!isOneOf(properties.page_count_bucket, ["1", "2_5", "6_plus"]) ||
				!isOneOf(properties.restart_count_bucket, ["0", "1", "2_plus"]) ||
				!isOneOf(properties.platform, platforms)
			) {
				throw validationError();
			}
			return {
				name: value.name,
				properties: {
					vertical: properties.vertical,
					page_count_bucket: properties.page_count_bucket,
					restart_count_bucket: properties.restart_count_bucket,
					platform: properties.platform,
				},
			};
		}
		case "participant_first_value": {
			if (
				!isExactRecord(properties, ["vertical", "entry_surface", "platform"]) ||
				!isOneOf(properties.vertical, verticals) ||
				!isOneOf(properties.entry_surface, ["event_hub", "now_next"]) ||
				!isOneOf(properties.platform, platforms)
			) {
				throw validationError();
			}
			return {
				name: value.name,
				properties: {
					vertical: properties.vertical,
					entry_surface: properties.entry_surface,
					platform: properties.platform,
				},
			};
		}
		case "first_coordination_success": {
			if (
				!isExactRecord(properties, [
					"vertical",
					"online_state",
					"platform_mix",
				]) ||
				!isOneOf(properties.vertical, verticals) ||
				!isOneOf(properties.online_state, ["offline_recovered", "online"]) ||
				!isOneOf(properties.platform_mix, ["android", "ios", "mixed"])
			) {
				throw validationError();
			}
			return {
				name: value.name,
				properties: {
					vertical: properties.vertical,
					online_state: properties.online_state,
					platform_mix: properties.platform_mix,
				},
			};
		}
		default:
			throw validationError();
	}
}

function isExactRecord(
	value: unknown,
	keys: readonly string[],
): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const actualKeys = Object.keys(value);
	return (
		actualKeys.length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function isOneOf<const Value extends string>(
	value: unknown,
	allowed: readonly Value[],
): value is Value {
	return typeof value === "string" && allowed.includes(value as Value);
}

function validationError(): ProductAnalyticsValidationError {
	return new ProductAnalyticsValidationError();
}
