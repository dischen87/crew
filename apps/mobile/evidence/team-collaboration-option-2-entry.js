import React, { useState } from 'react';
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TeamAssignmentsView } from '../src/screens/TeamAssignmentsView';
import { TeamDecisionView } from '../src/screens/TeamDecisionView';

const people = {
  aylin: {
    avatar: require('../src/assets/participants/aylin-avatar.png'),
    id: 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Aylin',
  },
  david: {
    avatar: require('../src/assets/participants/david-avatar.png'),
    id: 'usr_dddddddddddddddddddddddddddddddd',
    name: 'David',
  },
  lena: {
    avatar: require('../src/assets/participants/lena-avatar.png'),
    id: 'usr_11111111111111111111111111111111',
    name: 'Lena',
  },
  marco: {
    avatar: require('../src/assets/participants/marco-avatar.png'),
    id: 'usr_22222222222222222222222222222222',
    name: 'Marco',
  },
};

export function TeamCollaborationEvidenceApp() {
  const [screen, setScreen] = useState('assignments');
  const [teams, setTeams] = useState([
    {
      capacity: 3,
      color: '#D5C2E8',
      id: 'ttm_lavender',
      members: [people.lena, people.marco],
      name: 'Lavendel',
    },
    {
      capacity: 3,
      color: '#C2E8D5',
      id: 'ttm_mint',
      members: [people.aylin, people.david],
      name: 'Mint',
    },
  ]);

  if (screen === 'decision') {
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
          onBack={() => setScreen('assignments')}
          onPrimaryAction={() => {}}
          onSelectOption={() => {}}
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <TeamAssignmentsView
        model={{
          access: 'manage',
          deliveryLabel: 'Nicht veröffentlicht · lokal gespeichert',
          deliveryState: 'unpublished',
          eventId: 'evt_team_session',
          eventTitle: 'Belek Team Retreat',
          hasLocalChanges: true,
          role: 'organizer',
          rootEventId: 'evt_team_retreat',
          teams,
          version: 4,
        }}
        onBack={() => {}}
        onMoveMember={(memberId, targetTeamId) =>
          setTeams(current => {
            const member = current
              .flatMap(team => team.members)
              .find(person => person.id === memberId);
            if (!member) return current;
            return current.map(team => ({
              ...team,
              members:
                team.id === targetTeamId
                  ? [...team.members, member]
                  : team.members.filter(person => person.id !== memberId),
            }));
          })
        }
        onPrimaryAction={() => setScreen('decision')}
      />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('CrewNext', () => TeamCollaborationEvidenceApp);
