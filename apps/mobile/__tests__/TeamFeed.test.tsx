import {
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type EventTreeNode,
  type FeedRecord,
  type MembershipRecord,
  type OutboxItem,
} from '@crew/mobile-data';
import type React from 'react';
import {
  AccessibilityInfo,
  Clipboard,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { Card } from '../src/design/primitives';
import { colors, componentMetrics } from '../src/design/theme';
import { TeamFeedScreen, TeamFeedView } from '../src/screens/TeamFeedScreen';
import {
  discardTeamFeedPhoto,
  markTeamFeedPhotoQueued,
  pickTeamFeedPhoto,
  prepareAndUploadTeamFeedPhoto,
  previewTeamFeedPhoto,
  recoveredTeamFeedPhoto,
  type TeamFeedPhotoSelection,
} from '../src/screens/TeamFeedPhotoRuntime';
import {
  TEAM_FEED_MAX_LENGTH,
  TeamProductionRuntime,
  type TeamFeedEntryViewModel,
  type TeamFeedViewModel,
} from '../src/team/TeamProductionRuntime';

const accountUserId = `usr_${'1'.repeat(32)}`;
const otherUserId = `usr_${'2'.repeat(32)}`;
const rootEventId = 'evt_team-root';
const eventId = 'evt_team-session';
const mockDatabase = {};
const otherMockDatabase = {};
const mockGatewayClient = { request: jest.fn() };
const mockUsePreventRemove = jest.fn();
let mockAccountId = accountUserId;
let mockPrivateDatabase = mockDatabase;
let mockOnline = false;
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockAccountId,
    database: mockPrivateDatabase,
  }),
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountId,
    status: 'ready',
  }),
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  usePreventRemove: (...args: unknown[]) => mockUsePreventRemove(...args),
}));

jest.mock('../src/screens/TeamFeedPhotoRuntime', () => ({
  discardTeamFeedPhoto: jest.fn(),
  markTeamFeedPhotoQueued: jest.fn(),
  pickTeamFeedPhoto: jest.fn(),
  prepareAndUploadTeamFeedPhoto: jest.fn(),
  previewTeamFeedPhoto: jest.fn(),
  recoveredTeamFeedPhoto: jest.fn(),
}));

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.mocked(pickTeamFeedPhoto).mockReset();
  jest.mocked(discardTeamFeedPhoto).mockReset();
  jest.mocked(discardTeamFeedPhoto).mockResolvedValue();
  jest.mocked(markTeamFeedPhotoQueued).mockReset();
  jest
    .mocked(markTeamFeedPhotoQueued)
    .mockImplementation(async (_database, value) => ({
      ...value,
      lifecycleState: 'feed_queued',
    }));
  jest.mocked(prepareAndUploadTeamFeedPhoto).mockReset();
  jest.mocked(previewTeamFeedPhoto).mockReset();
  jest
    .mocked(previewTeamFeedPhoto)
    .mockResolvedValue('data:image/png;base64,QUJDRA==');
  jest.mocked(recoveredTeamFeedPhoto).mockReset();
  mockAccountId = accountUserId;
  mockPrivateDatabase = mockDatabase;
  mockOnline = false;
});

test('runtime merges the durable feed and existing outbox into exact delivery states', async () => {
  const runtime = await productionRuntime('participant');
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  jest.spyOn(MobileDataStore.prototype, 'listFeed').mockResolvedValue([
    feedRecord('fed_converged', 'Bereits für alle sichtbar', accountUserId),
    {
      ...feedRecord('fed_root', 'Root-Mitteilung', otherUserId),
      eventId: null,
    },
    {
      ...feedRecord('fed_malformed', 'wird ersetzt', otherUserId),
      payloadJson: '{invalid',
    },
    {
      ...feedRecord('fed_null', 'wird ersetzt', otherUserId),
      payloadJson: '{"text":null}',
    },
  ]);
  jest
    .spyOn(MobileSyncEngine.prototype, 'listOutbox')
    .mockResolvedValue([
      outbox('pending', 'fed_queued', 'Offline mit Emoji 👋', 1),
      outbox('sending', 'fed_sending', 'Wird übertragen', 2),
      outbox('dead_letter', 'fed_attention', 'Bitte prüfen', 3),
    ]);

  const model = await runtime.loadFeed(eventId);

  expect(model).toMatchObject({
    canPost: true,
    eventId,
    eventTitle: 'Team Retreat',
    role: 'participant',
    rootEventId,
  });
  expect(model?.entries.map(item => [item.id, item.deliveryState])).toEqual([
    ['fed_attention', 'attention'],
    ['fed_sending', 'sending'],
    ['fed_queued', 'queued'],
    ['fed_converged', 'converged'],
  ]);
  expect(JSON.stringify(model)).not.toContain('fed_malformed');
  expect(JSON.stringify(model)).not.toContain('fed_null');

  const rootModel = await runtime.loadFeed(null);
  expect(rootModel).toMatchObject({
    eventId: null,
    eventTitle: 'Team-Wochenende',
  });
  expect(rootModel?.entries.map(item => item.id)).toEqual([
    'fed_attention',
    'fed_sending',
    'fed_queued',
    'fed_root',
    'fed_converged',
  ]);
});

test('keeps canonical pulled text visible after its outbox overlay is reconciled', async () => {
  const runtime = await productionRuntime('participant');
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  jest
    .spyOn(MobileDataStore.prototype, 'listFeed')
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      feedRecord('fed_reconnect', 'Participant reconnect check', accountUserId),
    ]);
  jest
    .spyOn(MobileSyncEngine.prototype, 'listOutbox')
    .mockResolvedValueOnce([
      outbox(
        'awaiting_pull',
        'fed_reconnect',
        'Participant reconnect check',
        1,
      ),
    ])
    .mockResolvedValueOnce([]);

  const awaitingPull = await runtime.loadFeed(null);
  expect(awaitingPull?.entries).toEqual([
    expect.objectContaining({
      body: 'Participant reconnect check',
      deliveryState: 'sending',
      id: 'fed_reconnect',
    }),
  ]);

  const converged = await runtime.loadFeed(null);
  expect(converged?.entries).toEqual([
    expect.objectContaining({
      body: 'Participant reconnect check',
      deliveryState: 'converged',
      id: 'fed_reconnect',
    }),
  ]);
});

