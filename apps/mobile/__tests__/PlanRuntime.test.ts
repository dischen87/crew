import type {
  EventTreeNode,
  EventPlaceRecord,
  ItineraryRecord,
  MembershipRecord,
  OutboxItem,
  SyncMutation,
  SyncMutationDraft,
  SyncStatus,
} from '@crew/mobile-data';
import {
  PlanAccountChangedError,
  PlanManagerRequiredError,
  PlanPendingError,
  PlanRuntime,
  PlanUnavailableError,
  type PlanItemValues,
} from '../src/screens/PlanRuntime';

const mockListEventTree = jest.fn();
const mockListMemberships = jest.fn();
const mockListTimeline = jest.fn();
const mockListEventPlaces = jest.fn();
const mockListOutbox = jest.fn();
const mockGetStatus = jest.fn();
const mockEnqueueMutation = jest.fn();
const mockDiscardDeadLetter = jest.fn();
const mockRetryExhausted = jest.fn();
const mockSyncRoot = jest.fn();
const mockDeviceId = jest.fn();
const mockSecureUuid = jest.fn(() => '00000000-0000-4000-8000-000000000001');
let mockEvents: EventTreeNode[];
let mockMemberships: MembershipRecord[];
let mockTimeline: ItineraryRecord[];
let mockPlaces: EventPlaceRecord[];
let mockOutbox: OutboxItem[];

jest.mock('@crew/mobile-data', () => ({
  LocalAttachmentStore: class {},
  MobileDataStore: class {
    listEventTree = mockListEventTree;
    listEventPlaces = mockListEventPlaces;
    listMemberships = mockListMemberships;
    listTimeline = mockListTimeline;
  },
  MobileSyncEngine: class {
    discardDeadLetter = mockDiscardDeadLetter;
    enqueueMutation = mockEnqueueMutation;
    getStatus = mockGetStatus;
    listOutbox = mockListOutbox;
    retryExhausted = mockRetryExhausted;
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
    arm: jest.fn(),
    finish: jest.fn(),
  },
}));

jest.mock('../src/media/attachmentMedia', () => ({
  reconcileRetainedAttachmentFiles: jest.fn(),
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: () => mockSecureUuid(),
}));

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_plan_root';
const childEventId = 'evt_plan_day';
const itemId = 'iti_plan_item';
const createdItemId = 'iti_00000000-0000-4000-8000-000000000001';
const createdEventId = 'evt_00000000-0000-4000-8000-000000000001';
const deviceId = `dvc_${'1'.repeat(8)}-${'2'.repeat(4)}-4${'3'.repeat(
  3,
)}-8${'4'.repeat(3)}-${'5'.repeat(12)}`;
const failedMutationId = '11111111-1111-4111-8111-111111111111';
const queuedMutationId = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents = [
    eventNode(rootEventId, null, 0),
    eventNode(childEventId, rootEventId, 1),
  ];
  mockMemberships = [membership('owner')];
  mockTimeline = [itineraryRecord()];
  mockPlaces = [eventPlace()];
  mockOutbox = [];
  mockListEventTree.mockImplementation(async () => mockEvents);
  mockListMemberships.mockImplementation(async () => mockMemberships);
  mockListTimeline.mockImplementation(async () => mockTimeline);
  mockListEventPlaces.mockImplementation(async () => mockPlaces);
  mockListOutbox.mockImplementation(async () => mockOutbox);
  mockGetStatus.mockResolvedValue(syncedStatus());
  mockDeviceId.mockResolvedValue(deviceId);
  mockSyncRoot.mockResolvedValue(syncedStatus());
  mockRetryExhausted.mockImplementation(async () => {
    mockOutbox = mockOutbox.map(item =>
      item.state === 'dead_letter' &&
      item.lastError?.code === 'retry_exhausted'
        ? {
            ...item,
            attempts: 0,
            lastError: null,
            state: 'pending',
          }
        : item,
    );
  });
  mockDiscardDeadLetter.mockImplementation(
    async (_accountUserId: string, mutationId: string) => {
      mockOutbox = mockOutbox.filter(
        item => item.clientMutationId !== mutationId,
      );
    },
  );
  mockEnqueueMutation.mockImplementation(
    async (
      accountUserId: string,
      rootId: string,
      queuedDeviceId: string,
      draft: SyncMutationDraft,
      optimisticOverlay: unknown,
    ) => {
      const command = {
        ...draft,
        clientMutationId: queuedMutationId,
        clientSequence: mockOutbox.length + 1,
      } as SyncMutation;
      const item = outboxItem(command, {
        accountUserId,
        deviceId: queuedDeviceId,
        optimisticOverlay,
        rootEventId: rootId,
      });
      mockOutbox.push(item);
      return item;
    },
  );
});

