import { describe, expect, test } from "bun:test";
import { sha256Hex, sha256HexFallback } from "../src/sha256.ts";

const vectors = [
	["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
	["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
	[
		"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
		"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
	],
	[
		"Crew · Zürich 🏌️",
		"3c88cd95904b5c116f7c888db7735da4c055907cce36297825783b56330c8e55",
	],
] as const;

describe("SHA-256", () => {
	test.each(vectors)(
		"matches the published digest for %p",
		async (value, digest) => {
			expect(sha256HexFallback(value)).toBe(digest);
			expect(await sha256Hex(value)).toBe(digest);
		},
	);

	test("uses replacement characters for malformed UTF-16 like TextEncoder", () => {
		expect(sha256HexFallback("\ud800")).toBe(
			new Bun.CryptoHasher("sha256")
				.update(new TextEncoder().encode("\ud800"))
				.digest("hex"),
		);
	});

	test("hashes multi-block mobile payloads without Web Crypto", () => {
		const value = JSON.stringify({ body: "offline ".repeat(20_000) });
		expect(sha256HexFallback(value)).toBe(
			new Bun.CryptoHasher("sha256").update(value).digest("hex"),
		);
	});
});
