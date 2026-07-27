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
type EventCreate = Extract<SyncMutation, { kind: 'event.create' }>;
type EventChildrenReorder = Extract<
  SyncMutation,
  { kind: 'event.children.reorder' }
>;
type ItineraryReorder = Extract<
  SyncMutation,
  { kind: 'itinerary.reorder' }
>;
type ItineraryUpdate = Extract<SyncMutation, { kind: 'itinerary.update' }>;
type ItineraryCommand = ItineraryCreate | ItineraryUpdate;
type PlanOrderCommand = EventChildrenReorder | ItineraryReorder;

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

export type PlanChildEventValues = {
  description: string | null;
  endsAt: string | null;
  kind: EventCreate['payload']['kind'];
  startsAt: string | null;
  status: NonNullable<EventCreate['payload']['status']>;
  timeZone: string;
  title: string;
};

export type PlanMoveDirection = 'down' | 'up';

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
  eventAttempted?: PlanChildEventValues & { parentEventId: string };
  itemId: string;
  mutationId: string;
  orderAttempted?: {
    entityId: string;
    kind: PlanOrderOverlay['kind'];
    orderedIds: readonly string[];
  };
  resolution: 'discard' | 'retry';
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

type PlanEventOverlay = {
  eventId: string;
  parentEventId: string;
  rootEventId: string;
  values: PlanChildEventValues;
};

