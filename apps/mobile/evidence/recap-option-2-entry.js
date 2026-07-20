import React from 'react';
import { Alert, AppRegistry, Settings } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RecapView } from '../src/screens/RecapView';

const turkeyGolfPublishedRecapModel = {
  activeShareExpiresAt: null,
  busyAction: null,
  eventTitle: 'Turkey Golf Tour',
  items: [
    {
      body: 'Ankommen, einchecken und gemeinsam in die Reise starten.',
      id: 'recap-welcome',
      title: 'Willkommen in Belek',
    },
    {
      body: 'Die erste Runde führte die Crew über den Carya Golf Course.',
      id: 'recap-carya',
      title: 'Auftakt auf dem Carya Golf Course',
    },
  ],
  message: null,
  online: true,
  phase: 'published',
  refreshedAt: '2026-09-24T18:02:00.000Z',
  role: 'organizer',
};

const participantOffline = {
  ...turkeyGolfPublishedRecapModel,
  online: false,
  role: 'participant',
};

const organizerDraft = {
  ...turkeyGolfPublishedRecapModel,
  phase: 'draft',
  refreshedAt: '2026-09-24T17:56:00.000Z',
};

function action(label) {
  Alert.alert(label, 'Evidence interaction');
}

function RecapEvidenceApp() {
  const state = Settings.get('CrewEvidenceState') ?? 'organizer-published';
  const model =
    state === 'participant-offline'
      ? participantOffline
      : state === 'organizer-draft'
      ? organizerDraft
      : turkeyGolfPublishedRecapModel;

  return (
    <SafeAreaProvider>
      <RecapView
        model={model}
        onBack={() => action('Zurück zum Event')}
        onGenerate={() => action('Entwurf erstellen')}
        onPublish={() => action('Für die Crew veröffentlichen')}
        onRefresh={() => action('Verbindung prüfen')}
        onRemove={() => action('Rückblick entfernen')}
        onRevoke={() => action('Freigabe widerrufen')}
        onShare={() => action('Titel-Link teilen')}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => RecapEvidenceApp);
