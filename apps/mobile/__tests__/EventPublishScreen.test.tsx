import {
  EventPublishConflictError,
  EventPublishManagerRequiredError,
  EventPublishRootAccessDeniedError,
  type EventPublishSnapshot,
} from '@crew/mobile-data';
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { EventPublishScreen } from '../src/screens/EventPublishScreen';

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_publish_route';
const mockGatewayClient = {};
let mockOnline = true;
let mockPrivateDatabase: { accountId: string; database: object };
let mockLifecycle: {
  accountId: string | null;
  reloadSession: jest.Mock;
  replaceSession: jest.Mock;
  status: 'ready';
};
let mockController: {
  acknowledgeConflict: jest.Mock;
  getCached: jest.Mock;
  publish: jest.Mock;
  refresh: jest.Mock;
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

jest.mock('../src/screens/EventPublishRuntime', () => ({
  EventPublishRuntime: jest.fn().mockImplementation(() => ({
    controller: mockController,
  })),
}));

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
  mockController = {
    acknowledgeConflict: jest.fn(async () => undefined),
    getCached: jest.fn(async () => null),
    publish: jest.fn(),
    refresh: jest.fn(async () => snapshot()),
  };
});

test('uses the account-scoped cached review offline without a network refresh', async () => {
  mockOnline = false;
  mockController.getCached.mockResolvedValue(snapshot());
  const { renderer } = await renderScreen();

  expect(textInside(renderer)).toContain('Offline-Kopie');
  expect(textInside(renderer)).toContain('Crew Retreat');
  expect(mockController.refresh).not.toHaveBeenCalled();
  expect(
    renderer.root.findAllByProps({
      testID: 'event-publish-primary-action',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals the route for non-managers and authoritative missing roots', async () => {
  mockController.getCached.mockRejectedValueOnce(
    new EventPublishManagerRequiredError(),
  );
  const manager = await renderScreen();
  expect(textInside(manager.renderer)).toContain('Prüfung nicht verfügbar');
  expect(textInside(manager.renderer)).not.toContain('Crew Retreat');
  expect(mockController.refresh).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => manager.renderer.unmount());

  mockController.getCached.mockResolvedValueOnce(null);
  mockController.refresh.mockRejectedValueOnce(
    new EventPublishRootAccessDeniedError(),
  );
  const missing = await renderScreen();
  expect(textInside(missing.renderer)).toContain('Sicher verborgen');
  expect(textInside(missing.renderer)).not.toContain(rootEventId);
  await ReactTestRenderer.act(() => missing.renderer.unmount());
});

test('locks double publish, reports confirmed success, and keeps refresh pending truthful', async () => {
  mockController.getCached.mockResolvedValue(snapshot());
  const publication = deferred<{
    event: { title: string };
    refreshPending: boolean;
  }>();
  mockController.publish.mockReturnValue(publication.promise);
  const { renderer } = await renderScreen();
  const primary = renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });

  await ReactTestRenderer.act(() => {
    primary.props.onPress();
    primary.props.onPress();
  });
  expect(mockController.publish).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => {
    publication.resolve({
      event: { title: 'Crew Retreat veröffentlicht' },
      refreshPending: true,
    });
    await flush();
  });
  expect(textInside(renderer)).toContain('Bereit für deine Crew');
  expect(textInside(renderer)).toContain(
    'Der Server hat die Veröffentlichung bestätigt',
  );
  expect(textInside(renderer)).toContain('nächsten Verbindung fortgesetzt');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('recovers a 409 into a durable attempted-versus-current review', async () => {
  const initial = snapshot();
  const conflict = {
    attempted: initial.readiness,
    conflictedAt: '2026-07-19T12:01:00.000Z',
    current: {
      ...initial.readiness,
      ready: false,
      reasons: [
        {
          code: 'EVENT_END_REQUIRED' as const,
          message: 'End required',
          path: 'endsAt',
        },
      ],
      rootRevision: '8',
    },
  };
  const current = { ...initial, conflict, readiness: conflict.current };
  mockController.getCached
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(current);
  mockController.publish.mockRejectedValueOnce(
    new EventPublishConflictError(conflict),
  );
  const { renderer } = await renderScreen();

  const primary = renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });
  await ReactTestRenderer.act(async () => {
    primary.props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain('GEPRÜFTER STAND · REVISION 7');
  expect(textInside(renderer)).toContain('AKTUELLER STAND · REVISION 8');
  expect(textInside(renderer)).toContain('Ende fehlt');
  expect(
    renderer.root.findByProps({ testID: 'event-publish-primary-action' }).props
      .label,
  ).toBe('Änderungen geprüft');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('drops an old-account publish result after the private scope changes', async () => {
  mockController.getCached.mockResolvedValue(snapshot());
  const publication = deferred<{
    event: { title: string };
    refreshPending: boolean;
  }>();
  mockController.publish.mockReturnValue(publication.promise);
  const rendered = await renderScreen();
  const primary = rendered.renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });
  await ReactTestRenderer.act(() => primary.props.onPress());

  mockLifecycle = { ...mockLifecycle, accountId: accountB };
  mockPrivateDatabase = { accountId: accountB, database: {} };
  mockController.getCached.mockRejectedValue(
    new EventPublishManagerRequiredError(),
  );
  await ReactTestRenderer.act(async () => {
    rendered.renderer.update(screen());
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    publication.resolve({
      event: { title: 'Altes Konto veröffentlicht' },
      refreshPending: false,
    });
    await flush();
  });
  expect(textInside(rendered.renderer)).toContain('Prüfung nicht verfügbar');
  expect(textInside(rendered.renderer)).not.toContain('Altes Konto');
  await ReactTestRenderer.act(() => rendered.renderer.unmount());
});

test('fails closed on a scope rerender and ignores a stale review action', async () => {
  const old = snapshot();
  old.eventTitle = 'Altes geheimes Event';
  old.readiness = {
    ...old.readiness,
    ready: false,
    reasons: [
      {
        code: 'EVENT_DESCRIPTION_REQUIRED',
        message: 'Description required',
        path: 'description',
      },
    ],
  };
  mockController.getCached.mockResolvedValue(old);
  mockController.refresh.mockResolvedValue(old);
  const rendered = await renderScreen();
  const stalePrimary = rendered.renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });
  const stalePress = stalePrimary.props.onPress;
  expect(textInside(rendered.renderer)).toContain('Altes geheimes Event');
  expect(textInside(rendered.renderer)).toContain('Beschreibung fehlt');

  mockLifecycle = { ...mockLifecycle, accountId: accountB };
  mockPrivateDatabase = { accountId: accountB, database: {} };
  mockController.getCached.mockImplementation(() => new Promise(() => {}));
  mockController.refresh.mockImplementation(() => new Promise(() => {}));
  mockController.acknowledgeConflict.mockClear();
  mockController.publish.mockClear();
  mockController.refresh.mockClear();
  await ReactTestRenderer.act(() => {
    rendered.renderer.update(screen());
  });

  expect(textInside(rendered.renderer)).toContain('Prüfung wird geladen');
  expect(textInside(rendered.renderer)).not.toContain('Altes geheimes Event');
  expect(textInside(rendered.renderer)).not.toContain('Beschreibung fehlt');
  await ReactTestRenderer.act(() => stalePress());
  expect(mockController.acknowledgeConflict).not.toHaveBeenCalled();
  expect(mockController.publish).not.toHaveBeenCalled();
  expect(mockController.refresh).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => rendered.renderer.unmount());
});

