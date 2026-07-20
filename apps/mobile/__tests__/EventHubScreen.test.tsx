import {
  ActorEventRootIndexStore,
  LocalAttachmentStore,
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type EventRecord,
  type FeedRecord,
  type ItineraryRecord,
  type MembershipRecord,
  type RootSyncState,
} from '@crew/mobile-data';
import React from 'react';
import { Alert, Linking, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  EventHubScreen,
  eventHubModelFromReadModels,
  type EventHubReadSnapshot,
} from '../src/screens/EventHubScreen';
import { secureUuidV4 } from '../src/storage/secureRandom';

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootA = 'evt_trip_a';
const rootB = 'evt_trip_b';
const mockGatewayClient = { request: jest.fn() };
const mockIndexGet = jest.fn();
const mockIndexRefresh = jest.fn();
const mockReconcileRetainedAttachmentFiles = jest.fn(
  async (_store: unknown, _accountUserId: string) => undefined,
);
const mockArmDeniedRoot = jest.fn(
  async (_accountUserId: string, _rootEventId: string) =>
    'verification-event-hub',
);
const mockFinishDeniedRoot = jest.fn(
  async (
    _accountUserId: string,
    _rootEventId: string,
    _verificationId: string,
  ) => undefined,
);
let mockPrivateDatabase: { accountId: string; database: unknown };
let mockLifecycle: {
  accountId: string | null;
  reloadSession: jest.Mock;
  replaceSession: jest.Mock;
  status: 'ready';
};

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    ActorEventRootIndexStore: jest.fn(),
    LocalAttachmentStore: jest.fn(),
    MemberDirectoryStore: jest.fn(),
    MobileDataStore: jest.fn(),
    MobileSyncEngine: jest.fn(),
  };
});

jest.mock('../src/media/attachmentMedia', () => ({
  reconcileRetainedAttachmentFiles: (store: unknown, accountUserId: string) =>
    mockReconcileRetainedAttachmentFiles(store, accountUserId),
}));

jest.mock('../src/storage/deniedRoots', () => ({
  deniedRootRegistry: {
    arm: (...args: [string, string]) => mockArmDeniedRoot(...args),
    finish: (...args: [string, string, string]) =>
      mockFinishDeniedRoot(...args),
  },
}));

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLifecycle = {
    accountId: accountA,
    reloadSession: jest.fn(async () => undefined),
    replaceSession: jest.fn(async () => undefined),
    status: 'ready',
  };
  jest.mocked(ActorEventRootIndexStore).mockImplementation((() => ({
    get: mockIndexGet,
    refresh: mockIndexRefresh,
  })) as never);
  mockIndexGet.mockResolvedValue({ rootEventId: rootA });
  mockIndexRefresh.mockResolvedValue({
    accountUserId: accountA,
    cacheVersion: 1,
    refreshedAt: '2026-07-19T12:00:00.000Z',
    schemaVersion: 1,
  });
  jest
    .mocked(MobileDataStore)
    .mockImplementation(
      ((database: { store: MobileDataStore }) => database.store) as never,
    );
  jest.mocked(MemberDirectoryStore).mockImplementation(
    ((database: {
      directory?: Pick<MemberDirectoryStore, 'list' | 'refresh'>;
    }) =>
      database.directory ?? {
        list: jest.fn(async () => []),
        refresh: jest.fn(async () => undefined),
      }) as never,
  );
  jest
    .mocked(LocalAttachmentStore)
    .mockImplementation(((database: unknown) => ({ database })) as never);
  jest
    .mocked(MobileSyncEngine)
    .mockImplementation(
      ((database: { sync: Pick<MobileSyncEngine, 'syncRoot'> }) =>
        database.sync) as never,
    );
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
});

afterEach(() => jest.restoreAllMocks());

