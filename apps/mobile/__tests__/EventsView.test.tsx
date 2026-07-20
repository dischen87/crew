import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import {
  eventDateLabel,
  EventsView,
  type EventsViewEvent,
  type EventsViewState,
} from '../src/screens/EventsView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

async function renderView(
  state: EventsViewState,
  overrides: Partial<React.ComponentProps<typeof EventsView>> = {},
) {
  const props: React.ComponentProps<typeof EventsView> = {
    onRetry: jest.fn(),
    onSelect: jest.fn(),
    state,
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventsView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer: renderer! };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}

test('renders every role and lifecycle as wrapping accessible event cards', async () => {
  const longTitle =
    'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen';
  const events: EventsViewEvent[] = [
    event({
      role: 'owner',
      rootEventId: 'evt_owner',
      status: 'draft',
      title: longTitle,
    }),
    event({
      kind: 'team_event',
      role: 'organizer',
      rootEventId: 'evt_organizer',
      status: 'published',
      title: 'Belek Team Retreat',
    }),
    event({
      kind: 'golf',
      role: 'participant',
      rootEventId: 'evt_participant',
      status: 'cancelled',
      title: 'Turkey Golf Tour',
    }),
    event({
      role: 'viewer',
      rootEventId: 'evt_viewer',
      status: 'published',
      title: 'Sommerfest',
    }),
  ];
  const onSelect = jest.fn();
  const { renderer } = await renderView(
    {
      events,
      kind: 'ready',
      phase: 'fresh',
      refreshedAt: '2026-07-19T12:00:00.000Z',
    },
    { onSelect },
  );

  expect(textInside(renderer)).toMatch(
    /Eigentümer:in.*Entwurf.*Organisator:in.*Veröffentlicht.*Teilnehmer:in.*Abgesagt.*Betrachter:in.*Veröffentlicht/s,
  );
  expect(textInside(renderer)).not.toMatch(
    /Event erstellen|Event beitreten|Einladung erstellen/,
  );

  const title = renderer.root
    .findAllByType(Text)
    .find(node => node.props.children === longTitle);
  expect(title).toBeDefined();
  expect(title!.props.numberOfLines).toBeUndefined();
  expect(title!.props.maxFontSizeMultiplier).toBeUndefined();

  for (const item of events) {
    const card = renderer.root.findByProps({
      testID: `event-${item.rootEventId}`,
    });
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toContain(item.title);
    expect(
      StyleSheet.flatten(card.props.style).minHeight,
    ).toBeGreaterThanOrEqual(48);
    await ReactTestRenderer.act(() => card.props.onPress());
  }
  expect(onSelect.mock.calls.map(([rootEventId]) => rootEventId)).toEqual(
    events.map(item => item.rootEventId),
  );

  const scroller = renderer.root.findByType(ScrollView);
  expect(scroller.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(
    StyleSheet.flatten(scroller.props.contentContainerStyle),
  ).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
    paddingTop: 0,
  });
  expect(StyleSheet.flatten(scroller.props.style)).toMatchObject({
    flex: 1,
    marginTop: 47,
  });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps loading, empty and retryable errors honest without fake actions', async () => {
  const loading = await renderView({ kind: 'loading' });
  expect(textInside(loading.renderer)).toContain('Events werden geladen');
  expect(loading.renderer.root.findAllByType(Button)).toHaveLength(0);
  await ReactTestRenderer.act(() => loading.renderer.unmount());

  const empty = await renderView({
    kind: 'empty',
    phase: 'fresh',
    refreshedAt: '2026-07-19T12:00:00.000Z',
  });
  expect(textInside(empty.renderer)).toContain('Noch keine Events');
  expect(textInside(empty.renderer)).toContain(
    'Sobald ein Event für dich verfügbar ist',
  );
  expect(empty.renderer.root.findAllByType(Button)).toHaveLength(0);
  await ReactTestRenderer.act(() => empty.renderer.unmount());

  const onRetry = jest.fn();
  const failed = await renderView(
    { kind: 'error', retryable: true },
    { onRetry },
  );
  const retry = failed.renderer.root.findByProps({ testID: 'events-retry' });
  expect(retry.props.label).toBe('Erneut versuchen');
  await ReactTestRenderer.act(() => retry.props.onPress());
  expect(onRetry).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => failed.renderer.unmount());

  const unavailable = await renderView({
    kind: 'error',
    retryable: false,
  });
  expect(unavailable.renderer.root.findAllByType(Button)).toHaveLength(0);
  await ReactTestRenderer.act(() => unavailable.renderer.unmount());
});

