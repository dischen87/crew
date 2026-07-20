import React from 'react';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TeamDecisionView } from '../src/screens/TeamDecisionView';

export function TeamDecisionEvidenceApp() {
  return (
    <SafeAreaProvider>
      <TeamDecisionView
        model={{
          authoritativeOptionId: null,
          canRespond: false,
          createdAt: '2026-09-20T16:00:00.000Z',
          decisionId: 'tdc_team_challenge',
          deliveryLabel: 'Aktion erforderlich · Auswahl lokal erhalten',
          deliveryState: 'needs_attention',
          eventId: 'evt_team_session',
          eventTitle: 'Belek Team Retreat',
          lifecycle: 'closed',
          options: [
            {
              id: 'tdo_outdoor',
              label: 'Outdoor Challenge',
              responseCount: 5,
            },
            {
              id: 'tdo_cooking',
              label: 'Cooking Battle',
              responseCount: 2,
            },
            {
              id: 'tdo_quiz',
              label: 'Crew Quiz',
              responseCount: 1,
            },
          ],
          responseCount: 8,
          responseMutationId: 'mutation-local-response',
          role: 'participant',
          rootEventId: 'evt_team_retreat',
          selectedOptionId: 'tdo_outdoor',
          title: 'Welche Team-Challenge starten wir?',
          version: 3,
        }}
        onBack={() => {}}
        onPrimaryAction={() => {}}
        onSelectOption={() => {}}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => TeamDecisionEvidenceApp);
