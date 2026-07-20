import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GatewayClient,
	type Session,
	type SessionStore,
} from "@crew/mobile-client";
import {
	MobileDataStore,
	MobileSyncEngine,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
	type SyncBootstrapPage,
	type SyncPullPage,
	type SyncSnapshotRecord,
	type SyncTeamAssignmentData,
	type SyncTeamAssignmentRosterData,
	type SyncTeamAssignmentSetData,
	type SyncTeamDecisionData,
	type SyncTeamResponseData,
	TeamOfflineStore,
} from "../src/index.ts";

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;

	constructor(path = ":memory:") {
		this.sqlite = new Database(path, { create: true });
	}

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		this.sqlite.query(sql).run(...parameters);
	}

	async all<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<readonly Row[]> {
		return this.sqlite.query(sql).all(...parameters) as Row[];
	}

	async first<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<Row | null> {
		return (this.sqlite.query(sql).get(...parameters) as Row | null) ?? null;
	}

	async transaction<Result>(
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result> {
		this.sqlite.exec("BEGIN IMMEDIATE");
		try {
			const result = await work(this);
			this.sqlite.exec("COMMIT");
			return result;
		} catch (error) {
			this.sqlite.exec("ROLLBACK");
			throw error;
		}
	}

	close() {
		this.sqlite.close();
	}
}

class StaticSessionStore implements SessionStore {
	constructor(private session: Session | null) {}

	async get(): Promise<Session | null> {
		return this.session;
	}

	async compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean> {
		if (
			this.session?.user.id !== expected?.user.id ||
			this.session?.accessToken !== expected?.accessToken ||
			this.session?.refreshToken !== expected?.refreshToken
		) {
			return false;
		}
		this.session = replacement;
		return true;
	}
}

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

const now = "2026-07-19T10:00:00.000Z";
const rootEventId = "evt_team_offsite";
const participant = userId(1);
const manager = userId(2);
const viewer = userId(3);
const foreign = userId(4);
const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
const decisionId = "tdc_lunch";
const redOption = "tdo_red";
const blueOption = "tdo_blue";
const cursor1 = "cursor-team-000001";
const cursor2 = "cursor-team-000002";
const cursor3 = "cursor-team-000003";

