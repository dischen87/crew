import type {
  EventTreeNode,
  MembershipRecord,
  OutboxItem,
  SyncStatus,
} from '@crew/mobile-data';
import {
  EventBasicsAccountChangedError,
  EventBasicsManagerRequiredError,
  EventBasicsPendingError,
  EventBasicsRuntime,
  EventBasicsUnavailableError,
  type EventBasicsValues,
} from '../src/screens/EventBasicsRuntime';

const mockListEventTree = jest.fn();
const mockListMemberships = jest.fn();
const mockListOutbox = jest.fn();
const mockGetStatus = jest.fn();
const mockEnqueueMutation = jest.fn();
const mockDiscardDeadLetter = jest.fn();
const mockSyncRoot = jest.fn();
const mockDeviceId = jest.fn();
const mockArm = jest.fn();
const mockFinish = jest.fn();
const mockReconcile = jest.fn();
const mockAttachmentStore = {};
const mockLocalAttachmentStore = jest.fn(
  (_database: unknown) => mockAttachmentStore,
);
const mockSecureUuid = jest.fn(() => '00000000-0000-4000-8000-000000000001');
let mockEvents: EventTreeNode[];
let mockMemberships: MembershipRecord[];
let mockOutbox: OutboxItem[];

jest.mock('@crew/mobile-data', () => ({
  LocalAttachmentStore: class {
    constructor(database: unknown) {
      mockLocalAttachmentStore(database);
      return mockAttachmentStore;
    }
  },
  MobileDataStore: class {
    listEventTree = mockListEventTree;
    listMemberships = mockListMemberships;
  },
  MobileSyncEngine: class {
    discardDeadLetter = mockDiscardDeadLetter;
    enqueueMutation = mockEnqueueMutation;
    getStatus = mockGetStatus;
    listOutbox = mockListOutbox;
    syncRoot = mockSyncRoot;
  },
}));

jest.mock('../src/storage/deviceIdentity', () => ({
  secureDeviceIdStore: {
    assertCurrent: jest.fn(async () => undefined),
    getOrCreate: () => mockDeviceId(),
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

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_existing_draft';
const deviceId = `dvc_${'1'.repeat(8)}-${'2'.repeat(4)}-4${'3'.repeat(
  3,
)}-8${'4'.repeat(3)}-${'5'.repeat(12)}`;
const failedMutationId = '11111111-1111-4111-8111-111111111111';
const replacementMutationId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents = [rootEvent()];
  mockMemberships = [membership()];
  mockOutbox = [];
  mockListEventTree.mockImplementation(async () => mockEvents);
  mockListMemberships.mockImplementation(async () => mockMemberships);
  mockListOutbox.mockImplementation(async () => mockOutbox);
  mockGetStatus.mockResolvedValue(syncedStatus());
  mockDeviceId.mockResolvedValue(deviceId);
  mockEnqueueMutation.mockImplementation(
    async (
      accountUserId: string,
      rootId: string,
      queuedDeviceId: string,
      command: {
        baseVersion: number;
        entityId: string;
        kind: 'event.update';
        payload: { changes: EventBasicsValues };
      },
      optimisticOverlay: unknown,
    ) => {
      const item = updateOutbox({
        clientMutationId: replacementMutationId,
        command: {
          ...command,
          clientMutationId: replacementMutationId,
          clientSequence: 1,
        },
        optimisticOverlay,
        state: 'pending',
      });
      item.accountUserId = accountUserId;
      item.rootEventId = rootId;
      item.deviceId = queuedDeviceId;
      mockOutbox.push(item);
      return item;
    },
  );
  mockDiscardDeadLetter.mockImplementation(
    async (_accountUserId: string, clientMutationId: string) => {
      mockOutbox = mockOutbox.filter(
        item => item.clientMutationId !== clientMutationId,
      );
    },
  );
  mockSyncRoot.mockResolvedValue(syncedStatus());
  mockArm.mockResolvedValue('verification-basics');
  mockFinish.mockResolvedValue(undefined);
  mockReconcile.mockResolvedValue(undefined);
});

test('loads only a manager-owned private draft from the exact account/root', async () => {
  const runtime = makeRuntime();
  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    conflict: null,
    current: canonicalValues(),
    delivery: 'clean',
    draft: canonicalValues(),
    role: 'owner',
    version: 7,
  });

  mockMemberships = [{ ...membership(), role: 'participant' }];
  await expect(runtime.load(rootEventId)).rejects.toBeInstanceOf(
    EventBasicsManagerRequiredError,
  );
  mockMemberships = [];
  await expect(runtime.load(rootEventId)).rejects.toBeInstanceOf(
    EventBasicsUnavailableError,
  );
  mockMemberships = [membership()];
  mockEvents = [{ ...rootEvent(), status: 'published' }];
  await expect(runtime.load(rootEventId)).rejects.toBeInstanceOf(
    EventBasicsUnavailableError,
  );
});

