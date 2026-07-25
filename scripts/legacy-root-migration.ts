import { createHash } from "node:crypto";

export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json };

const recordKinds = [
	"event",
	"itinerary",
	"activity",
	"golf_course",
	"golf_round",
	"golf_score",
	"message",
] as const;
type RecordKind = (typeof recordKinds)[number];
type LinkKind = RecordKind | "root" | "member";

export type LegacyRootSnapshot = {
	schemaVersion: 1;
	root: {
		legacyId: string;
		groupId: string;
		title: string;
		type: "golf" | "team_event";
	};
	deniedTextValues: string[];
	members: Array<{
		legacyId: string;
		groupId: string;
		displayName: string;
		role: "organizer" | "participant";
	}>;
	records: Array<{
		kind: string;
		legacyId: string;
		rootEventId: string;
		links?: Array<{ role: string; kind: LinkKind; legacyId: string }>;
		data: Json;
	}>;
	media: Array<{
		legacyId: string;
		rootEventId: string;
		eventLegacyId: string;
		uploaderLegacyId?: string;
		fileName: string;
		mimeType: string;
		byteLength: number;
		sha256: string;
	}>;
};

export interface ReadOnlyLegacyRootReader {
	readonly access: "read-only";
	readRoot(rootEventId: string): Promise<LegacyRootSnapshot>;
}

export type ValidationIssue = {
	code: string;
	path: string;
	message: string;
};

type ExportCore = {
	schemaVersion: 1;
	root: { key: string; title: string; type: "golf" | "team_event" };
	members: Array<{
		key: string;
		displayName: string;
		role: "organizer" | "participant";
	}>;
	records: Array<{
		kind: RecordKind;
		key: string;
		links: Array<{ role: string; targetKey: string }>;
		data: Json;
	}>;
	media: Array<{
		key: string;
		eventKey: string;
		uploaderKey?: string;
		fileName: string;
		mimeType: string;
		byteLength: number;
		sha256: string;
	}>;
};

export type LegacyRootExport = ExportCore & { sha256: string };
export type LegacyExportResult = {
	artifact: LegacyRootExport;
	validation: { valid: boolean; issues: ValidationIssue[] };
};

export interface CrewNextMigrationApi {
	validateOnly(input: {
		artifact: LegacyRootExport;
		idempotencyKey: string;
	}): Promise<{ accepted: boolean; issues: ValidationIssue[] }>;
	importRoot(input: {
		artifact: LegacyRootExport;
		idempotencyKey: string;
		ownershipRevision: string;
	}): Promise<{ nextRootId: string; mapping: Record<string, string> }>;
	readReconciliation(input: {
		nextRootId: string;
		exportSha256: string;
	}): Promise<{
		counts: Record<string, number>;
		hashes: Record<string, string>;
	}>;
}

