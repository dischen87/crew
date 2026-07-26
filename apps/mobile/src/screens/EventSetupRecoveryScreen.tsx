import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import {
  EventSetupRecoveryAccountChangedError,
  EventSetupRecoveryBusyError,
  EventSetupRecoveryConflictError,
  EventSetupRecoveryConnectionError,
  EventSetupRecoveryEnrichmentUnavailableError,
  EventSetupRecoveryManagerRequiredError,
  EventSetupRecoveryOnlineRequiredError,
  EventSetupRecoveryRuntime,
  EventSetupRecoveryUnavailableError,
  type EventSetupPlaceCandidate,
  type EventSetupPlaceEnrichment,
  type EventSetupRecoveryIntent,
  type EventSetupRecoverySnapshot,
  type EventSetupTemplateId,
} from './EventSetupRecoveryRuntime';
import {
  EventSetupRecoveryView,
  type EventSetupRecoveryAction,
  type EventSetupRecoveryViewModel,
} from './EventSetupRecoveryView';
import { useOnlineState } from './useOnlineState';

type Props = NativeStackScreenProps<RootStackParamList, 'EventSetupRecovery'>;

type ScreenState = EventSetupRecoveryViewModel & {
  key: string;
  placePollCount: number;
};

const maximumPlacePolls = 3;