test('restores the exact optimistic overlay after restart and never stacks another same-root update', async () => {
  const local = changedValues('Lokal dauerhaft erhalten');
  mockOutbox = [
    updateOutbox({
      command: updateCommand(changedValues('Nicht die Overlay-Wahrheit')),
      optimisticOverlay: basicsOverlay(local),
      state: 'pending',
    }),
  ];
  const runtime = makeRuntime();

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    current: canonicalValues(),
    delivery: 'queued',
    draft: local,
  });
  await expect(
    runtime.save(rootEventId, changedValues('Zweite Änderung')),
  ).rejects.toBeInstanceOf(EventBasicsPendingError);
  expect(mockEnqueueMutation).not.toHaveBeenCalled();

  mockOutbox.push(
    updateOutbox({ clientMutationId: replacementMutationId, state: 'pending' }),
  );
  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    delivery: 'attention',
  });
});

test('queues one full offline event.update with the current version and a durable restart overlay', async () => {
  const values = changedValues('Offline Retreat');
  const runtime = makeRuntime({ online: false });

  await expect(runtime.save(rootEventId, values)).resolves.toMatchObject({
    delivery: 'queued',
    draft: values,
  });
  expect(mockEnqueueMutation).toHaveBeenCalledTimes(1);
  expect(mockEnqueueMutation).toHaveBeenCalledWith(
    accountA,
    rootEventId,
    deviceId,
    {
      baseVersion: 7,
      entityId: rootEventId,
      kind: 'event.update',
      payload: { changes: values },
    },
    basicsOverlay(values, null),
  );
  expect(mockSyncRoot).not.toHaveBeenCalled();
});

test('locks concurrent saves inside the runtime before either can create a second mutation', async () => {
  const runtime = makeRuntime({ online: false });
  const first = runtime.save(rootEventId, changedValues('Erste Änderung'));
  await expect(
    runtime.save(rootEventId, changedValues('Zweite Änderung')),
  ).rejects.toBeInstanceOf(EventBasicsPendingError);
  await expect(first).resolves.toMatchObject({ delivery: 'queued' });
  expect(mockEnqueueMutation).toHaveBeenCalledTimes(1);
});

test('locks two runtime instances sharing one database before either can create a second mutation', async () => {
  const database = {};
  const firstRuntime = makeRuntime({ database, online: false });
  const secondRuntime = makeRuntime({ database, online: false });

  const first = firstRuntime.save(rootEventId, changedValues('Erste Runtime'));
  await expect(
    secondRuntime.save(rootEventId, changedValues('Zweite Runtime')),
  ).rejects.toBeInstanceOf(EventBasicsPendingError);
  await expect(first).resolves.toMatchObject({ delivery: 'queued' });
  expect(mockEnqueueMutation).toHaveBeenCalledTimes(1);
  expect(mockEnqueueMutation.mock.calls[0]?.[3]).toMatchObject({
    payload: { changes: changedValues('Erste Runtime') },
  });
});

