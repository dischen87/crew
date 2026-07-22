import { describe, expect, test } from "bun:test";
import {
	RecapCaptionFieldRefCodec,
	type RecapCaptionFieldRefInput,
} from "./recap-caption-field-ref";

const currentKey = "recap-caption-field-ref-current-key-2026";
const nextKey = "recap-caption-field-ref-next-key-2026-rotate";
const input: RecapCaptionFieldRefInput = {
	rootEventId: "evt_caption_ref",
	recapVersion: 3,
	recapOrdinal: 2,
	sourceType: "feedEntry",
	sourceId: "fed_caption_ref",
	sourceVersion: 4,
	attachmentId: "att_caption_ref",
	attachmentVersion: 1,
	attachmentRootRevision: "19",
	attachmentCreatedBy: `usr_${"a".repeat(32)}`,
	caption: "Exact approved caption",
};

describe("recap caption field refs", () => {
	test("are opaque, deterministic and bound to every immutable tuple field", () => {
		const codec = new RecapCaptionFieldRefCodec(currentKey);
		const fieldRef = codec.issue(input);
		expect(fieldRef).toMatch(/^rcf_[A-Za-z0-9_-]{43}$/);
		expect(codec.issue(input)).toBe(fieldRef);
		expect(fieldRef).not.toContain(input.attachmentId);
		expect(fieldRef).not.toContain(input.caption);

		const drifted: RecapCaptionFieldRefInput[] = [
			{ ...input, rootEventId: "evt_caption_ref_other" },
			{ ...input, recapVersion: 4 },
			{ ...input, recapOrdinal: 3 },
			{ ...input, sourceId: "fed_caption_ref_other" },
			{ ...input, sourceVersion: 5 },
			{ ...input, attachmentId: "att_caption_ref_other" },
			{ ...input, attachmentVersion: 2 },
			{ ...input, attachmentRootRevision: "20" },
			{ ...input, attachmentCreatedBy: `usr_${"b".repeat(32)}` },
			{ ...input, caption: "Changed caption" },
		];
		for (const candidate of drifted) {
			expect(codec.matches(fieldRef, candidate)).toBe(false);
		}
		expect(codec.matches("rcf_invalid", input)).toBe(false);
	});

	test("accepts the previous key while issuing only with the current key", () => {
		const previous = new RecapCaptionFieldRefCodec(currentKey);
		const rotated = new RecapCaptionFieldRefCodec(nextKey, currentKey);
		const oldFieldRef = previous.issue(input);
		const newFieldRef = rotated.issue(input);

		expect(rotated.matches(oldFieldRef, input)).toBe(true);
		expect(rotated.matches(newFieldRef, input)).toBe(true);
		expect(previous.matches(newFieldRef, input)).toBe(false);
		expect(newFieldRef).not.toBe(oldFieldRef);
	});

	test("rejects short or duplicate rotation material", () => {
		expect(() => new RecapCaptionFieldRefCodec("short")).toThrow();
		expect(
			() => new RecapCaptionFieldRefCodec(currentKey, currentKey),
		).toThrow();
	});
});