type PlanOrderOverlay = {
  entityId: string;
  kind: 'plan.event-order' | 'plan.itinerary-order';
  orderedIds: readonly string[];
  replacementFor: string | null;
  rootEventId: string;
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
    const [eventRecords, memberships, timeline, places, syncStatus] =
      await Promise.all([
        this.#data.listEventTree(this.#accountUserId, rootEventId),
        this.#data.listMemberships(this.#accountUserId, rootEventId),
        this.#data.listTimeline(this.#accountUserId, rootEventId),
        this.#data.listEventPlaces(this.#accountUserId, rootEventId),
        this.#sync.getStatus(this.#accountUserId, rootEventId),
      ]);
    await this.#assertActive();
    const root = eventRecords.find(
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

    let events = [...eventRecords];
    const canonical = new Map(
      timeline.map(item => [item.id, snapshotFromRecord(item)]),
    );
    const activeByItem = new Map<
      string,
      Array<OutboxItem & { command: ItineraryCommand }>
    >();
    const failures: Array<OutboxItem & { command: ItineraryCommand }> = [];
    const eventCreates: Array<OutboxItem & { command: EventCreate }> = [];
    const eventFailures: Array<OutboxItem & { command: EventCreate }> = [];
    const eventOrders: Array<OutboxItem & { command: EventChildrenReorder }> =
      [];
    const eventOrderFailures: Array<
      OutboxItem & { command: EventChildrenReorder }
    > = [];
    const itineraryOrders: Array<
      OutboxItem & { command: ItineraryReorder }
    > = [];
    const itineraryOrderFailures: Array<
      OutboxItem & { command: ItineraryReorder }
    > = [];
    for (const item of outbox) {
      if (eventCreateCommand(item)) {
        if (activeStates.has(item.state)) {
          eventCreates.push(item);
        } else if (item.state === 'dead_letter') {
          eventCreates.push(item);
          eventFailures.push(item);
        }
        continue;
      }
      if (eventChildrenReorderCommand(item)) {
        if (activeStates.has(item.state)) eventOrders.push(item);
        else if (item.state === 'dead_letter') eventOrderFailures.push(item);
        continue;
      }
      if (itineraryReorderCommand(item)) {
        if (activeStates.has(item.state)) itineraryOrders.push(item);
        else if (item.state === 'dead_letter') {
          itineraryOrderFailures.push(item);
        }
        continue;
      }
      if (!itineraryCommand(item)) continue;
      if (activeStates.has(item.state)) {
        const items = activeByItem.get(item.command.entityId) ?? [];
        items.push(item);
        activeByItem.set(item.command.entityId, items);
      } else if (item.state === 'dead_letter') {
        failures.push(item);
      }
    }

    for (const item of eventCreates) {
      if (events.some(event => event.id === item.command.entityId)) continue;
      const parent = events.find(
        event => event.id === item.command.payload.parentEventId,
      );
      if (!parent) continue;
      const overlay = readPlanEventOverlay(
        item.optimisticOverlay,
        rootEventId,
        item.command.entityId,
      );
      const values =
        overlay?.values ??
        validateChildEventValues({
          description: item.command.payload.description ?? null,
          endsAt: item.command.payload.endsAt ?? null,
          kind: item.command.payload.kind,
          startsAt: item.command.payload.startsAt ?? null,
          status: item.command.payload.status ?? 'draft',
          timeZone: item.command.payload.timeZone,
          title: item.command.payload.title,
        });
      const now = item.createdAt;
      events.push({
        accountUserId: this.#accountUserId,
        childOrderVersion: '0',
        createdAt: now,
        deletedAt: null,
        depth: parent.depth + 1,
        description: values.description,
        endsAt: values.endsAt,
        id: item.command.entityId,
        itineraryOrderVersion: '0',
        kind: values.kind,
        parentEventId: parent.id,
        rootEventId,
        sortKey: `~${String(item.clientSequence).padStart(12, '0')}`,
        startsAt: values.startsAt,
        status: values.status,
        timeZone: values.timeZone,
        title: values.title,
        updatedAt: now,
        version: 0,
      });
    }
    events = flattenEventTree(events);

    for (const item of eventOrders) {
      const overlay = readPlanOrderOverlay(
        item.optimisticOverlay,
        rootEventId,
        item.command.entityId,
        'plan.event-order',
      );
      if (overlay) events = reorderEventTree(events, overlay);
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

    const issues = [
      ...failures.map(item =>
        issueFromFailure(item, canonical.get(item.command.entityId) ?? null),
      ),
      ...eventFailures.map(eventIssueFromFailure),
      ...eventOrderFailures.map(item =>
        orderIssueFromFailure(item, 'plan.event-order'),
      ),
      ...itineraryOrderFailures.map(item =>
        orderIssueFromFailure(item, 'plan.itinerary-order'),
      ),
    ];
    for (const issue of issues) {
      if (issue.code === 'deleted') canonical.delete(issue.itemId);
    }
    for (const item of itineraryOrders) {
      const overlay = readPlanOrderOverlay(
        item.optimisticOverlay,
        rootEventId,
        item.command.entityId,
        'plan.itinerary-order',
      );
      if (!overlay) continue;
      overlay.orderedIds.forEach((itemId, index) => {
        const current = canonical.get(itemId);
        if (current?.values.eventId === item.command.entityId) {
          canonical.set(itemId, {
            ...current,
            sortKey: String(index + 1).padStart(12, '0'),
          });
        }
      });
    }
    const eventIds = new Set(events.map(event => event.id));
    for (const [itemId, item] of canonical) {
      if (!eventIds.has(item.values.eventId)) canonical.delete(itemId);
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
      const event = before.events.find(
        candidate => candidate.id === normalized.eventId,
      );
      if (!event) throw new PlanUnavailableError();
      if (event.version === 0) throw new PlanPendingError();
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

  async createChildEvent(
    rootEventId: string,
    parentEventId: string,
    values: PlanChildEventValues,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      if (!eventIdPattern.test(parentEventId)) throw new PlanUnavailableError();
      const normalized = validateChildEventValues(values);
      const before = await this.load(rootEventId);
      this.#assertManager(before);
      const parent = before.events.find(event => event.id === parentEventId);
      if (!parent) throw new PlanUnavailableError();
      if (parent.version === 0) throw new PlanPendingError();
      const deviceId = await secureDeviceIdStore.getOrCreate(
        this.#database,
        this.#accountUserId,
        rootEventId,
      );
      await this.#assertActive();
      const eventId = `evt_${secureUuidV4()}`;
      if (!eventIdPattern.test(eventId)) throw new PlanUnavailableError();
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        {
          entityId: eventId,
          kind: 'event.create',
          payload: { parentEventId, ...normalized },
        },
        planEventOverlay(rootEventId, eventId, parentEventId, normalized),
      );
      await this.#afterEnqueue(rootEventId);
      return this.load(rootEventId);
    });
  }

  async moveChildEvent(
    rootEventId: string,
    eventId: string,
    direction: PlanMoveDirection,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      if (!eventIdPattern.test(eventId)) throw new PlanUnavailableError();
      const before = await this.load(rootEventId);
      this.#assertManager(before);
      const event = before.events.find(candidate => candidate.id === eventId);
      if (!event?.parentEventId) throw new PlanUnavailableError();
      const parent = before.events.find(
        candidate => candidate.id === event.parentEventId,
      );
      if (!parent) throw new PlanUnavailableError();
      const siblings = before.events.filter(
        candidate => candidate.parentEventId === event.parentEventId,
      );
      if (siblings.some(candidate => candidate.version === 0)) {
        throw new PlanPendingError();
      }
      const orderedIds = movedIds(siblings, eventId, direction);
      if (!orderedIds) return before;
      await this.#enqueueOrder(
        rootEventId,
        parent.id,
        versionFromString(parent.childOrderVersion),
        'event.children.reorder',
        orderedIds,
        'plan.event-order',
      );
      return this.load(rootEventId);
    });
  }

  async moveItineraryItem(
    rootEventId: string,
    itemId: string,
    direction: PlanMoveDirection,
  ): Promise<PlanSnapshot> {
    return this.#withSaveLock(rootEventId, async () => {
      if (!itineraryIdPattern.test(itemId)) throw new PlanUnavailableError();
      const before = await this.load(rootEventId);
      this.#assertManager(before);
      const item = before.items.find(candidate => candidate.id === itemId);
      if (!item || item.delivery !== 'clean' || item.version === null) {
        throw new PlanPendingError();
      }
      const event = before.events.find(
        candidate => candidate.id === item.values.eventId,
      );
      if (!event || event.version === 0) throw new PlanPendingError();
      const siblings = before.items
        .filter(candidate => candidate.values.eventId === event.id)
        .sort(compareItineraryOrder);
      if (
        siblings.some(
          candidate =>
            candidate.delivery !== 'clean' || candidate.version === null,
        )
      ) {
        throw new PlanPendingError();
      }
      const orderedIds = movedIds(siblings, itemId, direction);
      if (!orderedIds) return before;
      await this.#enqueueOrder(
        rootEventId,
        event.id,
        versionFromString(event.itineraryOrderVersion),
        'itinerary.reorder',
        orderedIds,
        'plan.itinerary-order',
      );
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
          candidate.serverConsumed &&
          (itineraryCommand(candidate) ||
            eventCreateCommand(candidate) ||
            eventChildrenReorderCommand(candidate) ||
            itineraryReorderCommand(candidate)),
      );
      if (!item) throw new PlanUnavailableError();
      await this.#sync.discardDeadLetter(this.#accountUserId, mutationId);
      await this.#assertActive();
      return this.load(rootEventId);
    });
  }

  async retryIssue(
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
          !candidate.serverConsumed &&
          candidate.lastError?.code === 'retry_exhausted' &&
          (itineraryCommand(candidate) ||
            eventCreateCommand(candidate) ||
            eventChildrenReorderCommand(candidate) ||
            itineraryReorderCommand(candidate)),
      );
      if (!item) throw new PlanUnavailableError();
      await this.#sync.retryExhausted(this.#accountUserId, rootEventId);
      await this.#assertActive();
      await this.#afterEnqueue(rootEventId);
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

  async #enqueueOrder(
    rootEventId: string,
    entityId: string,
    baseVersion: number,
    kind: PlanOrderCommand['kind'],
    orderedIds: readonly string[],
    overlayKind: PlanOrderOverlay['kind'],
  ) {
    const outbox = await this.#sync.listOutbox(
      this.#accountUserId,
      rootEventId,
    );
    const active = outbox.some(
      item =>
        activeStates.has(item.state) &&
        ((kind === 'event.children.reorder' &&
          eventChildrenReorderCommand(item)) ||
          (kind === 'itinerary.reorder' && itineraryReorderCommand(item))) &&
        item.command.entityId === entityId,
    );
    await this.#assertActive();
    if (active) throw new PlanPendingError();
    const failed = outbox.find(
      item =>
        item.state === 'dead_letter' &&
        ((kind === 'event.children.reorder' &&
          eventChildrenReorderCommand(item)) ||
          (kind === 'itinerary.reorder' && itineraryReorderCommand(item))) &&
        item.command.entityId === entityId,
    );
    if (failed && !failed.serverConsumed) throw new PlanPendingError();
    const deviceId = await secureDeviceIdStore.getOrCreate(
      this.#database,
      this.#accountUserId,
      rootEventId,
    );
    await this.#assertActive();
    if (kind === 'event.children.reorder') {
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        {
          baseVersion,
          entityId,
          kind,
          payload: { orderedIds: [...orderedIds] },
        },
        planOrderOverlay(
          rootEventId,
          entityId,
          orderedIds,
          overlayKind,
          failed?.clientMutationId ?? null,
        ),
      );
    } else {
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        {
          baseVersion,
          entityId,
          kind,
          payload: { orderedIds: [...orderedIds] },
        },
        planOrderOverlay(
          rootEventId,
          entityId,
          orderedIds,
          overlayKind,
          failed?.clientMutationId ?? null,
        ),
      );
    }
    await this.#afterEnqueue(rootEventId);
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
      if (!activeStates.has(item.state)) continue;
      const replacementFor = itineraryCommand(item)
        ? readPlanOverlay(
            item.optimisticOverlay,
            rootEventId,
            item.command.entityId,
          )?.replacementFor
        : eventChildrenReorderCommand(item)
        ? readPlanOrderOverlay(
            item.optimisticOverlay,
            rootEventId,
            item.command.entityId,
            'plan.event-order',
          )?.replacementFor
        : itineraryReorderCommand(item)
        ? readPlanOrderOverlay(
            item.optimisticOverlay,
            rootEventId,
            item.command.entityId,
            'plan.itinerary-order',
          )?.replacementFor
        : null;
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

