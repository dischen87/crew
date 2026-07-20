import { GatewayClientError } from '@crew/mobile-client';
import {
  MobileSyncRootAccessDeniedError,
  type CommunityFeedback,
  type CommunityFeedbackSummary,
} from '@crew/mobile-data';
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  CommunityFeedbackItemScreen,
  type CommunityFeedbackItemScreenProps,
} from '../src/screens/CommunityFeedbackItemScreen';
import {
  CommunityFeedbackListScreen,
  type CommunityFeedbackListScreenProps,
  filterFeedback,
  refreshCommunityFeedback,
} from '../src/screens/CommunityFeedbackListScreen';

const mockAccountUserId = `usr_${'1'.repeat(32)}`;
const mockOtherAccountUserId = `usr_${'2'.repeat(32)}`;
const mockDatabase = {};
const mockClient = {};
let mockOnline = true;
let mockLifecycle = {
  accountId: mockAccountUserId as string | null,
  reloadSession: jest.fn(() => Promise.resolve()),
  status: 'ready' as const,
};
const mockController = {
  addComment: jest.fn(),
  changelog: jest.fn(),
  getCached: jest.fn(),
  list: jest.fn(),
  refresh: jest.fn(),
  refreshList: jest.fn(),
  refreshUpdates: jest.fn(),
  setFollowed: jest.fn(),
  setVote: jest.fn(),
};
const mockRuntime = {
  controller: mockController,
  hasCachedMembership: jest.fn(),
  verifyRoot: jest.fn(),
};
const mockComposeRuntime = {
  capture: jest.fn(),
  cleanup: jest.fn(),
};

jest.mock('../src/screens/CommunityFeedbackRuntime', () => ({
  CommunityFeedbackRuntime: jest.fn(() => mockRuntime),
}));

jest.mock('../src/screens/FeedbackComposeRuntime', () => ({
  FeedbackComposeRuntime: jest.fn(() => mockComposeRuntime),
}));

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockAccountUserId,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: jest
    .fn()
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValue('00000000-0000-4000-8000-000000000002'),
}));

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const rootEventId = 'evt_trip';
const feedbackId = 'fbk_feedback';

const summary: CommunityFeedbackSummary = {
  body: 'Gespeicherter Text bleibt sichtbar.',
  createdAt: '2026-07-18T10:00:00.000Z',
  duplicateCount: 0,
  followed: false,
  id: feedbackId,
  status: 'open',
  title: 'Gespeichertes Feedback',
  updatedAt: '2026-07-19T10:00:00.000Z',
  version: 1,
  viewerHasVoted: false,
  voteCount: 1,
};

const detail: CommunityFeedback = {
  ...summary,
  commentCount: 0,
  comments: [],
  commentsHasMore: false,
  statusHistory: [
    {
      changedAt: '2026-07-18T10:00:00.000Z',
      fromStatus: null,
      note: null,
      toStatus: 'open',
      version: 1,
    },
  ],
  statusHistoryCount: 1,
  statusHistoryHasMore: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockLifecycle = {
    accountId: mockAccountUserId,
    reloadSession: jest.fn(() => Promise.resolve()),
    status: 'ready',
  };
  mockRuntime.hasCachedMembership.mockResolvedValue(true);
  mockRuntime.verifyRoot.mockResolvedValue(undefined);
  mockController.list.mockResolvedValue([summary]);
  mockController.changelog.mockResolvedValue([]);
  mockController.getCached.mockResolvedValue(detail);
  mockController.refresh.mockResolvedValue({
    feedback: detail,
    redirectedFromFeedbackId: null,
  });
  mockController.refreshList.mockResolvedValue(page([summary]));
  mockController.refreshUpdates.mockResolvedValue(page([]));
  mockController.setVote.mockResolvedValue({
    feedback: { ...detail, viewerHasVoted: true, voteCount: 2 },
    redirectedFromFeedbackId: null,
  });
  mockController.setFollowed.mockResolvedValue({
    feedbackId,
    followed: true,
  });
  mockController.addComment.mockResolvedValue({
    feedback: detail,
    redirectedFromFeedbackId: null,
  });
  mockComposeRuntime.capture.mockResolvedValue({
    attachmentId: 'att_screenshot',
    feedbackId: 'fbk_screenshot',
    pixelHeight: 844,
    pixelWidth: 390,
    previewDataUri: 'data:image/png;base64,preview',
  });
  mockComposeRuntime.cleanup.mockResolvedValue(undefined);
});

