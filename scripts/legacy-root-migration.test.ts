import { describe, expect, test } from "bun:test";
import {
	canonicalJson,
	exportLegacyRoot,
	type LegacyRootSnapshot,
	reconciliationBasis,
	validateOnlyThroughApi,
} from "./legacy-root-migration";

describe("legacy root migration boundary", () => {
	test.each(["golf", "team_event"] as const)(
		"exports a deterministic, root-scoped, secret-free %s root",
		async (type) => {
			const source = fixture(type);
			const first = await exportLegacyRoot(
				reader(source),
				source.root.legacyId,
			);
			const shuffled = await exportLegacyRoot(
				reader({
					...source,
					members: [...source.members].reverse(),
					records: [...source.records].reverse(),
					media: [...source.media].reverse(),
				}),
				source.root.legacyId,
			);

			expect(first.validation).toEqual({ valid: true, issues: [] });
			expect(first.artifact).toEqual(shuffled.artifact);
			expect(first.artifact.sha256).toHaveLength(64);
			const serialized = canonicalJson(first.artifact);
			expect(serialized).not.toContain("member-owner");
			expect(serialized).not.toContain("group-secret");
			expect(serialized).not.toMatch(/password|invite.?code|bearer/i);
			expect(reconciliationBasis(first.artifact).counts).toMatchObject({
				member: 2,
				event: 1,
				message: 1,
				media: 1,
			});
		},
	);

	test("reports every invalid, unsupported and secret record before any API write", async () => {
		const source = fixture("golf") as LegacyRootSnapshot & {
			password_hash?: string;
		};
		source.password_hash = "never-export";
		const member = source.members[1];
		const event = source.records[0];
		const item = source.records[1];
		const media = source.media[0];
		if (!member || !event || !item || !media)
			throw new Error("Invalid fixture");
		member.groupId = "another-group";
		source.media.push({ ...media });
		source.records.push({
			kind: "ski_day",
			legacyId: "unsupported",
			rootEventId: source.root.legacyId,
			data: {},
		});
		event.links = [
			{ role: "member", kind: "member", legacyId: "missing-member" },
		];
		item.data = {
			note: "Bearer leaked-token",
			password: "never-export",
			unlabeled: source.deniedTextValues[0] ?? "",
			distance: Number.POSITIVE_INFINITY,
		};
		source.root.title = "Crew member-owner";
		media.fileName = "../member-owner.jpg";
		media.mimeType = "not a mime";
		media.sha256 = "bad";

		const exported = await exportLegacyRoot(
			reader(source),
			source.root.legacyId,
		);
		let validateCalls = 0;
		const result = await validateOnlyThroughApi(
			{
				validateOnly: async () => {
					validateCalls += 1;
					return { accepted: true, issues: [] };
				},
			},
			exported,
		);

		expect(exported.validation.valid).toBe(false);
		expect(new Set(exported.validation.issues.map(({ code }) => code))).toEqual(
			new Set([
				"duplicate",
				"invalid",
				"reference",
				"scope",
				"secret",
				"unsupported",
			]),
		);
		expect(result.accepted).toBe(false);
		expect(validateCalls).toBe(0);
		expect(canonicalJson(exported.artifact)).not.toContain("never-export");
		expect(canonicalJson(exported.artifact)).not.toContain("member-owner");
		expect(canonicalJson(exported.artifact)).not.toContain(
			source.deniedTextValues[0] ?? "",
		);
		expect(exported.artifact.root.title).toBe("[redacted-legacy-member-id]");
		expect(exported.artifact.media[0]?.fileName).toBe("invalid-file-name");
		expect(exported.artifact.media[0]?.mimeType).toBe(
			"application/octet-stream",
		);
		expect(
			exported.artifact.records.find(
				(record) =>
					typeof record.data === "object" &&
					record.data !== null &&
					!Array.isArray(record.data) &&
					"distance" in record.data,
			)?.data,
		).toMatchObject({ distance: null });
	});

	test("calls only authenticated API validate-only with the export checksum", async () => {
		const source = fixture("team_event");
		const exported = await exportLegacyRoot(
			reader(source),
			source.root.legacyId,
		);
		let received = "";
		const result = await validateOnlyThroughApi(
			{
				validateOnly: async ({ artifact, idempotencyKey }) => {
					received = idempotencyKey;
					return {
						accepted: artifact.sha256 === idempotencyKey,
						issues: [],
					};
				},
			},
			exported,
		);
		expect(result).toEqual({ accepted: true, issues: [] });
		expect(received).toBe(exported.artifact.sha256);
	});

	test("redacts a non-empty denied value even when it is too short", async () => {
		const source = fixture("team_event");
		source.deniedTextValues = ["s3cr3t!"];
		source.root.title = "s3cr3t!";

		const exported = await exportLegacyRoot(
			reader(source),
			source.root.legacyId,
		);

		expect(exported.validation.valid).toBe(false);
		expect(exported.validation.issues).toContainEqual({
			code: "invalid",
			path: "deniedTextValues[0]",
			message: "Denied text values must contain 8 to 4096 characters",
		});
		expect(exported.artifact.root.title).toBe("[redacted-legacy-member-id]");
		expect(canonicalJson(exported.artifact)).not.toContain("s3cr3t!");
	});

	test("canonical JSON ordering is independent of the host locale", () => {
		expect(canonicalJson({ ä: 1, z: 2, a: 3 })).toBe('{"a":3,"z":2,"ä":1}');
	});
});

function reader(source: LegacyRootSnapshot) {
	return {
		access: "read-only" as const,
		readRoot: async () => structuredClone(source),
	};
}

function fixture(type: "golf" | "team_event"): LegacyRootSnapshot {
	const rootId = `root-${type}`;
	const eventKind = type === "golf" ? "golf_round" : "activity";
	return {
		schemaVersion: 1,
		root: {
			legacyId: rootId,
			groupId: "group-secret",
			title: type === "golf" ? "Golfreise" : "Teamtag",
			type,
		},
		deniedTextValues: ["legacy-shared-password"],
		members: [
			{
				legacyId: "member-owner",
				groupId: "group-secret",
				displayName: "Owner",
				role: "organizer",
			},
			{
				legacyId: "member-guest",
				groupId: "group-secret",
				displayName: "Guest",
				role: "participant",
			},
		],
		records: [
			{
				kind: "event",
				legacyId: "day-one",
				rootEventId: rootId,
				links: [{ role: "parent", kind: "root", legacyId: rootId }],
				data: { title: "Tag 1" },
			},
			{
				kind: eventKind,
				legacyId: "item-one",
				rootEventId: rootId,
				links: [
					{ role: "event", kind: "event", legacyId: "day-one" },
					{ role: "participant", kind: "member", legacyId: "member-owner" },
				],
				data:
					type === "golf"
						? { hole: 1, par: 4, strokes: 5 }
						: { title: "Workshop", startsAt: "2026-07-25T09:00:00Z" },
			},
			{
				kind: "message",
				legacyId: "message-one",
				rootEventId: rootId,
				links: [{ role: "author", kind: "member", legacyId: "member-owner" }],
				data: { body: "Willkommen", createdAt: "2026-07-25T08:00:00Z" },
			},
		],
		media: [
			{
				legacyId: "media-one",
				rootEventId: rootId,
				eventLegacyId: "day-one",
				uploaderLegacyId: "member-owner",
				fileName: "photo.jpg",
				mimeType: "image/jpeg",
				byteLength: 12,
				sha256: "a".repeat(64),
			},
		],
	};
}
