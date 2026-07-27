import type { GatewayClient } from '@crew/mobile-client';
import {
  LocalAttachmentStore,
  MemberDirectoryRootAccessDeniedError,
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type AttachmentRecord,
  type FeedPhotoLifecycle,
  type FeedRecord,
  type OutboxItem,
  type SqlExecutor,
  type SyncMutation,
  type SyncMutationDraft,
  TeamOfflineStore,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import {
  reconcileFeedPhotoAttachments,
  reconcileRetainedAttachmentFiles,
  runAttachmentMediaOperation,
} from '../media/attachmentMedia';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureDeviceIdStore } from '../storage/deviceIdentity';
import { secureUuidV4 } from '../storage/secureRandom';
import type { ClosableSqlDatabase } from '../app/PrivateBootstrapGate';
import {
  TeamCollaborationController,
  type TeamAssignmentsViewModel,
  type TeamDecisionViewModel,
  type TeamDeliveryState,
  type TeamRole,
} from './TeamCollaborationController';
import { parseSystemFeedPayload } from './systemFeedPayload';

type DeviceIdReader = {
  assertCurrent?(
    executor: SqlExecutor,
    accountUserId: string,
    rootEventId: string,
    deviceId: string,
  ): Promise<void>;
  getOrCreate(
    database: ClosableSqlDatabase,
    accountUserId: string,
    rootEventId: string,
  ): Promise<string>;
};

export type TeamProductionRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null;
  client: MobileGatewayClient | null;
  database: ClosableSqlDatabase;
  deviceIdStore?: DeviceIdReader;
  randomUUID?: () => string;
  rootEventId: string;
};

export const TEAM_FEED_MAX_LENGTH = 10_000;

export type TeamFeedDeliveryState =
  | 'attention'
  | 'converged'
  | 'queued'
  | 'sending';

export type TeamFeedEntryViewModel = {
  author: string;
  body: string;
  canEdit: boolean;
  createdAt: string;
  deliveryLabel: string;
  deliveryState: TeamFeedDeliveryState;
  eventId: string | null;
  id: string;
  photos: readonly TeamFeedPhotoViewModel[];
  revisionConflict: {
    attemptedBody: string;
    currentBody: string;
  } | null;
  version: number | null;
};

export type TeamFeedPhotoViewModel = {
  byteCount: number;
  caption: string | null;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  id: string;
  sha256: string;
  targetEntryId: string;
  version: number;
};

export type TeamFeedViewModel = {
  canPost: boolean;
  entries: readonly TeamFeedEntryViewModel[];
  eventId: string | null;
  eventTitle: string;
  role: TeamRole;
  rootEventId: string;
};

export class TeamProductionRuntime {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: () => string | null;
  readonly #client: MobileGatewayClient | null;
  readonly #controller: TeamCollaborationController;
  readonly #data: MobileDataStore;
  readonly #database: ClosableSqlDatabase;
  readonly #deviceId: () => Promise<string>;
  readonly #directory: MemberDirectoryStore;
  readonly #feedInFlight = new Map<string, Promise<OutboxItem>>();
  readonly #feedRevisionInFlight = new Map<string, Promise<OutboxItem>>();
  readonly #randomUUID: () => string;
  readonly #rootEventId: string;
  readonly #sync: MobileSyncEngine;
  readonly #role: { current: TeamRole };

  private constructor(input: {
    accountUserId: string;
    activeAccountUserId(): string | null;
    client: MobileGatewayClient | null;
    controller: TeamCollaborationController;
    data: MobileDataStore;
    database: ClosableSqlDatabase;
    deviceId(): Promise<string>;
    directory: MemberDirectoryStore;
    randomUUID: () => string;
    role: { current: TeamRole };
    rootEventId: string;
    sync: MobileSyncEngine;
  }) {
    this.#accountUserId = input.accountUserId;
    this.#activeAccountUserId = input.activeAccountUserId;
    this.#client = input.client;
    this.#controller = input.controller;
    this.#data = input.data;
    this.#database = input.database;
    this.#deviceId = input.deviceId;
    this.#directory = input.directory;
    this.#randomUUID = input.randomUUID;
    this.#rootEventId = input.rootEventId;
    this.#sync = input.sync;
    this.#role = input.role;
  }

