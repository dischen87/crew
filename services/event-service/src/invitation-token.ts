import { createHmac } from "node:crypto";

const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const INVITATION_ID = /^inv_[A-Za-z0-9._:-]{1,96}$/;

export type InvitationTokenKey = { id: string; secret: string };

export class InvitationTokenKeyUnavailableError extends Error {
	constructor() {
		super("Invitation token key is unavailable");
	}
}

export class InvitationTokenCodec {
	private readonly current: InvitationTokenKey;
	private readonly keys = new Map<string, string>();

	constructor(current: InvitationTokenKey, previous?: InvitationTokenKey) {
		this.current = validateKey(current);
		this.keys.set(this.current.id, this.current.secret);
		if (previous) {
			const validated = validateKey(previous);
			if (validated.id === this.current.id)
				throw new Error("Invitation token key IDs must be unique");
			if (validated.secret === this.current.secret)
				throw new Error("Invitation token key material must be unique");
			this.keys.set(validated.id, validated.secret);
		}
	}

	currentToken(invitationId: string) {
		return {
			keyId: this.current.id,
			token: this.token(invitationId, this.current.id),
		};
	}

	token(invitationId: string, keyId: string) {
		if (!INVITATION_ID.test(invitationId))
			throw new Error("Invalid invitation ID");
		const secret = this.keys.get(keyId);
		if (!secret) throw new InvitationTokenKeyUnavailableError();
		return `cin_${createHmac("sha256", secret).update(invitationId).digest("base64url")}`;
	}
}

function validateKey(key: InvitationTokenKey) {
	if (!KEY_ID.test(key.id)) throw new Error("Invalid invitation token key ID");
	if (key.secret.length < 32 || key.secret.length > 512)
		throw new Error("Invalid invitation token key material");
	return key;
}
