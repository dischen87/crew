import {
  MobileDataStore,
  MobileSyncEngine,
  type EventTreeNode,
  type FeedRecord,
  type MembershipRecord,
  type OutboxItem,
} from '@crew/mobile-data';
import type React from 'react';
import {
  AccessibilityInfo,
  Clipboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { Card } from '../src/design/primitives';
import { colors } from '../src/design/theme';
import { TeamFeedScreen, TeamFeedView } from '../src/screens/TeamFeedScreen';
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
const mockGatewayClient = { request: jest.fn() };
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
    accountId: `usr_${'1'.repeat(32)}`,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => ({
    accountId: `usr_${'1'.repeat(32)}`,
    status: 'ready',
  }),
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

beforeEach(() => {
  jest.restoreAllMocks();
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

test('Option-2 view hardens long German, emoji, delivery truth, keyboard and accessibility', async () => {
  const onSubmit = jest.fn();
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
    accessibilityLabel: 'Nachricht',
    maxLength: TEAM_FEED_MAX_LENGTH,
    multiline: true,
    testID: 'team-feed-input',
  });
  expect(renderer.root.findByType(ScrollView).props).toMatchObject({
    automaticallyAdjustKeyboardInsets: true,
    keyboardShouldPersistTaps: 'handled',
  });
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
    accessibilityActions: [{ label: 'Beitrag kopieren', name: 'copy' }],
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
    accessibilityActions: [{ label: 'Beitrag kopieren', name: 'copy' }],
    accessibilityHint:
      'Aktion verfügbar: Beitrag kopieren. Der Text bleibt lokal.',
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
  expect(announce).toHaveBeenCalledWith('Beitrag kopiert.');
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
    renderer.root.findByProps({ children: 'LETZTE BEITRÄGE' }).props
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
          'Aktion „Beitrag kopieren“',
        ),
    ),
  ).toBeTruthy();

  const helper = renderer.root.findByProps({
    testID: 'team-feed-character-count',
  });
  const helperColor = StyleSheet.flatten(helper.props.style).color as string;
  const helperText = helper.props.children.join('');
  expect(helperText).toContain('Beim Teilen lokal gespeichert');
  expect(helperText).not.toContain('bleibt offline erhalten');
  expect(helperColor).toBe(colors.text);
  expect(
    contrastRatio(helperColor, colors.surfaceAccent),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);

  const submit = renderer.root.findByProps({ testID: 'team-feed-submit' });
  expect(submit.props.accessibilityHint).toContain('genau einen Beitrag');
  await ReactTestRenderer.act(() => submit.props.onPress());
  expect(onSubmit).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test.each([
  [
    'attention',
    true,
    'Mindestens ein Beitrag braucht Aufmerksamkeit. Nutze beim betroffenen Beitrag die Aktion „Beitrag kopieren“; er bleibt lokal.',
  ],
  [
    'sending',
    true,
    'Mindestens ein Beitrag wird synchronisiert und wartet auf Serverbestätigung.',
  ],
  [
    'queued',
    false,
    'Mindestens ein Beitrag ist offline gespeichert. Crew sendet bei der nächsten Verbindung.',
  ],
  ['converged', true, 'Alle sichtbaren Beiträge sind synchronisiert.'],
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

test('Option-2 view blocks blank, oversize, busy and viewer submissions without losing readable states', async () => {
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
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.disabled,
  ).toBe(true);
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
    renderer.root.findByProps({ testID: 'team-feed-submit' }).props.disabled,
  ).toBe(true);
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
      'Der Beitrag wird verarbeitet. Eine zweite Übermittlung ist gesperrt.',
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

test('production route loads the exact scope, queues text and returns without a direct service call', async () => {
  const model = feedModel();
  const runtime = {
    createFeedEntry: jest.fn(async () =>
      outbox('pending', 'fed_new', 'Hoi 👋', 1),
    ),
    loadFeed: jest.fn(async () => model),
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
          'Aktion „Beitrag kopieren“',
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
    'Der Beitrag konnte nicht lokal gespeichert werden. Dein Text bleibt in diesem Feld.',
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
    'Der Beitrag wurde lokal gespeichert, aber der Feed konnte nicht aktualisiert werden. Tippe auf «Feed aktualisieren».',
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