test('loads the recursive cached plan for every active role but only managers can write', async () => {
  mockMemberships = [membership('participant')];
  const runtime = makeRuntime({ online: false });

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    canEdit: false,
    events: [
      { depth: 0, id: rootEventId },
      { depth: 1, id: childEventId, parentEventId: rootEventId },
    ],
    items: [
      {
        delivery: 'clean',
        id: itemId,
        values: canonicalValues(),
        version: 4,
      },
    ],
    places: [{ id: 'plc_plan_club', name: 'Crew Club' }],
    role: 'participant',
  });
  await expect(
    runtime.createItem(rootEventId, changedValues('Nope')),
  ).rejects.toBeInstanceOf(PlanManagerRequiredError);
  expect(mockEnqueueMutation).not.toHaveBeenCalled();
});

test('durably queues a normalized offline create and restores its optimistic row', async () => {
  const runtime = makeRuntime({ online: false });
  const values = {
    ...changedValues('  Abendessen  '),
    endsAt: '2026-09-20T22:00:00+02:00',
    startsAt: '2026-09-20T20:00:00+02:00',
  };

  const snapshot = await runtime.createItem(rootEventId, values);
  expect(snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        delivery: 'queued',
        id: createdItemId,
        values: {
          ...changedValues('Abendessen'),
          endsAt: '2026-09-20T20:00:00.000Z',
          startsAt: '2026-09-20T18:00:00.000Z',
        },
        version: null,
      }),
    ]),
  );
  expect(mockEnqueueMutation).toHaveBeenCalledWith(
    accountA,
    rootEventId,
    deviceId,
    {
      entityId: createdItemId,
      kind: 'itinerary.create',
      payload: {
        ...changedValues('Abendessen'),
        endsAt: '2026-09-20T20:00:00.000Z',
        startsAt: '2026-09-20T18:00:00.000Z',
      },
    },
    expect.objectContaining({
      itemId: createdItemId,
      kind: 'plan.item',
      rootEventId,
    }),
  );
  expect(mockSyncRoot).not.toHaveBeenCalled();
  const restored = await makeRuntime({ online: false }).load(rootEventId);
  expect(restored.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ delivery: 'queued', id: createdItemId }),
    ]),
  );
});

test('durably authors an optimistic child event through the sync mutation stream', async () => {
  const runtime = makeRuntime({ online: false });

  const snapshot = await runtime.createChildEvent(
    rootEventId,
    childEventId,
    {
      description: '  ',
      endsAt: '2026-09-20T18:00:00+02:00',
      kind: 'activity',
      startsAt: '2026-09-20T16:00:00+02:00',
      status: 'draft',
      timeZone: 'Europe/Zurich',
      title: '  Abschluss  ',
    },
  );

  expect(snapshot.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        depth: 2,
        id: createdEventId,
        parentEventId: childEventId,
        startsAt: '2026-09-20T14:00:00.000Z',
        title: 'Abschluss',
        version: 0,
      }),
    ]),
  );
  expect(mockEnqueueMutation).toHaveBeenCalledWith(
    accountA,
    rootEventId,
    deviceId,
    {
      entityId: createdEventId,
      kind: 'event.create',
      payload: {
        description: '  ',
        endsAt: '2026-09-20T16:00:00.000Z',
        kind: 'activity',
        parentEventId: childEventId,
        startsAt: '2026-09-20T14:00:00.000Z',
        status: 'draft',
        timeZone: 'Europe/Zurich',
        title: 'Abschluss',
      },
    },
    expect.objectContaining({
      eventId: createdEventId,
      kind: 'plan.event',
      parentEventId: childEventId,
      rootEventId,
    }),
  );
  expect(mockSyncRoot).not.toHaveBeenCalled();
});

