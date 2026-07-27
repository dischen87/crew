import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import { validateEventBasicsForm } from './EventBasicsScreen';
import {
  EventSetupRecoveryAccountChangedError,
  EventSetupRecoveryBusyError,
  EventSetupRecoveryConnectionError,
  EventSetupRecoveryManagerRequiredError,
  EventSetupRecoveryOnlineRequiredError,
  EventSetupRecoveryRuntime,
  EventSetupRecoveryUnavailableError,
  type EventSetupPlaceCandidate,
} from './EventSetupRecoveryRuntime';
import {
  PlanAccountChangedError,
  PlanManagerRequiredError,
  PlanPendingError,
  PlanRuntime,
  type PlanSnapshot,
  PlanUnavailableError,
  PlanValidationError,
  type PlanItemDetails,
  type PlanItemValues,
} from './PlanRuntime';
import {
  PlanItemEditorView,
  type PlanItemEditorField,
  type PlanItemEditorForm,
  type PlanItemPlaceField,
  type PlanItemEditorViewModel,
  type PlanItemStatus,
  type PlanItemType,
} from './PlanItemEditorView';
import { useOnlineState } from './useOnlineState';

type Props = NativeStackScreenProps<RootStackParamList, 'PlanItemEditor'>;

const eventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const itemIdPattern = /^iti_[A-Za-z0-9._:-]{1,96}$/;
const accountIdPattern = /^usr_[a-f0-9]{32}$/;

type ReadyState = {
  baseline: PlanItemEditorForm;
  busy: boolean;
  delivery: 'attention' | 'clean' | 'queued' | 'syncing';
  errors: Partial<Record<PlanItemEditorField, string>>;
  eventId: string;
  form: PlanItemEditorForm;
  issue: PlanItemEditorViewModel['issue'];
  key: string;
  message: string | null;
  phase: 'ready';
  placeAction: 'create' | 'search' | null;
  placeMessage: string | null;
  placeQuery: string;
  placeResults: readonly EventSetupPlaceCandidate[];
  placeTarget: PlanItemPlaceField | null;
  refreshing: boolean;
  saved: boolean;
  snapshot: PlanSnapshot;
};

type EditorState =
  | ReadyState
  | {
      key: string;
      message: string | null;
      phase: 'concealed' | 'loading';
    };

