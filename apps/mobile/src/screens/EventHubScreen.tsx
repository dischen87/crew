import {
  ActorEventRootIndexAccessDeniedError,
  ActorEventRootIndexAccountChangedError,
  ActorEventRootIndexStore,
  LocalAttachmentStore,
  MemberDirectoryRootAccessDeniedError,
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncAccountChangedError,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type EventRecord,
  type FeedRecord,
  type ItineraryRecord,
  type MemberDirectoryEntry,
  type MembershipRecord,
  type RootSyncState,
  type SyncStatus,
} from '@crew/mobile-data';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '../design/primitives';
import { spacing } from '../design/theme';
import { useGatewayClient } from '../app/GatewayProvider';
import {
  usePrivateDatabase,
  usePrivateSessionLifecycle,
} from '../app/PrivateBootstrapGate';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureUuidV4 } from '../storage/secureRandom';
import type { RootStackParamList } from '../navigation/types';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import {
  EventHubView,
  participantCountLabel,
  type EventHubCrewTarget,
  type EventHubDate,
  type EventHubModel,
  type EventHubTimelineItem,
} from './EventHubView';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const cloudOfflineIcon = require('../assets/icons/cloud-offline.png');
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const ITEM_ID = /^iti_[A-Za-z0-9._:-]{1,96}$/;

type Props = NativeStackScreenProps<RootStackParamList, 'EventInbound'>;

export type EventHubReadSnapshot = {
  directory?: readonly MemberDirectoryEntry[];
  feed: readonly FeedRecord[];
  membership: MembershipRecord;
  memberships: readonly MembershipRecord[];
  root: EventRecord;
  syncState: RootSyncState | null;
  timeline: readonly ItineraryRecord[];
};

type EventHubStore = Pick<
  MobileDataStore,
  | 'getRootSyncState'
  | 'listEventTree'
  | 'listFeed'
  | 'listMemberships'
  | 'listTimeline'
>;

type EventHubDirectory = Pick<MemberDirectoryStore, 'list'>;

type SyncPhase = 'cached' | 'offline' | 'refreshed' | 'syncing';

type ReadyState = {
  key: string;
  phase: SyncPhase;
  snapshot: EventHubReadSnapshot;
  status: 'ready';
  syncStatus: SyncStatus | null;
};

type LoadState =
  | ReadyState
  | { key: string; status: 'concealed' }
  | { key: string; status: 'loading' };

const DAY_MS = 86_400_000;

export async function readEventHubSnapshot(
  store: EventHubStore,
  accountUserId: string,
  rootEventId: string,
  directory?: EventHubDirectory,
): Promise<EventHubReadSnapshot | null> {
  const [events, memberships, timeline, feed, syncState, memberDirectory] =
    await Promise.all([
      store.listEventTree(accountUserId, rootEventId),
      store.listMemberships(accountUserId, rootEventId),
      store.listTimeline(accountUserId, rootEventId),
      store.listFeed(accountUserId, rootEventId),
      store.getRootSyncState(accountUserId, rootEventId),
      directory?.list(accountUserId, rootEventId) ?? Promise.resolve([]),
    ]);
  const root = events.find(
    event =>
      event.id === rootEventId &&
      event.rootEventId === rootEventId &&
      event.parentEventId === null &&
      event.deletedAt === null,
  );
  const membership = memberships.find(
    item =>
      item.memberUserId === accountUserId &&
      item.rootEventId === rootEventId &&
      item.status === 'active',
  );
  if (!root || !membership) return null;
  return {
    directory: memberDirectory,
    feed,
    membership,
    memberships,
    root,
    syncState,
    timeline,
  };
}

