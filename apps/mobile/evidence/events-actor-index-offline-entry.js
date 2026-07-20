import React from 'react';
import { Alert, AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EventsView } from '../src/screens/EventsView';

const cachedEvents = [
  {
    endsAt: '2026-09-24T18:00:00.000Z',
    kind: 'golf',
    membershipStatus: 'active',
    role: 'participant',
    rootEventId: 'evt_turkey_golf',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: 'Turkey Golf Tour',
  },
];

function EventsOfflineEvidenceApp() {
  return (
    <SafeAreaProvider>
      <EventsView
        onRetry={() =>
          Alert.alert(
            'Aktualisierung gestartet',
            'Crew prüft deine sichtbaren Events.',
          )
        }
        onSelect={rootEventId => Alert.alert('Event öffnen', rootEventId)}
        state={{
          events: cachedEvents,
          kind: 'ready',
          phase: 'offline',
          refreshedAt: '2026-07-19T12:00:00.000Z',
        }}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => EventsOfflineEvidenceApp);
