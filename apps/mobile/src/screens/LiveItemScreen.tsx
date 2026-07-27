import {
  type EventPlaceRecord,
  type MembershipRecord,
  type SyncPlaceSnapshot,
} from '@crew/mobile-data';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { deniedRootRegistry } from '../storage/deniedRoots';
import {
  LiveItemView,
  type LiveItemDetail,
  type LiveItemReadyModel,
  type LiveItemViewModel,
} from './LiveItemView';
import {
  PlanRuntime,
  type PlanItemDelivery,
  type PlanItemSnapshot,
  type PlanSnapshot,
} from './PlanRuntime';
import { useOnlineState } from './useOnlineState';

const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const ITEM_ID = /^iti_[A-Za-z0-9._:-]{1,96}$/;

export type LiveItemSnapshot = {
  delivery: PlanItemDelivery;
  eventTitle: string;
  hasTeamContext: boolean;
  issue: PlanSnapshot['issues'][number]['code'] | null;
  item: PlanItemSnapshot;
  membership: Pick<MembershipRecord, 'role'>;
  nextItemId: string | null;
  places: readonly EventPlaceRecord[];
  syncStatus: PlanSnapshot['syncStatus'];
};

export type LiveItemEditTarget = {
  eventId: string;
  itemId: string;
  rootEventId: string;
};

export type LiveItemGolfTarget = {
  eventId: string;
  rootEventId: string;
};

export type LiveItemPrimaryTarget =
  | { kind: 'item'; itemId: string; rootEventId: string }
  | { kind: 'plan'; rootEventId: string }
  | { kind: 'recap'; rootEventId: string };

export type LiveItemScreenProps = {
  itemId: string;
  onBack(): void;
  onEdit?(target: LiveItemEditTarget): void;
  onOpenGolfScorecard?(target: LiveItemGolfTarget): void;
  onPrimaryAction?(target: LiveItemPrimaryTarget): void;
  rootEventId: string;
};

type ScopedState =
  | { key: string; phase: 'concealed' | 'loading' }
  | { key: string; phase: 'ready'; snapshot: LiveItemSnapshot };