export function eventHubModelFromReadModels(input: {
  focusedItemId?: string | null;
  now: Date;
  phase: SyncPhase;
  selectedDateId: string | null;
  snapshot: EventHubReadSnapshot;
  syncStatus: SyncStatus | null;
}): EventHubModel {
  const { now, phase, snapshot, syncStatus } = input;
  const activeTimeline = snapshot.timeline.filter(
    item => item.status === 'active' && item.deletedAt === null,
  );
  const dateIds = eventDateIds(snapshot.root, activeTimeline);
  const today = dateKey(now.toISOString(), snapshot.root.timeZone);
  const focusedDateId = dateKey(
    activeTimeline.find(item => item.id === input.focusedItemId)?.startsAt ??
      null,
    snapshot.root.timeZone,
  );
  const selectedDateId = dateIds.includes(focusedDateId ?? '')
    ? focusedDateId
    : dateIds.includes(input.selectedDateId ?? '')
    ? input.selectedDateId
    : dateIds.includes(today ?? '')
    ? today
    : dateIds.find(id => today !== null && id >= today) ??
      dateIds.at(-1) ??
      null;
  const dates = dateIds.map<EventHubDate>((id, index) => ({
    accessibilityLabel: dateAccessibilityLabel(
      id,
      id === today,
      index === dateIds.length - 1 && dateIds.length > 1,
    ),
    day: id.slice(8, 10),
    id,
    isRangeEnd: index === dateIds.length - 1 && dateIds.length > 1,
    isToday: id === today,
    selected: id === selectedDateId,
    weekday: weekday(id),
  }));
  const nextItem =
    activeTimeline.find(item => {
      const instant = validDate(item.startsAt);
      return instant !== null && instant.getTime() >= now.getTime();
    }) ??
    activeTimeline.find(item => item.startsAt === null) ??
    null;
  const nextPlace = nextItem ? itineraryPlace(nextItem) : null;
  const visibleTimeline = activeTimeline
    .filter(
      item =>
        item.id === input.focusedItemId ||
        selectedDateId === null ||
        dateKey(item.startsAt, snapshot.root.timeZone) === selectedDateId,
    )
    .map<EventHubTimelineItem>(item => ({
      eventId: item.eventId,
      focused: item.id === input.focusedItemId,
      icon: itineraryIcon(item),
      id: item.id,
      location: itineraryPlace(item)?.label ?? 'Ort offen',
      time: itineraryTime(item, snapshot.root.timeZone),
      title: item.title,
    }));
  const directory = new Map(
    (snapshot.directory ?? []).map(member => [
      member.userId,
      member.displayName,
    ]),
  );
  const participants = uniqueActiveMemberships(snapshot.memberships).map(
    (membership, index) => ({
      id: membership.memberUserId,
      name:
        membership.memberUserId === snapshot.membership.memberUserId
          ? 'Du'
          : directory.get(membership.memberUserId) ??
            `Teilnehmende Person ${index + 1}`,
    }),
  );
  const feedUpdate = latestFeedUpdate(
    snapshot.feed,
    snapshot.membership.memberUserId,
    directory,
    now,
  );
  const role = snapshot.membership.role;
  const organizerDraft =
    snapshot.root.status === 'draft' &&
    (role === 'owner' || role === 'organizer');
  const primaryAction = organizerDraft
    ? {
        access: 'write' as const,
        accessibilityLabel: 'Event prüfen. Privater Entwurf.',
        id: 'review-event',
        label: 'Event prüfen',
      }
    : nextItem
    ? {
        access: 'read' as const,
        accessibilityLabel: `${nextItem.title} öffnen`,
        id: `open-${nextItem.id}`,
        label: 'Programmpunkt öffnen',
        target: { itemId: nextItem.id, route: 'LiveItem' as const },
      }
    : {
        access: 'read' as const,
        accessibilityLabel: 'Vollständigen Plan ansehen',
        id: 'view-plan',
        label: 'Plan ansehen',
        target: { route: 'Plan' as const },
      };

  return {
    crewTarget: eventHubCrewTarget(snapshot.feed, role),
    dateRange: eventDateRange(snapshot.root, activeTimeline),
    dates,
    feedUpdate,
    location: nextPlace?.locality ?? nextPlace?.label ?? 'Ort offen',
    next: nextItem
      ? {
          location: nextPlace?.label ?? 'Ort offen',
          time: itineraryTime(nextItem, snapshot.root.timeZone),
          title: nextItem.title,
        }
      : null,
    participants,
    participantsAccessibilityLabel: participantLabel(participants),
    primaryAction,
    role,
    status: snapshot.root.status,
    sync: syncPresentation(snapshot.syncState, syncStatus, phase, now),
    timeline: visibleTimeline,
    title: snapshot.root.title,
  } as EventHubModel;
}

