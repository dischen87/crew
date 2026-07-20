import { reindexPlaceSearch } from "../src/place-search-reindex";
import { loadPlaceSearchReindexConfig } from "../src/place-search-reindex-config";

const result = await reindexPlaceSearch(loadPlaceSearchReindexConfig());
console.info("Place-search alias now targets a verified collection", result);
