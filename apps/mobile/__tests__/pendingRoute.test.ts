import * as Keychain from 'react-native-keychain';
import { keychainPendingRouteStore } from '../src/storage/pendingRoute';

const inviteToken = 'abcdefghijklmnopqrst';
const authToken = `ml_${'a'.repeat(43)}`;
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

test('deduplicates redelivered tokens through a protected discoverable index', async () => {
  const firstHandle = await keychainPendingRouteStore.put({
    kind: 'invite',
    token: inviteToken,
    createdAt: Date.now(),
  });
  const first = await keychainPendingRouteStore.peek(firstHandle, 'invite');
  const redeliveredHandle = await keychainPendingRouteStore.put({
    kind: 'invite',
    token: inviteToken,
    createdAt: Date.now(),
  });

  expect(redeliveredHandle).toBe(firstHandle);
  expect(first?.idempotencyKey).toBe(firstHandle);
  await expect(keychainPendingRouteStore.current('invite')).resolves.toBe(
    firstHandle,
  );
  expect(Keychain.setGenericPassword).toHaveBeenCalledTimes(2);
});

test('conditionally clears only the completed handle and its matching index', async () => {
  const inviteHandle = await keychainPendingRouteStore.put({
    kind: 'invite',
    token: inviteToken,
    createdAt: Date.now(),
  });
  const authHandle = await keychainPendingRouteStore.put({
    kind: 'auth',
    token: authToken,
    createdAt: Date.now(),
  });

  await keychainPendingRouteStore.complete(inviteHandle);

  await expect(
    keychainPendingRouteStore.peek(inviteHandle, 'invite'),
  ).resolves.toBeNull();
  await expect(keychainPendingRouteStore.current('invite')).resolves.toBeNull();
  await expect(keychainPendingRouteStore.current('auth')).resolves.toBe(
    authHandle,
  );
  await expect(
    keychainPendingRouteStore.peek(authHandle, 'auth'),
  ).resolves.toMatchObject({ token: authToken });
});

test('removes the old protected route when a different token replaces its index', async () => {
  const oldHandle = await keychainPendingRouteStore.put({
    kind: 'invite',
    token: inviteToken,
    createdAt: Date.now(),
  });
  const newHandle = await keychainPendingRouteStore.put({
    kind: 'invite',
    token: 'zyxwvutsrqponmlkjihg',
    createdAt: Date.now(),
  });

  expect(newHandle).not.toBe(oldHandle);
  await expect(
    keychainPendingRouteStore.peek(oldHandle, 'invite'),
  ).resolves.toBeNull();
  await expect(keychainPendingRouteStore.current('invite')).resolves.toBe(
    newHandle,
  );
  await expect(
    keychainPendingRouteStore.peek(newHandle, 'invite'),
  ).resolves.toMatchObject({ token: 'zyxwvutsrqponmlkjihg' });
});

test('deletes and rejects expired protected routes', async () => {
  const handle = '00000000-0000-4000-8000-000000000001';
  const routeService = `app.crew.next.pending-route.v1.${handle}`;
  values.set(routeService, {
    service: routeService,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    username: handle,
    password: JSON.stringify({
      kind: 'auth',
      token: authToken,
      createdAt: Date.now() - 16 * 60 * 1_000,
      idempotencyKey: handle,
    }),
  });

  await expect(
    keychainPendingRouteStore.peek(handle, 'auth'),
  ).resolves.toBeNull();
  expect(values.has(routeService)).toBe(false);
});
