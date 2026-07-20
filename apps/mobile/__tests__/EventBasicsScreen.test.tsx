import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  EventBasicsManagerRequiredError,
  type EventBasicsSnapshot,
} from '../src/screens/EventBasicsRuntime';
import {
  EventBasicsScreen,
  validateEventBasicsForm,
} from '../src/screens/EventBasicsScreen';

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_existing_draft';
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
  load: jest.Mock;
  refresh: jest.Mock;
  save: jest.Mock;
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

jest.mock('../src/screens/EventBasicsRuntime', () => {
  const actual = jest.requireActual('../src/screens/EventBasicsRuntime');
  return {
    ...actual,
    EventBasicsRuntime: jest.fn().mockImplementation(() => mockRuntime),
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
    load: jest.fn(async () => snapshot()),
    refresh: jest.fn(async () => snapshot()),
    save: jest.fn(async () => snapshot()),
  };
});

test('loads an account-bound cached draft offline and focuses the requested blocker field', async () => {
  mockOnline = false;
  const { renderer } = await renderScreen('description');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.value,
  ).toBe('Crew Retreat');
  expect(textInside(renderer)).toContain('Offline bearbeitbar');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-description' }).props
      .autoFocus,
  ).toBe(true);
  expect(mockRuntime.load).toHaveBeenCalledWith(rootEventId);
  expect(mockRuntime.refresh).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('persists one offline edit and locks a double tap behind the queued overlay', async () => {
  mockOnline = false;
  const queued = snapshot({ delivery: 'queued' });
  queued.draft = {
    ...queued.draft,
    title: 'Offline gespeichert',
  };
  const result = deferred<EventBasicsSnapshot>();
  mockRuntime.save.mockReturnValue(result.promise);
  const { renderer } = await renderScreen('title');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-basics-title' })
      .props.onChangeText('Offline gespeichert'),
  );
  const primary = renderer.root.findByProps({
    testID: 'event-basics-primary-action',
  });

  await ReactTestRenderer.act(() => {
    primary.props.onPress();
    primary.props.onPress();
  });
  expect(mockRuntime.save).toHaveBeenCalledTimes(1);
  expect(mockRuntime.save).toHaveBeenCalledWith(
    rootEventId,
    expect.objectContaining({
      endsAt: '2026-09-21T16:00:00.000Z',
      startsAt: '2026-09-20T07:00:00.000Z',
      title: 'Offline gespeichert',
    }),
  );
  await ReactTestRenderer.act(async () => {
    result.resolve(queued);
    await flush();
  });
  expect(textInside(renderer)).toContain('Lokal dauerhaft gespeichert');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-primary-action' }).props
      .label,
  ).toBe('Zurück zur Prüfung');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders attempted and current conflict truths and resaves with the edited values', async () => {
  const conflicted = snapshot({ delivery: 'conflict' });
  conflicted.current = { ...conflicted.current, title: 'Server Retreat' };
  conflicted.conflict = {
    attempted: { ...conflicted.draft, title: 'Mein Retreat' },
    current: conflicted.current,
  };
  conflicted.draft = conflicted.conflict.attempted;
  mockRuntime.load.mockResolvedValue(conflicted);
  mockRuntime.refresh.mockResolvedValue(conflicted);
  mockRuntime.save.mockResolvedValue(
    snapshot({
      current: { ...conflicted.current, title: 'Zusammengeführt' },
      draft: { ...conflicted.current, title: 'Zusammengeführt' },
    }),
  );
  const { renderer } = await renderScreen('title');
  expect(textInside(renderer)).toContain('Server Retreat');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.value,
  ).toBe('Mein Retreat');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-basics-title' })
      .props.onChangeText('Zusammengeführt'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'event-basics-primary-action' })
      .props.onPress();
    await flush();
  });
  expect(mockRuntime.save).toHaveBeenCalledWith(
    rootEventId,
    expect.objectContaining({ title: 'Zusammengeführt' }),
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals non-manager data without leaking the cached event title', async () => {
  mockRuntime.load.mockRejectedValue(new EventBasicsManagerRequiredError());
  const { renderer } = await renderScreen();
  expect(textInside(renderer)).toContain('Details nicht verfügbar');
  expect(textInside(renderer)).not.toContain('Crew Retreat');
  expect(mockRuntime.refresh).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('fails closed immediately on account scope change and ignores a stale save callback', async () => {
  mockOnline = false;
  const rendered = await renderScreen('title');
  await ReactTestRenderer.act(() =>
    rendered.renderer.root
      .findByProps({ testID: 'event-basics-title' })
      .props.onChangeText('Altes geheimes Event'),
  );
  const stalePress = rendered.renderer.root.findByProps({
    testID: 'event-basics-primary-action',
  }).props.onPress;
  const staleBack = rendered.renderer.root.findByProps({
    testID: 'event-basics-back',
  }).props.onPress;

  mockLifecycle = { ...mockLifecycle, accountId: accountB };
  mockPrivateDatabase = { accountId: accountB, database: {} };
  mockRuntime.load.mockImplementation(() => new Promise(() => {}));
  mockRuntime.save.mockClear();
  await ReactTestRenderer.act(() => rendered.renderer.update(screen()));

  expect(textInside(rendered.renderer)).toContain('Details werden geladen');
  expect(textInside(rendered.renderer)).not.toContain('Altes geheimes Event');
  await ReactTestRenderer.act(() => stalePress());
  expect(mockRuntime.save).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => staleBack());
  expect(rendered.navigation.navigate).not.toHaveBeenCalled();
  expect(rendered.navigation.goBack).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => rendered.renderer.unmount());
});

