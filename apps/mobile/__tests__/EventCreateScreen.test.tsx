import {
  ActorEventRootIndexStore,
  MobileSyncEngine,
  type RootCreateCommand,
} from '@crew/mobile-data';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  buildRootCreateCommand,
  EventCreateScreen,
  eventCreateOptions,
} from '../src/screens/EventCreateScreen';
import type { EventCreateOption } from '../src/screens/EventCreateView';
import { secureDeviceIdStore } from '../src/storage/deviceIdentity';
import { secureUuidV4 } from '../src/storage/secureRandom';

const accountId = `usr_${'a'.repeat(32)}`;
const changedAccountId = `usr_${'b'.repeat(32)}`;
const deviceId = 'dvc_00000000-0000-4000-8000-000000000099';
const mockGateway = { request: jest.fn() };
const mockEngine = {
  enqueueRootCreate: jest.fn(),
  listRootCreations: jest.fn(),
  reviseFailedRootCreate: jest.fn(),
  retryExhausted: jest.fn(),
  syncRoot: jest.fn(),
};
const mockIndex = {
  get: jest.fn(),
  refresh: jest.fn(),
  select: jest.fn(),
};
const mockLifecycle = {
  accountId,
  reloadSession: jest.fn(async () => undefined),
  status: 'ready' as const,
};
const mockPrivateDatabase = { accountId, database: { name: 'private-db' } };
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  replace: jest.fn(),
};
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    ActorEventRootIndexStore: jest.fn(() => mockIndex),
    MobileSyncEngine: jest.fn(() => mockEngine),
  };
});

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGateway,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('../src/storage/deviceIdentity', () => ({
  secureDeviceIdStore: { getOrCreate: jest.fn() },
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  mockEngine.listRootCreations.mockResolvedValue([]);
  mockEngine.enqueueRootCreate.mockResolvedValue({});
  mockEngine.reviseFailedRootCreate.mockResolvedValue({});
  mockEngine.retryExhausted.mockResolvedValue(undefined);
  mockEngine.syncRoot.mockResolvedValue(syncedStatus());
  mockIndex.refresh.mockResolvedValue(undefined);
  mockIndex.get.mockResolvedValue({ rootEventId: 'present' });
  mockIndex.select.mockResolvedValue(undefined);
  jest.mocked(secureDeviceIdStore.getOrCreate).mockResolvedValue(deviceId);
  jest.mocked(secureUuidV4).mockReset();
  mockGateway.request.mockImplementation(async operationId => {
    if (operationId === 'eventTemplatesList') {
      return gatewayResponse({ templates: apiTemplates() });
    }
    throw new Error(`Unexpected direct operation ${operationId}`);
  });
});

test('creates a server-provided template once, persists it first and lands on the exact validated root', async () => {
  mockUuidSequence(1, 2, 3);
  const renderer = await renderScreen();
  expect(MobileSyncEngine).toHaveBeenCalledWith(
    mockPrivateDatabase.database,
    mockGateway,
    expect.objectContaining({
      activeAccountUserId: expect.any(Function),
      randomUUID: secureUuidV4,
    }),
  );
  expect(mockGateway.request).toHaveBeenCalledWith('eventTemplatesList', {
    signal: expect.any(AbortSignal),
  });

  await chooseOption(renderer, 'team-event');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-title' })
      .props.onChangeText('  Sommer-Offsite  '),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-description' })
      .props.onChangeText(' Gemeinsam planen. '),
  );
  const submit = renderer.root.findByProps({ testID: 'event-create-submit' });
  await ReactTestRenderer.act(async () => {
    submit.props.onPress();
    submit.props.onPress();
    await flush();
  });

  const rootEventId = `evt_${uuid(1)}`;
  expect(mockEngine.enqueueRootCreate).toHaveBeenCalledTimes(1);
  expect(mockEngine.enqueueRootCreate).toHaveBeenCalledWith(
    accountId,
    deviceId,
    {
      description: 'Gemeinsam planen.',
      endsAt: null,
      id: rootEventId,
      kind: 'team_event',
      startsAt: null,
      status: 'draft',
      template: {
        eventIds: {
          activity: `evt_${uuid(3)}`,
          agenda: `evt_${uuid(2)}`,
          root: rootEventId,
        },
        id: 'team-event',
        version: 1,
      },
      timeZone: expect.any(String),
      title: 'Sommer-Offsite',
    },
    {
      kind: 'team_event',
      timeZone: expect.any(String),
      title: 'Sommer-Offsite',
    },
  );
  expect(mockEngine.syncRoot).toHaveBeenCalledWith(accountId, rootEventId, {
    force: false,
  });
  expect(ActorEventRootIndexStore).toHaveBeenCalledWith(
    mockPrivateDatabase.database,
    mockGateway,
    expect.objectContaining({ activeAccountUserId: expect.any(Function) }),
  );
  expect(mockIndex.select).toHaveBeenCalledWith(accountId, rootEventId);
  expect(mockNavigation.replace).toHaveBeenCalledWith('EventInbound', {
    rootEventId,
  });
  expect(
    mockGateway.request.mock.calls.map(([operationId]) => operationId),
  ).toEqual(['eventTemplatesList']);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('resumes the durable root creation after restart without enqueuing or loading fixtures', async () => {
  const rootEventId = 'evt_restart_root';
  mockEngine.listRootCreations.mockResolvedValue([
    pendingCreation(rootEventId, 'Wiederaufgenommener Entwurf'),
  ]);
  const renderer = await renderScreen();

  expect(mockEngine.enqueueRootCreate).not.toHaveBeenCalled();
  expect(mockGateway.request).not.toHaveBeenCalled();
  expect(mockEngine.syncRoot).toHaveBeenCalledWith(accountId, rootEventId, {
    force: false,
  });
  expect(mockNavigation.replace).toHaveBeenCalledWith('EventInbound', {
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the same queued blank root across a network retry and never duplicates enqueue', async () => {
  mockUuidSequence(10);
  mockEngine.syncRoot
    .mockResolvedValueOnce(waitingStatus())
    .mockResolvedValueOnce(syncedStatus());
  const renderer = await renderScreen();
  await chooseOption(renderer, 'blank');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-title' })
      .props.onChangeText('Offline Crew'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-create-submit' })
      .props.onPress();
    await flush();
  });

  expect(textInside(renderer)).toContain(
    'Entwurf lokal gespeichert. Wartet auf Verbindung.',
  );
  const rootEventId = `evt_${uuid(10)}`;
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'event-create-retry' }).props.onPress();
    await flush();
  });

  expect(mockEngine.enqueueRootCreate).toHaveBeenCalledTimes(1);
  expect(mockEngine.retryExhausted).toHaveBeenCalledWith(
    accountId,
    rootEventId,
  );
  expect(mockEngine.syncRoot).toHaveBeenNthCalledWith(
    1,
    accountId,
    rootEventId,
    { force: false },
  );
  expect(mockEngine.syncRoot).toHaveBeenNthCalledWith(
    2,
    accountId,
    rootEventId,
    { force: true },
  );
  expect(mockNavigation.replace).toHaveBeenCalledWith('EventInbound', {
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('reviews a rejected template with preserved fields and replaces the immutable row before sync', async () => {
  const rootEventId = 'evt_rejected_template';
  const failed = rejectedCreation(rootEventId);
  mockEngine.listRootCreations.mockResolvedValue([failed]);
  mockUuidSequence(61, 62);
  const renderer = await renderScreen();

  expect(mockEngine.syncRoot).not.toHaveBeenCalled();
  expect(
    renderer.root.findAllByProps({ testID: 'event-create-retry' }),
  ).toEqual([]);
  expect(textInside(renderer)).toContain(
    'Deine Angaben bleiben lokal gespeichert',
  );

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-create-review' })
      .props.onPress();
    await flush();
  });
  expect(mockGateway.request).toHaveBeenCalledWith('eventTemplatesList', {
    signal: expect.any(AbortSignal),
  });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-use-option' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ testID: 'event-create-title' }).props.value,
  ).toBe('Alter Team-Entwurf');
  expect(
    renderer.root.findByProps({ testID: 'event-create-description' }).props
      .value,
  ).toBe('Bleibt lokal erhalten.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-title' })
      .props.onChangeText('Geprüfter Team-Entwurf'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-create-submit' })
      .props.onPress();
    await flush();
  });

  expect(mockEngine.enqueueRootCreate).not.toHaveBeenCalled();
  expect(secureDeviceIdStore.getOrCreate).not.toHaveBeenCalled();
  expect(mockEngine.reviseFailedRootCreate).toHaveBeenCalledWith(
    accountId,
    failed.clientMutationId,
    {
      description: 'Bleibt lokal erhalten.',
      endsAt: null,
      id: rootEventId,
      kind: 'team_event',
      startsAt: null,
      status: 'draft',
      template: {
        eventIds: {
          activity: `evt_${uuid(62)}`,
          agenda: `evt_${uuid(61)}`,
          root: rootEventId,
        },
        id: 'team-event',
        version: 1,
      },
      timeZone: 'Europe/Zurich',
      title: 'Geprüfter Team-Entwurf',
    },
    {
      kind: 'team_event',
      timeZone: 'Europe/Zurich',
      title: 'Geprüfter Team-Entwurf',
    },
  );
  expect(mockNavigation.replace).toHaveBeenCalledWith('EventInbound', {
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not navigate or leak a root when the active account changes mid-sync', async () => {
  mockUuidSequence(20);
  let resolveSync!: (value: ReturnType<typeof syncedStatus>) => void;
  mockEngine.syncRoot.mockReturnValue(
    new Promise(resolve => {
      resolveSync = resolve;
    }),
  );
  const renderer = await renderScreen();
  await chooseOption(renderer, 'blank');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-title' })
      .props.onChangeText('Kontowechsel'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-create-submit' })
      .props.onPress();
    await waitUntil(() => mockEngine.syncRoot.mock.calls.length === 1);
  });

  mockLifecycle.accountId = changedAccountId;
  await ReactTestRenderer.act(async () => {
    renderer.update(screen());
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    resolveSync(syncedStatus());
    await flush();
  });
  expect(mockNavigation.replace).not.toHaveBeenCalled();
  expect(mockIndex.select).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('uses controlled German copy for all three API templates and builds no invented blank template', () => {
  const options = eventCreateOptions(apiTemplates());
  expect(
    options.map(({ id, summary, title }) => ({ id, summary, title })),
  ).toEqual([
    {
      id: 'travel',
      summary: 'Anreise, Unterkunft und gemeinsamer Transport.',
      title: 'Reise',
    },
    {
      id: 'golf-tour',
      summary: 'Reise, Unterkunft, Transfers, Golfplätze und Runden.',
      title: 'Golfreise',
    },
    {
      id: 'team-event',
      summary: 'Ort, Agenda, Aktivitäten und Teameinteilung.',
      title: 'Team-Event',
    },
    {
      id: 'blank',
      summary:
        'Ein leerer Entwurf. Struktur, Termine und Inhalte ergänzt du später.',
      title: 'Leeres Event',
    },
  ]);
  const blank = options.at(-1) as EventCreateOption;
  const command = buildRootCreateCommand(
    blank,
    '  Leer  ',
    '   ',
    'Europe/Zurich',
    () => uuid(50),
  );
  expect(command).toEqual({
    description: null,
    endsAt: null,
    id: `evt_${uuid(50)}`,
    kind: 'other',
    startsAt: null,
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title: 'Leer',
  });
  expect(command).not.toHaveProperty('template');
});

test('maps every API template root exactly and gives each child a unique event ID', () => {
  const templateOptions = eventCreateOptions(apiTemplates()).filter(
    option => option.kind === 'template',
  );

  templateOptions.forEach((option, templateIndex) => {
    const rootEventId = `evt_${uuid(100 + templateIndex * 10)}`;
    let childIndex = 1;
    const command = buildRootCreateCommand(
      option,
      option.title,
      '',
      'Europe/Zurich',
      () => uuid(100 + templateIndex * 10 + childIndex++),
      rootEventId,
    );
    const eventIds = command.template?.eventIds;

    expect(eventIds).toBeDefined();
    expect(Object.keys(eventIds ?? {})).toEqual(option.logicalKeys);
    expect(eventIds?.root).toBe(rootEventId);
    const ids = Object.values(eventIds ?? {});
    expect(new Set(ids).size).toBe(ids.length);
    for (const logicalKey of option.logicalKeys) {
      expect(eventIds?.[logicalKey]).toMatch(
        /^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      if (logicalKey !== 'root') {
        expect(eventIds?.[logicalKey]).not.toBe(rootEventId);
      }
    }
  });
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen());
    await flush();
  });
  return renderer;
}