test('keeps cached list visible when community boundary fails but root remains active', async () => {
  mockController.refreshList.mockRejectedValue(gatewayError(403));
  const renderer = await renderList();

  expect(textInside(renderer)).toContain('Gespeichertes Feedback');
  expect(textInside(renderer)).toContain('Eventzugriff bestätigt');
  expect(textInside(renderer)).not.toContain(
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  );
  expect(mockRuntime.verifyRoot).toHaveBeenNthCalledWith(
    2,
    mockAccountUserId,
    rootEventId,
    true,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals list only when authoritative root verification denies access', async () => {
  mockController.refreshList.mockRejectedValue(gatewayError(404));
  mockRuntime.verifyRoot
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new MobileSyncRootAccessDeniedError());
  const renderer = await renderList();

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar');
  expect(textInside(renderer)).not.toContain('Gespeichertes Feedback');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offline cache failure resolves to retryable content instead of endless loading', async () => {
  mockOnline = false;
  mockController.list.mockRejectedValue(new Error('sqlite unavailable'));
  const renderer = await renderList();

  expect(textInside(renderer)).toContain(
    'Gespeicherte Meldungen konnten nicht gelesen werden',
  );
  expect(textInside(renderer)).not.toContain(
    'Gespeichertes Feedback bleibt sichtbar, sobald es geprüft ist',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('404 becomes removal only after root membership is authoritatively confirmed', async () => {
  mockController.refresh.mockRejectedValue(gatewayError(404));
  const confirmed = await renderItem();
  expect(textInside(confirmed)).toContain('nicht mehr Teil dieses Events');
  expect(mockRuntime.verifyRoot).toHaveBeenLastCalledWith(
    mockAccountUserId,
    rootEventId,
    true,
  );
  await ReactTestRenderer.act(() => confirmed.unmount());

  jest.clearAllMocks();
  mockRuntime.hasCachedMembership.mockResolvedValue(true);
  mockController.getCached.mockResolvedValue(detail);
  mockController.refresh.mockRejectedValue(gatewayError(404));
  mockRuntime.verifyRoot
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new MobileSyncRootAccessDeniedError());
  const denied = await renderItem();
  expect(textInside(denied)).toContain(
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  );
  expect(textInside(denied)).not.toContain('nicht mehr Teil dieses Events');
  await ReactTestRenderer.act(() => denied.unmount());
});

test('does not redirect a deferred canonical response across an account switch', async () => {
  let resolveRefresh!: (value: {
    feedback: CommunityFeedback;
    redirectedFromFeedbackId: string | null;
  }) => void;
  mockController.refresh.mockReturnValue(
    new Promise(resolve => {
      resolveRefresh = resolve;
    }),
  );
  const onCanonicalFeedback = jest.fn();
  const renderer = await renderItem({ onCanonicalFeedback });

  mockLifecycle = { ...mockLifecycle, accountId: mockOtherAccountUserId };
  await ReactTestRenderer.act(async () => {
    renderer.update(itemElement({ onCanonicalFeedback }));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    resolveRefresh({
      feedback: { ...detail, id: 'fbk_canonical' },
      redirectedFromFeedbackId: feedbackId,
    });
    await flush();
  });
  expect(onCanonicalFeedback).not.toHaveBeenCalled();
  expect(textInside(renderer)).toContain(
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('deduplicates concurrent votes and reuses the caller-stable key after failure', async () => {
  mockController.refresh.mockResolvedValue({
    feedback: detail,
    redirectedFromFeedbackId: null,
  });
  mockController.setVote.mockRejectedValueOnce(new Error('network'));
  const renderer = await renderItem();
  const vote = renderer.root.findByProps({ testID: 'community-feedback-vote' });

  await ReactTestRenderer.act(async () => {
    const first = vote.props.onPress();
    const second = vote.props.onPress();
    await Promise.all([first, second]);
    await flush();
  });
  expect(mockController.setVote).toHaveBeenCalledTimes(1);
  const firstKey = mockController.setVote.mock.calls[0][3];

  mockController.setVote.mockResolvedValueOnce({
    feedback: { ...detail, viewerHasVoted: true, voteCount: 2 },
    redirectedFromFeedbackId: null,
  });
  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-vote' })
      .props.onPress();
    await flush();
  });
  expect(mockController.setVote).toHaveBeenCalledTimes(2);
  expect(mockController.setVote.mock.calls[1][3]).toBe(firstKey);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('bounds pagination at 200 and reports partial truth', async () => {
  const listCursors: (string | undefined)[] = [];
  const updatesCursors: (string | undefined)[] = [];
  const runtime = {
    controller: {
      refreshList: jest.fn((_root, query) => {
        listCursors.push(query.cursor);
        const cursor = `list-${listCursors.length}`;
        return Promise.resolve(page([], true, cursor));
      }),
      refreshUpdates: jest.fn((_root, query) => {
        updatesCursors.push(query.cursor);
        const cursor = `updates-${updatesCursors.length}`;
        return Promise.resolve(page([], true, cursor));
      }),
    },
  };

  await expect(
    refreshCommunityFeedback(runtime as never, rootEventId),
  ).resolves.toEqual({ partial: true });
  expect(listCursors).toEqual([undefined, 'list-1', 'list-2', 'list-3']);
  expect(updatesCursors).toEqual([
    undefined,
    'updates-1',
    'updates-2',
    'updates-3',
  ]);
});

test('filters long Unicode text locally without changing controller scope', () => {
  const items = [
    summary,
    {
      ...summary,
      body: 'Côte d’Azur 🎉',
      followed: true,
      id: 'fbk_unicode',
      status: 'planned' as const,
      title: 'ÖV & Zürich',
    },
  ];
  expect(filterFeedback(items, 'planned', true, 'zürich')).toEqual([items[1]]);
});

test('captures once while visible and hands only the feedback identity to compose', async () => {
  const capture = deferred<{
    attachmentId: string;
    feedbackId: string;
    pixelHeight: number;
    pixelWidth: number;
    previewDataUri: string;
  }>();
  mockComposeRuntime.capture.mockReturnValueOnce(capture.promise);
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onComposeWithScreenshot });
  const button = renderer.root.findByProps({
    testID: 'community-feedback-compose-screenshot',
  });

  let first!: Promise<void>;
  let second!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    first = button.props.onPress();
    second = button.props.onPress();
    await flush();
  });
  expect(mockComposeRuntime.capture).toHaveBeenCalledTimes(1);
  expect(mockComposeRuntime.capture).toHaveBeenCalledWith(rootEventId);
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    capture.resolve({
      attachmentId: 'att_private-local',
      feedbackId: 'fbk_screenshot',
      pixelHeight: 844,
      pixelWidth: 390,
      previewDataUri: 'data:image/png;base64,private-preview',
    });
    await Promise.all([first, second]);
    await flush();
  });
  expect(onComposeWithScreenshot).toHaveBeenCalledWith('fbk_screenshot');
  expect(onComposeWithScreenshot).toHaveBeenCalledTimes(1);
  expect(mockComposeRuntime.cleanup).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps text compose independent and cleans a late screenshot result', async () => {
  const capture = deferred<{
    attachmentId: string;
    feedbackId: string;
    pixelHeight: number;
    pixelWidth: number;
    previewDataUri: string;
  }>();
  mockComposeRuntime.capture.mockReturnValueOnce(capture.promise);
  const onCompose = jest.fn();
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onCompose, onComposeWithScreenshot });
  const screenshotButton = renderer.root.findByProps({
    testID: 'community-feedback-compose-screenshot',
  });
  const textButton = renderer.root.findByProps({
    testID: 'community-feedback-compose',
  });

  let captureFlight!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    captureFlight = screenshotButton.props.onPress();
    textButton.props.onPress();
    await flush();
  });
  expect(onCompose).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    capture.resolve({
      attachmentId: 'att_private-local',
      feedbackId: 'fbk_cancelled',
      pixelHeight: 844,
      pixelWidth: 390,
      previewDataUri: 'data:image/png;base64,private-preview',
    });
    await captureFlight;
    await flush();
  });
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith('fbk_cancelled');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cleans capture when navigation aborts and leaves text recovery available', async () => {
  const onCompose = jest.fn();
  const onComposeWithScreenshot = jest.fn(() => {
    throw new Error('navigation aborted');
  });
  const renderer = await renderList({ onCompose, onComposeWithScreenshot });

  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress();
    await flush();
  });
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith('fbk_screenshot');
  expect(textInside(renderer)).toContain(
    'Screenshot konnte nicht hinzugefügt werden',
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-compose' })
      .props.onPress(),
  );
  expect(onCompose).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cleans a late capture after source change without navigating stale context', async () => {
  const capture = deferred<{
    attachmentId: string;
    feedbackId: string;
    pixelHeight: number;
    pixelWidth: number;
    previewDataUri: string;
  }>();
  mockComposeRuntime.capture.mockReturnValueOnce(capture.promise);
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onComposeWithScreenshot });
  let flight!: Promise<void>;

  await ReactTestRenderer.act(async () => {
    flight = renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress();
    renderer.update(
      listElement({
        onComposeWithScreenshot,
        rootEventId: 'evt_second',
      }),
    );
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    capture.resolve({
      attachmentId: 'att_private-local',
      feedbackId: 'fbk_old_source',
      pixelHeight: 844,
      pixelWidth: 390,
      previewDataUri: 'data:image/png;base64,private-preview',
    });
    await flight;
    await flush();
  });
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith('fbk_old_source');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cleans a late capture after account change without crossing private scope', async () => {
  const capture = deferred<{
    attachmentId: string;
    feedbackId: string;
    pixelHeight: number;
    pixelWidth: number;
    previewDataUri: string;
  }>();
  mockComposeRuntime.capture.mockReturnValueOnce(capture.promise);
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onComposeWithScreenshot });
  let flight!: Promise<void>;

  await ReactTestRenderer.act(async () => {
    flight = renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress();
    mockLifecycle = { ...mockLifecycle, accountId: mockOtherAccountUserId };
    renderer.update(listElement({ onComposeWithScreenshot }));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    capture.resolve({
      attachmentId: 'att_private-local',
      feedbackId: 'fbk_old_account',
      pixelHeight: 844,
      pixelWidth: 390,
      previewDataUri: 'data:image/png;base64,private-preview',
    });
    await flight;
    await flush();
  });
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith('fbk_old_account');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cleans a late capture after unmount', async () => {
  const capture = deferred<{
    attachmentId: string;
    feedbackId: string;
    pixelHeight: number;
    pixelWidth: number;
    previewDataUri: string;
  }>();
  mockComposeRuntime.capture.mockReturnValueOnce(capture.promise);
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onComposeWithScreenshot });
  let flight!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    flight = renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress();
    renderer.unmount();
    await flush();
  });
  capture.resolve({
    attachmentId: 'att_private-local',
    feedbackId: 'fbk_unmounted',
    pixelHeight: 844,
    pixelWidth: 390,
    previewDataUri: 'data:image/png;base64,private-preview',
  });
  await flight;
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith('fbk_unmounted');
});