export function EventHubScreen({ navigation, route }: Props) {
  const client = useGatewayClient();
  const privateDatabase = usePrivateDatabase();
  const lifecycle = usePrivateSessionLifecycle();
  const activeAccountRef = useRef(lifecycle.accountId);
  activeAccountRef.current = lifecycle.accountId;
  const rootEventId = route.params.rootEventId;
  const inboundFocusedItemId =
    typeof route.params.focusItemId === 'string' &&
    ITEM_ID.test(route.params.focusItemId)
      ? route.params.focusItemId
      : null;
  const scopeKey =
    lifecycle.status === 'ready' &&
    lifecycle.accountId === privateDatabase.accountId &&
    typeof rootEventId === 'string' &&
    EVENT_ID.test(rootEventId)
      ? `${privateDatabase.accountId}:${rootEventId}`
      : null;
  const [refreshRequest, setRefreshRequest] = useState(0);
  const [focusedItemId, setFocusedItemId] = useState(inboundFocusedItemId);
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>({
    key: scopeKey ?? '',
    status: 'loading',
  });
  const syncEngine = useMemo(
    () =>
      client && scopeKey
        ? new MobileSyncEngine(privateDatabase.database, client, {
            activeAccountUserId: () => activeAccountRef.current,
            randomUUID: secureUuidV4,
            onRootReadStarted: (accountUserId, verifiedRootEventId) =>
              deniedRootRegistry.arm(accountUserId, verifiedRootEventId),
            onRootReadFinished: (
              accountUserId,
              verifiedRootEventId,
              verificationId,
            ) =>
              deniedRootRegistry.finish(
                accountUserId,
                verifiedRootEventId,
                verificationId,
              ),
            onRootPurged: accountUserId =>
              reconcileRetainedAttachmentFiles(
                new LocalAttachmentStore(privateDatabase.database),
                accountUserId,
              ),
          })
        : null,
    [client, privateDatabase.database, scopeKey],
  );

  useEffect(() => {
    setFocusedItemId(inboundFocusedItemId);
    setSelectedDateId(null);
  }, [inboundFocusedItemId, scopeKey]);

  useEffect(() => {
    if (!scopeKey) {
      setState({ key: '', status: 'concealed' });
      return;
    }
    let cancelled = false;
    const accountUserId = privateDatabase.accountId;
    const store = new MobileDataStore(privateDatabase.database);
    const index = new ActorEventRootIndexStore(
      privateDatabase.database,
      client ?? undefined,
      { activeAccountUserId: () => activeAccountRef.current },
    );
    const directory = new MemberDirectoryStore(
      privateDatabase.database,
      client ?? undefined,
      { activeAccountUserId: () => activeAccountRef.current },
    );
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
      let hadCachedIndex = false;
      let cached: EventHubReadSnapshot | null = null;
      try {
        hadCachedIndex = Boolean(await index.get(accountUserId, rootEventId));
        if (hadCachedIndex) {
          cached = await readEventHubSnapshot(
            store,
            accountUserId,
            rootEventId,
            directory,
          );
        }
      } catch {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      if (cached) {
        publish({
          key: scopeKey,
          phase: syncEngine ? 'syncing' : 'offline',
          snapshot: cached,
          status: 'ready',
          syncStatus: null,
        });
      } else {
        publish({ key: scopeKey, status: 'loading' });
      }
      if (!syncEngine) {
        if (!cached) publish({ key: scopeKey, status: 'concealed' });
        return;
      }

      try {
        await index.refresh(accountUserId);
        if (!(await index.get(accountUserId, rootEventId))) {
          await reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(privateDatabase.database),
            accountUserId,
          );
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
      } catch (error) {
        if (error instanceof ActorEventRootIndexAccountChangedError) return;
        if (error instanceof ActorEventRootIndexAccessDeniedError) {
          await reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(privateDatabase.database),
            accountUserId,
          );
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
        if (!hadCachedIndex) {
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
      }

      const previousSyncAt = cached?.syncState?.lastCompletedSyncAt ?? null;
      let syncStatus: SyncStatus | null = null;
      let failed = false;
      try {
        syncStatus = await syncEngine.syncRoot(accountUserId, rootEventId, {
          force: refreshRequest > 0,
        });
        await directory.refresh(accountUserId, rootEventId);
      } catch (error) {
        if (error instanceof MobileSyncAccountChangedError) return;
        if (
          error instanceof MobileSyncRootAccessDeniedError ||
          error instanceof MemberDirectoryRootAccessDeniedError
        ) {
          await store.clearRootData(accountUserId, rootEventId);
          await reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(privateDatabase.database),
            accountUserId,
          );
          publish({ key: scopeKey, status: 'concealed' });
          return;
        }
        failed = true;
      }

      let latest = cached;
      try {
        latest =
          (await readEventHubSnapshot(
            store,
            accountUserId,
            rootEventId,
            directory,
          )) ?? cached;
      } catch {
        failed = true;
      }
      if (!latest) {
        publish({ key: scopeKey, status: 'concealed' });
        return;
      }
      const refreshed =
        latest.syncState?.lastCompletedSyncAt !== null &&
        latest.syncState?.lastCompletedSyncAt !== previousSyncAt;
      publish({
        key: scopeKey,
        phase: failed || !refreshed ? 'offline' : 'refreshed',
        snapshot: latest,
        status: 'ready',
        syncStatus,
      });
    })().catch(() => publish({ key: scopeKey, status: 'concealed' }));

    return () => {
      cancelled = true;
    };
  }, [
    client,
    privateDatabase.accountId,
    privateDatabase.database,
    refreshRequest,
    rootEventId,
    scopeKey,
    syncEngine,
  ]);

  if (!scopeKey || state.key !== scopeKey || state.status === 'loading') {
    return (
      <ScreenFrame
        title="Event wird geladen"
        description="Crew lädt die sicher gespeicherten Eventdaten."
      />
    );
  }

  if (state.status === 'concealed') {
    return (
      <ScreenFrame
        description="Dieser Inhalt ist nicht verfügbar."
        icon={cloudOfflineIcon}
        liveRegion="polite"
        statusLabel="Sicher verborgen"
        title="Inhalt nicht verfügbar"
        tone="brand"
      >
        <View style={styles.actions}>
          {client ? (
            <Button
              accessibilityHint="Prüft den aktuellen Eventzugriff erneut über den Crew Gateway."
              icon={<ScreenIcon source={cloudOfflineIcon} />}
              label="Erneut versuchen"
              onPress={() => setRefreshRequest(value => value + 1)}
              testID="event-hub-retry"
              variant="action"
            />
          ) : null}
          <Button
            accessibilityHint="Öffnet deine sicher gespeicherte Eventliste."
            label="Zu Events"
            onPress={() => navigation.navigate('Events')}
            testID="event-hub-to-events"
            variant="surface"
          />
        </View>
      </ScreenFrame>
    );
  }

  const model = eventHubModelFromReadModels({
    focusedItemId,
    now: new Date(),
    phase: state.phase,
    selectedDateId,
    snapshot: state.snapshot,
    syncStatus: state.syncStatus,
  });

  return (
    <EventHubView
      model={model}
      onDateSelect={dateId => {
        if (model.dates.some(date => date.id === dateId)) {
          setFocusedItemId(null);
          setSelectedDateId(dateId);
        }
      }}
      onManageInvites={() => navigation.navigate('Invites', { rootEventId })}
      onPrimaryAction={action => {
        if (action.access === 'write' && action.id === 'review-event') {
          navigation.navigate('EventPublish', { rootEventId });
          return;
        }
        if (action.access === 'read' && action.target.route === 'LiveItem') {
          navigation.navigate('LiveItem', {
            itemId: action.target.itemId,
            rootEventId,
          });
        } else if (action.access === 'read') {
          navigation.navigate('Plan', { rootEventId });
        }
      }}
      onSyncStatusPress={() => setRefreshRequest(value => value + 1)}
      onTabSelect={tab => {
        if (tab === 'plan') {
          navigation.navigate('Plan', { rootEventId });
        } else if (tab === 'feed') {
          navigation.navigate('TeamFeed', { eventId: null, rootEventId });
        } else if (tab === 'crew' && model.crewTarget?.route === 'TeamSetup') {
          navigation.navigate('TeamSetup', {
            eventId: model.crewTarget.eventId,
            rootEventId,
          });
        } else if (tab === 'crew' && model.crewTarget?.route === 'Decision') {
          navigation.navigate('Decision', {
            decisionId: model.crewTarget.decisionId,
            rootEventId,
          });
        } else if (tab === 'more') {
          navigation.navigate('CommunityFeedbackList', { rootEventId });
        }
      }}
      onTimelineSelect={itemId => {
        const item = model.timeline.find(candidate => candidate.id === itemId);
        if (item?.icon === 'golf') {
          navigation.navigate('GolfScorecard', {
            eventId: item.eventId,
            rootEventId,
          });
        } else if (item) {
          navigation.navigate('LiveItem', { itemId: item.id, rootEventId });
        }
      }}
      selectedTab="plan"
    />
  );
}