function screen() {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventCreateScreen
        navigation={mockNavigation as never}
        route={{ name: 'CreateEvent' } as never}
      />
    </SafeAreaProvider>
  );
}

async function chooseOption(
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: EventCreateOption['id'],
) {
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: `event-create-option-${id}` })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-use-option' })
      .props.onPress(),
  );
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return JSON.stringify(renderer.toJSON());
}

async function flush() {
  for (let pass = 0; pass < 6; pass += 1) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

async function waitUntil(predicate: () => boolean) {
  for (let pass = 0; pass < 20; pass += 1) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for controller state');
}

function mockUuidSequence(...values: number[]) {
  for (const value of values) {
    jest.mocked(secureUuidV4).mockReturnValueOnce(uuid(value));
  }
}

function uuid(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
}

function apiTemplates() {
  return [
    template('travel', 'trip', ['root', 'arrival', 'lodging']),
    template('golf-tour', 'trip', ['root', 'arrival', 'lodging', 'round']),
    template('team-event', 'team_event', ['root', 'agenda', 'activity']),
  ];
}

function template(
  id: 'golf-tour' | 'team-event' | 'travel',
  kind: 'team_event' | 'trip',
  logicalKeys: readonly string[],
) {
  return {
    events: logicalKeys.map((logicalKey, index) => ({
      capabilities: [],
      kind:
        logicalKey === 'round'
          ? ('golf' as const)
          : logicalKey === 'agenda'
          ? ('session' as const)
          : logicalKey === 'activity'
          ? ('activity' as const)
          : index === 0
          ? kind
          : ('day' as const),
      logicalKey,
      parentLogicalKey: index === 0 ? null : 'root',
      title: logicalKey,
    })),
    id,
    summary: `${id} summary`,
    title: id,
    version: 1 as const,
  };
}

function gatewayResponse<Data>(data: Data) {
  return { data, requestId: 'req_creation_test', status: 200 };
}

function pendingCreation(rootEventId: string, title: string) {
  return {
    command: {
      id: rootEventId,
      kind: 'other',
      timeZone: 'Europe/Zurich',
      title,
    } satisfies RootCreateCommand,
    operationId: 'eventsCreate',
    rootEventId,
    state: 'pending',
  };
}

function rejectedCreation(rootEventId: string) {
  return {
    accountUserId: accountId,
    appliedRootRevision: null,
    attempts: 1,
    clientMutationId: '00000000-0000-4000-8000-000000000777',
    clientSequence: 0,
    command: {
      description: 'Bleibt lokal erhalten.',
      endsAt: null,
      id: rootEventId,
      kind: 'team_event',
      startsAt: null,
      status: 'draft',
      template: {
        eventIds: {
          activity: 'evt_old_activity',
          agenda: 'evt_old_agenda',
          root: rootEventId,
        },
        id: 'team-event',
        version: 2,
      },
      timeZone: 'Europe/Zurich',
      title: 'Alter Team-Entwurf',
    } satisfies RootCreateCommand,
    createdAt: '2026-07-19T12:00:00.000Z',
    deviceId,
    lastError: {
      authoritativeOrder: null,
      code: 'invalid',
      currentVersion: null,
      requestId: 'req_rejected_template',
    },
    nextAttemptAt: null,
    operationId: 'eventsCreate' as const,
    optimisticOverlay: { title: 'Alter Team-Entwurf' },
    rootEventId,
    serverConsumed: false,
    state: 'dead_letter' as const,
    updatedAt: '2026-07-19T12:00:01.000Z',
  };
}

function syncedStatus() {
  return {
    attentionCount: 0,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'synced' as const,
    summary: 'All changes saved',
  };
}

function waitingStatus() {
  return {
    attentionCount: 0,
    nextAttemptAt: '2026-07-19T12:01:00.000Z',
    pendingCount: 1,
    state: 'waiting_retry' as const,
    summary: 'Waiting to retry',
  };
}