test('synchronizes online and returns the confirmed canonical values', async () => {
  const values = changedValues('Online bestätigt');
  mockSyncRoot.mockImplementationOnce(async () => {
    mockOutbox = [];
    mockEvents = [
      {
        ...rootEvent(),
        ...values,
        version: 8,
      },
    ];
    return syncedStatus();
  });
  const runtime = makeRuntime({ online: true });

  await expect(runtime.save(rootEventId, values)).resolves.toMatchObject({
    current: values,
    delivery: 'clean',
    version: 8,
  });
  expect(mockSyncRoot).toHaveBeenCalledWith(accountA, rootEventId, {
    force: true,
  });
});

test('replaces a deliberately reviewed conflict with the current baseVersion before consuming the dead letter', async () => {
  const attempted = changedValues('Mein Konfliktstand');
  const replacement = changedValues('Bewusst zusammengeführt');
  mockEvents = [{ ...rootEvent(), title: 'Aktueller Serverstand', version: 9 }];
  mockOutbox = [
    updateOutbox({
      clientMutationId: failedMutationId,
      command: updateCommand(attempted, 7, failedMutationId),
      lastError: {
        authoritativeOrder: null,
        code: 'conflict',
        currentVersion: 9,
        requestId: 'req_conflict',
      },
      state: 'dead_letter',
    }),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    conflict: {
      attempted,
      current: { ...canonicalValues(), title: 'Aktueller Serverstand' },
    },
    delivery: 'conflict',
  });
  await expect(runtime.save(rootEventId, replacement)).resolves.toMatchObject({
    delivery: 'queued',
    draft: replacement,
  });
  expect(mockEnqueueMutation.mock.calls[0]?.[3]).toMatchObject({
    baseVersion: 9,
    payload: { changes: replacement },
  });
  expect(mockEnqueueMutation.mock.calls[0]?.[4]).toEqual(
    basicsOverlay(replacement, failedMutationId),
  );
  expect(mockEnqueueMutation.mock.invocationCallOrder[0]).toBeLessThan(
    mockDiscardDeadLetter.mock.invocationCallOrder[0] ?? Infinity,
  );
  expect(mockDiscardDeadLetter).toHaveBeenCalledWith(
    accountA,
    failedMutationId,
  );
});

test('can deliberately accept current conflict truth without enqueuing a replacement', async () => {
  const attempted = changedValues('Nicht mehr übernehmen');
  mockOutbox = [
    updateOutbox({
      clientMutationId: failedMutationId,
      command: updateCommand(attempted, 7, failedMutationId),
      lastError: {
        authoritativeOrder: null,
        code: 'conflict',
        currentVersion: 7,
        requestId: 'req_conflict',
      },
      state: 'dead_letter',
    }),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(
    runtime.save(rootEventId, canonicalValues()),
  ).resolves.toMatchObject({ delivery: 'clean' });
  expect(mockDiscardDeadLetter).toHaveBeenCalledWith(
    accountA,
    failedMutationId,
  );
  expect(mockEnqueueMutation).not.toHaveBeenCalled();
});

test('finishes enqueue-before-discard conflict recovery after a restart', async () => {
  const replacement = changedValues('Crash-sicherer Ersatz');
  mockOutbox = [
    updateOutbox({
      clientMutationId: failedMutationId,
      command: updateCommand(changedValues('Alter Konflikt'), 7),
      lastError: {
        authoritativeOrder: null,
        code: 'conflict',
        currentVersion: 9,
        requestId: 'req_conflict',
      },
      state: 'dead_letter',
    }),
    updateOutbox({
      clientMutationId: replacementMutationId,
      command: updateCommand(replacement, 9, replacementMutationId),
      optimisticOverlay: basicsOverlay(replacement, failedMutationId),
      state: 'pending',
    }),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    delivery: 'queued',
    draft: replacement,
  });
  expect(mockDiscardDeadLetter).toHaveBeenCalledTimes(1);
  expect(mockDiscardDeadLetter).toHaveBeenCalledWith(
    accountA,
    failedMutationId,
  );
});

