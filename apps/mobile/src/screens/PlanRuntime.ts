import {
  LocalAttachmentStore,
  MobileDataStore,
  MobileSyncEngine,
  type EventPlaceRecord,
  type EventTreeNode,
  type ItineraryRecord,
  type MembershipRecord,
  type OutboxItem,
  type SqlDatabase,
  type SyncMutation,
  type SyncStatus,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import { secureDeviceIdStore } from '../storage/deviceIdentity';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureUuidV4 } from '../storage/secureRandom';

type ItineraryCreate = Extract<SyncMutation, { kind: 'itinerary.create' }>;
type ItineraryUpdate = Extract<SyncMutation, { kind: 'itinerary.update' }>;
type ItineraryCommand = ItineraryCreate | ItineraryUpdate;

export type PlanItemDetails = ItineraryCreate['payload']['details'];

export type PlanItemValues = {
  allDay: boolean;
  details: PlanItemDetails;
  endsAt: string | null;
  eventId: string;
  notes: string | null;
  placeId: string | null;
  startsAt: string | null;
  status: 'active' | 'cancelled' | 'archived';
  timeZone: string;
  title: string;
};

export type PlanItemChanges = Partial<Omit<PlanItemValues, 'eventId'>>;

export type PlanItemDelivery = 'attention' | 'clean' | 'queued' | 'syncing';

export type PlanItemSnapshot = {
  delivery: PlanItemDelivery;
  id: string;
  placeSnapshotJson: string | null;
  sortKey: string | null;
  values: PlanItemValues;
  version: number | null;
};

export type PlanIssue = {
  attempted: PlanItemValues | null;
  code: 'attention' | 'conflict' | 'deleted' | 'permission';
  current: PlanItemValues | null;
  itemId: string;
  mutationId: string;
};

export type PlanSnapshot = {
  canEdit: boolean;
  events: readonly EventTreeNode[];
  issues: readonly PlanIssue[];
  items: readonly PlanItemSnapshot[];
  places: readonly EventPlaceRecord[];
  role: MembershipRecord['role'];
  syncStatus: SyncStatus;
};

export type PlanRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null | Promise<string | null>;
  client: MobileGatewayClient | null;
  database: SqlDatabase;
  isOnline(): boolean;
};

type PlanOverlay = {
  itemId: string;
  replacementFor: string | null;
  rootEventId: string;
  values: PlanItemValues;
};

const activeStates = new Set<OutboxItem['state']>([
  'awaiting_pull',
  'blocked',
  'pending',
  'sending',
]);
const eventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const itineraryIdPattern = /^iti_[A-Za-z0-9._:-]{1,96}$/;
const placeIdPattern = /^plc_[A-Za-z0-9._:-]{1,96}$/;
const mutationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const saveLocksByDatabase = new WeakMap<SqlDatabase, Map<string, symbol>>();

export class PlanAccountChangedError extends Error {
  constructor() {
    super('Active account changed while editing the plan');
    this.name = 'PlanAccountChangedError';
  }
}

export class PlanManagerRequiredError extends Error {
  constructor() {
    super('Plan changes require an owner or organizer');
    this.name = 'PlanManagerRequiredError';
  }
}

export class PlanUnavailableError extends Error {
  constructor() {
    super('Plan is unavailable');
    this.name = 'PlanUnavailableError';
  }
}

export class PlanOnlineRequiredError extends Error {
  constructor() {
    super('Refreshing the plan requires a connection');
    this.name = 'PlanOnlineRequiredError';
  }
}

export class PlanPendingError extends Error {
  constructor() {
    super('A durable change for this plan item is already pending');
    this.name = 'PlanPendingError';
  }
}

export class PlanValidationError extends Error {
  constructor() {
    super('Plan item values are invalid');
    this.name = 'PlanValidationError';
  }
}

export class PlanRuntime {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: PlanRuntimeOptions['activeAccountUserId'];
  readonly #client: MobileGatewayClient | null;
  readonly #data: MobileDataStore;
  readonly #database: SqlDatabase;
  readonly #isOnline: PlanRuntimeOptions['isOnline'];
  readonly #sync: MobileSyncEngine;