test('runtime creates one stable feed identity for concurrent submits and validates text before the outbox', async () => {
  const randomUUID = jest.fn(() => '00000000-0000-4000-8000-000000000001');
  const runtime = await productionRuntime('participant', {
    randomUUID,
  });
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  let finish!: (item: OutboxItem) => void;
  const enqueue = jest
    .spyOn(MobileSyncEngine.prototype, 'enqueueMutation')
    .mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      }),
    );

  const first = runtime.createFeedEntry(
    eventId,
    '  Entscheid steht fest 🎉 – Treffpunkt beim Eingang.  ',
  );
  const duplicate = runtime.createFeedEntry(eventId, 'anderer Doppeltipp');

  expect(duplicate).toBe(first);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(enqueue).toHaveBeenCalledWith(
    accountUserId,
    rootEventId,
    'dvc_00000000-0000-4000-8000-000000000001',
    {
      entityId: 'fed_00000000-0000-4000-8000-000000000001',
      kind: 'feed.entry.create',
      payload: {
        content: 'Entscheid steht fest 🎉 – Treffpunkt beim Eingang.',
        eventId,
        kind: 'message',
        parentEntryId: null,
      },
    },
    expect.any(Object),
  );
  expect(randomUUID).toHaveBeenCalledTimes(1);

  finish(outbox('pending', 'fed_stable', 'gespeichert', 1));
  await expect(first).resolves.toMatchObject({ state: 'pending' });
  expect(() => runtime.createFeedEntry(eventId, '   ')).toThrow(
    '1 to 10000 characters',
  );
  expect(() =>
    runtime.createFeedEntry(eventId, 'x'.repeat(TEAM_FEED_MAX_LENGTH + 1)),
  ).toThrow('1 to 10000 characters');
  expect(enqueue).toHaveBeenCalledTimes(1);
});

test('runtime preserves a prebound photo feed ID without a duplicate attachment commit', async () => {
  const randomUUID = jest.fn(() => '00000000-0000-4000-8000-000000000099');
  const runtime = await productionRuntime('participant', { randomUUID });
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  const enqueue = jest
    .spyOn(MobileSyncEngine.prototype, 'enqueueMutation')
    .mockResolvedValue(outbox('pending', 'fed_photo', 'Foto-Update', 1));
  const feedEntryId = 'fed_00000000-0000-4000-8000-000000000010';

  await runtime.createFeedEntry(eventId, 'Foto-Update', feedEntryId);

  expect(randomUUID).not.toHaveBeenCalled();
  expect(enqueue.mock.calls.map(call => call[3])).toEqual([
    {
      entityId: feedEntryId,
      kind: 'feed.entry.create',
      payload: {
        content: 'Foto-Update',
        eventId,
        kind: 'message',
        parentEntryId: null,
      },
    },
  ]);
});

test('runtime rejects an invalid prebound photo feed ID before any outbox write', async () => {
  const runtime = await productionRuntime('participant');
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');

  expect(() =>
    runtime.createFeedEntry(eventId, 'Foto-Update', 'att_wrong-kind'),
  ).toThrow('Invalid team feed entry identity');
  expect(enqueue).not.toHaveBeenCalled();
});

test('runtime rechecks the active account after the event read and performs no feed write after a switch', async () => {
  let activeAccount: string | null = accountUserId;
  const runtime = await productionRuntime('participant', {
    activeAccountUserId: () => activeAccount,
  });
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockImplementation(async () => {
      activeAccount = otherUserId;
      return eventTree();
    });
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');

  await expect(
    runtime.createFeedEntry(eventId, 'Dieser Text darf nicht raus.'),
  ).rejects.toThrow('Active account changed');
  expect(enqueue).not.toHaveBeenCalled();
});

test('feed write fence rejects an enqueue when a parallel refresh completes with viewer authority', async () => {
  let releaseDeviceId!: (value: string) => void;
  let markDeviceReadStarted!: () => void;
  const deviceReadStarted = new Promise<void>(resolve => {
    markDeviceReadStarted = resolve;
  });
  const pendingDeviceId = new Promise<string>(resolve => {
    releaseDeviceId = resolve;
  });
  const getOrCreate = jest
    .fn()
    .mockResolvedValueOnce('dvc_initial')
    .mockImplementationOnce(() => {
      markDeviceReadStarted();
      return pendingDeviceId;
    });
  jest
    .spyOn(MobileDataStore.prototype, 'listMemberships')
    .mockResolvedValueOnce([membership('participant')])
    .mockResolvedValueOnce([membership('viewer')]);
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  jest.spyOn(MobileSyncEngine.prototype, 'syncRoot').mockResolvedValue({
    attentionCount: 0,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'synced',
    summary: 'Synchronisiert',
  });
  jest.spyOn(MemberDirectoryStore.prototype, 'refresh').mockResolvedValue({
    accountUserId,
    cacheVersion: 2,
    refreshedAt: '2026-07-20T12:00:00.000Z',
    rootEventId,
  });
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: mockGatewayClient as never,
    database: mockDatabase as never,
    deviceIdStore: { getOrCreate },
    randomUUID: () => '00000000-0000-4000-8000-000000000002',
    rootEventId,
  });
  if (!runtime) throw new Error('Team runtime missing');

  const write = runtime.createFeedEntry(eventId, 'Nicht nach Downgrade');
  const outcome = write.catch(error => error as Error);
  await deviceReadStarted;
  await runtime.refresh();
  expect(runtime.role).toBe('viewer');
  releaseDeviceId('dvc_after_refresh');

  await expect(outcome).resolves.toMatchObject({
    message: 'Viewers cannot post to the team feed',
  });
  expect(getOrCreate).toHaveBeenCalledTimes(2);
  expect(enqueue).not.toHaveBeenCalled();
});

test('viewer runtime exposes the feed read-only and rejects every post', async () => {
  const runtime = await productionRuntime('viewer');
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  jest.spyOn(MobileDataStore.prototype, 'listFeed').mockResolvedValue([]);
  jest.spyOn(MobileSyncEngine.prototype, 'listOutbox').mockResolvedValue([]);
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');

  await expect(runtime.loadFeed(eventId)).resolves.toMatchObject({
    canPost: false,
    role: 'viewer',
  });
  await expect(
    runtime.createFeedEntry(eventId, 'Nicht erlaubt'),
  ).rejects.toThrow('Viewers cannot post');
  expect(enqueue).not.toHaveBeenCalled();
});

