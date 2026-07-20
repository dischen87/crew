import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  EventPublishView,
  type EventPublishViewModel,
} from '../src/screens/EventPublishView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

const readyModel: EventPublishViewModel = {
  blockerCodes: [],
  busyAction: null,
  conflict: null,
  eventTitle: 'Crew Retreat Zürich',
  message: null,
  online: true,
  phase: 'review',
  planItemCount: 2,
  planItems: [
    {
      id: 'itm_welcome',
      startsAt: '2026-09-20T08:00:00.000Z',
      title: 'Gemeinsamer Start',
    },
    {
      id: 'itm_dinner',
      startsAt: '2026-09-20T17:00:00.000Z',
      title: 'Abendessen am See',
    },
  ],
  ready: true,
  refreshedAt: '2026-07-19T12:00:00.000Z',
  role: 'owner',
  schedule: {
    endsAt: '2026-09-21T17:00:00.000Z',
    startsAt: '2026-09-20T08:00:00.000Z',
    timeZone: 'Europe/Zurich',
  },
  syncRequired: false,
  template: 'team-event',
};

async function render(model: EventPublishViewModel) {
  const onBack = jest.fn();
  const onBlockerAction = jest.fn();
  const onPrimaryAction = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventPublishView
          model={model}
          onBack={onBack}
          onBlockerAction={onBlockerAction}
          onPrimaryAction={onPrimaryAction}
        />
      </SafeAreaProvider>,
    );
  });
  return { onBack, onBlockerAction, onPrimaryAction, renderer };
}

test('shows the participant-faithful preview and one publish action at 390x844', async () => {
  const { onPrimaryAction, renderer } = await render(readyModel);
  const text = textInside(renderer);
  expect(text).toContain('VORSCHAU FÜR DEINE CREW');
  expect(text).toContain('Crew Retreat Zürich');
  expect(text).toContain('Gemeinsamer Start');
  expect(text).toContain('Alle verbindlichen Serverprüfungen sind erfüllt.');
  expect(text).toContain('Keine optionalen Hinweise');

  const primary = renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });
  expect(primary.props.label).toBe('Event veröffentlichen');
  expect(
    renderer.root.findAll(
      node =>
        node.props.testID === 'event-publish-primary-action' &&
        node.props.label === 'Event veröffentlichen',
    ),
  ).toHaveLength(1);
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('publish');

  const scroll = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders one exact action for each supported basics and setup blocker', async () => {
  const { onBlockerAction, renderer } = await render({
    ...readyModel,
    blockerCodes: [
      'EVENT_DESCRIPTION_REQUIRED',
      'EVENT_CAPABILITY_PLACE_REQUIRED',
    ],
    blockerTargets: [
      null,
      { capabilityType: 'golf', eventId: 'evt_round' },
    ],
    planItemCount: 0,
    planItems: [],
    ready: false,
  });
  const text = textInside(renderer);
  expect(text).toContain('Vor Veröffentlichung');
  expect(text).toContain('Beschreibung fehlt');
  expect(text).toContain('Ort im Setup fehlt');
  expect(text).toContain('Optional verbessern');
  expect(text).toContain('Das blockiert die Freigabe nicht');
  expect(
    renderer.root.findByProps({ testID: 'event-publish-primary-action' }).props
      .label,
  ).toBe('Erneut prüfen');
  const basicsAction = renderer.root.findByProps({
    testID: 'event-publish-fix-EVENT_DESCRIPTION_REQUIRED',
  });
  await ReactTestRenderer.act(() => basicsAction.props.onPress());
  expect(onBlockerAction).toHaveBeenCalledWith(
    'EVENT_DESCRIPTION_REQUIRED',
    null,
  );
  const setupAction = renderer.root.findByProps({
    testID: 'event-publish-fix-EVENT_CAPABILITY_PLACE_REQUIRED',
  });
  expect(setupAction.props.label).toBe('Setup bearbeiten');
  await ReactTestRenderer.act(() => setupAction.props.onPress());
  expect(onBlockerAction).toHaveBeenCalledWith(
    'EVENT_CAPABILITY_PLACE_REQUIRED',
    { capabilityType: 'golf', eventId: 'evt_round' },
  );
  expect(
    renderer.root.findAll(
      node =>
        node.props.testID?.startsWith('event-publish-fix-') &&
        typeof node.props.label === 'string',
    ),
  ).toHaveLength(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('does not invent a capability target when exact readiness meta is missing', async () => {
  const { renderer } = await render({
    ...readyModel,
    blockerCodes: ['EVENT_CAPABILITY_REQUIRED'],
    blockerTargets: [null],
    ready: false,
  });
  expect(textInside(renderer)).toContain('Event-Setup fehlt');
  expect(
    renderer.root.findAllByProps({
      testID: 'event-publish-fix-EVENT_CAPABILITY_REQUIRED',
    }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps offline review explicit and never claims a queued publication', async () => {
  const { onPrimaryAction, renderer } = await render({
    ...readyModel,
    message:
      'Für diese Aktion brauchst du eine Verbindung. Es wurde keine Veröffentlichung vorgemerkt.',
    online: false,
  });
  const text = textInside(renderer);
  expect(text).toContain('Offline-Kopie');
  expect(text).toContain('keine Veröffentlichung vorgemerkt');
  expect(
    renderer.root.findAllByProps({
      testID: 'event-publish-primary-action',
    }),
  ).toHaveLength(0);
  expect(onPrimaryAction).not.toHaveBeenCalled();
  expect(
    renderer.root.findByProps({ testID: 'event-publish-back-action' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows attempted and current conflict truths with revisions and named blockers', async () => {
  const { onPrimaryAction, renderer } = await render({
    ...readyModel,
    blockerCodes: ['EVENT_END_REQUIRED'],
    conflict: {
      attempted: {
        blockerCodes: [],
        revision: '7',
      },
      current: {
        blockerCodes: ['EVENT_END_REQUIRED'],
        revision: '8',
      },
    },
    ready: false,
  });
  const text = textInside(renderer);
  expect(text).toContain('GEPRÜFTER STAND · REVISION 7');
  expect(text).toContain('Keine verbindlichen Punkte offen');
  expect(text).toContain('AKTUELLER STAND · REVISION 8');
  expect(text).toContain('Ende fehlt');
  const primary = renderer.root.findByProps({
    testID: 'event-publish-primary-action',
  });
  expect(primary.props.label).toBe('Änderungen geprüft');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('acknowledge_conflict');
  await ReactTestRenderer.act(() => renderer.unmount());
});

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