function eventDateIds(
  root: EventRecord,
  timeline: readonly ItineraryRecord[],
): string[] {
  const start = dateKey(root.startsAt, root.timeZone);
  const end = dateKey(root.endsAt, root.timeZone);
  if (start && end && start <= end) {
    const startMs = Date.parse(`${start}T12:00:00.000Z`);
    const endMs = Date.parse(`${end}T12:00:00.000Z`);
    const dayCount = Math.round((endMs - startMs) / DAY_MS);
    return Array.from({ length: dayCount + 1 }, (_, offset) =>
      new Date(startMs + offset * DAY_MS).toISOString().slice(0, 10),
    );
  }
  return [
    ...new Set(
      timeline
        .map(item => dateKey(item.startsAt, root.timeZone))
        .filter((value): value is string => value !== null),
    ),
  ].sort();
}

function eventDateRange(
  root: EventRecord,
  timeline: readonly ItineraryRecord[],
): string {
  const timelineDates = timeline
    .map(item => dateKey(item.startsAt, root.timeZone))
    .filter((value): value is string => value !== null)
    .sort();
  const start = dateKey(root.startsAt, root.timeZone) ?? timelineDates[0];
  const end = dateKey(root.endsAt, root.timeZone) ?? timelineDates.at(-1);
  if (!start) return 'Termin offen';
  if (!end || end === start) return longDate(start);
  const [startYear, startMonth, startDay] = start.split('-').map(Number);
  const [endYear, endMonth, endDay] = end.split('-').map(Number);
  if (startYear === endYear && startMonth === endMonth) {
    return `${startDay}.–${endDay}. ${monthName(end)} ${endYear}`;
  }
  if (startYear === endYear) {
    return `${startDay}. ${monthName(start)}–${endDay}. ${monthName(
      end,
    )} ${endYear}`;
  }
  return `${longDate(start)}–${longDate(end)}`;
}