describe("team collaboration mobile data", () => {
	test("materializes only self data for participants and rejects roster or foreign responses atomically", async () => {
		const database = await databaseFor(participant, "participant", {
			assignment: true,
			response: true,
		});
		const team = new TeamOfflineStore(database);
		expect(
			await team.getAssignments(participant, rootEventId, rootEventId),
		).toEqual(
			expect.objectContaining({
				roster: null,
				ownTeam: { id: "ttm_red", name: "Red", color: "#FF0000" },
				canManage: false,
			}),
		);
		expect(
			await team.getDecision(participant, rootEventId, decisionId),
		).toEqual(
			expect.objectContaining({
				authoritativeOptionId: redOption,
				selectedOptionId: redOption,
				responseSyncState: "synced",
			}),
		);

		const store = new MobileDataStore(database);
		await expect(
			store.applyPullPage(
				participant,
				cursor1,
				pullPage("cursor-roster", [
					upsert("2", 0, "teamAssignmentRoster", roster()),
				]),
			),
		).rejects.toThrow("team roster is manager-only");
		expect(
			(await store.getRootSyncState(participant, rootEventId))?.pullCursor,
		).toBe(cursor1);
		expect(
			await database.first(
				"SELECT 1 FROM team_assignment_roster_members WHERE account_user_id = ?",
				[participant],
			),
		).toBeNull();

		await expect(
			store.applyPullPage(
				participant,
				cursor1,
				pullPage("cursor-foreign", [
					upsert("2", 0, "teamResponse", response(foreign, redOption, 1, "2")),
				]),
			),
		).rejects.toThrow("foreign team response is not materializable");
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM team_own_responses WHERE account_user_id = ?",
				[participant],
			),
		).toEqual({ count: 1 });
		const participantEngine = syncEngine(database, participant, noFetch);
		await expect(
			participantEngine.enqueueMutation(
				participant,
				rootEventId,
				deviceId,
				{
					kind: "team.response.set",
					entityId: `trp_${decisionId}:${foreign}`,
					baseVersion: 1,
					payload: {
						eventId: rootEventId,
						decisionId,
						optionId: blueOption,
					},
				},
				{},
			),
		).rejects.toThrow("Invalid response entity ID");
		database.close();
	});

	test("gives managers a roster without foreign personal responses and keeps viewers read-only", async () => {
		const managerDatabase = await databaseFor(manager, "owner", {
			roster: true,
			assignment: true,
		});
		const managerStore = new TeamOfflineStore(managerDatabase);
		const assignments = await managerStore.getAssignments(
			manager,
			rootEventId,
			rootEventId,
		);
		expect(assignments?.roster).toEqual([
			{
				id: "ttm_red",
				name: "Red",
				color: "#FF0000",
				memberUserIds: [participant, manager],
			},
			{
				id: "ttm_blue",
				name: "Blue",
				color: "#0000FF",
				memberUserIds: [foreign],
			},
		]);
		expect(assignments?.canManage).toBe(true);
		const managerEngine = syncEngine(managerDatabase, manager, noFetch);
		await managerEngine.enqueueTeamAssignments(manager, rootEventId, deviceId, {
			eventId: rootEventId,
			baseVersion: 1,
			teams: [
				{
					id: "ttm_red",
					name: " Red ",
					color: "#ff0000",
					memberUserIds: [manager, participant],
				},
			],
		});
		await managerEngine.enqueueTeamDecision(manager, rootEventId, deviceId, {
			eventId: rootEventId,
			decisionId: "tdc_evening",
			baseVersion: 0,
			title: " Evening plan ",
			state: "draft",
			options: [
				{ id: "tdo_walk", label: " Walk " },
				{ id: "tdo_games", label: "Games" },
			],
		});
		const managerOutbox = await managerEngine.listOutbox(manager, rootEventId);
		expect(
			managerOutbox.map(({ clientSequence, command }) => ({
				clientSequence,
				kind: "kind" in command ? command.kind : null,
			})),
		).toEqual([
			{ clientSequence: 1, kind: "team.assignments.publish" },
			{ clientSequence: 2, kind: "team.decision.replace" },
		]);
		expect(managerOutbox[0]?.command).toEqual(
			expect.objectContaining({
				payload: {
					eventId: rootEventId,
					teams: [
						{
							id: "ttm_red",
							name: "Red",
							color: "#FF0000",
							memberUserIds: [participant, manager],
						},
					],
				},
			}),
		);
		expect(
			await managerDatabase.first(
				"SELECT 1 FROM team_own_responses WHERE user_id = ?",
				[foreign],
			),
		).toBeNull();

		const managerData = new MobileDataStore(managerDatabase);
		await managerData.applyPullPage(
			manager,
			cursor1,
			pullPage(cursor2, [
				upsert("2", 0, "teamDecision", {
					...decision(2, 2, "open", null),
					title: "Evening plan",
					options: [
						{ id: "tdo_walk", label: "Walk", responseCount: 0 },
						{ id: "tdo_games", label: "Games", responseCount: 0 },
					],
				}),
			]),
		);
		expect(
			(
				await managerStore.getDecision(manager, rootEventId, decisionId)
			)?.options.map(({ id }) => id),
		).toEqual(["tdo_walk", "tdo_games"]);
		await expect(
			managerData.applyPullPage(
				manager,
				cursor2,
				pullPage("cursor-manager-foreign", [
					upsert("2", 0, "teamResponse", response(foreign, blueOption, 1, "2")),
				]),
			),
		).rejects.toThrow("foreign team response is not materializable");
		managerDatabase.close();

		const viewerDatabase = await databaseFor(viewer, "viewer");
		const viewerStore = new TeamOfflineStore(viewerDatabase);
		expect(
			await viewerStore.getAssignments(viewer, rootEventId, rootEventId),
		).toEqual(
			expect.objectContaining({
				roster: null,
				ownTeam: null,
				canManage: false,
			}),
		);
		expect(
			await viewerStore.getDecision(viewer, rootEventId, decisionId),
		).toEqual(
			expect.objectContaining({
				canRespond: false,
				authoritativeOptionId: null,
				selectedOptionId: null,
			}),
		);
		const viewerEngine = syncEngine(viewerDatabase, viewer, noFetch);
		await expect(
			viewerEngine.enqueueTeamResponse(viewer, rootEventId, deviceId, {
				eventId: rootEventId,
				decisionId,
				optionId: redOption,
				baseVersion: 0,
			}),
		).rejects.toThrow("Viewers cannot respond");
		await expect(
			viewerEngine.enqueueTeamDecision(viewer, rootEventId, deviceId, {
				eventId: rootEventId,
				decisionId: "tdc_private",
				baseVersion: 0,
				title: "Private",
				state: "draft",
				options: [
					{ id: "tdo_yes", label: "Yes" },
					{ id: "tdo_no", label: "No" },
				],
			}),
		).rejects.toThrow("Team management requires");
		viewerDatabase.close();
	});

	test("replays byte-identical response bytes after process restart and converges on acknowledgement plus pull", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-team-retry-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "mobile.sqlite");
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		await bootstrap(firstDatabase, participant, "participant");
		const bodies: string[] = [];
		const firstEngine = syncEngine(
			firstDatabase,
			participant,
			async (_input, init) => {
				bodies.push(String(init?.body));
				throw new Error("offline");
			},
		);
		const outbox = await firstEngine.enqueueTeamResponse(
			participant,
			rootEventId,
			deviceId,
			{
				eventId: rootEventId,
				decisionId,
				optionId: blueOption,
				baseVersion: 0,
			},
		);
		expect(outbox.command).toEqual(
			expect.objectContaining({
				kind: "team.response.set",
				entityId: `trp_${decisionId}:${participant}`,
				payload: { eventId: rootEventId, decisionId, optionId: blueOption },
			}),
		);
		await firstEngine.syncRoot(participant, rootEventId);
		firstDatabase.close();

		const secondDatabase = new BunDatabase(path);
		await migrate(secondDatabase);
		const secondEngine = syncEngine(
			secondDatabase,
			participant,
			async (_input, init) => {
				if (init?.method === "POST") {
					bodies.push(String(init.body));
					const body = JSON.parse(String(init.body)) as {
						mutations: { clientMutationId: string; clientSequence: number }[];
					};
					const mutation = required(body.mutations[0]);
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId,
						deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "applied",
								replayed: true,
								rootRevision: "2",
								entity: {
									entityType: "teamResponse",
									entityId: `trp_${decisionId}:${participant}`,
									version: 1,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence + 1,
					});
				}
				return gatewayJson(
					init,
					200,
					pullPage(cursor2, [
						upsert(
							"2",
							0,
							"teamResponse",
							response(participant, blueOption, 1, "2"),
						),
						upsert("2", 1, "teamDecision", decision(1, 2, "open", blueOption)),
					]),
				);
			},
		);
		await secondEngine.syncRoot(participant, rootEventId, { force: true });
		expect(bodies).toHaveLength(2);
		expect(bodies[1]).toBe(bodies[0]);
		expect(await secondEngine.listOutbox(participant, rootEventId)).toEqual([]);
		const converged = await new TeamOfflineStore(secondDatabase).getDecision(
			participant,
			rootEventId,
			decisionId,
		);
		expect(converged).toEqual(
			expect.objectContaining({
				authoritativeOptionId: blueOption,
				selectedOptionId: blueOption,
				responseSyncState: "synced",
			}),
		);
		expect(
			await new MobileDataStore(secondDatabase).applyPullPage(
				participant,
				cursor1,
				pullPage(cursor2, []),
			),
		).toEqual({ replayed: true });
		secondDatabase.close();
	});

	test("rejects a team acknowledgement for the wrong actor-bound entity", async () => {
		const database = await databaseFor(participant, "participant");
		const engine = syncEngine(database, participant, async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as {
				mutations: { clientMutationId: string; clientSequence: number }[];
			};
			const mutation = required(body.mutations[0]);
			return gatewayJson(init, 200, {
				protocolVersion: 1,
				rootEventId,
				deviceId,
				results: [
					{
						clientMutationId: mutation.clientMutationId,
						clientSequence: mutation.clientSequence,
						outcome: "applied",
						replayed: false,
						rootRevision: "2",
						entity: {
							entityType: "teamResponse",
							entityId: `trp_${decisionId}:${foreign}`,
							version: 1,
						},
					},
				],
				nextExpectedClientSequence: mutation.clientSequence + 1,
			});
		});
		await engine.enqueueTeamResponse(participant, rootEventId, deviceId, {
			eventId: rootEventId,
			decisionId,
			optionId: blueOption,
			baseVersion: 0,
		});
		await engine.syncRoot(participant, rootEventId);
		expect(await engine.listOutbox(participant, rootEventId)).toEqual([
			expect.objectContaining({
				state: "pending",
				lastError: expect.objectContaining({ code: "network" }),
			}),
		]);
		database.close();
	});

	test("keeps a changed local choice when the server closes and rejects during an outage", async () => {
		const database = await databaseFor(participant, "participant", {
			response: true,
		});
		const engine = syncEngine(database, participant, async (_input, init) => {
			if (init?.method === "POST") {
				const body = JSON.parse(String(init.body)) as {
					mutations: { clientMutationId: string; clientSequence: number }[];
				};
				const mutation = required(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: [
						{
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "rejected",
							replayed: false,
							error: {
								code: "TEAM_DECISION_NOT_OPEN",
								message: "Closed",
								retryable: false,
								currentVersion: 1,
							},
						},
					],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			return gatewayJson(
				init,
				200,
				pullPage(cursor2, [
					upsert("2", 0, "teamDecision", decision(1, 2, "closed", redOption)),
				]),
			);
		});
		await engine.enqueueTeamResponse(participant, rootEventId, deviceId, {
			eventId: rootEventId,
			decisionId,
			optionId: blueOption,
			baseVersion: 1,
		});
		await engine.syncRoot(participant, rootEventId);
		const local = await new TeamOfflineStore(database).getDecision(
			participant,
			rootEventId,
			decisionId,
		);
		expect(local).toEqual(
			expect.objectContaining({
				state: "closed",
				authoritativeOptionId: redOption,
				selectedOptionId: blueOption,
				responseSyncState: "needs_attention",
				canRespond: false,
			}),
		);
		expect((await engine.listOutbox(participant, rootEventId))[0]?.state).toBe(
			"dead_letter",
		);
		database.close();
	});

	test("cleans assignment tombstones and roster snapshots per account without cursor bleed", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, participant, "participant", {
			assignment: true,
		});
		await bootstrap(database, manager, "owner", {
			roster: true,
			assignment: true,
		});
		const participantData = new MobileDataStore(database);
		await participantData.applyPullPage(
			participant,
			cursor1,
			pullPage(cursor2, [assignmentTombstone("2", 0, participant, 2)]),
		);
		expect(
			(
				await new TeamOfflineStore(database).getAssignments(
					participant,
					rootEventId,
					rootEventId,
				)
			)?.ownTeam,
		).toBeNull();
		expect(
			await database.first(
				`SELECT 1 FROM sync_tombstones
WHERE account_user_id = ? AND entity_type = 'teamAssignment'`,
				[participant],
			),
		).not.toBeNull();
		await participantData.applyPullPage(
			participant,
			cursor2,
			pullPage(cursor3, [
				{
					rootRevision: "3",
					ordinal: 0,
					entityType: "teamAssignment",
					entityId: `tma_${rootEventId}:${participant}`,
					operation: "upsert",
					entityVersion: 1,
					data: assignment(participant),
				},
			]),
		);
		expect(
			(
				await new TeamOfflineStore(database).getAssignments(
					participant,
					rootEventId,
					rootEventId,
				)
			)?.ownTeam,
		).toBeNull();
		expect(
			(
				await new TeamOfflineStore(database).getAssignments(
					manager,
					rootEventId,
					rootEventId,
				)
			)?.roster?.[0]?.memberUserIds,
		).toEqual([participant, manager]);

		await participantData.applyBootstrapPage(
			participant,
			null,
			bootstrapPage(participant, "participant", {}, "2", "2"),
		);
		expect(
			await database.first(
				`SELECT 1 FROM sync_tombstones
WHERE account_user_id = ? AND entity_type = 'teamAssignment'`,
				[participant],
			),
		).toBeNull();
		expect(
			(await participantData.getRootSyncState(participant, rootEventId))
				?.pullCursor,
		).toBe(cursor2);
		expect(
			(
				await new MobileDataStore(database).getRootSyncState(
					manager,
					rootEventId,
				)
			)?.pullCursor,
		).toBe(cursor1);

		await new MobileDataStore(database).applyBootstrapPage(
			manager,
			null,
			bootstrapPage(manager, "participant", { assignment: true }, "2", "2"),
		);
		expect(
			await database.first(
				"SELECT 1 FROM team_assignment_roster_members WHERE account_user_id = ?",
				[manager],
			),
		).toBeNull();
		expect(
			(
				await new TeamOfflineStore(database).getAssignments(
					manager,
					rootEventId,
					rootEventId,
				)
			)?.roster,
		).toBeNull();
		await participantData.clearUserData(participant);
		expect(
			await new TeamOfflineStore(database).getAssignments(
				participant,
				rootEventId,
				rootEventId,
			),
		).toBeNull();
		expect(
			await new TeamOfflineStore(database).getAssignments(
				manager,
				rootEventId,
				rootEventId,
			),
		).not.toBeNull();
		database.close();
	});
});