test('refresh immediately adopts a participant-to-viewer snapshot and blocks another enqueue', async () => {
  jest
    .spyOn(MobileDataStore.prototype, 'listMemberships')
    .mockResolvedValueOnce([membership('participant')])
    .mockResolvedValueOnce([membership('viewer')]);
  jest.spyOn(MobileSyncEngine.prototype, 'syncRoot').mockResolvedValue({
    attentionCount: 1,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'needs_attention',
    summary: 'Aktion erforderlich',
  });
  jest.spyOn(MemberDirectoryStore.prototype, 'refresh').mockResolvedValue({
    accountUserId,
    cacheVersion: 2,
    refreshedAt: '2026-07-20T12:00:00.000Z',
    rootEventId,
  });
  jest
    .spyOn(MobileDataStore.prototype, 'listEventTree')
    .mockResolvedValue(eventTree());
  jest.spyOn(MobileDataStore.prototype, 'listFeed').mockResolvedValue([]);
  jest
    .spyOn(MobileSyncEngine.prototype, 'listOutbox')
    .mockResolvedValue([
      outbox('dead_letter', 'fed_rejected', 'Bleibt lokal', 1),
    ]);
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: mockGatewayClient as never,
    database: mockDatabase as never,
    deviceIdStore: {
      getOrCreate: async () => 'dvc_00000000-0000-4000-8000-000000000001',
    },
    randomUUID: () => '00000000-0000-4000-8000-000000000002',
    rootEventId,
  });
  if (!runtime) throw new Error('Team runtime missing');

  await runtime.refresh();

  await expect(runtime.loadFeed(eventId)).resolves.toMatchObject({
    canPost: false,
    entries: [expect.objectContaining({ deliveryState: 'attention' })],
    role: 'viewer',
  });
  await expect(
    runtime.createFeedEntry(eventId, 'Darf nicht erneut queued werden'),
  ).rejects.toThrow('Viewers cannot post');
  expect(enqueue).not.toHaveBeenCalled();
});

test('refresh keeps feed writes fail-closed when the new local membership scope is missing', async () => {
  jest
    .spyOn(MobileDataStore.prototype, 'listMemberships')
    .mockResolvedValueOnce([membership('participant')])
    .mockResolvedValueOnce([]);
  jest.spyOn(MobileSyncEngine.prototype, 'syncRoot').mockResolvedValue({
    attentionCount: 0,
    nextAttemptAt: null,
    pendingCount: 0,
    state: 'synced',
    summary: 'Synchronisiert',
  });
  const directoryRefresh = jest.spyOn(
    MemberDirectoryStore.prototype,
    'refresh',
  );
  const enqueue = jest.spyOn(MobileSyncEngine.prototype, 'enqueueMutation');
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: mockGatewayClient as never,
    database: mockDatabase as never,
    deviceIdStore: {
      getOrCreate: async () => 'dvc_00000000-0000-4000-8000-000000000001',
    },
    randomUUID: () => '00000000-0000-4000-8000-000000000002',
    rootEventId,
  });
  if (!runtime) throw new Error('Team runtime missing');

  await expect(runtime.refresh()).rejects.toBeInstanceOf(
    MobileSyncRootAccessDeniedError,
  );
  expect(runtime.role).toBe('viewer');
  await expect(
    runtime.createFeedEntry(eventId, 'Darf den Scope nicht verlassen'),
  ).rejects.toThrow('Viewers cannot post');
  expect(directoryRefresh).not.toHaveBeenCalled();
  expect(enqueue).not.toHaveBeenCalled();
});

test('Option-2 view hardens long German, emoji, delivery truth, keyboard and accessibility', async () => {
  const onSubmit = jest.fn();
  const dismissKeyboard = jest
    .spyOn(Keyboard, 'dismiss')
    .mockImplementation(() => undefined);
  const entries: TeamFeedEntryViewModel[] = [
    entry('attention', 'Bitte prüfen.'),
    entry('sending', 'Wird gesendet'),
    entry('queued', 'Offline 👋'),
    entry(
      'converged',
      `Synchronisiert ${'sehr ausführliche deutsche Nachricht '.repeat(20)}🎉`,
    ),
  ];
  const renderer = await render(
    <TeamFeedView
      draft="Entscheid steht fest 🎉"
      error={null}
      model={{ ...feedModel(), entries }}
      onBack={jest.fn()}
      onChange={jest.fn()}
      onRefresh={jest.fn()}
      onSubmit={onSubmit}
      online={false}
      submitting={false}
    />,
  );

  const input = renderer.root.findByType(TextInput);
  expect(input.props).toMatchObject({
    accessibilityLabel: 'Update',
    maxLength: TEAM_FEED_MAX_LENGTH,
    multiline: true,
    testID: 'team-feed-input',
  });
  const scroller = renderer.root.findByType(ScrollView);
  expect(scroller.props).toMatchObject({
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: 'interactive',
    keyboardShouldPersistTaps: 'handled',
  });
  expect(scroller.props.onScrollBeginDrag).toBe(dismissKeyboard);
  scroller.props.onScrollBeginDrag();
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  const heading = renderer.root.findByProps({
    accessibilityRole: 'header',
    children: 'Team Retreat',
  });
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.props.numberOfLines).toBeUndefined();
  expect(input.props.onFocus).toEqual(expect.any(Function));
  expect(input.props.onBlur).toEqual(expect.any(Function));
  expect(
    renderer.root
      .findAllByType(Card)
      .filter(node => String(node.props.testID).startsWith('team-feed-entry-')),
  ).toHaveLength(4);
  const longText = renderer.root
    .findAllByType(Text)
    .find(node =>
      String(node.props.children).startsWith(
        'Synchronisiert sehr ausführliche',
      ),
    );
  expect(longText?.props.numberOfLines).toBeUndefined();
  expect(longText?.props).toMatchObject({
    accessibilityActions: [{ label: 'Update kopieren', name: 'copy' }],
    accessibilityRole: 'text',
    accessible: true,
  });
  expect(longText?.props.selectable).toBeUndefined();
  const attentionEntry = renderer.root.findByProps({
    testID: 'team-feed-entry-attention',
  });
  expect(attentionEntry.props.accessible).toBeUndefined();
  expect(attentionEntry.props.role).toBeUndefined();
  const attentionBody = renderer.root.findByProps({
    children: 'Bitte prüfen.',
  });
  expect(attentionBody.props).toMatchObject({
    accessibilityActions: [{ label: 'Update kopieren', name: 'copy' }],
    accessibilityHint:
      'Aktion verfügbar: Update kopieren. Der Text bleibt lokal.',
    accessible: true,
    accessibilityRole: 'text',
  });
  expect(attentionBody.props.accessibilityLabel).toContain('Bitte prüfen');
  expect(attentionBody.props.accessibilityLabel).not.toContain('prüfen..');
  expect(attentionBody.props.accessibilityLabel).not.toContain(
    'langes Drücken',
  );
  expect(attentionBody.props.accessibilityLabel).toContain('19.07.2026');
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(jest.fn());
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(jest.fn());
  await ReactTestRenderer.act(() =>
    attentionBody.props.onAccessibilityAction({
      nativeEvent: { actionName: 'copy' },
    }),
  );
  expect(copy).toHaveBeenCalledWith('Bitte prüfen.');
  expect(announce).toHaveBeenCalledWith('Update kopiert.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-entry-copy-fed_attention' })
      .props.onPress(),
  );
  expect(copy).toHaveBeenCalledTimes(2);
  expect(announce).toHaveBeenCalledTimes(2);
  expect(
    renderer.root.find(
      node =>
        node.props.testID === 'team-feed-entry-status-fed_attention' &&
        node.props.accessibilityRole === 'text',
    ).props,
  ).toMatchObject({
    accessibilityLabel: 'Aktion erforderlich · Text bleibt lokal',
    accessibilityLiveRegion: 'polite',
  });
  expect(renderer.root.findByProps({ accessibilityRole: 'list' })).toBeTruthy();
  expect(
    renderer.root.findByProps({ children: 'LETZTE UPDATES' }).props
      .accessibilityRole,
  ).toBe('header');
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'AKTION ERFORDERLICH' }),
  ).toBeTruthy();
  expect(
    renderer.root.find(
      node =>
        node.props.role === 'status' &&
        String(node.props.accessibilityLabel).includes(
          'Aktion „Update kopieren“',
        ),
    ),
  ).toBeTruthy();

  const helper = renderer.root.findByProps({
    testID: 'team-feed-character-count',
  });
  const helperColor = StyleSheet.flatten(helper.props.style).color as string;
  const helperText = helper.props.children.join('');
  expect(helperText).toContain('Beim Posten zuerst lokal gespeichert');
  expect(helperText).not.toContain('bleibt offline erhalten');
  expect(helperColor).toBe(colors.text);
  expect(
    contrastRatio(helperColor, colors.surfaceAccent),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);

  const submit = renderer.root.findByProps({ testID: 'team-feed-submit' });
  expect(submit.props).toMatchObject({
    accessibilityHint: expect.stringContaining('zuerst auf diesem Gerät'),
    label: 'Update posten',
  });
  await ReactTestRenderer.act(() => submit.props.onPress());
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
  dismissKeyboard.mockRestore();
});

