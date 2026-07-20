import { MobileSyncRootAccessDeniedError } from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import {
  TeamProductionRuntime,
} from '../team/TeamProductionRuntime';
import type { TeamAssignmentsViewModel } from '../team/TeamCollaborationController';
import { TeamAssignmentsView } from './TeamAssignmentsView';
import { TeamRouteStateView } from './TeamRouteStateView';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamSetup'>;

type ReadyState = {
  key: string;
  model: TeamAssignmentsViewModel;
  runtime: TeamProductionRuntime;
  status: 'ready';
};

type LoadState =
  | ReadyState
  | { key: string; status: 'concealed' }
  | { key: string; status: 'loading' };

export function TeamSetupScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const { eventId, rootEventId } = route.params;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId}`
      : null;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<LoadState>({
    key: scopeKey ?? '',
    status: 'loading',
  });

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', status: 'concealed' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const publish = (next: LoadState) => {
      if (
        !cancelled &&
        activeAccountRef.current === accountUserId &&
        next.key === scopeKey
      ) {
        setState(next);
      }
    };

    (async () => {
      const runtime = await TeamProductionRuntime.create({
        accountUserId,
        activeAccountUserId: () => activeAccountRef.current,
        client,
        database: privateDatabase.database,
        rootEventId,
      });
      if (!runtime) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      let cached = await runtime.loadAssignments(eventId);
      if (cached) {
        publish({ key: scopeKey, model: cached, runtime, status: 'ready' });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      try {
        await runtime.refresh();
      } catch (error) {
        if (error instanceof MobileSyncRootAccessDeniedError) {
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
      }
      cached = (await runtime.loadAssignments(eventId)) ?? cached;
      publish(
        cached
          ? { key: scopeKey, model: cached, runtime, status: 'ready' }
          : { key: scopeKey, status: 'concealed' },
      );
    })().catch(() => publish({ key: scopeKey, status: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    eventId,
    privateDatabase.accountId,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
  ]);

  if (!scopeKey || state.key !== scopeKey || state.status === 'loading') {
    return (
      <TeamRouteStateView
        kind="loading"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-setup-loading"
        title="Teams werden geladen"
        description="Crew lädt die sicher gespeicherte Einteilung."
      />
    );
  }
  if (state.status === 'concealed') {
    return (
      <TeamRouteStateView
        kind="concealed"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-setup-unavailable"
        title="Inhalt nicht verfügbar"
        description="Diese Teameinteilung ist nicht verfügbar."
      />
    );
  }

  const moveMember = (memberId: string, targetTeamId: string) => {
    setState(current => {
      if (
        current.status !== 'ready' ||
        current.key !== scopeKey ||
        current.model.access !== 'manage'
      ) {
        return current;
      }
      const source = current.model.teams.find(team =>
        team.members.some(member => member.id === memberId),
      );
      const target = current.model.teams.find(team => team.id === targetTeamId);
      const person = source?.members.find(member => member.id === memberId);
      if (!source || !target || !person || source.id === target.id) return current;
      return {
        ...current,
        model: {
          ...current.model,
          deliveryLabel: 'Änderungen offen · noch nicht veröffentlicht',
          deliveryState: 'unpublished',
          hasLocalChanges: true,
          teams: current.model.teams.map(team =>
            team.id === source.id
              ? {
                  ...team,
                  members: team.members.filter(member => member.id !== memberId),
                }
              : team.id === target.id
              ? { ...team, members: [...team.members, person] }
              : team,
          ),
        },
      };
    });
  };

  const primaryAction = () => {
    if (state.model.access !== 'manage' || !state.model.hasLocalChanges) {
      navigation.goBack();
      return;
    }
    const { model, runtime } = state;
    runtime.publishAssignments(model).then(
      () => {
        setState(current =>
          current.status === 'ready' && current.key === scopeKey
            ? {
                ...current,
                model: {
                  ...current.model,
                  deliveryLabel: 'Wartet auf Verbindung',
                  deliveryState: 'pending',
                  hasLocalChanges: false,
                },
              }
            : current,
        );
      },
      () =>
        Alert.alert(
          'Einteilung nicht gespeichert',
          'Die lokale Änderung bleibt sichtbar. Versuche es erneut.',
        ),
    );
  };

  return (
    <TeamAssignmentsView
      model={state.model}
      onBack={() => navigation.goBack()}
      onMoveMember={moveMember}
      onPrimaryAction={primaryAction}
    />
  );
}
