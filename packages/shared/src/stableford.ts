/**
 * Stableford scoring — single source of truth for API + Web.
 */

export function calculateStableford(
  strokes: number,
  par: number,
  strokesReceived: number
): number {
  const netStrokes = strokes - strokesReceived;
  const diff = netStrokes - par;

  if (diff <= -3) return 5; // albatross or better
  if (diff === -2) return 4; // eagle
  if (diff === -1) return 3; // birdie
  if (diff === 0) return 2;  // par
  if (diff === 1) return 1;  // bogey
  return 0;                   // double bogey or worse
}

export function strokesReceivedOnHole(
  playingHandicap: number,
  holeHandicapIndex: number
): number {
  if (playingHandicap <= 0) return 0;
  const full = Math.floor(playingHandicap / 18);
  const remainder = playingHandicap % 18;
  return full + (holeHandicapIndex <= remainder ? 1 : 0);
}

export function computeScoreLocally(
  strokes: number,
  par: number,
  handicapIndex: number,
  playingHandicap: number
): { net_score: number; stableford: number } {
  const received = strokesReceivedOnHole(
    Math.round(playingHandicap),
    handicapIndex
  );
  return {
    net_score: strokes - received,
    stableford: calculateStableford(strokes, par, received),
  };
}