test.each([
  [
    'attention',
    true,
    'Mindestens ein Update braucht Aufmerksamkeit. Nutze beim betroffenen Update die Aktion „Update kopieren“; es bleibt lokal.',
  ],
  [
    'sending',
    true,
    'Mindestens ein Update wird synchronisiert und wartet auf Serverbestätigung.',
  ],
  [
    'queued',
    false,
    'Mindestens ein Update ist offline gespeichert. Crew sendet bei der nächsten Verbindung.',
  ],
  ['converged', true, 'Alle sichtbaren Updates sind synchronisiert.'],
] as const)(
  'announces the %s delivery state without relying on color',
  async (deliveryState, online, expectedLabel) => {
    const renderer = await render(
      <TeamFeedView
        draft=""
        error={null}
        model={{
          ...feedModel(),
          entries: [entry(deliveryState, 'Statusnachricht')],
        }}
        onBack={jest.fn()}
        onChange={jest.fn()}
        onRefresh={jest.fn()}
        onSubmit={jest.fn()}
        online={online}
        submitting={false}
      />,
    );

    expect(
      renderer.root.find(
        node =>
          node.props.role === 'status' &&
          node.props.accessibilityLabel === expectedLabel,
      ),
    ).toBeTruthy();
    await ReactTestRenderer.act(() => renderer.unmount());
  },
);