export function PlanItemEditorScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const { eventId, itemId, rootEventId } = route.params;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId &&
    accountIdPattern.test(privateDatabase.accountId) &&
    eventIdPattern.test(rootEventId) &&
    eventIdPattern.test(eventId) &&
    (!itemId || itemIdPattern.test(itemId))
      ? `${privateDatabase.accountId}:${rootEventId}:${eventId}:${
          itemId ?? 'new'
        }`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [state, setState] = useState<EditorState>({
    key: scopeKey ?? '',
    message: null,
    phase: 'loading',
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const saveFlightRef = useRef<Promise<void> | null>(null);
  const placeFlightRef = useRef<Promise<void> | null>(null);
  const runtimes = useMemo(() => {
    if (!scopeKey) return null;
    const options = {
      accountUserId: privateDatabase.accountId,
      activeAccountUserId: () => activeAccountRef.current,
      client,
      database: privateDatabase.database,
      isOnline: () => onlineRef.current,
    };
    return {
      plan: new PlanRuntime(options),
      places: new EventSetupRecoveryRuntime(options),
    };
  }, [client, privateDatabase.accountId, privateDatabase.database, scopeKey]);
  const runtime = runtimes?.plan ?? null;
  const placeRuntime = runtimes?.places ?? null;

  const publish = useCallback(
    (next: EditorState) => {
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
    saveFlightRef.current = null;
    placeFlightRef.current = null;
  }, [scopeKey]);

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
      } catch (error) {
        if (concealsEditor(error)) {
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
              message: editorMessage(error),
              phase: 'concealed',
            });
          }
          return;
        }
      }
      if (cached && !cancelled) {
        const ready = readyState(scopeKey, cached, eventId, itemId);
        if (!ready) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
          return;
        }
        publish({
          ...ready,
          refreshing: onlineRef.current,
        });
      }
      if (!onlineRef.current || cancelled) return;
      try {
        const snapshot = await runtime.refresh(rootEventId);
        if (cancelled) return;
        const ready = readyState(scopeKey, snapshot, eventId, itemId);
        publish(
          ready ?? {
            key: scopeKey,
            message: null,
            phase: 'concealed',
          },
        );
      } catch (error) {
        if (cancelled) return;
        if (concealsEditor(error)) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
        } else if (cached) {
          const ready = readyState(
            scopeKey,
            cached,
            eventId,
            itemId,
            editorMessage(error),
          );
          if (ready) publish(ready);
        } else {
          publish({
            key: scopeKey,
            message: editorMessage(error),
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
  }, [eventId, itemId, publish, rootEventId, runtime, scopeKey]);

  const change = useCallback(
    (field: PlanItemEditorField, value: string) => {
      const current = stateRef.current;
      if (
        !scopeKey ||
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        current.busy ||
        current.refreshing ||
        current.saved ||
        (current.issue !== null && current.issue !== 'conflict') ||
        current.delivery === 'syncing' ||
        current.delivery === 'attention'
      ) {
        return;
      }
      const form = { ...current.form, [field]: value };
      publish({
        ...current,
        ...(isPlaceField(field) && current.placeTarget === field
          ? emptyPlaceSearch()
          : {}),
        errors: validateForm(form).errors,
        form,
        message: null,
      });
    },
    [publish, scopeKey],
  );

  const updateForm = useCallback(
    (changes: Partial<PlanItemEditorForm>) => {
      const current = stateRef.current;
      if (
        !scopeKey ||
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        current.busy ||
        current.refreshing ||
        current.saved ||
        (current.issue !== null && current.issue !== 'conflict') ||
        current.delivery === 'syncing' ||
        current.delivery === 'attention'
      ) {
        return;
      }
      const form = { ...current.form, ...changes };
      publish({
        ...current,
        ...(changes.type ? emptyPlaceSearch() : {}),
        errors: validateForm(form).errors,
        form,
        message: null,
      });
    },
    [publish, scopeKey],
  );

  const openPlaceSearch = useCallback(
    (target: PlanItemPlaceField) => {
      const current = stateRef.current;
      if (
        !scopeKey ||
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        current.busy ||
        current.refreshing ||
        current.saved ||
        (current.issue !== null && current.issue !== 'conflict') ||
        current.delivery === 'syncing' ||
        current.delivery === 'attention' ||
        placeFlightRef.current
      ) {
        return;
      }
      publish({
        ...current,
        ...emptyPlaceSearch(),
        placeTarget: target,
      });
    },
    [publish, scopeKey],
  );

  const closePlaceSearch = useCallback(() => {
    const current = stateRef.current;
    if (
      current.phase === 'ready' &&
      current.key === scopeKey &&
      !placeFlightRef.current
    ) {
      publish({ ...current, ...emptyPlaceSearch() });
    }
  }, [publish, scopeKey]);

  const changePlaceQuery = useCallback(
    (value: string) => {
      const current = stateRef.current;
      if (
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        !current.placeTarget ||
        current.placeAction ||
        value.length > 120
      ) {
        return;
      }
      publish({
        ...current,
        placeMessage: null,
        placeQuery: value,
        placeResults: [],
      });
    },
    [publish, scopeKey],
  );

  const searchPlaces = useCallback(() => {
    const current = stateRef.current;
    const query = current.phase === 'ready' ? current.placeQuery.trim() : '';
    if (
      !placeRuntime ||
      !scopeKey ||
      current.phase !== 'ready' ||
      current.key !== scopeKey ||
      !current.placeTarget ||
      current.placeAction ||
      !onlineRef.current ||
      !query ||
      placeFlightRef.current
    ) {
      return;
    }
    const target = current.placeTarget;
    const kind = placeSearchKind(current.form.type, target);
    publish({ ...current, placeAction: 'search', placeMessage: null });
    const flight = placeRuntime
      .searchEventPlaces(rootEventId, kind, query)
      .then(
        results => {
          const latest = stateRef.current;
          if (
            latest.phase !== 'ready' ||
            latest.key !== scopeKey ||
            latest.placeTarget !== target
          ) {
            return;
          }
          publish({
            ...latest,
            placeAction: null,
            placeMessage:
              results.length === 0
                ? 'Keine neuen passenden Orte gefunden. Gespeicherte Treffer bleiben wählbar.'
                : null,
            placeResults: results,
          });
        },
        error => {
          if (concealsPlaceSearch(error)) {
            publish({ key: scopeKey, message: null, phase: 'concealed' });
            return;
          }
          const latest = stateRef.current;
          if (
            latest.phase === 'ready' &&
            latest.key === scopeKey &&
            latest.placeTarget === target
          ) {
            publish({
              ...latest,
              placeAction: null,
              placeMessage: placeSearchMessage(error),
              placeResults: [],
            });
          }
        },
      );
    placeFlightRef.current = flight;
    const clear = () => {
      if (placeFlightRef.current === flight) placeFlightRef.current = null;
    };
    flight.then(clear, clear);
  }, [placeRuntime, publish, rootEventId, scopeKey]);

  const createPlace = useCallback(
    (candidateId: string) => {
      const current = stateRef.current;
      const candidate =
        current.phase === 'ready'
          ? current.placeResults.find(result => result.id === candidateId)
          : null;
      if (
        !runtime ||
        !placeRuntime ||
        !scopeKey ||
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        !current.placeTarget ||
        current.placeAction ||
        !onlineRef.current ||
        !candidate ||
        placeFlightRef.current
      ) {
        return;
      }
      const target = current.placeTarget;
      const previousItem = itemId
        ? current.snapshot.items.find(item => item.id === itemId)
        : null;
      let created = false;
      publish({ ...current, placeAction: 'create', placeMessage: null });
      const flight = (async () => {
        try {
          const place = await placeRuntime.createEventPlace(
            rootEventId,
            candidate,
          );
          created = true;
          const snapshot = await runtime.refresh(rootEventId);
          const confirmed = snapshot.places.find(
            item => item.id === place.id && item.name === place.name,
          );
          const refreshedItem = itemId
            ? snapshot.items.find(item => item.id === itemId)
            : null;
          if (
            !snapshot.canEdit ||
            !confirmed ||
            (itemId &&
              (!previousItem ||
                !refreshedItem ||
                refreshedItem.values.eventId !== eventId))
          ) {
            throw new EventSetupRecoveryUnavailableError();
          }
          const latest = stateRef.current;
          if (
            latest.phase !== 'ready' ||
            latest.key !== scopeKey ||
            latest.placeTarget !== target
          ) {
            return;
          }
          const form = { ...latest.form, [target]: confirmed.id };
          const refreshedIssue = itemId
            ? snapshot.issues.find(issue => issue.itemId === itemId) ?? null
            : null;
          const serverChanged = Boolean(
            previousItem &&
              refreshedItem &&
              (previousItem.version !== refreshedItem.version ||
                !sameForm(
                  formFromValues(previousItem.values),
                  formFromValues(refreshedItem.values),
                )),
          );
          const issue =
            refreshedIssue?.code ??
            (serverChanged ? ('conflict' as const) : latest.issue);
          publish({
            ...latest,
            ...emptyPlaceSearch(),
            baseline:
              serverChanged && refreshedItem
                ? formFromValues(refreshedItem.values)
                : latest.baseline,
            errors: validateForm(form).errors,
            form,
            issue,
            message:
              serverChanged || refreshedIssue
                ? `${confirmed.name} wurde ausgewählt. ${issueMessage(
                    issue ?? 'conflict',
                    Boolean(refreshedItem),
                  )}`
                : `${confirmed.name} wurde im Event gespeichert und ausgewählt.`,
            snapshot,
          });
        } catch (error) {
          if (concealsPlaceSearch(error)) {
            publish({ key: scopeKey, message: null, phase: 'concealed' });
            return;
          }
          const latest = stateRef.current;
          if (
            latest.phase === 'ready' &&
            latest.key === scopeKey &&
            latest.placeTarget === target
          ) {
            publish({
              ...latest,
              placeAction: null,
              placeMessage: created
                ? 'Der Ort wurde angelegt, aber der aktuelle Planstand konnte nicht bestätigt werden. Suche erneut; es wird nichts doppelt angelegt.'
                : placeSearchMessage(error),
            });
          }
        }
      })();
      placeFlightRef.current = flight;
      const clear = () => {
        if (placeFlightRef.current === flight) placeFlightRef.current = null;
      };
      flight.then(clear, clear);
    },
    [eventId, itemId, placeRuntime, publish, rootEventId, runtime, scopeKey],
  );

  const save = useCallback(() => {
    const current = stateRef.current;
    if (
      !runtime ||
      !scopeKey ||
      current.phase !== 'ready' ||
      current.key !== scopeKey ||
      current.busy ||
      current.refreshing ||
      current.saved ||
      (current.issue !== null && current.issue !== 'conflict') ||
      saveFlightRef.current ||
      placeFlightRef.current
    ) {
      return;
    }
    const validation = validateForm(current.form);
    if (!validation.values) {
      publish({ ...current, errors: validation.errors });
      return;
    }
    const previousItemIds = new Set(
      current.snapshot.items.map(item => item.id),
    );
    const previousIssueIds = new Set(
      current.snapshot.issues.map(issue => issue.mutationId),
    );
    publish({ ...current, busy: true, message: null });
    const flight = (
      itemId
        ? runtime.updateItem(rootEventId, itemId, {
            allDay: validation.values.allDay,
            details: validation.values.details,
            endsAt: validation.values.endsAt,
            notes: validation.values.notes,
            placeId: validation.values.placeId,
            startsAt: validation.values.startsAt,
            status: validation.values.status,
            timeZone: validation.values.timeZone,
            title: validation.values.title,
          })
        : runtime.createItem(rootEventId, {
            ...validation.values,
            eventId,
          })
    ).then(
      snapshot => {
        const savedItem = itemId
          ? snapshot.items.find(item => item.id === itemId)
          : snapshot.items.find(item => !previousItemIds.has(item.id));
        const issue = itemId
          ? snapshot.issues.find(candidate => candidate.itemId === itemId)
          : snapshot.issues.find(
              candidate =>
                !previousIssueIds.has(candidate.mutationId) &&
                candidate.attempted?.eventId === eventId,
            );
        const attempted = issue?.attempted ?? savedItem?.values ?? null;
        if (!attempted) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
          return;
        }
        const form = formFromValues(attempted);
        const baseline = issue?.current
          ? formFromValues(issue.current)
          : savedItem
          ? formFromValues(savedItem.values)
          : current.baseline;
        const delivery = savedItem?.delivery ?? 'attention';
        publish({
          baseline,
          busy: false,
          delivery,
          errors: validateForm(form).errors,
          eventId,
          form,
          issue: issue?.code ?? null,
          key: scopeKey,
          message: issue
            ? issueMessage(issue.code, Boolean(savedItem))
            : saveMessage(delivery),
          phase: 'ready',
          ...emptyPlaceSearch(),
          refreshing: false,
          saved: !issue,
          snapshot,
        });
      },
      error => {
        if (concealsEditor(error)) {
          publish({
            key: scopeKey,
            message: null,
            phase: 'concealed',
          });
          return;
        }
        const latest = stateRef.current;
        if (latest.phase === 'ready' && latest.key === scopeKey) {
          publish({
            ...latest,
            busy: false,
            message: editorMessage(error),
            saved: false,
          });
        }
      },
    );
    saveFlightRef.current = flight;
    const clear = () => {
      if (saveFlightRef.current === flight) saveFlightRef.current = null;
    };
    flight.then(clear, clear);
  }, [eventId, itemId, publish, rootEventId, runtime, scopeKey]);

  const visibleState: EditorState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? { key: scopeKey, message: null, phase: 'loading' }
      : { key: '', message: null, phase: 'concealed' };
  const model = editorViewModel(
    visibleState,
    online,
    itemId ? 'edit' : 'create',
  );
  const back = () => {
    const current = stateRef.current;
    if (current.phase === 'ready' && current.saved) {
      navigation.replace('Plan', { eventId, rootEventId });
      return;
    }
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Plan', { eventId, rootEventId });
  };

  return (
    <PlanItemEditorView
      model={model}
      onAllDayChange={value => updateForm({ allDay: value })}
      onBack={back}
      onChange={change}
      onClosePlaceSearch={closePlaceSearch}
      onCreatePlace={createPlace}
      onOpenPlaceSearch={openPlaceSearch}
      onPlaceQueryChange={changePlaceQuery}
      onPrimaryAction={save}
      onSearchPlaces={searchPlaces}
      onStatusChange={(status: PlanItemStatus) => updateForm({ status })}
      onTypeChange={(type: PlanItemType) => updateForm({ type })}
    />
  );
}

