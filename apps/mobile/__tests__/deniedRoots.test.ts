import type { SqlDatabase, SqlExecutor, SqlValue } from '@crew/mobile-data';
import {
  DeniedRootRegistry,
  MAX_PENDING_ROOT_VERIFICATIONS,
  type DeniedRootCredentials,
} from '../src/storage/deniedRoots';

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;

class MemoryCredentials implements DeniedRootCredentials {
  readonly values = new Map<string, { username: string; password: string }>();
  failNextSet = false;

  async get(service: string) {
    return this.values.get(service) ?? null;
  }

  async set(service: string, username: string, password: string) {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error('protected marker write failed');
    }
    this.values.set(service, { username, password });
  }

  async reset(service: string) {
    this.values.delete(service);
  }

  state(accountUserId: string) {
    const value = [...this.values.values()].find(
      credential => credential.username === accountUserId,
    );
    return value ? JSON.parse(value.password) : null;
  }
}

test('does not claim a durable arm when protected marker persistence fails', async () => {
  const credentials = new MemoryCredentials();
  credentials.failNextSet = true;
  const registry = new DeniedRootRegistry(credentials, tokenSequence());

  await expect(registry.arm(accountA, 'evt_unarmed')).rejects.toThrow(
    'protected marker write failed',
  );
  expect(credentials.state(accountA)).toBeNull();
});

test('keeps concurrent verification tokens scoped to their account and root', async () => {
  const credentials = new MemoryCredentials();
  const registry = new DeniedRootRegistry(credentials, tokenSequence());
  const firstA = await registry.arm(accountA, 'evt_first');
  await registry.arm(accountA, 'evt_first');
  await registry.arm(accountA, 'evt_second');
  const firstB = await registry.arm(accountB, 'evt_first');

  await registry.finish(accountA, 'evt_second', firstA);
  await registry.finish(accountA, 'evt_first', firstB);
  await registry.finish(accountB, 'evt_first', firstA);
  await registry.finish(accountA, 'evt_first', firstA);
  const accountARuns = databaseRecorder();
  await registry.purgeRecorded(accountA, accountARuns.database);

  expect(deletedRoots(accountARuns.runs)).toEqual([
    [accountA, 'evt_first'],
    [accountA, 'evt_second'],
  ]);
  expect(credentials.state(accountA)).toBeNull();
  expect(credentials.state(accountB)).not.toBeNull();

  const accountBRuns = databaseRecorder();
  await registry.purgeRecorded(accountB, accountBRuns.database);
  expect(deletedRoots(accountBRuns.runs)).toEqual([[accountB, 'evt_first']]);
});

test('normalizes bounded growth into an account-wide fail-closed sentinel', async () => {
  const credentials = new MemoryCredentials();
  const registry = new DeniedRootRegistry(credentials, tokenSequence());
  for (let index = 0; index <= MAX_PENDING_ROOT_VERIFICATIONS; index += 1) {
    await registry.arm(accountA, `evt_external_${index}`);
  }
  await registry.arm(accountB, 'evt_other_account');

  expect(credentials.state(accountA)).toEqual({
    version: 1,
    purgeAll: true,
    entries: [],
  });
  expect(JSON.stringify(credentials.state(accountA)).length).toBeLessThan(80);

  const recorder = databaseRecorder();
  await registry.purgeRecorded(accountA, recorder.database);
  const rootDelete = recorder.runs.find(({ sql }) =>
    sql.includes('DELETE FROM root_sync_state'),
  );
  expect(rootDelete?.parameters).toEqual([accountA]);
  expect(credentials.state(accountA)).toBeNull();
  expect(credentials.state(accountB)).not.toBeNull();
});

test('retains the durable marker when a closed database cannot purge, then clears it on restart', async () => {
  const credentials = new MemoryCredentials();
  const registry = new DeniedRootRegistry(credentials, tokenSequence());
  await registry.arm(accountA, 'evt_closed_handle');
  const closed = databaseRecorder(true);

  await expect(
    registry.purgeRecorded(accountA, closed.database),
  ).rejects.toThrow('closed database');
  expect(credentials.state(accountA)).not.toBeNull();

  const restarted = databaseRecorder();
  await registry.purgeRecorded(accountA, restarted.database);
  expect(deletedRoots(restarted.runs)).toEqual([
    [accountA, 'evt_closed_handle'],
  ]);
  expect(credentials.state(accountA)).toBeNull();
});

function databaseRecorder(failRootDelete = false) {
  const runs: Array<{ sql: string; parameters: readonly SqlValue[] }> = [];
  const executor: SqlExecutor = {
    exec: async () => undefined,
    run: async (sql, parameters = []) => {
      runs.push({ sql, parameters });
      if (failRootDelete && sql.includes('DELETE FROM root_sync_state')) {
        throw new Error('closed database');
      }
    },
    all: async <Row>() => [] as Row[],
    first: async <Row>() => null as Row | null,
  };
  const database = {
    ...executor,
    transaction: <Result>(
      work: (transaction: SqlExecutor) => Promise<Result>,
    ) => work(executor),
  } as SqlDatabase;
  return { database, runs };
}

function deletedRoots(
  runs: readonly { sql: string; parameters: readonly SqlValue[] }[],
) {
  return runs
    .filter(
      ({ sql, parameters }) =>
        sql.includes('DELETE FROM root_sync_state') && parameters.length === 2,
    )
    .map(({ parameters }) => parameters);
}

function tokenSequence() {
  let value = 0;
  return () => {
    value += 1;
    return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
  };
}