test('opens the existing basics editor at the exact supported blocker field', async () => {
  const blocked = snapshot();
  blocked.readiness = {
    ...blocked.readiness,
    ready: false,
    reasons: [
      {
        code: 'EVENT_START_REQUIRED',
        message: 'Start required',
        path: 'startsAt',
      },
    ],
  };
  mockController.getCached.mockResolvedValue(blocked);
  mockController.refresh.mockResolvedValue(blocked);
  const { navigation, renderer } = await renderScreen();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-publish-fix-EVENT_START_REQUIRED' })
      .props.onPress(),
  );
  expect(navigation.navigate).toHaveBeenCalledWith('EventBasicsEdit', {
    focusField: 'startsAt',
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('opens setup recovery with the exact blocker-index metadata only', async () => {
  const blocked = snapshot();
  blocked.readiness = {
    ...blocked.readiness,
    ready: false,
    reasons: [
      {
        code: 'EVENT_CAPABILITY_REQUIRED',
        message: 'Capability required',
        meta: { capabilityType: 'team', eventId: rootEventId },
        path: 'capabilities',
      },
    ],
  };
  mockController.getCached.mockResolvedValue(blocked);
  mockController.refresh.mockResolvedValue(blocked);
  const { navigation, renderer } = await renderScreen();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({
        testID: 'event-publish-fix-EVENT_CAPABILITY_REQUIRED',
      })
      .props.onPress(),
  );
  expect(navigation.navigate).toHaveBeenCalledWith('EventSetupRecovery', {
    blocker: 'EVENT_CAPABILITY_REQUIRED',
    capabilityType: 'team',
    eventId: rootEventId,
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('routes template setup without meta and leaves incomplete capability meta inert', async () => {
  const templateBlocked = snapshot();
  templateBlocked.readiness = {
    ...templateBlocked.readiness,
    ready: false,
    reasons: [
      {
        code: 'EVENT_TEMPLATE_REQUIRED',
        message: 'Template required',
        meta: { capabilityType: 'golf', eventId: 'evt_must_be_ignored' },
        path: 'template',
      },
    ],
  };
  mockController.getCached.mockResolvedValue(templateBlocked);
  mockController.refresh.mockResolvedValue(templateBlocked);
  const template = await renderScreen();
  await ReactTestRenderer.act(() =>
    template.renderer.root
      .findByProps({ testID: 'event-publish-fix-EVENT_TEMPLATE_REQUIRED' })
      .props.onPress(),
  );
  expect(template.navigation.navigate).toHaveBeenCalledWith(
    'EventSetupRecovery',
    { blocker: 'EVENT_TEMPLATE_REQUIRED', rootEventId },
  );
  await ReactTestRenderer.act(() => template.renderer.unmount());

  const incomplete = snapshot();
  incomplete.readiness = {
    ...incomplete.readiness,
    ready: false,
    reasons: [
      {
        code: 'EVENT_CAPABILITY_REQUIRED',
        message: 'Capability required',
        meta: { eventId: 'evt_round_without_type' },
        path: 'capabilities',
      },
    ],
  };
  mockController.getCached.mockResolvedValue(incomplete);
  mockController.refresh.mockResolvedValue(incomplete);
  const missingMeta = await renderScreen();
  expect(
    missingMeta.renderer.root.findAllByProps({
      testID: 'event-publish-fix-EVENT_CAPABILITY_REQUIRED',
    }),
  ).toHaveLength(0);
  expect(missingMeta.navigation.navigate).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => missingMeta.renderer.unmount());
});

test('refetches authoritative readiness when the review route regains focus', async () => {
  mockController.getCached.mockResolvedValue(snapshot());
  const { focusListeners, renderer } = await renderScreen();
  expect(mockController.refresh).toHaveBeenCalledTimes(1);
  expect(focusListeners).toHaveLength(1);

  await ReactTestRenderer.act(async () => {
    focusListeners[0]?.();
    await flush();
  });
  expect(mockController.refresh).toHaveBeenCalledTimes(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderScreen() {
  const focusListeners: Array<() => void> = [];
  const navigation = {
    addListener: jest.fn((event: string, listener: () => void) => {
      if (event === 'focus') focusListeners.push(listener);
      return jest.fn();
    }),
    canGoBack: jest.fn(() => false),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(navigation));
    await flush();
  });
  return { focusListeners, navigation, renderer };
}

function screen(navigation?: object) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventPublishScreen
        navigation={
          (navigation ?? {
            addListener: jest.fn(() => jest.fn()),
            canGoBack: jest.fn(() => false),
            goBack: jest.fn(),
            navigate: jest.fn(),
          }) as never
        }
        route={{ name: 'EventPublish', params: { rootEventId } } as never}
      />
    </SafeAreaProvider>
  );
}

function snapshot(): EventPublishSnapshot {
  return {
    conflict: null,
    eventTitle: 'Crew Retreat',
    localRootStatus: 'draft',
    planItemCount: 1,
    planItems: [
      {
        id: 'itm_start',
        startsAt: '2026-09-20T08:00:00.000Z',
        title: 'Gemeinsamer Start',
      },
    ],
    readiness: {
      ready: true,
      reasons: [],
      rootEventId,
      rootRevision: '7',
      rootVersion: 3,
      schemaVersion: 1,
      template: { id: 'team-event', version: 1 },
    },
    refreshedAt: '2026-07-19T12:00:00.000Z',
    role: 'owner',
    schedule: {
      endsAt: '2026-09-21T17:00:00.000Z',
      startsAt: '2026-09-20T08:00:00.000Z',
      timeZone: 'Europe/Zurich',
    },
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