export const PlanItemEditorRouteScreen = PlanItemEditorScreen;

function readyState(
  key: string,
  snapshot: PlanSnapshot,
  eventId: string,
  itemId?: string,
  message: string | null = null,
): ReadyState | null {
  if (!snapshot.canEdit) return null;
  const event = snapshot.events.find(candidate => candidate.id === eventId);
  if (!event) return null;
  const item = itemId
    ? snapshot.items.find(candidate => candidate.id === itemId)
    : null;
  if (itemId && (!item || item.values.eventId !== eventId)) return null;
  const issue = item
    ? snapshot.issues.find(candidate => candidate.itemId === item.id) ?? null
    : null;
  const baseline = item
    ? formFromValues(item.values)
    : emptyForm(defaultType(event.kind), event.timeZone);
  const form =
    issue?.attempted?.eventId === eventId
      ? formFromValues(issue.attempted)
      : baseline;
  return {
    baseline,
    busy: false,
    delivery: item?.delivery ?? 'clean',
    errors: validateForm(form).errors,
    eventId,
    form,
    issue: issue?.code ?? null,
    key,
    message,
    phase: 'ready',
    ...emptyPlaceSearch(),
    refreshing: false,
    saved: false,
    snapshot,
  };
}

function editorViewModel(
  state: EditorState,
  online: boolean,
  mode: 'create' | 'edit',
): PlanItemEditorViewModel {
  if (state.phase !== 'ready') {
    return {
      busy: false,
      canSubmit: false,
      delivery: 'clean',
      dirty: false,
      errors: {},
      eventTitle: '',
      form: emptyForm('note', ''),
      issue: null,
      message: state.message,
      mode,
      online,
      phase: state.phase,
      placeSearch: {
        action: null,
        message: null,
        query: '',
        results: [],
        target: null,
      },
      places: [],
      refreshing: false,
      role: null,
      saved: false,
    };
  }
  const event = state.snapshot.events.find(
    candidate => candidate.id === state.eventId,
  );
  return {
    busy: state.busy,
    canSubmit: Object.keys(state.errors).length === 0,
    delivery: state.delivery,
    dirty: !sameForm(state.form, state.baseline),
    errors: state.errors,
    eventTitle: event?.title ?? 'Event',
    form: state.form,
    issue: state.issue,
    message: state.message,
    mode,
    online,
    phase: 'ready',
    placeSearch: {
      action: state.placeAction,
      message: state.placeMessage,
      query: state.placeQuery,
      results: state.placeResults,
      target: state.placeTarget,
    },
    places: state.snapshot.places.map(place => ({
      id: place.id,
      label: [place.name, place.locality].filter(Boolean).join(', '),
    })),
    refreshing: state.refreshing,
    role:
      state.snapshot.role === 'owner' || state.snapshot.role === 'organizer'
        ? state.snapshot.role
        : null,
    saved: state.saved,
  };
}

