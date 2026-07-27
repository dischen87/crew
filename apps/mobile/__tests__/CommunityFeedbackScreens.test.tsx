import { GatewayClientError } from '@crew/mobile-client';
import {
  MobileSyncRootAccessDeniedError,
  type CommunityFeedback,
  type CommunityFeedbackManagerWriteOutcome,
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
  managerRole: jest.fn(),
  managerWritePending: jest.fn(),
  markDuplicate: jest.fn(),
  refresh: jest.fn(),
  refreshList: jest.fn(),
  refreshUpdates: jest.fn(),
  setFollowed: jest.fn(),
  setStatus: jest.fn(),
  setVote: jest.fn(),
};
const mockRuntime = {
  controller: mockController,
  duplicateSuggestions: {
    search: jest.fn(),
  },
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
  mockController.managerRole.mockResolvedValue(null);
  mockController.managerWritePending.mockResolvedValue(false);
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
  mockController.setStatus.mockResolvedValue({
    kind: 'refreshed',
    resolution: {
      feedback: { ...detail, status: 'planned', version: 2 },
      redirectedFromFeedbackId: null,
    },
  });
  mockController.markDuplicate.mockResolvedValue({
    kind: 'refreshed',
    resolution: {
      feedback: { ...detail, id: 'fbk_canonical' },
      redirectedFromFeedbackId: feedbackId,
    },
  });
  mockRuntime.duplicateSuggestions.search.mockResolvedValue({
    items: [
      {
        id: 'fbk_canonical',
        status: 'planned',
        title: 'Kanonische Meldung',
        voteCount: 8,
      },
    ],
    refreshedAt: '2026-07-19T10:00:00.000Z',
    source: 'network',
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

test('online cold membership verifies the root before reading community content', async () => {
  mockRuntime.hasCachedMembership
    .mockResolvedValueOnce(false)
    .mockResolvedValue(true);
  const renderer = await renderList();

  expect(mockRuntime.verifyRoot).toHaveBeenCalledTimes(1);
  expect(mockRuntime.verifyRoot).toHaveBeenCalledWith(
    mockAccountUserId,
    rootEventId,
  );
  expect(mockRuntime.verifyRoot.mock.invocationCallOrder[0]).toBeLessThan(
    mockRuntime.hasCachedMembership.mock.invocationCallOrder[1],
  );
  expect(
    mockRuntime.hasCachedMembership.mock.invocationCallOrder[1],
  ).toBeLessThan(mockController.list.mock.invocationCallOrder[0]);
  expect(textInside(renderer)).toContain('Gespeichertes Feedback');
  expect(textInside(renderer)).not.toContain(
    'Dieser Inhalt ist nicht verfügbar',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offline cold membership stays unavailable without network or community reads', async () => {
  mockOnline = false;
  mockRuntime.hasCachedMembership.mockResolvedValue(false);
  const renderer = await renderList();

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar');
  expect(mockRuntime.verifyRoot).not.toHaveBeenCalled();
  expect(mockController.list).not.toHaveBeenCalled();
  expect(mockController.changelog).not.toHaveBeenCalled();
  expect(mockController.refreshList).not.toHaveBeenCalled();
  expect(mockController.refreshUpdates).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cold membership denial stays unavailable without community reads', async () => {
  mockRuntime.hasCachedMembership.mockResolvedValue(false);
  mockRuntime.verifyRoot.mockRejectedValue(
    new MobileSyncRootAccessDeniedError(),
  );
  const renderer = await renderList();

  expect(textInside(renderer)).toContain('Dieser Inhalt ist nicht verfügbar');
  expect(textInside(renderer)).not.toContain('Gespeichertes Feedback');
  expect(mockRuntime.verifyRoot).toHaveBeenCalledWith(
    mockAccountUserId,
    rootEventId,
  );
  expect(mockController.list).not.toHaveBeenCalled();
  expect(mockController.changelog).not.toHaveBeenCalled();
  expect(mockController.refreshList).not.toHaveBeenCalled();
  expect(mockController.refreshUpdates).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
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

test('rechecks manager scope and reuses the same status idempotency key after an honest failure', async () => {
  mockController.managerRole.mockResolvedValue('owner');
  mockController.setStatus
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({
      kind: 'refreshed',
      resolution: {
        feedback: { ...detail, status: 'planned', version: 2 },
        redirectedFromFeedbackId: null,
      },
    });
  const renderer = await renderItem();

  expect(textInside(renderer)).toContain('Owner-Zugriff');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'community-feedback-manager-note' })
      .props.onChangeText('  Öffentlich sichtbar.  '),
  );
  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-manager-status-planned' })
      .props.onPress();
    await flush();
  });
  expect(textInside(renderer)).toContain(
    'Änderung nicht gesendet. Es wurde nichts vorgemerkt.',
  );
  const firstKey = mockController.setStatus.mock.calls[0][4];

  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-manager-status-planned' })
      .props.onPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledTimes(2);
  expect(mockController.setStatus.mock.calls[1][4]).toBe(firstKey);
  expect(mockController.setStatus).toHaveBeenLastCalledWith(
    rootEventId,
    feedbackId,
    'planned',
    'Öffentlich sichtbar.',
    firstKey,
  );
  expect(mockRuntime.verifyRoot).toHaveBeenLastCalledWith(
    mockAccountUserId,
    rootEventId,
    true,
  );
  expect(mockController.managerRole).toHaveBeenCalledWith(rootEventId);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not repeat a committed manager write when its sanitized refresh fails', async () => {
  mockController.managerRole.mockResolvedValue('owner');
  mockController.setStatus.mockResolvedValueOnce({
    kind: 'committed_refresh_failed',
  });
  const renderer = await renderItem();
  const statusButton = renderer.root.findByProps({
    testID: 'community-feedback-manager-status-planned',
  });
  const staleStatusPress = statusButton.props.onPress;

  await ReactTestRenderer.act(async () => {
    await staleStatusPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);
  expect(mockController.setStatus.mock.calls[0][4]).toMatch(/^community-/);
  expect(textInside(renderer)).toContain(
    'Änderung bestätigt. Der aktuelle sichere Stand konnte nicht geladen werden.',
  );
  expect(textInside(renderer)).toContain('sende die Änderung nicht erneut');
  expect(
    renderer.root.findAll(
      node =>
        typeof node.props.testID === 'string' &&
        node.props.testID.startsWith('community-feedback-manager-status-'),
    ),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'community-feedback-vote' }).props
      .disabled,
  ).toBe(true);

  await ReactTestRenderer.act(async () => {
    await staleStatusPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);

  mockController.refresh.mockResolvedValueOnce({
    feedback: { ...detail, status: 'planned', version: 2 },
    redirectedFromFeedbackId: null,
  });
  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'community-feedback-item-refresh' })
      .props.onPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);
  expect(textInside(renderer)).not.toContain('sende die Änderung nicht erneut');
  expect(
    renderer.root.findByProps({
      testID: 'community-feedback-manager-status-planned',
    }).props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals stale in-memory feedback when authoritative verification denies after a committed manager write', async () => {
  mockController.managerRole.mockResolvedValue('owner');
  mockController.setStatus.mockResolvedValueOnce({
    kind: 'committed_refresh_failed',
  });
  const renderer = await renderItem();
  const verificationCount = mockRuntime.verifyRoot.mock.calls.length;
  mockRuntime.verifyRoot
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new MobileSyncRootAccessDeniedError());

  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-manager-status-planned' })
      .props.onPress();
    await flush();
  });

  expect(mockController.setStatus).toHaveBeenCalledTimes(1);
  expect(mockRuntime.verifyRoot).toHaveBeenCalledTimes(verificationCount + 2);
  expect(mockRuntime.verifyRoot).toHaveBeenLastCalledWith(
    mockAccountUserId,
    rootEventId,
    true,
  );
  expect(textInside(renderer)).toContain(
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  );
  expect(textInside(renderer)).not.toContain(detail.title);
  expect(textInside(renderer)).not.toContain(detail.body);
  expect(textInside(renderer)).not.toContain('sende die Änderung nicht erneut');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('restores a durable manager refresh lock after remount and clears it only after safe refresh', async () => {
  mockController.managerRole.mockResolvedValue('owner');
  mockController.setStatus.mockResolvedValueOnce({
    kind: 'committed_refresh_failed',
  });
  const first = await renderItem();
  await ReactTestRenderer.act(async () => {
    await first.root
      .findByProps({ testID: 'community-feedback-manager-status-planned' })
      .props.onPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => first.unmount());

  mockController.managerWritePending.mockResolvedValue(true);
  mockController.refresh.mockRejectedValue(new Error('refresh unavailable'));
  const reopened = await renderItem();
  expect(mockController.managerWritePending).toHaveBeenLastCalledWith(
    rootEventId,
    feedbackId,
  );
  expect(textInside(reopened)).toContain(
    'Aktualisiere den sicheren Stand, bevor du weitere Beiträge sendest.',
  );
  expect(
    reopened.root.findAll(
      node =>
        typeof node.props.testID === 'string' &&
        node.props.testID.startsWith('community-feedback-manager-status-'),
    ),
  ).toHaveLength(0);
  expect(
    reopened.root.findByProps({ testID: 'community-feedback-vote' }).props
      .disabled,
  ).toBe(true);
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);

  mockController.refresh.mockResolvedValueOnce({
    feedback: { ...detail, status: 'planned', version: 2 },
    redirectedFromFeedbackId: null,
  });
  await ReactTestRenderer.act(async () => {
    reopened.root
      .findByProps({ testID: 'community-feedback-item-refresh' })
      .props.onPress();
    await flush();
  });
  expect(textInside(reopened)).not.toContain(
    'Aktualisiere den sicheren Stand, bevor du weitere Beiträge sendest.',
  );
  expect(
    reopened.root.findByProps({
      testID: 'community-feedback-manager-status-completed',
    }).props.disabled,
  ).toBe(false);
  expect(mockController.setStatus).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => reopened.unmount());
});

