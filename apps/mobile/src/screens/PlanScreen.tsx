import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import {
  ChildEventEditorView,
  type ChildEventForm,
} from './ChildEventEditorView';
import { validateEventBasicsForm } from './EventBasicsScreen';
import {
  PlanAccountChangedError,
  type PlanMoveDirection,
  PlanRuntime,
  type PlanSnapshot,
  PlanUnavailableError,
} from './PlanRuntime';
import { PlanView, type PlanViewModel } from './PlanView';
import { useOnlineState } from './useOnlineState';

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>;

const eventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;

type PlanScreenState =
  | {
      key: string;
      message: string | null;
      phase: 'ready';
      refreshing: boolean;
      snapshot: PlanSnapshot;
    }
  | { key: string; message: string | null; phase: 'concealed' | 'loading' };

type ChildEditorState = {
  busy: boolean;
  errors: ReturnType<typeof validateEventBasicsForm>['errors'];
  form: ChildEventForm;
  message: string | null;
  parentEventId: string;
  parentTitle: string;
};

export function PlanScreen({ navigation, route }: Props) {
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
    lifecycle.accountId === privateDatabase.accountId &&
    eventIdPattern.test(rootEventId) &&
    (!route.params.eventId || eventIdPattern.test(route.params.eventId))
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [state, setState] = useState<PlanScreenState>({
    key: scopeKey ?? '',
    message: null,
    phase: 'loading',
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    route.params.eventId ?? rootEventId,
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [childEditor, setChildEditor] = useState<ChildEditorState | null>(null);
  const refreshFlightRef = useRef<Promise<void> | null>(null);
  const discardFlightRef = useRef<Promise<void> | null>(null);
  const orderFlightRef = useRef<Promise<void> | null>(null);
  const runtime = useMemo(
    () =>
      scopeKey
        ? new PlanRuntime({
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
    (next: PlanScreenState) => {
      if (
        !scopeKey ||
        next.key !== scopeKey ||
        scopeRef.current !== scopeKey ||
        activeAccountRef.current !== privateDatabase.accountId
      ) {
        return;
      }
      stateRef.current = next;
      setState(next);
    },
    [privateDatabase.accountId, scopeKey],
  );

  useEffect(() => {
    refreshFlightRef.current = null;
    discardFlightRef.current = null;
    orderFlightRef.current = null;
    setChildEditor(null);
    setSelectedEventId(route.params.eventId ?? rootEventId);
    setSelectedItemId(null);
  }, [rootEventId, route.params.eventId, scopeKey]);

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setState({
        key: scopeKey ?? '',
        message: null,
        phase: 'concealed',
      });
      return;
    }
    let cancelled = false;
    publish({ key: scopeKey, message: null, phase: 'loading' });
    const load = async () => {
      let cached: PlanSnapshot | null = null;
      try {
        cached = await runtime.load(rootEventId);
        if (!cancelled) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'ready',
            refreshing: onlineRef.current,
            snapshot: cached,
          });
        }
      } catch (error) {
        if (concealsPlan(error)) {
          if (!cancelled) {
            publish({
              key: scopeKey,
              message: null,
              phase: 'concealed',
            });
          }
          return;
        }
        if (!onlineRef.current) {
          if (!cancelled) {
            publish({
              key: scopeKey,
              message: planMessage(error),
              phase: 'concealed',
            });
          }
          return;
        }
      }
      if (!onlineRef.current || cancelled) return;
      try {
        const snapshot = await runtime.refresh(rootEventId);
        if (!cancelled) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'ready',
            refreshing: false,
            snapshot,
          });
        }
      } catch (error) {
        if (cancelled) return;
        if (concealsPlan(error)) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
        } else if (cached) {
          publish({
            key: scopeKey,
            message: planMessage(error),
            phase: 'ready',
            refreshing: false,
            snapshot: cached,
          });
        } else {
          publish({
            key: scopeKey,
            message: planMessage(error),
            phase: 'concealed',
          });
        }
      }
    };
    load().catch(() => {
      if (!cancelled) {
        publish({
          key: scopeKey,
          message: null,
          phase: 'concealed',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [publish, rootEventId, runtime, scopeKey]);

  const refresh = useCallback(() => {
    if (!runtime || !scopeKey || refreshFlightRef.current) return;
    const current = stateRef.current;
    const snapshot = current.phase === 'ready' ? current.snapshot : null;
    if (current.key !== scopeKey) return;
    if (current.phase === 'ready') {
      publish({ ...current, message: null, refreshing: true });
    }
    const flight = runtime.refresh(rootEventId).then(
      next => {
        publish({
          key: scopeKey,
          message: null,
          phase: 'ready',
          refreshing: false,
          snapshot: next,
        });
      },
      error => {
        if (concealsPlan(error)) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
        } else if (snapshot) {
          publish({
            key: scopeKey,
            message: planMessage(error),
            phase: 'ready',
            refreshing: false,
            snapshot,
          });
        }
      },
    );
    refreshFlightRef.current = flight;
    const clear = () => {
      if (refreshFlightRef.current === flight) refreshFlightRef.current = null;
    };
    flight.then(clear, clear);
  }, [publish, rootEventId, runtime, scopeKey]);

  const openChildEditor = useCallback((parentEventId: string) => {
    const current = stateRef.current;
    if (current.phase !== 'ready' || !current.snapshot.canEdit) return;
    const parent = current.snapshot.events.find(
      event => event.id === parentEventId,
    );
    if (!parent) return;
    setChildEditor({
      busy: false,
      errors: {},
      form: {
        description: '',
        endsAt: '',
        kind: parent.kind === 'trip' ? 'day' : 'activity',
        startsAt: '',
        timeZone: parent.timeZone,
        title: '',
      },
      message: null,
      parentEventId,
      parentTitle: parent.title,
    });
  }, []);

  const changeChildEditor = useCallback(
    (field: keyof ChildEventForm, value: string) => {
      setChildEditor(current => {
        if (!current || current.busy) return current;
        const form = { ...current.form, [field]: value };
        return {
          ...current,
          errors: validateEventBasicsForm(form).errors,
          form,
          message: null,
        };
      });
    },
    [],
  );

  const submitChildEditor = useCallback(() => {
    if (!runtime || !scopeKey || !childEditor || childEditor.busy) return;
    const validation = validateEventBasicsForm(childEditor.form);
    if (!validation.values) {
      setChildEditor({ ...childEditor, errors: validation.errors });
      return;
    }
    const submitted = childEditor;
    setChildEditor({ ...submitted, busy: true, message: null });
    runtime
      .createChildEvent(rootEventId, submitted.parentEventId, {
        ...validation.values,
        kind: submitted.form.kind,
        status: 'draft',
      })
      .then(
        snapshot => {
          if (scopeRef.current !== scopeKey) return;
          setChildEditor(null);
          const eventRejected = snapshot.issues.some(
            issue => issue.eventAttempted,
          );
          publish({
            key: scopeKey,
            message: eventRejected
              ? 'Ein Unterbereich konnte nicht bestätigt werden. Prüfe die lokale Änderung.'
              : onlineRef.current
                ? 'Unterbereich gespeichert.'
                : 'Unterbereich lokal gespeichert. Er wird bei Verbindung synchronisiert.',
            phase: 'ready',
            refreshing: false,
            snapshot,
          });
        },
        error => {
          if (scopeRef.current !== scopeKey) return;
          setChildEditor(current =>
            current
              ? { ...current, busy: false, message: childEventMessage(error) }
              : current,
          );
        },
      );
  }, [childEditor, publish, rootEventId, runtime, scopeKey]);

  const moveOrder = useCallback(
    (
      target: 'event' | 'item',
      id: string,
      direction: PlanMoveDirection,
    ) => {
      if (!runtime || !scopeKey || orderFlightRef.current) return;
      const current = stateRef.current;
      const previousIssues =
        current.phase === 'ready' && current.key === scopeKey
          ? new Set(current.snapshot.issues.map(issue => issue.mutationId))
          : new Set<string>();
      const flight =
        target === 'event'
          ? runtime.moveChildEvent(rootEventId, id, direction)
          : runtime.moveItineraryItem(rootEventId, id, direction);
      const settled = flight.then(
        snapshot => {
          const rejected = snapshot.issues.some(
            issue =>
              issue.orderAttempted &&
              !previousIssues.has(issue.mutationId),
          );
          publish({
            key: scopeKey,
            message: rejected
              ? 'Die Reihenfolge konnte nicht bestätigt werden. Prüfe die lokale Änderung.'
              : onlineRef.current
                ? 'Reihenfolge gespeichert.'
                : 'Reihenfolge lokal gespeichert.',
            phase: 'ready',
            refreshing: false,
            snapshot,
          });
        },
        error => {
          const current = stateRef.current;
          if (current.phase === 'ready' && current.key === scopeKey) {
            publish({ ...current, message: orderMessage(error) });
          }
        },
      );
      orderFlightRef.current = settled;
      const clear = () => {
        if (orderFlightRef.current === settled) orderFlightRef.current = null;
      };
      settled.then(clear, clear);
    },
    [publish, rootEventId, runtime, scopeKey],
  );

  const visibleState: PlanScreenState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? { key: scopeKey, message: null, phase: 'loading' }
      : { key: '', message: null, phase: 'concealed' };
  const model: PlanViewModel =
    visibleState.phase === 'ready'
      ? {
          message: visibleState.message,
          online,
          phase: 'ready',
          refreshing: visibleState.refreshing,
          selectedEventId,
          selectedItemId,
          snapshot: visibleState.snapshot,
        }
      : {
          message: visibleState.message,
          online,
          phase: visibleState.phase,
          refreshing: false,
          selectedEventId,
          selectedItemId,
          snapshot: null,
        };

  const back = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('EventInbound', { rootEventId });
  };

  const discardIssue = (mutationId: string) => {
    if (!runtime || !scopeKey || discardFlightRef.current) return;
    Alert.alert(
      'Lokale Änderung verwerfen?',
      'Die nicht bestätigte lokale Änderung wird dauerhaft entfernt. Der aktuelle Serverstand bleibt erhalten.',
      [
        { style: 'cancel', text: 'Abbrechen' },
        {
          onPress: () => {
            const flight = runtime.discardIssue(rootEventId, mutationId).then(
              snapshot => {
                publish({
                  key: scopeKey,
                  message: 'Die lokale Änderung wurde verworfen.',
                  phase: 'ready',
                  refreshing: false,
                  snapshot,
                });
              },
              error => {
                const current = stateRef.current;
                if (current.phase === 'ready' && current.key === scopeKey) {
                  publish({ ...current, message: planMessage(error) });
                }
              },
            );
            discardFlightRef.current = flight;
            const clear = () => {
              if (discardFlightRef.current === flight) {
                discardFlightRef.current = null;
              }
            };
            flight.then(clear, clear);
          },
          style: 'destructive',
          text: 'Änderung verwerfen',
        },
      ],
    );
  };

  const retryIssue = (mutationId: string) => {
    if (!runtime || !scopeKey || discardFlightRef.current) return;
    const flight = runtime.retryIssue(rootEventId, mutationId).then(
      snapshot => {
        const stillFailed = snapshot.issues.some(
          issue =>
            issue.mutationId === mutationId && issue.resolution === 'retry',
        );
        publish({
          key: scopeKey,
          message: stillFailed
            ? 'Die Änderung konnte weiterhin nicht bestätigt werden.'
            : onlineRef.current
              ? 'Die Synchronisierung wurde erneut ausgeführt.'
              : 'Die Änderung wird bei der nächsten Verbindung erneut versucht.',
          phase: 'ready',
          refreshing: false,
          snapshot,
        });
      },
      error => {
        const current = stateRef.current;
        if (current.phase === 'ready' && current.key === scopeKey) {
          publish({ ...current, message: planMessage(error) });
        }
      },
    );
    discardFlightRef.current = flight;
    const clear = () => {
      if (discardFlightRef.current === flight) {
        discardFlightRef.current = null;
      }
    };
    flight.then(clear, clear);
  };

  if (childEditor && visibleState.phase === 'ready') {
    return (
      <ChildEventEditorView
        busy={childEditor.busy}
        errors={childEditor.errors}
        form={childEditor.form}
        message={childEditor.message}
        online={online}
        parentTitle={childEditor.parentTitle}
        onBack={() => {
          if (!childEditor.busy) setChildEditor(null);
        }}
        onChange={changeChildEditor}
        onSubmit={submitChildEditor}
      />
    );
  }

  return (
    <PlanView
      model={model}
      onAddChildEvent={openChildEditor}
      onAddItem={eventId =>
        navigation.navigate('PlanItemEditor', { eventId, rootEventId })
      }
      onBack={back}
      onDiscardIssue={discardIssue}
      onEditItem={(eventId, itemId) =>
        navigation.navigate('PlanItemEditor', {
          eventId,
          itemId,
          rootEventId,
        })
      }
      onOpenItem={itemId =>
        navigation.navigate('LiveItem', { itemId, rootEventId })
      }
      onMoveChildEvent={(eventId, direction) =>
        moveOrder('event', eventId, direction)
      }
      onMoveItem={(itemId, direction) =>
        moveOrder('item', itemId, direction)
      }
      onRefresh={refresh}
      onRetryIssue={retryIssue}
      onSelectEvent={eventId => {
        setSelectedEventId(eventId);
        setSelectedItemId(null);
      }}
      onSelectItem={setSelectedItemId}
    />
  );
}

export const PlanRouteScreen = PlanScreen;

function concealsPlan(error: unknown) {
  return (
    error instanceof PlanAccountChangedError ||
    error instanceof PlanUnavailableError
  );
}

function planMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return 'Der aktuelle Serverstand konnte nicht geladen werden. Die sichere Offline-Kopie bleibt verfügbar.';
  }
  return 'Der Plan konnte gerade nicht aktualisiert werden.';
}

function childEventMessage(error: unknown) {
  if (error instanceof Error) {
    return 'Der Unterbereich konnte gerade nicht gespeichert werden. Deine Eingaben bleiben erhalten.';
  }
  return 'Der Unterbereich konnte gerade nicht gespeichert werden.';
}

function orderMessage(error: unknown) {
  if (error instanceof Error) {
    return 'Die Reihenfolge konnte nicht gespeichert werden. Der bisherige Plan bleibt sichtbar.';
  }
  return 'Die Reihenfolge konnte gerade nicht gespeichert werden.';
}