test('keeps a rejected child event visible until the manager discards it', async () => {
  const runtime = makeRuntime({ online: false });
  await runtime.createChildEvent(rootEventId, childEventId, {
    description: null,
    endsAt: null,
    kind: 'activity',
    startsAt: null,
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title: 'Lokaler Unterbereich',
  });
  const dependentValues = {
    ...changedValues('Abhängiger Programmpunkt'),
    eventId: createdEventId,
  };
  mockOutbox.push(
    outboxItem(createMutation(dependentValues, failedMutationId), {
      optimisticOverlay: overlay(dependentValues, createdItemId),
    }),
  );
  mockOutbox = mockOutbox.map(item =>
    item.command.kind === 'event.create'
      ? {
          ...item,
          lastError: {
            authoritativeOrder: null,
            code: 'permission',
            currentVersion: null,
            requestId: 'req_event_denied',
          },
          serverConsumed: true,
          state: 'dead_letter',
        }
      : item,
  );

  const rejected = await runtime.load(rootEventId);
  expect(rejected).toMatchObject({
    events: expect.arrayContaining([
      expect.objectContaining({
        id: createdEventId,
        title: 'Lokaler Unterbereich',
        version: 0,
      }),
    ]),
    issues: [
      {
        attempted: null,
        code: 'permission',
        eventAttempted: {
          parentEventId: childEventId,
          title: 'Lokaler Unterbereich',
        },
        itemId: createdEventId,
        mutationId: queuedMutationId,
      },
    ],
  });
  await expect(
    runtime.createItem(rootEventId, {
      ...changedValues('Nicht erlaubt'),
      eventId: createdEventId,
    }),
  ).rejects.toBeInstanceOf(PlanPendingError);
  await expect(
    runtime.createChildEvent(rootEventId, createdEventId, {
      description: null,
      endsAt: null,
      kind: 'activity',
      startsAt: null,
      status: 'draft',
      timeZone: 'Europe/Zurich',
      title: 'Nicht erlaubt',
    }),
  ).rejects.toBeInstanceOf(PlanPendingError);

  await expect(
    runtime.discardIssue(rootEventId, queuedMutationId),
  ).resolves.toMatchObject({
    events: expect.not.arrayContaining([
      expect.objectContaining({ id: createdEventId }),
    ]),
    items: expect.not.arrayContaining([
      expect.objectContaining({ id: createdItemId }),
    ]),
    issues: [],
  });
  expect(mockDiscardDeadLetter).toHaveBeenCalledWith(
    accountA,
    queuedMutationId,
  );
});

test('surfaces and discards a rejected itinerary reorder', async () => {
  mockTimeline = [
    itineraryRecord(),
    itineraryRecord({
      id: 'iti_plan_item_two',
      sortKey: '2048',
      title: 'Zweiter Punkt',
    }),
  ];
  const runtime = makeRuntime({ online: false });
  await runtime.moveItineraryItem(rootEventId, itemId, 'down');
  mockOutbox = mockOutbox.map(item => ({
    ...item,
    lastError: {
      authoritativeOrder: null,
      code: 'conflict',
      currentVersion: 2,
      requestId: 'req_order_conflict',
    },
    serverConsumed: true,
    state: 'dead_letter',
  }));

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    issues: [
      {
        code: 'conflict',
        mutationId: queuedMutationId,
        orderAttempted: {
          entityId: childEventId,
          kind: 'plan.itinerary-order',
          orderedIds: ['iti_plan_item_two', itemId],
        },
      },
    ],
  });
  await expect(
    runtime.discardIssue(rootEventId, queuedMutationId),
  ).resolves.toMatchObject({ issues: [] });
});

test('retries an exhausted unconsumed plan mutation instead of discarding it', async () => {
  mockTimeline = [
    itineraryRecord(),
    itineraryRecord({
      id: 'iti_plan_item_two',
      sortKey: '2048',
      title: 'Zweiter Punkt',
    }),
  ];
  const runtime = makeRuntime({ online: false });
  await runtime.moveItineraryItem(rootEventId, itemId, 'down');
  mockOutbox = mockOutbox.map(item => ({
    ...item,
    lastError: {
      authoritativeOrder: null,
      code: 'retry_exhausted',
      currentVersion: null,
      requestId: 'req_order_retry',
    },
    serverConsumed: false,
    state: 'dead_letter',
  }));

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    issues: [
      {
        mutationId: queuedMutationId,
        resolution: 'retry',
      },
    ],
  });
  await expect(
    runtime.discardIssue(rootEventId, queuedMutationId),
  ).rejects.toBeInstanceOf(PlanUnavailableError);
  await expect(
    runtime.moveItineraryItem(rootEventId, itemId, 'down'),
  ).rejects.toBeInstanceOf(PlanPendingError);
  await expect(
    runtime.retryIssue(rootEventId, queuedMutationId),
  ).resolves.toMatchObject({ issues: [] });
  expect(mockRetryExhausted).toHaveBeenCalledWith(accountA, rootEventId);
});

