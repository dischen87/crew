/** Standard Stableford scoring shared by every Crew runtime. */

export function calculateStableford(
	strokes: number,
	par: number,
	strokesReceived: number,
): number {
	requireInteger("strokes", strokes, 1);
	requireInteger("par", par, 1);
	requireInteger("strokesReceived", strokesReceived);
	const netStrokes = strokes - strokesReceived;
	const diff = netStrokes - par;

	if (diff <= -4) return 6; // four under or better
	if (diff === -3) return 5; // albatross
	if (diff === -2) return 4; // eagle
	if (diff === -1) return 3; // birdie
	if (diff === 0) return 2; // par
	if (diff === 1) return 1; // bogey
	return 0; // double bogey or worse
}

export function strokesReceivedOnHole(
	playingHandicap: number,
	holeHandicapIndex: number,
): number {
	requireInteger("playingHandicap", playingHandicap);
	requireInteger("holeHandicapIndex", holeHandicapIndex, 1, 18);
	if (playingHandicap >= 0) {
		const full = Math.floor(playingHandicap / 18);
		const remainder = playingHandicap % 18;
		return full + (holeHandicapIndex <= remainder ? 1 : 0);
	}

	// A plus-two handicap is represented as -2: give strokes back from SI 18.
	const magnitude = -playingHandicap;
	const full = Math.floor(magnitude / 18);
	const remainder = magnitude % 18;
	const givenBack =
		full + (remainder > 0 && holeHandicapIndex > 18 - remainder ? 1 : 0);
	return givenBack === 0 ? 0 : -givenBack;
}

export function computeScoreLocally(
	strokes: number,
	par: number,
	handicapIndex: number,
	playingHandicap: number,
): { net_score: number; stableford: number } {
	const received = strokesReceivedOnHole(
		Math.round(playingHandicap),
		handicapIndex,
	);
	return {
		net_score: strokes - received,
		stableford: calculateStableford(strokes, par, received),
	};
}

function requireInteger(
	name: string,
	value: number,
	minimum?: number,
	maximum?: number,
): void {
	if (
		!Number.isSafeInteger(value) ||
		(minimum !== undefined && value < minimum) ||
		(maximum !== undefined && value > maximum)
	) {
		throw new RangeError(`${name} is outside the supported integer range`);
	}
}
