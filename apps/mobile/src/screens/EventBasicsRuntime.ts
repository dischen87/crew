import {
  LocalAttachmentStore,
  MobileDataStore,
  MobileSyncEngine,
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

export type EventBasicsValues = {
  description: string | null;
  endsAt: string | null;
  startsAt: string | null;
  timeZone: string;
  title: string;
};

export type EventBasicsDelivery =
  | 'attention'
  | 'clean'
  | 'conflict'
  | 'queued'
  | 'syncing';

export type EventBasicsSnapshot = {
  conflict: {
    attempted: EventBasicsValues;
    current: EventBasicsValues;
  } | null;
  current: EventBasicsValues;
  delivery: EventBasicsDelivery;
  draft: EventBasicsValues;
  role: 'organizer' | 'owner';
  syncStatus: SyncStatus;
  version: number;
};

export type EventBasicsRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null | Promise<string | null>;
  client: MobileGatewayClient | null;
  database: SqlDatabase;
  isOnline(): boolean;
};

type RootEventUpdate = Extract<SyncMutation, { kind: 'event.update' }>;

const saveLocksByDatabase = new WeakMap<SqlDatabase, Map<string, symbol>>();

export class EventBasicsAccountChangedError extends Error {
  constructor() {
    super('Active account changed while editing event basics');
    this.name = 'EventBasicsAccountChangedError';
  }
}

export class EventBasicsManagerRequiredError extends Error {
  constructor() {
    super('Event basics require an owner or organizer');
    this.name = 'EventBasicsManagerRequiredError';
  }
}

export class EventBasicsUnavailableError extends Error {
  constructor() {
    super('Event basics are unavailable');
    this.name = 'EventBasicsUnavailableError';
  }
}

export class EventBasicsOnlineRequiredError extends Error {
  constructor() {
    super('Refreshing event basics requires a connection');
    this.name = 'EventBasicsOnlineRequiredError';
  }
}

export class EventBasicsPendingError extends Error {
  constructor() {
    super('A durable event basics change is already pending');
    this.name = 'EventBasicsPendingError';
  }
}

export class EventBasicsRuntime {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: EventBasicsRuntimeOptions['activeAccountUserId'];
  readonly #client: MobileGatewayClient | null;
  readonly #data: MobileDataStore;
  readonly #database: SqlDatabase;
  readonly #isOnline: EventBasicsRuntimeOptions['isOnline'];
  readonly #sync: MobileSyncEngine;

