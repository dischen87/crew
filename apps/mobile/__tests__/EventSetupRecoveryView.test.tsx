import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { EventSetupRecoverySnapshot } from '../src/screens/EventSetupRecoveryRuntime';
import {
  EventSetupRecoveryView,
  type EventSetupRecoveryViewModel,
} from '../src/screens/EventSetupRecoveryView';

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};
const onBack = jest.fn();
const onPlaceQueryChange = jest.fn();
const onPrimaryAction = jest.fn();
const onSelectPlace = jest.fn();
const onSelectTemplate = jest.fn();

beforeEach(() => jest.clearAllMocks());

test('shows honest cached context without any offline write action', async () => {
  const renderer = await render(
    model({
      online: false,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'cached'),
    }),
  );
  const text = textInside(renderer);
  expect(text).toContain('Nur sichere Offline-Kopie');
  expect(text).toContain('weder vorgemerkt noch geändert');
  expect(renderer.root.findAllByProps({ testID: 'event-setup-primary-action' })).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'event-setup-place-query' }).props
      .disabled,
  ).toBe(true);
  renderer.root.findByProps({ testID: 'event-setup-back-action' }).props.onPress();
  expect(onBack).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('treats an online cached fallback as untrusted and offers refresh only', async () => {
  const renderer = await render(
    model({
      online: true,
      placeQuery: 'Alpine',
      placeResults: [candidate()],
      selectedPlaceId: candidate().id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'cached'),
    }),
  );

  expect(textInside(renderer)).toContain('Serverstand nicht bestätigt');
  const primary = renderer.root
    .findAllByProps({ testID: 'event-setup-primary-action' })
    .filter(node => typeof node.props.label === 'string');
  expect(primary).toHaveLength(1);
  expect(primary[0]?.props.label).toBe('Erneut online prüfen');
  expect(
    renderer.root.findByProps({ testID: 'event-setup-place-query' }).props
      .disabled,
  ).toBe(true);
  expect(
    renderer.root.findByProps({
      testID: `event-setup-place-${candidate().id}`,
    }).props.disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => primary[0]?.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('refresh');
  expect(onPrimaryAction).not.toHaveBeenCalledWith('bind_place');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('exposes exactly one place action while searching and while binding', async () => {
  const searching = await render(
    model({
      placeQuery: 'Alpine',
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  const searchButtons = searching.root
    .findAllByProps({ testID: 'event-setup-primary-action' })
    .filter(node => typeof node.props.label === 'string');
  expect(searchButtons).toHaveLength(1);
  expect(textInside(searching)).toContain('Orte suchen');
  await ReactTestRenderer.act(() => searchButtons[0]?.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('search_places');

  const binding = await render(
    model({
      placeQuery: 'Alpine',
      placeResults: [candidate()],
      selectedPlaceId: candidate().id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  expect(
    binding.root
      .findAllByProps({ testID: 'event-setup-primary-action' })
      .filter(node => typeof node.props.label === 'string'),
  ).toHaveLength(1);
  expect(textInside(binding)).toContain('Als Hauptort übernehmen');
  await ReactTestRenderer.act(() =>
    binding.root
      .findByProps({ testID: `event-setup-place-${candidate().id}` })
      .props.onPress(),
  );
  expect(onSelectPlace).toHaveBeenCalledWith(candidate().id);
  await ReactTestRenderer.act(() => searching.unmount());
  await ReactTestRenderer.act(() => binding.unmount());
});

test('renders the typed capability recovery with one restore action', async () => {
  const renderer = await render(
    model({ snapshot: snapshot('EVENT_CAPABILITY_REQUIRED', 'online') }),
  );
  expect(textInside(renderer)).toContain('Stableford, Abschlag und Handicap');
  const primary = renderer.root.findByProps({
    testID: 'event-setup-primary-action',
  });
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('restore_capability');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows template adoption only after an authoritative option is selected', async () => {
  const templateSnapshot = snapshot('EVENT_TEMPLATE_REQUIRED', 'online');
  templateSnapshot.templates = [
    {
      id: 'golf-tour',
      logicalKeys: ['root', 'round'],
      summary: 'Reise, Unterkunft und Golfrunden.',
      title: 'Golf tour',
      version: 1,
    },
    {
      id: 'team-event',
      logicalKeys: ['root', 'agenda', 'activity'],
      summary: 'Venue, Agenda und Teams.',
      title: 'Team event',
      version: 1,
    },
  ];
  const renderer = await render(model({ snapshot: templateSnapshot }));
  expect(renderer.root.findAllByProps({ testID: 'event-setup-primary-action' })).toHaveLength(0);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-setup-template-golf-tour' })
      .props.onPress(),
  );
  expect(onSelectTemplate).toHaveBeenCalledWith('golf-tour');
  await ReactTestRenderer.act(() => renderer.unmount());

  const selected = await render(
    model({
      selectedTemplateId: 'golf-tour',
      snapshot: templateSnapshot,
    }),
  );
  expect(textInside(selected)).toContain('Setup übernehmen');
  await ReactTestRenderer.act(() =>
    selected.root
      .findAllByProps({ testID: 'event-setup-primary-action' })
      .find(node => node.props.label === 'Setup übernehmen')
      ?.props.onPress(),
  );
  expect(onPrimaryAction).toHaveBeenCalledWith('adopt_template');
  await ReactTestRenderer.act(() => selected.unmount());
});

test('disables option and back controls while a setup mutation is busy', async () => {
  const templateSnapshot = snapshot('EVENT_TEMPLATE_REQUIRED', 'online');
  templateSnapshot.templates = [
    {
      id: 'golf-tour',
      logicalKeys: ['root', 'round'],
      summary: 'Reise, Unterkunft und Golfrunden.',
      title: 'Golf tour',
      version: 1,
    },
  ];
  const renderer = await render(
    model({
      busyAction: 'adopt_template',
      selectedTemplateId: 'golf-tour',
      snapshot: templateSnapshot,
    }),
  );

  expect(
    renderer.root.findByProps({
      testID: 'event-setup-template-golf-tour',
    }).props,
  ).toMatchObject({ disabled: true });
  expect(
    renderer.root.findAll(
      node => node.props.accessibilityState?.disabled === true,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    renderer.root.findByProps({ testID: 'event-setup-back-action' }).props
      .disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('returns resolved authoritative state through one primary action', async () => {
  const resolved = snapshot('EVENT_CAPABILITY_REQUIRED', 'online');
  resolved.blockerActive = false;
  const renderer = await render(
    model({ phase: 'resolved', snapshot: resolved }),
  );
  expect(textInside(renderer)).toContain('Aktueller Stand passt');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-setup-primary-action' })
      .props.onPress(),
  );
  expect(onBack).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function render(viewModel: EventSetupRecoveryViewModel) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventSetupRecoveryView
          model={viewModel}
          onBack={onBack}
          onPlaceQueryChange={onPlaceQueryChange}
          onPrimaryAction={onPrimaryAction}
          onSelectPlace={onSelectPlace}
          onSelectTemplate={onSelectTemplate}
        />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

function model(
  overrides: Partial<EventSetupRecoveryViewModel> = {},
): EventSetupRecoveryViewModel {
  return {
    busyAction: null,
    message: null,
    online: true,
    phase: 'ready',
    placeQuery: '',
    placeResults: [],
    selectedPlaceId: null,
    selectedTemplateId: null,
    snapshot: null,
    ...overrides,
  };
}

function snapshot(
  code: EventSetupRecoverySnapshot['intent']['code'],
  source: EventSetupRecoverySnapshot['source'],
): EventSetupRecoverySnapshot {
  const capability = golfCapability();
  return {
    blockerActive: true,
    checkedAt: '2026-07-19T12:00:00.000Z',
    eventTitle: 'Turkey Golf Tour',
    intent: {
      capabilityType:
        code === 'EVENT_TEMPLATE_REQUIRED' ? undefined : 'golf',
      code,
      eventId: code === 'EVENT_TEMPLATE_REQUIRED' ? undefined : 'evt_round',
      rootEventId: 'evt_root',
    },
    role: 'owner',
    rootRevision: '12',
    rootVersion: 7,
    source,
    target:
      code === 'EVENT_TEMPLATE_REQUIRED'
        ? null
        : {
            capability:
              code === 'EVENT_CAPABILITY_REQUIRED' ? null : capability,
            capabilityVersion:
              code === 'EVENT_CAPABILITY_REQUIRED' ? 0 : 3,
            currentPlaceName: null,
            defaultCapability: capability,
            eventId: 'evt_round',
            eventTitle: '1. Runde · Carya Golf Club',
            type: 'golf',
          },
    template: code === 'EVENT_TEMPLATE_REQUIRED' ? null : 'golf-tour',
    templates: [],
  };
}

function golfCapability() {
  return {
    config: {
      coursePlaceId: null,
      handicapMode: 'optional' as const,
      roundState: 'planned' as const,
      scoringMode: 'stableford' as const,
      teeFormat: 'individual' as const,
    },
    schemaVersion: 1 as const,
    type: 'golf' as const,
  };
}

function candidate() {
  return {
    attribution: 'Crew places',
    confidence: 0.9,
    countryCode: 'TR',
    id: 'candidate_carya',
    kind: 'golf_course' as const,
    latitude: 36.86,
    licenseCode: 'first-party',
    licenseUrl: null,
    locality: 'Belek',
    longitude: 31.05,
    name: 'Carya Golf Club',
    region: 'Antalya',
    retrievedAt: '2026-07-19T08:00:00.000Z',
    source: 'crew',
    sourceRecordUrl: null,
    status: 'enriched' as const,
    version: 1,
  };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .filter(value => typeof value === 'string')
    .join(' ');
}