  get role(): TeamRole {
    return this.#role.current;
  }

  static async create(
    options: TeamProductionRuntimeOptions,
  ): Promise<TeamProductionRuntime | null> {
    assertActive(options);
    const data = new MobileDataStore(options.database);
    const membership = (
      await data.listMemberships(options.accountUserId, options.rootEventId)
    ).find(
      item =>
        item.memberUserId === options.accountUserId &&
        item.rootEventId === options.rootEventId &&
        item.status === 'active',
    );
    if (!membership || !isTeamRole(membership.role)) return null;
    assertActive(options);

    const deviceIds = options.deviceIdStore ?? secureDeviceIdStore;
    const deviceId = () =>
      deviceIds.getOrCreate(
        options.database,
        options.accountUserId,
        options.rootEventId,
      );
    await deviceId();
    assertActive(options);
    const randomUUID = options.randomUUID ?? secureUuidV4;
    const team = new TeamOfflineStore(options.database);
    const directory = new MemberDirectoryStore(
      options.database,
      options.client ?? undefined,
      { activeAccountUserId: options.activeAccountUserId },
    );
    const sync = new MobileSyncEngine(
      options.database,
      options.client ?? offlineGatewayClient,
      {
        activeAccountUserId: options.activeAccountUserId,
        ...(deviceIds.assertCurrent
          ? {
              assertMutationStreamIdentity: (
                executor: SqlExecutor,
                account: string,
                root: string,
                device: string,
              ) => deviceIds.assertCurrent!(executor, account, root, device),
            }
          : {}),
        randomUUID,
        onRootReadStarted: (accountUserId, rootEventId) =>
          deniedRootRegistry.arm(accountUserId, rootEventId),
        onRootReadFinished: (accountUserId, rootEventId, verificationId) =>
          deniedRootRegistry.finish(accountUserId, rootEventId, verificationId),
        onRootPurged: accountUserId =>
          reconcileRetainedAttachmentFiles(
            new LocalAttachmentStore(options.database),
            accountUserId,
          ),
      },
    );
    const role = { current: membership.role };
    const controller = new TeamCollaborationController({
      accountUserId: options.accountUserId,
      deviceId,
      resolvePerson: async userId => {
        const entry = await directory.get(
          options.accountUserId,
          options.rootEventId,
          userId,
        );
        return entry?.displayName
          ? { id: entry.userId, name: entry.displayName }
          : null;
      },
      role: () => role.current,
      store: team,
      sync,
    });
    return new TeamProductionRuntime({
      accountUserId: options.accountUserId,
      activeAccountUserId: options.activeAccountUserId,
      client: options.client,
      controller,
      data,
      database: options.database,
      deviceId,
      directory,
      randomUUID,
      role,
      rootEventId: options.rootEventId,
      sync,
    });
  }

