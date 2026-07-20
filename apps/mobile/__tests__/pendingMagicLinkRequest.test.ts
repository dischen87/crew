import * as Keychain from 'react-native-keychain';
import { keychainPendingMagicLinkRequestStore } from '../src/storage/pendingMagicLinkRequest';

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
      const service = options?.service ?? '';
      values.set(service, {
        service,
        storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
        username,
        password,
      });
      return { service, storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH };
    });
  jest
    .mocked(Keychain.resetGenericPassword)
    .mockImplementation(async options => {
      values.delete(options?.service ?? '');
      return true;
    });
});

test('reuses a persisted request after restart until delivery is confirmed', async () => {
  const first = await keychainPendingMagicLinkRequestStore.getOrCreate(
    ' Crew@Example.test ',
  );

  // The second read has no component or request-local state: only Keychain
  // survives the simulated restart/retry boundary.
  const resumed = await keychainPendingMagicLinkRequestStore.getOrCreate(
    'crew@example.test',
  );
  expect(resumed).toEqual(first);
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(1);

  await expect(
    keychainPendingMagicLinkRequestStore.complete(
      first.email,
      '00000000-0000-4000-8000-000000000099',
    ),
  ).resolves.toBe(false);
  await expect(
    keychainPendingMagicLinkRequestStore.getOrCreate(first.email),
  ).resolves.toEqual(first);

  await expect(
    keychainPendingMagicLinkRequestStore.complete(
      first.email,
      first.idempotencyKey,
    ),
  ).resolves.toBe(true);
  const next = await keychainPendingMagicLinkRequestStore.getOrCreate(
    first.email,
  );
  expect(next.idempotencyKey).not.toBe(first.idempotencyKey);
});

test('starts a new request when the normalized email changes', async () => {
  const first = await keychainPendingMagicLinkRequestStore.getOrCreate(
    'first@example.test',
  );
  const second = await keychainPendingMagicLinkRequestStore.getOrCreate(
    'second@example.test',
  );

  expect(second.email).toBe('second@example.test');
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});
