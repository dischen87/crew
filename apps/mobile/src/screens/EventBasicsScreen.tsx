import {
  MobileSyncAccountChangedError,
  MobileSyncPublicationInProgressError,
  MobileSyncRootAccessDeniedError,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import type { RootStackParamList } from '../navigation/types';
import {
  EventBasicsAccountChangedError,
  EventBasicsManagerRequiredError,
  EventBasicsOnlineRequiredError,
  EventBasicsPendingError,
  EventBasicsRuntime,
  type EventBasicsSnapshot,
  EventBasicsUnavailableError,
  type EventBasicsValues,
} from './EventBasicsRuntime';
import {
  EventBasicsView,
  type EventBasicsField,
  type EventBasicsForm,
  type EventBasicsPrimaryAction,
  type EventBasicsViewModel,
} from './EventBasicsView';
import { useOnlineState } from './useOnlineState';

type Props = NativeStackScreenProps<RootStackParamList, 'EventBasicsEdit'>;

type ReadyState = {
  baseline: EventBasicsForm;
  busyAction: 'refresh' | 'save' | null;
  errors: Partial<Record<EventBasicsField, string>>;
  form: EventBasicsForm;
  key: string;
  message: string | null;
  phase: 'ready';
  saved: boolean;
  snapshot: EventBasicsSnapshot;
};

type ScreenState = ReadyState | { key: string; phase: 'concealed' | 'loading' };

export function EventBasicsScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const rootEventId = route.params.rootEventId;
  const focusField = validField(route.params.focusField);
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [state, setState] = useState<ScreenState>({
    key: scopeKey ?? '',
    phase: 'loading',
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const actionFlightRef = useRef<Promise<void> | null>(null);
  const runtime = useMemo(
    () =>
      scopeKey
        ? new EventBasicsRuntime({
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

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setState({ key: scopeKey ?? '', phase: 'concealed' });
      return;
    }
    let cancelled = false;
    publish({ key: scopeKey, phase: 'loading' });
    const load = async () => {
      let cached: EventBasicsSnapshot | null = null;
      try {
        cached = await runtime.load(rootEventId);
      } catch (error) {
        if (concealsBasics(error)) {
          if (!cancelled) publish({ key: scopeKey, phase: 'concealed' });
          return;
        }
      }
      if (!onlineRef.current || !client || cancelled) {
        if (!cancelled) {
          publish(
            cached
              ? readyState(scopeKey, cached, null)
              : { key: scopeKey, phase: 'concealed' },
          );
        }
        return;
      }
      try {
        const refreshed = await runtime.refresh(rootEventId);
        if (!cancelled) publish(readyState(scopeKey, refreshed, null));
      } catch (error) {
        if (cancelled) return;
        if (concealsBasics(error)) {
          publish({ key: scopeKey, phase: 'concealed' });
        } else if (cached) {
          publish(readyState(scopeKey, cached, safeBasicsMessage(error)));
        } else {
          publish({ key: scopeKey, phase: 'concealed' });
        }
      }
    };
    load().catch(() => {
      if (!cancelled) publish({ key: scopeKey, phase: 'concealed' });
    });
    return () => {
      cancelled = true;
    };
  }, [client, publish, rootEventId, runtime, scopeKey]);

  const change = useCallback(
    (field: EventBasicsField, value: string) => {
      const current = stateRef.current;
      if (
        !scopeKey ||
        current.phase !== 'ready' ||
        current.key !== scopeKey ||
        !editableDelivery(current.snapshot.delivery) ||
        current.busyAction
      ) {
        return;
      }
      const form = { ...current.form, [field]: value };
      const validation = validateEventBasicsForm(form);
      publish({
        ...current,
        errors: validation.errors,
        form,
        message: null,
        saved: false,
      });
    },
    [publish, scopeKey],
  );

  const runAction = useCallback(
    (action: EventBasicsPrimaryAction) => {
      if (action === 'back') {
        if (scopeRef.current !== scopeKey) return;
        if (!scopeKey) {
          navigation.navigate('Events');
          return;
        }
        if (activeAccountRef.current !== privateDatabase.accountId) return;
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.navigate('EventPublish', { rootEventId });
        return;
      }
      const current = stateRef.current;
      if (
        !runtime ||
        !scopeKey ||
        scopeRef.current !== scopeKey ||
        current.key !== scopeKey ||
        current.phase !== 'ready' ||
        activeAccountRef.current !== privateDatabase.accountId ||
        actionFlightRef.current
      ) {
        return;
      }
      if (action === 'save' && !validateEventBasicsForm(current.form).values) {
        return;
      }
      const accountUserId = privateDatabase.accountId;
      const flight = (async () => {
        publish({ ...current, busyAction: action, message: null });
        try {
          const snapshot =
            action === 'refresh'
              ? await runtime.refresh(rootEventId)
              : await saveForm(runtime, rootEventId, current.form);
          if (
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== accountUserId
          ) {
            return;
          }
          const saved = action === 'save' && snapshot.delivery === 'clean';
          publish(
            readyState(
              scopeKey,
              snapshot,
              saveMessage(action, snapshot),
              saved,
            ),
          );
        } catch (error) {
          if (
            scopeRef.current !== scopeKey ||
            activeAccountRef.current !== accountUserId
          ) {
            return;
          }
          if (concealsBasics(error)) {
            publish({ key: scopeKey, phase: 'concealed' });
            return;
          }
          let snapshot = current.snapshot;
          try {
            snapshot = await runtime.load(rootEventId);
          } catch (loadError) {
            if (concealsBasics(loadError)) {
              publish({ key: scopeKey, phase: 'concealed' });
              return;
            }
          }
          const recovered = readyState(
            scopeKey,
            snapshot,
            safeBasicsMessage(error),
          );
          if (action === 'save' && snapshot.delivery === 'clean') {
            recovered.form = current.form;
            recovered.baseline = current.baseline;
            recovered.errors = validateEventBasicsForm(current.form).errors;
          }
          publish(recovered);
        }
      })();
      actionFlightRef.current = flight;
      const clearFlight = () => {
        if (actionFlightRef.current === flight) actionFlightRef.current = null;
      };
      flight.then(clearFlight, clearFlight);
    },
    [
      navigation,
      privateDatabase.accountId,
      publish,
      rootEventId,
      runtime,
      scopeKey,
    ],
  );

  const onBack = () => runAction('back');
  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : scopeKey
      ? { key: scopeKey, phase: 'loading' as const }
      : { key: '', phase: 'concealed' as const };

  return (
    <EventBasicsView
      model={eventBasicsViewModel(visibleState, online, focusField)}
      onBack={onBack}
      onChange={change}
      onPrimaryAction={runAction}
    />
  );
}

export function validateEventBasicsForm(form: EventBasicsForm): {
  errors: Partial<Record<EventBasicsField, string>>;
  values: EventBasicsValues | null;
} {
  const errors: Partial<Record<EventBasicsField, string>> = {};
  const title = form.title.trim();
  const description = form.description.trim();
  if (!title) errors.title = 'Gib dem Event einen Titel.';
  else if (title.length > 160) errors.title = 'Maximal 160 Zeichen.';
  if (description.length > 20_000) {
    errors.description = 'Maximal 20’000 Zeichen.';
  }
  if (!isIanaTimeZone(form.timeZone)) {
    errors.timeZone = 'Verwende eine gültige IANA-Zeitzone.';
  }
  const startsAt = localInstant(form.startsAt, form.timeZone);
  const endsAt = localInstant(form.endsAt, form.timeZone);
  if (startsAt === 'invalid') {
    errors.startsAt = 'Format JJJJ-MM-TT HH:MM verwenden.';
  } else if (startsAt === 'ambiguous') {
    errors.startsAt =
      'Diese Uhrzeit ist wegen der Zeitumstellung doppelt. Wähle eine eindeutige Uhrzeit.';
  }
  if (endsAt === 'invalid') {
    errors.endsAt = 'Format JJJJ-MM-TT HH:MM verwenden.';
  } else if (endsAt === 'ambiguous') {
    errors.endsAt =
      'Diese Uhrzeit ist wegen der Zeitumstellung doppelt. Wähle eine eindeutige Uhrzeit.';
  }
  if (
    typeof startsAt === 'string' &&
    startsAt !== 'invalid' &&
    startsAt !== 'ambiguous' &&
    typeof endsAt === 'string' &&
    endsAt !== 'invalid' &&
    endsAt !== 'ambiguous' &&
    startsAt &&
    endsAt &&
    Date.parse(startsAt) >= Date.parse(endsAt)
  ) {
    errors.endsAt = 'Das Ende muss nach dem Beginn liegen.';
  }
  if (Object.keys(errors).length > 0) return { errors, values: null };
  return {
    errors,
    values: {
      description: description || null,
      endsAt: endsAt === 'invalid' || endsAt === 'ambiguous' ? null : endsAt,
      startsAt:
        startsAt === 'invalid' || startsAt === 'ambiguous' ? null : startsAt,
      timeZone: form.timeZone,
      title,
    },
  };
}

function eventBasicsViewModel(
  state: ScreenState,
  online: boolean,
  focusField: EventBasicsField | null,
): EventBasicsViewModel {
  if (state.phase !== 'ready') {
    return {
      busyAction: null,
      conflictCurrent: null,
      delivery: 'clean',
      dirty: false,
      editable: false,
      errors: {},
      focusField,
      form: emptyForm(),
      message: null,
      online,
      phase: state.phase,
      role: null,
      saved: false,
    };
  }
  return {
    busyAction: state.busyAction,
    conflictCurrent: state.snapshot.conflict
      ? formFromValues(state.snapshot.conflict.current)
      : null,
    delivery: state.snapshot.delivery,
    dirty:
      state.snapshot.delivery === 'conflict' ||
      !sameForm(state.form, state.baseline),
    editable: editableDelivery(state.snapshot.delivery),
    errors: state.errors,
    focusField,
    form: state.form,
    message: state.message,
    online,
    phase: 'ready',
    role: state.snapshot.role,
    saved: state.saved,
  };
}

async function saveForm(
  runtime: EventBasicsRuntime,
  rootEventId: string,
  form: EventBasicsForm,
) {
  const validation = validateEventBasicsForm(form);
  if (!validation.values) throw new EventBasicsUnavailableError();
  return runtime.save(rootEventId, validation.values);
}

function readyState(
  key: string,
  snapshot: EventBasicsSnapshot,
  message: string | null,
  saved = false,
): ReadyState {
  const form = formFromValues(snapshot.draft);
  return {
    baseline: form,
    busyAction: null,
    errors: validateEventBasicsForm(form).errors,
    form,
    key,
    message,
    phase: 'ready',
    saved,
    snapshot,
  };
}

function formFromValues(values: EventBasicsValues): EventBasicsForm {
  return {
    description: values.description ?? '',
    endsAt: formatLocalInstant(values.endsAt, values.timeZone),
    startsAt: formatLocalInstant(values.startsAt, values.timeZone),
    timeZone: values.timeZone,
    title: values.title,
  };
}

function emptyForm(): EventBasicsForm {
  return {
    description: '',
    endsAt: '',
    startsAt: '',
    timeZone: '',
    title: '',
  };
}

function editableDelivery(delivery: EventBasicsSnapshot['delivery']) {
  return delivery === 'clean' || delivery === 'conflict';
}

function saveMessage(
  action: Exclude<EventBasicsPrimaryAction, 'back'>,
  snapshot: EventBasicsSnapshot,
) {
  if (snapshot.delivery === 'conflict') {
    return 'Der aktuelle Serverstand und deine Angaben bleiben getrennt sichtbar.';
  }
  if (snapshot.delivery === 'attention') {
    return 'Die gespeicherte Änderung braucht deine Aufmerksamkeit.';
  }
  if (snapshot.delivery === 'queued' || snapshot.delivery === 'syncing') {
    return 'Lokal dauerhaft gespeichert. Genau eine Änderung wartet auf die Serverbestätigung.';
  }
  return action === 'save'
    ? 'Event-Details gespeichert und vom Server bestätigt.'
    : 'Aktueller Serverstand geladen.';
}

function safeBasicsMessage(error: unknown) {
  if (error instanceof EventBasicsOnlineRequiredError) {
    return 'Für die Serverprüfung brauchst du eine Verbindung. Die lokale Änderung bleibt erhalten.';
  }
  if (error instanceof EventBasicsPendingError) {
    return 'Eine dauerhaft gespeicherte Änderung wartet bereits. Es wurde keine zweite Version angelegt.';
  }
  if (error instanceof MobileSyncPublicationInProgressError) {
    return 'Die Veröffentlichungsprüfung läuft bereits. Es wurde keine weitere Änderung gespeichert.';
  }
  return 'Keine neue Änderung wurde bestätigt. Deine Eingaben bleiben erhalten.';
}

function concealsBasics(error: unknown) {
  return (
    error instanceof EventBasicsAccountChangedError ||
    error instanceof EventBasicsManagerRequiredError ||
    error instanceof EventBasicsUnavailableError ||
    error instanceof MobileSyncAccountChangedError ||
    error instanceof MobileSyncRootAccessDeniedError
  );
}

function validField(value: string | undefined): EventBasicsField | null {
  return value === 'description' ||
    value === 'endsAt' ||
    value === 'startsAt' ||
    value === 'timeZone' ||
    value === 'title'
    ? value
    : null;
}

function sameForm(left: EventBasicsForm, right: EventBasicsForm) {
  return (
    left.description === right.description &&
    left.endsAt === right.endsAt &&
    left.startsAt === right.startsAt &&
    left.timeZone === right.timeZone &&
    left.title === right.title
  );
}

function isIanaTimeZone(value: string) {
  if (!value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function localInstant(
  value: string,
  timeZone: string,
): string | 'ambiguous' | 'invalid' | null {
  if (!value.trim()) return null;
  if (!isIanaTimeZone(timeZone)) return 'invalid';
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) return 'invalid';
  const desired = match.slice(1).map(Number);
  const [year, month, day, hour, minute] = desired;
  if (
    !year ||
    !month ||
    !day ||
    hour === undefined ||
    minute === undefined ||
    month > 12 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return 'invalid';
  }
  const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
  const canonical = new Date(desiredUtc);
  if (
    canonical.getUTCFullYear() !== year ||
    canonical.getUTCMonth() !== month - 1 ||
    canonical.getUTCDate() !== day ||
    canonical.getUTCHours() !== hour ||
    canonical.getUTCMinutes() !== minute
  ) {
    return 'invalid';
  }
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const visible = zonedParts(new Date(candidate), timeZone);
    if (!visible) return 'invalid';
    const visibleUtc = Date.UTC(
      visible.year,
      visible.month - 1,
      visible.day,
      visible.hour,
      visible.minute,
    );
    const next = candidate + (desiredUtc - visibleUtc);
    if (next === candidate) break;
    candidate = next;
  }
  const verified = zonedParts(new Date(candidate), timeZone);
  if (!verified || !sameParts(verified, { year, month, day, hour, minute })) {
    return 'invalid';
  }
  const transitionOffsets = [30, 60, 90, 120, 180];
  if (
    transitionOffsets.some(offset =>
      [-offset, offset].some(delta => {
        const alternative = zonedParts(
          new Date(candidate + delta * 60_000),
          timeZone,
        );
        return Boolean(
          alternative &&
            sameParts(alternative, { year, month, day, hour, minute }),
        );
      }),
    )
  ) {
    return 'ambiguous';
  }
  return new Date(candidate).toISOString();
}

function formatLocalInstant(value: string | null, timeZone: string) {
  if (!value) return '';
  const parts = zonedParts(new Date(value), timeZone);
  if (!parts) return '';
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(
    parts.hour,
  )}:${pad(parts.minute)}`;
}

type DateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
};

function zonedParts(date: Date, timeZone: string): DateParts | null {
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
      minute: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(date);
    const value = Object.fromEntries(
      parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]),
    ) as Partial<DateParts>;
    return Number.isInteger(value.year) &&
      Number.isInteger(value.month) &&
      Number.isInteger(value.day) &&
      Number.isInteger(value.hour) &&
      Number.isInteger(value.minute)
      ? (value as DateParts)
      : null;
  } catch {
    return null;
  }
}

function sameParts(left: DateParts, right: DateParts) {
  return (
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.month === right.month &&
    left.year === right.year
  );
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
