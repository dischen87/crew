import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { Button } from '../src/design/primitives';
import { colors, typography } from '../src/design/theme';
import {
  EventHubView,
  focusedTimelineScrollY,
  turkeyGolfEventHubModel,
  type EventHubModel,
  type EventHubTab,
} from '../src/screens/EventHubView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');

function setFontScale(fontScale: number) {
  Dimensions.set({
    screen: { ...originalScreen, fontScale },
    window: { ...originalWindow, fontScale },
  });
}

beforeEach(() => setFontScale(1));
afterAll(() =>
  Dimensions.set({ screen: originalScreen, window: originalWindow }),
);

async function renderHub(
  model: EventHubModel = turkeyGolfEventHubModel,
  overrides: Partial<React.ComponentProps<typeof EventHubView>> = {},
  initialMetrics = metrics,
) {
  const props: React.ComponentProps<typeof EventHubView> = {
    model,
    onDateSelect: jest.fn(),
    onManageInvites: jest.fn(),
    onPrimaryAction: jest.fn(),
    onSyncStatusPress: jest.fn(),
    onTabSelect: jest.fn(),
    onTimelineSelect: jest.fn(),
    selectedTab: 'plan',
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={initialMetrics}>
        <EventHubView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer: renderer! };
}

test('keeps scrolling content below the live top safe area without a double inset', async () => {
  const ios = await renderHub();
  const iosScroll = ios.renderer.root
    .findAllByType(ScrollView)
    .find(node => !node.props.horizontal)!;
  expect(StyleSheet.flatten(iosScroll.props.style)).toMatchObject({
    marginTop: 47,
  });
  expect(
    StyleSheet.flatten(iosScroll.props.contentContainerStyle),
  ).toMatchObject({ paddingTop: 0 });
  await ReactTestRenderer.act(() => ios.renderer.unmount());

  const zeroInset = await renderHub(
    turkeyGolfEventHubModel,
    {},
    {
      ...metrics,
      insets: { ...metrics.insets, top: 0 },
    },
  );
  const zeroInsetScroll = zeroInset.renderer.root
    .findAllByType(ScrollView)
    .find(node => !node.props.horizontal)!;
  expect(StyleSheet.flatten(zeroInsetScroll.props.style)).toMatchObject({
    marginTop: 0,
  });
  expect(
    StyleSheet.flatten(zeroInsetScroll.props.contentContainerStyle),
  ).toMatchObject({ paddingTop: 12 });
  await ReactTestRenderer.act(() => zeroInset.renderer.unmount());
});

