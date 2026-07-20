const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_IDENTIFIER =
	/^(?:cin_|crs_|ml_|rt_|at_|access[_-]|refresh[_-]|bearer[_-]|eyJ)/i;

const failures = {
	request: {
		event: "Unhandled request error",
		code: "INTERNAL_ERROR",
		identifier: "requestId",
	},
	deliveryWorker: {
		event: "User delivery worker tick failed",
		code: "USER_DELIVERY_WORKER_TICK_FAILED",
		identifier: "workerId",
	},
	pushWorker: {
		event: "User push worker tick failed",
		code: "USER_PUSH_WORKER_TICK_FAILED",
		identifier: "workerId",
	},
	retentionWorker: {
		event: "User identity retention worker tick failed",
		code: "USER_IDENTITY_RETENTION_WORKER_TICK_FAILED",
		identifier: "workerId",
	},
} as const;

export type SafeFailureKind = keyof typeof failures;

export function isSafeCorrelationId(value: string): boolean {
	return SAFE_CORRELATION_ID.test(value) && !SENSITIVE_IDENTIFIER.test(value);
}

export function logSafeFailure(kind: SafeFailureKind, identifier?: string) {
	const failure = failures[kind];
	const context: Record<string, string> = { code: failure.code };
	if (identifier && isSafeCorrelationId(identifier)) {
		context[failure.identifier] = identifier;
	}
	console.error(failure.event, context);
}
