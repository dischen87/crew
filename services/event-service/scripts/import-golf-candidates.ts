import {
	GolfCandidateSourceError,
	importOsmGolfCandidates,
	loadGolfCandidateImportConfig,
} from "../src/golf-candidate-source";

try {
	const result = await importOsmGolfCandidates(loadGolfCandidateImportConfig());
	console.info(
		"Golf candidates imported; run places:reindex to publish search",
		{
			count: result.results.length,
			outcomes: result.results.reduce<Record<string, number>>(
				(counts, result) => {
					counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
					return counts;
				},
				{},
			),
		},
	);
} catch (error) {
	console.error(error);
	process.exitCode =
		error instanceof GolfCandidateSourceError && error.sourceUnavailable
			? 75
			: 1;
}
