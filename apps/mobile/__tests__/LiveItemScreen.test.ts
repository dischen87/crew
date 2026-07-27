import type { EventPlaceRecord, EventTreeNode } from '@crew/mobile-data';
import {
  liveItemReadyModel,
  readLiveItemSnapshot,
} from '../src/screens/LiveItemScreen';
import type {
  PlanItemSnapshot,
  PlanSnapshot,
} from '../src/screens/PlanRuntime';

const accountUserId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_golf_trip';
const eventId = 'evt_arrival_day';
const itemId = 'iti_flight_to_event';

test('loads only the exact authorized plan item', () => {
  expect(
    readLiveItemSnapshot(planSnapshot(), rootEventId, itemId),
  ).toMatchObject({
    eventTitle: 'Anreise',
    item: { id: itemId },
    membership: { role: 'participant' },
  });
  expect(
    readLiveItemSnapshot(planSnapshot(), rootEventId, 'iti_missing'),
  ).toBeNull();
});

test('uses the optimistic plan overlay and reports queued offline truth', () => {
  const plan = planSnapshot({
    item: {
      ...itinerary(),
      delivery: 'queued',
      values: {
        ...itinerary().values,
        title: 'Lokal geänderter Hinflug',
      },
    },
    syncStatus: {
      attentionCount: 0,
      nextAttemptAt: null,
      pendingCount: 1,
      state: 'pending',
      summary: 'Eine Änderung wartet auf Synchronisierung.',
    },
  });
  const snapshot = readLiveItemSnapshot(plan, rootEventId, itemId);
  if (!snapshot) throw new Error('Expected optimistic item');

  expect(liveItemReadyModel(snapshot, false)).toMatchObject({
    canEdit: false,
    syncLabel: 'Offline. Die Änderung ist lokal dauerhaft gespeichert.',
    syncState: 'offline',
    title: 'Lokal geänderter Hinflug',
  });
});

test('builds typed travel details from cached named places', () => {
  const snapshot = readLiveItemSnapshot(
    planSnapshot(),
    rootEventId,
    itemId,
  );
  if (!snapshot) throw new Error('Expected cached item');

  expect(liveItemReadyModel(snapshot, true)).toMatchObject({
    canEdit: false,
    canOpenGolfScorecard: false,
    details: [
      { label: 'Von', value: 'Zürich Flughafen, Kloten' },
      { label: 'Nach', value: 'Antalya Flughafen, Antalya' },
      { label: 'Flug', value: 'LX 8176' },
    ],
    eventTitle: 'Anreise',
    itemType: 'Flug',
    place: 'Gate E, Kloten',
    primaryAction: {
      kind: 'plan',
      label: 'Vollständigen Plan ansehen',
    },
    role: 'participant',
    syncState: 'ready',
    timeZone: 'Europe/Zurich',
  });
});

test('next action skips non-active items and reaches recap after the last active team item', () => {
  const cancelled = planItem('iti_cancelled', '2026-09-20T09:00:00.000Z', 'cancelled');
  const next = planItem('iti_next', '2026-09-20T10:00:00.000Z', 'active');
  const withNext = readLiveItemSnapshot(
    planSnapshot({ items: [itinerary(), cancelled, next] }),
    rootEventId,
    itemId,
  );
  if (!withNext) throw new Error('Expected current item');
  expect(liveItemReadyModel(withNext, true).primaryAction).toEqual({
    itemId: 'iti_next',
    kind: 'item',
    label: 'Nächsten Punkt öffnen',
  });

  const teamRoot = { ...rootEvent(), kind: 'team_event' as const };
  const lastActive = readLiveItemSnapshot(
    planSnapshot({
      events: [teamRoot, event()],
      items: [itinerary(), cancelled],
    }),
    rootEventId,
    itemId,
  );
  if (!lastActive) throw new Error('Expected team item');
  expect(liveItemReadyModel(lastActive, true).primaryAction).toEqual({
    kind: 'recap',
    label: 'Rückblick ansehen',
  });
});

function planSnapshot(
  overrides: {
    events?: readonly EventTreeNode[];
    item?: PlanItemSnapshot;
    items?: readonly PlanItemSnapshot[];
    syncStatus?: PlanSnapshot['syncStatus'];
  } = {},
): PlanSnapshot {
  return {
    canEdit: false,
    events: overrides.events ?? [rootEvent(), event()],
    issues: [],
    items: overrides.items ?? [overrides.item ?? itinerary()],
    places: [
      place('plc_zrh', 'Zürich Flughafen', 'Kloten'),
      place('plc_ant', 'Antalya Flughafen', 'Antalya'),
      place('plc_gate_e', 'Gate E', 'Kloten'),
    ],
    role: 'participant',
    syncStatus:
      overrides.syncStatus ??
      ({
        attentionCount: 0,
        nextAttemptAt: null,
        pendingCount: 0,
        state: 'synced',
        summary: 'Plan aktuell.',
      } satisfies PlanSnapshot['syncStatus']),
  };
}

function planItem(
  id: string,
  startsAt: string,
  status: PlanItemSnapshot['values']['status'],
): PlanItemSnapshot {
  return {
    ...itinerary(),
    id,
    sortKey: id,
    values: {
      ...itinerary().values,
      startsAt,
      status,
      title: id === 'iti_next' ? 'Nächster aktiver Punkt' : 'Abgesagt',
    },
  };
}

function rootEvent(): EventTreeNode {
  return {
    accountUserId,
    childOrderVersion: '1',
    createdAt: '2026-07-01T08:00:00.000Z',
    deletedAt: null,
    depth: 0,
    description: null,
    endsAt: '2026-09-21T18:00:00.000Z',
    id: rootEventId,
    itineraryOrderVersion: '1',
    kind: 'trip',
    parentEventId: null,
    rootEventId,
    sortKey: '1024',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: 'Golfreise',
    updatedAt: '2026-07-20T08:00:00.000Z',
    version: 3,
  };
}

function event(): EventTreeNode {
  return {
    ...rootEvent(),
    depth: 1,
    id: eventId,
    kind: 'day',
    parentEventId: rootEventId,
    title: 'Anreise',
  };
}

function itinerary(): PlanItemSnapshot {
  return {
    delivery: 'clean',
    id: itemId,
    placeSnapshotJson: null,
    sortKey: '1024',
    values: {
      allDay: false,
      details: {
        destinationPlaceId: 'plc_ant',
        flightDesignator: 'LX 8176',
        originPlaceId: 'plc_zrh',
        schemaVersion: 1,
        type: 'flight',
      },
      endsAt: '2026-09-20T10:30:00.000Z',
      eventId,
      notes: 'Treffpunkt 90 Minuten vor Abflug.',
      placeId: 'plc_gate_e',
      startsAt: '2026-09-20T08:00:00.000Z',
      status: 'active',
      timeZone: 'Europe/Zurich',
      title: 'Hinflug',
    },
    version: 4,
  };
}

function place(id: string, name: string, locality: string): EventPlaceRecord {
  return {
    accountUserId,
    countryCode: id === 'plc_ant' ? 'TR' : 'CH',
    createdAt: '2026-07-01T08:00:00.000Z',
    deletedAt: null,
    id,
    latitude: null,
    locality,
    longitude: null,
    name,
    rootEventId,
    updatedAt: '2026-07-01T08:00:00.000Z',
    version: 1,
  };
}