export function EventSetupRecoveryScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const networkOnline = useOnlineState();
  const online = networkOnline && client !== null;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const intent = useMemo<EventSetupRecoveryIntent>(
    () => ({
      capabilityType: route.params.capabilityType,
      code: route.params.blocker,
      eventId: route.params.eventId,
      rootEventId: route.params.rootEventId,
    }),
    [
      route.params.blocker,
      route.params.capabilityType,
      route.params.eventId,
      route.params.rootEventId,
    ],
  );
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? [
          privateDatabase.accountId,
          intent.rootEventId,
          intent.code,
          intent.eventId ?? '',
          intent.capabilityType ?? '',
        ].join(':')
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [state, setState] = useState<ScreenState>(() =>
    initialState(scopeKey ?? '', online),
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionFlightRef = useRef<Promise<void> | null>(null);
  const previousOnlineRef = useRef(online);
  const runtime = useMemo(
    () =>
      scopeKey
        ? new EventSetupRecoveryRuntime({
            accountUserId: privateDatabase.accountId,
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
            isOnline: () => onlineRef.current,
          })
        : null,
    [client, privateDatabase.accountId, privateDatabase.database, scopeKey],
  );

  const publish = useCallback(
    (next: ScreenState) => {
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
      setState(concealedState(scopeKey ?? '', online));
      return;
    }
    let cancelled = false;
    const current = stateRef.current.key === scopeKey ? stateRef.current : null;
    publish({
      ...initialState(scopeKey, onlineRef.current),
      placeQuery: current?.placeQuery ?? '',
      selectedTemplateId: current?.selectedTemplateId ?? null,
      snapshot: current?.snapshot ?? null,
    });
    (async () => {
      let cached: EventSetupRecoverySnapshot | null = null;
      try {
        cached = await runtime.loadCached(intent);
      } catch (error) {
        if (conceals(error)) {
          if (!cancelled) publish(concealedState(scopeKey, onlineRef.current));
          return;
        }
      }
      if (cancelled) return;
      if (cached) publish(snapshotState(scopeKey, cached, onlineRef.current));
      if (!onlineRef.current) {
        if (!cached) {
          publish({
            ...concealedState(scopeKey, false),
            message: 'Offline ist für diesen Prüfpunkt noch kein sicherer Kontext gespeichert.',
          });
        }
        return;
      }
      try {
        const refreshed = await runtime.refresh(intent);
        if (!cancelled) {
          publish(snapshotState(scopeKey, refreshed, true));
        }
      } catch (error) {
        if (cancelled) return;
        if (conceals(error)) {
          publish(concealedState(scopeKey, onlineRef.current));
        } else if (cached) {
          publish({
            ...snapshotState(scopeKey, cached, onlineRef.current),
            message: safeMessage(error),
          });
        } else {
          publish({
            ...concealedState(scopeKey, onlineRef.current),
            message: safeMessage(error),
          });
        }
      }
    })().catch(() => {
      if (!cancelled) publish(concealedState(scopeKey, onlineRef.current));
    });
    return () => {
      cancelled = true;
    };
  }, [intent, online, publish, refreshRequest, runtime, scopeKey]);

  useEffect(() => {
    const enrichment = state.placeEnrichment?.enrichment;
    const delay = enrichment?.pollAfterSeconds;
    if (
      !runtime ||
      !scopeKey ||
      !enrichment ||
      state.key !== scopeKey ||
      state.phase !== 'ready' ||
      state.placeEnrichmentUnavailable ||
      !online ||
      delay === null ||
      delay === undefined ||
      state.placePollCount >= maximumPlacePolls
    ) {
      return;
    }
    const jobId = enrichment.id;
    const candidate =
      state.placeResults.find(result => result.id === state.selectedPlaceId) ??
      null;
    if (!candidate) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (
        cancelled ||
        scopeRef.current !== scopeKey ||
        activeAccountRef.current !== privateDatabase.accountId ||
        stateRef.current.phase !== 'ready' ||
        stateRef.current.selectedPlaceId !== candidate.id ||
        stateRef.current.placeEnrichment?.enrichment.id !== jobId
      ) {
        return;
      }
      (async () => {
        try {
          const result = await runtime.getPlaceEnrichment(
            intent,
            candidate,
            jobId,
          );
          if (
            cancelled ||
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== privateDatabase.accountId ||
            stateRef.current.phase !== 'ready' ||
            stateRef.current.selectedPlaceId !== candidate.id ||
            stateRef.current.placeEnrichment?.enrichment.id !== jobId
          ) {
            return;
          }
          const placePollCount = stateRef.current.placePollCount + 1;
          publish({
            ...stateRef.current,
            message: null,
            placeEnrichment: result,
            placeEnrichmentUnavailable:
              placePollCount >= maximumPlacePolls &&
              (result.enrichment.status === 'pending' ||
                result.enrichment.status === 'processing'),
            placePollCount,
          });
        } catch (error) {
          if (
            cancelled ||
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== privateDatabase.accountId
          ) {
            return;
          }
          if (
            conceals(error) ||
            error instanceof EventSetupRecoveryConflictError
          ) {
            publish(concealedState(scopeKey, onlineRef.current));
            return;
          }
          publish({
            ...stateRef.current,
            message:
              error instanceof EventSetupRecoveryEnrichmentUnavailableError
                ? null
                : safeMessage(error),
            placeEnrichmentUnavailable: true,
            placePollCount: stateRef.current.placePollCount + 1,
          });
        }
      })().catch(() => undefined);
    }, delay * 1_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    intent,
    online,
    privateDatabase.accountId,
    publish,
    runtime,
    scopeKey,
    state.key,
    state.phase,
    state.placeEnrichment?.enrichment,
    state.placeEnrichment?.enrichment.id,
    state.placeEnrichment?.enrichment.pollAfterSeconds,
    state.placeEnrichment?.enrichment.status,
    state.placeEnrichment?.enrichment.updatedAt,
    state.placeEnrichmentUnavailable,
    state.placePollCount,
    state.placeResults,
    state.selectedPlaceId,
  ]);

  const runAction = useCallback(
    (action: EventSetupRecoveryAction) => {
      if (
        !runtime ||
        !scopeKey ||
        scopeRef.current !== scopeKey ||
        stateRef.current.key !== scopeKey ||
        activeAccountRef.current !== privateDatabase.accountId ||
        actionFlightRef.current ||
        (action !== 'refresh' &&
          (stateRef.current.phase !== 'ready' ||
            stateRef.current.snapshot?.source !== 'online'))
      ) {
        return;
      }
      const accountUserId = privateDatabase.accountId;
      const selected = selectedPlace(stateRef.current);
      const enrichment = stateRef.current.placeEnrichment;
      const selectedTemplate = selectedTemplateForAction(
        stateRef.current,
        action,
      );
      if ((action === 'bind_place' || action === 'enrich_place') && !selected) {
        return;
      }
      if (
        action === 'retry_enrichment' &&
        (!selected || !enrichment?.enrichment.retryAllowed)
      ) {
        return;
      }
      if (action === 'adopt_template' && !selectedTemplate) return;
      const flight = (async () => {
        publish({
          ...stateRef.current,
          busyAction: action,
          message: null,
          online: onlineRef.current,
        });
        try {
          if (action === 'refresh') {
            const snapshot = await runtime.refresh(intent);
            publish(snapshotState(scopeKey, snapshot, true));
            return;
          }
          if (action === 'search_places') {
            const result = await runtime.searchPlaces(
              intent,
              stateRef.current.placeQuery,
            );
            publish({
              ...snapshotState(scopeKey, result.snapshot, true),
              message:
                result.results.length === 0
                  ? 'Keine passenden Orte gefunden. Verfeinere deine Suche.'
                  : null,
              placeQuery: stateRef.current.placeQuery,
              placeResults: result.results,
            });
            return;
          }
          if (action === 'enrich_place' && selected) {
            const result = await runtime.createPlaceEnrichment(
              intent,
              selected,
            );
            publish({
              ...stateRef.current,
              busyAction: null,
              message: null,
              placeEnrichment: result,
              placeEnrichmentUnavailable: false,
              placePollCount: 0,
            });
            return;
          }
          if (action === 'retry_enrichment' && selected && enrichment) {
            const result = await runtime.retryPlaceEnrichment(
              intent,
              selected,
              enrichment,
            );
            publish({
              ...stateRef.current,
              busyAction: null,
              message: null,
              placeEnrichment: result,
              placeEnrichmentUnavailable: false,
              placePollCount: 0,
            });
            return;
          }
          let snapshot: EventSetupRecoverySnapshot;
          if (action === 'adopt_template' && selectedTemplate) {
            snapshot = await runtime.adoptTemplate(intent, selectedTemplate);
          } else if (action === 'restore_capability') {
            snapshot = await runtime.restoreCapability(intent);
          } else if (action === 'bind_place' && selected) {
            snapshot = await runtime.bindPrimaryPlace(
              intent,
              placeForBinding(selected, enrichment),
            );
          } else {
            return;
          }
          publish({
            ...snapshotState(scopeKey, snapshot, true),
            message:
              snapshot.blockerActive === false
                ? 'Der aktuelle Serverstand bestätigt die Änderung.'
                : null,
          });
        } catch (error) {
          if (
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== accountUserId
          ) {
            return;
          }
          if (conceals(error)) {
            publish(concealedState(scopeKey, onlineRef.current));
            return;
          }
          if (
            error instanceof EventSetupRecoveryEnrichmentUnavailableError &&
            (action === 'enrich_place' || action === 'retry_enrichment')
          ) {
            publish({
              ...stateRef.current,
              busyAction: null,
              message: null,
              placeEnrichmentUnavailable: true,
            });
            return;
          }
          if (error instanceof EventSetupRecoveryConflictError) {
            try {
              const snapshot = await runtime.refresh(intent);
              publish({
                ...snapshotState(scopeKey, snapshot, true),
                message:
                  snapshot.blockerActive === false
                    ? 'Der Serverstand meldet diesen Prüfpunkt nicht mehr als offen. Prüfe die aktuellen Angaben erneut.'
                    : 'Der Serverstand hat sich geändert. Prüfe den aktuellen Stand und versuche es erneut.',
              });
              return;
            } catch (refreshError) {
              if (conceals(refreshError)) {
                publish(concealedState(scopeKey, onlineRef.current));
                return;
              }
            }
          }
          publish({
            ...stateRef.current,
            busyAction: null,
            message: safeMessage(error),
            online: onlineRef.current,
          });
        }
      })();
      actionFlightRef.current = flight;
      const clear = () => {
        if (actionFlightRef.current === flight) actionFlightRef.current = null;
      };
      flight.then(clear, clear);
    }, [intent, privateDatabase.accountId, publish, runtime, scopeKey],
  );

  const onBack = () => {
    if (stateRef.current.busyAction) return;
    if (
      scopeKey &&
      (scopeRef.current !== scopeKey || stateRef.current.key !== scopeKey)
    ) {
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('EventPublish', { rootEventId: intent.rootEventId });
  };

  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? initialState(scopeKey, online)
      : concealedState('', online);

  return (
    <EventSetupRecoveryView
      model={visibleState}
      onBack={onBack}
      onPlaceQueryChange={value => {
        if (
          !scopeKey ||
          scopeRef.current !== scopeKey ||
          stateRef.current.key !== scopeKey ||
          stateRef.current.busyAction ||
          stateRef.current.snapshot?.source !== 'online'
        ) {
          return;
        }
        publish({
          ...stateRef.current,
          message: null,
          placeEnrichment: null,
          placeEnrichmentUnavailable: false,
          placeQuery: value,
          placeResults: [],
          placePollCount: 0,
          selectedPlaceId: null,
        });
      }}
      onPrimaryAction={runAction}
      onSelectPlace={id => {
        if (
          !scopeKey ||
          scopeRef.current !== scopeKey ||
          stateRef.current.key !== scopeKey ||
          stateRef.current.busyAction ||
          stateRef.current.snapshot?.source !== 'online' ||
          !stateRef.current.placeResults.some(result => result.id === id)
        ) {
          return;
        }
        publish({
          ...stateRef.current,
          message: null,
          placeEnrichment: null,
          placeEnrichmentUnavailable: false,
          placePollCount: 0,
          selectedPlaceId: id,
        });
        runAction('enrich_place');
      }}
      onSelectTemplate={id => {
        if (
          !scopeKey ||
          scopeRef.current !== scopeKey ||
          stateRef.current.key !== scopeKey ||
          stateRef.current.busyAction ||
          stateRef.current.snapshot?.source !== 'online' ||
          !stateRef.current.snapshot?.templates.some(item => item.id === id)
        ) {
          return;
        }
        publish({ ...stateRef.current, selectedTemplateId: id });
      }}
    />
  );
}

