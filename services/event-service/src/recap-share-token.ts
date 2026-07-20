import { createHash, createHmac } from "node:crypto";

const SHARE_LINK_ID = /^rsh_[A-Za-z0-9_-]{24}$/;
const KEY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_PREVIOUS_KEY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export type RecapShareTokenKey = {
	id: string;
	secret: string;
};

export type PreviousRecapShareTokenKey = RecapShareTokenKey & {
	notAfter: Date;
};

export class RecapShareTokenKeyUnavailableError extends Error {
	constructor() {
		super("Recap share token key is unavailable");
	}
}

export class RecapShareTokenCodec {
	private readonly keys = new Map<
		string,
		{ secret: string; notAfter: Date | null }
	>();

	constructor(
		private readonly current: RecapShareTokenKey,
		previous?: PreviousRecapShareTokenKey,
		now = new Date(),
	) {
		validateKey(current);
		this.keys.set(current.id, { secret: current.secret, notAfter: null });
		if (!previous) return;
		validateKey(previous);
		if (
			previous.id === current.id ||
			previous.secret === current.secret ||
			!Number.isFinite(previous.notAfter.getTime()) ||
			previous.notAfter <= now ||
			previous.notAfter.getTime() - now.getTime() > MAX_PREVIOUS_KEY_LIFETIME_MS
		)
			throw new Error(
				"Previous recap share key must be unique and retire within seven days",
			);
		this.keys.set(previous.id, {
			secret: previous.secret,
			notAfter: previous.notAfter,
		});
	}

	issue(shareLinkId: string) {
		return {
			keyId: this.current.id,
			token: this.token(shareLinkId, this.current.id),
		};
	}

	token(shareLinkId: string, keyId: string, now = new Date()) {
		if (!SHARE_LINK_ID.test(shareLinkId))
			throw new Error("Invalid recap share link ID");
		const selected = this.keys.get(keyId);
		if (!selected || (selected.notAfter !== null && selected.notAfter <= now))
			throw new RecapShareTokenKeyUnavailableError();
		return `crs_${createHmac("sha256", selected.secret)
			.update(`crew:recap-share:v1:${shareLinkId}`)
			.digest("base64url")}`;
	}
}

export function hashRecapShareToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function validateKey(key: RecapShareTokenKey) {
	if (!KEY_ID.test(key.id) || key.secret.length < 32)
		throw new Error("Invalid recap share token key");
}
