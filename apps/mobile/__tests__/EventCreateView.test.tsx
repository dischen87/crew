import React from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import {
  EventCreateView,
  type EventCreateOption,
  type EventCreateViewProps,
  type EventCreateViewState,
} from '../src/screens/EventCreateView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

const options: readonly EventCreateOption[] = [
  {
    id: 'team-event',
    kind: 'template',
    logicalKeys: ['root', 'agenda', 'activity'],
    rootKind: 'team_event',
    summary: 'Ort, Agenda, Aktivitäten und Teameinteilung.',
    title: 'Team-Event',
    version: 1,
  },
  {
    id: 'blank',
    kind: 'blank',
    logicalKeys: [],
    rootKind: 'other',
    summary:
      'Ein leerer Entwurf. Struktur, Termine und Inhalte ergänzt du später.',
    title: 'Leeres Event',
  },
];

async function renderView(
  state: EventCreateViewState,
  overrides: Partial<EventCreateViewProps> = {},
) {
  const props: EventCreateViewProps = {
    onBack: jest.fn(),
    onDescriptionChange: jest.fn(),
    onExit: jest.fn(),
    onReviewCreation: jest.fn(),
    onRetryCreation: jest.fn(),
    onRetryTemplates: jest.fn(),
    onSelectOption: jest.fn(),
    onSubmit: jest.fn(),
    onTitleChange: jest.fn(),
    onUseOption: jest.fn(),
    state,
    ...overrides,
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventCreateView {...props} />
      </SafeAreaProvider>,
    );
  });
  return { props, renderer };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string')
    .join(' ');
}