test('Option-2 view hides unusable submit actions and blocks busy or viewer submissions', async () => {
  const baseProps = {
    error: null,
    model: feedModel(),
    onBack: jest.fn(),
    onChange: jest.fn(),
    onRefresh: jest.fn(),
    onSubmit: jest.fn(),
    online: true,
    submitting: false,
  };
  const renderer = await render(<TeamFeedView {...baseProps} draft="   " />);
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-submit' }),
  ).toHaveLength(0);
  expect(renderer.root.findByType(TextInput).props.accessibilityHint).toContain(
    'sichtbares Zeichen',
  );

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView
          {...baseProps}
          draft={'x'.repeat(TEAM_FEED_MAX_LENGTH + 1)}
        />
      </SafeAreaProvider>,
    );
  });
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-submit' }),
  ).toHaveLength(0);
  expect(renderer.root.findByType(TextInput).props.accessibilityHint).toContain(
    "10'000 Zeichen",
  );

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView {...baseProps} draft="Bereit" submitting />
      </SafeAreaProvider>,
    );
  });
  expect(
    renderer.root.find(
      node =>
        node.props.testID === 'team-feed-submit' &&
        node.props.accessibilityRole === 'button',
    ).props.accessibilityState,
  ).toMatchObject({ busy: true, disabled: true });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props,
  ).toMatchObject({
    accessibilityHint:
      'Das Update wird verarbeitet. Eine zweite Übermittlung ist gesperrt.',
    label: 'Wird verarbeitet …',
  });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-refresh' }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-back' }).props.disabled,
  ).toBe(true);

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView
          {...baseProps}
          draft="Nicht erlaubt"
          model={{ ...feedModel(), canPost: false, role: 'viewer' }}
        />
      </SafeAreaProvider>,
    );
  });
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-submit' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'NUR ANSEHEN' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('Option-2 photo controls expose online, selected, retry and offline states without relying on color', async () => {
  const onPickPhoto = jest.fn();
  const baseProps = {
    draft: 'Foto vom Treffpunkt',
    error: null,
    model: feedModel(),
    onBack: jest.fn(),
    onChange: jest.fn(),
    onPickPhoto,
    onRefresh: jest.fn(),
    onSubmit: jest.fn(),
    online: true,
    submitting: false,
  };
  const renderer = await render(
    <TeamFeedView
      {...baseProps}
      photo={{
        available: true,
        feedQueued: false,
        message: null,
        messageKind: null,
        phase: 'empty',
        previewDataUri: null,
        reselect: false,
      }}
    />,
  );

  const picker = renderer.root.findByProps({
    testID: 'team-feed-photo-pick',
  });
  expect(picker.props).toMatchObject({
    disabled: false,
    label: 'Foto auswählen',
  });
  expect(picker.props.accessibilityHint).toContain('genau ein Bild');
  await ReactTestRenderer.act(() => picker.props.onPress());
  expect(onPickPhoto).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView
          {...baseProps}
          photo={{
            available: true,
            feedQueued: false,
            message: 'Ein Foto ist ausgewählt.',
            messageKind: 'info',
            phase: 'selected',
            previewDataUri: 'data:image/png;base64,QUJDRA==',
            reselect: false,
          }}
        />
      </SafeAreaProvider>,
    );
  });
  expect(
    renderer.root.findByProps({ accessibilityLabel: '1 FOTO AUSGEWÄHLT' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props
      .children,
  ).toBe('Ein Foto ist ausgewählt.');
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-preview' }).props,
  ).toMatchObject({
    accessibilityLabel: 'Vorschau des ausgewählten Team-Fotos.',
    source: { uri: 'data:image/png;base64,QUJDRA==' },
  });

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView
          {...baseProps}
          draft=""
          photo={{
            available: true,
            feedQueued: true,
            message: 'Foto wartet auf erneutes Senden.',
            messageKind: 'error',
            phase: 'selected',
            previewDataUri: 'data:image/png;base64,QUJDRA==',
            reselect: false,
          }}
        />
      </SafeAreaProvider>,
    );
  });
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props,
  ).toMatchObject({ disabled: false, label: 'Foto erneut senden' });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props,
  ).toMatchObject({
    accessibilityLiveRegion: 'assertive',
    accessibilityRole: 'alert',
  });

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <TeamFeedView
          {...baseProps}
          photo={{
            available: false,
            feedQueued: false,
            message: null,
            messageKind: null,
            phase: 'empty',
            previewDataUri: null,
            reselect: false,
          }}
        />
      </SafeAreaProvider>,
    );
  });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-pick' }).props,
  ).toMatchObject({
    accessibilityHint: expect.stringContaining('lokal gespeichert'),
    disabled: true,
  });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production route loads the exact scope, queues text and returns without a direct service call', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_new', 'Hoi 👋', 1),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  const create = jest
    .spyOn(TeamProductionRuntime, 'create')
    .mockResolvedValue(runtime);
  const goBack = jest.fn();
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountUserId,
      client: mockGatewayClient,
      database: mockDatabase,
      rootEventId,
    }),
  );
  expect(runtime.loadFeed).toHaveBeenCalledWith(eventId);
  const input = renderer.root.findByProps({ testID: 'team-feed-input' });
  await ReactTestRenderer.act(() => input.props.onChangeText('Hoi Team 👋'));
  const submit = renderer.root.findByProps({ testID: 'team-feed-submit' });
  await ReactTestRenderer.act(async () => submit.props.onPress());
  expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);
  expect(runtime.createFeedEntry).toHaveBeenCalledWith(eventId, 'Hoi Team 👋');
  expect(mockGatewayClient.request).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'team-feed-back' }).props.onPress(),
  );
  expect(goBack).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production route preserves feed-before-authoritative-photo-finalize ordering', async () => {
  mockOnline = true;
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_photo', 'Foto vom Treffpunkt', 1),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  jest.mocked(prepareAndUploadTeamFeedPhoto).mockResolvedValue('upl_photo');
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );
  jest.mocked(runtime.refresh).mockClear();
  jest.mocked(runtime.loadFeed).mockClear();

  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ accessibilityLabel: '1 FOTO AUSGEWÄHLT' }),
  ).toBeTruthy();
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  expect(runtime.createFeedEntry).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Foto vom Treffpunkt'),
  );
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );

  expect(runtime.createFeedEntry).toHaveBeenCalledWith(
    eventId,
    'Foto vom Treffpunkt',
    selection.feedEntryId,
  );
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledWith({
    activeAccountUserId: expect.any(Function),
    client: mockGatewayClient,
    database: mockDatabase,
    selection: { ...selection, lifecycleState: 'feed_queued' },
  });
  expect(markTeamFeedPhotoQueued).toHaveBeenCalledWith(mockDatabase, {
    ...selection,
    lifecycleState: 'feed_queued',
  });
  const createOrder = jest.mocked(runtime.createFeedEntry).mock
    .invocationCallOrder[0] as number;
  const markOrder = jest.mocked(markTeamFeedPhotoQueued).mock
    .invocationCallOrder[0] as number;
  const firstRefreshOrder = jest.mocked(runtime.refresh).mock
    .invocationCallOrder[0] as number;
  const uploadOrder = jest.mocked(prepareAndUploadTeamFeedPhoto).mock
    .invocationCallOrder[0] as number;
  const secondRefreshOrder = jest.mocked(runtime.refresh).mock
    .invocationCallOrder[1] as number;
  expect(createOrder).toBeLessThan(markOrder);
  expect(markOrder).toBeLessThan(firstRefreshOrder);
  expect(firstRefreshOrder).toBeLessThan(uploadOrder);
  expect(uploadOrder).toBeLessThan(secondRefreshOrder);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props
      .children,
  ).toContain('sicher geprüft');
  expect(
    renderer.root.findByProps({ testID: 'team-feed-input' }).props.value,
  ).toBe('');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offline photo selection queues one feed and resumes finalize after reconnect', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_photo', 'Offline-Foto', 1),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  jest.mocked(prepareAndUploadTeamFeedPhoto).mockResolvedValue('upl_photo');
  const screen = () => (
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-offline-photo',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />
  );
  const renderer = await render(screen());

  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-pick' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Offline-Foto'),
  );
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );

  expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);
  expect(markTeamFeedPhotoQueued).toHaveBeenCalledWith(mockDatabase, {
    ...selection,
    lifecycleState: 'feed_queued',
  });
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  expect(mockGatewayClient.request).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.label,
  ).toBe('Foto erneut senden');

  mockOnline = true;
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>{screen()}</SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );

  expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledTimes(1);
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledWith({
    activeAccountUserId: expect.any(Function),
    client: mockGatewayClient,
    database: mockDatabase,
    selection: { ...selection, lifecycleState: 'feed_queued' },
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('selected photo has an accessible 48pt remove action and purges exactly once', async () => {
  mockOnline = true;
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-remove-photo',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Text bleibt'),
  );
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );

  expect(previewTeamFeedPhoto).toHaveBeenCalledWith(selection);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-preview' }).props,
  ).toMatchObject({
    accessibilityLabel: 'Vorschau des ausgewählten Team-Fotos.',
    source: { uri: 'data:image/png;base64,QUJDRA==' },
  });
  const remove = renderer.root.findByProps({
    testID: 'team-feed-photo-remove',
  });
  expect(remove.props.label).toBe('Foto entfernen');
  expect(remove.props.accessibilityHint).toContain('Text bleibt unverändert');
  const removeControl = renderer.root.findByProps({
    accessibilityLabel: 'Foto entfernen',
  });
  expect(
    StyleSheet.flatten(removeControl.props.style({ pressed: false })).minHeight,
  ).toBeGreaterThanOrEqual(componentMetrics.control.minimumTouchSize);
  await ReactTestRenderer.act(async () => remove.props.onPress());

  expect(discardTeamFeedPhoto).toHaveBeenCalledWith(mockDatabase, selection);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-input' }).props.value,
  ).toBe('Text bleibt');
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-photo-remove' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
  expect(discardTeamFeedPhoto).toHaveBeenCalledTimes(1);
});