test('queues explicit sibling and itinerary order mutations with optimistic order', async () => {
  const secondEventId = 'evt_plan_day_two';
  mockEvents = [
    { ...eventNode(rootEventId, null, 0), childOrderVersion: '7' },
    { ...eventNode(childEventId, rootEventId, 1), sortKey: '1' },
    {
      ...eventNode(secondEventId, rootEventId, 1),
      id: secondEventId,
      sortKey: '2',
      title: 'Tag zwei',
    },
  ];
  const runtime = makeRuntime({ online: false });

  const eventSnapshot = await runtime.moveChildEvent(
    rootEventId,
    childEventId,
    'down',
  );
  expect(mockEnqueueMutation.mock.calls[0]?.[3]).toEqual({
    baseVersion: 7,
    entityId: rootEventId,
    kind: 'event.children.reorder',
    payload: { orderedIds: [secondEventId, childEventId] },
  });
  expect(eventSnapshot.events.map(event => event.id)).toEqual([
    rootEventId,
    secondEventId,
    childEventId,
  ]);

  mockOutbox = [];
  mockTimeline = [
    itineraryRecord(),
    itineraryRecord({
      id: 'iti_plan_item_two',
      sortKey: '2048',
      title: 'Zweiter Punkt',
    }),
  ];
  const itemSnapshot = await runtime.moveItineraryItem(
    rootEventId,
    itemId,
    'down',
  );
  expect(mockEnqueueMutation.mock.calls[1]?.[3]).toEqual({
    baseVersion: 1,
    entityId: childEventId,
    kind: 'itinerary.reorder',
    payload: { orderedIds: ['iti_plan_item_two', itemId] },
  });
  expect(
    itemSnapshot.items
      .filter(item => item.values.eventId === childEventId)
      .map(item => item.id),
  ).toEqual(['iti_plan_item_two', itemId]);
});

test('queues one versioned update and rejects a second mutation for the same item', async () => {
  const runtime = makeRuntime({ online: false });

  const snapshot = await runtime.updateItem(rootEventId, itemId, {
    notes: 'Offline erhalten',
    title: 'Neuer Titel',
  });
  expect(snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        delivery: 'queued',
        id: itemId,
        values: expect.objectContaining({
          notes: 'Offline erhalten',
          title: 'Neuer Titel',
        }),
      }),
    ]),
  );
  expect(mockEnqueueMutation.mock.calls[0]?.[3]).toEqual({
    baseVersion: 4,
    entityId: itemId,
    kind: 'itinerary.update',
    payload: {
      changes: { notes: 'Offline erhalten', title: 'Neuer Titel' },
    },
  });
  await expect(
    makeRuntime({ online: false }).updateItem(rootEventId, itemId, {
      title: 'Gestapelt',
    }),
  ).rejects.toBeInstanceOf(PlanPendingError);
  expect(mockEnqueueMutation).toHaveBeenCalledTimes(1);
});

