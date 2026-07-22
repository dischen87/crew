import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  EventSetupRecoveryConflictError,
  EventSetupRecoveryConnectionError,
  type EventSetupRecoverySnapshot,
} from '../src/screens/EventSetupRecoveryRuntime';
import { EventSetupRecoveryScreen } from '../src/screens/EventSetupRecoveryScreen';

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_setup_root';
const roundEventId = 'evt_setup_round';
const mockGatewayClient = {};
let mockOnline = true;
let mockPrivateDatabase: { accountId: string; database: object };
let mockLifecycle: {
  accountId: string | null;
  reloadSession: jest.Mock;
  replaceSession: jest.Mock;
  status: 'ready';
};
let mockRuntime: {
  adoptTemplate: jest.Mock;
  bindPrimaryPlace: jest.Mock;
  loadCached: jest.Mock;
  refresh: jest.Mock;
  restoreCapability: jest.Mock;
  searchPlaces: jest.Mock;
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('../src/screens/EventSetupRecoveryRuntime', () => {
  const actual = jest.requireActual('../src/screens/EventSetupRecoveryRuntime');
  return {
    ...actual,
    EventSetupRecoveryRuntime: jest.fn().mockImplementation(() => mockRuntime),
  };
});

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockPrivateDatabase = { accountId: accountA, database: {} };
  mockLifecycle = {
    accountId: accountA,
    reloadSession: jest.fn(async () => undefined),
    replaceSession: jest.fn(async () => undefined),
    status: 'ready',
  };
  mockRuntime = {
    adoptTemplate: jest.fn(),
    bindPrimaryPlace: jest.fn(),
    loadCached: jest.fn(async () => null),
    refresh: jest.fn(async () => snapshot()),
    restoreCapability: jest.fn(async () => resolvedSnapshot()),
    searchPlaces: jest.fn(),
  };
});

