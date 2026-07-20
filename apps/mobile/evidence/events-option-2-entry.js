import React from 'react';
import { Alert, AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EventsView } from '../src/screens/EventsView';

const fixture = [
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
  {
    endsAt: '2026-10-29T17:00:00.000Z',
    kind: 'team_event',
    membershipStatus: 'active',
    role: 'organizer',
    rootEventId: 'evt_belek_team_retreat',
    startsAt: '2026-10-27T08:30:00.000Z',
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title: 'Belek Team Retreat',
  },
];

export function EventsEvidenceApp() {
  return (
    <SafeAreaProvider>
      <EventsView
        onSelect={rootEventId => Alert.alert('Event öffnen', rootEventId)}
        state={{
          events: fixture,
          kind: 'ready',
          phase: 'fresh',
          refreshedAt: '2026-07-19T12:00:00.000Z',
        }}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => EventsEvidenceApp);
