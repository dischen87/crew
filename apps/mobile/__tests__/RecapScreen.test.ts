import type {
  EventRecapExternalShare,
  EventRecapSnapshot,
} from '@crew/mobile-data';
import { buildRecapShareUrl } from '@crew/shared';
import { onlineManager } from '@tanstack/react-query';
import React from 'react';
import { Alert, Share, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  RecapScreen,
  isCurrentRecapOperation,
  isCurrentRecapScope,
  parseRecapVersion,
  recapShareBelongsToScope,
} from '../src/screens/RecapScreen';

const accountId = `usr_${'a'.repeat(32)}`;
const rootA = 'evt_recap_a';
const rootB = 'evt_recap_b';
const mockGatewayClient = {};
let mockPrivateDatabase: { accountId: string; database: object };
let mockLifecycle: { accountId: string; status: 'ready' };
let mockController: {
  createExactBodyShareLink: jest.Mock;
  createShareLink: jest.Mock;
  decideExternalBody: jest.Mock;
  generate: jest.Mock;
  getCached: jest.Mock;
  getRole: jest.Mock;
  publish: jest.Mock;
  refresh: jest.Mock;
  remove: jest.Mock;
  revokeShareLink: jest.Mock;
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => mockPrivateDatabase,
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    EventRecapController: jest.fn().mockImplementation(() => mockController),
  };
});

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  mockPrivateDatabase = { accountId, database: {} };
  mockLifecycle = { accountId, status: 'ready' };
  mockController = {
    createExactBodyShareLink: jest.fn(async () => recapShare('exact-default')),
    createShareLink: jest.fn(async () => recapShare('title-default')),
    decideExternalBody: jest.fn(
      async (_root, _version, _field, _authority, decision) => ({
        decision,
      }),
    ),
    generate: jest.fn(async eventId => snapshot(eventId)),
    getCached: jest.fn(async () => null),
    getRole: jest.fn(async () => 'owner'),
    publish: jest.fn(async eventId => snapshot(eventId)),
    refresh: jest.fn(async eventId => snapshot(eventId)),
    remove: jest.fn(async () => undefined),
    revokeShareLink: jest.fn(async () => undefined),
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('one exact-share operation excludes selection, decision, title share, removal, and duplicate taps', async () => {
  const creation = deferred<EventRecapExternalShare>();
  mockController.createExactBodyShareLink.mockReturnValue(creation.promise);
  const { renderer } = await renderScreen(rootA);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-select-moment-0' })
      .props.onPress(),
  );
  const exactPress = renderer.root.findByProps({
    testID: 'recap-external-share-action',
  }).props.onPress;
  const selectionPress = renderer.root.findByProps({
    testID: 'recap-external-select-moment-1',
  }).props.onPress;
  const decisionPress = renderer.root.findByProps({
    testID: 'recap-external-manager-grant-moment-0',
  }).props.onPress;
  const titlePress = renderer.root.findByProps({
    testID: 'recap-primary-action',
  }).props.onPress;
  const removePress = renderer.root.findByProps({
    testID: 'recap-remove-action',
  }).props.onPress;

  await ReactTestRenderer.act(() => {
    exactPress();
    exactPress();
    selectionPress();
    decisionPress();
    titlePress();
    removePress();
  });

  expect(mockController.createExactBodyShareLink).toHaveBeenCalledTimes(1);
  expect(mockController.createExactBodyShareLink).toHaveBeenCalledWith(
    rootA,
    1,
    [
      {
        field: 'body',
        sourceId: rootA,
        sourceType: 'event',
        sourceVersion: 3,
      },
    ],
  );
  expect(mockController.decideExternalBody).not.toHaveBeenCalled();
  expect(mockController.createShareLink).not.toHaveBeenCalled();
  expect(mockController.remove).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(Share.share).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    creation.resolve(recapShare('exact-a'));
    await flush();
  });

  expect(Share.share).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-moment-0',
    }).props.label,
  ).toBe('Aus Auswahl entfernen');
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-moment-1',
    }).props.label,
  ).toBe('Text auswählen');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('revoke excludes re-share, stale removal, and stale exact-share callbacks', async () => {
  mockController.createShareLink.mockResolvedValue(recapShare('title'));
  const { renderer } = await renderScreen(rootA);
  const staleRemove = renderer.root.findByProps({
    testID: 'recap-remove-action',
  }).props.onPress;
  const staleExact = renderer.root.findByProps({
    testID: 'recap-external-share-action',
  }).props.onPress;

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'recap-primary-action' })
      .props.onPress();
    await flush();
  });
  expect(mockController.createShareLink).toHaveBeenCalledTimes(1);
  expect(Share.share).toHaveBeenCalledTimes(1);

  const revocation = deferred<void>();
  mockController.revokeShareLink.mockReturnValue(revocation.promise);
  const revokePress = renderer.root.findByProps({
    testID: 'recap-revoke-action',
  }).props.onPress;
  const reShare = renderer.root.findByProps({
    testID: 'recap-primary-action',
  }).props.onPress;
  await ReactTestRenderer.act(() => {
    revokePress();
    reShare();
    staleRemove();
    staleExact();
  });

  expect(mockController.revokeShareLink).toHaveBeenCalledTimes(1);
  expect(mockController.revokeShareLink).toHaveBeenCalledWith(
    rootA,
    'share-title',
  );
  expect(mockController.createShareLink).toHaveBeenCalledTimes(1);
  expect(mockController.createExactBodyShareLink).not.toHaveBeenCalled();
  expect(mockController.remove).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(Share.share).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    revocation.resolve();
    await flush();
  });
  expect(
    renderer.root.findByProps({ testID: 'recap-primary-action' }).props.label,
  ).toBe('Titel-Link teilen');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('A to B to A rejects the old same-version completion by operation identity', async () => {
  const oldCreation = deferred<EventRecapExternalShare>();
  const newCreation = deferred<EventRecapExternalShare>();
  mockController.createExactBodyShareLink
    .mockReturnValueOnce(oldCreation.promise)
    .mockReturnValueOnce(newCreation.promise);
  const { navigation, renderer } = await renderScreen(rootA);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-select-moment-0' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-share-action' })
      .props.onPress(),
  );

  await ReactTestRenderer.act(async () => {
    renderer.update(screen(rootB, navigation));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    renderer.update(screen(rootA, navigation));
    await flush();
  });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-select-moment-1' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'recap-external-share-action' })
      .props.onPress(),
  );
  expect(mockController.createExactBodyShareLink).toHaveBeenCalledTimes(2);

  await ReactTestRenderer.act(async () => {
    oldCreation.resolve(recapShare('old-a'));
    await flush();
  });
  expect(Share.share).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'recap-external-share-action' }).props
      .loading,
  ).toBe(true);

  await ReactTestRenderer.act(async () => {
    newCreation.resolve(recapShare('new-a'));
    await flush();
  });
  expect(Share.share).toHaveBeenCalledTimes(1);
  expect(Share.share).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.stringContaining('/recap/new-a'),
    }),
  );
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-moment-0',
    }).props.label,
  ).toBe('Text auswählen');
  expect(
    renderer.root.findByProps({
      testID: 'recap-external-select-moment-1',
    }).props.label,
  ).toBe('Aus Auswahl entfernen');
  expect(mockController.createExactBodyShareLink.mock.calls[0]?.[2]).toEqual([
    expect.objectContaining({ sourceId: rootA, sourceType: 'event' }),
  ]);
  expect(mockController.createExactBodyShareLink.mock.calls[1]?.[2]).toEqual([
    expect.objectContaining({
      sourceId: `fed_${rootA}`,
      sourceType: 'feedEntry',
    }),
  ]);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders server-current manager grant and withdraw only after each decision refetch', async () => {
  const unknown = snapshot(rootA);
  const granted = snapshotWithDecision(rootA, 0, 'manager', 'grant');
  const withdrawn = snapshotWithDecision(rootA, 0, 'manager', 'withdraw');
  mockController.refresh
    .mockResolvedValueOnce(unknown)
    .mockResolvedValueOnce(granted)
    .mockResolvedValueOnce(withdrawn);
  const { renderer } = await renderScreen(rootA);

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'recap-external-manager-grant-moment-0' })
      .props.onPress();
    await flush();
  });
  expect(mockController.decideExternalBody).toHaveBeenCalledWith(
    rootA,
    1,
    {
      field: 'body',
      sourceId: rootA,
      sourceType: 'event',
      sourceVersion: 3,
    },
    'manager',
    'grant',
  );
  expect(renderedText(renderer)).toContain(
    'Managerfreigabe: aktuell bestätigt.',
  );

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'recap-external-manager-withdraw-moment-0' })
      .props.onPress();
    await flush();
  });
  expect(mockController.refresh).toHaveBeenLastCalledWith(rootA, 1);
  expect(renderedText(renderer)).toContain('Managerfreigabe: widerrufen.');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('allows a feed author from actorCanDecide without exposing manager or share actions', async () => {
  mockController.getRole.mockResolvedValue('participant');
  const author = snapshotWithDecision(rootA, 1, 'author', 'withdraw');
  author.role = 'participant';
  author.externalConsent!.fields[0]!.actorCanDecide = [];
  author.externalConsent!.fields[1]!.actorCanDecide = ['author'];
  mockController.refresh.mockResolvedValue(author);
  const { renderer } = await renderScreen(rootA);

  expect(
    renderer.root.findAllByProps({
      testID: 'recap-external-manager-grant-moment-1',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({
      testID: 'recap-external-select-moment-1',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ testID: 'recap-external-share-action' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'recap-external-author-grant-moment-1' })
      .props.onPress();
    await flush();
  });
  expect(mockController.decideExternalBody).toHaveBeenCalledWith(
    rootA,
    1,
    {
      field: 'body',
      sourceId: `fed_${rootA}`,
      sourceType: 'feedEntry',
      sourceVersion: 4,
    },
    'author',
    'grant',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('forgets a previously granted decision when the required post-mutation refetch fails', async () => {
  mockController.refresh
    .mockResolvedValueOnce(snapshotWithDecision(rootA, 0, 'manager', 'grant'))
    .mockRejectedValueOnce(new Error('refresh failed'));
  const { renderer } = await renderScreen(rootA);
  expect(renderedText(renderer)).toContain(
    'Managerfreigabe: aktuell bestätigt.',
  );

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'recap-external-manager-withdraw-moment-0' })
      .props.onPress();
    await flush();
  });
  const text = renderedText(renderer);
  expect(text).toContain('Managerfreigabe: nicht bestätigt.');
  expect(text).not.toContain('Managerfreigabe: aktuell bestätigt.');
  expect(text).toContain('Freigabestatus konnte nicht bestätigt werden');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('parses only bounded positive recap versions from deep links', () => {
  expect(parseRecapVersion(undefined)).toBeUndefined();
  expect(parseRecapVersion('1')).toBe(1);
  expect(parseRecapVersion('v2')).toBe(2);
  expect(parseRecapVersion('0')).toBe('invalid');
  expect(parseRecapVersion('-1')).toBe('invalid');
  expect(parseRecapVersion('1?token=secret')).toBe('invalid');
  expect(parseRecapVersion('9007199254740992')).toBe('invalid');
});

test('uses the canonical Crew web host for opaque recap sharing', () => {
  const token = `crs_${'A'.repeat(43)}`;
  expect(buildRecapShareUrl(token)).toBe(
    `https://crew-haus.com/recap/${token}`,
  );
});

test('never reuses same-version share or async state across account and root scopes', () => {
  const scopeRootA = 'usr_account_a:evt_trip_a:current';
  const scopeRootB = 'usr_account_a:evt_trip_b:current';
  const accountBRootA = 'usr_account_b:evt_trip_a:current';

  expect(recapShareBelongsToScope(scopeRootA, scopeRootA, 1, 1)).toBe(true);
  expect(recapShareBelongsToScope(scopeRootA, scopeRootB, 1, 1)).toBe(false);
  expect(recapShareBelongsToScope(scopeRootA, accountBRootA, 1, 1)).toBe(false);
  expect(recapShareBelongsToScope(scopeRootA, scopeRootA, 1, 2)).toBe(false);
  expect(isCurrentRecapScope(scopeRootA, scopeRootB)).toBe(false);
  expect(isCurrentRecapScope(scopeRootA, accountBRootA)).toBe(false);
  expect(isCurrentRecapOperation(scopeRootA, scopeRootA, 1, 1)).toBe(true);
  expect(isCurrentRecapOperation(scopeRootA, scopeRootA, 1, 2)).toBe(false);
});

async function renderScreen(rootEventId: string) {
  const navigation = {
    canGoBack: jest.fn(() => false),
    goBack: jest.fn(),
    navigate: jest.fn(),
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(screen(rootEventId, navigation));
    await flush();
  });
  return { navigation, renderer };
}

function screen(rootEventId: string, navigation: object) {
  return React.createElement(
    SafeAreaProvider,
    { initialMetrics: metrics },
    React.createElement(RecapScreen, {
      navigation: navigation as never,
      route: {
        name: 'RecapInbound',
        params: { rootEventId },
      } as never,
    }),
  );
}

function snapshot(rootEventId: string): EventRecapSnapshot {
  const now = '2026-07-20T10:00:00.000Z';
  return {
    externalConsent: {
      fields: [
        {
          actorCanDecide: ['manager'],
          authorDecision: 'unknown',
          field: 'body',
          managerDecision: 'unknown',
          ordinal: 0,
          requiredAuthorities: ['manager'],
        },
        {
          actorCanDecide: ['manager'],
          authorDecision: 'unknown',
          field: 'body',
          managerDecision: 'unknown',
          ordinal: 1,
          requiredAuthorities: ['author', 'manager'],
        },
      ],
    },
    recap: {
      generatedAt: now,
      items: [
        {
          ordinal: 0,
          provenance: {
            consentBasis: 'event-publication',
            sourceId: rootEventId,
            sourceRevision: '7',
            sourceType: 'event',
            sourceVersion: 3,
            visibility: 'members',
          },
          sourceBody: 'Gemeinsamer Auftakt.',
          sourceTitle: 'Auftakt',
        },
        {
          ordinal: 1,
          provenance: {
            consentBasis: 'source-author',
            sourceId: `fed_${rootEventId}`,
            sourceRevision: '8',
            sourceType: 'feedEntry',
            sourceVersion: 4,
            visibility: 'members',
          },
          sourceBody: 'Gemeinsames Dinner.',
          sourceTitle: 'Dinner',
        },
      ],
      lifecycleVersion: 1,
      publishedAt: now,
      publishedVersion: 1,
      rootEventId,
      schemaVersion: 1,
      sourceRootRevision: '7',
      state: 'published',
      title: `Rückblick ${rootEventId}`,
      titleProvenance: {
        consentBasis: 'event-publication',
        sourceId: rootEventId,
        sourceRevision: '7',
        sourceType: 'event',
        sourceVersion: 3,
        visibility: 'members',
      },
      version: 1,
    },
    refreshedAt: now,
    role: 'owner',
  };
}

function recapShare(id: string): EventRecapExternalShare {
  return {
    shareLink: {
      createdAt: '2026-07-20T10:00:00.000Z',
      expiresAt: '2026-07-27T10:00:00.000Z',
      id: `share-${id}`,
      recapVersion: 1,
    },
    token: id,
  };
}

function snapshotWithDecision(
  rootEventId: string,
  ordinal: number,
  authority: 'author' | 'manager',
  decision: 'grant' | 'withdraw',
) {
  const value = snapshot(rootEventId);
  const field = value.externalConsent?.fields.find(
    candidate => candidate.ordinal === ordinal,
  );
  if (!field) throw new Error('Missing recap consent fixture');
  if (authority === 'author') field.authorDecision = decision;
  else field.managerDecision = decision;
  return value;
}

function renderedText(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ');
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