function eventCreateCommand(
  item: OutboxItem,
): item is OutboxItem & { command: EventCreate } {
  return (
    item.operationId === 'syncMutationsApply' &&
    'kind' in item.command &&
    item.command.kind === 'event.create'
  );
}

function eventChildrenReorderCommand(
  item: OutboxItem,
): item is OutboxItem & { command: EventChildrenReorder } {
  return (
    item.operationId === 'syncMutationsApply' &&
    'kind' in item.command &&
    item.command.kind === 'event.children.reorder'
  );
}

function itineraryReorderCommand(
  item: OutboxItem,
): item is OutboxItem & { command: ItineraryReorder } {
  return (
    item.operationId === 'syncMutationsApply' &&
    'kind' in item.command &&
    item.command.kind === 'itinerary.reorder'
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
    code: issueCode(failure),
    current: failure === 'deleted' ? null : current?.values ?? null,
    itemId: item.command.entityId,
    mutationId: item.clientMutationId,
    resolution: item.serverConsumed ? 'discard' : 'retry',
  };
}

function eventIssueFromFailure(
  item: OutboxItem & { command: EventCreate },
): PlanIssue {
  const overlay = readPlanEventOverlay(
    item.optimisticOverlay,
    item.rootEventId,
    item.command.entityId,
  );
  const eventAttempted = overlay
    ? { parentEventId: overlay.parentEventId, ...overlay.values }
    : {
        parentEventId: item.command.payload.parentEventId,
        ...validateChildEventValues({
          description: item.command.payload.description ?? null,
          endsAt: item.command.payload.endsAt ?? null,
          kind: item.command.payload.kind,
          startsAt: item.command.payload.startsAt ?? null,
          status: item.command.payload.status ?? 'draft',
          timeZone: item.command.payload.timeZone,
          title: item.command.payload.title,
        }),
      };
  return {
    attempted: null,
    code: issueCode(item.lastError?.code),
    current: null,
    eventAttempted,
    itemId: item.command.entityId,
    mutationId: item.clientMutationId,
    resolution: item.serverConsumed ? 'discard' : 'retry',
  };
}