test('builds the authorized production model only from account-scoped SQLite reads', async () => {
  const store = storeFor(snapshot(accountA, rootA, 'Golfreise'));
  const syncRoot = jest.fn(async () => syncStatus());
  mockPrivateDatabase = {
    accountId: accountA,
    database: { store, sync: { syncRoot } },
  };
  const navigate = jest.fn();
  const renderer = await renderScreen(rootA, true, navigate);

  expect(textInside(renderer)).toContain('Golfreise');
  expect(store.listEventTree).toHaveBeenCalledWith(accountA, rootA);
  expect(store.listMemberships).toHaveBeenCalledWith(accountA, rootA);
  expect(store.listTimeline).toHaveBeenCalledWith(accountA, rootA);
  expect(store.listFeed).toHaveBeenCalledWith(accountA, rootA);
  expect(store.getRootSyncState).toHaveBeenCalledWith(accountA, rootA);
  expect(MobileSyncEngine).toHaveBeenCalledWith(
    mockPrivateDatabase.database,
    mockGatewayClient,
    expect.objectContaining({
      activeAccountUserId: expect.any(Function),
      randomUUID: secureUuidV4,
    }),
  );
  expect(ActorEventRootIndexStore).toHaveBeenCalledWith(
    mockPrivateDatabase.database,
    mockGatewayClient,
    expect.objectContaining({ activeAccountUserId: expect.any(Function) }),
  );
  expect(mockIndexGet).toHaveBeenCalledWith(accountA, rootA);
  expect(mockIndexRefresh).toHaveBeenCalledWith(accountA);
  expect(mockGatewayClient.request).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never renders held projections for a root absent from the actor index', async () => {
  mockIndexGet.mockResolvedValue(null);
  const store = storeFor(snapshot(accountA, rootA, 'Nicht im Index'));
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store,
      sync: { syncRoot: jest.fn(async () => syncStatus()) },
    },
  };
  const renderer = await renderScreen(rootA);

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar.');
  expect(textInside(renderer)).not.toContain('Nicht im Index');
  expect(store.listEventTree).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps a cached root visible and labels it offline when refresh fails', async () => {
  const store = storeFor(snapshot(accountA, rootA, 'Offline-Reise'));
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store,
      sync: {
        syncRoot: jest.fn(async () => Promise.reject(new Error('offline'))),
      },
    },
  };
  const renderer = await renderScreen(rootA);

  expect(textInside(renderer)).toContain('Offline-Reise');
  expect(textInside(renderer)).toMatch(/Offline · .* synchronisiert/);
  expect(textInside(renderer)).not.toContain('Inhalt nicht verfügbar');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals an unauthorized root when no account-scoped cache exists', async () => {
  const store = storeFor(null);
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store,
      sync: { syncRoot: jest.fn(async () => Promise.reject(new Error('404'))) },
    },
  };
  const renderer = await renderScreen(rootA);

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar.');
  expect(textInside(renderer)).not.toContain(rootA);
  expect(textInside(renderer)).not.toMatch(
    /nicht berechtigt|Mitgliedschaft|404/,
  );

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('drops a held cache after authoritative denial and reconciles retained files', async () => {
  const store = storeFor(snapshot(accountA, rootA, 'Widerrufene Reise'));
  const database = { store };
  jest.mocked(MobileSyncEngine).mockImplementationOnce(((
    _database: unknown,
    _client: unknown,
    options: {
      onRootReadStarted?: (
        accountUserId: string,
        rootEventId: string,
      ) => string | Promise<string>;
      onRootReadFinished?: (
        accountUserId: string,
        rootEventId: string,
        verificationId: string,
      ) => void | Promise<void>;
      onRootPurged?: (
        accountUserId: string,
        rootEventId: string,
      ) => void | Promise<void>;
    },
  ) => ({
    syncRoot: async () => {
      const verificationId = await options.onRootReadStarted?.(accountA, rootA);
      await options.onRootPurged?.(accountA, rootA);
      if (verificationId) {
        await options.onRootReadFinished?.(accountA, rootA, verificationId);
      }
      throw new MobileSyncRootAccessDeniedError();
    },
  })) as never);
  mockPrivateDatabase = { accountId: accountA, database };
  const renderer = await renderScreen(rootA);

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar.');
  expect(textInside(renderer)).not.toContain('Widerrufene Reise');
  expect(LocalAttachmentStore).toHaveBeenCalledWith(database);
  expect(mockReconcileRetainedAttachmentFiles).toHaveBeenCalledWith(
    expect.anything(),
    accountA,
  );
  expect(mockArmDeniedRoot).toHaveBeenCalledWith(accountA, rootA);
  expect(mockFinishDeniedRoot).toHaveBeenCalledWith(
    accountA,
    rootA,
    'verification-event-hub',
  );

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('never renders an earlier account after the private database switches', async () => {
  let resolveAccountA!: (events: readonly EventRecord[]) => void;
  const staleStore = storeFor(snapshot(accountA, rootA, 'Altes Konto'));
  staleStore.listEventTree.mockReturnValue(
    new Promise<readonly EventRecord[]>(resolve => {
      resolveAccountA = resolve;
    }),
  );
  const freshStore = storeFor(snapshot(accountB, rootB, 'Neues Konto'));
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store: staleStore,
      sync: { syncRoot: jest.fn(async () => syncStatus()) },
    },
  };
  let renderer = await renderScreen(rootA, false);

  mockLifecycle.accountId = accountB;
  mockPrivateDatabase = {
    accountId: accountB,
    database: {
      store: freshStore,
      sync: { syncRoot: jest.fn(async () => syncStatus()) },
    },
  };
  await ReactTestRenderer.act(async () => {
    renderer.update(screen(rootB));
    await flush();
  });
  resolveAccountA([snapshot(accountA, rootA, 'Altes Konto').root]);
  await ReactTestRenderer.act(flush);

  expect(textInside(renderer)).toContain('Neues Konto');
  expect(textInside(renderer)).not.toContain('Altes Konto');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps viewer actions read-only and date keys stable in extreme time zones', () => {
  const readModels = snapshot(accountA, rootA, 'Kiritimati Event', 'viewer');
  readModels.root.timeZone = 'Pacific/Kiritimati';
  readModels.root.startsAt = '2026-09-17T10:30:00.000Z';
  readModels.root.endsAt = '2026-09-18T10:30:00.000Z';
  const model = eventHubModelFromReadModels({
    now: new Date('2026-09-17T11:00:00.000Z'),
    phase: 'cached',
    selectedDateId: null,
    snapshot: readModels,
    syncStatus: null,
  });

  expect(model.role).toBe('viewer');
  expect(model.primaryAction?.access).toBe('read');
  expect(model.dates.map(date => [date.id, date.weekday])).toEqual([
    ['2026-09-18', 'FR'],
    ['2026-09-19', 'SA'],
  ]);
  expect(model.dates[0]?.accessibilityLabel).toContain('Freitag');
});