export function validatePlanItemEditorForm(form: PlanItemEditorForm): {
  errors: Partial<Record<PlanItemEditorField, string>>;
  values: Omit<PlanItemValues, 'eventId'> | null;
} {
  return validateForm(form);
}

function validateForm(form: PlanItemEditorForm): {
  errors: Partial<Record<PlanItemEditorField, string>>;
  values: Omit<PlanItemValues, 'eventId'> | null;
} {
  const base = validateEventBasicsForm({
    description: form.notes,
    endsAt: form.endsAt,
    startsAt: form.startsAt,
    timeZone: form.timeZone,
    title: form.title,
  });
  const errors: Partial<Record<PlanItemEditorField, string>> = {
    ...(base.errors.description ? { notes: base.errors.description } : {}),
    ...(base.errors.endsAt ? { endsAt: base.errors.endsAt } : {}),
    ...(base.errors.startsAt ? { startsAt: base.errors.startsAt } : {}),
    ...(base.errors.timeZone ? { timeZone: base.errors.timeZone } : {}),
    ...(base.errors.title ? { title: base.errors.title } : {}),
  };
  if (form.placeId && !/^plc_[A-Za-z0-9._:-]{1,96}$/.test(form.placeId)) {
    errors.placeId = 'Verwende eine gültige Crew-Ort-ID.';
  }
  const details = detailsFromForm(form, errors);
  if (!base.values || !details || Object.keys(errors).length > 0) {
    return { errors, values: null };
  }
  return {
    errors,
    values: {
      allDay: form.allDay,
      details,
      endsAt: base.values.endsAt,
      notes: base.values.description,
      placeId: form.placeId.trim() || null,
      startsAt: base.values.startsAt,
      status: form.status,
      timeZone: base.values.timeZone,
      title: base.values.title,
    },
  };
}