function orderIssueFromFailure(
  item: OutboxItem & { command: PlanOrderCommand },
  kind: PlanOrderOverlay['kind'],
): PlanIssue {
  return {
    attempted: null,
    code: issueCode(item.lastError?.code),
    current: null,
    itemId: item.command.entityId,
    mutationId: item.clientMutationId,
    orderAttempted: {
      entityId: item.command.entityId,
      kind,
      orderedIds: [...item.command.payload.orderedIds],
    },
    resolution: item.serverConsumed ? 'discard' : 'retry',
  };
}

function issueCode(failure: string | undefined): PlanIssue['code'] {
  if (failure === 'conflict') return 'conflict';
  if (failure === 'deleted') return 'deleted';
  if (failure === 'permission' || failure === 'auth_required') {
    return 'permission';
  }
  return 'attention';
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

function planEventOverlay(
  rootEventId: string,
  eventId: string,
  parentEventId: string,
  values: PlanChildEventValues,
) {
  return {
    eventId,
    kind: 'plan.event',
    parentEventId,
    rootEventId,
    schemaVersion: 1,
    values,
  };
}

function planOrderOverlay(
  rootEventId: string,
  entityId: string,
  orderedIds: readonly string[],
  kind: PlanOrderOverlay['kind'],
  replacementFor: string | null,
) {
  return {
    entityId,
    kind,
    orderedIds: [...orderedIds],
    replacementFor,
    rootEventId,
    schemaVersion: 1,
  };
}

function readPlanEventOverlay(
  value: unknown,
  rootEventId: string,
  eventId: string,
): PlanEventOverlay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const overlay = value as Record<string, unknown>;
  if (
    overlay.schemaVersion !== 1 ||
    overlay.kind !== 'plan.event' ||
    overlay.rootEventId !== rootEventId ||
    overlay.eventId !== eventId ||
    typeof overlay.parentEventId !== 'string' ||
    !eventIdPattern.test(overlay.parentEventId)
  ) {
    return null;
  }
  try {
    return {
      eventId,
      parentEventId: overlay.parentEventId,
      rootEventId,
      values: validateChildEventValues(
        overlay.values as PlanChildEventValues,
      ),
    };
  } catch {
    return null;
  }
}

