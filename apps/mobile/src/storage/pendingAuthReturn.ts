import * as Keychain from 'react-native-keychain';

const SERVICE = 'app.crew.next.pending-auth-return.v1';
const MAX_AGE_MS = 15 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 60_000;
const HANDLE_PATTERN = /^[a-f0-9-]{36}$/;
let tail: Promise<void> = Promise.resolve();

export interface PendingAuthReturnStore {
  set(inviteHandle: string): Promise<void>;
  peek(): Promise<string | null>;
  complete(expectedHandle: string): Promise<boolean>;
}

export const keychainPendingAuthReturnStore: PendingAuthReturnStore = {
  set(inviteHandle) {
    return exclusive(async () => {
      if (!HANDLE_PATTERN.test(inviteHandle)) {
        throw new Error('Invalid pending return');
      }
      await Keychain.setGenericPassword(
        inviteHandle,
        JSON.stringify({ createdAt: Date.now() }),
        keychainOptions(),
      );
    });
  },

  peek() {
    return exclusive(read);
  },

  complete(expectedHandle) {
    return exclusive(async () => {
      if (!HANDLE_PATTERN.test(expectedHandle)) return false;
      const current = await read();
      if (current !== expectedHandle) return false;
      await Keychain.resetGenericPassword({ service: SERVICE });
      return true;
    });
  },
};

async function read() {
  const value = await Keychain.getGenericPassword({ service: SERVICE });
  if (!value) return null;

  try {
    const parsed = JSON.parse(value.password) as { createdAt?: unknown };
    const createdAt = Number(parsed.createdAt);
    if (
      !HANDLE_PATTERN.test(value.username) ||
      !Number.isFinite(createdAt) ||
      createdAt > Date.now() + MAX_FUTURE_SKEW_MS ||
      Date.now() - createdAt > MAX_AGE_MS
    ) {
      await Keychain.resetGenericPassword({ service: SERVICE });
      return null;
    }
    return value.username;
  } catch {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return null;
  }
}

function keychainOptions() {
  return {
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    service: SERVICE,
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