test('shows the real creation route only when an eligible private controller provides it', async () => {
  const onCreate = jest.fn();
  const { renderer } = await renderView(
    {
      kind: 'empty',
      phase: 'fresh',
      refreshedAt: '2026-07-19T12:00:00.000Z',
    },
    { onCreate },
  );

  const create = renderer.root.findByProps({ testID: 'events-create' });
  expect(create.props.label).toBe('Event erstellen');
  expect(create.props.accessibilityHint).toContain('privaten Ablauf');
  await ReactTestRenderer.act(() => create.props.onPress());
  expect(onCreate).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps retry primary and creation secondary when event loading fails', async () => {
  const onCreate = jest.fn();
  const onRetry = jest.fn();
  const { renderer } = await renderView(
    { kind: 'error', retryable: true },
    { onCreate, onRetry },
  );

  const retry = renderer.root.findByProps({ testID: 'events-retry' });
  const create = renderer.root.findByProps({ testID: 'events-create' });
  expect(retry.props.variant).toBe('action');
  expect(create.props.variant).toBe('surface');
  expect(renderer.root.findAllByType(Button)).toEqual([retry, create]);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps logout secondary, large-text-safe and explicit while retrying', async () => {
  const onLogout = jest.fn();
  const { renderer } = await renderView(
    {
      events: [event()],
      kind: 'ready',
      phase: 'fresh',
      refreshedAt: '2026-07-19T12:00:00.000Z',
    },
    { logoutError: true, logoutLoading: true, onCreate: jest.fn(), onLogout },
  );

  const buttons = renderer.root.findAllByType(Button);
  const logout = buttons.at(-1)!;
  expect(logout.props.testID).toBe('events-logout');
  expect(logout.props.variant).toBe('surface');
  expect(logout.props.label).toBe('Abmelden erneut versuchen');
  expect(logout.props.accessibilityHint).toContain('Bestätigung');
  const accessibleLogout = renderer.root.find(
    node =>
      node.props.testID === 'events-logout' &&
      node.props.accessibilityRole === 'button',
  );
  expect(accessibleLogout.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  const failure = renderer.root.findByProps({ accessibilityRole: 'alert' });
  expect(failure.props.children).not.toMatch(/ID|Pfad|\/private/);
  expect(
    renderer.root
      .findAllByType(Text)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('makes cached ready and empty states explicit and retryable offline', async () => {
  const onRetry = jest.fn();
  const ready = await renderView(
    {
      events: [event()],
      kind: 'ready',
      phase: 'offline',
      refreshedAt: '2026-07-19T12:00:00.000Z',
    },
    { onRetry },
  );
  expect(textInside(ready.renderer)).toContain('Offline verfügbar');
  expect(textInside(ready.renderer)).toContain(
    'Du siehst den zuletzt sicher gespeicherten Stand.',
  );
  expect(
    ready.renderer.root.findByProps({ testID: 'events-offline-status' }),
  ).toBeTruthy();
  const retry = ready.renderer.root.find(
    node =>
      node.props.testID === 'events-offline-retry' &&
      node.props.accessibilityRole === 'button',
  );
  await ReactTestRenderer.act(() => retry.props.onPress());
  expect(onRetry).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => ready.renderer.unmount());

  const empty = await renderView(
    {
      kind: 'empty',
      phase: 'offline',
      refreshedAt: '2026-07-19T12:00:00.000Z',
    },
    { onRetry },
  );
  expect(textInside(empty.renderer)).toContain(
    'Im zuletzt gespeicherten Stand sind keine Events sichtbar.',
  );
  expect(
    empty.renderer.root
      .findAllByType(Text)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);
  await ReactTestRenderer.act(() => empty.renderer.unmount());
});

test('formats root dates in their event zone and safely handles missing dates', () => {
  expect(
    eventDateLabel(
      event({
        endsAt: '2026-09-24T18:00:00.000Z',
        startsAt: '2026-09-20T08:00:00.000Z',
        timeZone: 'Europe/Zurich',
      }),
    ),
  ).toBe('20.–24. September 2026');
  expect(
    eventDateLabel(
      event({ endsAt: null, startsAt: null, timeZone: 'Invalid/Zone' }),
    ),
  ).toBe('Termin wird noch festgelegt');
});

function event(overrides: Partial<EventsViewEvent> = {}): EventsViewEvent {
  return {
    endsAt: '2026-09-24T18:00:00.000Z',
    kind: 'trip',
    membershipStatus: 'active',
    role: 'participant',
    rootEventId: 'evt_trip',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: 'Crew Trip',
    ...overrides,
  };
}