  constructor(options: EventBasicsRuntimeOptions) {
    this.#accountUserId = options.accountUserId;
    this.#activeAccountUserId = options.activeAccountUserId;
    this.#client = options.client;
    this.#database = options.database;
    this.#data = new MobileDataStore(options.database);
    this.#isOnline = options.isOnline;
    const unavailableClient = {
      request: async () => {
        throw new EventBasicsOnlineRequiredError();
      },
    } as unknown as MobileGatewayClient;
    this.#sync = new MobileSyncEngine(
      options.database,
      options.client ?? unavailableClient,
      {
        activeAccountUserId: options.activeAccountUserId,
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

  async load(rootEventId: string): Promise<EventBasicsSnapshot> {
    await this.#assertActive();
    let outbox = await this.#sync.listOutbox(this.#accountUserId, rootEventId);
    await this.#assertActive();
    outbox = await this.#finishDurableConflictReplacement(rootEventId, outbox);
    const [events, memberships, syncStatus] = await Promise.all([
      this.#data.listEventTree(this.#accountUserId, rootEventId),
      this.#data.listMemberships(this.#accountUserId, rootEventId),
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
    if (!root || root.status !== 'draft') {
      throw new EventBasicsUnavailableError();
    }
    const membership = memberships.find(
      item =>
        item.rootEventId === rootEventId &&
        item.memberUserId === this.#accountUserId &&
        item.status === 'active',
    );
    if (!membership) throw new EventBasicsUnavailableError();
    if (membership.role !== 'owner' && membership.role !== 'organizer') {
      throw new EventBasicsManagerRequiredError();
    }

    const current = eventValues(root);
    const updates = outbox.filter(item => rootUpdate(item, rootEventId));
    const active = updates.filter(item =>
      ['awaiting_pull', 'blocked', 'pending', 'sending'].includes(item.state),
    );
    const failed = updates.filter(item => item.state === 'dead_letter').at(-1);
    const pending = active.at(-1);
    if (pending && rootUpdate(pending, rootEventId)) {
      const draft = active.reduce((values, item) => {
        if (!rootUpdate(item, rootEventId)) return values;
        const overlay = eventBasicsOverlay(item.optimisticOverlay, rootEventId);
        return (
          overlay?.values ?? applyChanges(values, item.command.payload.changes)
        );
      }, current);
      return {
        conflict: null,
        current,
        delivery:
          active.length > 1 || pending.state === 'blocked'
            ? 'attention'
            : pending.state === 'sending'
            ? 'syncing'
            : 'queued',
        draft,
        role: membership.role,
        syncStatus,
        version: root.version,
      };
    }
    if (failed && rootUpdate(failed, rootEventId)) {
      const attempted = applyChanges(current, failed.command.payload.changes);
      const conflict = failed.lastError?.code === 'conflict';
      return {
        conflict: conflict ? { attempted, current } : null,
        current,
        delivery: conflict ? 'conflict' : 'attention',
        draft: attempted,
        role: membership.role,
        syncStatus,
        version: root.version,
      };
    }
    return {
      conflict: null,
      current,
      delivery: 'clean',
      draft: current,
      role: membership.role,
      syncStatus,
      version: root.version,
    };
  }

  async refresh(rootEventId: string): Promise<EventBasicsSnapshot> {
    if (!this.#client || !this.#isOnline()) {
      throw new EventBasicsOnlineRequiredError();
    }
    await this.#assertActive();
    await this.#sync.syncRoot(this.#accountUserId, rootEventId, {
      force: true,
    });
    await this.#assertActive();
    return this.load(rootEventId);
  }

  async save(
    rootEventId: string,
    values: EventBasicsValues,
  ): Promise<EventBasicsSnapshot> {
    const releaseSaveLock = acquireSaveLock(
      this.#database,
      this.#accountUserId,
      rootEventId,
    );
    try {
      const normalized = validateEventBasicsValues(values);
      const before = await this.load(rootEventId);
      if (
        before.delivery === 'attention' ||
        before.delivery === 'queued' ||
        before.delivery === 'syncing'
      ) {
        throw new EventBasicsPendingError();
      }
      if (sameValues(before.current, normalized) && !before.conflict) {
        return before;
      }
      await this.#assertActive();
      const deviceId = await secureDeviceIdStore.getOrCreate();
      await this.#assertActive();
      const outbox = await this.#sync.listOutbox(
        this.#accountUserId,
        rootEventId,
      );
      await this.#assertActive();
      if (
        outbox.some(
          item =>
            activeUpdateState(item.state) && rootUpdate(item, rootEventId),
        )
      ) {
        throw new EventBasicsPendingError();
      }
      const failed = outbox
        .filter(
          item => item.state === 'dead_letter' && rootUpdate(item, rootEventId),
        )
        .at(-1);
      if (before.conflict) {
        if (!failed) throw new EventBasicsUnavailableError();
        if (sameValues(before.current, normalized)) {
          await this.#sync.discardDeadLetter(
            this.#accountUserId,
            failed.clientMutationId,
          );
          await this.#assertActive();
          return this.load(rootEventId);
        }
      }
      const command = {
        baseVersion: before.version,
        entityId: rootEventId,
        kind: 'event.update' as const,
        payload: { changes: normalized },
      };
      const replacementFor = before.conflict ? failed?.clientMutationId : null;
      await this.#sync.enqueueMutation(
        this.#accountUserId,
        rootEventId,
        deviceId,
        command,
        {
          changes: normalized,
          kind: 'event.basics',
          replacementFor,
          rootEventId,
          schemaVersion: 1,
        },
      );
      await this.#assertActive();
      if (replacementFor) {
        await this.#sync.discardDeadLetter(this.#accountUserId, replacementFor);
        await this.#assertActive();
      }
      if (this.#client && this.#isOnline()) {
        await this.#sync.syncRoot(this.#accountUserId, rootEventId, {
          force: true,
        });
        await this.#assertActive();
      }
      return this.load(rootEventId);
    } finally {
      releaseSaveLock();
    }
  }

  async #finishDurableConflictReplacement(
    rootEventId: string,
    outbox: readonly OutboxItem[],
  ): Promise<readonly OutboxItem[]> {
    const replacement = outbox.find(item => {
      if (item.state === 'dead_letter' || !rootUpdate(item, rootEventId)) {
        return false;
      }
      return Boolean(
        eventBasicsOverlay(item.optimisticOverlay, rootEventId)?.replacementFor,
      );
    });
    const replacementFor = replacement
      ? eventBasicsOverlay(replacement.optimisticOverlay, rootEventId)
          ?.replacementFor ?? null
      : null;
    if (
      !replacementFor ||
      !outbox.some(
        item =>
          item.clientMutationId === replacementFor &&
          item.state === 'dead_letter',
      )
    ) {
      return outbox;
    }
    await this.#sync.discardDeadLetter(this.#accountUserId, replacementFor);
    await this.#assertActive();
    const refreshed = await this.#sync.listOutbox(
      this.#accountUserId,
      rootEventId,
    );
    await this.#assertActive();
    return refreshed;
  }

  async #assertActive(): Promise<void> {
    if ((await this.#activeAccountUserId()) !== this.#accountUserId) {
      throw new EventBasicsAccountChangedError();
    }
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
  if (locks.has(key)) throw new EventBasicsPendingError();
  const token = Symbol(key);
  locks.set(key, token);
  return () => {
    if (locks?.get(key) === token) locks.delete(key);
  };
}