test('native removal and synchronous back stay blocked during a deferred local photo create', async () => {
  mockOnline = true;
  const model = feedModel();
  let resolveCreate!: (value: OutboxItem) => void;
  const runtime = {
    createFeedEntry: jest.fn(
      () =>
        new Promise<OutboxItem>(resolve => {
          resolveCreate = resolve;
        }),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  const goBack = jest.fn();
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack } as never}
      route={{
        key: 'team-feed-deferred-create',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Bleibt sicher'),
  );
  const submit = renderer.root.findByProps({ testID: 'team-feed-submit' });
  const back = renderer.root.findByProps({ testID: 'team-feed-back' });

  await ReactTestRenderer.act(async () => {
    submit.props.onPress();
    back.props.onPress();
    await Promise.resolve();
  });

  expect(goBack).not.toHaveBeenCalled();
  expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
  expect(
    mockUsePreventRemove.mock.calls[
      mockUsePreventRemove.mock.calls.length - 1
    ]?.[0],
  ).toBe(true);

  await ReactTestRenderer.act(() => renderer.unmount());
  expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    resolveCreate(outbox('pending', selection.feedEntryId, 'Bleibt sicher', 1));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(markTeamFeedPhotoQueued).not.toHaveBeenCalled();
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
});

test('unmount invalidates a deferred upload without deleting its queued media', async () => {
  mockOnline = true;
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_photo', 'Upload läuft', 1),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  let resolveUpload!: (uploadId: string) => void;
  jest.mocked(prepareAndUploadTeamFeedPhoto).mockImplementation(
    () =>
      new Promise<string>(resolve => {
        resolveUpload = resolve;
      }),
  );
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-deferred-upload',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );
  jest.mocked(runtime.refresh).mockClear();
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Upload läuft'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledTimes(1);
  expect(runtime.refresh).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
  await ReactTestRenderer.act(async () => {
    resolveUpload('upl_photo');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
  expect(runtime.refresh).toHaveBeenCalledTimes(1);
});

test('recovered feed photo resumes without creating a duplicate feed entry', async () => {
  mockOnline = true;
  const model = feedModel();
  const selection = {
    ...photoSelection(),
    lifecycleState: 'feed_queued' as const,
    uploadId: 'upl_recovered',
  };
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => ({
      attachment: selection.prepared.attachment,
      eventId,
      state: 'feed_queued' as const,
      uploadGeneration: 1,
      uploadId: 'upl_recovered',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    })),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  jest.mocked(recoveredTeamFeedPhoto).mockReturnValue(selection);
  jest.mocked(prepareAndUploadTeamFeedPhoto).mockResolvedValue('upl_recovered');
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-recovered-photo',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  expect(previewTeamFeedPhoto).toHaveBeenCalledWith(selection);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-preview' }).props
      .source,
  ).toEqual({ uri: 'data:image/png;base64,QUJDRA==' });
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );
  expect(runtime.createFeedEntry).not.toHaveBeenCalled();
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledWith({
    activeAccountUserId: expect.any(Function),
    client: mockGatewayClient,
    database: mockDatabase,
    selection,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('transient recovered preview failure preserves the queued photo retry', async () => {
  const selection = {
    ...photoSelection(),
    lifecycleState: 'feed_queued' as const,
    uploadId: 'upl_retry',
  };
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => feedModel()),
    recoverFeedPhoto: jest.fn(async () => ({
      attachment: selection.prepared.attachment,
      eventId,
      state: 'feed_queued' as const,
      uploadGeneration: 1,
      uploadId: 'upl_retry',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    })),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  jest.mocked(recoveredTeamFeedPhoto).mockReturnValue(selection);
  jest
    .mocked(previewTeamFeedPhoto)
    .mockRejectedValueOnce(new Error('attachment_media_preview_failed'));
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-transient-preview',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props
      .children,
  ).toContain('vorübergehend');
  expect(
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.label,
  ).toBe('Foto erneut senden');
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-photo-preview' }),
  ).toHaveLength(0);
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('missing recovered media is discarded and reselected onto the existing feed without a gateway call', async () => {
  mockOnline = true;
  const selection = {
    ...photoSelection(),
    lifecycleState: 'feed_queued' as const,
    uploadId: 'upl_missing',
  };
  const model = {
    ...feedModel(),
    entries: [entry('queued', 'Dieser Text bleibt lokal gespeichert.')],
  };
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => ({
      attachment: selection.prepared.attachment,
      eventId,
      state: 'feed_queued' as const,
      uploadGeneration: 1,
      uploadId: 'upl_missing',
      createdAt: '2026-07-20T12:00:00.000Z',
      updatedAt: '2026-07-20T12:00:00.000Z',
    })),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  jest.mocked(recoveredTeamFeedPhoto).mockReturnValue(selection);
  jest
    .mocked(previewTeamFeedPhoto)
    .mockRejectedValueOnce(new Error('attachment_media_missing'));
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-missing-photo',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  expect(discardTeamFeedPhoto).toHaveBeenCalledWith(mockDatabase, selection);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-pick' }).props.label,
  ).toBe('Foto neu auswählen');
  expect(
    renderer.root.findByProps({ testID: 'team-feed-entry-queued' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-photo-preview' }),
  ).toHaveLength(0);
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  expect(mockGatewayClient.request).not.toHaveBeenCalled();

  jest.mocked(pickTeamFeedPhoto).mockResolvedValue({
    ...photoSelection(),
    lifecycleState: 'selected',
    uploadId: null,
  });
  jest
    .mocked(prepareAndUploadTeamFeedPhoto)
    .mockResolvedValue('upl_reselected');
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  expect(pickTeamFeedPhoto).toHaveBeenCalledWith(
    mockDatabase,
    accountUserId,
    rootEventId,
    eventId,
    selection.feedEntryId,
  );
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );
  expect(runtime.createFeedEntry).not.toHaveBeenCalled();
  expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  ['attachment_media_missing', true],
  ['attachment_media_unsafe', true],
  ['attachment_media_invalid', false],
] as const)(
  'upload media failure %s preserves retryable media and discards terminal local media',
  async (failureCode, discardExpected) => {
    mockOnline = true;
    const model = {
      ...feedModel(),
      entries: [entry('queued', 'Dieser Text bleibt lokal gespeichert.')],
    };
    const runtime = {
      createFeedEntry: jest.fn(async () =>
        outbox(
          'pending',
          photoSelection().feedEntryId,
          'Dieser Text bleibt lokal gespeichert.',
          1,
        ),
      ),
      loadFeed: jest.fn(async () => model),
      recoverFeedPhoto: jest.fn(async () => null),
      refresh: jest.fn(async () => undefined),
    } as unknown as TeamProductionRuntime;
    jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
    const selection = photoSelection();
    const queuedSelection = {
      ...selection,
      lifecycleState: 'feed_queued' as const,
    };
    jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
    jest
      .mocked(prepareAndUploadTeamFeedPhoto)
      .mockRejectedValueOnce(new Error(failureCode))
      .mockResolvedValueOnce('upl_replacement');
    const renderer = await render(
      <TeamFeedScreen
        navigation={{ goBack: jest.fn() } as never}
        route={{
          key: 'team-feed-terminal-upload',
          name: 'TeamFeed',
          params: { eventId, rootEventId },
        }}
      />,
    );
    await ReactTestRenderer.act(async () =>
      renderer.root
        .findByProps({ testID: 'team-feed-photo-pick' })
        .props.onPress(),
    );
    await ReactTestRenderer.act(() =>
      renderer.root
        .findByProps({ testID: 'team-feed-input' })
        .props.onChangeText('Dieser Text bleibt lokal gespeichert.'),
    );
    await ReactTestRenderer.act(async () =>
      renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
    );

    if (!discardExpected) {
      expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
      expect(
        renderer.root.findByProps({ testID: 'team-feed-submit' }).props.label,
      ).toBe('Foto erneut senden');
      await ReactTestRenderer.act(async () =>
        renderer.root
          .findByProps({ testID: 'team-feed-submit' })
          .props.onPress(),
      );
      expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);
      expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledTimes(2);
      await ReactTestRenderer.act(() => renderer.unmount());
      return;
    }

    expect(discardTeamFeedPhoto).toHaveBeenCalledWith(
      mockDatabase,
      queuedSelection,
    );
    expect(
      renderer.root.findByProps({ testID: 'team-feed-photo-pick' }).props.label,
    ).toBe('Foto neu auswählen');
    expect(
      renderer.root.findByProps({ testID: 'team-feed-entry-queued' }),
    ).toBeTruthy();
    expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);

    jest.mocked(pickTeamFeedPhoto).mockResolvedValue({
      ...selection,
      lifecycleState: 'selected',
      uploadId: null,
    });
    await ReactTestRenderer.act(async () =>
      renderer.root
        .findByProps({ testID: 'team-feed-photo-pick' })
        .props.onPress(),
    );
    expect(pickTeamFeedPhoto).toHaveBeenLastCalledWith(
      mockDatabase,
      accountUserId,
      rootEventId,
      eventId,
      selection.feedEntryId,
    );
    await ReactTestRenderer.act(async () =>
      renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
    );

    expect(runtime.createFeedEntry).toHaveBeenCalledTimes(1);
    expect(prepareAndUploadTeamFeedPhoto).toHaveBeenCalledTimes(2);
    await ReactTestRenderer.act(() => renderer.unmount());
  },
);

