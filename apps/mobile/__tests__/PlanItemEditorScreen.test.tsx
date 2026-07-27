import React from 'react';
import * as ReactNative from 'react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { EventSetupRecoveryUnavailableError } from '../src/screens/EventSetupRecoveryRuntime';
import type { PlanSnapshot } from '../src/screens/PlanRuntime';
import { PlanItemEditorScreen } from '../src/screens/PlanItemEditorScreen';

const mockAccountId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_plan_root';
const candidate = {
  attribution: 'Crew places',
  confidence: 0.9,
  countryCode: 'CH',
  id: 'candidate_venue',
  kind: 'venue' as const,
  latitude: 47.37,
  licenseCode: 'first-party',
  licenseUrl: null,
  locality: 'Zürich',
  longitude: 8.54,
  name: 'Kongresshaus Zürich',
  region: 'ZH',
  retrievedAt: '2026-07-27T08:00:00.000Z',
  source: 'crew',
  sourceRecordUrl: null,
  status: 'enriched' as const,
  version: 1,
};
const createdPlace = {
  accountUserId: mockAccountId,
  countryCode: 'CH',
  createdAt: '2026-07-27T08:00:00.000Z',
  deletedAt: null,
  id: `plc_${'b'.repeat(40)}`,
  latitude: 47.37,
  locality: 'Zürich',
  longitude: 8.54,
  name: candidate.name,
  rootEventId,
  updatedAt: '2026-07-27T08:00:00.000Z',
  version: 1,
};

let mockOnline = true;
let mockPlanRuntime: {
  createItem: jest.Mock;
  load: jest.Mock;
  refresh: jest.Mock;
  updateItem: jest.Mock;
};
let mockPlaceRuntime: {
  createEventPlace: jest.Mock;
  searchEventPlaces: jest.Mock;
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => ({}),
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({ accountId: mockAccountId, database: {} }),
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountId,
    status: 'ready',
  }),
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('../src/screens/PlanRuntime', () => {
  const actual = jest.requireActual('../src/screens/PlanRuntime');
  return {
    ...actual,
    PlanRuntime: jest.fn().mockImplementation(() => mockPlanRuntime),
  };
});

jest.mock('../src/screens/EventSetupRecoveryRuntime', () => {
  const actual = jest.requireActual('../src/screens/EventSetupRecoveryRuntime');
  return {
    ...actual,
    EventSetupRecoveryRuntime: jest
      .fn()
      .mockImplementation(() => mockPlaceRuntime),
  };
});

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  const initial = snapshot();
  const withPlace = snapshot([createdPlace]);
  mockPlanRuntime = {
    createItem: jest.fn(),
    load: jest.fn(async () => initial),
    refresh: jest
      .fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(withPlace),
    updateItem: jest.fn(),
  };
  mockPlaceRuntime = {
    createEventPlace: jest.fn(async () => createdPlace),
    searchEventPlaces: jest.fn(async () => [candidate]),
  };
});

