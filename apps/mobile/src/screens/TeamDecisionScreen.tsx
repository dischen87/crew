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
import type { TeamDecisionViewModel } from '../team/TeamCollaborationController';
import { TeamProductionRuntime } from '../team/TeamProductionRuntime';
import { TeamDecisionView } from './TeamDecisionView';
import { TeamRouteStateView } from './TeamRouteStateView';

type Props = NativeStackScreenProps<RootStackParamList, 'Decision'>;

type ReadyState = {
  key: string;
  model: TeamDecisionViewModel;
  runtime: TeamProductionRuntime;
  status: 'ready';
};

type LoadState =
  | ReadyState
  | { key: string; status: 'concealed' }
  | { key: string; status: 'loading' };

export function TeamDecisionScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const { decisionId, rootEventId } = route.params;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}:${decisionId}`
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
      let cached = await runtime.loadDecision(decisionId);
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
      cached = (await runtime.loadDecision(decisionId)) ?? cached;
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
    decisionId,
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
        testID="team-decision-loading"
        title="Entscheidung wird geladen"
        description="Crew lädt deine sicher gespeicherte Auswahl."
      />
    );
  }
  if (state.status === 'concealed') {
    return (
      <TeamRouteStateView
        kind="concealed"
        onBack={() => navigation.goBack()}
        onRetry={() => setRefreshRequest(value => value + 1)}
        testID="team-decision-unavailable"
        title="Inhalt nicht verfügbar"
        description="Diese Entscheidung ist nicht verfügbar."
      />
    );
  }

  const primaryAction = () => {
    const selectedOptionId = state.model.selectedOptionId;
    const canSubmit =
      state.model.lifecycle === 'open' &&
      state.model.role !== 'viewer' &&
      state.model.canRespond &&
      state.model.authoritativeOptionId === null &&
      state.model.responseMutationId === null &&
      selectedOptionId !== null;
    if (!canSubmit || !selectedOptionId) {
      navigation.goBack();
      return;
    }
    const { runtime } = state;
    runtime.submitResponse(decisionId, selectedOptionId).then(
      async () => {
        const model = await runtime.loadDecision(decisionId);
        if (!model) return;
        setState(current =>
          current.status === 'ready' && current.key === scopeKey
            ? { ...current, model }
            : current,
        );
      },
      () =>
        Alert.alert(
          'Antwort nicht gespeichert',
          'Deine Auswahl bleibt sichtbar. Versuche es erneut.',
        ),
    );
  };

  return (
    <TeamDecisionView
      model={state.model}
      onBack={() => navigation.goBack()}
      onPrimaryAction={primaryAction}
      onSelectOption={optionId => {
        if (!state.model.options.some(option => option.id === optionId)) return;
        setState(current =>
          current.status === 'ready' && current.key === scopeKey
            ? {
                ...current,
                model: { ...current.model, selectedOptionId: optionId },
              }
            : current,
        );
      }}
    />
  );
}
