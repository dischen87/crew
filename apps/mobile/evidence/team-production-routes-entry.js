import 'react-native-get-random-values';
import 'react-native-gesture-handler';

import {
  MemberDirectoryStore,
  MobileDataStore,
  migrate,
} from '@crew/mobile-data';
import React, { useEffect, useState } from 'react';
import { AppRegistry, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TeamAssignmentsView } from '../src/screens/TeamAssignmentsView';
import { TeamDecisionView } from '../src/screens/TeamDecisionView';
import { openAccountDatabase } from '../src/storage/opSqliteAdapter';
import { TeamProductionRuntime } from '../src/team/TeamProductionRuntime';

const accountUserId = 'usr_11111111111111111111111111111111';
const rootEventId = 'evt_evidence_team_root';
const eventId = 'evt_evidence_team_session';
const decisionId = 'tdc_evidence_dinner';
const now = '2026-07-19T12:00:00.000Z';
const databaseKey = 'a'.repeat(64);

function TeamProductionRoutesEvidenceApp() {
  const [state, setState] = useState({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let database;
    seedProductionDatabase().then(
      result => {
        database = result.database;
        if (cancelled) {
          database.close();
        } else {
          setState({ kind: 'ready', screen: 'assignments', ...result });
        }
      },
      error =>
        setState({
          kind: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
    );
    return () => {
      cancelled = true;
      database?.close();
    };
  }, []);

  if (state.kind !== 'ready') {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: '#F4F0E8',
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <Text>{
          state.kind === 'failed' ? `Evidence failed: ${state.message}` : 'Crew lädt'
        }</Text>
      </View>
    );
  }

  if (state.screen === 'decision') {
    return (
      <SafeAreaProvider>
        <TeamDecisionView
          model={state.decision}
          onBack={() => setState(current => ({ ...current, screen: 'assignments' }))}
          onPrimaryAction={async () => {
            if (!state.decision.selectedOptionId) return;
            await state.runtime.submitResponse(
              decisionId,
              state.decision.selectedOptionId,
            );
            const decision = await state.runtime.loadDecision(decisionId);
            if (decision) setState(current => ({ ...current, decision }));
          }}
          onSelectOption={optionId =>
            setState(current => ({
              ...current,
              decision: { ...current.decision, selectedOptionId: optionId },
            }))
          }
        />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <TeamAssignmentsView
        model={state.assignments}
        onBack={() => setState(current => ({ ...current, screen: 'decision' }))}
        onMoveMember={(memberId, targetTeamId) =>
          setState(current => {
            const source = current.assignments.teams.find(team =>
              team.members.some(member => member.id === memberId),
            );
            const person = source?.members.find(member => member.id === memberId);
            if (!source || !person) return current;
            return {
              ...current,
              assignments: {
                ...current.assignments,
                deliveryLabel: 'Änderungen offen · noch nicht veröffentlicht',
                deliveryState: 'unpublished',
                hasLocalChanges: true,
                teams: current.assignments.teams.map(team =>
                  team.id === source.id
                    ? {
                        ...team,
                        members: team.members.filter(
                          member => member.id !== memberId,
                        ),
                      }
                    : team.id === targetTeamId
                    ? { ...team, members: [...team.members, person] }
                    : team,
                ),
              },
            };
          })
        }
        onPrimaryAction={async () => {
          if (
            state.assignments.access === 'manage' &&
            state.assignments.hasLocalChanges
          ) {
            await state.runtime.publishAssignments(state.assignments);
          }
        }}
      />
    </SafeAreaProvider>
  );
}

async function seedProductionDatabase() {
  const database = openAccountDatabase(accountUserId, databaseKey);
  await migrate(database);
  const data = new MobileDataStore(database);
  await data.clearUserData(accountUserId);
  await data.applyBootstrapPage(accountUserId, null, bootstrapPage());
  const directory = new MemberDirectoryStore(database, {
    request: async operationId => {
      if (operationId !== 'eventMemberDirectoryGet') {
        throw new Error('Unexpected evidence operation');
      }
      return {
        data: {
          items: [
            { userId: accountUserId, displayName: 'Lena Graf' },
            {
              userId: 'usr_22222222222222222222222222222222',
              displayName: 'Marco Frei',
            },
            {
              userId: 'usr_33333333333333333333333333333333',
              displayName: null,
            },
            {
              userId: 'usr_44444444444444444444444444444444',
              displayName: 'Aylin Kaya',
            },
          ],
          pageInfo: { hasMore: false, nextCursor: null },
        },
        requestId: 'evidence-directory',
        status: 200,
      };
    },
  });
  await directory.refresh(accountUserId, rootEventId);
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: null,
    database,
    deviceIdStore: {
      getOrCreate: async () =>
        'dvc_00000000-0000-4000-8000-000000000001',
    },
    rootEventId,
  });
  if (!runtime) throw new Error('Production runtime unavailable');
  const assignments = await runtime.loadAssignments(eventId);
  const decision = await runtime.loadDecision(decisionId);
  if (!assignments || assignments.access !== 'manage' || !decision) {
    throw new Error('Production read models unavailable');
  }
  return { assignments, database, decision, runtime };
}