test('keeps all eight event days and selects itinerary on 09 and 10 October', () => {
  const readModels = snapshot(accountA, rootA, 'Acht Tage Golf');
  readModels.root.startsAt = '2026-10-04T08:00:00.000Z';
  readModels.root.endsAt = '2026-10-11T18:00:00.000Z';
  readModels.timeline = [
    {
      ...readModels.timeline[0]!,
      endsAt: '2026-10-09T09:10:00.000Z',
      eventId: 'evt_national',
      id: 'iti_national',
      startsAt: '2026-10-09T07:10:00.000Z',
      title: 'Golf round: National Golf Club',
    },
    {
      ...readModels.timeline[0]!,
      endsAt: '2026-10-10T08:20:00.000Z',
      eventId: 'evt_sueno',
      id: 'iti_sueno',
      startsAt: '2026-10-10T06:20:00.000Z',
      title: 'Golf round: Sueno Hotels Golf Belek',
    },
  ];

  const octoberNine = eventHubModelFromReadModels({
    now: new Date('2026-10-04T08:00:00.000Z'),
    phase: 'cached',
    selectedDateId: '2026-10-09',
    snapshot: readModels,
    syncStatus: null,
  });
  expect(octoberNine.dates.map(date => date.id)).toEqual([
    '2026-10-04',
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
  ]);
  expect(
    octoberNine.dates.find(date => date.id === '2026-10-09')?.selected,
  ).toBe(true);
  expect(octoberNine.timeline.map(item => item.title)).toEqual([
    'Golf round: National Golf Club',
  ]);

  const octoberTen = eventHubModelFromReadModels({
    now: new Date('2026-10-04T08:00:00.000Z'),
    phase: 'cached',
    selectedDateId: '2026-10-10',
    snapshot: readModels,
    syncStatus: null,
  });
  expect(
    octoberTen.dates.find(date => date.id === '2026-10-10')?.selected,
  ).toBe(true);
  expect(octoberTen.timeline.map(item => item.title)).toEqual([
    'Golf round: Sueno Hotels Golf Belek',
  ]);
});