test('returns to authoritative review even when the editor was opened as a cold route', async () => {
  mockOnline = false;
  const { navigation, renderer } = await renderScreen();
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'event-basics-back' }).props.onPress(),
  );
  expect(navigation.navigate).toHaveBeenCalledWith('EventPublish', {
    rootEventId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('validates local wall-clock values in the chosen IANA timezone including DST gaps', () => {
  expect(
    validateEventBasicsForm({
      description: '  Beschreibung  ',
      endsAt: '2026-09-21 18:00',
      startsAt: '2026-09-20 09:00',
      timeZone: 'Europe/Zurich',
      title: '  Crew Retreat  ',
    }),
  ).toEqual({
    errors: {},
    values: {
      description: 'Beschreibung',
      endsAt: '2026-09-21T16:00:00.000Z',
      startsAt: '2026-09-20T07:00:00.000Z',
      timeZone: 'Europe/Zurich',
      title: 'Crew Retreat',
    },
  });
  expect(
    validateEventBasicsForm({
      description: '',
      endsAt: '',
      startsAt: '2026-03-29 02:30',
      timeZone: 'Europe/Zurich',
      title: 'DST-Lücke',
    }).errors.startsAt,
  ).toBe('Format JJJJ-MM-TT HH:MM verwenden.');
  expect(
    validateEventBasicsForm({
      description: '',
      endsAt: '',
      startsAt: '2026-10-25 02:30',
      timeZone: 'Europe/Zurich',
      title: 'DST-Falte',
    }).errors.startsAt,
  ).toBe(
    'Diese Uhrzeit ist wegen der Zeitumstellung doppelt. Wähle eine eindeutige Uhrzeit.',
  );
  expect(
    validateEventBasicsForm({
      description: '',
      endsAt: '2026-09-20 08:00',
      startsAt: '2026-09-20 09:00',
      timeZone: 'Europe/Zurich',
      title: 'Reihenfolge',
    }).errors.endsAt,
  ).toBe('Das Ende muss nach dem Beginn liegen.');
});

async function renderScreen(
  focusField?: 'description' | 'endsAt' | 'startsAt' | 'timeZone' | 'title',
) {
  const navigation = {
    canGoBack: jest.fn(() => false),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(navigation, focusField));
    await flush();
  });
  return { navigation, renderer };
}

function screen(
  navigation?: object,
  focusField?: 'description' | 'endsAt' | 'startsAt' | 'timeZone' | 'title',
) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <EventBasicsScreen
        navigation={
          (navigation ?? {
            canGoBack: jest.fn(() => false),
            goBack: jest.fn(),
            navigate: jest.fn(),
          }) as never
        }
        route={
          {
            name: 'EventBasicsEdit',
            params: { focusField, rootEventId },
          } as never
        }
      />
    </SafeAreaProvider>
  );
}

function snapshot(
  overrides: Partial<EventBasicsSnapshot> = {},
): EventBasicsSnapshot {
  const values = {
    description: 'Zwei Tage gemeinsam am See.',
    endsAt: '2026-09-21T16:00:00.000Z',
    startsAt: '2026-09-20T07:00:00.000Z',
    timeZone: 'Europe/Zurich',
    title: 'Crew Retreat',
  };
  return {
    conflict: null,
    current: values,
    delivery: 'clean',
    draft: values,
    role: 'owner',
    syncStatus: {
      attentionCount: 0,
      nextAttemptAt: null,
      pendingCount: 0,
      state: 'synced',
      summary: 'All changes saved',
    },
    version: 7,
    ...overrides,
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
