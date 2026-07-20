import { expect, test } from "bun:test";
import {
	InvitationTokenCodec,
	InvitationTokenKeyUnavailableError,
} from "./invitation-token";

test("invitation tokens remain deterministic across one rolling key", () => {
	const oldKey = "old-invitation-token-key-at-least-32-characters";
	const newKey = "new-invitation-token-key-at-least-32-characters";
	const old = new InvitationTokenCodec({ id: "invitation-v1", secret: oldKey });
	const original = old.currentToken("inv_rotation01");
	const rotated = new InvitationTokenCodec(
		{ id: "invitation-v2", secret: newKey },
		{ id: "invitation-v1", secret: oldKey },
	);

	expect(rotated.token("inv_rotation01", original.keyId)).toBe(original.token);
	expect(rotated.currentToken("inv_rotation02")).toMatchObject({
		keyId: "invitation-v2",
	});
	expect(() => rotated.token("inv_rotation01", "retired")).toThrow(
		InvitationTokenKeyUnavailableError,
	);
	expect(
		() =>
			new InvitationTokenCodec(
				{ id: "same", secret: oldKey },
				{ id: "same", secret: newKey },
			),
	).toThrow("IDs must be unique");
	expect(
		() =>
			new InvitationTokenCodec(
				{ id: "current", secret: oldKey },
				{ id: "previous", secret: oldKey },
			),
	).toThrow("material must be unique");
});