  constructor(options: PlanRuntimeOptions) {
    this.#accountUserId = options.accountUserId;
    this.#activeAccountUserId = options.activeAccountUserId;
    this.#client = options.client;
    this.#database = options.database;
    this.#data = new MobileDataStore(options.database);
    this.#isOnline = options.isOnline;
    const unavailableClient = {
      request: async () => {
        throw new PlanOnlineRequiredError();
      },
    } as unknown as MobileGatewayClient;
    this.#sync = new MobileSyncEngine(
      options.database,
      options.client ?? unavailableClient,
      {
        activeAccountUserId: options.activeAccountUserId,
        assertMutationStreamIdentity: (executor, account, root, device) =>
          secureDeviceIdStore.assertCurrent(executor, account, root, device),
        onRootPurged: accountUserId =>
          reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(options.database),
            accountUserId,
          ),
        onRootReadFinished: (accountUserId, rootEventId, verificationId) =>
          deniedRootRegistry.finish(accountUserId, rootEventId, verificationId),
        onRootReadStarted: (accountUserId, rootEventId) =>
          deniedRootRegistry.arm(accountUserId, rootEventId),
        randomUUID: secureUuidV4,
      },
    );
  }

  async load(rootEventId: string): Promise<PlanSnapshot> {
    await this.#assertActive();
    let outbox = await this.#sync.listOutbox(this.#accountUserId, rootEventId);
    await this.#assertActive();
    outbox = await this.#finishDurableReplacement(rootEventId, outbox);
    const [events, memberships, timeline, places, syncStatus] =
      await Promise.all([
        this.#data.listEventTree(this.#accountUserId, rootEventId),
        this.#data.listMemberships(this.#accountUserId, rootEventId),
        this.#data.listTimeline(this.#accountUserId, rootEventId),
        this.#data.listEventPlaces(this.#accountUserId, rootEventId),
        this.#sync.getStatus(this.#accountUserId, rootEventId),
      ]);
    await this.#assertActive();
    const root = events.find(
      event =>
        event.id === rootEventId &&
        event.rootEventId === rootEventId &&
        event.parentEventId === null &&
        event.deletedAt === null,
    );
    const membership = memberships.find(
      item =>
        item.rootEventId === rootEventId &&
        item.memberUserId === this.#accountUserId &&
        item.status === 'active',
    );
    if (!root || !membership) throw new PlanUnavailableError();

    const canonical = new Map(
      timeline.map(item => [item.id, snapshotFromRecord(item)]),
    );
    const activeByItem = new Map<
      string,
      Array<OutboxItem & { command: ItineraryCommand }>
    >();
    const failures: Array<OutboxItem & { command: ItineraryCommand }> = [];
    for (const item of outbox) {
      if (!itineraryCommand(item)) continue;
      if (activeStates.has(item.state)) {
        const items = activeByItem.get(item.command.entityId) ?? [];
        items.push(item);
        activeByItem.set(item.command.entityId, items);
      } else if (item.state === 'dead_letter') {
        failures.push(item);
      }
    }

    for (const [itemId, pending] of activeByItem) {
      let item = canonical.get(itemId) ?? null;
      for (const outboxItem of pending) {
        item = applyPending(item, outboxItem, rootEventId);
      }
      if (!item) continue;
      item.delivery =
        pending.length > 1 || pending.at(-1)?.state === 'blocked'
          ? 'attention'
          : pending.at(-1)?.state === 'sending'
          ? 'syncing'
          : 'queued';
      canonical.set(itemId, item);
    }

    const issues = failures.map(item =>
      issueFromFailure(item, canonical.get(item.command.entityId) ?? null),
    );
    for (const issue of issues) {
      if (issue.code === 'deleted') canonical.delete(issue.itemId);
    }
    return {
      canEdit: membership.role === 'owner' || membership.role === 'organizer',
      events,
      issues,
      items: [...canonical.values()].sort(comparePlanItems),
      places,
      role: membership.role,
      syncStatus,
    };
  }

  async refresh(rootEventId: string): Promise<PlanSnapshot> {
    if (!this.#client || !this.#isOnline()) {
      throw new PlanOnlineRequiredError();
    }
    await this.#assertActive();
    await this.#sync.syncRoot(this.#accountUserId, rootEventId, {
      force: true,
    });
    await this.#assertActive();
    return this.load(rootEventId);
  }

  async createItem(
    rootEventId: string,
    values: PlanItemValues,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      const normalized = validatePlanItemValues(values);
      const before = await this.load(rootEventId);
      this.#assertManager(before);
      if (!before.events.some(event => event.id === normalized.eventId)) {
        throw new PlanUnavailableError();
      }
      const deviceId = await secureDeviceIdStore.getOrCreate(
        this.#database,
        this.#accountUserId,
        rootEventId,
      );
      await this.#assertActive();
      const itemId = `iti_${secureUuidV4()}`;
      if (!itineraryIdPattern.test(itemId)) throw new PlanUnavailableError();
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        {
          entityId: itemId,
          kind: 'itinerary.create',
          payload: normalized,
        },
        planOverlay(rootEventId, itemId, normalized, null),
      );
      await this.#afterEnqueue(rootEventId);
      return this.load(rootEventId);
    });
  }

  async updateItem(
    rootEventId: string,
    itemId: string,
    changes: PlanItemChanges,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      if (!itineraryIdPattern.test(itemId)) throw new PlanUnavailableError();
      const before = await this.load(rootEventId);
      this.#assertManager(before);
      const current = before.items.find(item => item.id === itemId);
      if (!current || current.version === null) {
        throw new PlanUnavailableError();
      }
      if (current.delivery !== 'clean') throw new PlanPendingError();
      const issue = before.issues.find(item => item.itemId === itemId) ?? null;
      if (issue && issue.code !== 'conflict') throw new PlanPendingError();
      const normalizedChanges = validatePlanItemChanges(
        current.values,
        changes,
      );
      const updated = { ...current.values, ...normalizedChanges };
      if (sameValues(current.values, updated)) {
        if (issue) {
          await this.#sync.discardDeadLetter(
            this.#accountUserId,
            issue.mutationId,
          );
          await this.#assertActive();
        }
        return this.load(rootEventId);
      }
      const deviceId = await secureDeviceIdStore.getOrCreate(
        this.#database,
        this.#accountUserId,
        rootEventId,
      );
      await this.#assertActive();
      const active = (
        await this.#sync.listOutbox(this.#accountUserId, rootEventId)
      ).some(
        item =>
          itineraryCommand(item) &&
          item.command.entityId === itemId &&
          activeStates.has(item.state),
      );
      await this.#assertActive();
      if (active) throw new PlanPendingError();
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        {
          baseVersion: current.version,
          entityId: itemId,
          kind: 'itinerary.update',
          payload: { changes: normalizedChanges },
        },
        planOverlay(rootEventId, itemId, updated, issue?.mutationId ?? null),
      );
      await this.#assertActive();
      if (issue) {
        await this.#sync.discardDeadLetter(
          this.#accountUserId,
          issue.mutationId,
        );
        await this.#assertActive();
      }
      await this.#afterEnqueue(rootEventId);
      return this.load(rootEventId);
    });
  }

  async discardIssue(
    rootEventId: string,
    mutationId: string,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      if (!mutationIdPattern.test(mutationId)) {
        throw new PlanUnavailableError();
      }
      await this.#assertActive();
      const outbox = await this.#sync.listOutbox(
        this.#accountUserId,
        rootEventId,
      );
      await this.#assertActive();
      const item = outbox.find(
        candidate =>
          candidate.clientMutationId === mutationId &&
          candidate.rootEventId === rootEventId &&
          candidate.state === 'dead_letter' &&
          itineraryCommand(candidate),
      );
      if (!item) throw new PlanUnavailableError();
      await this.#sync.discardDeadLetter(this.#accountUserId, mutationId);
      await this.#assertActive();
      return this.load(rootEventId);
    });
  }

  async #afterEnqueue(rootEventId: string) {
    await this.#assertActive();
    if (this.#client && this.#isOnline()) {
      await this.#sync.syncRoot(this.#accountUserId, rootEventId, {
        force: true,
      });
      await this.#assertActive();
    }
  }

  #assertManager(snapshot: PlanSnapshot) {
    if (!snapshot.canEdit) throw new PlanManagerRequiredError();
  }

  async #assertActive(): Promise<void> {
    if ((await this.#activeAccountUserId()) !== this.#accountUserId) {
      throw new PlanAccountChangedError();
    }
  }

  async #finishDurableReplacement(
    rootEventId: string,
    outbox: readonly OutboxItem[],
  ) {
    for (const item of outbox) {
      if (!activeStates.has(item.state) || !itineraryCommand(item)) continue;
      const replacementFor = readPlanOverlay(
        item.optimisticOverlay,
        rootEventId,
        item.command.entityId,
      )?.replacementFor;
      if (
        replacementFor &&
        outbox.some(
          failed =>
            failed.clientMutationId === replacementFor &&
            failed.state === 'dead_letter',
        )
      ) {
        await this.#sync.discardDeadLetter(this.#accountUserId, replacementFor);
        await this.#assertActive();
      }
    }
    return this.#sync.listOutbox(this.#accountUserId, rootEventId);
  }

  async #withSaveLock<T>(
    rootEventId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const release = acquireSaveLock(
      this.#database,
      this.#accountUserId,
      rootEventId,
    );
    try {
      return await action();
    } finally {
      release();
    }
  }
}