function initialState(key: string, online: boolean): ScreenState {
  return {
    busyAction: null,
    key,
    message: null,
    online,
    phase: 'loading',
    placeEnrichment: null,
    placeEnrichmentUnavailable: false,
    placePollCount: 0,
    placeQuery: '',
    placeResults: [],
    selectedPlaceId: null,
    selectedTemplateId: null,
    snapshot: null,
  };
}

function concealedState(key: string, online: boolean): ScreenState {
  return { ...initialState(key, online), phase: 'concealed' };
}

function snapshotState(
  key: string,
  snapshot: EventSetupRecoverySnapshot,
  online: boolean,
): ScreenState {
  return {
    ...initialState(key, online),
    phase: snapshot.blockerActive === false ? 'resolved' : 'ready',
    snapshot,
  };
}

function selectedPlace(state: ScreenState): EventSetupPlaceCandidate | null {
  if (!state.selectedPlaceId) return null;
  return (
    state.placeResults.find(result => result.id === state.selectedPlaceId) ??
    null
  );
}

function placeForBinding(
  candidate: EventSetupPlaceCandidate,
  enrichment: EventSetupPlaceEnrichment | null,
): EventSetupPlaceCandidate {
  const place = enrichment?.place;
  return place
    ? {
        ...candidate,
        countryCode: place.countryCode,
        latitude: place.latitude,
        locality: place.locality,
        longitude: place.longitude,
        name: place.name,
        region: place.region,
      }
    : candidate;
}

