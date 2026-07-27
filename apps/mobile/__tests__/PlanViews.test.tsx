import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import type {
  PlanItemSnapshot,
  PlanSnapshot,
} from '../src/screens/PlanRuntime';
import { ChildEventEditorView } from '../src/screens/ChildEventEditorView';
import {
  PlanItemEditorView,
  type PlanItemEditorForm,
  type PlanItemEditorViewModel,
} from '../src/screens/PlanItemEditorView';
import { validatePlanItemEditorForm } from '../src/screens/PlanItemEditorScreen';
import { PlanView, type PlanViewModel } from '../src/screens/PlanView';

const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => setFontScale(1));
afterAll(() =>
  Dimensions.set({ screen: originalScreen, window: originalWindow }),
);

async function render(node: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
  });
  return renderer;
}

test('manager plan exposes recursive structure, ordered itinerary and one add action', async () => {
  const callbacks = planCallbacks();
  const model: PlanViewModel = {
    message: null,
    online: true,
    phase: 'ready',
    refreshing: false,
    selectedEventId: 'evt_round',
    selectedItemId: null,
    snapshot: planSnapshot('owner'),
  };
  const renderer = await render(<PlanView model={model} {...callbacks} />);

  const child = renderer.root.findByProps({ testID: 'plan-event-evt_round' });
  expect(child.props.accessibilityLabel).toContain('Ebene 2');
  expect(child.props.accessibilityLabel).toContain('unter Turkey Golf Tour');
  expect(child.props.accessibilityLabel).toContain('Position 1 von 1');
  expect(child.props.accessibilityState).toMatchObject({
    expanded: false,
    selected: true,
  });

  const row = renderer.root.findByProps({ testID: 'plan-item-iti_round' });
  expect(row.props.accessibilityRole).toBe('button');
  await ReactTestRenderer.act(() => row.props.onPress());
  expect(callbacks.onEditItem).toHaveBeenCalledWith('evt_round', 'iti_round');

  const primary = renderer.root.findByProps({
    testID: 'plan-primary-action',
  });
  expect(primary.props.label).toBe('Runde hinzufügen');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onAddItem).toHaveBeenCalledWith('evt_round');
  expect(
    renderer.root.findAll(
      node =>
        node.props.testID === 'plan-primary-action' &&
        node.props.variant === 'action',
    ),
  ).toHaveLength(1);
  expect(textInside(renderer)).not.toContain('Nur ansehen');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('manager gets explicit accessible structure and itinerary reorder controls', async () => {
  const callbacks = planCallbacks();
  const snapshot = planSnapshot('organizer');
  const secondChild = eventNode({
    depth: 1,
    id: 'evt_dinner',
    kind: 'activity',
    parentEventId: 'evt_root',
    rootEventId: 'evt_root',
    sortKey: 'b',
    title: 'Abendprogramm',
  });
  const secondRoundItem = item({
    eventId: 'evt_round',
    id: 'iti_round_two',
    startsAt: '2026-09-21T07:30:00.000Z',
    title: 'Zweite Runde',
    type: 'golf_round',
  });
  const renderer = await render(
    <PlanView
      {...callbacks}
      model={{
        message: null,
        online: false,
        phase: 'ready',
        refreshing: false,
        selectedEventId: 'evt_round',
        selectedItemId: null,
        snapshot: {
          ...snapshot,
          events: [...snapshot.events, secondChild],
          items: [...snapshot.items, secondRoundItem],
        },
      }}
    />,
  );

  const childDown = renderer.root.findByProps({
    testID: 'plan-event-move-down-evt_round',
  });
  expect(childDown.props.accessibilityLabel).toBe(
    'Carya Golf nach unten verschieben',
  );
  expect(childDown.props.disabled).toBe(false);
  await ReactTestRenderer.act(() => childDown.props.onPress());
  expect(callbacks.onMoveChildEvent).toHaveBeenCalledWith('evt_round', 'down');

  const itemDown = renderer.root.findByProps({
    testID: 'plan-item-move-down-iti_round',
  });
  expect(itemDown.props.accessibilityHint).toContain('Carya Golf');
  expect(itemDown.props.disabled).toBe(false);
  await ReactTestRenderer.act(() => itemDown.props.onPress());
  expect(callbacks.onMoveItem).toHaveBeenCalledWith('iti_round', 'down');

  const addChild = renderer.root.findByProps({
    testID: 'plan-add-child-event',
  });
  await ReactTestRenderer.act(() => addChild.props.onPress());
  expect(callbacks.onAddChildEvent).toHaveBeenCalledWith('evt_round');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('plan renders itinerary rows in the order changed by the manager', async () => {
  const snapshot = planSnapshot('owner');
  const first = {
    ...item({
      eventId: 'evt_round',
      id: 'iti_first',
      startsAt: '2026-09-21T07:30:00.000Z',
      title: 'Chronologisch zuerst',
      type: 'golf_round',
    }),
    sortKey: 'b',
  };
  const second = {
    ...item({
      eventId: 'evt_round',
      id: 'iti_second',
      startsAt: '2026-09-21T08:30:00.000Z',
      title: 'Im Plan zuerst',
      type: 'golf_round',
    }),
    sortKey: 'a',
  };
  const renderer = await render(
    <PlanView
      {...planCallbacks()}
      model={{
        message: null,
        online: true,
        phase: 'ready',
        refreshing: false,
        selectedEventId: 'evt_round',
        selectedItemId: null,
        snapshot: {
          ...snapshot,
          items: [first, second],
        },
      }}
    />,
  );

  expect(
    [
      ...new Set(
        renderer.root
          .findAll(
            node =>
              node.props.testID === 'plan-item-iti_first' ||
              node.props.testID === 'plan-item-iti_second',
          )
          .map(node => node.props.testID),
      ),
    ],
  ).toEqual(['plan-item-iti_second', 'plan-item-iti_first']);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('child-event authoring exposes labeled kind and durable offline action', async () => {
  const onChange = jest.fn();
  const onSubmit = jest.fn();
  const renderer = await render(
    <ChildEventEditorView
      busy={false}
      errors={{}}
      form={{
        description: '',
        endsAt: '',
        kind: 'day',
        startsAt: '',
        timeZone: 'Europe/Zurich',
        title: 'Tag zwei',
      }}
      message={null}
      online={false}
      parentTitle="Turkey Golf Tour"
      onBack={jest.fn()}
      onChange={onChange}
      onSubmit={onSubmit}
    />,
  );

  const kind = renderer.root.findByProps({
    testID: 'child-event-kind-session',
  });
  expect(kind.props.accessibilityRole).toBe('radio');
  expect(kind.props.accessibilityState.checked).toBe(false);
  await ReactTestRenderer.act(() => kind.props.onPress());
  expect(onChange).toHaveBeenCalledWith('kind', 'session');
  expect(textInside(renderer)).toContain('Wird lokal vorgemerkt');

  const save = renderer.root.findByProps({
    testID: 'child-event-primary-action',
  });
  expect(save.props.accessibilityHint).toContain('Warteschlange');
  await ReactTestRenderer.act(() => save.props.onPress());
  expect(onSubmit).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('rejected local child remains reviewable but cannot accept dependent work', async () => {
  const callbacks = planCallbacks();
  const snapshot = planSnapshot('owner');
  const mutationId = '33333333-3333-4333-8333-333333333333';
  const renderer = await render(
    <PlanView
      {...callbacks}
      model={{
        message: null,
        online: true,
        phase: 'ready',
        refreshing: false,
        selectedEventId: 'evt_round',
        selectedItemId: null,
        snapshot: {
          ...snapshot,
          events: snapshot.events.map(event =>
            event.id === 'evt_round' ? { ...event, version: 0 } : event,
          ),
          issues: [
            {
              attempted: null,
              code: 'permission',
              current: null,
              eventAttempted: {
                description: null,
                endsAt: null,
                kind: 'golf',
                parentEventId: 'evt_root',
                startsAt: null,
                status: 'draft',
                timeZone: 'Europe/Zurich',
                title: 'Carya Golf',
              },
              itemId: 'evt_round',
              mutationId,
              resolution: 'discard',
            },
          ],
        },
      }}
    />,
  );

  expect(
    renderer.root.findByProps({ testID: 'plan-primary-action' }).props.disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'plan-add-child-event' }).props.disabled,
  ).toBe(true);
  const discard = renderer.root.findByProps({
    testID: `plan-discard-issue-${mutationId}`,
  });
  await ReactTestRenderer.act(() => discard.props.onPress());
  expect(callbacks.onDiscardIssue).toHaveBeenCalledWith(mutationId);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('plan identifies every unconfirmed local change before discard', async () => {
  const callbacks = planCallbacks();
  const firstMutationId = '11111111-1111-4111-8111-111111111111';
  const secondMutationId = '22222222-2222-4222-8222-222222222222';
  const snapshot = planSnapshot('owner');
  const transfer = snapshot.items[0]!.values;
  const round = snapshot.items[1]!.values;
  const model: PlanViewModel = {
    message: null,
    online: true,
    phase: 'ready',
    refreshing: false,
    selectedEventId: 'evt_root',
    selectedItemId: null,
    snapshot: {
      ...snapshot,
      issues: [
        {
          attempted: { ...transfer, title: 'Lokaler Transfer' },
          code: 'permission',
          current: transfer,
          itemId: 'iti_denied',
          mutationId: firstMutationId,
          resolution: 'discard',
        },
        {
          attempted: { ...round, title: 'Lokale Golfrunde' },
          code: 'conflict',
          current: round,
          itemId: 'iti_conflict',
          mutationId: secondMutationId,
          resolution: 'retry',
        },
      ],
    },
  };
  const renderer = await render(<PlanView model={model} {...callbacks} />);

  const firstDiscard = renderer.root.findByProps({
    testID: `plan-discard-issue-${firstMutationId}`,
  });
  const secondDiscard = renderer.root.findByProps({
    testID: `plan-discard-issue-${secondMutationId}`,
  });
  expect(textInside(renderer)).toContain(
    'Berechtigung: Diese lokale Änderung wurde nicht übernommen.',
  );
  expect(textInside(renderer)).toContain('Lokaler Transfer · Turkey Golf Tour');
  expect(textInside(renderer)).toContain('Lokale Golfrunde · Carya Golf');
  expect(firstDiscard.props.accessibilityLabel).toContain('Lokaler Transfer');
  expect(secondDiscard.props.accessibilityLabel).toContain('Lokale Golfrunde');
  expect(secondDiscard.props.label).toBe('Erneut versuchen');
  await ReactTestRenderer.act(() => firstDiscard.props.onPress());
  await ReactTestRenderer.act(() => secondDiscard.props.onPress());
  expect(callbacks.onDiscardIssue).toHaveBeenCalledWith(firstMutationId);
  expect(callbacks.onRetryIssue).toHaveBeenCalledWith(secondMutationId);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('selected child event keeps every descendant itinerary item in view', async () => {
  const callbacks = planCallbacks();
  const snapshot = planSnapshot('participant');
  const nestedEvent = eventNode({
    depth: 2,
    id: 'evt_session',
    kind: 'session',
    parentEventId: 'evt_round',
    rootEventId: 'evt_root',
    title: 'Abschluss',
  });
  const nestedItem = item({
    eventId: nestedEvent.id,
    id: 'iti_session',
    startsAt: '2026-09-21T16:00:00.000Z',
    title: 'Siegerehrung',
    type: 'road_transfer',
  });
  const renderer = await render(
    <PlanView
      {...callbacks}
      model={{
        message: null,
        online: true,
        phase: 'ready',
        refreshing: false,
        selectedEventId: 'evt_round',
        selectedItemId: null,
        snapshot: {
          ...snapshot,
          events: [...snapshot.events, nestedEvent],
          items: [...snapshot.items, nestedItem],
        },
      }}
    />,
  );

  expect(
    renderer.root.findByProps({ testID: 'plan-item-iti_round' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'plan-item-iti_session' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAllByProps({ testID: 'plan-item-iti_transfer' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('manager opens non-canonical plan rows read-only instead of entering the editor', async () => {
  const callbacks = planCallbacks();
  const snapshot = planSnapshot('owner');
  const nonCanonical = [
    {
      ...item({
        eventId: 'evt_root',
        id: 'iti_queued',
        startsAt: '2026-09-20T08:00:00.000Z',
        title: 'Lokal erstellt',
        type: 'road_transfer',
      }),
      delivery: 'queued' as const,
      version: null,
    },
    {
      ...item({
        eventId: 'evt_root',
        id: 'iti_syncing',
        startsAt: '2026-09-20T09:00:00.000Z',
        title: 'Wird abgeglichen',
        type: 'road_transfer',
      }),
      delivery: 'syncing' as const,
    },
    {
      ...item({
        eventId: 'evt_root',
        id: 'iti_attention',
        startsAt: '2026-09-20T10:00:00.000Z',
        title: 'Braucht Aufmerksamkeit',
        type: 'road_transfer',
      }),
      delivery: 'attention' as const,
    },
    {
      ...item({
        eventId: 'evt_root',
        id: 'iti_unversioned',
        startsAt: '2026-09-20T11:00:00.000Z',
        title: 'Noch nicht bestätigt',
        type: 'road_transfer',
      }),
      version: null,
    },
  ];
  const renderer = await render(
    <PlanView
      {...callbacks}
      model={{
        message: null,
        online: false,
        phase: 'ready',
        refreshing: false,
        selectedEventId: 'evt_root',
        selectedItemId: null,
        snapshot: { ...snapshot, items: nonCanonical },
      }}
    />,
  );

  for (const row of nonCanonical) {
    const action = renderer.root.findByProps({
      testID: `plan-item-${row.id}`,
    });
    expect(action.props.accessibilityHint).toContain('ohne weitere Änderung');
    await ReactTestRenderer.act(() => action.props.onPress());
  }
  expect(callbacks.onOpenItem.mock.calls).toEqual(
    nonCanonical.map(row => [row.id]),
  );
  expect(callbacks.onEditItem).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('participant selects a read-only item and opens it only through the primary action', async () => {
  const callbacks = planCallbacks();
  const model: PlanViewModel = {
    message: null,
    online: false,
    phase: 'ready',
    refreshing: false,
    selectedEventId: 'evt_root',
    selectedItemId: 'iti_round',
    snapshot: planSnapshot('participant'),
  };
  const renderer = await render(<PlanView model={model} {...callbacks} />);

  expect(textInside(renderer)).toContain('Nur ansehen');
  expect(textInside(renderer)).not.toContain('Bearbeiten');
  const row = renderer.root.findByProps({ testID: 'plan-item-iti_transfer' });
  expect(row.props.accessibilityRole).toBe('radio');
  expect(row.props.accessibilityState).toEqual({ checked: false });
  await ReactTestRenderer.act(() => row.props.onPress());
  expect(callbacks.onSelectItem).toHaveBeenCalledWith('iti_transfer');
  expect(callbacks.onEditItem).not.toHaveBeenCalled();

  const primary = renderer.root.findByProps({
    testID: 'plan-primary-action',
  });
  expect(primary.props.label).toBe('Ausgewählten Punkt öffnen');
  expect(primary.props.disabled).toBe(false);
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onOpenItem).toHaveBeenCalledWith('iti_round');
  expect(
    renderer.root.findAllByProps({ testID: 'plan-item-editor-action' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('schema-driven editor covers travel type, status and native all-day control', async () => {
  const callbacks = editorCallbacks();
  const model = editorModel({
    form: {
      ...emptyEditorForm(),
      destinationPlaceId: 'plc_zrh',
      flightDesignator: 'LX 8174',
      originPlaceId: 'plc_gva',
      startsAt: '2026-09-20 09:00',
      timeZone: 'Europe/Zurich',
      title: 'Hinflug',
      type: 'flight',
    },
  });
  const renderer = await render(
    <PlanItemEditorView model={model} {...callbacks} />,
  );

  const typeControls = new Set(
    renderer.root
      .findAll(
        node =>
          typeof node.props.testID === 'string' &&
          node.props.testID.startsWith('plan-item-type-') &&
          node.props.accessibilityRole === 'radio',
      )
      .map(node => node.props.testID),
  );
  expect(typeControls.size).toBe(9);
  expect(textInside(renderer)).toContain('Flughafen Genf');
  expect(textInside(renderer)).toContain('Flughafen Zürich');
  expect(textInside(renderer)).not.toContain('plc_gva');
  expect(textInside(renderer)).not.toContain('plc_zrh');
  const destination = renderer.root.find(
    node =>
      node.props.testID === 'plan-item-destination-place-plc_gva' &&
      node.props.accessibilityRole === 'radio',
  );
  await ReactTestRenderer.act(() => destination.props.onPress());
  expect(callbacks.onChange).toHaveBeenCalledWith(
    'destinationPlaceId',
    'plc_gva',
  );
  expect(
    renderer.root.findByProps({ testID: 'plan-item-flightDesignator' }),
  ).toBeTruthy();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-type-rail' })
      .props.onPress(),
  );
  expect(callbacks.onTypeChange).toHaveBeenCalledWith('rail');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-status-cancelled' })
      .props.onPress(),
  );
  expect(callbacks.onStatusChange).toHaveBeenCalledWith('cancelled');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-all-day' })
      .props.onValueChange(true),
  );
  expect(callbacks.onAllDayChange).toHaveBeenCalledWith(true);

  const primary = renderer.root.findByProps({
    testID: 'plan-item-editor-primary-action',
  });
  expect(primary.props.label).toBe('Reiseeintrag hinzufügen');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(callbacks.onPrimaryAction).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findAll(
      node =>
        node.props.testID === 'plan-item-editor-primary-action' &&
        node.props.variant === 'action',
    ),
  ).toHaveLength(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('place selectors preserve unknown saved places without exposing editable raw ids', async () => {
  const callbacks = editorCallbacks();
  const renderer = await render(
    <PlanItemEditorView
      model={editorModel({
        form: {
          ...emptyEditorForm(),
          placeId: 'plc_retired',
          title: 'Willkommen',
        },
      })}
      {...callbacks}
    />,
  );
  const text = textInside(renderer);
  expect(text).toContain('Bisher gespeicherter Ort');
  expect(text).toContain('Kein Ort');
  expect(text).not.toContain('plc_retired');
  const fallback = renderer.root.find(
    node =>
      node.props.testID === 'plan-item-place-id-plc_retired' &&
      node.props.accessibilityRole === 'radio',
  );
  expect(fallback.props.accessibilityLabel).toBe('Bisher gespeicherter Ort');
  expect(fallback.props.accessibilityState).toMatchObject({ checked: true });

  const none = renderer.root.find(
    node =>
      node.props.testID === 'plan-item-place-id-none' &&
      node.props.accessibilityRole === 'radio',
  );
  await ReactTestRenderer.act(() => none.props.onPress());
  expect(callbacks.onChange).toHaveBeenCalledWith('placeId', '');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('place search selects cached matches and creates remote matches without showing ids', async () => {
  const callbacks = editorCallbacks();
  const renderer = await render(
    <PlanItemEditorView
      model={editorModel({
        form: {
          ...emptyEditorForm(),
          destinationPlaceId: 'plc_zrh',
          originPlaceId: '',
          title: 'Hinreise',
          type: 'flight',
        },
        placeSearch: {
          action: null,
          message: null,
          query: 'Genf',
          results: [placeCandidate()],
          target: 'originPlaceId',
        },
      })}
      {...callbacks}
    />,
  );

  const text = textInside(renderer);
  expect(text).toContain('Flughafen Genf auswählen');
  expect(text).toContain('Genève-Cornavin hinzufügen');
  expect(text).not.toContain('plc_gva');
  expect(text).not.toContain('candidate_venue');

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-origin-place-cached-result-0' })
      .props.onPress(),
  );
  expect(callbacks.onChange).toHaveBeenCalledWith('originPlaceId', 'plc_gva');

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-origin-place-remote-result-0' })
      .props.onPress(),
  );
  expect(callbacks.onCreatePlace).toHaveBeenCalledWith('candidate_venue');

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-origin-place-search-submit' })
      .props.onPress(),
  );
  expect(callbacks.onSearchPlaces).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'plan-item-origin-place-search-close' })
      .props.onPress(),
  );
  expect(callbacks.onClosePlaceSearch).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('remote place creation is disabled when connectivity drops', async () => {
  const renderer = await render(
    <PlanItemEditorView
      model={editorModel({
        online: false,
        placeSearch: {
          action: null,
          message: null,
          query: 'Genf',
          results: [placeCandidate()],
          target: 'placeId',
        },
      })}
      {...editorCallbacks()}
    />,
  );

  expect(
    renderer.root.findByProps({
      testID: 'plan-item-place-id-remote-result-0',
    }).props.disabled,
  ).toBe(true);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('editor keeps controls reachable and labels untruncated at 200 percent text', async () => {
  setFontScale(2);
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    renderer = await render(
      <PlanItemEditorView
        model={editorModel({
          form: {
            ...emptyEditorForm(),
            golfRoundReference: 'Carya · Runde 1',
            golfTeeTime: '2026-09-21 08:30',
            timeZone: 'Europe/Zurich',
            title: 'Erste gemeinsame Golfrunde',
            type: 'golf_round',
          },
          placeSearch: {
            action: null,
            message: null,
            query: 'Alpine',
            results: [
              {
                ...placeCandidate(),
                kind: 'golf_course',
                name: 'Alpine Golf Club mit sehr langem zugänglichem Namen',
              },
            ],
            target: 'placeId',
          },
        })}
        {...editorCallbacks()}
      />,
    );
    expect(
      renderer.root.findByProps({ testID: 'plan-item-golfRoundReference' }),
    ).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'plan-item-golfTeeTime' }),
    ).toBeTruthy();
    const primary = renderer.root.find(
      node =>
        node.props.testID === 'plan-item-editor-primary-action' &&
        node.props.accessibilityRole === 'button',
    );
    const primaryStyle = StyleSheet.flatten(
      primary.props.style({ pressed: false }),
    );
    expect(primaryStyle.flexDirection).toBe('column');
    const label = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Runde hinzufügen');
    expect(label?.props.numberOfLines).toBeUndefined();
    const placeLabel = renderer.root
      .findAllByType(Text)
      .find(node => node.props.children === 'Flughafen Genf');
    expect(placeLabel?.props.numberOfLines).toBeUndefined();
    const remotePlaceLabel = renderer.root
      .findAllByType(Text)
      .find(
        node =>
          node.props.children ===
          'Alpine Golf Club mit sehr langem zugänglichem Namen hinzufügen',
      );
    expect(remotePlaceLabel?.props.numberOfLines).toBeUndefined();
    expect(renderer.root.findByType(ScrollView)).toBeTruthy();
    expect(
      renderer.root.findAll(
        node =>
          node.type === View &&
          StyleSheet.flatten(node.props.style)?.flexDirection === 'column' &&
          StyleSheet.flatten(node.props.style)?.minHeight === 72,
      ).length,
    ).toBeGreaterThan(0);
  } finally {
    await ReactTestRenderer.act(() => renderer?.unmount());
    setFontScale(1);
  }
});

test('editor validation requires type-specific data and converts local time with its zone', () => {
  const missing = validatePlanItemEditorForm({
    ...emptyEditorForm(),
    timeZone: 'Europe/Zurich',
    title: 'Golfrunde',
    type: 'golf_round',
  });
  expect(missing.values).toBeNull();
  expect(missing.errors).toMatchObject({
    golfRoundReference: 'Gib eine Rundenreferenz an.',
    golfTeeTime: 'Gib die Tee-Time an.',
  });

  const valid = validatePlanItemEditorForm({
    ...emptyEditorForm(),
    golfRoundReference: 'Carya · Runde 1',
    golfTeeTime: '2026-09-21 08:30',
    startsAt: '2026-09-21 08:30',
    timeZone: 'Europe/Zurich',
    title: 'Golfrunde',
    type: 'golf_round',
  });
  expect(valid.errors).toEqual({});
  expect(valid.values).toMatchObject({
    details: {
      roundReference: 'Carya · Runde 1',
      teeTime: '2026-09-21T06:30:00.000Z',
      type: 'golf_round',
    },
    startsAt: '2026-09-21T06:30:00.000Z',
    timeZone: 'Europe/Zurich',
  });
});

function planSnapshot(role: PlanSnapshot['role']): PlanSnapshot {
  const canEdit = role === 'owner' || role === 'organizer';
  return {
    canEdit,
    events: [
      eventNode({
        childOrderVersion: '2',
        depth: 0,
        id: 'evt_root',
        kind: 'trip',
        parentEventId: null,
        rootEventId: 'evt_root',
        title: 'Turkey Golf Tour',
      }),
      eventNode({
        depth: 1,
        id: 'evt_round',
        kind: 'golf',
        parentEventId: 'evt_root',
        rootEventId: 'evt_root',
        title: 'Carya Golf',
      }),
    ],
    issues: [],
    items: [
      item({
        eventId: 'evt_root',
        id: 'iti_transfer',
        startsAt: '2026-09-20T07:00:00.000Z',
        title: 'Transfer zum Hotel',
        type: 'road_transfer',
      }),
      item({
        eventId: 'evt_round',
        id: 'iti_round',
        startsAt: '2026-09-21T06:30:00.000Z',
        title: 'Runde auf Carya',
        type: 'golf_round',
      }),
    ],
    places: [],
    role,
    syncStatus: {
      attentionCount: 0,
      nextAttemptAt: null,
      pendingCount: 0,
      state: 'synced',
      summary: 'Zuletzt vollständig synchronisiert',
    },
  };
}

function eventNode(
  overrides: Partial<PlanSnapshot['events'][number]> &
    Pick<
      PlanSnapshot['events'][number],
      'depth' | 'id' | 'kind' | 'parentEventId' | 'rootEventId' | 'title'
    >,
): PlanSnapshot['events'][number] {
  return {
    accountUserId: 'usr_owner',
    childOrderVersion: '1',
    createdAt: '2026-07-20T08:00:00.000Z',
    deletedAt: null,
    description: null,
    endsAt: null,
    itineraryOrderVersion: '1',
    sortKey: 'a',
    startsAt: null,
    status: 'published',
    timeZone: 'Europe/Zurich',
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

function item({
  eventId,
  id,
  startsAt,
  title,
  type,
}: {
  eventId: string;
  id: string;
  startsAt: string;
  title: string;
  type: 'golf_round' | 'road_transfer';
}): PlanItemSnapshot {
  return {
    delivery: 'clean',
    id,
    placeSnapshotJson: null,
    sortKey: startsAt,
    values: {
      allDay: false,
      details:
        type === 'golf_round'
          ? {
              roundReference: 'round-1',
              schemaVersion: 1,
              teeTime: startsAt,
              type,
            }
          : {
              destinationPlaceId: 'plc_hotel',
              originPlaceId: 'plc_airport',
              schemaVersion: 1,
              type,
            },
      endsAt: null,
      eventId,
      notes: null,
      placeId: null,
      startsAt,
      status: 'active',
      timeZone: 'Europe/Zurich',
      title,
    },
    version: 1,
  };
}

function planCallbacks() {
  return {
    onAddChildEvent: jest.fn(),
    onAddItem: jest.fn(),
    onBack: jest.fn(),
    onDiscardIssue: jest.fn(),
    onEditItem: jest.fn(),
    onOpenItem: jest.fn(),
    onMoveChildEvent: jest.fn(),
    onMoveItem: jest.fn(),
    onRefresh: jest.fn(),
    onRetryIssue: jest.fn(),
    onSelectEvent: jest.fn(),
    onSelectItem: jest.fn(),
  };
}

function editorModel(
  overrides: Partial<PlanItemEditorViewModel> = {},
): PlanItemEditorViewModel {
  return {
    busy: false,
    canSubmit: true,
    delivery: 'clean',
    dirty: true,
    errors: {},
    eventTitle: 'Turkey Golf Tour',
    form: emptyEditorForm(),
    issue: null,
    message: null,
    mode: 'create',
    online: true,
    phase: 'ready',
    placeSearch: {
      action: null,
      message: null,
      query: '',
      results: [],
      target: null,
    },
    places: [
      { id: 'plc_gva', label: 'Flughafen Genf' },
      { id: 'plc_zrh', label: 'Flughafen Zürich' },
    ],
    refreshing: false,
    role: 'owner',
    saved: false,
    ...overrides,
  };
}

function emptyEditorForm(): PlanItemEditorForm {
  return {
    activityBookingReference: '',
    allDay: false,
    destinationPlaceId: '',
    endsAt: '',
    flightDesignator: '',
    golfRoundReference: '',
    golfTeeTime: '',
    lodgingCheckInAt: '',
    lodgingCheckOutAt: '',
    lodgingPropertyName: '',
    mealReservationNote: '',
    notes: '',
    originPlaceId: '',
    placeId: '',
    railServiceDesignator: '',
    roadPickupInstructions: '',
    sessionDescendantEventId: '',
    sessionRoom: '',
    startsAt: '',
    status: 'active',
    timeZone: 'Europe/Zurich',
    title: '',
    type: 'note',
  };
}

function editorCallbacks() {
  return {
    onAllDayChange: jest.fn(),
    onBack: jest.fn(),
    onChange: jest.fn(),
    onClosePlaceSearch: jest.fn(),
    onCreatePlace: jest.fn(),
    onOpenPlaceSearch: jest.fn(),
    onPlaceQueryChange: jest.fn(),
    onPrimaryAction: jest.fn(),
    onSearchPlaces: jest.fn(),
    onStatusChange: jest.fn(),
    onTypeChange: jest.fn(),
  };
}

function placeCandidate() {
  return {
    attribution: 'Crew places',
    confidence: 0.9,
    countryCode: 'CH',
    id: 'candidate_venue',
    kind: 'venue' as const,
    latitude: 46.21,
    licenseCode: 'first-party',
    licenseUrl: null,
    locality: 'Genève',
    longitude: 6.14,
    name: 'Genève-Cornavin',
    region: 'GE',
    retrievedAt: '2026-07-27T08:00:00.000Z',
    source: 'crew',
    sourceRecordUrl: null,
    status: 'enriched' as const,
    version: 1,
  };
}

function setFontScale(fontScale: number) {
  Dimensions.set({
    screen: { ...originalScreen, fontScale },
    window: { ...originalWindow, fontScale },
  });
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