test('renders only the valid reopen transition for a terminal manager item', async () => {
  const terminal = { ...detail, status: 'completed' as const, version: 2 };
  mockController.getCached.mockResolvedValue(terminal);
  mockController.refresh.mockResolvedValue({
    feedback: terminal,
    redirectedFromFeedbackId: null,
  });
  mockController.managerRole.mockResolvedValue('owner');
  mockController.setStatus.mockResolvedValue({
    kind: 'refreshed',
    resolution: {
      feedback: { ...terminal, status: 'open', version: 3 },
      redirectedFromFeedbackId: null,
    },
  });
  const renderer = await renderItem();

  expect(
    renderer.root.findAllByProps({
      testID: 'community-feedback-manager-status-planned',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({
      testID: 'community-feedback-manager-status-completed',
    }).props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-manager-status-open' })
      .props.onPress();
    await flush();
  });
  expect(mockController.setStatus).toHaveBeenCalledWith(
    rootEventId,
    feedbackId,
    'open',
    '',
    expect.stringMatching(/^community-/),
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('merges only into a sanitized suggestion and redirects to the canonical feedback', async () => {
  mockController.managerRole.mockResolvedValue('organizer');
  const onCanonicalFeedback = jest.fn();
  const renderer = await renderItem({ onCanonicalFeedback });

  expect(mockRuntime.duplicateSuggestions.search).toHaveBeenCalledWith(
    mockAccountUserId,
    rootEventId,
    expect.any(String),
    true,
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({
        testID: 'community-feedback-manager-duplicate-fbk_canonical',
      })
      .props.onPress(),
  );
  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({
        testID: 'community-feedback-manager-duplicate-submit',
      })
      .props.onPress();
    await flush();
  });

  expect(mockController.markDuplicate).toHaveBeenCalledWith(
    rootEventId,
    feedbackId,
    'fbk_canonical',
    '',
    expect.stringMatching(/^community-/),
  );
  expect(onCanonicalFeedback).toHaveBeenCalledWith('fbk_canonical');
  expect(textInside(renderer)).toContain('Meldungen zusammengeführt.');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each(['status', 'duplicate'] as const)(
  'conceals the protected manager screen when %s preflight root verification denies access',
  async action => {
    mockController.managerRole.mockResolvedValue('owner');
    const renderer = await renderItem();
    if (action === 'duplicate') {
      await ReactTestRenderer.act(() =>
        renderer.root
          .findByProps({
            testID: 'community-feedback-manager-duplicate-fbk_canonical',
          })
          .props.onPress(),
      );
    }
    mockRuntime.verifyRoot.mockRejectedValueOnce(
      new MobileSyncRootAccessDeniedError(),
    );

    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({
          testID:
            action === 'status'
              ? 'community-feedback-manager-status-planned'
              : 'community-feedback-manager-duplicate-submit',
        })
        .props.onPress();
      await flush();
    });

    expect(textInside(renderer)).toContain(
      'Geschützte Event- und Feedbackdaten bleiben verborgen',
    );
    expect(mockController.setStatus).not.toHaveBeenCalled();
    expect(mockController.markDuplicate).not.toHaveBeenCalled();
    expect(
      renderer.root.findAll(
        node =>
          typeof node.props.testID === 'string' &&
          node.props.testID.startsWith('community-feedback-manager-'),
      ),
    ).toHaveLength(0);
    await ReactTestRenderer.act(() => renderer.unmount());
  },
);

test('conceals manager actions when the role is stale before the write', async () => {
  mockController.managerRole
    .mockResolvedValueOnce('organizer')
    .mockResolvedValueOnce('organizer')
    .mockResolvedValue(null);
  const renderer = await renderItem();
  expect(textInside(renderer)).toContain('Organizer-Zugriff');

  await ReactTestRenderer.act(async () => {
    await renderer.root
      .findByProps({ testID: 'community-feedback-manager-status-planned' })
      .props.onPress();
    await flush();
  });

  expect(mockController.setStatus).not.toHaveBeenCalled();
  expect(textInside(renderer)).toContain(
    'Manager-Zugriff nicht mehr verfügbar. Die Änderung wurde nicht gesendet.',
  );
  expect(
    renderer.root.findAll(
      node =>
        typeof node.props.testID === 'string' &&
        node.props.testID.startsWith('community-feedback-manager-status-'),
    ),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('ignores a deferred manager redirect after an account switch', async () => {
  mockController.managerRole.mockResolvedValue('owner');
  const merge = deferred<CommunityFeedbackManagerWriteOutcome>();
  mockController.markDuplicate.mockReturnValueOnce(merge.promise);
  const onCanonicalFeedback = jest.fn();
  const renderer = await renderItem({ onCanonicalFeedback });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({
        testID: 'community-feedback-manager-duplicate-fbk_canonical',
      })
      .props.onPress(),
  );
  let flight!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    flight = renderer.root
      .findByProps({
        testID: 'community-feedback-manager-duplicate-submit',
      })
      .props.onPress();
    await flush();
  });
  expect(mockController.markDuplicate).toHaveBeenCalledTimes(1);

  mockLifecycle = { ...mockLifecycle, accountId: mockOtherAccountUserId };
  await ReactTestRenderer.act(async () => {
    renderer.update(itemElement({ onCanonicalFeedback }));
    await flush();
  });
  await ReactTestRenderer.act(async () => {
    merge.resolve({
      kind: 'refreshed',
      resolution: {
        feedback: { ...detail, id: 'fbk_canonical' },
        redirectedFromFeedbackId: feedbackId,
      },
    });
    await flight;
    await flush();
  });
  expect(onCanonicalFeedback).not.toHaveBeenCalled();
  expect(textInside(renderer)).toContain(
    'Geschützte Event- und Feedbackdaten bleiben verborgen',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('bounds pagination at 200 and reports partial truth', async () => {
  const listCursors: (string | undefined)[] = [];
  const listLimits: number[] = [];
  const updatesCursors: (string | undefined)[] = [];
  const updatesLimits: number[] = [];
  const runtime = {
    controller: {
      refreshList: jest.fn((_root, query) => {
        listCursors.push(query.cursor);
        listLimits.push(query.limit);
        const cursor = `list-${listCursors.length}`;
        return Promise.resolve(page([], true, cursor));
      }),
      refreshUpdates: jest.fn((_root, query) => {
        updatesCursors.push(query.cursor);
        updatesLimits.push(query.limit);
        const cursor = `updates-${updatesCursors.length}`;
        return Promise.resolve(page([], true, cursor));
      }),
    },
  };

  await expect(
    refreshCommunityFeedback(runtime as never, rootEventId),
  ).resolves.toEqual({ partial: true });
  expect(listCursors).toEqual([undefined, 'list-1', 'list-2', 'list-3']);
  expect(listLimits).toEqual([10, 10, 10, 10]);
  expect(updatesCursors).toEqual([
    undefined,
    'updates-1',
    'updates-2',
    'updates-3',
  ]);
  expect(updatesLimits).toEqual([50, 50, 50, 50]);
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