function selectedTemplateForAction(
  state: ScreenState,
  action: EventSetupRecoveryAction,
): EventSetupTemplateId | null {
  if (action !== 'adopt_template' || !state.selectedTemplateId) return null;
  return state.snapshot?.templates.some(
    template => template.id === state.selectedTemplateId,
  )
    ? state.selectedTemplateId
    : null;
}

function conceals(error: unknown) {
  return (
    error instanceof EventSetupRecoveryAccountChangedError ||
    error instanceof EventSetupRecoveryManagerRequiredError ||
    error instanceof EventSetupRecoveryUnavailableError ||
    error instanceof TypeError
  );
}

function safeMessage(error: unknown) {
  if (error instanceof EventSetupRecoveryOnlineRequiredError) {
    return 'Für diese Aktion brauchst du eine Verbindung. Es wurde keine Änderung vorgemerkt.';
  }
  if (error instanceof EventSetupRecoveryConflictError) {
    return 'Der Serverstand hat sich geändert. Lade ihn erneut, bevor du fortfährst.';
  }
  if (error instanceof EventSetupRecoveryBusyError) {
    return 'Eine Setup-Änderung wird bereits sicher verarbeitet.';
  }
  if (error instanceof EventSetupRecoveryConnectionError) {
    return 'Der Gateway-Stand konnte nicht bestätigt werden. Es wurde kein Erfolg angenommen.';
  }
  return 'Keine Änderung wurde bestätigt. Bitte versuche es erneut.';
}