test('same-scope recovery restart never discards a successfully restored selected photo', async () => {
  const selection = photoSelection();
  const recovered = {
    attachment: selection.prepared.attachment,
    eventId,
    state: 'selected' as const,
    uploadGeneration: 1,
    uploadId: null,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => feedModel()),
    recoverFeedPhoto: jest.fn(async () => recovered),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  jest.mocked(recoveredTeamFeedPhoto).mockReturnValue(selection);
  let resolveFirstPreview!: (value: string) => void;
  jest
    .mocked(previewTeamFeedPhoto)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveFirstPreview = resolve;
        }),
    )
    .mockResolvedValueOnce('data:image/png;base64,U0VDT05E');
  const screen = () => (
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-same-scope-preview',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />
  );
  const renderer = await render(screen());

  mockOnline = true;
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>{screen()}</SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-preview' }).props
      .source,
  ).toEqual({ uri: 'data:image/png;base64,U0VDT05E' });

  await ReactTestRenderer.act(async () => {
    resolveFirstPreview('data:image/png;base64,RklSU1Q=');
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(discardTeamFeedPhoto).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-preview' }).props
      .source,
  ).toEqual({ uri: 'data:image/png;base64,U0VDT05E' });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('late preview from the previous account is discarded and never published', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const selection = photoSelection();
  jest.mocked(pickTeamFeedPhoto).mockResolvedValue(selection);
  let resolvePreview!: (value: string) => void;
  jest.mocked(previewTeamFeedPhoto).mockReturnValue(
    new Promise(resolve => {
      resolvePreview = resolve;
    }),
  );
  const screen = () => (
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed-late-preview',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />
  );
  const renderer = await render(screen());

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress();
    await Promise.resolve();
  });
  expect(previewTeamFeedPhoto).toHaveBeenCalledWith(selection);

  mockAccountId = otherUserId;
  mockPrivateDatabase = otherMockDatabase;
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>{screen()}</SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    resolvePreview('data:image/png;base64,TEFURQ==');
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(
    renderer.root.findAllByProps({ testID: 'team-feed-photo-preview' }),
  ).toHaveLength(0);
  expect(discardTeamFeedPhoto).toHaveBeenCalledWith(mockDatabase, selection);
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('picker cancel and failure leave the text-only post path available', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_text', 'Text bleibt möglich', 1),
    ),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  jest.mocked(pickTeamFeedPhoto).mockResolvedValueOnce(null);
  mockOnline = true;
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props,
  ).toMatchObject({ accessibilityLiveRegion: 'polite' });
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props
      .children,
  ).toContain('Keine Fotoauswahl');

  jest
    .mocked(pickTeamFeedPhoto)
    .mockRejectedValueOnce(new Error('attachment_media_picker_failed'));
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'team-feed-photo-pick' })
      .props.onPress(),
  );
  expect(
    renderer.root.findByProps({ testID: 'team-feed-photo-status' }).props,
  ).toMatchObject({ accessibilityRole: 'alert' });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Text bleibt möglich'),
  );
  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress(),
  );
  expect(runtime.createFeedEntry).toHaveBeenCalledWith(
    eventId,
    'Text bleibt möglich',
  );
  expect(prepareAndUploadTeamFeedPhoto).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production route exposes a rejected queued entry as an assistive attention transition', async () => {
  const queued = {
    ...feedModel(),
    entries: [entry('queued', 'Bleibt lokal erhalten.')],
  };
  const attention = {
    ...feedModel(),
    entries: [entry('attention', 'Bleibt lokal erhalten.')],
  };
  let refreshed = false;
  const runtime = {
    createFeedEntry: jest.fn(),
    loadFeed: jest.fn(async () => (refreshed ? attention : queued)),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => {
      refreshed = true;
    }),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const screen = () => (
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />
  );
  const renderer = await render(screen());

  expect(
    renderer.root.findByProps({ testID: 'team-feed-entry-queued' }),
  ).toBeTruthy();

  mockOnline = true;
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>{screen()}</SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(runtime.refresh).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findByProps({ testID: 'team-feed-entry-attention' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({
      testID: 'team-feed-entry-copy-fed_attention',
    }),
  ).toBeTruthy();
  expect(
    renderer.root.find(
      node =>
        node.props.role === 'status' &&
        String(node.props.accessibilityLabel).includes(
          'Aktion „Update kopieren“',
        ),
    ),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production route keeps unsaved text in the field when the durable enqueue fails', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () => {
      throw new Error('local write failed');
    }),
    loadFeed: jest.fn(async () => model),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Noch nicht gespeichert'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(
    renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children,
  ).toBe(
    'Das Update konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Feld.',
  );
  expect(
    renderer.root.findByProps({ testID: 'team-feed-input' }).props.value,
  ).toBe('Noch nicht gespeichert');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production route clears a durably saved draft and names refresh when projection loading fails', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_saved', 'Lokal gesichert', 1),
    ),
    loadFeed: jest
      .fn()
      .mockResolvedValueOnce(model)
      .mockResolvedValueOnce(model)
      .mockRejectedValueOnce(new Error('projection unavailable')),
    recoverFeedPhoto: jest.fn(async () => null),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const renderer = await render(
    <TeamFeedScreen
      navigation={{ goBack: jest.fn() } as never}
      route={{
        key: 'team-feed',
        name: 'TeamFeed',
        params: { eventId, rootEventId },
      }}
    />,
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'team-feed-input' })
      .props.onChangeText('Lokal gesichert'),
  );
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.onPress();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(
    renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children,
  ).toBe(
    'Das Update wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».',
  );
  expect(
    renderer.root.findByProps({ testID: 'team-feed-input' }).props.value,
  ).toBe('');
  expect(
    renderer.root.findByProps({ testID: 'team-feed-refresh' }).props.disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function productionRuntime(
  role: MembershipRecord['role'],
  options: {
    activeAccountUserId?: () => string | null;
    randomUUID?: () => string;
  } = {},
) {
  jest
    .spyOn(MobileDataStore.prototype, 'listMemberships')
    .mockResolvedValue([membership(role)]);
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: options.activeAccountUserId ?? (() => accountUserId),
    client: null,
    database: mockDatabase as never,
    deviceIdStore: {
      getOrCreate: async () => 'dvc_00000000-0000-4000-8000-000000000001',
    },
    randomUUID:
      options.randomUUID ?? (() => '00000000-0000-4000-8000-000000000002'),
    rootEventId,
  });
  if (!runtime) throw new Error('Team runtime missing');
  return runtime;
}

