import type { SqlDatabase, SqlExecutor, SqlValue } from '@crew/mobile-data';
import {
  isSQLCipher,
  open,
  type DB,
  type QueryResult,
  type Scalar,
} from '@op-engineering/op-sqlite';

type Connection = Pick<DB, 'closeAsync' | 'execute'>;

export class OpSqliteDatabase implements SqlDatabase {
  readonly #connection: Connection;
  #tail: Promise<void> = Promise.resolve();

  constructor(connection: Connection) {
    this.#connection = connection;
  }

  exec(sql: string): Promise<void> {
    return this.#enqueue(() => execute(this.#connection, sql));
  }

  run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
    return this.#enqueue(() => run(this.#connection, sql, parameters));
  }

  all<Row>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<readonly Row[]> {
    return this.#enqueue(() => all<Row>(this.#connection, sql, parameters));
  }

  first<Row>(
    sql: string,
    parameters: readonly SqlValue[] = [],
  ): Promise<Row | null> {
    return this.#enqueue(async () => {
      const rows = await all<Row>(this.#connection, sql, parameters);
      return rows[0] ?? null;
    });
  }

  transaction<Result>(
    work: (transaction: SqlExecutor) => Promise<Result>,
  ): Promise<Result> {
    return this.#enqueue(async () => {
      await this.#connection.execute('BEGIN EXCLUSIVE;');
      try {
        const result = await work(executor(this.#connection));
        await this.#connection.execute('COMMIT;');
        return result;
      } catch (error) {
        try {
          await this.#connection.execute('ROLLBACK;');
        } catch {
          throw new Error('SQLite rollback failed');
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    return this.#enqueue(() => this.#connection.closeAsync());
  }

  #enqueue<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function openAccountDatabase(accountId: string, encryptionKey: string) {
  if (!/^usr_[a-f0-9]{32}$/.test(accountId)) {
    throw new Error('Invalid database account');
  }
  if (!/^[a-f0-9]{64}$/.test(encryptionKey)) {
    throw new Error('Invalid database encryption key');
  }
  if (!isSQLCipher()) {
    throw new Error('SQLCipher support is required');
  }
  return new OpSqliteDatabase(
    open({
      name: `crew_${accountId}.sqlite`,
      encryptionKey,
    }),
  );
}

function executor(connection: Connection): SqlExecutor {
  return {
    exec: sql => execute(connection, sql),
    run: (sql, parameters = []) => run(connection, sql, parameters),
    all: <Row>(sql: string, parameters: readonly SqlValue[] = []) =>
      all<Row>(connection, sql, parameters),
    first: async <Row>(sql: string, parameters: readonly SqlValue[] = []) => {
      const rows = await all<Row>(connection, sql, parameters);
      return rows[0] ?? null;
    },
  };
}

async function execute(connection: Connection, sql: string) {
  await connection.execute(sql);
}

async function run(
  connection: Connection,
  sql: string,
  parameters: readonly SqlValue[],
) {
  await connection.execute(sql, scalars(parameters));
}

async function all<Row>(
  connection: Connection,
  sql: string,
  parameters: readonly SqlValue[],
): Promise<readonly Row[]> {
  const result = await connection.execute(sql, scalars(parameters));
  return result.rows.map(row => normalizeRow(row) as Row);
}

function scalars(values: readonly SqlValue[]): Scalar[] {
  return values.map(value => value as Scalar);
}

function normalizeRow(row: QueryResult['rows'][number]) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (typeof value === 'boolean') return [key, value ? 1 : 0];
      if (value instanceof ArrayBuffer) return [key, new Uint8Array(value)];
      if (ArrayBuffer.isView(value) && !(value instanceof Uint8Array)) {
        return [
          key,
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        ];
      }
      return [key, value];
    }),
  );
}