function itineraryCommand(
  item: OutboxItem,
): item is OutboxItem & { command: ItineraryCommand } {
  return (
    item.operationId === 'syncMutationsApply' &&
    'kind' in item.command &&
    (item.command.kind === 'itinerary.create' ||
      item.command.kind === 'itinerary.update')
  );
}

function snapshotFromRecord(item: ItineraryRecord): PlanItemSnapshot {
  return {
    delivery: 'clean',
    id: item.id,
    placeSnapshotJson: item.placeSnapshotJson,
    sortKey: item.sortKey,
    values: validatePlanItemValues({
      allDay: item.allDay,
      details: parseDetails(item.detailsJson),
      endsAt: item.endsAt,
      eventId: item.eventId,
      notes: item.notes,
      placeId: item.placeId,
      startsAt: item.startsAt,
      status: item.status,
      timeZone: item.timeZone,
      title: item.title,
    }),
    version: item.version,
  };
}

function applyPending(
  current: PlanItemSnapshot | null,
  item: OutboxItem & { command: ItineraryCommand },
  rootEventId: string,
): PlanItemSnapshot | null {
  const overlay = readPlanOverlay(
    item.optimisticOverlay,
    rootEventId,
    item.command.entityId,
  );
  if (overlay) {
    return {
      delivery: 'queued',
      id: item.command.entityId,
      placeSnapshotJson:
        current?.values.placeId === overlay.values.placeId
          ? current.placeSnapshotJson
          : null,
      sortKey: current?.sortKey ?? null,
      values: overlay.values,
      version: current?.version ?? null,
    };
  }
  if (item.command.kind === 'itinerary.create') {
    return {
      delivery: 'queued',
      id: item.command.entityId,
      placeSnapshotJson: null,
      sortKey: null,
      values: valuesFromCreatePayload(item.command.payload),
      version: null,
    };
  }
  if (!current) return null;
  return {
    ...current,
    values: {
      ...current.values,
      ...validatePlanItemChanges(current.values, item.command.payload.changes),
    },
  };
}