function dateKey(value: string | null, timeZone: string): string | null {
  const date = validDate(value);
  if (!date) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find(item => item.type === type)?.value;
    const year = part('year');
    const month = part('month');
    const day = part('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function dateFromKey(value: string) {
  return new Date(`${value}T12:00:00.000Z`);
}

function weekday(value: string) {
  return new Intl.DateTimeFormat('de-CH', {
    timeZone: 'UTC',
    weekday: 'short',
  })
    .format(dateFromKey(value))
    .replace('.', '')
    .toLocaleUpperCase('de-CH');
}

function longDate(value: string) {
  return new Intl.DateTimeFormat('de-CH', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(dateFromKey(value));
}

function monthName(value: string) {
  return new Intl.DateTimeFormat('de-CH', {
    month: 'long',
    timeZone: 'UTC',
  }).format(dateFromKey(value));
}

function dateAccessibilityLabel(
  value: string,
  isToday: boolean,
  isRangeEnd: boolean,
) {
  const date = new Intl.DateTimeFormat('de-CH', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
    weekday: 'long',
  }).format(dateFromKey(value));
  return [date, isToday && 'heute', isRangeEnd && 'Reiseende']
    .filter(Boolean)
    .join(', ');
}

function itineraryTime(item: ItineraryRecord, timeZone: string) {
  if (item.allDay) return 'Ganztägig';
  const startsAt = validDate(item.startsAt);
  if (!startsAt) return 'Zeit offen';
  return new Intl.DateTimeFormat('de-CH', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone,
  }).format(startsAt);
}

function itineraryIcon(item: ItineraryRecord): EventHubTimelineItem['icon'] {
  const type = itineraryDetailsType(item);
  if (type === 'golf_round') return 'golf';
  if (['flight', 'rail', 'road_transfer'].includes(type ?? '')) return 'bus';
  return 'calendar';
}

function itineraryDetailsType(item: ItineraryRecord): string | null {
  try {
    const value = JSON.parse(item.detailsJson) as { type?: unknown };
    return typeof value.type === 'string' ? value.type : null;
  } catch {
    return null;
  }
}

