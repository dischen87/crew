import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { contrastRatio, contrastThresholds } from '../src/design/contrast';
import { colors } from '../src/design/theme';
import {
  EventBasicsView,
  type EventBasicsViewModel,
} from '../src/screens/EventBasicsView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

const cleanModel: EventBasicsViewModel = {
  busyAction: null,
  conflictCurrent: null,
  delivery: 'clean',
  dirty: true,
  editable: true,
  errors: {},
  focusField: 'description',
  form: {
    description: 'Zwei Tage gemeinsam am See.',
    endsAt: '2026-09-21 18:00',
    startsAt: '2026-09-20 09:00',
    timeZone: 'Europe/Zurich',
    title: 'Crew Retreat Zürich',
  },
  message: null,
  online: true,
  phase: 'ready',
  role: 'owner',
  saved: false,
};

test('renders the Option-2 existing-draft form at 390x844 and focuses the exact blocker field', async () => {
  const { onChange, onPrimaryAction, renderer } = await render(cleanModel);
  expect(textInside(renderer)).toContain('Event-Basis bearbeiten');
  const headings = renderer.root
    .findAllByType(Text)
    .filter(node => node.props.accessibilityRole === 'header');
  expect(headings).toHaveLength(1);
  expect(headings[0].props.children).toBe('Event-Basis bearbeiten');
  expect(headings[0].props.allowFontScaling).not.toBe(false);
  expect(headings[0].props.maxFontSizeMultiplier).toBeUndefined();
  expect(headings[0].props.numberOfLines).toBeUndefined();
  expect(textInside(renderer)).toContain('Privater Entwurf');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-description' }).props
      .autoFocus,
  ).toBe(true);
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.autoFocus,
  ).toBe(false);

  const primary = renderer.root.findByProps({
    testID: 'event-basics-primary-action',
  });
  expect(primary.props.label).toBe('Änderungen speichern');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('save');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-basics-title' })
      .props.onChangeText('Neuer Titel'),
  );
  expect(onChange).toHaveBeenCalledWith('title', 'Neuer Titel');

  const scroll = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
  });
  expect(StyleSheet.flatten(scroll.props.style)).not.toHaveProperty('height');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('locks an offline queued overlay and offers no second save mutation', async () => {
  const { onPrimaryAction, renderer } = await render({
    ...cleanModel,
    delivery: 'queued',
    dirty: false,
    editable: false,
    online: false,
  });
  const text = textInside(renderer);
  expect(text).toContain('Lokal dauerhaft gespeichert');
  expect(text).toContain('keine zweite Version gestapelt');
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.disabled,
  ).toBe(true);
  const primary = renderer.root.findByProps({
    testID: 'event-basics-primary-action',
  });
  expect(primary.props.label).toBe('Zurück zur Prüfung');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('back');
  expect(onPrimaryAction).not.toHaveBeenCalledWith('save');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps attempted conflict values editable beside a clearly named current server truth', async () => {
  const { onPrimaryAction, renderer } = await render({
    ...cleanModel,
    conflictCurrent: {
      ...cleanModel.form,
      description: 'Aktuell auf dem Server.',
      title: 'Server Retreat',
    },
    delivery: 'conflict',
  });
  const text = textInside(renderer);
  expect(text).toContain('SERVERSTAND GEÄNDERT');
  expect(text).toContain('AKTUELL AUF DEM SERVER');
  expect(text).toContain('Server Retreat');
  expect(text).toContain('Deine Angaben sind erhalten');
  const conflictEyebrow = renderer.root.findByProps({
    children: 'SERVERSTAND GEÄNDERT',
  });
  const conflictEyebrowColor = StyleSheet.flatten(conflictEyebrow.props.style)
    .color as string;
  expect(conflictEyebrowColor).toBe(colors.text);
  expect(
    contrastRatio(conflictEyebrowColor, colors.surfaceBrand),
  ).toBeGreaterThanOrEqual(contrastThresholds.normalText);
  expect(
    renderer.root.findByProps({ testID: 'event-basics-title' }).props.disabled,
  ).toBe(false);
  const primary = renderer.root.findByProps({
    testID: 'event-basics-primary-action',
  });
  expect(primary.props.label).toBe('Aktualisierten Stand speichern');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('save');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows validation next to the field and disables the single primary save action', async () => {
  const { renderer } = await render({
    ...cleanModel,
    errors: { endsAt: 'Das Ende muss nach dem Beginn liegen.' },
  });
  expect(textInside(renderer)).toContain(
    'Das Ende muss nach dem Beginn liegen.',
  );
  expect(
    renderer.root.findByProps({ testID: 'event-basics-primary-action' }).props
      .disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('fails closed without leaking the private draft and preserves a real back action', async () => {
  const { onBack, renderer } = await render({
    ...cleanModel,
    editable: false,
    form: {
      description: '',
      endsAt: '',
      startsAt: '',
      timeZone: '',
      title: '',
    },
    phase: 'concealed',
  });
  expect(textInside(renderer)).toContain('Details nicht verfügbar');
  expect(textInside(renderer)).not.toContain('Crew Retreat Zürich');
  const back = renderer.root.findByProps({ testID: 'event-basics-back' });
  await ReactTestRenderer.act(() => back.props.onPress());
  expect(onBack).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function render(model: EventBasicsViewModel) {
  const onBack = jest.fn();
  const onChange = jest.fn();
  const onPrimaryAction = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventBasicsView
          model={model}
          onBack={onBack}
          onChange={onChange}
          onPrimaryAction={onPrimaryAction}
        />
      </SafeAreaProvider>,
    );
  });
  return { onBack, onChange, onPrimaryAction, renderer };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .join(' ');
}
