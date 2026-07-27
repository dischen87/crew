import ReactTestRenderer from 'react-test-renderer';
import { Dimensions, StyleSheet, Text } from 'react-native';
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
const originalWindow = Dimensions.get('window');
const originalScreen = Dimensions.get('screen');
const onBack = jest.fn();
const onCountryCodeChange = jest.fn();
const onPlaceQueryChange = jest.fn();
const onPrimaryAction = jest.fn();
const onSelectPlace = jest.fn();
const onSelectTemplate = jest.fn();

function setFontScale(fontScale: number) {
  Dimensions.set({
    screen: { ...originalScreen, fontScale },
    window: { ...originalWindow, fontScale },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setFontScale(1);
});
afterAll(() =>
  Dimensions.set({ screen: originalScreen, window: originalWindow }),
);

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
  expect(
    renderer.root.findAllByProps({ testID: 'event-setup-primary-action' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'event-setup-place-query' }).props
      .disabled,
  ).toBe(true);
  renderer.root
    .findByProps({ testID: 'event-setup-back-action' })
    .props.onPress();
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
  expect(textInside(searching)).toContain('Veranstaltungsort');
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
  expect(textInside(binding)).toMatch(/Gewählt:\s+Carya Golf Club/);
  expect(textInside(binding)).not.toContain('Ausgewählt:');
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

test('does not submit or offer worldwide search for a one-character query', async () => {
  const renderer = await render(
    model({
      placeQuery: ' A ',
      placeSearchMiss: true,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
      worldwideCountryCode: 'TR',
      worldwideExpanded: true,
    }),
  );

  expect(
    renderer.root.findAllByProps({ testID: 'event-setup-primary-action' }),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ testID: 'event-setup-worldwide-start' }).props
      .disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'event-setup-place-query' })
      .props.onSubmitEditing(),
  );
  expect(onPrimaryAction).not.toHaveBeenCalledWith('search_places');
  expect(onPrimaryAction).not.toHaveBeenCalledWith('start_worldwide_search');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('explains enrichment progress, retry and provider fallback with a next action', async () => {
  const pending = await render(
    model({
      placeEnrichment: enrichmentProjection('pending'),
      placeQuery: 'Alpine',
      placeResults: [candidate()],
      selectedPlaceId: candidate().id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  expect(textInside(pending)).toContain('Ortsdetails werden ergänzt.');
  expect(textInside(pending)).toContain(
    'Du kannst den Ort jetzt als Hauptort übernehmen.',
  );

  const retry = await render(
    model({
      placeEnrichment: enrichmentProjection('retry'),
      placeQuery: 'Alpine',
      placeResults: [candidate()],
      selectedPlaceId: candidate().id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  expect(textInside(retry)).toContain(
    'Ortsdetails brauchen einen neuen Versuch.',
  );
  const retryAction = retry.root.findByProps({
    testID: 'event-setup-enrichment-retry',
  });
  expect(retryAction.props).toMatchObject({
    accessibilityHint:
      'Startet einen neuen Versuch für die zusätzlichen Ortsdetails. Der gewählte Hauptort bleibt unverändert.',
    label: 'Ortsdetails erneut laden',
  });
  await ReactTestRenderer.act(() => retryAction.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('retry_enrichment');

  const unavailable = await render(
    model({
      placeEnrichmentUnavailable: true,
      placeQuery: 'Alpine',
      placeResults: [candidate()],
      selectedPlaceId: candidate().id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  const unavailableText = textInside(unavailable);
  expect(unavailableText).toContain(
    'Zusätzliche Ortsdetails sind gerade nicht verfügbar.',
  );
  expect(unavailableText).toContain(
    'trotzdem mit den bereits angezeigten Angaben als Hauptort übernehmen.',
  );
  expect(unavailableText).not.toMatch(/\bpending\b|\bretry\b|\bdead\b/);

  await ReactTestRenderer.act(() => pending.unmount());
  await ReactTestRenderer.act(() => retry.unmount());
  await ReactTestRenderer.act(() => unavailable.unmount());
});

test('keeps worldwide search behind an empty-result disclosure and validates the visible country', async () => {
  const empty = await render(
    model({
      placeQuery: 'Ocean Dunes',
      placeSearchMiss: true,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
    }),
  );
  expect(textInside(empty)).toContain('Kein passender Ort gefunden.');
  expect(
    empty.root.findAllByProps({ testID: 'event-setup-worldwide-country' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() =>
    empty.root
      .findByProps({ testID: 'event-setup-worldwide-open' })
      .props.onPress(),
  );
  expect(onPrimaryAction).toHaveBeenCalledWith('open_worldwide_search');
  await ReactTestRenderer.act(() => empty.unmount());

  const invalidSnapshot = snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online');
  invalidSnapshot.suggestedCountryCode = null;
  const invalid = await render(
    model({
      placeQuery: 'Ocean Dunes',
      placeSearchMiss: true,
      snapshot: invalidSnapshot,
      worldwideExpanded: true,
    }),
  );
  expect(textInside(invalid)).toContain(
    'Gib einen zweistelligen Ländercode wie CH oder DE ein.',
  );
  expect(
    invalid.root.findByProps({ testID: 'event-setup-worldwide-start' }).props
      .disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() =>
    invalid.root
      .findByProps({ testID: 'event-setup-worldwide-country' })
      .props.onChangeText('d'),
  );
  expect(onCountryCodeChange).toHaveBeenCalledWith('d');
  await ReactTestRenderer.act(() => invalid.unmount());

  const valid = await render(
    model({
      placeQuery: 'Ocean Dunes',
      placeSearchMiss: true,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
      worldwideCountryCode: 'TR',
      worldwideExpanded: true,
    }),
  );
  expect(textInside(valid)).toContain(
    'Aus den eindeutigen Orten dieses Events vorgeschlagen.',
  );
  const start = valid.root.findByProps({
    testID: 'event-setup-worldwide-start',
  });
  expect(start.props.disabled).toBe(false);
  await ReactTestRenderer.act(() => start.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('start_worldwide_search');
  await ReactTestRenderer.act(() => valid.unmount());
});

test('renders only cited review fields with Large-Text-safe 48pt approve and reject controls', async () => {
  setFontScale(2);
  const renderer = await render(
    model({
      placeQuery: 'Ocean Dunes',
      placeSearchMiss: true,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
      worldwideCountryCode: 'TR',
      worldwideEnrichment: worldwideProjection('pending'),
      worldwideExpanded: true,
    }),
  );
  const text = textInside(renderer);
  expect(text).toContain('Prüfe den weltweiten Vorschlag.');
  expect(text).toContain('Ocean Dunes Golf Club');
  expect(text).toContain('https://example.com/ocean-dunes');
  expect(text).not.toMatch(/\bprompt\b|\bmodel\b|\bquery\b|\bjob\b/i);
  const approve = renderer.root
    .findAllByProps({ testID: 'event-setup-worldwide-approve' })
    .find(node => typeof node.props.style === 'function');
  const reject = renderer.root
    .findAllByProps({ testID: 'event-setup-worldwide-reject' })
    .find(node => typeof node.props.style === 'function');
  if (!approve || !reject) throw new Error('Expected review controls');
  expect(
    StyleSheet.flatten(approve.props.style({ pressed: false })),
  ).toMatchObject({
    minHeight: 48,
  });
  expect(
    StyleSheet.flatten(reject.props.style({ pressed: false })),
  ).toMatchObject({
    minHeight: 48,
  });
  expect(approve.props.accessibilityRole).toBe('button');
  expect(reject.props.accessibilityRole).toBe('button');
  const source = renderer.root
    .findAllByType(Text)
    .find(node =>
      String(node.props.children).includes(
        'Quelle: https://example.com/ocean-dunes',
      ),
    );
  expect(source?.props.numberOfLines).toBeUndefined();
  await ReactTestRenderer.act(() => approve.props.onPress());
  await ReactTestRenderer.act(() => reject.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('approve_worldwide_place');
  expect(onPrimaryAction).toHaveBeenCalledWith('reject_worldwide_place');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps query and country editable when review is permanently unavailable', async () => {
  const renderer = await render(
    model({
      placeQuery: 'Ocean Dunes',
      placeSearchMiss: true,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'online'),
      worldwideCountryCode: 'TR',
      worldwideEnrichment: worldwideProjection('pending'),
      worldwideExpanded: true,
      worldwideUnavailable: true,
    }),
  );

  expect(
    renderer.root.findByProps({ testID: 'event-setup-place-query' }).props
      .disabled,
  ).toBe(false);
  expect(
    renderer.root.findByProps({ testID: 'event-setup-worldwide-country' }).props
      .disabled,
  ).toBe(false);
  expect(
    renderer.root.findAllByProps({
      testID: 'event-setup-worldwide-approve',
    }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAllByProps({
      testID: 'event-setup-worldwide-reject',
    }),
  ).toHaveLength(0);
  expect(textInside(renderer)).toContain(
    'Dein Suchbegriff und das Land bleiben erhalten',
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('renders the typed capability recovery with one restore action', async () => {
  const renderer = await render(
    model({ snapshot: snapshot('EVENT_CAPABILITY_REQUIRED', 'online') }),
  );
  const text = textInside(renderer);
  expect(text).toContain('EVENT-SETUP');
  expect(text).toContain('Setup fehlt');
  expect(text).toContain('Stableford, Abschlag und Handicap');
  expect(text).not.toContain(
    'Die serverseitige Vorlage liefert die typisierte Standardkonfiguration.',
  );
  const primary = renderer.root.findByProps({
    testID: 'event-setup-primary-action',
  });
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledWith('restore_capability');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('uses readable Large-Text copy for the travel capability', async () => {
  const travel = snapshot('EVENT_CAPABILITY_REQUIRED', 'online');
  if (!travel.target) throw new Error('Expected capability target');
  travel.target = {
    ...travel.target,
    capability: null,
    defaultCapability: travelCapability(),
    type: 'travel',
  };
  const renderer = await render(model({ snapshot: travel }));

  expect(textInside(renderer)).toContain(
    'Heimatort und Reise-Referenz bleiben klar getrennt.',
  );
  expect(textInside(renderer)).not.toContain('Reisereferenz');
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows template adoption only after an authoritative option is selected', async () => {
  const templateSnapshot = snapshot('EVENT_TEMPLATE_REQUIRED', 'online');
  templateSnapshot.templates = [
    {
      id: 'travel',
      logicalKeys: ['root', 'arrival', 'lodging'],
      summary: 'Arrival, lodging and participant transport.',
      title: 'Travel',
      version: 1,
    },
    {
      id: 'golf-tour',
      logicalKeys: ['root', 'round'],
      summary: 'Travel, lodging, transport, courses and golf rounds.',
      title: 'Golf tour',
      version: 1,
    },
    {
      id: 'team-event',
      logicalKeys: ['root', 'agenda', 'activity'],
      summary: 'Venue, agenda, activities and team assignment.',
      title: 'Team event',
      version: 1,
    },
  ];
  const renderer = await render(model({ snapshot: templateSnapshot }));
  expect(
    ['travel', 'golf-tour', 'team-event'].map(
      id =>
        renderer.root
          .findAllByProps({ testID: `event-setup-template-${id}` })
          .find(node => typeof node.props.accessibilityLabel === 'string')
          ?.props.accessibilityLabel,
    ),
  ).toEqual([
    'Reise. Anreise, Unterkunft und Transport.',
    'Golfreise. Reise, Unterkunft, Transfers, Golfplätze und Runden.',
    'Team-Event. Ort, Agenda, Programm und Teams.',
  ]);
  const renderedCopy = textInside(renderer);
  expect(renderedCopy).toContain('Anreise, Unterkunft und Transport.');
  expect(renderedCopy).toContain(
    'Reise, Unterkunft, Transfers, Golfplätze und Runden.',
  );
  expect(renderedCopy).toContain('Ort, Agenda, Programm und Teams.');
  expect(renderedCopy).not.toMatch(
    /Arrival, lodging|Travel, lodging|Venue, agenda/,
  );
  expect(
    renderer.root.findAllByProps({ testID: 'event-setup-primary-action' }),
  ).toHaveLength(0);
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
  expect(textInside(selected)).toMatch(/Gewählt:\s+Golfreise/);
  expect(textInside(selected)).not.toContain('Ausgewählt:');
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

test('gives template copy full width at Large Text without changing the normal row', async () => {
  const templateSnapshot = snapshot('EVENT_TEMPLATE_REQUIRED', 'online');
  templateSnapshot.templates = [
    {
      id: 'team-event',
      logicalKeys: ['root', 'agenda', 'activity'],
      summary: 'Venue, agenda, activities and team assignment.',
      title: 'Team event',
      version: 1,
    },
  ];

  const normal = await render(model({ snapshot: templateSnapshot }));
  expect(
    StyleSheet.flatten(
      normal.root.findByProps({
        testID: 'event-setup-template-team-event-card',
      }).props.style,
    ),
  ).toMatchObject({ alignItems: 'center', flexDirection: 'row' });
  await ReactTestRenderer.act(() => normal.unmount());

  setFontScale(2);
  const large = await render(model({ snapshot: templateSnapshot }));
  expect(
    StyleSheet.flatten(
      large.root.findByProps({ testID: 'event-setup-template-team-event-card' })
        .props.style,
    ),
  ).toMatchObject({ alignItems: 'stretch', flexDirection: 'column' });
  expect(
    StyleSheet.flatten(
      large.root.findByProps({ testID: 'event-setup-template-team-event-copy' })
        .props.style,
    ),
  ).toMatchObject({ alignSelf: 'stretch', flex: 0 });
  expect(
    StyleSheet.flatten(
      large.root.findByProps({
        testID: 'event-setup-template-team-event-radio',
      }).props.style,
    ),
  ).toMatchObject({ alignSelf: 'flex-end' });
  await ReactTestRenderer.act(() => large.unmount());
});

test('disables option and back controls while a setup mutation is busy', async () => {
  const templateSnapshot = snapshot('EVENT_TEMPLATE_REQUIRED', 'online');
  templateSnapshot.templates = [
    {
      id: 'golf-tour',
      logicalKeys: ['root', 'round'],
      summary: 'Reise, Unterkunft und Golfrunden.',
      title: 'Golfreise',
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
  expect(textInside(renderer)).toContain('Stand passt');
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
          onCountryCodeChange={onCountryCodeChange}
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
    placeEnrichment: null,
    placeEnrichmentUnavailable: false,
    placeQuery: '',
    placeResults: [],
    placeSearchMiss: false,
    selectedPlaceId: null,
    selectedTemplateId: null,
    snapshot: null,
    worldwideCountryCode: '',
    worldwideEnrichment: null,
    worldwideExpanded: false,
    worldwidePollingPaused: false,
    worldwideUnavailable: false,
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
      capabilityType: code === 'EVENT_TEMPLATE_REQUIRED' ? undefined : 'golf',
      code,
      eventId: code === 'EVENT_TEMPLATE_REQUIRED' ? undefined : 'evt_round',
      rootEventId: 'evt_root',
    },
    role: 'owner',
    rootRevision: '12',
    rootVersion: 7,
    source,
    suggestedCountryCode: 'TR',
    target:
      code === 'EVENT_TEMPLATE_REQUIRED'
        ? null
        : {
            capability:
              code === 'EVENT_CAPABILITY_REQUIRED' ? null : capability,
            capabilityVersion: code === 'EVENT_CAPABILITY_REQUIRED' ? 0 : 3,
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

function travelCapability() {
  return {
    config: {
      homePlaceId: null,
      travelerReferenceLabel: 'Travel reference',
    },
    schemaVersion: 1 as const,
    type: 'travel' as const,
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

function enrichmentProjection(status: 'pending' | 'retry') {
  return {
    enrichment: {
      completedAt: null,
      createdAt: '2026-07-19T10:00:00.000Z',
      id: `pej_${'b'.repeat(64)}`,
      pollAfterSeconds: status === 'retry' ? 5 : 2,
      retryAllowed: status === 'retry',
      status,
      updatedAt: '2026-07-19T10:00:00.000Z',
    },
    place: null,
    review: null,
  };
}

function worldwideProjection(state: 'pending' | 'approved' | 'rejected') {
  return {
    enrichment: {
      completedAt: '2026-07-19T10:01:00.000Z',
      createdAt: '2026-07-19T10:00:00.000Z',
      id: `pej_${'d'.repeat(64)}`,
      pollAfterSeconds: null,
      retryAllowed: false,
      status: 'succeeded' as const,
      updatedAt: '2026-07-19T10:01:00.000Z',
    },
    place:
      state === 'approved'
        ? {
            address: 'Ocean Road 1',
            countryCode: 'TR',
            id: `gpl_${'d'.repeat(64)}`,
            kind: 'golf_course' as const,
            latitude: 36.86,
            locality: 'Belek',
            longitude: 31.05,
            name: 'Ocean Dunes Golf Club',
            region: 'Antalya',
            sourceCandidateId: `pcd_${'e'.repeat(64)}`,
            summary: 'A reviewed golf course.',
            websiteUrl: 'https://example.com/ocean-dunes',
          }
        : null,
    review: {
      fields: [
        {
          name: 'name' as const,
          provenance: {
            observedAt: '2026-07-19T09:59:00.000Z',
            sourceKind: 'exa_llm' as const,
            sourceUrl: 'https://example.com/ocean-dunes',
          },
          value: 'Ocean Dunes Golf Club',
        },
        {
          name: 'websiteUrl' as const,
          provenance: {
            observedAt: '2026-07-19T09:59:00.000Z',
            sourceKind: 'exa_llm' as const,
            sourceUrl: 'https://example.com/ocean-dunes',
          },
          value: 'https://example.com/ocean-dunes',
        },
      ],
      state,
    },
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
