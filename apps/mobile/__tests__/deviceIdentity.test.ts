import {
  assertMutationStreamIdentity,
  discardUnboundMutationStreamIdentity,
  getOrCreateMutationStreamIdentity,
  initializeMutationStreamIdentities,
  recoverSequenceFailureStreams,
  SequenceFailureRecoveryDeferredError,
  type SqlDatabase,
} from '@crew/mobile-data';
import {
  SecureDeviceIdStore,
  type DeviceIdCredentials,
} from '../src/storage/deviceIdentity';

jest.mock('@crew/mobile-data', () => ({
  assertMutationStreamIdentity: jest.fn(),
  discardUnboundMutationStreamIdentity: jest.fn(),
  getOrCreateMutationStreamIdentity: jest.fn(),
  initializeMutationStreamIdentities: jest.fn(),
  recoverSequenceFailureStreams: jest.fn(),
  SequenceFailureRecoveryDeferredError: class extends Error {},
}));

const accountUserId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_trip';
const database = {} as SqlDatabase;
const legacyDeviceId = 'dvc_00000000-0000-4000-8000-000000000001';
const freshDeviceId = 'dvc_00000000-0000-4000-8000-000000000002';

function memoryCredentials(
  initial: { username: string; password: string } | null = null,
): DeviceIdCredentials {
  return { get: jest.fn(async () => initial) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('uses Keychain only as a read-only legacy hint for the SQLite identity', async () => {
  const credentials = memoryCredentials({
    username: 'device',
    password: legacyDeviceId,
  });
  const store = new SecureDeviceIdStore(
    credentials,
    () => '00000000-0000-4000-8000-000000000002',
  );
  jest
    .mocked(getOrCreateMutationStreamIdentity)
    .mockImplementation(
      async (opened, account, root, readLegacy, createDeviceId) => {
        expect(opened).toBe(database);
        expect(account).toBe(accountUserId);
        expect(root).toBe(rootEventId);
        expect(await readLegacy()).toBe(legacyDeviceId);
        expect(createDeviceId()).toBe(freshDeviceId);
        return freshDeviceId;
      },
    );

  await expect(
    store.getOrCreate(database, accountUserId, rootEventId),
  ).resolves.toBe(freshDeviceId);
  expect(credentials.get).toHaveBeenCalledTimes(1);
});

test('ignores malformed or unavailable legacy storage instead of writing it', async () => {
  const malformed = memoryCredentials({
    username: 'foreign',
    password: 'not-a-device',
  });
  const store = new SecureDeviceIdStore(
    malformed,
    () => '00000000-0000-4000-8000-000000000002',
  );
  jest
    .mocked(getOrCreateMutationStreamIdentity)
    .mockImplementation(async (_database, _account, _root, readLegacy) => {
      expect(await readLegacy()).toBeNull();
      return freshDeviceId;
    });
  await expect(
    store.getOrCreate(database, accountUserId, rootEventId),
  ).resolves.toBe(freshDeviceId);

  const unavailable = new SecureDeviceIdStore({
    get: jest.fn(async () => {
      throw new Error('Keychain unavailable');
    }),
  });
  await expect(
    unavailable.getOrCreate(database, accountUserId, rootEventId),
  ).resolves.toBe(freshDeviceId);
});

test('initializes legacy roots during bootstrap and cleans up only failed creates', async () => {
  const store = new SecureDeviceIdStore(memoryCredentials());
  jest.mocked(initializeMutationStreamIdentities).mockResolvedValue(undefined);
  jest.mocked(recoverSequenceFailureStreams).mockResolvedValue(0);
  jest
    .mocked(discardUnboundMutationStreamIdentity)
    .mockResolvedValue(undefined);

  await store.initializeExisting(database, accountUserId);
  expect(initializeMutationStreamIdentities).toHaveBeenCalledWith(
    database,
    accountUserId,
    expect.any(Function),
    expect.any(Function),
  );
  expect(recoverSequenceFailureStreams).toHaveBeenCalledWith(
    database,
    accountUserId,
    expect.objectContaining({
      newDeviceId: expect.any(Function),
      randomUUID: expect.any(Function),
    }),
  );

  await store.discardIfUnbound(database, accountUserId, rootEventId);
  expect(discardUnboundMutationStreamIdentity).toHaveBeenCalledWith(
    database,
    accountUserId,
    rootEventId,
  );

  jest.mocked(assertMutationStreamIdentity).mockResolvedValue(undefined);
  await store.assertCurrent(database, accountUserId, rootEventId, freshDeviceId);
  expect(assertMutationStreamIdentity).toHaveBeenCalledWith(
    database,
    accountUserId,
    rootEventId,
    freshDeviceId,
  );
});

test('keeps bootstrap reads available when safe sequence recovery is deferred', async () => {
  const store = new SecureDeviceIdStore(memoryCredentials());
  jest.mocked(initializeMutationStreamIdentities).mockResolvedValue(undefined);
  jest
    .mocked(recoverSequenceFailureStreams)
    .mockRejectedValue(
      new SequenceFailureRecoveryDeferredError('active batch remains'),
    );

  await expect(
    store.initializeExisting(database, accountUserId),
  ).resolves.toBeUndefined();
});