test('shows canonical conflict truth and replaces it from the current version crash-safely', async () => {
  const attempted = changedValues('Mein Konfliktstand');
  mockOutbox = [
    outboxItem(updateMutation(attempted, 3, failedMutationId), {
      lastError: {
        authoritativeOrder: null,
        code: 'conflict',
        currentVersion: 4,
        requestId: 'req_conflict',
      },
      optimisticOverlay: overlay(attempted),
      state: 'dead_letter',
    }),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(runtime.load(rootEventId)).resolves.toMatchObject({
    issues: [
      {
        attempted,
        code: 'conflict',
        current: canonicalValues(),
        itemId,
        mutationId: failedMutationId,
      },
    ],
    items: [{ delivery: 'clean', values: canonicalValues() }],
  });
  await runtime.updateItem(rootEventId, itemId, {
    title: 'Bewusst zusammengeführt',
  });
  expect(mockEnqueueMutation.mock.calls[0]?.[3]).toMatchObject({
    baseVersion: 4,
    payload: { changes: { title: 'Bewusst zusammengeführt' } },
  });
  expect(mockEnqueueMutation.mock.calls[0]?.[4]).toMatchObject({
    replacementFor: failedMutationId,
  });
  expect(mockEnqueueMutation.mock.invocationCallOrder[0]).toBeLessThan(
    mockDiscardDeadLetter.mock.invocationCallOrder[0] ?? Infinity,
  );
});

test('does not present permission/deletion failures as live items and fences account switches', async () => {
  const denied = changedValues('Nicht autorisiert');
  mockTimeline = [];
  mockOutbox = [
    outboxItem(createMutation(denied), {
      lastError: {
        authoritativeOrder: null,
        code: 'permission',
        currentVersion: null,
        requestId: 'req_denied',
      },
      optimisticOverlay: overlay(denied, createdItemId, null),
      state: 'dead_letter',
    }),
  ];
  await expect(
    makeRuntime({ online: false }).load(rootEventId),
  ).resolves.toMatchObject({
    issues: [
      {
        attempted: denied,
        code: 'permission',
        current: null,
        itemId: createdItemId,
      },
    ],
    items: [],
  });

  mockTimeline = [itineraryRecord()];
  mockOutbox = [
    outboxItem(updateMutation(denied, 4, failedMutationId), {
      lastError: {
        authoritativeOrder: null,
        code: 'deleted',
        currentVersion: 5,
        requestId: 'req_deleted',
      },
      optimisticOverlay: overlay(denied),
      state: 'dead_letter',
    }),
  ];
  await expect(
    makeRuntime({ online: false }).load(rootEventId),
  ).resolves.toMatchObject({
    issues: [
      {
        attempted: denied,
        code: 'deleted',
        current: null,
        itemId,
      },
    ],
    items: [],
  });

  let activeAccount = accountA;
  mockDeviceId.mockImplementationOnce(async () => {
    activeAccount = accountB;
    return deviceId;
  });
  mockOutbox = [];
  await expect(
    makeRuntime({
      activeAccount: () => activeAccount,
      online: false,
    }).createItem(rootEventId, changedValues('Falsches Konto')),
  ).rejects.toBeInstanceOf(PlanAccountChangedError);
  expect(mockEnqueueMutation).not.toHaveBeenCalled();
});

test('discards exactly one itinerary dead letter inside the requested root', async () => {
  const attempted = changedValues('Verwerfen');
  mockOutbox = [
    outboxItem(updateMutation(attempted, 3, failedMutationId), {
      lastError: {
        authoritativeOrder: null,
        code: 'conflict',
        currentVersion: 4,
        requestId: 'req_conflict',
      },
      optimisticOverlay: overlay(attempted),
      serverConsumed: true,
      state: 'dead_letter',
    }),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(
    runtime.discardIssue(rootEventId, failedMutationId),
  ).resolves.toMatchObject({ issues: [] });
  expect(mockDiscardDeadLetter).toHaveBeenCalledWith(
    accountA,
    failedMutationId,
  );
  expect(mockOutbox).toEqual([]);
});

test('refuses a wrong root or mutation id without discarding anything', async () => {
  mockOutbox = [
    outboxItem(
      updateMutation(changedValues('Andere Root'), 3, failedMutationId),
      {
        rootEventId: 'evt_other_root',
        serverConsumed: true,
        state: 'dead_letter',
      },
    ),
  ];
  const runtime = makeRuntime({ online: false });

  await expect(
    runtime.discardIssue(rootEventId, failedMutationId),
  ).rejects.toBeInstanceOf(PlanUnavailableError);
  await expect(
    runtime.discardIssue(rootEventId, '33333333-3333-4333-8333-333333333333'),
  ).rejects.toBeInstanceOf(PlanUnavailableError);
  expect(mockDiscardDeadLetter).not.toHaveBeenCalled();
});

function makeRuntime(options?: {
  activeAccount?: () => string | null;
  online?: boolean;
}) {
  return new PlanRuntime({
    accountUserId: accountA,
    activeAccountUserId: options?.activeAccount ?? (() => accountA),
    client: options?.online === false ? null : ({} as never),
    database: {} as never,
    isOnline: () => options?.online ?? true,
  });
}

function canonicalValues(): PlanItemValues {
  return {
    allDay: false,
    details: { reservationNote: 'Terrasse', schemaVersion: 1, type: 'meal' },
    endsAt: '2026-09-20T20:00:00.000Z',
    eventId: childEventId,
    notes: 'Smart casual',
    placeId: null,
    startsAt: '2026-09-20T18:00:00.000Z',
    status: 'active',
    timeZone: 'Europe/Zurich',
    title: 'Gemeinsames Abendessen',
  };
}

function changedValues(title: string): PlanItemValues {
  return {
    ...canonicalValues(),
    notes: 'Gemeinsam geplant',
    title,
  };
}

function eventNode(
  id: string,
  parentEventId: string | null,
  depth: number,
): EventTreeNode {
  return {
    accountUserId: accountA,
    childOrderVersion: '1',
    createdAt: '2026-07-20T08:00:00.000Z',
    deletedAt: null,
    depth,
    description: null,
    endsAt: '2026-09-21T17:00:00.000Z',
    id,
    itineraryOrderVersion: '1',
    kind: depth === 0 ? 'trip' : 'day',
    parentEventId,
    rootEventId,
    sortKey: String(depth + 1),
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: depth === 0 ? 'Crew Reise' : 'Tag eins',
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 2,
  };
}

function membership(role: MembershipRecord['role']): MembershipRecord {
  return {
    accountUserId: accountA,
    createdAt: '2026-07-20T08:00:00.000Z',
    memberUserId: accountA,
    role,
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 1,
  };
}

function itineraryRecord(
  overrides: Partial<ItineraryRecord> = {},
): ItineraryRecord {
  const values = canonicalValues();
  return {
    accountUserId: accountA,
    allDay: values.allDay,
    createdAt: '2026-07-20T08:00:00.000Z',
    deletedAt: null,
    detailsJson: JSON.stringify(values.details),
    detailsSchemaVersion: 1,
    endsAt: values.endsAt,
    eventId: values.eventId,
    id: itemId,
    notes: values.notes,
    placeId: values.placeId,
    placeSnapshotJson: null,
    rootEventId,
    sortKey: '1024',
    startsAt: values.startsAt,
    status: values.status,
    timeZone: values.timeZone,
    title: values.title,
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 4,
    ...overrides,
  };
}

function eventPlace(): EventPlaceRecord {
  return {
    accountUserId: accountA,
    countryCode: 'CH',
    createdAt: '2026-07-20T08:00:00.000Z',
    deletedAt: null,
    id: 'plc_plan_club',
    latitude: 47.3769,
    locality: 'Zürich',
    longitude: 8.5417,
    name: 'Crew Club',
    rootEventId,
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 1,
  };
}

function createMutation(
  values: PlanItemValues,
  mutationId = failedMutationId,
): Extract<SyncMutation, { kind: 'itinerary.create' }> {
  return {
    clientMutationId: mutationId,
    clientSequence: 1,
    entityId: createdItemId,
    kind: 'itinerary.create',
    payload: values,
  };
}

function updateMutation(
  values: PlanItemValues,
  baseVersion: number,
  mutationId: string,
): Extract<SyncMutation, { kind: 'itinerary.update' }> {
  return {
    baseVersion,
    clientMutationId: mutationId,
    clientSequence: 1,
    entityId: itemId,
    kind: 'itinerary.update',
    payload: {
      changes: {
        allDay: values.allDay,
        details: values.details,
        endsAt: values.endsAt,
        notes: values.notes,
        placeId: values.placeId,
        startsAt: values.startsAt,
        status: values.status,
        timeZone: values.timeZone,
        title: values.title,
      },
    },
  };
}

function overlay(
  values: PlanItemValues,
  overlayItemId = itemId,
  replacementFor: string | null = null,
) {
  return {
    itemId: overlayItemId,
    kind: 'plan.item',
    replacementFor,
    rootEventId,
    schemaVersion: 1,
    values,
  };
}

function outboxItem(
  command: SyncMutation,
  overrides: Partial<OutboxItem> = {},
): OutboxItem {
  return {
    accountUserId: accountA,
    appliedRootRevision: null,
    attempts: 0,
    clientMutationId: command.clientMutationId,
    clientSequence: command.clientSequence,
    command,
    createdAt: '2026-07-20T08:00:00.000Z',
    deviceId,
    lastError: null,
    nextAttemptAt: null,
    operationId: 'syncMutationsApply',
    optimisticOverlay: null,
    rootEventId,
    serverConsumed: false,
    state: 'pending',
    updatedAt: '2026-07-20T08:00:00.000Z',
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