function detailsFromForm(
  form: PlanItemEditorForm,
  errors: Partial<Record<PlanItemEditorField, string>>,
): PlanItemDetails | null {
  const optional = (value: string) => value.trim() || undefined;
  if (form.type === 'note') return { schemaVersion: 1, type: 'note' };
  if (form.type === 'activity') {
    return {
      ...(optional(form.activityBookingReference)
        ? { bookingReference: form.activityBookingReference.trim() }
        : {}),
      schemaVersion: 1,
      type: 'activity',
    };
  }
  if (
    form.type === 'flight' ||
    form.type === 'rail' ||
    form.type === 'road_transfer'
  ) {
    if (!/^plc_[A-Za-z0-9._:-]{1,96}$/.test(form.originPlaceId)) {
      errors.originPlaceId = 'Wähle einen gespeicherten Startort.';
    }
    if (!/^plc_[A-Za-z0-9._:-]{1,96}$/.test(form.destinationPlaceId)) {
      errors.destinationPlaceId = 'Wähle einen gespeicherten Zielort.';
    }
    if (errors.originPlaceId || errors.destinationPlaceId) return null;
    const places = {
      destinationPlaceId: form.destinationPlaceId,
      originPlaceId: form.originPlaceId,
      schemaVersion: 1 as const,
    };
    if (form.type === 'flight') {
      return {
        ...places,
        ...(optional(form.flightDesignator)
          ? { flightDesignator: form.flightDesignator.trim() }
          : {}),
        type: 'flight',
      };
    }
    if (form.type === 'rail') {
      return {
        ...places,
        ...(optional(form.railServiceDesignator)
          ? { serviceDesignator: form.railServiceDesignator.trim() }
          : {}),
        type: 'rail',
      };
    }
    return {
      ...places,
      ...(optional(form.roadPickupInstructions)
        ? { pickupInstructions: form.roadPickupInstructions.trim() }
        : {}),
      type: 'road_transfer',
    };
  }
  if (form.type === 'lodging') {
    if (!form.lodgingPropertyName.trim()) {
      errors.lodgingPropertyName = 'Gib die Unterkunft an.';
    }
    if (!form.lodgingCheckInAt.trim()) {
      errors.lodgingCheckInAt = 'Gib den Check-in an.';
    }
    if (!form.lodgingCheckOutAt.trim()) {
      errors.lodgingCheckOutAt = 'Gib den Check-out an.';
    }
    const dates = validateDatePair(
      form.lodgingCheckInAt,
      form.lodgingCheckOutAt,
      form.timeZone,
    );
    if (dates.startsError && !errors.lodgingCheckInAt) {
      errors.lodgingCheckInAt = dates.startsError;
    }
    if (dates.endsError && !errors.lodgingCheckOutAt) {
      errors.lodgingCheckOutAt = dates.endsError;
    }
    if (
      errors.lodgingPropertyName ||
      errors.lodgingCheckInAt ||
      errors.lodgingCheckOutAt ||
      !dates.startsAt ||
      !dates.endsAt
    ) {
      return null;
    }
    return {
      checkInAt: dates.startsAt,
      checkOutAt: dates.endsAt,
      propertyName: form.lodgingPropertyName.trim(),
      schemaVersion: 1,
      type: 'lodging',
    };
  }
  if (form.type === 'meal') {
    return {
      ...(optional(form.mealReservationNote)
        ? { reservationNote: form.mealReservationNote.trim() }
        : {}),
      schemaVersion: 1,
      type: 'meal',
    };
  }
  if (form.type === 'golf_round') {
    if (!form.golfRoundReference.trim()) {
      errors.golfRoundReference = 'Gib eine Rundenreferenz an.';
    }
    const teeTime = validateDatePair(form.golfTeeTime, '', form.timeZone);
    if (!form.golfTeeTime.trim()) {
      errors.golfTeeTime = 'Gib die Tee-Time an.';
    } else if (teeTime.startsError) {
      errors.golfTeeTime = teeTime.startsError;
    }
    if (errors.golfRoundReference || errors.golfTeeTime || !teeTime.startsAt) {
      return null;
    }
    return {
      roundReference: form.golfRoundReference.trim(),
      schemaVersion: 1,
      teeTime: teeTime.startsAt,
      type: 'golf_round',
    };
  }
  if (
    form.sessionDescendantEventId.trim() &&
    !/^evt_[A-Za-z0-9._:-]{1,96}$/.test(form.sessionDescendantEventId)
  ) {
    errors.sessionDescendantEventId =
      'Verwende eine gültige untergeordnete Event-ID.';
    return null;
  }
  return {
    ...(optional(form.sessionDescendantEventId)
      ? { descendantEventId: form.sessionDescendantEventId.trim() }
      : {}),
    ...(optional(form.sessionRoom) ? { room: form.sessionRoom.trim() } : {}),
    schemaVersion: 1,
    type: 'session',
  };
}