export function LiveItemScreen({
  itemId,
  onBack,
  onEdit,
  onOpenGolfScorecard,
  onPrimaryAction,
  rootEventId,
}: LiveItemScreenProps) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const online = useOnlineState();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId &&
    EVENT_ID.test(rootEventId) &&
    ITEM_ID.test(itemId)
      ? `${privateDatabase.accountId}:${rootEventId}:${itemId}`
      : null;
  const [state, setState] = useState<ScopedState>({
    key: scopeKey ?? '',
    phase: 'loading',
  });
  const runtime = useMemo(
    () =>
      scopeKey
        ? new PlanRuntime({
            accountUserId: privateDatabase.accountId,
            activeAccountUserId: () => activeAccountRef.current,
            client,
            database: privateDatabase.database,
            isOnline: () => online,
          })
        : null,
    [
      client,
      online,
      privateDatabase.accountId,
      privateDatabase.database,
      scopeKey,
    ],
  );

  useEffect(() => {
    if (!scopeKey || !runtime) {
      setState({ key: '', phase: 'concealed' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const database = privateDatabase.database;
    const publish = (next: ScopedState) => {
      if (
        !cancelled &&
        next.key === scopeKey &&
        activeAccountRef.current === accountUserId
      ) {
        setState(next);
      }
    };
    publish({ key: scopeKey, phase: 'loading' });

    (async () => {
      await deniedRootRegistry.purgeRecorded(accountUserId, database);
      if (cancelled || activeAccountRef.current !== accountUserId) return;
      const snapshot = readLiveItemSnapshot(
        await runtime.load(rootEventId),
        rootEventId,
        itemId,
      );
      publish(
        snapshot
          ? { key: scopeKey, phase: 'ready', snapshot }
          : { key: scopeKey, phase: 'concealed' },
      );
    })().catch(() => publish({ key: scopeKey, phase: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    itemId,
    privateDatabase.accountId,
    privateDatabase.database,
    rootEventId,
    runtime,
    scopeKey,
  ]);

  const visibleState =
    scopeKey && state.key === scopeKey
      ? state
      : ({ key: scopeKey ?? '', phase: 'loading' } as const);
  const model: LiveItemViewModel =
    visibleState.phase === 'ready'
      ? {
          item: liveItemReadyModel(visibleState.snapshot, online),
          phase: 'ready',
        }
      : { phase: visibleState.phase };
  const target =
    visibleState.phase === 'ready'
      ? {
          eventId: visibleState.snapshot.item.values.eventId,
          itemId: visibleState.snapshot.item.id,
          rootEventId,
        }
      : null;

  return (
    <LiveItemView
      model={model}
      onBack={onBack}
      onEdit={
        target && onEdit
          ? () => {
              if (activeAccountRef.current === privateDatabase.accountId) {
                onEdit(target);
              }
            }
          : undefined
      }
      onOpenGolfScorecard={
        target && onOpenGolfScorecard
          ? () => {
              if (activeAccountRef.current === privateDatabase.accountId) {
                onOpenGolfScorecard({
                  eventId: target.eventId,
                  rootEventId: target.rootEventId,
                });
              }
            }
          : undefined
      }
      onPrimaryAction={
        visibleState.phase === 'ready' && onPrimaryAction
          ? () =>
              onPrimaryAction(
                primaryTarget(visibleState.snapshot, rootEventId),
              )
          : undefined
      }
    />
  );
}

export function readLiveItemSnapshot(
  plan: PlanSnapshot,
  rootEventId: string,
  itemId: string,
): LiveItemSnapshot | null {
  const root = plan.events.find(
    event =>
      event.id === rootEventId &&
      event.rootEventId === rootEventId &&
      event.parentEventId === null &&
      event.deletedAt === null,
  );
  const item = plan.items.find(candidate => candidate.id === itemId);
  const event = item
    ? plan.events.find(
        candidate =>
          candidate.id === item.values.eventId &&
          candidate.rootEventId === rootEventId &&
          candidate.deletedAt === null,
      )
    : null;
  if (!root || !item || !event) return null;
  const ordered = [...plan.items].sort(compareItems);
  const index = ordered.findIndex(candidate => candidate.id === itemId);
  return {
    delivery: item.delivery,
    eventTitle: event.title,
    hasTeamContext: hasTeamContext(event.id, plan),
    issue:
      plan.issues.find(candidate => candidate.itemId === item.id)?.code ?? null,
    item,
    membership: { role: plan.role },
    nextItemId:
      ordered
        .slice(index + 1)
        .find(candidate => candidate.values.status === 'active')?.id ?? null,
    places: plan.places,
    syncStatus: plan.syncStatus,
  };
}

export function liveItemReadyModel(
  snapshot: LiveItemSnapshot,
  online: boolean,
): LiveItemReadyModel {
  const values = snapshot.item.values;
  const details = values.details as Record<string, unknown> & {
    type: string;
  };
  const attention =
    snapshot.issue !== null ||
    snapshot.delivery === 'attention' ||
    snapshot.delivery === 'queued' ||
    snapshot.delivery === 'syncing' ||
    snapshot.syncStatus.state !== 'synced';
  return {
    canEdit:
      snapshot.item.version !== null &&
      snapshot.delivery === 'clean' &&
      (snapshot.issue === null || snapshot.issue === 'conflict') &&
      (snapshot.membership.role === 'owner' ||
        snapshot.membership.role === 'organizer'),
    canOpenGolfScorecard: details.type === 'golf_round',
    dateLabel: scheduleDate(values),
    details: detailRows(details, values.timeZone, snapshot.places),
    eventTitle: snapshot.eventTitle,
    itemType: detailsTypeLabel(details.type),
    notes: cleanText(values.notes),
    place:
      placeLabel(snapshot.item.placeSnapshotJson) ||
      eventPlaceLabel(values.placeId, snapshot.places),
    primaryAction: primaryAction(snapshot),
    role: snapshot.membership.role,
    status: values.status,
    syncLabel: syncLabel(snapshot, online),
    syncState: online ? (attention ? 'attention' : 'ready') : 'offline',
    timeLabel: scheduleTime(values),
    timeZone: validTimeZone(values.timeZone),
    title: values.title,
  };
}

function detailRows(
  details: Record<string, unknown> & { type: string },
  timeZone: string,
  places: readonly EventPlaceRecord[],
): LiveItemDetail[] {
  const row = (label: string, value: unknown): LiveItemDetail[] => {
    const text = cleanText(value);
    return text ? [{ label, value: text }] : [];
  };
  switch (details.type) {
    case 'activity':
      return row('Buchungsreferenz', details.bookingReference);
    case 'flight':
      return [
        ...row(
          'Von',
          snapshotLabel(details.originPlaceSnapshot) ||
            eventPlaceLabel(details.originPlaceId, places),
        ),
        ...row(
          'Nach',
          snapshotLabel(details.destinationPlaceSnapshot) ||
            eventPlaceLabel(details.destinationPlaceId, places),
        ),
        ...row('Flug', details.flightDesignator),
      ];
    case 'rail':
      return [
        ...row(
          'Von',
          snapshotLabel(details.originPlaceSnapshot) ||
            eventPlaceLabel(details.originPlaceId, places),
        ),
        ...row(
          'Nach',
          snapshotLabel(details.destinationPlaceSnapshot) ||
            eventPlaceLabel(details.destinationPlaceId, places),
        ),
        ...row('Verbindung', details.serviceDesignator),
      ];
    case 'road_transfer':
      return [
        ...row(
          'Von',
          snapshotLabel(details.originPlaceSnapshot) ||
            eventPlaceLabel(details.originPlaceId, places),
        ),
        ...row(
          'Nach',
          snapshotLabel(details.destinationPlaceSnapshot) ||
            eventPlaceLabel(details.destinationPlaceId, places),
        ),
        ...row('Abholung', details.pickupInstructions),
      ];
    case 'lodging':
      return [
        ...row('Unterkunft', details.propertyName),
        ...row('Check-in', formatDetailDateTime(details.checkInAt, timeZone)),
        ...row('Check-out', formatDetailDateTime(details.checkOutAt, timeZone)),
      ];
    case 'meal':
      return row('Reservation', details.reservationNote);
    case 'golf_round':
      return [
        ...row('Runde', details.roundReference),
        ...row('Tee Time', formatDetailDateTime(details.teeTime, timeZone)),
      ];
    case 'session':
      return row('Raum', details.room);
    default:
      return [];
  }
}

function snapshotLabel(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<SyncPlaceSnapshot>;
  return [cleanText(snapshot.name), cleanText(snapshot.locality)]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function placeLabel(value: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const label = [cleanText(parsed.name), cleanText(parsed.locality)]
      .filter((part): part is string => Boolean(part))
      .join(', ');
    return label || null;
  } catch {
    return null;
  }
}

function eventPlaceLabel(
  rawId: unknown,
  places: readonly EventPlaceRecord[],
) {
  if (typeof rawId !== 'string') return null;
  const place = places.find(candidate => candidate.id === rawId);
  return place
    ? [place.name, place.locality].filter(Boolean).join(', ')
    : null;
}

function detailsTypeLabel(type: string) {
  const labels: Record<string, string> = {
    activity: 'Aktivität',
    flight: 'Flug',
    golf_round: 'Golfrunde',
    lodging: 'Unterkunft',
    meal: 'Essen',
    note: 'Notiz',
    rail: 'Zugfahrt',
    road_transfer: 'Transfer',
    session: 'Session',
  };
  return labels[type] || 'Programmpunkt';
}

function scheduleDate(item: PlanItemSnapshot['values']) {
  if (!item.startsAt) return 'Datum offen';
  const start = formatDate(item.startsAt, item.timeZone, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  });
  if (
    !item.endsAt ||
    localDateKey(item.startsAt, item.timeZone) ===
      localDateKey(item.endsAt, item.timeZone)
  ) {
    return start;
  }
  return `${start} – ${formatDate(item.endsAt, item.timeZone, {
    day: 'numeric',
    month: 'long',
    weekday: 'long',
    year: 'numeric',
  })}`;
}

function scheduleTime(item: PlanItemSnapshot['values']) {
  if (item.allDay) return 'Ganztägig';
  if (!item.startsAt) return 'Zeit offen';
  const start = formatDate(item.startsAt, item.timeZone, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  });
  if (!item.endsAt) return `${start} Uhr`;
  const end = formatDate(item.endsAt, item.timeZone, {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  });
  return `${start}–${end} Uhr`;
}

function formatDetailDateTime(value: unknown, timeZone: string) {
  const text = cleanText(value);
  if (!text || !validDate(text)) return null;
  return formatDate(text, timeZone, {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDate(
  value: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = validDate(value);
  if (!date) return 'Zeit offen';
  return new Intl.DateTimeFormat('de-CH', {
    ...options,
    timeZone: validTimeZone(timeZone),
  }).format(date);
}

function syncLabel(snapshot: LiveItemSnapshot, online: boolean) {
  if (snapshot.issue) {
    return 'Diese Änderung wurde nicht bestätigt. Öffne den Plan, um sie zu prüfen.';
  }
  if (snapshot.delivery === 'queued') {
    return online
      ? 'Lokal gespeichert. Die Änderung wartet auf den Abgleich.'
      : 'Offline. Die Änderung ist lokal dauerhaft gespeichert.';
  }
  if (snapshot.delivery === 'syncing') {
    return 'Lokal gespeichert. Die Änderung wird gerade abgeglichen.';
  }
  if (snapshot.delivery === 'attention') {
    return 'Die lokal gespeicherte Änderung braucht deine Aufmerksamkeit.';
  }
  return online
    ? snapshot.syncStatus.summary
    : `Offline. ${snapshot.syncStatus.summary}`;
}

function compareItems(left: PlanItemSnapshot, right: PlanItemSnapshot) {
  const leftTime = left.values.startsAt ?? '';
  const rightTime = right.values.startsAt ?? '';
  return (
    leftTime.localeCompare(rightTime) ||
    (left.sortKey ?? '').localeCompare(right.sortKey ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function hasTeamContext(eventId: string, plan: PlanSnapshot) {
  const byId = new Map(plan.events.map(event => [event.id, event]));
  let current = byId.get(eventId);
  while (current) {
    if (current.kind === 'team_event') return true;
    current = current.parentEventId
      ? byId.get(current.parentEventId)
      : undefined;
  }
  return false;
}

function primaryAction(
  snapshot: LiveItemSnapshot,
): LiveItemReadyModel['primaryAction'] {
  if (
    snapshot.issue === 'deleted' ||
    snapshot.item.values.status === 'cancelled' ||
    snapshot.item.values.status === 'archived'
  ) {
    return { kind: 'plan', label: 'Aktualisierten Plan ansehen' };
  }
  if (snapshot.nextItemId) {
    return {
      itemId: snapshot.nextItemId,
      kind: 'item',
      label: 'Nächsten Programmpunkt öffnen',
    };
  }
  if (snapshot.hasTeamContext) {
    return { kind: 'recap', label: 'Rückblick ansehen' };
  }
  return { kind: 'plan', label: 'Vollständigen Plan ansehen' };
}

function primaryTarget(
  snapshot: LiveItemSnapshot,
  rootEventId: string,
): LiveItemPrimaryTarget {
  const action = primaryAction(snapshot);
  return action.kind === 'item'
    ? { itemId: action.itemId, kind: 'item', rootEventId }
    : { kind: action.kind, rootEventId };
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat('de-CH', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

function validDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(value: string, timeZone: string) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: validTimeZone(timeZone),
    year: 'numeric',
  }).format(date);
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
