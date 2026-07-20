import { createHash } from "node:crypto";
import type { Role } from "./domain";

type SystemFeedPayloadBase<T extends string> = {
	schemaVersion: 1;
	type: T;
	actorUserId: string;
	entityVersion: number;
};

export type SystemFeedPayload =
	| (SystemFeedPayloadBase<"event.published"> & { eventId: string })
	| (SystemFeedPayloadBase<"team.assignments.published"> & {
			eventId: string;
	  })
	| (SystemFeedPayloadBase<"team.decision.opened" | "team.decision.closed"> & {
			eventId: string;
			decisionId: string;
	  })
	| (SystemFeedPayloadBase<"itinerary.added" | "itinerary.cancelled"> & {
			itineraryItemId: string;
			eventId: string;
	  })
	| (SystemFeedPayloadBase<"membership.activated"> & {
			userId: string;
			role: Exclude<Role, "owner">;
	  })
	| (SystemFeedPayloadBase<"ownership.transferred"> & {
			fromUserId: string;
			toUserId: string;
	  });

export function systemFeedEntryId(
	rootEventId: string,
	payload: SystemFeedPayload,
) {
	return `fed_sys_${createHash("sha256")
		.update(
			JSON.stringify([
				"crew:system-feed:v1",
				rootEventId,
				payload.type,
				systemFeedEntityId(payload),
				payload.entityVersion,
			]),
		)
		.digest("hex")}`;
}

export function systemFeedPayloadJson(payload: SystemFeedPayload) {
	switch (payload.type) {
		case "event.published":
		case "team.assignments.published":
			return JSON.stringify({
				schemaVersion: 1,
				type: payload.type,
				actorUserId: payload.actorUserId,
				eventId: payload.eventId,
				entityVersion: payload.entityVersion,
			});
		case "team.decision.opened":
		case "team.decision.closed":
			return JSON.stringify({
				schemaVersion: 1,
				type: payload.type,
				actorUserId: payload.actorUserId,
				eventId: payload.eventId,
				decisionId: payload.decisionId,
				entityVersion: payload.entityVersion,
			});
		case "itinerary.added":
		case "itinerary.cancelled":
			return JSON.stringify({
				schemaVersion: 1,
				type: payload.type,
				actorUserId: payload.actorUserId,
				itineraryItemId: payload.itineraryItemId,
				eventId: payload.eventId,
				entityVersion: payload.entityVersion,
			});
		case "membership.activated":
			return JSON.stringify({
				schemaVersion: 1,
				type: payload.type,
				actorUserId: payload.actorUserId,
				userId: payload.userId,
				role: payload.role,
				entityVersion: payload.entityVersion,
			});
		case "ownership.transferred":
			return JSON.stringify({
				schemaVersion: 1,
				type: payload.type,
				actorUserId: payload.actorUserId,
				fromUserId: payload.fromUserId,
				toUserId: payload.toUserId,
				entityVersion: payload.entityVersion,
			});
	}
}

function systemFeedEntityId(payload: SystemFeedPayload) {
	switch (payload.type) {
		case "event.published":
		case "team.assignments.published":
			return payload.eventId;
		case "team.decision.opened":
		case "team.decision.closed":
			return payload.decisionId;
		case "itinerary.added":
		case "itinerary.cancelled":
			return payload.itineraryItemId;
		case "membership.activated":
			return payload.userId;
		case "ownership.transferred":
			return payload.toUserId;
	}
}