function itineraryPlace(item: ItineraryRecord) {
  if (!item.placeSnapshotJson) return null;
  try {
    const value = JSON.parse(item.placeSnapshotJson) as Record<string, unknown>;
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const locality =
      typeof value.locality === 'string' ? value.locality.trim() : '';
    const latitude = finiteNumber(value.latitude);
    const longitude = finiteNumber(value.longitude);
    const label = name || locality;
    if (!label) return null;
    return {
      label,
      latitude,
      locality: locality || null,
      longitude,
    };
  } catch {
    return null;
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueActiveMemberships(memberships: readonly MembershipRecord[]) {
  const byUser = new Map<string, MembershipRecord>();
  for (const membership of memberships) {
    if (membership.status === 'active') {
      byUser.set(membership.memberUserId, membership);
    }
  }
  return [...byUser.values()];
}

function participantLabel(
  participants: readonly { id: string; name: string }[],
) {
  if (participants.length === 0) return 'Keine Teilnehmenden gespeichert';
  const visible = participants.slice(0, 4).map(({ name }) => name);
  return `${participantCountLabel(participants.length)}: ${visible.join(', ')}${
    participants.length > visible.length ? ' und weitere' : ''
  }`;
}

function latestFeedUpdate(
  feed: readonly FeedRecord[],
  accountUserId: string,
  directory: ReadonlyMap<string, string | null>,
  now: Date,
): EventHubModel['feedUpdate'] {
  for (const entry of feed) {
    try {
      const payload = JSON.parse(entry.payloadJson) as { text?: unknown };
      const action =
        typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!action) continue;
      return {
        action,
        author:
          entry.actorUserId === accountUserId
            ? 'Du'
            : entry.actorUserId === null || entry.kind === 'system'
            ? 'Crew'
            : directory.get(entry.actorUserId) ?? 'Teilnehmende Person',
        relativeTime: relativeTime(entry.updatedAt, now),
      };
    } catch {
      // Invalid local payloads are concealed rather than rendered as copy.
    }
  }
  return null;
}

function eventHubCrewTarget(
  feed: readonly FeedRecord[],
  role: EventHubModel['role'],
): EventHubCrewTarget | null {
  let assignment: EventHubCrewTarget | null = null;
  let decision: EventHubCrewTarget | null = null;
  for (const entry of feed) {
    if (entry.kind !== 'system' || entry.payloadSchemaVersion !== 1) continue;
    try {
      const payload = JSON.parse(entry.payloadJson) as Record<string, unknown>;
      if (
        !assignment &&
        payload.schemaVersion === 1 &&
        payload.type === 'team.assignments.published' &&
        typeof payload.eventId === 'string' &&
        /^evt_[A-Za-z0-9._:-]{1,96}$/.test(payload.eventId)
      ) {
        assignment = { eventId: payload.eventId, route: 'TeamSetup' };
      }
      if (
        !decision &&
        payload.schemaVersion === 1 &&
        ['team.decision.opened', 'team.decision.closed'].includes(
          String(payload.type),
        ) &&
        typeof payload.decisionId === 'string' &&
        /^tdc_[A-Za-z0-9._:-]{1,96}$/.test(payload.decisionId)
      ) {
        decision = { decisionId: payload.decisionId, route: 'Decision' };
      }
    } catch {
      // Malformed local system entries never become navigation targets.
    }
  }
  return role === 'owner' || role === 'organizer'
    ? assignment ?? decision
    : decision ?? assignment;
}

function relativeTime(value: string, now: Date) {
  const date = validDate(value);
  if (!date) return 'Zeitpunkt unbekannt';
  const minutes = Math.max(
    0,
    Math.floor((now.getTime() - date.getTime()) / 60_000),
  );
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days < 7
    ? `vor ${days} Tagen`
    : longDate(date.toISOString().slice(0, 10));
}

function syncPresentation(
  state: RootSyncState | null,
  status: SyncStatus | null,
  phase: SyncPhase,
  now: Date,
): EventHubModel['sync'] {
  if (phase === 'syncing') {
    return {
      label: 'Synchronisierung läuft · Offline-Daten verfügbar',
      state: 'syncing',
    };
  }
  if (status?.state === 'needs_attention') {
    return {
      label: `${status.attentionCount} Änderung${
        status.attentionCount === 1 ? '' : 'en'
      } braucht Aufmerksamkeit`,
      state: 'attention',
    };
  }
  if (
    status &&
    ['blocked', 'pending', 'waiting_retry'].includes(status.state)
  ) {
    return {
      label:
        status.pendingCount > 0
          ? `Offline · ${status.pendingCount} Änderung${
              status.pendingCount === 1 ? '' : 'en'
            } wartet`
          : 'Synchronisierung pausiert',
      state: 'offline',
    };
  }
  const lastSync = state?.lastCompletedSyncAt;
  if (phase === 'refreshed') {
    return { label: 'Offline bereit · gerade synchronisiert', state: 'ready' };
  }
  if (!lastSync)
    return { label: 'Noch nicht synchronisiert', state: 'offline' };
  const label = relativeTime(lastSync, now);
  return {
    label: `${
      phase === 'offline' ? 'Offline' : 'Offline bereit'
    } · ${label} synchronisiert`,
    state: phase === 'offline' ? 'offline' : 'ready',
  };
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'stretch',
    gap: spacing.md,
  },
});
