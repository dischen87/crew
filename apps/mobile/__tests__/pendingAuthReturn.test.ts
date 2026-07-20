import * as Keychain from 'react-native-keychain';
import { keychainPendingAuthReturnStore } from '../src/storage/pendingAuthReturn';

const firstHandle = '00000000-0000-4000-8000-000000000001';
const secondHandle = '00000000-0000-4000-8000-000000000002';
const service = 'app.crew.next.pending-auth-return.v1';
const values = new Map<
  string,
  {
    service: string;
    storage: Keychain.STORAGE_TYPE;
    username: string;
    password: string;
  }
>();

beforeEach(() => {
  values.clear();
  jest.clearAllMocks();
  jest
    .mocked(Keychain.getGenericPassword)
    .mockImplementation(
      async options => values.get(options?.service ?? '') ?? false,
    );
  jest
    .mocked(Keychain.setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      const storageService = options?.service ?? '';
      values.set(storageService, {
        service: storageService,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        username,
        password,
      });
      return {
        service: storageService,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
      };
    });
  jest
    .mocked(Keychain.resetGenericPassword)
    .mockImplementation(async options => {
      values.delete(options?.service ?? '');
      return true;
    });
});

test('keeps the protected return recoverable until its exact flow completes', async () => {
  await keychainPendingAuthReturnStore.set(firstHandle);

  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBe(
    firstHandle,
  );
  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBe(
    firstHandle,
  );
  expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();

  await expect(
    keychainPendingAuthReturnStore.complete(firstHandle),
  ).resolves.toBe(true);
  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBeNull();
});

test('does not let an older flow clear a newer pending return', async () => {
  await keychainPendingAuthReturnStore.set(firstHandle);
  await keychainPendingAuthReturnStore.set(secondHandle);

  await expect(
    keychainPendingAuthReturnStore.complete(firstHandle),
  ).resolves.toBe(false);
  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBe(
    secondHandle,
  );
  expect(values.has(service)).toBe(true);

  await expect(
    keychainPendingAuthReturnStore.complete(secondHandle),
  ).resolves.toBe(true);
  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBeNull();
});

test('expires a stale protected return instead of resuming it', async () => {
  values.set(service, {
    service,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    username: firstHandle,
    password: JSON.stringify({ createdAt: Date.now() - 16 * 60 * 1_000 }),
  });

  await expect(keychainPendingAuthReturnStore.peek()).resolves.toBeNull();
  expect(values.has(service)).toBe(false);
});