function bootstrapPage() {
  const teams = [
    { id: 'ttm_lavender', name: 'Lavendel', color: '#D5C2E8' },
    { id: 'ttm_mint', name: 'Mint', color: '#C2E8D5' },
  ];
  return {
    protocolVersion: 1,
    rootEventId,
    authorizationScopeVersion: '1',
    snapshotId: 'snp_evidence_team_routes',
    snapshotRevision: '1',
    records: [
      {
        entityType: 'event',
        entityId: rootEventId,
        entityVersion: 1,
        data: event(rootEventId, null, 'team_event', 'Belek Team Retreat', '1'),
      },
      {
        entityType: 'event',
        entityId: eventId,
        entityVersion: 1,
        data: event(eventId, rootEventId, 'session', 'Team Session · Belek', '2'),
      },
      {
        entityType: 'membership',
        entityId: accountUserId,
        entityVersion: 1,
        data: {
          rootEventId,
          userId: accountUserId,
          role: 'owner',
          status: 'active',
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      {
        entityType: 'teamAssignmentSet',
        entityId: eventId,
        entityVersion: 4,
        data: {
          rootEventId,
          eventId,
          teams,
          version: 4,
          updatedAt: now,
        },
      },
      {
        entityType: 'teamAssignmentRoster',
        entityId: `tro_${eventId}`,
        entityVersion: 4,
        data: {
          rootEventId,
          eventId,
          teams: [
            {
              ...teams[0],
              memberUserIds: [
                accountUserId,
                'usr_22222222222222222222222222222222',
              ],
            },
            {
              ...teams[1],
              memberUserIds: [
                'usr_33333333333333333333333333333333',
                'usr_44444444444444444444444444444444',
              ],
            },
          ],
          version: 4,
          updatedAt: now,
        },
      },
      {
        entityType: 'teamDecision',
        entityId: decisionId,
        entityVersion: 3,
        data: {
          id: decisionId,
          rootEventId,
          eventId,
          title: 'Wo essen wir heute Abend?',
          state: 'open',
          options: [
            { id: 'tdo_fish', label: 'Fischrestaurant', responseCount: 3 },
            { id: 'tdo_rooftop', label: 'Rooftop Dinner', responseCount: 2 },
            { id: 'tdo_beach', label: 'Beach BBQ', responseCount: 1 },
          ],
          responseCount: 6,
          version: 2,
          aggregateVersion: 3,
          createdAt: now,
          updatedAt: now,
        },
      },
    ],
    syncCursor: 'cursor-evidence-team-routes',
    pageInfo: { nextCursor: null, hasMore: false },
  };
}

function event(id, parentEventId, kind, title, sortKey) {
  return {
    id,
    rootEventId,
    parentEventId,
    kind,
    title,
    description: null,
    timeZone: 'Europe/Zurich',
    startsAt: '2026-09-20T08:00:00.000Z',
    endsAt: '2026-09-20T18:00:00.000Z',
    sortKey,
    childOrderVersion: 1,
    itineraryOrderVersion: 1,
    status: 'published',
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

AppRegistry.registerComponent('CrewNext', () => TeamProductionRoutesEvidenceApp);