function validateDatePair(startsAt: string, endsAt: string, timeZone: string) {
  const validation = validateEventBasicsForm({
    description: '',
    endsAt,
    startsAt,
    timeZone,
    title: 'Zeit',
  });
  return {
    endsAt: validation.values?.endsAt ?? null,
    endsError: validation.errors.endsAt,
    startsAt: validation.values?.startsAt ?? null,
    startsError: validation.errors.startsAt,
  };
}

function formFromValues(values: PlanItemValues): PlanItemEditorForm {
  const form = emptyForm(values.details.type, values.timeZone);
  form.allDay = values.allDay;
  form.endsAt = formatLocalInstant(values.endsAt, values.timeZone);
  form.notes = values.notes ?? '';
  form.placeId = values.placeId ?? '';
  form.startsAt = formatLocalInstant(values.startsAt, values.timeZone);
  form.status = values.status;
  form.title = values.title;
  const details = values.details;
  if (details.type === 'activity') {
    form.activityBookingReference = details.bookingReference ?? '';
  } else if (details.type === 'flight') {
    form.destinationPlaceId = details.destinationPlaceId;
    form.flightDesignator = details.flightDesignator ?? '';
    form.originPlaceId = details.originPlaceId;
  } else if (details.type === 'rail') {
    form.destinationPlaceId = details.destinationPlaceId;
    form.originPlaceId = details.originPlaceId;
    form.railServiceDesignator = details.serviceDesignator ?? '';
  } else if (details.type === 'road_transfer') {
    form.destinationPlaceId = details.destinationPlaceId;
    form.originPlaceId = details.originPlaceId;
    form.roadPickupInstructions = details.pickupInstructions ?? '';
  } else if (details.type === 'lodging') {
    form.lodgingCheckInAt = formatLocalInstant(
      details.checkInAt,
      values.timeZone,
    );
    form.lodgingCheckOutAt = formatLocalInstant(
      details.checkOutAt,
      values.timeZone,
    );
    form.lodgingPropertyName = details.propertyName;
  } else if (details.type === 'meal') {
    form.mealReservationNote = details.reservationNote ?? '';
  } else if (details.type === 'golf_round') {
    form.golfRoundReference = details.roundReference;
    form.golfTeeTime = formatLocalInstant(details.teeTime, values.timeZone);
  } else if (details.type === 'session') {
    form.sessionDescendantEventId = details.descendantEventId ?? '';
    form.sessionRoom = details.room ?? '';
  }
  return form;
}

