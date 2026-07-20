import * as Keychain from 'react-native-keychain';
import {
  DatabaseKeyStorageUnavailableError,
  getOrCreateDatabaseKey,
} from '../src/storage/databaseKey';

const accountId = `usr_${'a'.repeat(32)}`;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
  jest.mocked(Keychain.setGenericPassword).mockResolvedValue({
    service: `app.crew.next.database-key.v1.${accountId}`,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
  });
});

test('types a transient Keychain read failure without writing or resetting', async () => {
  jest
    .mocked(Keychain.getGenericPassword)
    .mockRejectedValueOnce(new Error('missing entitlement secret'));

  await expect(getOrCreateDatabaseKey(accountId)).rejects.toBeInstanceOf(
    DatabaseKeyStorageUnavailableError,
  );
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});

test('keeps malformed account-bound key data distinct from transient storage access', async () => {
  jest.mocked(Keychain.getGenericPassword).mockResolvedValueOnce({
    password: 'invalid-private-key',
    service: `app.crew.next.database-key.v1.${accountId}`,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    username: accountId,
  });

  let failure: unknown;
  try {
    await getOrCreateDatabaseKey(accountId);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(DatabaseKeyStorageUnavailableError);
  expect(String(failure)).toBe('Error: Invalid database encryption key');
  expect(Keychain.setGenericPassword).not.toHaveBeenCalled();
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});

test('types a transient Keychain write failure without broad cleanup', async () => {
  jest
    .mocked(Keychain.setGenericPassword)
    .mockRejectedValueOnce(new Error('keychain locked'));

  await expect(
    getOrCreateDatabaseKey(`usr_${'b'.repeat(32)}`),
  ).rejects.toBeInstanceOf(DatabaseKeyStorageUnavailableError);
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
});