test('offers exactly one primary action and only working bottom tabs', async () => {
  const onPrimaryAction = jest.fn();
  const onTabSelect = jest.fn();
  const { renderer } = await renderHub(turkeyGolfEventHubModel, {
    onPrimaryAction,
    onTabSelect,
  });

  expect(turkeyGolfEventHubModel.dates.map(date => date.weekday)).toEqual([
    'FR',
    'SA',
    'SO',
    'MO',
    'DI',
    'DO',
  ]);

  const primaryActions = renderer.root
    .findAllByType(Button)
    .filter(node => node.props.testID === 'event-hub-primary-action');
  expect(primaryActions).toHaveLength(1);
  expect(primaryActions[0].props.accessibilityHint).toContain(
    'ohne Eventdaten zu ändern',
  );

  await ReactTestRenderer.act(() => primaryActions[0].props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith(
    turkeyGolfEventHubModel.primaryAction,
  );

  const availableTabs: EventHubTab[] = ['plan', 'feed', 'more'];
  for (const tab of availableTabs) {
    const item = renderer.root.find(
      node =>
        node.props.testID === `event-hub-tab-${tab}` &&
        node.props.accessibilityRole === 'tab',
    );
    await ReactTestRenderer.act(() => item.props.onPress());
  }
  expect(onTabSelect.mock.calls.map(([tab]) => tab)).toEqual(availableTabs);
  expect(
    renderer.root.find(
      node =>
        node.props.testID === 'event-hub-tab-plan' &&
        node.props.accessibilityRole === 'tab',
    ).props.accessibilityState,
  ).toMatchObject({ selected: true });
  const crew = renderer.root.find(
    node =>
      node.props.testID === 'event-hub-tab-crew' &&
      node.props.accessibilityRole === 'tab',
  );
  expect(crew.props).toMatchObject({
    accessibilityHint: 'Noch nicht verfügbar.',
    disabled: true,
    onPress: undefined,
  });
  expect(crew.props.accessibilityState).toMatchObject({
    disabled: true,
    selected: false,
  });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offers only routed itinerary rows as actions', async () => {
  const onTimelineSelect = jest.fn();
  const { renderer } = await renderHub(turkeyGolfEventHubModel, {
    onTimelineSelect,
  });

  const golf = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      String(node.props.accessibilityLabel).includes('Carya Golf Club'),
  );
  const transfer = renderer.root.findByProps({
    accessibilityLabel: '13:30, Transfer zum Club, Hotellobby',
  });
  expect(transfer.props.accessibilityRole).toBe('text');
  expect(transfer.props.accessibilityHint).toBeUndefined();
  expect(transfer.props.onPress).toBeUndefined();

  await ReactTestRenderer.act(() => golf.props.onPress());
  expect(onTimelineSelect).toHaveBeenCalledWith('carya-round-one');
  expect(onTimelineSelect).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('makes every long-range event day horizontally reachable and selectable', async () => {
  const onDateSelect = jest.fn();
  const dates = Array.from({ length: 8 }, (_, offset) => {
    const day = String(offset + 4).padStart(2, '0');
    return {
      accessibilityLabel: `${day}. Oktober 2026`,
      day,
      id: `2026-10-${day}`,
      selected: offset === 0,
      weekday: ['SO', 'MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'][offset]!,
    };
  });
  const { renderer } = await renderHub(
    { ...turkeyGolfEventHubModel, dates },
    { onDateSelect },
  );

  const dateStrip = renderer.root.findByProps({
    testID: 'event-hub-date-strip',
  });
  expect(dateStrip.props).toMatchObject({
    accessibilityHint: 'Horizontal wischen, um alle Eventtage zu sehen.',
    accessibilityLabel: 'Eventtage',
    accessibilityRole: 'tablist',
    horizontal: true,
    showsHorizontalScrollIndicator: false,
  });
  expect(
    StyleSheet.flatten(dateStrip.props.contentContainerStyle),
  ).toMatchObject({ minWidth: '100%' });
  expect(
    dates.map(date =>
      renderer.root.findByProps({ testID: `event-hub-date-${date.id}` }),
    ),
  ).toHaveLength(8);

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-hub-date-2026-10-09' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-hub-date-2026-10-10' })
      .props.onPress(),
  );
  expect(onDateSelect.mock.calls.map(([dateId]) => dateId)).toEqual([
    '2026-10-09',
    '2026-10-10',
  ]);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps scaled timeline times on one readable line', async () => {
  const { renderer } = await renderHub();
  const time = renderer.root.findByProps({ children: '09:00' });

  expect(time.props.numberOfLines).toBe(1);
  expect(StyleSheet.flatten(time.props.style)).toMatchObject({
    flexShrink: 0,
    minWidth: 60,
  });
  expect(StyleSheet.flatten(time.props.style).width).toBeUndefined();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('scrolls a focused inbound itinerary into the visible viewport', async () => {
  const scrollTo = jest
    .spyOn(ScrollView.prototype, 'scrollTo')
    .mockImplementation(() => undefined);
  const focused = {
    ...turkeyGolfEventHubModel.timeline[0]!,
    focused: true,
    id: 'iti_linked_target',
    title: 'Verlinkte Team Challenge',
  };
  const model: EventHubModel = {
    ...turkeyGolfEventHubModel,
    timeline: [...turkeyGolfEventHubModel.timeline, focused],
  };
  const { renderer } = await renderHub(model);

  await ReactTestRenderer.act(() => {
    renderer.root
      .findByProps({ testID: 'event-hub-timeline-iti_linked_target' })
      .props.onLayout({ nativeEvent: { layout: { y: 180 } } });
    renderer.root
      .findByProps({ testID: 'event-hub-timeline' })
      .props.onLayout({ nativeEvent: { layout: { y: 720 } } });
  });

  expect(scrollTo).toHaveBeenCalledWith({
    animated: false,
    y: focusedTimelineScrollY(720, 180),
  });
  expect(
    renderer.root.findByProps({
      testID: 'event-hub-timeline-iti_linked_target',
    }).props.accessibilityState,
  ).toEqual({ selected: true });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the scaled next-card time on one readable line', async () => {
  const { renderer } = await renderHub();
  const time = renderer.root.findByProps({ children: '18:30' });

  expect(time.props.numberOfLines).toBe(1);
  expect(StyleSheet.flatten(time.props.style)).toMatchObject({
    flexShrink: 0,
  });
  expect(StyleSheet.flatten(time.parent?.props.style)).toMatchObject({
    flexShrink: 0,
    minWidth: 88,
  });
  expect(StyleSheet.flatten(time.parent?.props.style).width).toBeUndefined();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('stacks the next card before large text can squeeze its content', async () => {
  setFontScale(2);
  const { renderer } = await renderHub();

  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'event-hub-next-card' }).props.style,
    ),
  ).toMatchObject({ flexDirection: 'column' });
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'event-hub-next-time-block' }).props
        .style,
    ),
  ).toMatchObject({ flexDirection: 'row', minWidth: 0, paddingTop: 0 });
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'event-hub-next-divider' }).props
        .style,
    ),
  ).toMatchObject({ height: 2, width: '100%' });
  expect(
    StyleSheet.flatten(
      renderer.root.findByProps({ testID: 'event-hub-next-copy' }).props.style,
    ),
  ).toMatchObject({ flex: 0, width: '100%' });
  expect(
    renderer.root.findByProps({ children: 'Welcome Dinner' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('preserves the Event Hub display token and natural wrapping at Large Text', async () => {
  setFontScale(3.2);
  const { renderer } = await renderHub({
    ...turkeyGolfEventHubModel,
    title: 'Native Capability Recovery',
  });
  const title = renderer.root.findByProps({ testID: 'event-hub-title' });

  expect(title.props.accessibilityRole).toBe('header');
  expect(title.props.lineBreakStrategyIOS).toBe('push-out');
  expect(title.props.maxFontSizeMultiplier).toBeUndefined();
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({
    fontSize: typography.display.fontSize,
    lineHeight: typography.display.lineHeight,
  });
  expect(title.props.numberOfLines).toBeUndefined();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('stacks the complete sync status at Large Text', async () => {
  setFontScale(3.2);
  const { renderer } = await renderHub();
  const status = renderer.root.find(
    node =>
      node.props.role === 'status' &&
      node.props.accessibilityLabel ===
        'Offline bereit · vor 2 Min. synchronisiert',
  );
  const label = renderer.root.findByProps({
    children: 'Offline bereit · vor 2 Min. synchronisiert',
  });

  expect(StyleSheet.flatten(status.props.style)).toMatchObject({
    alignItems: 'flex-start',
    flexDirection: 'column',
  });
  expect(StyleSheet.flatten(label.props.style)).toMatchObject({
    width: '100%',
  });
  expect(label.props.numberOfLines).toBeUndefined();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('announces sync and participant truth without relying on color', async () => {
  const { renderer } = await renderHub();

  expect(
    renderer.root.find(
      node =>
        node.props.role === 'status' &&
        node.props.accessibilityLabel ===
          'Offline bereit · vor 2 Min. synchronisiert',
    ),
  ).toBeTruthy();
  expect(
    renderer.root.find(
      node =>
        node.props.accessibilityRole === 'summary' &&
        node.props.accessibilityLabel ===
          '8 Teilnehmende: Marco, Lena, Nico, Sara und weitere',
    ),
  ).toBeTruthy();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offers invite management only to owners and organizers', async () => {
  const onManageInvites = jest.fn();
  const owner = await renderHub(
    { ...turkeyGolfEventHubModel, role: 'owner' },
    { onManageInvites },
  );
  const action = owner.renderer.root.findByProps({
    testID: 'event-hub-manage-invites',
  });
  expect(action.props.accessibilityHint).toContain('servergeprüfte');
  await ReactTestRenderer.act(() => action.props.onPress());
  expect(onManageInvites).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => owner.renderer.unmount());

  for (const role of ['participant', 'viewer'] as const) {
    const model = {
      ...turkeyGolfEventHubModel,
      primaryAction:
        role === 'viewer' ? turkeyGolfEventHubModel.primaryAction : null,
      role,
    } as EventHubModel;
    const readOnly = await renderHub(model);
    expect(
      readOnly.renderer.root.findAllByProps({
        testID: 'event-hub-manage-invites',
      }),
    ).toHaveLength(0);
    await ReactTestRenderer.act(() => readOnly.renderer.unmount());
  }
});

test('uses the singular participant copy for exactly one person', async () => {
  const model: EventHubModel = {
    ...turkeyGolfEventHubModel,
    participants: [turkeyGolfEventHubModel.participants[0]!],
    participantsAccessibilityLabel: '1 teilnehmende Person: Marco',
  };
  const { renderer } = await renderHub(model);

  expect(
    renderer.root.findByProps({ children: '1 teilnehmende Person' }),
  ).toBeTruthy();
  expect(
    renderer.root.find(
      node =>
        node.props.accessibilityRole === 'summary' &&
        node.props.accessibilityLabel === '1 teilnehmende Person: Marco',
    ),
  ).toBeTruthy();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the feed timestamp AA-readable on the lavender update card', async () => {
  const { renderer } = await renderHub();
  const timestamp = renderer.root.findByProps({
    children: turkeyGolfEventHubModel.feedUpdate?.relativeTime,
  });
  const foreground = StyleSheet.flatten(timestamp.props.style).color as string;

  expect(foreground).toBe(colors.text);
  expect(
    contrastRatio(foreground, colors.surfaceAccent),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps viewer models read-only and suppresses an invalid write action', async () => {
  const viewerModel: EventHubModel = {
    ...turkeyGolfEventHubModel,
    primaryAction: {
      access: 'read',
      accessibilityLabel: 'Route zur Hotellobby öffnen',
      destination: {
        label: 'Hotellobby',
        latitude: null,
        longitude: null,
      },
      id: 'route-welcome-dinner',
      label: 'Route öffnen',
    },
    role: 'viewer',
  };
  const viewer = await renderHub(viewerModel);

  expect(
    viewer.renderer.root.findByProps({ accessibilityLabel: 'Nur ansehen' }),
  ).toBeTruthy();
  expect(
    viewer.renderer.root.findAll(
      node => node.props.accessibilityHint === 'Ändert Eventdaten.',
    ),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => viewer.renderer.unmount());

  const invalidViewerModel = {
    ...viewerModel,
    primaryAction: {
      access: 'write',
      accessibilityLabel: 'Teilnahme bestätigen',
      id: 'confirm-attendance',
      label: 'Bestätigen',
    },
  } as unknown as EventHubModel;
  const invalidViewer = await renderHub(invalidViewerModel);
  expect(
    invalidViewer.renderer.root.findAllByProps({
      testID: 'event-hub-primary-action',
    }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(() => invalidViewer.renderer.unmount());
});

test('marks a private organizer draft and exposes its review without leaking it to published or viewer states', async () => {
  const onPrimaryAction = jest.fn();
  const reviewAction = {
    access: 'write' as const,
    accessibilityLabel: 'Event prüfen. Privater Entwurf.',
    id: 'review-event',
    label: 'Event prüfen',
  };
  const draftModel: EventHubModel = {
    ...turkeyGolfEventHubModel,
    next: null,
    primaryAction: reviewAction,
    role: 'owner',
    status: 'draft',
    timeline: [],
  };
  const draft = await renderHub(draftModel, { onPrimaryAction });

  expect(
    draft.renderer.root.findByProps({ accessibilityLabel: 'Privater Entwurf' }),
  ).toBeTruthy();
  expect(textInside(draft.renderer)).toContain(
    'Dieser private Entwurf ist noch leer. Ergänze zuerst den Plan.',
  );
  const review = draft.renderer.root.findByProps({
    testID: 'event-hub-primary-action',
  });
  expect(review.props.label).toBe('Event prüfen');
  expect(review.props.accessibilityHint).toContain(
    'verbindliche Serverprüfung und Veröffentlichung',
  );
  await ReactTestRenderer.act(() => review.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith(reviewAction);
  await ReactTestRenderer.act(() => draft.renderer.unmount());

  const published = await renderHub({
    ...draftModel,
    status: 'published',
  });
  expect(
    published.renderer.root.findAllByProps({
      accessibilityLabel: 'Privater Entwurf',
    }),
  ).toHaveLength(0);
  expect(
    published.renderer.root.findAllByProps({
      testID: 'event-hub-primary-action',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => published.renderer.unmount());

  const viewer = await renderHub({
    ...draftModel,
    primaryAction: null,
    role: 'viewer',
  });
  expect(
    viewer.renderer.root.findAllByProps({
      accessibilityLabel: 'Privater Entwurf',
    }),
  ).toHaveLength(0);
  expect(
    viewer.renderer.root.findAllByProps({
      testID: 'event-hub-primary-action',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => viewer.renderer.unmount());
});

test('renders honest empty states without inventing a primary action', async () => {
  const emptyModel: EventHubModel = {
    ...turkeyGolfEventHubModel,
    dates: [],
    feedUpdate: null,
    next: null,
    primaryAction: null,
    timeline: [],
  };
  const { renderer } = await renderHub(emptyModel);

  const copy = renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
  expect(copy).toContain('Noch nichts geplant');
  expect(copy).toContain(
    'Neue Einträge erscheinen nach dem nächsten Abgleich.',
  );
  expect(copy).toContain('Für diesen Tag ist noch nichts geplant.');
  expect(copy).toContain('Noch keine Updates');
  expect(
    renderer.root.findAllByProps({ testID: 'event-hub-primary-action' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(() => renderer.unmount());
});

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}