test('shows only the account-scoped cached context while offline', async () => {
  mockOnline = false;
  mockRuntime.loadCached.mockResolvedValue(snapshot('cached'));
  const { renderer } = await renderScreen();

  expect(textInside(renderer)).toContain('Nur sichere Offline-Kopie');
  expect(textInside(renderer)).toContain('Turkey Golf Tour');
  expect(mockRuntime.refresh).not.toHaveBeenCalled();
  expect(
    renderer.root.findAllByProps({ testID: 'event-setup-primary-action' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps an online cached fallback untrusted and ignores its stale mutation control', async () => {
  const cached = templateSnapshot('cached');
  mockRuntime.loadCached.mockResolvedValue(cached);
  mockRuntime.refresh.mockRejectedValue(
    new EventSetupRecoveryConnectionError(),
  );
  const { renderer } = await renderScreen('EVENT_TEMPLATE_REQUIRED');

  expect(textInside(renderer)).toContain('Serverstand nicht bestätigt');
  const staleOption = renderer.root.findByProps({
    testID: 'event-setup-template-golf-tour',
  });
  expect(staleOption.props.disabled).toBe(true);
  await ReactTestRenderer.act(() => staleOption.props.onPress?.());
  expect(mockRuntime.adoptTemplate).not.toHaveBeenCalled();

  const primary = renderer.root
    .findAllByProps({ testID: 'event-setup-primary-action' })
    .find(node => node.props.label === 'Erneut online prüfen');
  expect(primary).toBeTruthy();
  await ReactTestRenderer.act(async () => {
    primary?.props.onPress();
    await flush();
  });
  expect(mockRuntime.refresh).toHaveBeenCalledTimes(2);
  expect(mockRuntime.adoptTemplate).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('locks a double restore and ignores Back until the mutation settles', async () => {
  const restoration = deferred<EventSetupRecoverySnapshot>();
  mockRuntime.refresh.mockResolvedValue(snapshot());
  mockRuntime.restoreCapability.mockReturnValue(restoration.promise);
  const { navigation, renderer } = await renderScreen();
  const primary = renderer.root.findByProps({
    testID: 'event-setup-primary-action',
  });
  const back = renderer.root.findByProps({ testID: 'event-setup-back-action' });

  await ReactTestRenderer.act(() => {
    primary.props.onPress();
    primary.props.onPress();
    back.props.onPress();
  });
  expect(mockRuntime.restoreCapability).toHaveBeenCalledTimes(1);
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(navigation.navigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    restoration.resolve(resolvedSnapshot());
    await flush();
  });
  expect(textInside(renderer)).toContain('Stand passt');
  expect(textInside(renderer)).toContain('Serverstand bestätigt');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('reports another client resolving the blocker without claiming our action succeeded', async () => {
  mockRuntime.refresh
    .mockResolvedValueOnce(snapshot())
    .mockResolvedValueOnce(resolvedSnapshot());
  mockRuntime.restoreCapability.mockRejectedValue(
    new EventSetupRecoveryConflictError(),
  );
  const { renderer } = await renderScreen();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-setup-primary-action' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain(
    'Serverstand meldet diesen Prüfpunkt nicht mehr als offen',
  );
  expect(textInside(renderer)).not.toContain(
    'Serverstand bestätigt die Änderung',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps an authoritative active blocker after a version conflict', async () => {
  mockRuntime.refresh.mockResolvedValue(snapshot());
  mockRuntime.restoreCapability.mockRejectedValue(
    new EventSetupRecoveryConflictError(),
  );
  const { renderer } = await renderScreen();

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-setup-primary-action' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain(
    'Serverstand hat sich geändert. Prüfe den aktuellen Stand und versuche es erneut.',
  );
  expect(textInside(renderer)).not.toContain(
    'Serverstand meldet diesen Prüfpunkt nicht mehr als offen',
  );
  expect(
    renderer.root
      .findAllByProps({ testID: 'event-setup-primary-action' })
      .some(node => node.props.label === 'Setup ergänzen'),
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals the old account immediately and drops its stale action', async () => {
  const old = snapshot();
  old.eventTitle = 'Altes geheimes Event';
  mockRuntime.loadCached.mockResolvedValue(old);
  mockRuntime.refresh.mockResolvedValue(old);
  const rendered = await renderScreen();
  const stalePress = rendered.renderer.root.findByProps({
    testID: 'event-setup-primary-action',
  }).props.onPress;
  expect(textInside(rendered.renderer)).toContain('Altes geheimes Event');

  mockLifecycle = { ...mockLifecycle, accountId: accountB };
  mockPrivateDatabase = { accountId: accountB, database: {} };
  mockRuntime.loadCached.mockImplementation(() => new Promise(() => {}));
  mockRuntime.refresh.mockImplementation(() => new Promise(() => {}));
  mockRuntime.restoreCapability.mockClear();
  await ReactTestRenderer.act(() => {
    rendered.renderer.update(screen(rendered.navigation));
  });

  expect(textInside(rendered.renderer)).toContain('Setup wird geladen');
  expect(textInside(rendered.renderer)).not.toContain('Altes geheimes Event');
  await ReactTestRenderer.act(() => stalePress());
  expect(mockRuntime.restoreCapability).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => rendered.renderer.unmount());
});

test('refetches authoritative setup when the recovery route regains focus', async () => {
  const { focusListeners, renderer } = await renderScreen();
  expect(mockRuntime.refresh).toHaveBeenCalledTimes(1);
  expect(focusListeners).toHaveLength(1);

  await ReactTestRenderer.act(async () => {
    focusListeners[0]?.();
    await flush();
  });
  expect(mockRuntime.refresh).toHaveBeenCalledTimes(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderScreen(
  blocker:
    | 'EVENT_CAPABILITY_REQUIRED'
    | 'EVENT_TEMPLATE_REQUIRED' = 'EVENT_CAPABILITY_REQUIRED',
) {
  const focusListeners: Array<() => void> = [];
  const navigation = {
    addListener: jest.fn((event: string, listener: () => void) => {
      if (event === 'focus') focusListeners.push(listener);
      return jest.fn();
    }),
    canGoBack: jest.fn(() => true),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(navigation, blocker));
    await flush();
  });
  return { focusListeners, navigation, renderer };
}

function screen(
  navigation?: object,
  blocker:
    | 'EVENT_CAPABILITY_REQUIRED'
    | 'EVENT_TEMPLATE_REQUIRED' = 'EVENT_CAPABILITY_REQUIRED',
) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventSetupRecoveryScreen
        navigation={
          (navigation ?? {
            addListener: jest.fn(() => jest.fn()),
            canGoBack: jest.fn(() => true),
            goBack: jest.fn(),
            navigate: jest.fn(),
          }) as never
        }
        route={
          {
            params: {
              blocker,
              capabilityType:
                blocker === 'EVENT_CAPABILITY_REQUIRED' ? 'golf' : undefined,
              eventId:
                blocker === 'EVENT_CAPABILITY_REQUIRED'
                  ? roundEventId
                  : undefined,
              rootEventId,
            },
          } as never
        }
      />
    </SafeAreaProvider>
  );
}

function snapshot(
  source: EventSetupRecoverySnapshot['source'] = 'online',
): EventSetupRecoverySnapshot {
  return {
    blockerActive: true,
    checkedAt: '2026-07-19T12:00:00.000Z',
    eventTitle: 'Turkey Golf Tour',
    intent: {
      capabilityType: 'golf',
      code: 'EVENT_CAPABILITY_REQUIRED',
      eventId: roundEventId,
      rootEventId,
    },
    role: 'owner',
    rootRevision: '12',
    rootVersion: 7,
    source,
    target: {
      capability: null,
      capabilityVersion: 0,
      currentPlaceName: null,
      defaultCapability: golfCapability(),
      eventId: roundEventId,
      eventTitle: '1. Runde',
      type: 'golf',
    },
    template: 'golf-tour',
    templates: [],
  };
}

function templateSnapshot(
  source: EventSetupRecoverySnapshot['source'],
): EventSetupRecoverySnapshot {
  return {
    ...snapshot(source),
    intent: { code: 'EVENT_TEMPLATE_REQUIRED', rootEventId },
    target: null,
    template: null,
    templates: [
      {
        id: 'golf-tour',
        logicalKeys: ['root', 'round'],
        summary: 'Reise, Unterkunft und Golfrunden.',
        title: 'Golf tour',
        version: 1,
      },
    ],
  };
}

function resolvedSnapshot(): EventSetupRecoverySnapshot {
  return { ...snapshot(), blockerActive: false };
}

function golfCapability() {
  return {
    config: {
      coursePlaceId: null,
      handicapMode: 'optional' as const,
      roundState: 'planned' as const,
      scoringMode: 'stableford' as const,
      teeFormat: 'individual' as const,
    },
    schemaVersion: 1 as const,
    type: 'golf' as const,
  };
}

function deferred<Value>() {
  let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
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