function readPlanOrderOverlay(
  value: unknown,
  rootEventId: string,
  entityId: string,
  kind: PlanOrderOverlay['kind'],
): PlanOrderOverlay | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const overlay = value as Record<string, unknown>;
  if (
    overlay.schemaVersion !== 1 ||
    overlay.kind !== kind ||
    overlay.rootEventId !== rootEventId ||
    overlay.entityId !== entityId ||
    !Array.isArray(overlay.orderedIds) ||
    overlay.orderedIds.length === 0 ||
    !overlay.orderedIds.every(id => typeof id === 'string') ||
    new Set(overlay.orderedIds).size !== overlay.orderedIds.length ||
    (overlay.replacementFor !== undefined &&
      overlay.replacementFor !== null &&
      (typeof overlay.replacementFor !== 'string' ||
        !mutationIdPattern.test(overlay.replacementFor)))
  ) {
    return null;
  }
  return {
    entityId,
    kind,
    orderedIds: overlay.orderedIds as string[],
    replacementFor:
      typeof overlay.replacementFor === 'string'
        ? overlay.replacementFor
        : null,
    rootEventId,
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

export function validateChildEventValues(
  values: PlanChildEventValues,
): PlanChildEventValues {
  if (!values || typeof values !== 'object') throw new PlanValidationError();
  if (
    ![
      'trip',
      'day',
      'golf',
      'team_event',
      'session',
      'activity',
      'other',
    ].includes(values.kind)
  ) {
    throw new PlanValidationError();
  }
  const startsAt = validInstant(values.startsAt);
  const endsAt = validInstant(values.endsAt);
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new PlanValidationError();
  }
  if (
    !['draft', 'published', 'cancelled', 'archived'].includes(values.status)
  ) {
    throw new PlanValidationError();
  }
  if (!isIanaTimeZone(values.timeZone)) throw new PlanValidationError();
  return {
    description: nullableString(values.description, 20_000),
    endsAt,
    kind: values.kind,
    startsAt,
    status: values.status,
    timeZone: values.timeZone,
    title: requiredString(values.title, 160, true),
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

function compareItineraryOrder(
  left: PlanItemSnapshot,
  right: PlanItemSnapshot,
) {
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

function movedIds<Item extends { id: string }>(
  items: readonly Item[],
  itemId: string,
  direction: PlanMoveDirection,
): string[] | null {
  const index = items.findIndex(item => item.id === itemId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= items.length) return null;
  const orderedIds = items.map(item => item.id);
  [orderedIds[index], orderedIds[target]] = [
    orderedIds[target]!,
    orderedIds[index]!,
  ];
  return orderedIds;
}

function versionFromString(value: string) {
  if (!/^[1-9]\d*$/.test(value)) throw new PlanUnavailableError();
  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new PlanUnavailableError();
  }
  return version;
}

function reorderEventTree(
  events: readonly EventTreeNode[],
  overlay: PlanOrderOverlay,
) {
  const children = new Map<string | null, EventTreeNode[]>();
  for (const event of events) {
    const siblings = children.get(event.parentEventId) ?? [];
    siblings.push(event);
    children.set(event.parentEventId, siblings);
  }
  const siblings = children.get(overlay.entityId);
  if (
    siblings &&
    siblings.length === overlay.orderedIds.length &&
    siblings.every(event => overlay.orderedIds.includes(event.id))
  ) {
    const byId = new Map(siblings.map(event => [event.id, event]));
    children.set(
      overlay.entityId,
      overlay.orderedIds.map(id => byId.get(id)!),
    );
  }
  return flattenEventTree(events, children);
}

function flattenEventTree(
  events: readonly EventTreeNode[],
  childrenOverride?: ReadonlyMap<string | null, readonly EventTreeNode[]>,
) {
  const children =
    childrenOverride ??
    new Map<string | null, EventTreeNode[]>(
      [...new Set(events.map(event => event.parentEventId))].map(parentId => [
        parentId,
        events.filter(event => event.parentEventId === parentId),
      ]),
    );
  const ordered: EventTreeNode[] = [];
  const visit = (event: EventTreeNode) => {
    ordered.push(event);
    for (const child of children.get(event.id) ?? []) visit(child);
  };
  for (const root of children.get(null) ?? []) visit(root);
  return ordered.length === events.length ? ordered : [...events];
}