function issueFromFailure(
  item: OutboxItem & { command: ItineraryCommand },
  current: PlanItemSnapshot | null,
): PlanIssue {
  const overlay = readPlanOverlay(
    item.optimisticOverlay,
    item.rootEventId,
    item.command.entityId,
  );
  let attempted = overlay?.values ?? null;
  if (!attempted && item.command.kind === 'itinerary.create') {
    attempted = valuesFromCreatePayload(item.command.payload);
  } else if (
    !attempted &&
    current &&
    item.command.kind === 'itinerary.update'
  ) {
    attempted = {
      ...current.values,
      ...validatePlanItemChanges(current.values, item.command.payload.changes),
    };
  }
  const failure = item.lastError?.code;
  return {
    attempted,
    code:
      failure === 'conflict'
        ? 'conflict'
        : failure === 'deleted'
        ? 'deleted'
        : failure === 'permission' || failure === 'auth_required'
        ? 'permission'
        : 'attention',
    current: failure === 'deleted' ? null : current?.values ?? null,
    itemId: item.command.entityId,
    mutationId: item.clientMutationId,
  };
}

function planOverlay(
  rootEventId: string,
  itemId: string,
  values: PlanItemValues,
  replacementFor: string | null,
) {
  return {
    itemId,
    kind: 'plan.item',
    replacementFor,
    rootEventId,
    schemaVersion: 1,
    values,
  };
}