test('searches remotely, creates through the shared place flow and selects the confirmed name', async () => {
  const renderer = await renderScreen();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-open-search' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-query' })
      .props.onChangeText('Zürich'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-submit' })
      .props.onPress();
    await flush();
  });

  expect(mockPlaceRuntime.searchEventPlaces).toHaveBeenCalledWith(
    rootEventId,
    'venue',
    'Zürich',
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-remote-result-0' })
      .props.onPress();
    await flush();
  });

  expect(mockPlaceRuntime.createEventPlace).toHaveBeenCalledWith(
    rootEventId,
    candidate,
  );
  expect(mockPlanRuntime.refresh).toHaveBeenCalledTimes(2);
  expect(textInside(renderer)).toContain(
    'Kongresshaus Zürich wurde im Event gespeichert und ausgewählt.',
  );
  expect(textInside(renderer)).not.toContain(createdPlace.id);
  expect(
    renderer.root.find(
      node =>
        node.props.testID === `plan-item-place-id-${createdPlace.id}` &&
        node.props.accessibilityRole === 'radio',
    ).props.accessibilityState,
  ).toMatchObject({ checked: true });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps local edits but surfaces a conflict when the item changed during place creation', async () => {
  const existing = planItem();
  const changed = planItem({
    values: { ...existing.values, title: 'Titel vom Server' },
    version: 2,
  });
  const initial = snapshot([], [existing]);
  mockPlanRuntime.load.mockResolvedValue(initial);
  mockPlanRuntime.refresh
    .mockReset()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(snapshot([createdPlace], [changed]));
  const renderer = await renderScreen(existing.id);

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-open-search' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-query' })
      .props.onChangeText('Zürich'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-submit' })
      .props.onPress();
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-remote-result-0' })
      .props.onPress();
    await flush();
  });

  expect(textInside(renderer)).toContain(
    'Der Serverstand hat sich geändert. Prüfe deine erhaltenen Eingaben',
  );
  expect(
    renderer.root.findByProps({ testID: 'plan-item-title' }).props.value,
  ).toBe(existing.values.title);
  expect(
    renderer.root.find(
      node =>
        node.props.testID === `plan-item-place-id-${createdPlace.id}` &&
        node.props.accessibilityRole === 'radio',
    ).props.accessibilityState,
  ).toMatchObject({ checked: true });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals stale editor data when live place access is unavailable', async () => {
  mockPlaceRuntime.searchEventPlaces.mockRejectedValue(
    new EventSetupRecoveryUnavailableError(),
  );
  const renderer = await renderScreen();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-open-search' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-query' })
      .props.onChangeText('Zürich'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'plan-item-place-id-search-submit' })
      .props.onPress();
    await flush();
  });

  expect(textInside(renderer)).toContain('Editor nicht verfügbar');
  expect(textInside(renderer)).not.toContain('Crew Planung');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows the full title in a multiline field at large text', async () => {
  const dimensions = jest
    .spyOn(ReactNative, 'useWindowDimensions')
    .mockReturnValue({ fontScale: 2, height: 844, scale: 3, width: 390 });
  const renderer = await renderScreen();
  const title = renderer.root.findByProps({ testID: 'plan-item-title' });

  expect(title.props.multiline).toBe(true);
  expect(title.props.submitBehavior).toBe('blurAndSubmit');
  expect(title.props.textAlignVertical).toBe('top');

  await ReactTestRenderer.act(() => renderer.unmount());
  dimensions.mockRestore();
});

async function renderScreen(itemId?: string) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <PlanItemEditorScreen
          navigation={
            {
              canGoBack: jest.fn(() => true),
              goBack: jest.fn(),
              navigate: jest.fn(),
              replace: jest.fn(),
            } as never
          }
          route={
            {
              key: 'plan-editor',
              name: 'PlanItemEditor',
              params: { eventId: rootEventId, itemId, rootEventId },
            } as never
          }
        />
      </SafeAreaProvider>,
    );
    await flush();
  });
  return renderer;
}

function snapshot(
  places: PlanSnapshot['places'] = [],
  items: PlanSnapshot['items'] = [],
): PlanSnapshot {
  return {
    canEdit: true,
    events: [
      {
        accountUserId: mockAccountId,
        childOrderVersion: '1',
        createdAt: '2026-07-27T08:00:00.000Z',
        deletedAt: null,
        depth: 0,
        description: null,
        endsAt: null,
        id: rootEventId,
        itineraryOrderVersion: '1',
        kind: 'team_event',
        parentEventId: null,
        rootEventId,
        sortKey: 'a',
        startsAt: null,
        status: 'draft',
        timeZone: 'Europe/Zurich',
        title: 'Crew Planung',
        updatedAt: '2026-07-27T08:00:00.000Z',
        version: 1,
      },
    ],
    issues: [],
    items,
    places,
    role: 'owner',
    syncStatus: {
      attentionCount: 0,
      nextAttemptAt: null,
      pendingCount: 0,
      state: 'synced',
      summary: 'Zuletzt vollständig synchronisiert',
    },
  };
}

function planItem(
  overrides: Partial<
    Pick<PlanSnapshot['items'][number], 'values' | 'version'>
  > = {},
): PlanSnapshot['items'][number] {
  return {
    delivery: 'clean',
    id: 'iti_existing',
    placeSnapshotJson: null,
    sortKey: '1024',
    values: {
      allDay: false,
      details: { schemaVersion: 1, type: 'note' },
      endsAt: null,
      eventId: rootEventId,
      notes: null,
      placeId: null,
      startsAt: null,
      status: 'active',
      timeZone: 'Europe/Zurich',
      title: 'Lokaler Titel',
    },
    version: 1,
    ...overrides,
  };
}

function flush() {
  return new Promise<void>(resolve => setImmediate(() => resolve()));
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