async function databaseFor(
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
	options: BootstrapOptions = {},
) {
	const database = new BunDatabase();
	await migrate(database);
	await bootstrap(database, accountUserId, role, options);
	return database;
}

async function bootstrap(
	database: SqlDatabase,
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
	options: BootstrapOptions = {},
) {
	await new MobileDataStore(database).applyBootstrapPage(
		accountUserId,
		null,
		bootstrapPage(accountUserId, role, options),
	);
}

interface BootstrapOptions {
	roster?: boolean;
	assignment?: boolean;
	response?: boolean;
}

function bootstrapPage(
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
	options: BootstrapOptions = {},
	revision = "1",
	scope = "1",
): SyncBootstrapPage {
	const records: SyncSnapshotRecord[] = [
		{
			entityType: "event",
			entityId: rootEventId,
			entityVersion: 1,
			data: {
				id: rootEventId,
				rootEventId,
				parentEventId: null,
				kind: "team_event",
				title: "Team Offsite",
				description: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				sortKey: "1",
				childOrderVersion: 1,
				itineraryOrderVersion: 1,
				status: "published",
				version: 1,
				createdAt: now,
				updatedAt: now,
				deletedAt: null,
			},
		},
		{
			entityType: "membership",
			entityId: accountUserId,
			entityVersion: 1,
			data: {
				rootEventId,
				userId: accountUserId,
				role,
				status: "active",
				version: 1,
				createdAt: now,
				updatedAt: now,
			},
		},
		{
			entityType: "teamAssignmentSet",
			entityId: rootEventId,
			entityVersion: 1,
			data: assignmentSet(),
		},
		{
			entityType: "teamDecision",
			entityId: decisionId,
			entityVersion: 1,
			data: decision(1, 1, "open", options.response ? redOption : null),
		},
	];
	if (options.roster) {
		records.push({
			entityType: "teamAssignmentRoster",
			entityId: `tro_${rootEventId}`,
			entityVersion: 1,
			data: roster(),
		});
	}
	if (options.assignment) {
		records.push({
			entityType: "teamAssignment",
			entityId: `tma_${rootEventId}:${accountUserId}`,
			entityVersion: 1,
			data: assignment(accountUserId),
		});
	}
	if (options.response) {
		records.push({
			entityType: "teamResponse",
			entityId: `trp_${decisionId}:${accountUserId}`,
			entityVersion: 1,
			data: response(accountUserId, redOption, 1, "1"),
		});
	}
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion: scope,
		snapshotId: `snp_team_${accountUserId.slice(4, 12)}_${revision}`,
		snapshotRevision: revision,
		records,
		syncCursor: revision === "1" ? cursor1 : cursor2,
		pageInfo: { nextCursor: null, hasMore: false },
	};
}

