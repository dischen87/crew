import {
  ActorEventRootIndexAccessDeniedError,
  ActorEventRootIndexStore,
} from '@crew/mobile-data';
import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { EventsScreen } from '../src/screens/EventsScreen';

const accountId = `usr_${'a'.repeat(32)}`;
const mockGateway = { request: jest.fn() };
const mockIndex = {
  getState: jest.fn(),
  list: jest.fn(),
  refresh: jest.fn(),
  select: jest.fn(),
};
const mockLifecycle = {
  accountId: accountId as string | null,
  reloadSession: jest.fn(async () => undefined),
  replaceSession: jest.fn(
    async (_session: null, _expectedCurrentAccountId?: string) => undefined,
  ),
  status: 'ready' as 'loading' | 'ready' | 'signedOut' | 'unavailable',
};
const mockPrivateDatabase = { accountId, database: { name: 'private-db' } };
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    ActorEventRootIndexStore: jest.fn(() => mockIndex),
    LocalAttachmentStore: jest.fn(),
  };
});

jest.mock('../src/media/attachmentMedia', () => ({
  reconcileRetainedAttachmentFiles: jest.fn(async () => undefined),
}));

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGateway,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLifecycle.accountId = accountId;
  mockLifecycle.status = 'ready';
  mockPrivateDatabase.accountId = accountId;
  mockLifecycle.replaceSession.mockReset().mockResolvedValue(undefined);
  mockIndex.getState.mockResolvedValue(null);
  mockIndex.list.mockResolvedValue([]);
  mockIndex.refresh.mockResolvedValue(indexState(1));
  mockIndex.select.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('refreshes the durable actor index and persists exact-root selection before navigation', async () => {
  mockIndex.list
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([eventRoot('evt_real_root', 'Reales Event')]);
  const navigate = jest.fn();
  const renderer = await renderScreen(navigate);

  expect(ActorEventRootIndexStore).toHaveBeenCalledWith(
    mockPrivateDatabase.database,
    mockGateway,
    expect.objectContaining({ activeAccountUserId: expect.any(Function) }),
  );
  expect(mockIndex.refresh).toHaveBeenCalledWith(accountId);

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({ testID: 'events-create' }).props.onPress();
  });
  expect(navigate).toHaveBeenCalledWith('CreateEvent');

  const card = renderer.root.findByProps({ testID: 'event-evt_real_root' });
  await ReactTestRenderer.act(async () => {
    card.props.onPress();
    await flush();
  });
  expect(mockIndex.select).toHaveBeenCalledWith(accountId, 'evt_real_root');
  expect(navigate).toHaveBeenCalledWith('EventInbound', {
    rootEventId: 'evt_real_root',
  });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders cached roots first and exposes a functional offline retry', async () => {
  const cached = eventRoot('evt_cached', 'Sicher gespeichert');
  const refreshed = eventRoot('evt_after_retry', 'Nach dem Retry');
  mockIndex.getState.mockResolvedValue(indexState(1));
  mockIndex.list
    .mockResolvedValueOnce([cached])
    .mockResolvedValueOnce([cached])
    .mockResolvedValueOnce([refreshed]);
  mockIndex.refresh
    .mockRejectedValueOnce(new Error('network unavailable'))
    .mockResolvedValueOnce(indexState(2));
  const renderer = await renderScreen(jest.fn());

  expect(
    renderer.root.findByProps({ testID: 'event-evt_cached' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'events-offline-status' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'events-offline-retry' })
      .props.onPress();
    await flush();
  });

  expect(mockIndex.refresh).toHaveBeenCalledTimes(2);
  expect(
    renderer.root.findByProps({ testID: 'event-evt_after_retry' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('drops held roots after authoritative index denial without leaking details', async () => {
  mockIndex.getState.mockResolvedValue(indexState(1));
  mockIndex.list.mockResolvedValue([
    eventRoot('evt_denied', 'Nicht mehr sichtbar'),
  ]);
  mockIndex.refresh.mockRejectedValue(
    new ActorEventRootIndexAccessDeniedError(),
  );
  const renderer = await renderScreen(jest.fn());

  expect(renderer.root.findAllByProps({ testID: 'event-evt_denied' })).toEqual(
    [],
  );
  const copy = renderer.toJSON();
  expect(JSON.stringify(copy)).toContain('Events nicht verfügbar');
  expect(JSON.stringify(copy)).not.toMatch(/403|404|berechtigt|Mitgliedschaft/);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not navigate when the account changes while selection is pending', async () => {
  let resolveSelection!: () => void;
  mockIndex.list
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([eventRoot('evt_pending', 'Wechsel')]);
  mockIndex.select.mockReturnValue(
    new Promise<void>(resolve => {
      resolveSelection = resolve;
    }),
  );
  const navigate = jest.fn();
  const renderer = await renderScreen(navigate);

  await ReactTestRenderer.act(() => {
    renderer.root.findByProps({ testID: 'event-evt_pending' }).props.onPress();
  });
  mockLifecycle.accountId = `usr_${'b'.repeat(32)}`;
  await ReactTestRenderer.act(async () => {
    renderer.update(screen(navigate));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    resolveSelection();
    await flush();
  });
  expect(navigate).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cancels logout without touching the private lifecycle', async () => {
  const renderer = await renderScreen(jest.fn());

  renderer.root.findByProps({ testID: 'events-logout' }).props.onPress();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => logoutButton(0, 'Abbrechen').onPress?.());

  expect(mockLifecycle.replaceSession).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('confirms logout once despite repeated taps and stays loading until signed-out navigation takes over', async () => {
  const renderer = await renderScreen(jest.fn());
  const logout = renderer.root.findByProps({ testID: 'events-logout' });

  logout.props.onPress();
  logout.props.onPress();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => {
    logoutButton(0, 'Abmelden').onPress?.();
    logoutButton(0, 'Abmelden').onPress?.();
    await flush();
  });

  expect(mockLifecycle.replaceSession).toHaveBeenCalledTimes(1);
  expect(mockLifecycle.replaceSession).toHaveBeenCalledWith(null, accountId);
  expect(
    renderer.root.findByProps({ testID: 'events-logout' }).props.loading,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows a safe logout failure and permits one newly confirmed retry', async () => {
  mockLifecycle.replaceSession
    .mockRejectedValueOnce(new Error('secret path /private/account'))
    .mockResolvedValueOnce(undefined);
  const renderer = await renderScreen(jest.fn());

  renderer.root.findByProps({ testID: 'events-logout' }).props.onPress();
  await ReactTestRenderer.act(async () => {
    logoutButton(0, 'Abmelden').onPress?.();
    await flush();
  });

  expect(JSON.stringify(renderer.toJSON())).toContain(
    'Abmelden konnte nicht sicher abgeschlossen werden',
  );
  expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls[1])).not.toMatch(
    /secret|private\/account/,
  );
  const retry = renderer.root.findByProps({ testID: 'events-logout' });
  expect(retry.props.label).toBe('Abmelden erneut versuchen');
  retry.props.onPress();
  await ReactTestRenderer.act(async () => {
    logoutButton(2, 'Abmelden').onPress?.();
    await flush();
  });

  expect(mockLifecycle.replaceSession).toHaveBeenCalledTimes(2);
  expect(mockLifecycle.replaceSession).toHaveBeenNthCalledWith(
    2,
    null,
    accountId,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  [
    'account changes',
    () => (mockLifecycle.accountId = `usr_${'b'.repeat(32)}`),
  ],
  ['lifecycle leaves ready', () => (mockLifecycle.status = 'loading')],
])(
  'fails closed when %s before logout confirmation',
  async (_label, change) => {
    const renderer = await renderScreen(jest.fn());
    renderer.root.findByProps({ testID: 'events-logout' }).props.onPress();
    change();
    await ReactTestRenderer.act(async () => {
      renderer.update(screen(jest.fn()));
      await flush();
    });
    await ReactTestRenderer.act(async () => {
      logoutButton(0, 'Abmelden').onPress?.();
      await flush();
    });

    expect(mockLifecycle.replaceSession).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ testID: 'events-logout' })).toEqual(
      [],
    );
    await ReactTestRenderer.act(() => renderer.unmount());
  },
);