export async function exportLegacyRoot(
	reader: ReadOnlyLegacyRootReader,
	rootEventId: string,
): Promise<LegacyExportResult> {
	if (reader.access !== "read-only")
		throw new Error("Legacy migration reader must be read-only");
	const source = await reader.readRoot(rootEventId);
	const issues: ValidationIssue[] = [];
	const issue = (code: string, path: string, message: string) =>
		issues.push({ code, path, message });

	if (source.schemaVersion !== 1)
		issue("schema", "schemaVersion", "Unsupported legacy export schema");
	if (source.root.legacyId !== rootEventId)
		issue("scope", "root.legacyId", "Reader returned a different root");
	forbiddenFields(source, "", issue);

	const rootKey = stableKey(rootEventId, "root", source.root.legacyId);
	const memberKeys = new Map<string, string>();
	for (const [index, member] of source.members.entries()) {
		if (member.groupId !== source.root.groupId)
			issue("scope", `members[${index}]`, "Member belongs to another group");
		if (memberKeys.has(member.legacyId))
			issue("duplicate", `members[${index}].legacyId`, "Duplicate member");
		memberKeys.set(
			member.legacyId,
			stableKey(rootEventId, "member", member.legacyId),
		);
	}

	const recordKeys = new Map<string, string>();
	for (const [index, record] of source.records.entries()) {
		if (!isRecordKind(record.kind)) {
			issue(
				"unsupported",
				`records[${index}].kind`,
				`Unsupported record kind ${record.kind}`,
			);
			continue;
		}
		const lookup = `${record.kind}:${record.legacyId}`;
		if (recordKeys.has(lookup))
			issue("duplicate", `records[${index}].legacyId`, "Duplicate record");
		recordKeys.set(
			lookup,
			stableKey(rootEventId, record.kind, record.legacyId),
		);
		if (record.rootEventId !== rootEventId)
			issue("scope", `records[${index}]`, "Record belongs to another root");
	}

	const resolve = (
		link: { kind: LinkKind; legacyId: string },
		path: string,
	) => {
		const key =
			link.kind === "root"
				? link.legacyId === rootEventId
					? rootKey
					: undefined
				: link.kind === "member"
					? memberKeys.get(link.legacyId)
					: recordKeys.get(`${link.kind}:${link.legacyId}`);
		if (!key) issue("reference", path, "Link target is absent from this root");
		return key;
	};

	const deniedTextValues = [...memberKeys.keys()];
	for (const [index, value] of source.deniedTextValues.entries()) {
		if (typeof value !== "string" || value.length < 8 || value.length > 4_096) {
			issue(
				"invalid",
				`deniedTextValues[${index}]`,
				"Denied text values must contain 8 to 4096 characters",
			);
		}
		if (typeof value === "string" && value.length > 0)
			deniedTextValues.push(value);
	}
	const records: ExportCore["records"] = [];
	for (const [index, record] of source.records.entries()) {
		if (!isRecordKind(record.kind)) continue;
		const key = recordKeys.get(`${record.kind}:${record.legacyId}`);
		if (!key) continue;
		const links = (record.links ?? [])
			.map((link, linkIndex) => ({
				role: validateText(
					link.role,
					`records[${index}].links[${linkIndex}].role`,
					deniedTextValues,
					issue,
				),
				targetKey: resolve(link, `records[${index}].links[${linkIndex}]`),
			}))
			.filter((link): link is { role: string; targetKey: string } =>
				Boolean(link.targetKey),
			)
			.sort((a, b) =>
				compareText(`${a.role}:${a.targetKey}`, `${b.role}:${b.targetKey}`),
			);
		records.push({
			kind: record.kind,
			key,
			links,
			data: sanitizeJson(
				record.data,
				`records[${index}].data`,
				deniedTextValues,
				issue,
			),
		});
	}

	const mediaIds = new Set<string>();
	const media = source.media.map((item, index) => {
		if (mediaIds.has(item.legacyId))
			issue("duplicate", `media[${index}].legacyId`, "Duplicate media");
		mediaIds.add(item.legacyId);
		if (item.rootEventId !== rootEventId)
			issue("scope", `media[${index}]`, "Media belongs to another root");
		const eventKey =
			recordKeys.get(`event:${item.eventLegacyId}`) ??
			(item.eventLegacyId === rootEventId ? rootKey : undefined);
		if (!eventKey)
			issue("reference", `media[${index}].eventLegacyId`, "Event is absent");
		const uploaderKey = item.uploaderLegacyId
			? memberKeys.get(item.uploaderLegacyId)
			: undefined;
		if (item.uploaderLegacyId && !uploaderKey)
			issue(
				"reference",
				`media[${index}].uploaderLegacyId`,
				"Uploader is absent",
			);
		if (!Number.isSafeInteger(item.byteLength) || item.byteLength < 0)
			issue("invalid", `media[${index}].byteLength`, "Invalid byte length");
		if (!/^[a-f0-9]{64}$/.test(item.sha256))
			issue("invalid", `media[${index}].sha256`, "Invalid SHA-256");
		return {
			key: stableKey(rootEventId, "media", item.legacyId),
			eventKey: eventKey ?? rootKey,
			...(uploaderKey ? { uploaderKey } : {}),
			fileName: validateFileName(
				item.fileName,
				`media[${index}].fileName`,
				deniedTextValues,
				issue,
			),
			mimeType: validateMimeType(
				item.mimeType,
				`media[${index}].mimeType`,
				deniedTextValues,
				issue,
			),
			byteLength: item.byteLength,
			sha256: item.sha256,
		};
	});

	const core: ExportCore = {
		schemaVersion: 1,
		root: {
			key: rootKey,
			title: validateText(
				source.root.title,
				"root.title",
				deniedTextValues,
				issue,
			),
			type: source.root.type,
		},
		members: source.members
			.map((member, index) => ({
				key: stableKey(rootEventId, "member", member.legacyId),
				displayName: validateText(
					member.displayName,
					`members[${index}].displayName`,
					deniedTextValues,
					issue,
				),
				role: member.role,
			}))
			.sort((a, b) => compareText(a.key, b.key)),
		records: records.sort((a, b) => compareText(a.key, b.key)),
		media: media.sort((a, b) => compareText(a.key, b.key)),
	};
	const artifact = { ...core, sha256: hash(core) };
	issues.sort((a, b) =>
		compareText(
			`${a.path}:${a.code}:${a.message}`,
			`${b.path}:${b.code}:${b.message}`,
		),
	);
	return { artifact, validation: { valid: issues.length === 0, issues } };
}

export async function validateOnlyThroughApi(
	api: Pick<CrewNextMigrationApi, "validateOnly">,
	exported: LegacyExportResult,
) {
	if (!exported.validation.valid)
		return { accepted: false, issues: exported.validation.issues };
	return api.validateOnly({
		artifact: exported.artifact,
		idempotencyKey: exported.artifact.sha256,
	});
}

