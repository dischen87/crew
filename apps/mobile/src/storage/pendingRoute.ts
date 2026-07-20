import * as Keychain from 'react-native-keychain';
import { secureUuidV4 } from './secureRandom';

const SERVICE_PREFIX = 'app.crew.next.pending-route.v1';
const INDEX_SERVICE_PREFIX = 'app.crew.next.pending-route-index.v1';
const MAX_AGE_MS = 15 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const HANDLE_PATTERN = /^[a-f0-9-]{36}$/;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const AUTH_TOKEN_PATTERN = /^ml_[A-Za-z0-9_-]{43}$/;
let tail: Promise<void> = Promise.resolve();

export type PendingRoute = {
  kind: 'invite' | 'auth';
  token: string;
  createdAt: number;
  idempotencyKey: string;
};

export type PendingRouteDraft = Omit<PendingRoute, 'idempotencyKey'>;

export interface PendingRouteStore {
  put(route: PendingRouteDraft): Promise<string>;
  peek(
    handle: string,
    expectedKind?: PendingRoute['kind'],
  ): Promise<PendingRoute | null>;
  current(kind: PendingRoute['kind']): Promise<string | null>;
  complete(handle: string): Promise<void>;
}

export const keychainPendingRouteStore: PendingRouteStore = {
  put(route) {
    return exclusive(async () => {
      if (!validToken(route) || !validTime(route.createdAt)) {
        throw new Error('Invalid pending route');
      }

      const existing = await readIndex(route.kind);
      if (existing) {
        const pending = await readRoute(existing.handle, route.kind);
        if (pending?.token === route.token) return existing.handle;
        await Keychain.resetGenericPassword({
          service: routeService(existing.handle),
        });
      }

      const handle = secureUuidV4();
      await Keychain.setGenericPassword(
        handle,
        JSON.stringify({ ...route, idempotencyKey: handle }),
        keychainOptions(routeService(handle)),
      );
      await Keychain.setGenericPassword(
        handle,
        JSON.stringify({ createdAt: route.createdAt }),
        keychainOptions(indexService(route.kind)),
      );
      return handle;
    });
  },

  peek(handle, expectedKind) {
    return exclusive(() => readRoute(handle, expectedKind));
  },

  current(kind) {
    return exclusive(async () => {
      const index = await readIndex(kind);
      if (!index) return null;
      const pending = await readRoute(index.handle, kind);
      if (pending) return index.handle;
      await Keychain.resetGenericPassword({ service: indexService(kind) });
      return null;
    });
  },

  complete(handle) {
    return exclusive(async () => {
      if (!HANDLE_PATTERN.test(handle)) return;
      await Keychain.resetGenericPassword({ service: routeService(handle) });
      for (const kind of ['invite', 'auth'] as const) {
        const index = await Keychain.getGenericPassword({
          service: indexService(kind),
        });
        if (index && index.username === handle) {
          await Keychain.resetGenericPassword({ service: indexService(kind) });
        }
      }
    });
  },
};

async function readRoute(
  handle: string,
  expectedKind?: PendingRoute['kind'],
): Promise<PendingRoute | null> {
  if (!HANDLE_PATTERN.test(handle)) return null;
  const service = routeService(handle);
  const value = await Keychain.getGenericPassword({ service });
  if (!value) return null;

  try {
    const parsed = JSON.parse(value.password) as PendingRoute;
    if (
      (parsed.kind !== 'invite' && parsed.kind !== 'auth') ||
      (expectedKind !== undefined && parsed.kind !== expectedKind) ||
      !validToken(parsed) ||
      parsed.idempotencyKey !== handle ||
      value.username !== handle ||
      !validTime(parsed.createdAt)
    ) {
      await Keychain.resetGenericPassword({ service });
      return null;
    }
    return parsed;
  } catch {
    await Keychain.resetGenericPassword({ service });
    return null;
  }
}

async function readIndex(kind: PendingRoute['kind']) {
  const service = indexService(kind);
  const value = await Keychain.getGenericPassword({ service });
  if (!value) return null;
  try {
    const parsed = JSON.parse(value.password) as {
      createdAt?: unknown;
    };
    const candidate = {
      kind,
      createdAt: Number(parsed.createdAt),
    };
    if (
      !HANDLE_PATTERN.test(value.username) ||
      !validTime(candidate.createdAt)
    ) {
      await Keychain.resetGenericPassword({ service });
      return null;
    }
    return { handle: value.username, ...candidate };
  } catch {
    await Keychain.resetGenericPassword({ service });
    return null;
  }
}

function validToken(route: Pick<PendingRoute, 'kind' | 'token'>) {
  return route.kind === 'invite'
    ? INVITE_TOKEN_PATTERN.test(route.token)
    : AUTH_TOKEN_PATTERN.test(route.token);
}

function validTime(createdAt: number) {
  return (
    Number.isFinite(createdAt) &&
    createdAt <= Date.now() + MAX_FUTURE_SKEW_MS &&
    Date.now() - createdAt <= MAX_AGE_MS
  );
}

function routeService(handle: string) {
  return `${SERVICE_PREFIX}.${handle}`;
}

function indexService(kind: PendingRoute['kind']) {
  return `${INDEX_SERVICE_PREFIX}.${kind}`;
}

function keychainOptions(service: string) {
  return {
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    service,
  };
}

function exclusive<Result>(work: () => Promise<Result>): Promise<Result> {
  const result = tail.then(work, work);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
