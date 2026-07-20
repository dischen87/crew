import * as Keychain from 'react-native-keychain';
import { secureRandomBytes } from './secureRandom';

const SERVICE_PREFIX = 'app.crew.next.database-key.v1';
let tail: Promise<void> = Promise.resolve();

export class DatabaseKeyStorageUnavailableError extends Error {
  constructor() {
    super('Database key storage unavailable');
    this.name = 'DatabaseKeyStorageUnavailableError';
  }
}

export function getOrCreateDatabaseKey(accountId: string): Promise<string> {
  if (!/^usr_[a-f0-9]{32}$/.test(accountId)) {
    return Promise.reject(new Error('Invalid database account'));
  }

  const result = tail.then(() => readOrCreate(accountId));
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function readOrCreate(accountId: string) {
  const service = `${SERVICE_PREFIX}.${accountId}`;
  let existing: Awaited<ReturnType<typeof Keychain.getGenericPassword>>;
  try {
    existing = await Keychain.getGenericPassword({ service });
  } catch {
    throw new DatabaseKeyStorageUnavailableError();
  }
  if (existing) {
    if (
      existing.username !== accountId ||
      !/^[a-f0-9]{64}$/.test(existing.password)
    ) {
      throw new Error('Invalid database encryption key');
    }
    return existing.password;
  }

  const bytes = secureRandomBytes(32);
  const key = Array.from(bytes, value =>
    value.toString(16).padStart(2, '0'),
  ).join('');
  try {
    await Keychain.setGenericPassword(accountId, key, {
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      service,
    });
  } catch {
    throw new DatabaseKeyStorageUnavailableError();
  }
  return key;
}
