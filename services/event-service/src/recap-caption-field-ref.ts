import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "./sync";

export const RECAP_CAPTION_FIELD_REF_PATTERN = /^rcf_[A-Za-z0-9_-]{43}$/;

export type RecapCaptionFieldRefInput = {
	rootEventId: string;
	recapVersion: number;
	recapOrdinal: number;
	sourceType: "feedEntry";
	sourceId: string;
	sourceVersion: number;
	attachmentId: string;
	attachmentVersion: number;
	attachmentRootRevision: string;
	attachmentCreatedBy: string;
	caption: string;
};

export class RecapCaptionFieldRefCodec {
	private readonly keys: string[];

	constructor(currentKey: string, previousKey?: string) {
		if (
			Buffer.byteLength(currentKey) < 32 ||
			(previousKey !== undefined &&
				(Buffer.byteLength(previousKey) < 32 || previousKey === currentKey))
		) {
			throw new Error("Invalid recap caption field-ref key configuration");
		}
		this.keys = previousKey ? [currentKey, previousKey] : [currentKey];
	}

	issue(input: RecapCaptionFieldRefInput): string {
		return `rcf_${this.signature(this.keys[0] as string, input).toString("base64url")}`;
	}

	matches(fieldRef: string, input: RecapCaptionFieldRefInput): boolean {
		if (!RECAP_CAPTION_FIELD_REF_PATTERN.test(fieldRef)) return false;
		const supplied = Buffer.from(fieldRef.slice(4), "base64url");
		let matched = false;
		for (const key of this.keys) {
			const expected = this.signature(key, input);
			const equal =
				supplied.length === expected.length &&
				timingSafeEqual(supplied, expected);
			matched = equal || matched;
		}
		return matched;
	}

	private signature(key: string, input: RecapCaptionFieldRefInput): Buffer {
		return createHmac("sha256", key)
			.update("crew:recap-external-caption-field:v1\0")
			.update(canonicalJson(input))
			.digest();
	}
}