export function reconciliationBasis(artifact: LegacyRootExport) {
	const values = [
		...artifact.members.map((value) => ["member", value] as const),
		...artifact.records.map((value) => [value.kind, value] as const),
		...artifact.media.map((value) => ["media", value] as const),
	];
	const counts: Record<string, number> = {};
	const hashes: Record<string, string> = {};
	for (const [kind, value] of values) {
		counts[kind] = (counts[kind] ?? 0) + 1;
		hashes[value.key] = hash(value);
	}
	return { counts: sortedObject(counts), hashes: sortedObject(hashes) };
}

export function canonicalJson(value: Json | object): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	return `{${Object.entries(value)
		.sort(([a], [b]) => compareText(a, b))
		.map(
			([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item as Json)}`,
		)
		.join(",")}}`;
}

function stableKey(root: string, kind: string, id: string) {
	return `legacy_${kind}_${hash(`${root}\0${kind}\0${id}`)}`;
}

function hash(value: unknown) {
	return createHash("sha256")
		.update(typeof value === "string" ? value : canonicalJson(value as object))
		.digest("hex");
}

function isRecordKind(value: string): value is RecordKind {
	return (recordKinds as readonly string[]).includes(value);
}

function forbiddenFields(
	value: unknown,
	path: string,
	issue: (code: string, path: string, message: string) => void,
) {
	if (!value || typeof value !== "object") return;
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			forbiddenFields(item, `${path}[${index}]`, issue);
		});
		return;
	}
	for (const [key, item] of Object.entries(value)) {
		const next = path ? `${path}.${key}` : key;
		if (
			/(password|passwd|token|bearer|invite.?code|booking.?ref|credential|secret|(^|_)pin($|_))/i.test(
				key,
			)
		)
			issue("secret", next, "Credential-shaped field is forbidden");
		forbiddenFields(item, next, issue);
	}
}

function sanitizeJson(
	value: Json,
	path: string,
	rawMemberIds: string[],
	issue: (code: string, path: string, message: string) => void,
): Json {
	if (typeof value === "string")
		return validateText(value, path, rawMemberIds, issue, true);
	if (typeof value === "number" && !Number.isFinite(value)) {
		issue("invalid", path, "JSON number must be finite");
		return null;
	}
	if (Array.isArray(value))
		return value.map((item, index) =>
			sanitizeJson(item, `${path}[${index}]`, rawMemberIds, issue),
		);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => compareText(a, b))
				.filter(([key]) => {
					const forbidden =
						/(password|passwd|token|bearer|invite.?code|booking.?ref|credential|secret|(^|_)pin($|_))/i.test(
							key,
						);
					if (forbidden)
						issue("secret", `${path}.${key}`, "Forbidden field was removed");
					return !forbidden;
				})
				.map(([key, item]) => [
					key,
					sanitizeJson(item, `${path}.${key}`, rawMemberIds, issue),
				]),
		);
	return value;
}

function validateText(
	value: unknown,
	path: string,
	rawMemberIds: string[],
	issue: (code: string, path: string, message: string) => void,
	allowControls = false,
) {
	if (typeof value !== "string") {
		issue("invalid", path, "Expected text");
		return "";
	}
	if (
		/\bBearer\s+\S+/i.test(value) ||
		/[\w-]+\.[\w-]+\.[\w-]+/.test(value) ||
		/\b(?:password|token|credential|secret)\s*[:=]\s*\S+/i.test(value)
	) {
		issue("secret", path, "Credential-shaped value was redacted");
		return "[redacted-secret]";
	}
	if (rawMemberIds.some((id) => value.includes(id))) {
		issue("secret", path, "Legacy bearer member ID was redacted");
		return "[redacted-legacy-member-id]";
	}
	const withoutControls = Array.from(value, (character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127 ? " " : character;
	}).join("");
	if (!allowControls && withoutControls !== value) {
		issue("invalid", path, "Control characters are forbidden");
		return withoutControls.trim();
	}
	return value;
}

function validateFileName(
	value: unknown,
	path: string,
	rawMemberIds: string[],
	issue: (code: string, path: string, message: string) => void,
) {
	const fileName = validateText(value, path, rawMemberIds, issue);
	if (
		typeof value === "string" &&
		(value === "." ||
			value === ".." ||
			value.includes("/") ||
			value.includes("\\"))
	) {
		issue("invalid", path, "Media filename must not contain a path");
		return "invalid-file-name";
	}
	return fileName;
}

function validateMimeType(
	value: unknown,
	path: string,
	rawMemberIds: string[],
	issue: (code: string, path: string, message: string) => void,
) {
	const mimeType = validateText(value, path, rawMemberIds, issue).toLowerCase();
	if (
		!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(
			mimeType,
		)
	) {
		issue("invalid", path, "Invalid media MIME type");
		return "application/octet-stream";
	}
	return mimeType;
}

function sortedObject<T>(value: Record<string, T>) {
	return Object.fromEntries(
		Object.entries(value).sort(([a], [b]) => compareText(a, b)),
	);
}

function compareText(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}