test('resolves private draft review only for owners and organizers, never published or viewer roots', () => {
  const ownerDraft = snapshot(accountA, rootA, 'Privater Entwurf', 'owner');
  ownerDraft.root.status = 'draft';
  ownerDraft.timeline = [];
  const draftModel = eventHubModelFromReadModels({
    now: new Date('2026-07-18T12:00:00.000Z'),
    phase: 'cached',
    selectedDateId: null,
    snapshot: ownerDraft,
    syncStatus: null,
  });
  expect(draftModel.status).toBe('draft');
  expect(draftModel.primaryAction).toEqual({
    access: 'write',
    accessibilityLabel: 'Event prüfen. Privater Entwurf.',
    id: 'review-event',
    label: 'Event prüfen',
  });

  const publishedOwner = snapshot(accountA, rootA, 'Veröffentlicht', 'owner');
  publishedOwner.timeline = [];
  const publishedModel = eventHubModelFromReadModels({
    now: new Date('2026-07-18T12:00:00.000Z'),
    phase: 'cached',
    selectedDateId: null,
    snapshot: publishedOwner,
    syncStatus: null,
  });
  expect(publishedModel.status).toBe('published');
  expect(publishedModel.primaryAction).toBeNull();

  const viewerDraft = snapshot(
    accountA,
    rootA,
    'Verborgener Entwurf',
    'viewer',
  );
  viewerDraft.root.status = 'draft';
  viewerDraft.timeline = [];
  const viewerModel = eventHubModelFromReadModels({
    now: new Date('2026-07-18T12:00:00.000Z'),
    phase: 'cached',
    selectedDateId: null,
    snapshot: viewerDraft,
    syncStatus: null,
  });
  expect(viewerModel.primaryAction).toBeNull();
});

test('opens the real private-draft review and publish route', async () => {
  const draft = snapshot(accountA, rootA, 'Neuer Team-Entwurf', 'owner');
  draft.root.status = 'draft';
  draft.timeline = [];
  draft.feed = [];
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store: storeFor(draft),
      sync: { syncRoot: jest.fn(async () => syncStatus()) },
    },
  };
  const navigate = jest.fn();
  const renderer = await renderScreen(rootA, true, navigate);

  const review = renderer.root.findByProps({
    testID: 'event-hub-primary-action',
  });
  await ReactTestRenderer.act(() => review.props.onPress());
  expect(navigate).toHaveBeenCalledWith('EventPublish', {
    rootEventId: rootA,
  });
  expect(Alert.alert).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('uses only the root-scoped offline directory for participant and feed names', () => {
  const readModels = snapshot(accountA, rootA, 'Named Event');
  const namedUser = `usr_${'c'.repeat(32)}`;
  readModels.directory = [{ userId: namedUser, displayName: 'Mara Frei' }];
  readModels.memberships = [
    ...readModels.memberships,
    {
      ...readModels.membership,
      memberUserId: namedUser,
      role: 'participant',
    },
  ];
  readModels.feed = [{ ...readModels.feed[0]!, actorUserId: namedUser }];
  const model = eventHubModelFromReadModels({
    now: new Date('2026-07-18T12:00:00.000Z'),
    phase: 'cached',
    selectedDateId: null,
    snapshot: readModels,
    syncStatus: null,
  });

  expect(model.participants).toEqual([
    { id: accountA, name: 'Du' },
    { id: namedUser, name: 'Mara Frei' },
  ]);
  expect(model.participantsAccessibilityLabel).toContain('Du, Mara Frei');
  expect(model.feedUpdate?.author).toBe('Mara Frei');
});

