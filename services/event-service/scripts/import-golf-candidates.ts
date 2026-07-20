import {
	importOsmGolfCandidates,
	loadGolfCandidateImportConfig,
} from "../src/golf-candidate-source";

const result = await importOsmGolfCandidates(loadGolfCandidateImportConfig());
console.info("Golf candidates imported; run places:reindex to publish search", {
	count: result.results.length,
	outcomes: result.results.reduce<Record<string, number>>((counts, result) => {
		counts[result.outcome] = (counts[result.outcome] ?? 0) + 1;
		return counts;
	}, {}),
});