function membership(role: MembershipRecord['role']): MembershipRecord {
  return {
    accountUserId,
    createdAt: '2026-07-19T08:00:00.000Z',
    memberUserId: accountUserId,
    role,
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function eventTree(): EventTreeNode[] {
  return [
    event(rootEventId, null, 'Team-Wochenende'),
    event(eventId, rootEventId, 'Team Retreat'),
  ];
}

function event(
  id: string,
  parentEventId: string | null,
  title: string,
): EventTreeNode {
  return {
    accountUserId,
    childOrderVersion: '1',
    createdAt: '2026-07-19T08:00:00.000Z',
    deletedAt: null,
    description: null,
    depth: parentEventId ? 1 : 0,
    endsAt: null,
    id,
    itineraryOrderVersion: '1',
    kind: parentEventId ? 'team_event' : 'trip',
    parentEventId,
    rootEventId,
    sortKey: 'a',
    startsAt: null,
    status: 'published',
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function feedRecord(id: string, text: string, actorUserId: string): FeedRecord {
  return {
    accountUserId,
    actorUserId,
    createdAt: '2026-07-19T08:00:00.000Z',
    createdRootRevision: '7',
    deletedAt: null,
    eventId,
    id,
    kind: 'message',
    parentEntryId: null,
    payloadJson: JSON.stringify({ text }),
    payloadSchemaVersion: 1,
    revisionOrdinal: 1,
    rootEventId,
    rootRevision: '7',
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function outbox(
  state: OutboxItem['state'],
  id: string,
  content: string,
  sequence: number,
): OutboxItem {
  const clientMutationId = `00000000-0000-4000-8000-${String(sequence).padStart(
    12,
    '0',
  )}`;
  return {
    accountUserId,
    appliedRootRevision: null,
    attempts: 0,
    clientMutationId,
    clientSequence: sequence,
    command: {
      clientMutationId,
      clientSequence: sequence,
      entityId: id,
      kind: 'feed.entry.create',
      payload: { content, eventId, kind: 'message', parentEntryId: null },
    },
    createdAt: `2026-07-19T08:0${sequence}:00.000Z`,
    deviceId: 'dvc_00000000-0000-4000-8000-000000000001',
    lastError: null,
    nextAttemptAt: null,
    operationId: 'syncMutationsApply',
    optimisticOverlay: null,
    rootEventId,
    serverConsumed: false,
    state,
    updatedAt: `2026-07-19T08:0${sequence}:00.000Z`,
  };
}

function feedModel(): TeamFeedViewModel {
  return {
    canPost: true,
    entries: [],
    eventId,
    eventTitle: 'Team Retreat',
    role: 'participant',
    rootEventId,
  };
}

function photoSelection(): TeamFeedPhotoSelection {
  const photoSha = 'b'.repeat(64);
  const feedEntryId = 'fed_00000000-0000-4000-8000-000000000010';
  return {
    feedEntryId,
    lifecycleState: 'selected',
    prepared: {
      attachment: {
        accountUserId,
        attachmentId: 'att_00000000-0000-4000-8000-000000000011',
        rootEventId,
        targetEntryId: feedEntryId,
        retainedFileKey: `${photoSha}.jpg`,
        contentType: 'image/jpeg',
        byteCount: 1234,
        sha256: photoSha,
        pixelWidth: 640,
        pixelHeight: 480,
        wasNormalized: true,
        retainedAt: '2026-07-20T12:00:00.000Z',
      },
      uploadPreparation: {
        attachmentId: 'att_00000000-0000-4000-8000-000000000011',
        targetEntryId: feedEntryId,
        contentType: 'image/jpeg',
        byteCount: 1234,
        sha256: photoSha,
      },
    },
    uploadGeneration: 1,
    uploadId: null,
  };
}

function entry(
  deliveryState: TeamFeedEntryViewModel['deliveryState'],
  body: string,
): TeamFeedEntryViewModel {
  const labels = {
    attention: 'Aktion erforderlich · Text bleibt lokal',
    converged: 'Synchronisiert',
    queued: 'Lokal gespeichert · wartet auf Verbindung',
    sending: 'Wird synchronisiert',
  };
  return {
    author: 'Du',
    body,
    createdAt: '2026-07-19T08:00:00.000Z',
    deliveryLabel: labels[deliveryState],
    deliveryState,
    id: `fed_${deliveryState}`,
  };
}

async function render(node: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return renderer;
}
