import {
  SecureDeviceIdStore,
  type DeviceIdCredentials,
} from '../src/storage/deviceIdentity';

function memoryCredentials(
  initial: { username: string; password: string } | null = null,
) {
  let value = initial;
  const credentials: DeviceIdCredentials = {
    get: jest.fn(async () => value),
    reset: jest.fn(async () => {
      value = null;
    }),
    set: jest.fn(async (username, password) => {
      value = { username, password };
    }),
  };
  return credentials;
}

test('persists one canonical install device ID and coalesces concurrent reads', async () => {
  const credentials = memoryCredentials();
  const store = new SecureDeviceIdStore(
    credentials,
    () => '00000000-0000-4000-8000-000000000001',
  );
  const [first, second] = await Promise.all([
    store.getOrCreate(),
    store.getOrCreate(),
  ]);
  expect(first).toBe('dvc_00000000-0000-4000-8000-000000000001');
  expect(second).toBe(first);
  expect(credentials.set).toHaveBeenCalledTimes(1);
  await expect(store.getOrCreate()).resolves.toBe(first);
  expect(credentials.set).toHaveBeenCalledTimes(1);
});

test('replaces malformed private storage instead of using it in the outbox', async () => {
  const credentials = memoryCredentials({
    username: 'foreign',
    password: 'not-a-device',
  });
  const store = new SecureDeviceIdStore(
    credentials,
    () => '00000000-0000-4000-8000-000000000002',
  );
  await expect(store.getOrCreate()).resolves.toBe(
    'dvc_00000000-0000-4000-8000-000000000002',
  );
  expect(credentials.reset).toHaveBeenCalledTimes(1);
});