test('makes route, date, sync, timeline and unfinished-tab callbacks safe', async () => {
  const store = storeFor(snapshot(accountA, rootA, 'Interaktive Reise'));
  const syncRoot = jest.fn(async () => syncStatus());
  mockPrivateDatabase = {
    accountId: accountA,
    database: { store, sync: { syncRoot } },
  };
  const navigate = jest.fn();
  const renderer = await renderScreen(rootA, true, navigate);

  const timeline = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      String(node.props.accessibilityLabel).includes('Welcome Dinner'),
  );
  await ReactTestRenderer.act(async () => timeline.props.onPress());
  expect(Alert.alert).toHaveBeenCalledWith(
    'Welcome Dinner',
    expect.stringContaining('noch nicht verfügbar'),
  );

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-hub-date-2026-09-21' })
      .props.onPress();
  });
  expect(
    renderer.root.findByProps({ testID: 'event-hub-date-2026-09-21' }).props
      .accessibilityState,
  ).toMatchObject({ selected: true });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-hub-sync-button' })
      .props.onPress();
    await flush();
  });
  expect(syncRoot).toHaveBeenLastCalledWith(accountA, rootA, { force: true });

  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'event-hub-tab-feed' }).props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('TeamFeed', {
    eventId: null,
    rootEventId: rootA,
  });

  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'event-hub-tab-more' }).props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('CommunityFeedbackList', {
    rootEventId: rootA,
  });

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-hub-primary-action' })
      .props.onPress();
    await flush();
  });
  expect(Linking.openURL).toHaveBeenCalledWith(
    expect.stringMatching(/^(maps|geo):/),
  );

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('opens a synced golf itinerary on the production scorecard route with its real event scope', async () => {
  const readModels = snapshot(accountA, rootA, 'Golfreise');
  readModels.timeline = [
    {
      ...readModels.timeline[0]!,
      detailsJson: JSON.stringify({ schemaVersion: 1, type: 'golf_round' }),
      eventId: 'evt_carya_round_one',
      id: 'iti_carya_round_one',
      title: '1. Runde · Carya Golf Club',
    },
  ];
  mockPrivateDatabase = {
    accountId: accountA,
    database: {
      store: storeFor(readModels),
      sync: { syncRoot: jest.fn(async () => syncStatus()) },
    },
  };
  const navigate = jest.fn();
  const renderer = await renderScreen(rootA, true, navigate);
  const round = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      String(node.props.accessibilityLabel).includes('Carya Golf Club'),
  );
  await ReactTestRenderer.act(async () => round.props.onPress());
  expect(navigate).toHaveBeenCalledWith('GolfScorecard', {
    eventId: 'evt_carya_round_one',
    rootEventId: rootA,
  });
  expect(Alert.alert).not.toHaveBeenCalledWith(
    '1. Runde · Carya Golf Club',
    expect.any(String),
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderScreen(
  rootEventId: string,
  settle = true,
  navigate = jest.fn(),
) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(rootEventId, navigate));
    if (settle) await flush();
  });
  return renderer;
}

