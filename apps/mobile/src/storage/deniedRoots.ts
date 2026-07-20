import { MobileDataStore, type SqlDatabase } from '@crew/mobile-data';
import * as Keychain from 'react-native-keychain';
import { secureUuidV4 } from './secureRandom';

const SERVICE_PREFIX = 'app.crew.next.denied-roots.v1';
const ACCOUNT_PATTERN = /^usr_[a-f0-9]{32}$/;
const ROOT_PATTERN = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const MAX_PENDING_ROOT_VERIFICATIONS = 32;

type Credential = { username: string; password: string };
type RegistryEntry = { rootEventId: string; tokens: readonly string[] };
type RegistryState = {
  version: 1;
  purgeAll: boolean;
  entries: readonly RegistryEntry[];
};

const emptyState = (): RegistryState => ({
  version: 1,
  purgeAll: false,
  entries: [],
});

export interface DeniedRootCredentials {
  get(service: string): Promise<Credential | null>;
  set(service: string, username: string, password: string): Promise<void>;
  reset(service: string): Promise<void>;
}

const keychainCredentials: DeniedRootCredentials = {
  async get(service) {
    const value = await Keychain.getGenericPassword({ service });
    return value
      ? { username: value.username, password: value.password }
      : null;
  },
  async set(service, username, password) {
    await Keychain.setGenericPassword(username, password, {
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      service,
    });
  },
  async reset(service) {
    await Keychain.resetGenericPassword({ service });
  },
};

export class DeniedRootRegistry {
  readonly #credentials: DeniedRootCredentials;
  readonly #newToken: () => string;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    credentials: DeniedRootCredentials = keychainCredentials,
    newToken: () => string = secureUuidV4,
  ) {
    this.#credentials = credentials;
    this.#newToken = newToken;
  }

  arm(accountUserId: string, rootEventId: string): Promise<string> {
    return this.#exclusive(async () => {
      // A crash after this write conservatively conceals the root on next boot.
      validateScope(accountUserId, rootEventId);
      const token = this.#newToken();
      if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid denial token');
      const state = await this.#read(accountUserId);
      if (state.purgeAll) return token;
      const total = state.entries.reduce(
        (count, entry) => count + entry.tokens.length,
        0,
      );
      if (
        total >= MAX_PENDING_ROOT_VERIFICATIONS ||
        state.entries.some(entry => entry.tokens.includes(token))
      ) {
        await this.#write(accountUserId, {
          version: 1,
          purgeAll: true,
          entries: [],
        });
        return token;
      }
      const existing = state.entries.find(
        entry => entry.rootEventId === rootEventId,
      );
      const entries = existing
        ? state.entries.map(entry =>
            entry === existing
              ? { ...entry, tokens: [...entry.tokens, token].sort() }
              : entry,
          )
        : [...state.entries, { rootEventId, tokens: [token] }].sort((a, b) =>
            compareText(a.rootEventId, b.rootEventId),
          );
      await this.#write(accountUserId, { ...state, entries });
      return token;
    });
  }

  finish(
    accountUserId: string,
    rootEventId: string,
    token: string,
  ): Promise<void> {
    return this.#exclusive(async () => {
      validateScope(accountUserId, rootEventId);
      if (!TOKEN_PATTERN.test(token)) throw new Error('Invalid denial token');
      const state = await this.#read(accountUserId);
      if (state.purgeAll) return;
      if (
        !state.entries.some(
          entry =>
            entry.rootEventId === rootEventId && entry.tokens.includes(token),
        )
      ) {
        return;
      }
      const entries = state.entries
        .map(entry =>
          entry.rootEventId === rootEventId
            ? {
                ...entry,
                tokens: entry.tokens.filter(value => value !== token),
              }
            : entry,
        )
        .filter(entry => entry.tokens.length > 0);
      await this.#write(accountUserId, { ...state, entries });
    });
  }

  purgeRecorded(accountUserId: string, database: SqlDatabase): Promise<void> {
    return this.#exclusive(async () => {
      validateAccount(accountUserId);
      const state = await this.#read(accountUserId);
      const store = new MobileDataStore(database);
      if (state.purgeAll) {
        await store.clearUserData(accountUserId);
      } else {
        for (const { rootEventId } of state.entries) {
          await store.clearRootData(accountUserId, rootEventId);
        }
      }
      if (state.purgeAll || state.entries.length > 0) {
        await this.#write(accountUserId, emptyState());
      }
    });
  }

  #exclusive<Result>(work: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #read(accountUserId: string): Promise<RegistryState> {
    const credential = await this.#credentials.get(
      registryService(accountUserId),
    );
    if (!credential) return emptyState();
    let state: unknown;
    try {
      state = JSON.parse(credential.password);
    } catch {
      throw new Error('Invalid denied-root registry');
    }
    if (credential.username !== accountUserId || !validState(state)) {
      throw new Error('Invalid denied-root registry');
    }
    return state;
  }

  #write(accountUserId: string, state: RegistryState): Promise<void> {
    const scopedService = registryService(accountUserId);
    return !state.purgeAll && state.entries.length === 0
      ? this.#credentials.reset(scopedService)
      : this.#credentials.set(
          scopedService,
          accountUserId,
          JSON.stringify(state),
        );
  }
}

export const deniedRootRegistry = new DeniedRootRegistry();

function validState(value: unknown): value is RegistryState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<RegistryState>;
  if (
    state.version !== 1 ||
    typeof state.purgeAll !== 'boolean' ||
    !Array.isArray(state.entries) ||
    (state.purgeAll && state.entries.length > 0) ||
    state.entries.length > MAX_PENDING_ROOT_VERIFICATIONS
  ) {
    return false;
  }
  const roots = new Set<string>();
  const tokens = new Set<string>();
  let previousRoot = '';
  for (const candidate of state.entries) {
    if (!candidate || typeof candidate !== 'object') return false;
    const entry = candidate as Partial<RegistryEntry>;
    if (
      typeof entry.rootEventId !== 'string' ||
      !ROOT_PATTERN.test(entry.rootEventId) ||
      entry.rootEventId <= previousRoot ||
      roots.has(entry.rootEventId) ||
      !Array.isArray(entry.tokens) ||
      entry.tokens.length === 0
    ) {
      return false;
    }
    roots.add(entry.rootEventId);
    previousRoot = entry.rootEventId;
    let previousToken = '';
    for (const token of entry.tokens) {
      if (
        typeof token !== 'string' ||
        !TOKEN_PATTERN.test(token) ||
        token <= previousToken ||
        tokens.has(token)
      ) {
        return false;
      }
      tokens.add(token);
      previousToken = token;
    }
  }
  return tokens.size <= MAX_PENDING_ROOT_VERIFICATIONS;
}

function validateScope(accountUserId: string, rootEventId: string) {
  validateAccount(accountUserId);
  if (!ROOT_PATTERN.test(rootEventId)) throw new Error('Invalid root scope');
}

function validateAccount(accountUserId: string) {
  if (!ACCOUNT_PATTERN.test(accountUserId)) {
    throw new Error('Invalid account scope');
  }
}

function registryService(accountUserId: string) {
  return `${SERVICE_PREFIX}.${accountUserId}`;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