function emptyForm(type: PlanItemType, timeZone: string): PlanItemEditorForm {
  return {
    activityBookingReference: '',
    allDay: false,
    destinationPlaceId: '',
    endsAt: '',
    flightDesignator: '',
    golfRoundReference: '',
    golfTeeTime: '',
    lodgingCheckInAt: '',
    lodgingCheckOutAt: '',
    lodgingPropertyName: '',
    mealReservationNote: '',
    notes: '',
    originPlaceId: '',
    placeId: '',
    railServiceDesignator: '',
    roadPickupInstructions: '',
    sessionDescendantEventId: '',
    sessionRoom: '',
    startsAt: '',
    status: 'active',
    timeZone,
    title: '',
    type,
  };
}

function defaultType(
  kind: PlanSnapshot['events'][number]['kind'],
): PlanItemType {
  if (kind === 'golf') return 'golf_round';
  if (kind === 'session' || kind === 'team_event') return 'session';
  if (kind === 'activity') return 'activity';
  return 'note';
}

function formatLocalInstant(value: string | null, timeZone: string) {
  if (!value || !timeZone) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    })
      .formatToParts(new Date(value))
      .reduce<Record<string, string>>((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } catch {
    return '';
  }
}

function sameForm(left: PlanItemEditorForm, right: PlanItemEditorForm) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyPlaceSearch(): Pick<
  ReadyState,
  'placeAction' | 'placeMessage' | 'placeQuery' | 'placeResults' | 'placeTarget'
