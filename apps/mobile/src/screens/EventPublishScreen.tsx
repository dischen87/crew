import {
  EventPublishAccountChangedError,
  EventPublishBusyError,
  EventPublishConflictError,
  EventPublishManagerRequiredError,
  EventPublishNotReadyError,
  EventPublishOnlineRequiredError,
  EventPublishRootAccessDeniedError,
  EventPublishSyncRequiredError,
  EventPublishUnavailableError,
  type EventPublishSnapshot,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import { EventPublishRuntime } from './EventPublishRuntime';
import {
  EventPublishView,
  type EventPublishAction,
  type EventPublishBlockerCode,
  type EventPublishBlockerTarget,
  type EventPublishViewModel,
} from './EventPublishView';
import { useOnlineState } from './useOnlineState';

type Props = NativeStackScreenProps<RootStackParamList, 'EventPublish'>;

type EventPublishScreenState = {
  busyAction: EventPublishAction | null;
  eventTitle: string | null;
  key: string;
  message: string | null;
  online: boolean;
  phase: 'concealed' | 'loading' | 'published' | 'review';
  snapshot: EventPublishSnapshot | null;
  syncRequired: boolean;
};

export function EventPublishScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const rootEventId = route.params.rootEventId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<EventPublishScreenState>(() =>
    initialState(scopeKey ?? '', online),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionFlightRef = useRef<Promise<void> | null>(null);
  const previousOnlineRef = useRef(online);
  const runtime = useMemo(
    () =>
      client && scopeKey
        ? new EventPublishRuntime({
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
            isOnline: () => onlineRef.current,
          })
        : null,
    [client, privateDatabase.database, scopeKey],
  );

  const publish = useCallback(
    (next: EventPublishScreenState) => {
      if (!scopeKey || next.key !== scopeKey) return;
      if (scopeRef.current !== scopeKey) return;
      if (activeAccountRef.current !== privateDatabase.accountId) return;
      stateRef.current = next;
      setState(next);
    },
    [privateDatabase.accountId, scopeKey],
  );

  useEffect(() => {
    actionFlightRef.current = null;
  }, [scopeKey]);

  useEffect(
    () =>
      navigation.addListener('focus', () => {
        if (scopeRef.current) setRefreshRequest(value => value + 1);
      }),
    [navigation],
  );

  useEffect(() => {
    const wasOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;
    setState(current =>
      current.key === (scopeKey ?? '') ? { ...current, online } : current,
    );
    if (online && !wasOnline && scopeKey) {
      setRefreshRequest(value => value + 1);
    }
  }, [online, scopeKey]);

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setState(unavailableState(scopeKey ?? '', onlineRef.current));
      return;
    }
    let cancelled = false;
    const controller = runtime.controller;
    const current = stateRef.current.key === scopeKey ? stateRef.current : null;
    publish({
      ...initialState(scopeKey, onlineRef.current),
      snapshot: current?.snapshot ?? null,
    });

    const load = async () => {
      let cached: EventPublishSnapshot | null = null;
      try {
        cached = await controller.getCached(rootEventId);
      } catch (error) {
        if (concealsPublish(error)) {
          publish(unavailableState(scopeKey, onlineRef.current));
          return;
        }
      }
      if (cancelled) return;
      if (cached) {
        publish(reviewState(scopeKey, cached, onlineRef.current, null));
      }
      if (!onlineRef.current) {
        if (!cached) {
          publish({
            ...unavailableState(scopeKey, false),
            message: 'Offline ist noch keine sichere Prüfung gespeichert.',
          });
        }
        return;
      }
      try {
        const snapshot = await controller.refresh(rootEventId);
        if (!cancelled) publish(reviewState(scopeKey, snapshot, true, null));
      } catch (error) {
        if (cancelled) return;
        if (concealsPublish(error)) {
          publish(unavailableState(scopeKey, onlineRef.current));
          return;
        }
        if (cached) {
          publish(
            reviewState(
              scopeKey,
              cached,
              onlineRef.current,
              safePublishMessage(error),
            ),
          );
        } else {
          publish({
            ...unavailableState(scopeKey, onlineRef.current),
            message: safePublishMessage(error),
          });
        }
      }
    };
    load().catch(() => {
      if (!cancelled) publish(unavailableState(scopeKey, onlineRef.current));
    });
    return () => {
      cancelled = true;
    };
  }, [publish, refreshRequest, rootEventId, runtime, scopeKey]);

  const runAction = useCallback(
    (action: EventPublishAction) => {
      if (
        !runtime ||
        !scopeKey ||
        scopeRef.current !== scopeKey ||
        stateRef.current.key !== scopeKey ||
        activeAccountRef.current !== privateDatabase.accountId ||
        actionFlightRef.current
      ) {
        return;
      }
      const controller = runtime.controller;
      const accountUserId = privateDatabase.accountId;
      const flight = (async () => {
        publish({
          ...stateRef.current,
          busyAction: action,
          message: null,
          online: onlineRef.current,
        });
        try {
          if (action === 'refresh') {
            const snapshot = await controller.refresh(rootEventId);
            publish(reviewState(scopeKey, snapshot, true, null));
            return;
          }
          if (action === 'acknowledge_conflict') {
            await controller.acknowledgeConflict(rootEventId);
            const snapshot = await controller.getCached(rootEventId);
            if (!snapshot) throw new EventPublishUnavailableError();
            publish(
              reviewState(
                scopeKey,
                snapshot,
                onlineRef.current,
                'Der aktuelle Serverstand ist geprüft. Veröffentliche ihn erst nach einer erneuten Online-Prüfung.',
              ),
            );
            return;
          }
          const result = await controller.publish(rootEventId);
          publish({
            busyAction: null,
            eventTitle: result.event.title,
            key: scopeKey,
            message: result.refreshPending
              ? 'Der Server hat die Veröffentlichung bestätigt. Die lokale Aktualisierung wird bei der nächsten Verbindung fortgesetzt.'
              : null,
            online: onlineRef.current,
            phase: 'published',
            snapshot: null,
            syncRequired: result.refreshPending,
          });
        } catch (error) {
          if (
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== accountUserId
          ) {
            return;
          }
          if (concealsPublish(error)) {
            publish(unavailableState(scopeKey, onlineRef.current));
            return;
          }
          let snapshot = stateRef.current.snapshot;
          if (
            error instanceof EventPublishConflictError ||
            error instanceof EventPublishNotReadyError ||
            error instanceof EventPublishSyncRequiredError
          ) {
            try {
              snapshot = (await controller.getCached(rootEventId)) ?? snapshot;
            } catch (recoveryError) {
              if (concealsPublish(recoveryError)) {
                publish(unavailableState(scopeKey, onlineRef.current));
                return;
              }
            }
          }
          if (!snapshot) {
            publish({
              ...unavailableState(scopeKey, onlineRef.current),
              message: safePublishMessage(error),
            });
            return;
          }
          publish({
            ...reviewState(
              scopeKey,
              snapshot,
              onlineRef.current,
              safePublishMessage(error),
            ),
            syncRequired: error instanceof EventPublishSyncRequiredError,
          });
        }
      })();
      actionFlightRef.current = flight;
      const clearFlight = () => {
        if (actionFlightRef.current === flight) actionFlightRef.current = null;
      };
      flight.then(clearFlight, clearFlight);
    },
    [privateDatabase.accountId, publish, rootEventId, runtime, scopeKey],
  );

  const onBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('EventInbound', { rootEventId });
  };

  const onBlockerAction = (
    code: EventPublishBlockerCode,
    target: EventPublishBlockerTarget | null,
  ) => {
    if (
      !scopeKey ||
      scopeRef.current !== scopeKey ||
      stateRef.current.key !== scopeKey ||
      stateRef.current.busyAction
    ) {
      return;
    }
    const focusField = basicsFieldForBlocker(code);
    if (focusField) {
      navigation.navigate('EventBasicsEdit', { focusField, rootEventId });
      return;
    }
    if (code === 'EVENT_TEMPLATE_REQUIRED') {
      navigation.navigate('EventSetupRecovery', {
        blocker: code,
        rootEventId,
      });
      return;
    }
    if (
      (code === 'EVENT_CAPABILITY_REQUIRED' ||
        code === 'EVENT_CAPABILITY_PLACE_REQUIRED') &&
      target
    ) {
      navigation.navigate('EventSetupRecovery', {
        blocker: code,
        capabilityType: target.capabilityType,
        eventId: target.eventId,
        rootEventId,
      });
    }
  };

  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? initialState(scopeKey, online)
      : unavailableState('', online);

  return (
    <EventPublishView
      model={eventPublishViewModel(visibleState)}
      onBack={onBack}
      onBlockerAction={onBlockerAction}
      onPrimaryAction={runAction}
    />
  );
}