test('fails closed when the private database account changes before logout confirmation', async () => {
  const renderer = await renderScreen(jest.fn());
  renderer.root.findByProps({ testID: 'events-logout' }).props.onPress();

  mockPrivateDatabase.accountId = `usr_${'c'.repeat(32)}`;
  await ReactTestRenderer.act(async () => {
    renderer.update(screen(jest.fn()));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    logoutButton(0, 'Abmelden').onPress?.();
    await flush();
  });

  expect(mockLifecycle.accountId).toBe(accountId);
  expect(mockLifecycle.replaceSession).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByProps({ testID: 'events-logout' })).toEqual([]);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderScreen(navigate: jest.Mock) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(navigate));
    await flush();
  });
  return renderer;
}

function screen(navigate: jest.Mock) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventsScreen
        navigation={{ navigate } as never}
        route={{ name: 'Events' } as never}
      />
    </SafeAreaProvider>
  );
}

async function flush() {
  for (let pass = 0; pass < 4; pass += 1) {
    await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

function logoutButton(call: number, text: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls[call]?.[2] ?? [];
  const button = buttons.find(candidate => candidate.text === text);
  if (!button) throw new Error(`Missing ${text} alert button`);
  return button;
}

function indexState(cacheVersion: number) {
  return {
    accountUserId: accountId,
    cacheVersion,
    refreshedAt: '2026-07-19T12:00:00.000Z',
    schemaVersion: 1 as const,
  };
}

function eventRoot(rootEventId: string, title: string) {
  return {
    createdAt: '2026-07-18T12:00:00Z',
    endsAt: '2026-09-24T18:00:00Z',
    kind: 'trip' as const,
    membershipStatus: 'active' as const,
    role: 'participant' as const,
    rootEventId,
    startsAt: '2026-09-20T08:00:00Z',
    status: 'published' as const,
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-18T12:00:00Z',
    version: 1,
  };
}
