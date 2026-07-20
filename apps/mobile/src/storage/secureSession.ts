import type { Session, SessionStore } from '@crew/mobile-client';
import * as Keychain from 'react-native-keychain';

const SESSION_SERVICE = 'app.crew.next.session.v1';

export interface CredentialStore {
  get(): Promise<{ username: string; password: string } | null>;
  set(username: string, password: string): Promise<void>;
  reset(): Promise<void>;
}

const keychainCredentials: CredentialStore = {
  async get() {
    const value = await Keychain.getGenericPassword({
      service: SESSION_SERVICE,
    });
    return value
      ? { username: value.username, password: value.password }
      : null;
  },
  async set(username, password) {
    await Keychain.setGenericPassword(username, password, {
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      service: SESSION_SERVICE,
    });
  },
  async reset() {
    await Keychain.resetGenericPassword({ service: SESSION_SERVICE });
  },
};

export class SecureSessionStore implements SessionStore {
  readonly #credentials: CredentialStore;
  #tail: Promise<void> = Promise.resolve();

  constructor(credentials: CredentialStore = keychainCredentials) {
    this.#credentials = credentials;
  }

  get(): Promise<Session | null> {
    return this.#exclusive(() => this.#readRecovering());
  }

  compareAndSet(
    expected: Session | null,
    replacement: Session | null,
  ): Promise<boolean> {
    return this.#exclusive(async () => {
      const current = await this.#readRecovering();
      if (!sameSession(current, expected)) return false;

      if (replacement) {
        await this.#credentials.set(
          replacement.user.id,
          JSON.stringify(replacement),
        );
      } else {
        await this.#credentials.reset();
      }
      return true;
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

  async #read(): Promise<Session | null> {
    const credential = await this.#credentials.get();
    if (!credential) return null;

    let value: unknown;
    try {
      value = JSON.parse(credential.password);
    } catch {
      throw new InvalidSecureSessionError();
    }
    if (!isSession(value) || credential.username !== value.user.id) {
      throw new InvalidSecureSessionError();
    }
    return value;
  }

  async #readRecovering(): Promise<Session | null> {
    try {
      return await this.#read();
    } catch (error) {
      if (!(error instanceof InvalidSecureSessionError)) throw error;
      await this.#credentials.reset();
      return null;
    }
  }
}

class InvalidSecureSessionError extends Error {}

function sameSession(left: Session | null, right: Session | null) {
  if (!left || !right) return left === right;
  return (
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken &&
    left.expiresInSeconds === right.expiresInSeconds &&
    left.user.id === right.user.id
  );
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.accessToken !== 'string' ||
    !candidate.accessToken ||
    typeof candidate.refreshToken !== 'string' ||
    !candidate.refreshToken ||
    candidate.tokenType !== 'Bearer' ||
    !Number.isInteger(candidate.expiresInSeconds) ||
    Number(candidate.expiresInSeconds) <= 0 ||
    !candidate.user ||
    typeof candidate.user !== 'object'
  ) {
    return false;
  }
  const user = candidate.user as Record<string, unknown>;
  return /^usr_[a-f0-9]{32}$/.test(String(user.id ?? ''));
}

export const secureSessionStore = new SecureSessionStore();
