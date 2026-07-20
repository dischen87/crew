export type SqlValue = string | number | Uint8Array | null;

export interface SqlExecutor {
	exec(sql: string): Promise<void>;
	run(sql: string, parameters?: readonly SqlValue[]): Promise<void>;
	all<Row>(
		sql: string,
		parameters?: readonly SqlValue[],
	): Promise<readonly Row[]>;
	first<Row>(
		sql: string,
		parameters?: readonly SqlValue[],
	): Promise<Row | null>;
}

export interface SqlDatabase extends SqlExecutor {
	transaction<Result>(
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result>;
}