function assignmentSet(): SyncTeamAssignmentSetData {
	return {
		rootEventId,
		eventId: rootEventId,
		teams: publicTeams(),
		version: 1,
		updatedAt: now,
	};
}

function roster(): SyncTeamAssignmentRosterData {
	return {
		rootEventId,
		eventId: rootEventId,
		teams: [
			{
				...required(publicTeams()[0]),
				memberUserIds: [manager, participant],
			},
			{ ...required(publicTeams()[1]), memberUserIds: [foreign] },
		],
		version: 1,
		updatedAt: now,
	};
}

function assignment(accountUserId: string): SyncTeamAssignmentData {
	return {
		rootEventId,
		eventId: rootEventId,
		userId: accountUserId,
		team: required(publicTeams()[0]),
		version: 1,
		updatedAt: now,
	};
}

function decision(
	version: number,
	aggregateVersion: number,
	state: SyncTeamDecisionData["state"],
	responseOption: string | null,
): SyncTeamDecisionData {
	return {
		id: decisionId,
		rootEventId,
		eventId: rootEventId,
		title: "Where should we eat?",
		state,
		options: [
			{
				id: redOption,
				label: "Red room",
				responseCount: responseOption === redOption ? 1 : 0,
			},
			{
				id: blueOption,
				label: "Blue room",
				responseCount: responseOption === blueOption ? 1 : 0,
			},
		],
		responseCount: responseOption === null ? 0 : 1,
		version,
		aggregateVersion,
		createdAt: now,
		updatedAt: now,
	};
}

