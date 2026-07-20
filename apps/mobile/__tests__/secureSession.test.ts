import type { Session } from '@crew/mobile-client';
import {
  type CredentialStore,
  SecureSessionStore,
} from '../src/storage/secureSession';

class MemoryCredentials implements CredentialStore {
  value: { username: string; password: string } | null = null;
  getError: Error | null = null;
  resetError: Error | null = null;

  async get() {
    if (this.getError) throw this.getError;
    return this.value;
  }

  async set(username: string, password: string) {
    await Promise.resolve();
    this.value = { username, password };
  }

  async reset() {
    if (this.resetError) throw this.resetError;
    this.value = null;
  }
}

function session(suffix: string): Session {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    tokenType: 'Bearer',
    expiresInSeconds: 900,
    user: {
      id: `usr_${suffix.padEnd(32, '0')}`,
      email: `${suffix}@crew.test`,
      profile: { displayName: suffix },
    },
  } as Session;
}

test('persists and clears one account-bound session', async () => {
  const credentials = new MemoryCredentials();
  const store = new SecureSessionStore(credentials);
  const first = session('a');

  await expect(store.compareAndSet(null, first)).resolves.toBe(true);
  await expect(store.get()).resolves.toEqual(first);
  await expect(store.compareAndSet(first, null)).resolves.toBe(true);
  await expect(store.get()).resolves.toBeNull();
});

test('serializes competing compare-and-set rotations', async () => {
  const credentials = new MemoryCredentials();
  const store = new SecureSessionStore(credentials);
  const first = session('a');
  const second = session('b');
  const third = session('c');
  await store.compareAndSet(null, first);

  const results = await Promise.all([
    store.compareAndSet(first, second),
    store.compareAndSet(first, third),
  ]);
  expect(results).toEqual([true, false]);
  await expect(store.get()).resolves.toEqual(second);
});

test.each([
  ['malformed JSON', '{raw-secret'],
  ['account mismatch', JSON.stringify(session('b'))],
])(
  'resets %s once and then permits a fresh null-to-session CAS',
  async (_, password) => {
    const credentials = new MemoryCredentials();
    const store = new SecureSessionStore(credentials);
    const reset = jest.spyOn(credentials, 'reset');
    const replacement = session('c');
    credentials.value = { username: session('a').user.id, password };

    await expect(store.get()).resolves.toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(credentials.value).toBeNull();

    await expect(store.compareAndSet(null, replacement)).resolves.toBe(true);
    await expect(store.get()).resolves.toEqual(replacement);
    expect(reset).toHaveBeenCalledTimes(1);
  },
);

test('propagates corrupt-state reset failure without overwriting unknown state', async () => {
  const credentials = new MemoryCredentials();
  const store = new SecureSessionStore(credentials);
  const set = jest.spyOn(credentials, 'set');
  credentials.value = {
    username: session('a').user.id,
    password: '{raw-secret',
  };
  credentials.resetError = new Error('keychain reset failed');

  await expect(store.compareAndSet(null, session('b'))).rejects.toThrow(
    'keychain reset failed',
  );
  expect(set).not.toHaveBeenCalled();
  expect(credentials.value?.password).toBe('{raw-secret');
});

test('propagates keychain read failure without resetting or writing', async () => {
  const credentials = new MemoryCredentials();
  const store = new SecureSessionStore(credentials);
  const reset = jest.spyOn(credentials, 'reset');
  const set = jest.spyOn(credentials, 'set');
  credentials.getError = new Error('keychain read failed');

  await expect(store.compareAndSet(null, session('b'))).rejects.toThrow(
    'keychain read failed',
  );
  expect(reset).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
