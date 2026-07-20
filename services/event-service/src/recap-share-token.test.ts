import { describe, expect, test } from "bun:test";
import {
	hashRecapShareToken,
	RecapShareTokenCodec,
	RecapShareTokenKeyUnavailableError,
} from "./recap-share-token";

const first = "first-recap-share-secret-with-32-characters";
const second = "second-recap-share-secret-with-32-characters";
const shareLinkId = "rsh_123456789012345678901234";

describe("RecapShareTokenCodec", () => {
	test("reconstructs an old token only through its bounded retirement", () => {
		const rotation = new Date("2026-07-19T00:00:00.000Z");
		const old = new RecapShareTokenCodec({ id: "k1", secret: first });
		const issued = old.issue(shareLinkId);
		const rotated = new RecapShareTokenCodec(
			{ id: "k2", secret: second },
			{
				id: "k1",
				secret: first,
				notAfter: new Date("2026-07-26T00:00:00.000Z"),
			},
			rotation,
		);

		expect(rotated.token(shareLinkId, issued.keyId, rotation)).toBe(
			issued.token,
		);
		expect(hashRecapShareToken(issued.token)).toMatch(/^[a-f0-9]{64}$/);
		expect(() =>
			rotated.token(
				shareLinkId,
				issued.keyId,
				new Date("2026-07-26T00:00:00.000Z"),
			),
		).toThrow(RecapShareTokenKeyUnavailableError);
	});

	test("rejects an unbounded previous-key window", () => {
		expect(
			() =>
				new RecapShareTokenCodec(
					{ id: "k2", secret: second },
					{
						id: "k1",
						secret: first,
						notAfter: new Date("2026-07-26T00:00:00.001Z"),
					},
					new Date("2026-07-19T00:00:00.000Z"),
				),
		).toThrow("retire within seven days");
	});
});