  async loadAssignments(
    eventId: string,
  ): Promise<TeamAssignmentsViewModel | null> {
    this.#assertActive();
    const eventTitle = await this.#eventTitle(eventId);
    this.#assertActive();
    if (!eventTitle) return null;
    const deliveryState = assignmentDeliveryState(
      await this.#sync.listOutbox(this.#accountUserId, this.#rootEventId),
      eventId,
    );
    this.#assertActive();
    const model = await this.#controller.loadAssignments({
      capacityPerTeam: null,
      deliveryState,
      eventId,
      eventTitle,
      rootEventId: this.#rootEventId,
    });
    this.#assertActive();
    return model;
  }

  async loadDecision(
    decisionId: string,
  ): Promise<TeamDecisionViewModel | null> {
    this.#assertActive();
    const decision = await new TeamOfflineStore(this.#database).getDecision(
      this.#accountUserId,
      this.#rootEventId,
      decisionId,
    );
    if (!decision) return null;
    const eventTitle = await this.#eventTitle(decision.eventId);
    if (!eventTitle) return null;
    return this.#controller.loadDecision({
      decisionId,
      eventTitle,
      rootEventId: this.#rootEventId,
    });
  }

  async loadFeed(
    eventId: string | null,
    focusEntryId: string | null = null,
  ): Promise<TeamFeedViewModel | null> {
    this.#assertActive();
    if (focusEntryId !== null && !isFeedEntryId(focusEntryId)) {
      throw new TypeError('Invalid team feed entry identity');
    }
    const eventTitle = await this.#eventTitle(eventId ?? this.#rootEventId);
    this.#assertActive();
    if (!eventTitle) return null;
    let outbox = await this.#sync.listOutbox(
      this.#accountUserId,
      this.#rootEventId,
    );
    this.#assertActive();
    outbox = await this.#finishDurableFeedRevisionReplacement(outbox);
    const [feed, attachments] = await Promise.all([
      this.#data.listFeed(this.#accountUserId, this.#rootEventId),
      this.#data.listAttachments(this.#accountUserId, this.#rootEventId),
    ]);
    this.#assertActive();
    const entries = teamFeedEntries(
      feed,
      outbox,
      attachments,
      this.#accountUserId,
      eventId,
      this.role !== 'viewer',
      focusEntryId,
    );
    if (focusEntryId && !entries.some(entry => entry.id === focusEntryId)) {
      return null;
    }
    return {
      canPost: this.role !== 'viewer',
      entries,
      eventId,
      eventTitle,
      role: this.role,
      rootEventId: this.#rootEventId,
    };
  }

  async recoverFeedPhoto(
    eventId: string | null,
  ): Promise<FeedPhotoLifecycle | null> {
    return runAttachmentMediaOperation(this.#accountUserId, async () => {
      this.#assertActive();
      const photos = await reconcileFeedPhotoAttachments(
        new LocalAttachmentStore(this.#database),
        this.#accountUserId,
        this.#rootEventId,
      );
      this.#assertActive();
      return photos.find(photo => photo.eventId === eventId) ?? null;
    });
  }

  createFeedEntry(
    eventId: string | null,
    value: string,
    feedEntryId?: string,
  ): Promise<OutboxItem> {
    this.#assertActive();
    if (this.role === 'viewer') {
      return Promise.reject(new Error('Viewers cannot post to the team feed'));
    }
    const content = normalizeTeamFeedContent(value);
    if (feedEntryId !== undefined && !isFeedEntryId(feedEntryId)) {
      throw new TypeError('Invalid team feed entry identity');
    }
    const key = eventId ?? this.#rootEventId;
    const existing = this.#feedInFlight.get(key);
    if (existing) return existing;
    const pending = this.#createFeedEntry(
      eventId,
      content,
      feedEntryId,
    ).finally(() => {
      if (this.#feedInFlight.get(key) === pending) {
        this.#feedInFlight.delete(key);
      }
    });
    this.#feedInFlight.set(key, pending);
    return pending;
  }

  reviseFeedEntry(
    eventId: string | null,
    entryId: string,
    value: string,
    baseVersion: number,
  ): Promise<OutboxItem> {
    this.#assertActive();
    this.#assertCanPost();
    if (!isFeedEntryId(entryId)) {
      throw new TypeError('Invalid team feed entry identity');
    }
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      throw new TypeError('Invalid team feed entry version');
    }
    const content = normalizeTeamFeedContent(value);
    const existing = this.#feedRevisionInFlight.get(entryId);
    if (existing) return existing;
    const pending = this.#reviseFeedEntry(
      eventId,
      entryId,
      content,
      baseVersion,
    ).finally(() => {
      if (this.#feedRevisionInFlight.get(entryId) === pending) {
        this.#feedRevisionInFlight.delete(entryId);
      }
    });
    this.#feedRevisionInFlight.set(entryId, pending);
    return pending;
  }

  async keepFeedEntryServerVersion(
    eventId: string | null,
    entryId: string,
    baseVersion: number,
  ): Promise<void> {
    this.#assertActive();
    this.#assertCanPost();
    if (!isFeedEntryId(entryId)) {
      throw new TypeError('Invalid team feed entry identity');
    }
    if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
      throw new TypeError('Invalid team feed entry version');
    }
    await this.#editableFeedEntry(eventId, entryId, baseVersion);
    const outbox = await this.#sync.listOutbox(
      this.#accountUserId,
      this.#rootEventId,
    );
    this.#assertActive();
    const conflict = latestFeedRevision(outbox, entryId, 'dead_letter');
    if (
      !conflict ||
      conflict.lastError?.code !== 'conflict' ||
      conflict.lastError.currentVersion !== baseVersion ||
      !conflict.serverConsumed ||
      outbox.some(
        item =>
          isActiveOutboxState(item.state) && isFeedRevision(item, entryId),
      )
    ) {
      throw new Error('Team feed revision conflict is unavailable');
    }
    this.#assertCanPost();
    await this.#sync.discardDeadLetter(
      this.#accountUserId,
      conflict.clientMutationId,
    );
    this.#assertActive();
  }

  publishAssignments(
    model: Extract<TeamAssignmentsViewModel, { access: 'manage' }>,
  ) {
    this.#assertActive();
    return this.#controller.publishAssignments(
      {
        eventId: model.eventId,
        rootEventId: this.#rootEventId,
        teams: model.teams.map(team => ({
          color: team.color,
          id: team.id,
          memberUserIds: team.members.map(member => member.id),
          name: team.name,
        })),
      },
      () => this.#assertActive(),
    );
  }

  submitResponse(decisionId: string, optionId: string) {
    this.#assertActive();
    return this.#controller.submitResponse(
      {
        decisionId,
        optionId,
        rootEventId: this.#rootEventId,
      },
      () => this.#assertActive(),
    );
  }

  async refresh(): Promise<void> {
    if (!this.#client) return;
    this.#assertActive();
    await this.#sync.syncRoot(this.#accountUserId, this.#rootEventId, {
      force: true,
    });
    this.#assertActive();
    await this.#refreshRole();
    let verificationId: string | null = null;
    try {
      verificationId = await deniedRootRegistry.arm(
        this.#accountUserId,
        this.#rootEventId,
      );
      await this.#directory.refresh(this.#accountUserId, this.#rootEventId);
      await deniedRootRegistry.finish(
        this.#accountUserId,
        this.#rootEventId,
        verificationId,
      );
      verificationId = null;
    } catch (error) {
      if (error instanceof MemberDirectoryRootAccessDeniedError) {
        await this.#data.clearRootData(this.#accountUserId, this.#rootEventId);
        await reconcileRetainedAttachmentFiles(
          new LocalAttachmentStore(this.#database),
          this.#accountUserId,
        );
        if (verificationId) {
          await deniedRootRegistry.finish(
            this.#accountUserId,
            this.#rootEventId,
            verificationId,
          );
        }
        throw new MobileSyncRootAccessDeniedError();
      }
      if (verificationId) {
        await deniedRootRegistry.finish(
          this.#accountUserId,
          this.#rootEventId,
          verificationId,
        );
      }
      throw error;
    }
  }

  async #createFeedEntry(
    eventId: string | null,
    content: string,
    feedEntryId?: string,
  ): Promise<OutboxItem> {
    const eventTitle = await this.#eventTitle(eventId ?? this.#rootEventId);
    this.#assertActive();
    if (!eventTitle) throw new Error('Team feed event is unavailable');
    const entityId = feedEntryId ?? `fed_${this.#randomUUID()}`;
    if (!isFeedEntryId(entityId)) {
      throw new TypeError('Invalid team feed entry identity');
    }
    const command: SyncMutationDraft = {
      entityId,
      kind: 'feed.entry.create',
      payload: {
        content,
        eventId,
        kind: 'message',
        parentEntryId: null,
      },
    };
    const deviceId = await this.#deviceId();
    // Authority can change while the event title or device identity is read.
    // Keep the final synchronous step before enqueue fail-closed.
    this.#assertActive();
    this.#assertCanPost();
    return this.#sync.enqueueMutation(
      this.#accountUserId,
      this.#rootEventId,
      deviceId,
      command,
      command,
    );
  }

  async #reviseFeedEntry(
    eventId: string | null,
    entryId: string,
    content: string,
    baseVersion: number,
  ): Promise<OutboxItem> {
    const entry = await this.#editableFeedEntry(eventId, entryId, baseVersion);
    let outbox = await this.#sync.listOutbox(
      this.#accountUserId,
      this.#rootEventId,
    );
    this.#assertActive();
    outbox = await this.#finishDurableFeedRevisionReplacement(outbox);
    if (
      outbox.some(
        item =>
          isActiveOutboxState(item.state) && isFeedRevision(item, entryId),
      )
    ) {
      throw new Error('A team feed revision is already pending');
    }
    const failed = latestFeedRevision(outbox, entryId, 'dead_letter');
    const replacementFor =
      failed?.lastError?.code === 'conflict' &&
      failed.lastError.currentVersion === entry.version &&
      failed.serverConsumed
        ? failed.clientMutationId
        : null;
    if (failed && !replacementFor) {
      throw new Error('Team feed revision needs attention');
    }
    const deviceId = await this.#deviceId();
    await this.#editableFeedEntry(eventId, entryId, baseVersion);
    this.#assertActive();
    this.#assertCanPost();
    const command: SyncMutationDraft = {
      baseVersion,
      entityId: entryId,
      kind: 'feed.entry.revise',
      payload: { content },
    };
    const queued = await this.#sync.enqueueMutation(
      this.#accountUserId,
      this.#rootEventId,
      deviceId,
      command,
      {
        entryId,
        eventId,
        kind: 'team.feed.revision',
        replacementFor,
        schemaVersion: 1,
      },
    );
    this.#assertActive();
    if (replacementFor) {
      await this.#sync.discardDeadLetter(this.#accountUserId, replacementFor);
      this.#assertActive();
    }
    return queued;
  }

  async #editableFeedEntry(
    eventId: string | null,
    entryId: string,
    baseVersion: number,
  ): Promise<FeedRecord> {
    const eventTitle = await this.#eventTitle(eventId ?? this.#rootEventId);
    this.#assertActive();
    if (!eventTitle) throw new Error('Team feed event is unavailable');
    const entry = (
      await this.#data.listFeed(this.#accountUserId, this.#rootEventId)
    ).find(
      item =>
        item.accountUserId === this.#accountUserId &&
        item.rootEventId === this.#rootEventId &&
        item.id === entryId &&
        item.eventId === eventId &&
        item.actorUserId === this.#accountUserId &&
        item.deletedAt === null &&
        ['comment', 'message'].includes(item.kind) &&
        feedBody(item.payloadJson) !== null,
    );
    this.#assertActive();
    if (!entry) throw new Error('Team feed entry is unavailable for editing');
    if (entry.version !== baseVersion) {
      throw new Error('Team feed entry version changed');
    }
    return entry;
  }

  async #finishDurableFeedRevisionReplacement(
    outbox: readonly OutboxItem[],
  ): Promise<readonly OutboxItem[]> {
    const replacement = outbox.find(item => {
      if (item.state === 'dead_letter' || !isFeedRevision(item)) {
        return false;
      }
      return feedRevisionOverlay(item.optimisticOverlay, item.command.entityId)
        ?.replacementFor;
    });
    if (!replacement || !isFeedRevision(replacement)) {
      return outbox;
    }
    const replacementFor = feedRevisionOverlay(
      replacement.optimisticOverlay,
      replacement.command.entityId,
    )?.replacementFor;
    if (
      !replacementFor ||
      !outbox.some(
        item =>
          item.clientMutationId === replacementFor &&
          item.state === 'dead_letter' &&
          isFeedRevision(item, replacement.command.entityId),
      )
    ) {
      return outbox;
    }
    await this.#sync.discardDeadLetter(this.#accountUserId, replacementFor);
    this.#assertActive();
    const refreshed = await this.#sync.listOutbox(
      this.#accountUserId,
      this.#rootEventId,
    );
    this.#assertActive();
    return refreshed;
  }

  async #refreshRole(): Promise<void> {
    // A completed sync may have replaced the local membership snapshot. Keep
    // writes fail-closed while that new authority is read and validated.
    this.#role.current = 'viewer';
    const membership = (
      await this.#data.listMemberships(this.#accountUserId, this.#rootEventId)
    ).find(
      item =>
        item.memberUserId === this.#accountUserId &&
        item.rootEventId === this.#rootEventId &&
        item.status === 'active',
    );
    this.#assertActive();
    if (!membership || !isTeamRole(membership.role)) {
      throw new MobileSyncRootAccessDeniedError();
    }
    this.#role.current = membership.role;
  }

  async #eventTitle(eventId: string): Promise<string | null> {
    const event = (
      await this.#data.listEventTree(this.#accountUserId, this.#rootEventId)
    ).find(
      item =>
        item.id === eventId &&
        item.rootEventId === this.#rootEventId &&
        item.deletedAt === null,
    );
    return event?.title ?? null;
  }

  #assertActive() {
    if (this.#activeAccountUserId() !== this.#accountUserId) {
      throw new Error('Active account changed during team route');
    }
  }

  #assertCanPost() {
    if (this.role === 'viewer') {
      throw new Error('Viewers cannot post to the team feed');
    }
  }
}

