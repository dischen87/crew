import { describe, expect, test } from "bun:test";
import {
	calculateStableford,
	computeScoreLocally,
	strokesReceivedOnHole,
} from "../src/stableford";

describe("standard Stableford", () => {
	test("awards the official zero-through-six point scale", () => {
		const points = [
			[7, 0],
			[6, 0],
			[5, 1],
			[4, 2],
			[3, 3],
			[2, 4],
			[1, 5],
		] as const;
		for (const [strokes, expected] of points) {
			expect(calculateStableford(strokes, 4, 0)).toBe(expected);
		}
		expect(calculateStableford(1, 5, 0)).toBe(6);
		expect(calculateStableford(1, 5, 3)).toBe(6);
	});

	test("allocates received and plus-handicap strokes in opposite directions", () => {
		expect(strokesReceivedOnHole(0, 1)).toBe(0);
		expect(strokesReceivedOnHole(1, 1)).toBe(1);
		expect(strokesReceivedOnHole(1, 2)).toBe(0);
		expect(strokesReceivedOnHole(18, 18)).toBe(1);
		expect(strokesReceivedOnHole(19, 1)).toBe(2);
		expect(strokesReceivedOnHole(19, 2)).toBe(1);
		expect(strokesReceivedOnHole(-2, 16)).toBe(0);
		expect(strokesReceivedOnHole(-2, 17)).toBe(-1);
		expect(strokesReceivedOnHole(-2, 18)).toBe(-1);
		expect(strokesReceivedOnHole(-19, 17)).toBe(-1);
		expect(strokesReceivedOnHole(-19, 18)).toBe(-2);
	});

	test("uses the same calculation for local feedback and rejects invalid inputs", () => {
		expect(computeScoreLocally(4, 4, 1, 18)).toEqual({
			net_score: 3,
			stableford: 3,
		});
		expect(computeScoreLocally(4, 4, 18, -2)).toEqual({
			net_score: 5,
			stableford: 1,
		});
		expect(() => calculateStableford(Number.NaN, 4, 0)).toThrow(RangeError);
		expect(() => strokesReceivedOnHole(10, 0)).toThrow(RangeError);
		expect(() => strokesReceivedOnHole(10.5, 1)).toThrow(RangeError);
	});
});