function basicsFieldForBlocker(code: EventPublishBlockerCode) {
  if (code === 'EVENT_DESCRIPTION_REQUIRED') return 'description' as const;
  if (code === 'EVENT_END_REQUIRED') return 'endsAt' as const;
  if (code === 'EVENT_START_REQUIRED') return 'startsAt' as const;
  if (code === 'EVENT_TITLE_REQUIRED') return 'title' as const;
  return null;
}

export function eventPublishViewModel(
  state: EventPublishScreenState,
): EventPublishViewModel {
  const snapshot = state.snapshot;
  return {
    blockerCodes: snapshot?.readiness.reasons.map(reason => reason.code) ?? [],
    blockerTargets:
      snapshot?.readiness.reasons.map(reason => {
        if (
          (reason.code === 'EVENT_CAPABILITY_REQUIRED' ||
            reason.code === 'EVENT_CAPABILITY_PLACE_REQUIRED') &&
          reason.meta?.eventId &&
          reason.meta.capabilityType
        ) {
          return {
            capabilityType: reason.meta.capabilityType,
            eventId: reason.meta.eventId,
          };
        }
        return null;
      }) ?? [],
    busyAction: state.busyAction,
    conflict: snapshot?.conflict
      ? {
          attempted: {
            blockerCodes: snapshot.conflict.attempted.reasons.map(
              reason => reason.code,
            ),
            revision: snapshot.conflict.attempted.rootRevision,
          },
          current: {
            blockerCodes: snapshot.conflict.current.reasons.map(
              reason => reason.code,
            ),
            revision: snapshot.conflict.current.rootRevision,
          },
        }
      : null,
    eventTitle: state.eventTitle ?? snapshot?.eventTitle ?? 'Dein Event',
    message: state.message,
    online: state.online,
    phase: state.phase,
    planItemCount: snapshot?.planItemCount ?? 0,
    planItems: snapshot?.planItems ?? [],
    ready: snapshot?.readiness.ready ?? false,
    refreshedAt: snapshot?.refreshedAt ?? null,
    role: snapshot?.role ?? null,
    schedule: snapshot?.schedule ?? null,
    syncRequired: state.syncRequired,
    template: snapshot?.readiness.template?.id ?? null,
  };
}