function isFeedEntryId(value: string): boolean {
  return /^fed_[A-Za-z0-9._:-]{1,96}$/.test(value);
}

const mutationIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function teamFeedEntries(
  feed: readonly FeedRecord[],
  outbox: readonly OutboxItem[],
  attachments: readonly AttachmentRecord[],
  accountUserId: string,
  eventId: string | null,
  canPost: boolean,
  focusEntryId: string | null,
): readonly TeamFeedEntryViewModel[] {
  const entries = new Map<string, TeamFeedEntryViewModel>();
  for (const entry of feed) {
    const focused = entry.id === focusEntryId;
    if (
      entry.deletedAt !== null ||
      (eventId !== null && entry.eventId !== eventId) ||
      (!['comment', 'message'].includes(entry.kind) &&
        !(focused && entry.kind === 'system'))
    ) {
      continue;
    }
    const body =
      entry.kind === 'system'
        ? systemFeedBody(entry)
        : feedBody(entry.payloadJson);
    if (!body) continue;
    entries.set(entry.id, {
      author:
        entry.actorUserId === accountUserId
          ? 'Du'
          : entry.actorUserId === null
          ? 'Crew'
          : 'Teammitglied',
      body,
      canEdit: canPost && entry.actorUserId === accountUserId,
      createdAt: entry.createdAt,
      deliveryLabel: 'Synchronisiert',
      deliveryState: 'converged',
      eventId: entry.eventId,
      id: entry.id,
      photos: [],
      revisionConflict: null,
      version: entry.version,
    });
  }
  for (const item of outbox) {
    const command = item.command;
    if (
      !('kind' in command) ||
      command.kind !== 'feed.entry.create' ||
      (eventId !== null && command.payload.eventId !== eventId)
    ) {
      continue;
    }
    const body = safeTeamFeedContent(command.payload.content);
    if (!body) continue;
    const delivery = feedDelivery(item.state);
    entries.set(command.entityId, {
      author: 'Du',
      body,
      canEdit: false,
      createdAt: item.createdAt,
      deliveryLabel: delivery.label,
      deliveryState: delivery.state,
      eventId: command.payload.eventId ?? null,
      id: command.entityId,
      photos: entries.get(command.entityId)?.photos ?? [],
      revisionConflict: null,
      version: null,
    });
  }
  for (const item of outbox) {
    if (!isFeedRevision(item)) continue;
    const entry = entries.get(item.command.entityId);
    const attemptedBody = safeTeamFeedContent(item.command.payload.content);
    if (!entry || !attemptedBody) continue;
    if (item.state === 'dead_letter') {
      const conflict = item.lastError?.code === 'conflict';
      entries.set(entry.id, {
        ...entry,
        body: conflict ? entry.body : attemptedBody,
        canEdit:
          conflict &&
          canPost &&
          entry.version !== null &&
          item.serverConsumed &&
          item.lastError?.currentVersion === entry.version,
        deliveryLabel: conflict
          ? 'Konflikt · beide Stände prüfen'
          : 'Aktion erforderlich · Text bleibt lokal',
        deliveryState: 'attention',
        revisionConflict: conflict
          ? { attemptedBody, currentBody: entry.body }
          : null,
      });
      continue;
    }
    const delivery = feedDelivery(item.state);
    entries.set(entry.id, {
      ...entry,
      body: attemptedBody,
      canEdit: false,
      deliveryLabel: delivery.label,
      deliveryState: delivery.state,
      revisionConflict: null,
    });
  }
  for (const attachment of attachments) {
    const targetEntryId = attachment.target.entityId;
    const entry = entries.get(targetEntryId);
    if (!entry) continue;
    entries.set(targetEntryId, {
      ...entry,
      photos: [
        ...entry.photos,
        {
          byteCount: attachment.byteCount,
          caption: attachment.caption,
          contentType: attachment.contentType,
          id: attachment.id,
          sha256: attachment.sha256,
          targetEntryId,
          version: attachment.version,
        },
      ],
    });
  }
  const sorted = [...entries.values()].sort((left, right) => {
    const state =
      deliveryRank(left.deliveryState) - deliveryRank(right.deliveryState);
    return (
      state ||
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  });
  const visible = sorted.slice(0, 30);
  const focused = focusEntryId
    ? sorted.find(entry => entry.id === focusEntryId)
    : null;
  return focused && !visible.some(entry => entry.id === focused.id)
    ? [...visible, focused]
    : visible;
}

function isFeedRevision(
  item: OutboxItem,
  entryId?: string,
): item is OutboxItem & {
  command: Extract<SyncMutation, { kind: 'feed.entry.revise' }>;
} {
  return (
    'kind' in item.command &&
    item.command.kind === 'feed.entry.revise' &&
    (entryId === undefined || item.command.entityId === entryId)
  );
}

function isActiveOutboxState(state: OutboxItem['state']): boolean {
  return ['awaiting_pull', 'blocked', 'pending', 'sending'].includes(state);
}

function latestFeedRevision(
  outbox: readonly OutboxItem[],
  entryId: string,
  state: OutboxItem['state'],
): OutboxItem | null {
  return (
    outbox
      .filter(item => item.state === state && isFeedRevision(item, entryId))
      .at(-1) ?? null
  );
}

function feedRevisionOverlay(
  value: unknown,
  entryId: string,
): { replacementFor: string | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const overlay = value as Record<string, unknown>;
  if (
    overlay.schemaVersion !== 1 ||
    overlay.kind !== 'team.feed.revision' ||
    overlay.entryId !== entryId ||
    (overlay.replacementFor !== null &&
      (typeof overlay.replacementFor !== 'string' ||
        !mutationIdPattern.test(overlay.replacementFor)))
  ) {
    return null;
  }
  return {
    replacementFor:
      typeof overlay.replacementFor === 'string'
        ? overlay.replacementFor
        : null,
  };
}

function normalizeTeamFeedContent(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Invalid team feed text');
  const content = value.trim();
  if (content.length < 1 || content.length > TEAM_FEED_MAX_LENGTH) {
    throw new TypeError('Team feed text must contain 1 to 10000 characters');
  }
  return content;
}

function safeTeamFeedContent(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const content = value.trim();
  return content.length >= 1 && content.length <= TEAM_FEED_MAX_LENGTH
    ? content
    : null;
}

function feedBody(payloadJson: string): string | null {
  try {
    const payload = JSON.parse(payloadJson) as { text?: unknown };
    return safeTeamFeedContent(payload.text);
  } catch {
    return null;
  }
}

const systemFeedCopy = {
  'event.published': 'Das Event wurde veröffentlicht.',
  'itinerary.added': 'Ein Programmpunkt wurde hinzugefügt.',
  'itinerary.cancelled': 'Ein Programmpunkt wurde abgesagt.',
  'membership.activated': 'Ein Mitglied ist dem Event beigetreten.',
  'ownership.transferred': 'Die Eigentümerschaft wurde übertragen.',
  'team.assignments.published': 'Die Teameinteilung wurde veröffentlicht.',
  'team.decision.closed': 'Eine Team-Entscheidung wurde geschlossen.',
  'team.decision.opened': 'Eine Team-Entscheidung wurde geöffnet.',
} as const;

function systemFeedBody(entry: FeedRecord): string | null {
  if (
    entry.actorUserId !== null ||
    entry.payloadSchemaVersion !== 1 ||
    entry.kind !== 'system'
  ) {
    return null;
  }
  try {
    const payload = parseSystemFeedPayload(entry.payloadJson);
    if (
      payload.schemaVersion !== 1 ||
      typeof payload.actorUserId !== 'string' ||
      !/^usr_[a-f0-9]{32}$/.test(payload.actorUserId) ||
      !Number.isSafeInteger(payload.entityVersion) ||
      Number(payload.entityVersion) < 1 ||
      typeof payload.type !== 'string' ||
      !(payload.type in systemFeedCopy)
    ) {
      return null;
    }
    const eventId = /^evt_[A-Za-z0-9._:-]{1,96}$/;
    const itemId = /^iti_[A-Za-z0-9._:-]{1,96}$/;
    const decisionId = /^tdc_[A-Za-z0-9._:-]{1,96}$/;
    const userId = /^usr_[a-f0-9]{32}$/;
    switch (payload.type) {
      case 'event.published':
      case 'team.assignments.published':
        if (!eventId.test(String(payload.eventId ?? ''))) return null;
        break;
      case 'team.decision.opened':
      case 'team.decision.closed':
        if (
          !eventId.test(String(payload.eventId ?? '')) ||
          !decisionId.test(String(payload.decisionId ?? ''))
        ) {
          return null;
        }
        break;
      case 'itinerary.added':
      case 'itinerary.cancelled':
        if (
          !eventId.test(String(payload.eventId ?? '')) ||
          !itemId.test(String(payload.itineraryItemId ?? ''))
        ) {
          return null;
        }
        break;
      case 'membership.activated':
        if (
          !userId.test(String(payload.userId ?? '')) ||
          !['organizer', 'participant', 'viewer'].includes(String(payload.role))
        ) {
          return null;
        }
        break;
      case 'ownership.transferred':
        if (
          !userId.test(String(payload.fromUserId ?? '')) ||
          !userId.test(String(payload.toUserId ?? ''))
        ) {
          return null;
        }
        break;
    }
    return systemFeedCopy[payload.type as keyof typeof systemFeedCopy];
  } catch {
    return null;
  }
}

function feedDelivery(state: OutboxItem['state']): {
  label: string;
  state: Exclude<TeamFeedDeliveryState, 'converged'>;
} {
  switch (state) {
    case 'dead_letter':
      return {
        label: 'Aktion erforderlich · Text bleibt lokal',
        state: 'attention',
      };
    case 'awaiting_pull':
    case 'sending':
      return { label: 'Wird synchronisiert', state: 'sending' };
    case 'blocked':
    case 'pending':
      return {
        label: 'Lokal gespeichert · wartet auf Verbindung',
        state: 'queued',
      };
  }
}

function deliveryRank(state: TeamFeedDeliveryState) {
  return { attention: 0, sending: 1, queued: 2, converged: 3 }[state];
}

function isTeamRole(value: unknown): value is TeamRole {
  return ['owner', 'organizer', 'participant', 'viewer'].includes(
    value as TeamRole,
  );
}

function assignmentDeliveryState(
  outbox: readonly OutboxItem[],
  eventId: string,
): TeamDeliveryState {
  const matching = outbox.filter(item => {
    const command = item.command;
    return (
      'kind' in command &&
      command.kind === 'team.assignments.publish' &&
      command.payload.eventId === eventId
    );
  });
  if (matching.some(item => item.state === 'dead_letter')) {
    return 'needs_attention';
  }
  return matching.length > 0 ? 'pending' : 'synced';
}

function assertActive(options: TeamProductionRuntimeOptions) {
  if (options.activeAccountUserId() !== options.accountUserId) {
    throw new Error('Active account changed during team route');
  }
}

const offlineGatewayClient = {
  request: () => Promise.reject(new Error('Gateway client is unavailable')),
} as unknown as Pick<GatewayClient, 'request'>;