function rootUpdate(
  item: OutboxItem,
  rootEventId: string,
): item is OutboxItem & { command: RootEventUpdate } {
  return (
    item.operationId === 'syncMutationsApply' &&
    'kind' in item.command &&
    item.command.kind === 'event.update' &&
    item.command.entityId === rootEventId
  );
}

function activeUpdateState(state: OutboxItem['state']) {
  return ['awaiting_pull', 'blocked', 'pending', 'sending'].includes(state);
}

function eventValues(event: {
  description: string | null;
  endsAt: string | null;
  startsAt: string | null;
  timeZone: string;
  title: string;
}): EventBasicsValues {
  return {
    description: event.description,
    endsAt: event.endsAt,
    startsAt: event.startsAt,
    timeZone: event.timeZone,
    title: event.title,
  };
}

function applyChanges(
  current: EventBasicsValues,
  changes: RootEventUpdate['payload']['changes'],
): EventBasicsValues {
  return {
    description:
      changes.description === undefined
        ? current.description
        : changes.description,
    endsAt: changes.endsAt === undefined ? current.endsAt : changes.endsAt,
    startsAt:
      changes.startsAt === undefined ? current.startsAt : changes.startsAt,
    timeZone: changes.timeZone ?? current.timeZone,
    title: changes.title ?? current.title,
  };
}

function eventBasicsOverlay(
  value: unknown,
  rootEventId: string,
): { replacementFor: string | null; values: EventBasicsValues } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const overlay = value as Record<string, unknown>;
  if (
    overlay.schemaVersion !== 1 ||
    overlay.kind !== 'event.basics' ||
    overlay.rootEventId !== rootEventId ||
    !overlay.changes ||
    typeof overlay.changes !== 'object' ||
    Array.isArray(overlay.changes)
  ) {
    return null;
  }
  const changes = overlay.changes as Record<string, unknown>;
  if (
    typeof changes.title !== 'string' ||
    (changes.description !== null && typeof changes.description !== 'string') ||
    typeof changes.timeZone !== 'string' ||
    (changes.startsAt !== null && typeof changes.startsAt !== 'string') ||
    (changes.endsAt !== null && typeof changes.endsAt !== 'string') ||
    (overlay.replacementFor !== null &&
      (typeof overlay.replacementFor !== 'string' ||
        !mutationIdPattern.test(overlay.replacementFor)))
  ) {
    return null;
  }
  try {
    return {
      replacementFor:
        typeof overlay.replacementFor === 'string'
          ? overlay.replacementFor
          : null,
      values: validateEventBasicsValues({
        description: changes.description,
        endsAt: changes.endsAt,
        startsAt: changes.startsAt,
        timeZone: changes.timeZone,
        title: changes.title,
      }),
    };
  } catch {
    return null;
  }
}

const mutationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateEventBasicsValues(
  values: EventBasicsValues,
): EventBasicsValues {
  const title = values.title.trim();
  const description = values.description?.trim() || null;
  if (!title || title.length > 160) throw new EventBasicsUnavailableError();
  if (description && description.length > 20_000) {
    throw new EventBasicsUnavailableError();
  }
  if (!isIanaTimeZone(values.timeZone)) {
    throw new EventBasicsUnavailableError();
  }
  const startsAt = validInstant(values.startsAt);
  const endsAt = validInstant(values.endsAt);
  if (startsAt && endsAt && Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new EventBasicsUnavailableError();
  }
  return {
    description,
    endsAt,
    startsAt,
    timeZone: values.timeZone,
    title,
  };
}

function validInstant(value: string | null): string | null {
  if (value === null) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new EventBasicsUnavailableError();
  return new Date(timestamp).toISOString();
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

function sameValues(left: EventBasicsValues, right: EventBasicsValues) {
  return (
    left.description === right.description &&
    left.endsAt === right.endsAt &&
    left.startsAt === right.startsAt &&
    left.timeZone === right.timeZone &&
    left.title === right.title
  );
}
