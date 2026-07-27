import { Dimensions, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  LiveItemView,
  type LiveItemReadyModel,
} from '../src/screens/LiveItemView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');

beforeEach(() => {
  Dimensions.set({
    screen: { ...originalScreen, fontScale: 1 },
    window: { ...originalWindow, fontScale: 1 },
  });
});

afterAll(() =>
  Dimensions.set({ screen: originalScreen, window: originalWindow }),
);

test('renders the complete cached detail without truncation or internal IDs', async () => {
  const { renderer } = await renderReady();
  const visible = textInside(renderer);

  expect(visible).toContain('Hinflug nach Antalya');
  expect(visible).toContain('Sonntag, 20. September 2026');
  expect(visible).toContain('10:00–12:30 Uhr');
  expect(visible).toMatch(/Zeitzone ·\s+Europe\/Zurich/);
  expect(visible).toContain('Gate E, Kloten');
  expect(visible).toContain('Treffpunkt 90 Minuten vor Abflug.');
  expect(visible).toContain('Zürich Flughafen, Kloten');
  expect(visible).toContain('Antalya Flughafen, Antalya');
  expect(visible).not.toContain('iti_secret');
  expect(
    renderer.root
      .findAllByType(Text)
      .every(
        node =>
          node.props.numberOfLines === undefined &&
          node.props.maxFontSizeMultiplier === undefined,
      ),
  ).toBe(true);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps participant and viewer detail read-only', async () => {
  for (const role of ['participant', 'viewer'] as const) {
    const { renderer } = await renderReady({ canEdit: false, role });
    expect(
      renderer.root.findAllByProps({ testID: 'live-item-edit' }),
    ).toHaveLength(0);
    expect(
      renderer.root.findAllByProps({ testID: 'live-item-golf-scorecard' }),
    ).toHaveLength(0);
    await ReactTestRenderer.act(() => renderer.unmount());
  }
});

test('exposes only supplied organizer and golf callbacks', async () => {
  const onBack = jest.fn();
  const onEdit = jest.fn();
  const onOpenGolfScorecard = jest.fn();
  const onPrimaryAction = jest.fn();
  const { renderer } = await renderReady(
    {
      canEdit: true,
      canOpenGolfScorecard: true,
      itemType: 'Golfrunde',
      primaryAction: {
        itemId: 'iti_next',
        kind: 'item',
        label: 'Nächsten Punkt öffnen',
      },
      role: 'organizer',
    },
    { onBack, onEdit, onOpenGolfScorecard, onPrimaryAction },
  );

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'live-item-primary-action' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'live-item-edit' }).props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'live-item-golf-scorecard' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root.findByProps({ testID: 'live-item-back' }).props.onPress(),
  );
  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onOpenGolfScorecard).toHaveBeenCalledTimes(1);
  expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findByProps({ testID: 'live-item-primary-action' }).props,
  ).toMatchObject({
    accessibilityLabel: 'Nächsten Programmpunkt öffnen',
    label: 'Nächsten Punkt öffnen',
  });
  expect(
    renderer.root.findByProps({ testID: 'live-item-edit' }).props,
  ).toMatchObject({
    accessibilityLabel: 'Programmpunkt bearbeiten',
    label: 'Punkt bearbeiten',
  });
  expect(
    renderer.root.findAll(
      node =>
        node.props.variant === 'action' &&
        node.props.testID?.startsWith('live-item-'),
    ),
  ).toHaveLength(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('conceals removed or denied content and supports 200 percent text', async () => {
  await ReactTestRenderer.act(() => {
    Dimensions.set({
      screen: { ...originalScreen, fontScale: 2 },
      window: { ...originalWindow, fontScale: 2 },
    });
  });
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <LiveItemView model={{ phase: 'concealed' }} onBack={jest.fn()} />
      </SafeAreaProvider>,
    );
  });

  const visible = textInside(renderer!);
  expect(visible).toContain('Inhalt nicht verfügbar');
  expect(visible).not.toContain('Hinflug nach Antalya');
  expect(
    renderer!.root
      .findAllByType(Text)
      .every(node => node.props.numberOfLines === undefined),
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer!.unmount());
});

async function renderReady(
  overrides: Partial<LiveItemReadyModel> = {},
  callbacks: {
    onBack?: () => void;
    onEdit?: () => void;
    onOpenGolfScorecard?: () => void;
    onPrimaryAction?: () => void;
  } = {},
) {
  const item: LiveItemReadyModel = {
    canEdit: false,
    canOpenGolfScorecard: false,
    dateLabel: 'Sonntag, 20. September 2026',
    details: [
      { label: 'Von', value: 'Zürich Flughafen, Kloten' },
      { label: 'Nach', value: 'Antalya Flughafen, Antalya' },
      { label: 'Flug', value: 'LX 8176' },
    ],
    eventTitle: 'Anreise',
    itemType: 'Flug',
    notes: 'Treffpunkt 90 Minuten vor Abflug.',
    place: 'Gate E, Kloten',
    primaryAction: {
      kind: 'plan',
      label: 'Vollständigen Plan ansehen',
    },
    role: 'participant',
    status: 'active',
    syncLabel: 'Offline. Gespeicherter Stand vom 27.07.2026, 10:15 Uhr.',
    syncState: 'offline',
    timeLabel: '10:00–12:30 Uhr',
    timeZone: 'Europe/Zurich',
    title: 'Hinflug nach Antalya',
    ...overrides,
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <LiveItemView
          model={{ item, phase: 'ready' }}
          onBack={callbacks.onBack ?? jest.fn()}
          onEdit={callbacks.onEdit}
          onOpenGolfScorecard={callbacks.onOpenGolfScorecard}
          onPrimaryAction={callbacks.onPrimaryAction}
        />
      </SafeAreaProvider>,
    );
  });
  return { renderer: renderer! };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}
