import React from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecapView } from '../src/screens/RecapView';

const eventBody = {
  actorCanDecide: ['manager'],
  authorDecision: 'unknown',
  managerDecision: 'grant',
  requiredAuthorities: ['manager'],
  selected: true,
};
const feedBody = {
  actorCanDecide: ['manager'],
  authorDecision: 'grant',
  managerDecision: 'grant',
  requiredAuthorities: ['author', 'manager'],
  selected: true,
};

function modelFor(state) {
  const role =
    state === 'viewer'
      ? 'viewer'
      : state === 'feed-author' || state === 'participant'
      ? 'participant'
      : 'organizer';
  const offline = state === 'drift-offline';
  const canDecide = state === 'feed-author' ? ['author'] : [];
  const eventExternal = offline
    ? {
        ...eventBody,
        actorCanDecide: [],
        managerDecision: 'unknown',
      }
    : role === 'organizer'
    ? eventBody
    : { ...eventBody, actorCanDecide: [] };
  const feedExternal = offline
    ? {
        ...feedBody,
        actorCanDecide: [],
        authorDecision: 'unknown',
        managerDecision: 'unknown',
      }
    : state === 'manager-withdraw'
    ? { ...feedBody, managerDecision: 'withdraw' }
    : role === 'organizer'
    ? feedBody
    : {
        ...feedBody,
        actorCanDecide: canDecide,
        authorDecision: state === 'feed-author' ? 'withdraw' : 'grant',
      };

  return {
    activeShareExpiresAt: null,
    activeShareKind: null,
    busyAction: null,
    busyExternalAuthority: null,
    busyExternalDecision: null,
    busyExternalFieldId: null,
    eventTitle: 'Turkey Golf Tour',
    items: [
      {
        body: 'Ankommen, einchecken und gemeinsam in die Reise starten.',
        externalBody: eventExternal,
        id: 'moment-0',
        title: 'Willkommen in Belek',
      },
      {
        body: 'Die Crew feiert den gemeinsamen Abend am langen Tisch.',
        externalBody: feedExternal,
        id: 'moment-1',
        title: 'Crew-Dinner',
      },
    ],
    message: offline
      ? 'Der aktuelle Freigabestatus konnte nicht bestätigt werden. Prüfe ihn erneut online.'
      : null,
    online: !offline,
    phase: 'published',
    refreshedAt: offline
      ? '2026-07-19T18:02:00.000Z'
      : '2026-07-20T08:12:00.000Z',
    role,
  };
}

function action(label) {
  Alert.alert(label, 'Isolierter visueller Release-Nachweis');
}

function RecapConsentEvidenceApp() {
  const state =
    Settings.get('CrewRecapConsentEvidenceState') ?? 'manager-grant';
  return (
    <SafeAreaProvider>
      <RecapView
        model={modelFor(state)}
        onBack={() => action('Zurück zum Event')}
        onExternalDecision={(_itemId, authority, decision) =>
          action(`${authority}:${decision}`)
        }
        onExternalSelectionToggle={() => action('Textauswahl')}
        onGenerate={() => action('Entwurf erstellen')}
        onPublish={() => action('Veröffentlichen')}
        onRefresh={() => action('Online prüfen')}
        onRemove={() => action('Rückblick entfernen')}
        onRevoke={() => action('Link widerrufen')}
        onShare={() => action('Titel-Link teilen')}
        onShareExact={() => action('Text-Link teilen')}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => RecapConsentEvidenceApp);