function readPlanOverlay(
  value: unknown,
  rootEventId: string,
  itemId: string,
): PlanOverlay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const overlay = value as Record<string, unknown>;
  if (
    overlay.schemaVersion !== 1 ||
    overlay.kind !== 'plan.item' ||
    overlay.rootEventId !== rootEventId ||
    overlay.itemId !== itemId ||
    (overlay.replacementFor !== null &&
      (typeof overlay.replacementFor !== 'string' ||
        !mutationIdPattern.test(overlay.replacementFor)))
  ) {
    return null;
  }
  try {
    return {
      itemId,
      replacementFor:
        typeof overlay.replacementFor === 'string'
          ? overlay.replacementFor
          : null,
      rootEventId,
      values: validatePlanItemValues(overlay.values as PlanItemValues),
    };
  } catch {
    return null;
  }
}

function acquireSaveLock(
  database: SqlDatabase,
  accountUserId: string,
  rootEventId: string,
) {
  let locks = saveLocksByDatabase.get(database);
  if (!locks) {
    locks = new Map();
    saveLocksByDatabase.set(database, locks);
  }
  const key = `${accountUserId}:${rootEventId}`;
  if (locks.has(key)) throw new PlanPendingError();
  const token = Symbol(key);
  locks.set(key, token);
  return () => {
    if (locks?.get(key) === token) locks.delete(key);
  };
}

export function validatePlanItemValues(values: PlanItemValues): PlanItemValues {
  if (!values || typeof values !== 'object') throw new PlanValidationError();
  const title = requiredString(values.title, 200, true);
  const notes = nullableString(values.notes, 20_000);
  if (!eventIdPattern.test(values.eventId)) throw new PlanValidationError();
  if (!isIanaTimeZone(values.timeZone)) throw new PlanValidationError();
  const startsAt = validInstant(values.startsAt);
  const endsAt = validInstant(values.endsAt);
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new PlanValidationError();
  }
  if (typeof values.allDay !== 'boolean') throw new PlanValidationError();
  if (!['active', 'cancelled', 'archived'].includes(values.status)) {
    throw new PlanValidationError();
  }
  if (values.placeId !== null && !placeIdPattern.test(values.placeId)) {
    throw new PlanValidationError();
  }
  return {
    allDay: values.allDay,
    details: normalizeDetails(values.details),
    endsAt,
    eventId: values.eventId,
    notes,
    placeId: values.placeId,
    startsAt,
    status: values.status,
    timeZone: values.timeZone,
    title,
  };
}

function validatePlanItemChanges(
  current: PlanItemValues,
  changes: PlanItemChanges,
): PlanItemChanges {
  if (
    !changes ||
    typeof changes !== 'object' ||
    Array.isArray(changes) ||
    Object.keys(changes).length === 0
  ) {
    throw new PlanValidationError();
  }
  const allowed = new Set([
    'allDay',
    'details',
    'endsAt',
    'notes',
    'placeId',
    'startsAt',
    'status',
    'timeZone',
    'title',
  ]);
  if (Object.keys(changes).some(key => !allowed.has(key))) {
    throw new PlanValidationError();
  }
  const merged = validatePlanItemValues({ ...current, ...changes });
  return Object.fromEntries(
    Object.keys(changes).map(key => [key, merged[key as keyof PlanItemValues]]),
  ) as PlanItemChanges;
}

function parseDetails(value: string): PlanItemDetails {
  try {
    return normalizeDetails(JSON.parse(value));
  } catch {
    throw new PlanUnavailableError();
  }
}