function initialState(key: string, online: boolean): EventPublishScreenState {
  return {
    busyAction: null,
    eventTitle: null,
    key,
    message: null,
    online,
    phase: 'loading',
    snapshot: null,
    syncRequired: false,
  };
}

function unavailableState(
  key: string,
  online: boolean,
): EventPublishScreenState {
  return {
    ...initialState(key, online),
    phase: 'concealed',
  };
}

function reviewState(
  key: string,
  snapshot: EventPublishSnapshot,
  online: boolean,
  message: string | null,
): EventPublishScreenState {
  return {
    busyAction: null,
    eventTitle: snapshot.eventTitle,
    key,
    message,
    online,
    phase: 'review',
    snapshot,
    syncRequired: false,
  };
}

function safePublishMessage(error: unknown) {
  if (error instanceof EventPublishOnlineRequiredError) {
    return 'Für diese Aktion brauchst du eine Verbindung. Es wurde keine Veröffentlichung vorgemerkt.';
  }
  if (error instanceof EventPublishSyncRequiredError) {
    return 'Lokale Änderungen sind noch nicht sicher synchronisiert. Es wurde nichts veröffentlicht.';
  }
  if (error instanceof EventPublishConflictError) {
    return 'Der Serverstand hat sich geändert. Vergleiche den geprüften und den aktuellen Stand.';
  }
  if (error instanceof EventPublishNotReadyError) {
    return 'Der aktuelle Serverstand ist noch nicht bereit zur Veröffentlichung.';
  }
  if (error instanceof EventPublishBusyError) {
    return 'Eine Veröffentlichung wird bereits geprüft. Bitte warte kurz.';
  }
  return 'Keine Veröffentlichung wurde bestätigt. Bitte versuche es erneut.';
}

function concealsPublish(error: unknown) {
  return (
    error instanceof EventPublishManagerRequiredError ||
    error instanceof EventPublishRootAccessDeniedError ||
    error instanceof EventPublishUnavailableError ||
    error instanceof EventPublishAccountChangedError
  );
}
