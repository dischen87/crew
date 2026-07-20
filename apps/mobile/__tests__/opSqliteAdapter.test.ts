import type { QueryResult, Scalar } from '@op-engineering/op-sqlite';
import { OpSqliteDatabase } from '../src/storage/opSqliteAdapter';

type Pending = { resolve(): void; promise: Promise<void> };

function pending(): Pending {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeConnection {
  calls: string[] = [];
  rows: QueryResult['rows'] = [];

  async execute(query: string, _parameters?: Scalar[]) {
    this.calls.push(query);
    return { rows: this.rows, rowsAffected: 0 };
  }

  async closeAsync() {
    this.calls.push('CLOSE');
  }
}

test('keeps an exclusive async transaction isolated from queued work', async () => {
  const connection = new FakeConnection();
  const database = new OpSqliteDatabase(connection);
  const hold = pending();
  const transaction = database.transaction(async executor => {
    await executor.run('INSERT inside');
    await hold.promise;
    return 'done';
  });
  const outside = database.run('INSERT outside');

  await Promise.resolve();
  await Promise.resolve();
  expect(connection.calls).toEqual(['BEGIN EXCLUSIVE;', 'INSERT inside']);
  hold.resolve();
  await expect(transaction).resolves.toBe('done');
  await outside;
  expect(connection.calls).toEqual([
    'BEGIN EXCLUSIVE;',
    'INSERT inside',
    'COMMIT;',
    'INSERT outside',
  ]);
});

test('rolls back callback failure before releasing the queue', async () => {
  const connection = new FakeConnection();
  const database = new OpSqliteDatabase(connection);

  await expect(
    database.transaction(async executor => {
      await executor.exec(
        'CREATE TABLE a(id); CREATE TRIGGER b AFTER INSERT ON a BEGIN SELECT 1; END;',
      );
      throw new Error('stop');
    }),
  ).rejects.toThrow('stop');
  await database.run('SELECT after');

  expect(connection.calls).toEqual([
    'BEGIN EXCLUSIVE;',
    'CREATE TABLE a(id); CREATE TRIGGER b AFTER INSERT ON a BEGIN SELECT 1; END;',
    'ROLLBACK;',
    'SELECT after',
  ]);
});

test('normalizes native scalar rows for the mobile-data boundary', async () => {
  const connection = new FakeConnection();
  connection.rows = [
    {
      enabled: true,
      bytes: new Uint16Array([258]),
      name: 'Crew',
    },
  ];
  const database = new OpSqliteDatabase(connection);

  const row = await database.first<{
    enabled: number;
    bytes: Uint8Array;
    name: string;
  }>('SELECT values');
  expect(row?.enabled).toBe(1);
  expect(row?.bytes).toBeInstanceOf(Uint8Array);
  expect(row?.name).toBe('Crew');
});