test('renders only real template and blank choices with an explicit accessible selection', async () => {
  const onSelectOption = jest.fn();
  const onUseOption = jest.fn();
  const { renderer } = await renderView(
    {
      kind: 'shape',
      options,
      retryingTemplates: false,
      selectedId: 'team-event',
      templatesUnavailable: false,
    },
    { onSelectOption, onUseOption },
  );

  expect(textInside(renderer)).toMatch(
    /Start wählen.*Team-Event.*Ort, Agenda, Aktivitäten und Teameinteilung.*Leeres Event/s,
  );
  expect(textInside(renderer)).not.toMatch(/Demo|Beispielvorlage|Buchung/);
  const selected = renderer.root.findByProps({
    testID: 'event-create-option-team-event',
  });
  expect(selected.props.accessibilityRole).toBe('radio');
  expect(selected.props.accessibilityState).toEqual({ checked: true });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-option-blank' })
      .props.onPress(),
  );
  expect(onSelectOption).toHaveBeenCalledWith('blank');

  const use = renderer.root.findByProps({ testID: 'event-create-use-option' });
  expect(use.props.label).toBe('Dieses Setup verwenden');
  await ReactTestRenderer.act(() => use.props.onPress());
  expect(onUseOption).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps the German unavailable copy honest and leaves blank creation usable', async () => {
  const onRetryTemplates = jest.fn();
  const { renderer } = await renderView(
    {
      kind: 'shape',
      options: [options[1]],
      retryingTemplates: false,
      selectedId: 'blank',
      templatesUnavailable: true,
    },
    { onRetryTemplates },
  );

  expect(textInside(renderer)).toContain(
    'Vorschläge sind nicht verfügbar. Du kannst ohne Vorlage starten.',
  );
  expect(
    renderer.root.findByProps({ testID: 'event-create-use-option' }).props
      .label,
  ).toBe('Leer starten');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-retry-templates' })
      .props.onPress(),
  );
  expect(onRetryTemplates).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders the complete details form, validation and back path with an uncapped wrapping H1', async () => {
  const longTitle =
    'Strategiewoche für Produkt, Betrieb und internationale Partnerorganisationen';
  const onTitleChange = jest.fn();
  const onDescriptionChange = jest.fn();
  const onBack = jest.fn();
  const { renderer } = await renderView(
    {
      description:
        'Eine ausführliche Beschreibung für alle Beteiligten, die auch bei grosser Schrift vollständig umbrechen muss.',
      kind: 'details',
      option: options[0],
      submissionError:
        'Noch nicht gespeichert. Prüfe das markierte Feld; deine übrigen Angaben sind erhalten.',
      submitting: false,
      timeZone: 'Europe/Zurich',
      title: longTitle,
      titleError: 'Gib einen Titel mit höchstens 160 Zeichen ein.',
    },
    { onBack, onDescriptionChange, onTitleChange },
  );

  expect(textInside(renderer)).toContain('Event-Details');
  expect(textInside(renderer)).toContain(
    'Nur Titel und Zeitzone sind erforderlich. Weitere Angaben kannst du später ergänzen.',
  );
  expect(textInside(renderer)).toContain('Europe/Zurich');
  expect(textInside(renderer)).toContain('Noch nicht gespeichert.');
  const title = renderer.root.findByProps({ testID: 'event-create-title' });
  const description = renderer.root.findByProps({
    testID: 'event-create-description',
  });
  expect(title.props.maxLength).toBe(160);
  expect(description.props.maxLength).toBe(20_000);
  expect(description.props.multiline).toBe(true);
  await ReactTestRenderer.act(() => title.props.onChangeText('Neuer Titel'));
  await ReactTestRenderer.act(() =>
    description.props.onChangeText('Neue Beschreibung'),
  );
  expect(onTitleChange).toHaveBeenCalledWith('Neuer Titel');
  expect(onDescriptionChange).toHaveBeenCalledWith('Neue Beschreibung');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-details-back' })
      .props.onPress(),
  );
  expect(onBack).toHaveBeenCalledTimes(1);

  const heading = renderer.root.findByProps({ accessibilityRole: 'header' });
  expect(heading.props.allowFontScaling).not.toBe(false);
  expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.props.numberOfLines).toBeUndefined();
  expect(
    renderer.root
      .findAllByType(Text)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);
  expect(
    renderer.root
      .findAllByType(TextInput)
      .every(node => node.props.maxFontSizeMultiplier === undefined),
  ).toBe(true);
  expect(
    renderer.root.findByType(ScrollView).props.keyboardShouldPersistTaps,
  ).toBe('handled');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('makes queued, retry and exit behavior explicit without claiming server success', async () => {
  const onRetryCreation = jest.fn();
  const onExit = jest.fn();
  const { renderer } = await renderView(
    {
      kind: 'queued',
      mode: 'offline',
      recovery: 'retry',
      retrying: false,
      rootEventId: 'evt_pending',
      title: 'Crew-Wochenende',
    },
    { onExit, onRetryCreation },
  );

  expect(textInside(renderer)).toContain(
    'Entwurf lokal gespeichert. Wartet auf Verbindung.',
  );
  expect(textInside(renderer)).not.toMatch(/erstellt|veröffentlicht/i);
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'event-create-retry' }).props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-create-to-events' })
      .props.onPress(),
  );
  expect(onRetryCreation).toHaveBeenCalledTimes(1);
  expect(onExit).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAllByType(Button).length).toBeGreaterThanOrEqual(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('offers truthful review for a rejected draft and no false retry for terminal failures', async () => {
  const onReviewCreation = jest.fn();
  const reviewable = await renderView(
    {
      kind: 'queued',
      mode: 'attention',
      recovery: 'review',
      retrying: false,
      rootEventId: 'evt_rejected',
      title: 'Erhaltener Entwurf',
    },
    { onReviewCreation },
  );
  expect(textInside(reviewable.renderer)).toContain(
    'Deine Angaben bleiben lokal gespeichert',
  );
  expect(
    reviewable.renderer.root.findAllByProps({ testID: 'event-create-retry' }),
  ).toEqual([]);
  await ReactTestRenderer.act(() =>
    reviewable.renderer.root
      .findByProps({ testID: 'event-create-review' })
      .props.onPress(),
  );
  expect(onReviewCreation).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => reviewable.renderer.unmount());

  const terminal = await renderView({
    kind: 'queued',
    mode: 'attention',
    recovery: 'none',
    retrying: false,
    rootEventId: 'evt_terminal',
    title: 'Lokal erhaltener Entwurf',
  });
  expect(textInside(terminal.renderer)).toContain(
    'Dein Entwurf bleibt lokal gespeichert',
  );
  expect(
    terminal.renderer.root.findAll(
      node =>
        node.props.testID === 'event-create-retry' ||
        node.props.testID === 'event-create-review',
    ),
  ).toEqual([]);
  await ReactTestRenderer.act(() => terminal.renderer.unmount());
});
