import { CommunityFeedbackRuntime } from '../src/screens/CommunityFeedbackRuntime';

const mockController = {};
const mockSyncRoot = jest.fn();
const mockListMemberships = jest.fn();
const mockArm = jest.fn();
const mockFinish = jest.fn();
const mockReconcile = jest.fn();
const mockAttachmentStore = {};
const mockMobileSyncEngine = jest.fn(
  (
    _database: unknown,
    _client: unknown,
    _options: {
      activeAccountUserId(): string | null;
      onRootPurged(accountUserId: string, rootEventId: string): Promise<void>;
      onRootReadFinished(
        accountUserId: string,
        rootEventId: string,
        verificationId: string,
      ): Promise<void>;
      onRootReadStarted(
        accountUserId: string,
        rootEventId: string,
      ): Promise<string>;
      randomUUID(): string;
    },
  ) => ({ syncRoot: mockSyncRoot }),
);
const mockCommunityFeedbackController = jest.fn(
  (_database: unknown, _client: unknown) => mockController,
);
const mockMobileDataStore = jest.fn((_database: unknown) => ({
  listMemberships: mockListMemberships,
}));
const mockLocalAttachmentStore = jest.fn(
  (_database: unknown) => mockAttachmentStore,
);
const mockSecureUuid = jest.fn(() => '00000000-0000-4000-8000-000000000001');

jest.mock('@crew/mobile-data', () => ({
  CommunityFeedbackController: class {
    constructor(database: unknown, client: unknown) {
      mockCommunityFeedbackController(database, client);
      return mockController;
    }
  },
  LocalAttachmentStore: class {
    constructor(database: unknown) {
      mockLocalAttachmentStore(database);
      return mockAttachmentStore;
    }
  },
  MobileDataStore: class {
    constructor(database: unknown) {
      mockMobileDataStore(database);
      return { listMemberships: mockListMemberships };
    }
  },
  MobileSyncEngine: class {
    constructor(database: unknown, client: unknown, options: never) {
      mockMobileSyncEngine(database, client, options);
      return { syncRoot: mockSyncRoot };
    }
  },
}));

jest.mock('../src/storage/deniedRoots', () => ({
  deniedRootRegistry: {
    arm: (...args: [string, string]) => mockArm(...args),
    finish: (...args: [string, string, string]) => mockFinish(...args),
  },
}));

jest.mock('../src/media/attachmentMedia', () => ({
  reconcileRetainedAttachmentFiles: (...args: [unknown, string]) =>
    mockReconcile(...args),
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: () => mockSecureUuid(),
}));

const accountUserId = `usr_${'1'.repeat(32)}`;
const rootEventId = 'evt_trip';
const database = {};
const client = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockSyncRoot.mockResolvedValue({ state: 'synced' });
  mockArm.mockResolvedValue('verification-token');
  mockFinish.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue(undefined);
  mockListMemberships.mockResolvedValue([]);
});

test('uses generated community controller and crash-safe authoritative root hooks', async () => {
  const activeAccountUserId = jest.fn(() => accountUserId);
  const runtime = new CommunityFeedbackRuntime({
    activeAccountUserId,
    client: client as never,
    database: database as never,
  });

  expect(mockCommunityFeedbackController).toHaveBeenCalledWith(
    database,
    client,
  );
  expect(mockMobileSyncEngine).toHaveBeenCalledWith(
    database,
    client,
    expect.objectContaining({
      activeAccountUserId,
      randomUUID: expect.any(Function),
    }),
  );
  const options = mockMobileSyncEngine.mock.calls[0][2];
  expect(options.randomUUID()).toBe('00000000-0000-4000-8000-000000000001');
  await expect(
    options.onRootReadStarted(accountUserId, rootEventId),
  ).resolves.toBe('verification-token');
  await options.onRootReadFinished(
    accountUserId,
    rootEventId,
    'verification-token',
  );
  expect(mockArm).toHaveBeenCalledWith(accountUserId, rootEventId);
  expect(mockFinish).toHaveBeenCalledWith(
    accountUserId,
    rootEventId,
    'verification-token',
  );
  await options.onRootPurged(accountUserId, rootEventId);
  expect(mockLocalAttachmentStore).toHaveBeenCalledWith(database);
  expect(mockReconcile).toHaveBeenCalledWith(
    mockAttachmentStore,
    accountUserId,
  );

  await runtime.verifyRoot(accountUserId, rootEventId, true);
  expect(mockSyncRoot).toHaveBeenCalledWith(accountUserId, rootEventId, {
    force: true,
  });
});

test('allows cached community reads only for active self membership in the exact root', async () => {
  mockListMemberships.mockResolvedValue([
    {
      memberUserId: accountUserId,
      rootEventId: 'evt_other',
      status: 'active',
    },
    {
      memberUserId: accountUserId,
      rootEventId,
      status: 'removed',
    },
  ]);
  const runtime = new CommunityFeedbackRuntime({
    activeAccountUserId: () => accountUserId,
    client: client as never,
    database: database as never,
  });
  await expect(
    runtime.hasCachedMembership(accountUserId, rootEventId),
  ).resolves.toBe(false);

  mockListMemberships.mockResolvedValueOnce([
    { memberUserId: accountUserId, rootEventId, status: 'active' },
  ]);
  await expect(
    runtime.hasCachedMembership(accountUserId, rootEventId),
  ).resolves.toBe(true);
});
