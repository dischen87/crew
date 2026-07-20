import type { SqlDatabase, SqlExecutor } from "./database.ts";

const accountPattern = /^usr_[a-f0-9]{32}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const devicePattern =
	/^dvc_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type LegacyDeviceId = () => Promise<string | null>;
type NewDeviceId = () => string;

const identityFlights = new WeakMap<
	SqlDatabase,
	Map<string, Promise<string>>
>();

export function getOrCreateMutationStreamIdentity(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	legacyDeviceId: LegacyDeviceId,
	newDeviceId: NewDeviceId,
): Promise<string> {
	validateScope(accountUserId, rootEventId);
	let flights = identityFlights.get(database);
	if (!flights) {
		flights = new Map();
		identityFlights.set(database, flights);
	}
	const key = `${accountUserId}:${rootEventId}`;
	const existing = flights.get(key);
	if (existing) return existing;
	const flight = getOrCreate(
		database,
		accountUserId,
		rootEventId,
		legacyDeviceId,
		newDeviceId,
	).finally(() => {
		if (flights?.get(key) === flight) flights.delete(key);
	});
	flights.set(key, flight);
	return flight;
}

export async function initializeMutationStreamIdentities(
	database: SqlDatabase,
	accountUserId: string,
	legacyDeviceId: LegacyDeviceId,
	newDeviceId: NewDeviceId,
): Promise<void> {
	validateAccount(accountUserId);
	await database.run(
		`DELETE FROM mutation_stream_identities
WHERE account_user_id = ?
  AND NOT EXISTS (
    SELECT 1 FROM root_sync_state
    WHERE account_user_id = ?
      AND root_event_id = mutation_stream_identities.root_event_id
  )`,
		[accountUserId, accountUserId],
	);
	const roots = await database.all<{ root_event_id: string }>(
		`SELECT DISTINCT root_event_id FROM mutation_streams
WHERE account_user_id = ?
ORDER BY root_event_id`,
		[accountUserId],
	);
	if (roots.length === 0) return;
	const legacy = await safeLegacyDeviceId(legacyDeviceId);
	for (const row of roots) {
		await getOrCreateMutationStreamIdentity(
			database,
			accountUserId,
			row.root_event_id,
			async () => legacy,
			newDeviceId,
		);
	}
}

export async function discardUnboundMutationStreamIdentity(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
): Promise<void> {
	validateScope(accountUserId, rootEventId);
	await database.run(
		`DELETE FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = ?
  AND NOT EXISTS (
    SELECT 1 FROM root_sync_state
    WHERE account_user_id = ? AND root_event_id = ?
  )`,
		[accountUserId, rootEventId, accountUserId, rootEventId],
	);
}

export async function assertMutationStreamIdentity(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	deviceId: string,
): Promise<void> {
	validateScope(accountUserId, rootEventId);
	if (!devicePattern.test(deviceId)) {
		throw new Error("Invalid mutation stream device ID");
	}
	const current = await readIdentity(executor, accountUserId, rootEventId);
	if (current !== deviceId) {
		throw new Error("Mutation stream identity changed; retry the operation");
	}
}

async function getOrCreate(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	legacyDeviceId: LegacyDeviceId,
	newDeviceId: NewDeviceId,
): Promise<string> {
	const existing = await readIdentity(database, accountUserId, rootEventId);
	if (existing) return existing;
	const legacy = await safeLegacyDeviceId(legacyDeviceId);
	return database.transaction(async (transaction) => {
		const current = await readIdentity(transaction, accountUserId, rootEventId);
		if (current) return current;
		const rows = await transaction.all<{ device_id: string }>(
			`SELECT DISTINCT device_id FROM mutation_streams
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY device_id`,
			[accountUserId, rootEventId],
		);
		const streamIds = rows
			.map((row) => row.device_id)
			.filter((deviceId) => devicePattern.test(deviceId));
		const deviceId =
			streamIds.length === 1
				? streamIds[0]
				: legacy && streamIds.includes(legacy)
					? legacy
					: newDeviceId();
		if (!deviceId || !devicePattern.test(deviceId)) {
			throw new Error("Invalid mutation stream device ID");
		}
		await transaction.run(
			`INSERT INTO mutation_stream_identities (
  account_user_id, root_event_id, device_id
) VALUES (?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO NOTHING`,
			[accountUserId, rootEventId, deviceId],
		);
		const stored = await readIdentity(transaction, accountUserId, rootEventId);
		if (!stored) throw new Error("Mutation stream identity was not persisted");
		return stored;
	});
}

async function readIdentity(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
): Promise<string | null> {
	const row = await executor.first<{ device_id: string }>(
		`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = ?`,
		[accountUserId, rootEventId],
	);
	if (!row) return null;
	if (!devicePattern.test(row.device_id)) {
		throw new Error("Invalid persisted mutation stream identity");
	}
	return row.device_id;
}

async function safeLegacyDeviceId(
	legacyDeviceId: LegacyDeviceId,
): Promise<string | null> {
	try {
		const value = await legacyDeviceId();
		return value && devicePattern.test(value) ? value : null;
	} catch {
		return null;
	}
}

function validateScope(accountUserId: string, rootEventId: string): void {
	validateAccount(accountUserId);
	if (!rootPattern.test(rootEventId)) throw new Error("Invalid root event ID");
}

function validateAccount(accountUserId: string): void {
	if (!accountPattern.test(accountUserId))
		throw new Error("Invalid account ID");
}
