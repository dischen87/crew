import React, { useState } from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EventSetupRecoveryView } from '../src/screens/EventSetupRecoveryView';

const place = {
  attribution: 'Crew places',
  confidence: 0.9,
  countryCode: 'TR',
  id: 'candidate_carya',
  kind: 'golf_course',
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
  status: 'enriched',
  version: 1,
};

const golfCapability = {
  config: {
    coursePlaceId: null,
    handicapMode: 'optional',
    roundState: 'planned',
    scoringMode: 'stableford',
    teeFormat: 'individual',
  },
  schemaVersion: 1,
  type: 'golf',
};

const templates = [
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

export const eventSetupRecoveryEvidenceStates = Object.freeze([
  'cached-offline',
  'cached-online',
  'capability',
  'concealed',
  'place-no-results',
  'place-results',
  'place-selected',
  'resolved',
  'template-selected',
  'template-unselected',
]);
const evidenceStateSet = new Set(eventSetupRecoveryEvidenceStates);

export function resolveEventSetupRecoveryEvidenceState(rawState) {
  if (rawState === null || rawState === undefined) {
    return 'template-unselected';
  }
  if (!evidenceStateSet.has(rawState)) {
    throw new Error(`Unsupported CrewEvidenceState: ${String(rawState)}`);
  }
  return rawState;
}

function snapshot(code, source = 'online') {
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
    target:
      code === 'EVENT_TEMPLATE_REQUIRED'
        ? null
        : {
            capability:
              code === 'EVENT_CAPABILITY_REQUIRED' ? null : golfCapability,
            capabilityVersion: code === 'EVENT_CAPABILITY_REQUIRED' ? 0 : 3,
            currentPlaceName: null,
            defaultCapability: golfCapability,
            eventId: 'evt_round',
            eventTitle: '1. Runde · Carya Golf Club',
            type: 'golf',
          },
    template: code === 'EVENT_TEMPLATE_REQUIRED' ? null : 'golf-tour',
    templates: code === 'EVENT_TEMPLATE_REQUIRED' ? templates : [],
  };
}

export function eventSetupRecoveryModelFor(rawState) {
  const state = resolveEventSetupRecoveryEvidenceState(rawState);
  const base = {
    busyAction: null,
    message: null,
    online: true,
    phase: 'ready',
    placeQuery: '',
    placeResults: [],
    selectedPlaceId: null,
    selectedTemplateId: null,
    snapshot: snapshot('EVENT_TEMPLATE_REQUIRED'),
  };
  if (state === 'template-selected') {
    return { ...base, selectedTemplateId: 'golf-tour' };
  }
  if (state === 'capability') {
    return { ...base, snapshot: snapshot('EVENT_CAPABILITY_REQUIRED') };
  }
  if (state === 'place-no-results') {
    return {
      ...base,
      message: 'Keine bestätigten Orte gefunden. Passe die Suche an.',
      placeQuery: 'Nicht vorhandener Golfplatz',
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED'),
    };
  }
  if (state === 'place-results') {
    return {
      ...base,
      placeQuery: 'Carya',
      placeResults: [place],
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED'),
    };
  }
  if (state === 'place-selected') {
    return {
      ...base,
      placeQuery: 'Carya',
      placeResults: [place],
      selectedPlaceId: place.id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED'),
    };
  }
  if (state === 'cached-offline' || state === 'cached-online') {
    return {
      ...base,
      online: state === 'cached-online',
      placeQuery: 'Carya',
      placeResults: [place],
      selectedPlaceId: place.id,
      snapshot: snapshot('EVENT_CAPABILITY_PLACE_REQUIRED', 'cached'),
    };
  }
  if (state === 'resolved') {
    const resolved = snapshot('EVENT_CAPABILITY_REQUIRED');
    resolved.blockerActive = false;
    return { ...base, phase: 'resolved', snapshot: resolved };
  }
  if (state === 'concealed') {
    return {
      ...base,
      message: 'Dieser private Setup-Ablauf ist nicht verfügbar.',
      phase: 'concealed',
      snapshot: null,
    };
  }
  return base;
}

export function EventSetupRecoveryEvidenceApp({
  evidenceState,
  initialMetrics,
} = {}) {
  const [model, setModel] = useState(() =>
    eventSetupRecoveryModelFor(
      evidenceState === undefined
        ? Settings.get('CrewEvidenceState')
        : evidenceState,
    ),
  );

  return (
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <EventSetupRecoveryView
        model={model}
        onBack={() => Alert.alert('Zurück zur Prüfung')}
        onPlaceQueryChange={placeQuery =>
          setModel(current => ({ ...current, placeQuery }))
        }
        onPrimaryAction={action => {
          if (action === 'search_places') {
            setModel(current => ({ ...current, placeResults: [place] }));
            return;
          }
          if (action === 'refresh') {
            setModel(current => ({
              ...current,
              online: true,
              snapshot: current.snapshot
                ? { ...current.snapshot, source: 'online' }
                : current.snapshot,
            }));
            return;
          }
          setModel(current => ({
            ...current,
            message: 'Stand passt. Zurück zur Event-Prüfung.',
            phase: 'resolved',
            snapshot: current.snapshot
              ? { ...current.snapshot, blockerActive: false }
              : current.snapshot,
          }));
        }}
        onSelectPlace={selectedPlaceId =>
          setModel(current => ({ ...current, selectedPlaceId }))
        }
        onSelectTemplate={selectedTemplateId =>
          setModel(current => ({ ...current, selectedTemplateId }))
        }
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => EventSetupRecoveryEvidenceApp);