test('shows a bounded capture failure without blocking text feedback', async () => {
  mockComposeRuntime.capture.mockRejectedValueOnce(
    new Error('/private/path/native-capture-secret'),
  );
  const onCompose = jest.fn();
  const onComposeWithScreenshot = jest.fn();
  const renderer = await renderList({ onCompose, onComposeWithScreenshot });

  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-compose-screenshot' })
      .props.onPress();
    await flush();
  });
  const visible = textInside(renderer);
  expect(visible).toContain('Screenshot konnte nicht hinzugefügt werden');
  expect(visible).not.toContain('/private/path');
  expect(onComposeWithScreenshot).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-compose' })
      .props.onPress(),
  );
  expect(onCompose).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderList(
  overrides: Partial<CommunityFeedbackListScreenProps> = {},
) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(listElement(overrides));
    await flush();
  });
  return renderer!;
}

function listElement(
  overrides: Partial<CommunityFeedbackListScreenProps> = {},
) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <CommunityFeedbackListScreen
        onBack={jest.fn()}
        onCompose={jest.fn()}
        onComposeWithScreenshot={jest.fn()}
        onOpenFeedback={jest.fn()}
        rootEventId={rootEventId}
        {...overrides}
      />
    </SafeAreaProvider>
  );
}

async function renderItem(
  overrides: Partial<CommunityFeedbackItemScreenProps> = {},
) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(itemElement(overrides));
    await flush();
  });
  return renderer!;
}

function itemElement(
  overrides: Partial<CommunityFeedbackItemScreenProps> = {},
) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <CommunityFeedbackItemScreen
        feedbackId={feedbackId}
        onBack={jest.fn()}
        rootEventId={rootEventId}
        {...overrides}
      />
    </SafeAreaProvider>
  );
}

function page<Item>(
  items: readonly Item[],
  hasMore = false,
  nextCursor: string | null = null,
) {
  return { items, pageInfo: { hasMore, nextCursor } };
}

function gatewayError(status: 403 | 404) {
  return new GatewayClientError({
    code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN',
    operationId: status === 404 ? 'eventFeedbackGet' : 'eventFeedbackList',
    requestId: `req-${status}`,
    retryAfterSeconds: null,
    retryable: false,
    status,
  });
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
    .join(' ')
    .replace(/\s+/g, ' ');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