test('drops an account switch before durable enqueue', async () => {
  let activeAccount = accountA;
  mockDeviceId.mockImplementationOnce(async () => {
    activeAccount = accountB;
    return deviceId;
  });
  const runtime = makeRuntime({ activeAccount: () => activeAccount });

  await expect(
    runtime.save(rootEventId, changedValues('Falsches Konto')),
  ).rejects.toBeInstanceOf(EventBasicsAccountChangedError);
  expect(mockEnqueueMutation).not.toHaveBeenCalled();
});

function makeRuntime(options?: {
  activeAccount?: () => string | null;
  database?: object;
  online?: boolean;
}) {
  return new EventBasicsRuntime({
    accountUserId: accountA,
    activeAccountUserId: options?.activeAccount ?? (() => accountA),
    client: options?.online === false ? null : ({} as never),
    database: (options?.database ?? {}) as never,
    isOnline: () => options?.online ?? true,
  });
}

function canonicalValues(): EventBasicsValues {
  return {
    description: 'Zwei Tage am See.',
    endsAt: '2026-09-21T16:00:00.000Z',
    startsAt: '2026-09-20T07:00:00.000Z',
    timeZone: 'Europe/Zurich',
    title: 'Crew Retreat',
  };
}

function changedValues(title: string): EventBasicsValues {
  return {
    description: 'Gemeinsam geplant und bewusst gespeichert.',
    endsAt: '2026-09-22T17:00:00.000Z',
    startsAt: '2026-09-20T08:00:00.000Z',
    timeZone: 'Europe/Zurich',
    title,
  };
}

function rootEvent(): EventTreeNode {
  return {
    accountUserId: accountA,
    childOrderVersion: '1',
    createdAt: '2026-07-19T08:00:00.000Z',
    deletedAt: null,
    depth: 0,
    description: canonicalValues().description,
    endsAt: canonicalValues().endsAt,
    id: rootEventId,
    itineraryOrderVersion: '1',
    kind: 'team_event',
    parentEventId: null,
    rootEventId,
    sortKey: 'a',
    startsAt: canonicalValues().startsAt,
    status: 'draft',
    timeZone: canonicalValues().timeZone,
    title: canonicalValues().title,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 7,
  };
}

function membership(): MembershipRecord {
  return {
    accountUserId: accountA,
    createdAt: '2026-07-19T08:00:00.000Z',
    memberUserId: accountA,
    role: 'owner',
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function updateCommand(
  values = changedValues('Lokale Änderung'),
  baseVersion = 7,
  clientMutationId = failedMutationId,
) {
  return {
    baseVersion,
    clientMutationId,
    clientSequence: 1,
    entityId: rootEventId,
    kind: 'event.update' as const,
    payload: { changes: values },
  };
}

function basicsOverlay(
  values: EventBasicsValues,
  replacementFor: string | null = null,
) {
  return {
    changes: values,
    kind: 'event.basics',
    replacementFor,
    rootEventId,
    schemaVersion: 1,
  };
}

function updateOutbox(
  overrides: Partial<OutboxItem> & {
    command?: ReturnType<typeof updateCommand>;
  } = {},
): OutboxItem {
  return {
    accountUserId: accountA,
    appliedRootRevision: null,
    attempts: 0,
    clientMutationId: failedMutationId,
    clientSequence: 1,
    command: updateCommand(),
    createdAt: '2026-07-19T08:00:00.000Z',
    deviceId,
    lastError: null,
    nextAttemptAt: null,
    operationId: 'syncMutationsApply',
    optimisticOverlay: null,
    rootEventId,
    serverConsumed: false,
    state: 'pending',
    updatedAt: '2026-07-19T08:00:00.000Z',
    ...overrides,
  };
}

function syncedStatus(): SyncStatus {
  return {
    attentionCount: 0,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'synced',
    summary: 'All changes saved',
  };
}