function screen(rootEventId: string, navigate = jest.fn()) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventHubScreen
        navigation={{ navigate } as never}
        route={{ name: 'EventInbound', params: { rootEventId } } as never}
      />
    </SafeAreaProvider>
  );
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}

function storeFor(readModels: EventHubReadSnapshot | null) {
  return {
    getRootSyncState: jest.fn(async () => readModels?.syncState ?? null),
    listEventTree: jest.fn(
      async (): Promise<readonly EventRecord[]> =>
        readModels ? [readModels.root] : [],
    ),
    listFeed: jest.fn(async () => readModels?.feed ?? []),
    listMemberships: jest.fn(async () => readModels?.memberships ?? []),
    listTimeline: jest.fn(async () => readModels?.timeline ?? []),
  };
}

function snapshot(
  accountUserId: string,
  rootEventId: string,
  title: string,
  role: MembershipRecord['role'] = 'participant',
): EventHubReadSnapshot {
  const root: EventRecord = {
    accountUserId,
    childOrderVersion: '1',
    createdAt: '2026-07-18T09:00:00.000Z',
    deletedAt: null,
    description: null,
    endsAt: '2026-09-24T18:00:00.000Z',
    id: rootEventId,
    itineraryOrderVersion: '1',
    kind: 'trip',
    parentEventId: null,
    rootEventId,
    sortKey: '1',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-18T12:00:00.000Z',
    version: 1,
  };
  const membership: MembershipRecord = {
    accountUserId,
    createdAt: '2026-07-18T09:00:00.000Z',
    memberUserId: accountUserId,
    role,
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-18T12:00:00.000Z',
    version: 1,
  };
  const timeline: ItineraryRecord[] = [
    {
      accountUserId,
      allDay: false,
      createdAt: '2026-07-18T09:00:00.000Z',
      deletedAt: null,
      detailsJson: JSON.stringify({ schemaVersion: 1, type: 'meal' }),
      detailsSchemaVersion: 1,
      endsAt: '2026-09-20T18:30:00.000Z',
      eventId: rootEventId,
      id: 'iti_welcome',
      notes: null,
      placeId: 'plc_hotel',
      placeSnapshotJson: JSON.stringify({
        countryCode: 'TR',
        id: 'plc_hotel',
        latitude: 36.86,
        locality: 'Belek',
        longitude: 31.05,
        name: 'Hotellobby',
      }),
      rootEventId,
      sortKey: '1',
      startsAt: '2026-09-20T16:30:00.000Z',
      status: 'active',
      timeZone: 'Europe/Zurich',
      title: 'Welcome Dinner',
      updatedAt: '2026-07-18T12:00:00.000Z',
      version: 1,
    },
  ];
  const feed: FeedRecord[] = [
    {
      accountUserId,
      actorUserId: accountUserId,
      createdAt: '2026-07-18T11:30:00.000Z',
      createdRootRevision: '2',
      deletedAt: null,
      eventId: rootEventId,
      id: 'fed_update',
      kind: 'message',
      parentEntryId: null,
      payloadJson: JSON.stringify({ text: 'hat den Transfer aktualisiert' }),
      payloadSchemaVersion: 1,
      revisionOrdinal: 1,
      rootEventId,
      rootRevision: '2',
      updatedAt: '2026-07-18T11:30:00.000Z',
      version: 1,
    },
  ];
  const syncState: RootSyncState = {
    accountUserId,
    authorizationScopeVersion: '1',
    lastCompletedSyncAt: '2026-07-18T12:00:00.000Z',
    pullCursor: 'cursor',
    rootEventId,
    snapshotId: 'snapshot',
    snapshotRevision: '2',
  };
  return {
    feed,
    membership,
    memberships: [membership],
    root,
    syncState,
    timeline,
  };
}

function syncStatus() {
  return {
    attentionCount: 0,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'synced' as const,
    summary: 'All changes saved',
  };
}