function response(
	accountUserId: string,
	optionId: string,
	version: number,
	rootRevision: string,
): SyncTeamResponseData {
	return {
		id: `trp_${decisionId}:${accountUserId}`,
		rootEventId,
		eventId: rootEventId,
		decisionId,
		userId: accountUserId,
		optionId,
		version,
		rootRevision,
		createdAt: now,
		updatedAt: now,
	};
}

function publicTeams() {
	return [
		{ id: "ttm_red", name: "Red", color: "#FF0000" },
		{ id: "ttm_blue", name: "Blue", color: "#0000FF" },
	];
}

function upsert<
	Type extends "teamAssignmentRoster" | "teamResponse" | "teamDecision",
>(
	rootRevision: string,
	ordinal: number,
	entityType: Type,
	data: Type extends "teamAssignmentRoster"
		? SyncTeamAssignmentRosterData
		: Type extends "teamResponse"
			? SyncTeamResponseData
			: SyncTeamDecisionData,
) {
	const entityId =
		entityType === "teamAssignmentRoster"
			? `tro_${rootEventId}`
			: "id" in data
				? data.id
				: rootEventId;
	return {
		rootRevision,
		ordinal,
		entityType,
		entityId,
		operation: "upsert" as const,
		entityVersion:
			entityType === "teamDecision"
				? (data as SyncTeamDecisionData).aggregateVersion
				: data.version,
		data,
	} as SyncPullPage["changes"][number];
}

