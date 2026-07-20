import { EventPublishRuntime } from '../src/screens/EventPublishRuntime';

const mockController = {};
const mockSync = {};
const mockArm = jest.fn();
const mockFinish = jest.fn();
const mockReconcile = jest.fn();
const mockAttachmentStore = {};
const mockEventPublishController = jest.fn();
const mockMobileSyncEngine = jest.fn();
const mockLocalAttachmentStore = jest.fn();
const mockSecureUuid = jest.fn(() => '00000000-0000-4000-8000-000000000001');

jest.mock('@crew/mobile-data', () => ({
  EventPublishController: class {
    constructor(
      database: unknown,
      client: unknown,
      sync: unknown,
      options: unknown,
    ) {
      mockEventPublishController(database, client, sync, options);
      return mockController;
    }
  },
  LocalAttachmentStore: class {
    constructor(database: unknown) {
      mockLocalAttachmentStore(database);
      return mockAttachmentStore;
    }
  },
  MobileSyncEngine: class {
    constructor(database: unknown, client: unknown, options: unknown) {
      mockMobileSyncEngine(database, client, options);
      return mockSync;
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
const rootEventId = 'evt_publish';
const database = {};
const client = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockArm.mockResolvedValue('verification-publish');
  mockFinish.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue(undefined);
});

test('shares the account/root denial hooks across sync and the gateway publish controller', async () => {
  const activeAccountUserId = jest.fn(() => accountUserId);
  const isOnline = jest.fn(() => true);
  const runtime = new EventPublishRuntime({
    activeAccountUserId,
    client: client as never,
    database: database as never,
    isOnline,
  });

  expect(runtime.controller).toBe(mockController);
  expect(mockMobileSyncEngine).toHaveBeenCalledWith(
    database,
    client,
    expect.objectContaining({
      activeAccountUserId,
      randomUUID: expect.any(Function),
    }),
  );
  expect(mockEventPublishController).toHaveBeenCalledWith(
    database,
    client,
    mockSync,
    expect.objectContaining({
      idempotencyKey: expect.any(Function),
      isOnline,
    }),
  );

  const syncOptions = mockMobileSyncEngine.mock.calls[0][2];
  const publishOptions = mockEventPublishController.mock.calls[0][3];
  expect(syncOptions.onRootReadStarted).toBe(publishOptions.onRootReadStarted);
  expect(syncOptions.onRootReadFinished).toBe(
    publishOptions.onRootReadFinished,
  );
  expect(syncOptions.onRootPurged).toBe(publishOptions.onRootPurged);
  await expect(
    publishOptions.onRootReadStarted(accountUserId, rootEventId),
  ).resolves.toBe('verification-publish');
  await publishOptions.onRootReadFinished(
    accountUserId,
    rootEventId,
    'verification-publish',
  );
  expect(mockArm).toHaveBeenCalledWith(accountUserId, rootEventId);
  expect(mockFinish).toHaveBeenCalledWith(
    accountUserId,
    rootEventId,
    'verification-publish',
  );
  await publishOptions.onRootPurged(accountUserId, rootEventId);
  expect(mockLocalAttachmentStore).toHaveBeenCalledWith(database);
  expect(mockReconcile).toHaveBeenCalledWith(
    mockAttachmentStore,
    accountUserId,
  );
  expect(publishOptions.idempotencyKey()).toBe(
    '00000000-0000-4000-8000-000000000001',
  );
});