> {
  return {
    placeAction: null,
    placeMessage: null,
    placeQuery: '',
    placeResults: [],
    placeTarget: null,
  };
}

function isPlaceField(field: PlanItemEditorField): field is PlanItemPlaceField {
  return (
    field === 'placeId' ||
    field === 'originPlaceId' ||
    field === 'destinationPlaceId'
  );
}

function placeSearchKind(
  type: PlanItemType,
  target: PlanItemPlaceField,
): 'golf_course' | 'venue' {
  return type === 'golf_round' && target === 'placeId'
    ? 'golf_course'
    : 'venue';
}

function placeSearchMessage(error: unknown) {
  if (error instanceof EventSetupRecoveryOnlineRequiredError) {
    return 'Neue Orte brauchen eine Verbindung. Bereits gespeicherte Orte bleiben wählbar.';
  }
  if (error instanceof EventSetupRecoveryBusyError) {
    return 'Ein Ort wird bereits sicher verarbeitet.';
  }
  if (error instanceof EventSetupRecoveryConnectionError) {
    return 'Die Ortssuche konnte nicht bestätigt werden. Deine Eingaben bleiben erhalten.';
  }
  return 'Kein neuer Ort wurde bestätigt. Deine Eingaben bleiben erhalten.';
}

function concealsPlaceSearch(error: unknown) {
  return (
    concealsEditor(error) ||
    error instanceof EventSetupRecoveryAccountChangedError ||
    error instanceof EventSetupRecoveryManagerRequiredError ||
    error instanceof EventSetupRecoveryUnavailableError
  );
}

function saveMessage(delivery: ReadyState['delivery']) {
  if (delivery === 'queued') {
    return 'Lokal dauerhaft gespeichert. Die Änderung wartet auf Verbindung.';
  }
  if (delivery === 'syncing') {
    return 'Lokal dauerhaft gespeichert. Die Änderung wird synchronisiert.';
  }
  if (delivery === 'attention') {
    return 'Die gespeicherte Änderung braucht deine Aufmerksamkeit.';
  }
  return 'Der Server hat die Änderung bestätigt.';
}

function issueMessage(
  code: NonNullable<ReadyState['issue']>,
  canRetry: boolean,
) {
  if (code === 'conflict') {
    return canRetry
      ? 'Der Serverstand hat sich geändert. Prüfe deine erhaltenen Eingaben und speichere erneut.'
      : 'Der neue Eintrag kollidiert mit dem Serverstand. Kehre zum Plan zurück und verwirf die nicht bestätigte Änderung, bevor du ihn neu anlegst.';
  }
  if (code === 'permission') {
    return 'Die Änderung wurde wegen fehlender Berechtigung nicht übernommen.';
  }
  if (code === 'deleted') {
    return 'Der Programmpunkt wurde entfernt. Die Änderung wurde nicht übernommen.';
  }
  return 'Die Änderung wurde nicht bestätigt und braucht deine Aufmerksamkeit.';
}

function editorMessage(error: unknown) {
  if (error instanceof PlanPendingError) {
    return 'Für diesen Programmpunkt wartet bereits eine dauerhaft gespeicherte Änderung.';
  }
  if (error instanceof PlanValidationError) {
    return 'Prüfe die markierten Angaben. Es wurde keine Änderung gespeichert.';
  }
  return 'Keine neue Änderung wurde bestätigt. Deine Eingaben bleiben erhalten.';
}

function concealsEditor(error: unknown) {
  return (
    error instanceof PlanAccountChangedError ||
    error instanceof PlanManagerRequiredError ||
    error instanceof PlanUnavailableError
  );
}