function normalizeDetails(value: unknown): PlanItemDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlanValidationError();
  }
  const details = value as Record<string, unknown>;
  if (details.schemaVersion !== 1 || typeof details.type !== 'string') {
    throw new PlanValidationError();
  }
  switch (details.type) {
    case 'note':
      return { schemaVersion: 1, type: 'note' };
    case 'activity':
      return withOptional(
        { schemaVersion: 1, type: 'activity' },
        'bookingReference',
        details.bookingReference,
        300,
      );
    case 'flight':
      return withOptional(
        {
          destinationPlaceId: requiredPlaceId(details.destinationPlaceId),
          originPlaceId: requiredPlaceId(details.originPlaceId),
          schemaVersion: 1,
          type: 'flight',
        },
        'flightDesignator',
        details.flightDesignator,
        20,
      );
    case 'rail':
      return withOptional(
        {
          destinationPlaceId: requiredPlaceId(details.destinationPlaceId),
          originPlaceId: requiredPlaceId(details.originPlaceId),
          schemaVersion: 1,
          type: 'rail',
        },
        'serviceDesignator',
        details.serviceDesignator,
        50,
      );
    case 'road_transfer':
      return withOptional(
        {
          destinationPlaceId: requiredPlaceId(details.destinationPlaceId),
          originPlaceId: requiredPlaceId(details.originPlaceId),
          schemaVersion: 1,
          type: 'road_transfer',
        },
        'pickupInstructions',
        details.pickupInstructions,
        1000,
      );
    case 'lodging': {
      const checkInAt = validRequiredInstant(details.checkInAt);
      const checkOutAt = validRequiredInstant(details.checkOutAt);
      if (Date.parse(checkInAt) >= Date.parse(checkOutAt)) {
        throw new PlanValidationError();
      }
      return {
        checkInAt,
        checkOutAt,
        propertyName: requiredString(details.propertyName, 200),
        schemaVersion: 1,
        type: 'lodging',
      };
    }
    case 'meal':
      return withOptional(
        { schemaVersion: 1, type: 'meal' },
        'reservationNote',
        details.reservationNote,
        1000,
      );
    case 'golf_round':
      return {
        roundReference: requiredString(details.roundReference, 120),
        schemaVersion: 1,
        teeTime: validRequiredInstant(details.teeTime),
        type: 'golf_round',
      };
    case 'session': {
      const result = withOptional(
        { schemaVersion: 1, type: 'session' },
        'room',
        details.room,
        120,
      );
      if (details.descendantEventId === undefined) return result;
      if (
        typeof details.descendantEventId !== 'string' ||
        !eventIdPattern.test(details.descendantEventId)
      ) {
        throw new PlanValidationError();
      }
      return { ...result, descendantEventId: details.descendantEventId };
    }
    default:
      throw new PlanValidationError();
  }
}

function withOptional<Base extends PlanItemDetails, Key extends string>(
  base: Base,
  key: Key,
  value: unknown,
  maxLength: number,
): Base & Partial<Record<Key, string>> {
  if (value === undefined) {
    return base as Base & Partial<Record<Key, string>>;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new PlanValidationError();
  }
  return { ...base, [key]: value } as Base & Partial<Record<Key, string>>;
}

function valuesFromCreatePayload(
  payload: ItineraryCreate['payload'],
): PlanItemValues {
  return validatePlanItemValues({
    allDay: payload.allDay ?? false,
    details: payload.details,
    endsAt: payload.endsAt ?? null,
    eventId: payload.eventId,
    notes: payload.notes ?? null,
    placeId: payload.placeId ?? null,
    startsAt: payload.startsAt ?? null,
    status: payload.status ?? 'active',
    timeZone: payload.timeZone,
    title: payload.title,
  });
}

function requiredString(value: unknown, max: number, trim = false) {
  if (typeof value !== 'string') throw new PlanValidationError();
  const normalized = trim ? value.trim() : value;
  if (!normalized || normalized.length > max) throw new PlanValidationError();
  return normalized;
}

function nullableString(value: unknown, max: number) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) {
    throw new PlanValidationError();
  }
  return value;
}

function requiredPlaceId(value: unknown) {
  if (typeof value !== 'string' || !placeIdPattern.test(value)) {
    throw new PlanValidationError();
  }
  return value;
}

function validInstant(value: unknown): string | null {
  if (value === null) return null;
  return validRequiredInstant(value);
}

function validRequiredInstant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new PlanValidationError();
  }
  return new Date(value).toISOString();
}

function isIanaTimeZone(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function sameValues(left: PlanItemValues, right: PlanItemValues) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparePlanItems(left: PlanItemSnapshot, right: PlanItemSnapshot) {
  if (left.values.startsAt !== right.values.startsAt) {
    if (left.values.startsAt === null) return 1;
    if (right.values.startsAt === null) return -1;
    return left.values.startsAt.localeCompare(right.values.startsAt);
  }
  if (left.sortKey !== right.sortKey) {
    if (left.sortKey === null) return 1;
    if (right.sortKey === null) return -1;
    return (
      left.sortKey.length - right.sortKey.length ||
      left.sortKey.localeCompare(right.sortKey)
    );
  }
  return left.id.localeCompare(right.id);
}
