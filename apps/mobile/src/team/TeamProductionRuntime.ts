import type { GatewayClient } from '@crew/mobile-client';
import {
  LocalAttachmentStore,
  MemberDirectoryRootAccessDeniedError,
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type FeedRecord,
  type OutboxItem,
  type SqlExecutor,
  type SyncMutationDraft,
  TeamOfflineStore,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
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
  createdAt: string;
  deliveryLabel: string;
  deliveryState: TeamFeedDeliveryState;
  id: string;
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
  readonly #randomUUID: () => string;
  readonly #rootEventId: string;
  readonly #sync: MobileSyncEngine;
  readonly role: TeamRole;

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
    role: TeamRole;
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
    this.role = input.role;
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
    if (!membership) return null;
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
      role: membership.role,
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
      role: membership.role,
      rootEventId: options.rootEventId,
      sync,
    });
  }

  async loadAssignments(
    eventId: string,
  ): Promise<TeamAssignmentsViewModel | null> {
    this.#assertActive();
    const eventTitle = await this.#eventTitle(eventId);
    if (!eventTitle) return null;
    const deliveryState = assignmentDeliveryState(
      await this.#sync.listOutbox(this.#accountUserId, this.#rootEventId),
      eventId,
    );
    return this.#controller.loadAssignments({
      capacityPerTeam: null,
      deliveryState,
      eventId,
      eventTitle,
      rootEventId: this.#rootEventId,
    });
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

  async loadFeed(eventId: string | null): Promise<TeamFeedViewModel | null> {
    this.#assertActive();
    const eventTitle = await this.#eventTitle(eventId ?? this.#rootEventId);
    this.#assertActive();
    if (!eventTitle) return null;
    const [feed, outbox] = await Promise.all([
      this.#data.listFeed(this.#accountUserId, this.#rootEventId),
      this.#sync.listOutbox(this.#accountUserId, this.#rootEventId),
    ]);
    this.#assertActive();
    return {
      canPost: this.role !== 'viewer',
      entries: teamFeedEntries(feed, outbox, this.#accountUserId, eventId),
      eventId,
      eventTitle,
      role: this.role,
      rootEventId: this.#rootEventId,
    };
  }

  createFeedEntry(eventId: string | null, value: string): Promise<OutboxItem> {
    this.#assertActive();
    if (this.role === 'viewer') {
      return Promise.reject(new Error('Viewers cannot post to the team feed'));
    }
    const content = normalizeTeamFeedContent(value);
    const key = eventId ?? this.#rootEventId;
    const existing = this.#feedInFlight.get(key);
    if (existing) return existing;
    const pending = this.#createFeedEntry(eventId, content).finally(() => {
      if (this.#feedInFlight.get(key) === pending) {
        this.#feedInFlight.delete(key);
      }
    });
    this.#feedInFlight.set(key, pending);
    return pending;
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
  ): Promise<OutboxItem> {
    const eventTitle = await this.#eventTitle(eventId ?? this.#rootEventId);
    this.#assertActive();
    if (!eventTitle) throw new Error('Team feed event is unavailable');
    const entityId = `fed_${this.#randomUUID()}`;
    if (!/^fed_[A-Za-z0-9._:-]{1,96}$/.test(entityId)) {
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
    return this.#sync.enqueueMutation(
      this.#accountUserId,
      this.#rootEventId,
      await this.#deviceId(),
      command,
      command,
    );
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
}

function teamFeedEntries(
  feed: readonly FeedRecord[],
  outbox: readonly OutboxItem[],
  accountUserId: string,
  eventId: string | null,
): readonly TeamFeedEntryViewModel[] {
  const entries = new Map<string, TeamFeedEntryViewModel>();
  for (const entry of feed) {
    if (
      (eventId !== null && entry.eventId !== eventId) ||
      !['comment', 'message'].includes(entry.kind)
    ) {
      continue;
    }
    const body = feedBody(entry.payloadJson);
    if (!body) continue;
    entries.set(entry.id, {
      author:
        entry.actorUserId === accountUserId
          ? 'Du'
          : entry.actorUserId === null
          ? 'Crew'
          : 'Teammitglied',
      body,
      createdAt: entry.createdAt,
      deliveryLabel: 'Synchronisiert',
      deliveryState: 'converged',
      id: entry.id,
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
      createdAt: item.createdAt,
      deliveryLabel: delivery.label,
      deliveryState: delivery.state,
      id: command.entityId,
    });
  }
  return [...entries.values()]
    .sort((left, right) => {
      const state =
        deliveryRank(left.deliveryState) - deliveryRank(right.deliveryState);
      return (
        state ||
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    })
    .slice(0, 30);
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