function assignmentTombstone(
	rootRevision: string,
	ordinal: number,
	accountUserId: string,
	version: number,
): SyncPullPage["changes"][number] {
	const id = `tma_${rootEventId}:${accountUserId}`;
	return {
		rootRevision,
		ordinal,
		entityType: "teamAssignment",
		entityId: id,
		operation: "tombstone",
		entityVersion: version,
		tombstone: {
			entityType: "teamAssignment",
			id,
			rootEventId,
			eventId: rootEventId,
			version,
			deletedAt: now,
		},
	};
}

function pullPage(
	checkpointCursor: string,
	changes: SyncPullPage["changes"],
): SyncPullPage {
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion: "1",
		changes,
		checkpointCursor,
		pageInfo: { nextCursor: null, hasMore: false },
	};
}

function syncEngine(
	database: SqlDatabase,
	accountUserId: string,
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
) {
	let requestNumber = 0;
	const client = new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore: new StaticSessionStore(session(accountUserId)),
		fetch: fetchImplementation as typeof fetch,
		requestId: () => `request-team-${String(++requestNumber).padStart(6, "0")}`,
		idempotencyKey: () => "unused-idempotency",
	});
	return new MobileSyncEngine(database, client, {
		activeAccountUserId: () => accountUserId,
		now: () => new Date(now),
		random: () => 0.5,
		randomUUID: uuidSequence(),
	});
}

function session(accountUserId: string): Session {
	return {
		accessToken: "access-team-secret",
		refreshToken: "refresh-team-secret",
		tokenType: "Bearer",
		expiresInSeconds: 300,
		user: {
			id: accountUserId,
			email: "team@example.com",
			profile: {
				displayName: "Team",
				avatarUrl: null,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				reduceMotion: false,
				eventReminders: true,
				productUpdates: false,
				version: 1,
				updatedAt: now,
			},
		},
	};
}

function gatewayJson(
	init: RequestInit | undefined,
	status: number,
	body: unknown,
) {
	const requestId = required(new Headers(init?.headers).get("x-request-id"));
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"X-Request-ID": requestId,
		},
	});
}

function uuidSequence() {
	let value = 1;
	return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

function userId(value: number) {
	return `usr_${value.toString(16).padStart(32, "0")}`;
}

async function noFetch(): Promise<Response> {
	throw new Error("network must not run");
}

function required<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("test value missing");
	return value;
}
