import type { GatewayClient } from '@crew/mobile-client';
import {
  GolfOfflineStore,
  LocalAttachmentStore,
  MemberDirectoryRootAccessDeniedError,
  MemberDirectoryStore,
  MobileDataStore,
  MobileSyncEngine,
  MobileSyncRootAccessDeniedError,
  type GolfScoreEnqueueResult,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import type { ClosableSqlDatabase } from '../app/PrivateBootstrapGate';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureDeviceIdStore } from '../storage/deviceIdentity';
import { secureUuidV4 } from '../storage/secureRandom';
import {
  GolfScorecardController,
  type GolfScorecardViewModel,
} from './GolfScorecardController';

type DeviceIdReader = { getOrCreate(): Promise<string> };

export type GolfScorecardRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null;
  client: MobileGatewayClient | null;
  database: ClosableSqlDatabase;
  deviceIdStore?: DeviceIdReader;
  eventId: string;
  rootEventId: string;
};

export class GolfScorecardRuntime {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: () => string | null;
  readonly #client: MobileGatewayClient | null;
  readonly #controller: GolfScorecardController;
  readonly #data: MobileDataStore;
  readonly #database: ClosableSqlDatabase;
  readonly #directory: MemberDirectoryStore;
  readonly #eventId: string;
  readonly #rootEventId: string;
  readonly #sync: MobileSyncEngine;

  private constructor(input: {
    accountUserId: string;
    activeAccountUserId(): string | null;
    client: MobileGatewayClient | null;
    controller: GolfScorecardController;
    data: MobileDataStore;
    database: ClosableSqlDatabase;
    directory: MemberDirectoryStore;
    eventId: string;
    rootEventId: string;
    sync: MobileSyncEngine;
  }) {
    this.#accountUserId = input.accountUserId;
    this.#activeAccountUserId = input.activeAccountUserId;
    this.#client = input.client;
    this.#controller = input.controller;
    this.#data = input.data;
    this.#database = input.database;
    this.#directory = input.directory;
    this.#eventId = input.eventId;
    this.#rootEventId = input.rootEventId;
    this.#sync = input.sync;
  }

  static async create(
    options: GolfScorecardRuntimeOptions,
  ): Promise<GolfScorecardRuntime | null> {
    assertActive(options);
    const data = new MobileDataStore(options.database);
    const membership = (
      await data.listMemberships(options.accountUserId, options.rootEventId)
    ).find(
      item =>
        item.memberUserId === options.accountUserId && item.status === 'active',
    );
    if (!membership) return null;
    const event = (
      await data.listEventTree(options.accountUserId, options.rootEventId)
    ).find(
      item =>
        item.id === options.eventId &&
        item.kind === 'golf' &&
        item.deletedAt === null,
    );
    if (!event) return null;
    assertActive(options);

    const deviceId = await (
      options.deviceIdStore ?? secureDeviceIdStore
    ).getOrCreate();
    assertActive(options);
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
        randomUUID: secureUuidV4,
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
    const controller = new GolfScorecardController({
      accountUserId: options.accountUserId,
      activeAccountUserId: options.activeAccountUserId,
      deviceId,
      eventId: options.eventId,
      resolvePerson: async userId => {
        const person = await directory.get(
          options.accountUserId,
          options.rootEventId,
          userId,
        );
        return person?.displayName ?? null;
      },
      role: membership.role,
      rootEventId: options.rootEventId,
      store: new GolfOfflineStore(options.database),
      sync,
    });
    return new GolfScorecardRuntime({
      accountUserId: options.accountUserId,
      activeAccountUserId: options.activeAccountUserId,
      client: options.client,
      controller,
      data,
      database: options.database,
      directory,
      eventId: options.eventId,
      rootEventId: options.rootEventId,
      sync,
    });
  }

  async load(): Promise<GolfScorecardViewModel | null> {
    this.#assertActive();
    const event = (
      await this.#data.listEventTree(this.#accountUserId, this.#rootEventId)
    ).find(
      item =>
        item.id === this.#eventId &&
        item.kind === 'golf' &&
        item.deletedAt === null,
    );
    if (!event) return null;
    return this.#controller.load(event.title);
  }

  saveScore(input: {
    baseVersion: number;
    clientIntentId: string;
    hole: number;
    putts: number | null;
    strokes: number | null;
  }): Promise<GolfScoreEnqueueResult> {
    this.#assertActive();
    return this.#controller.saveScore(input);
  }

  requeueConflict(input: {
    clientIntentId: string;
    clientMutationId: string;
    hole: number;
  }): Promise<GolfScoreEnqueueResult> {
    this.#assertActive();
    return this.#controller.requeueConflict(input);
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

  #assertActive() {
    if (this.#activeAccountUserId() !== this.#accountUserId) {
      throw new Error('Active account changed during golf route');
    }
  }
}

function assertActive(options: GolfScorecardRuntimeOptions) {
  if (options.activeAccountUserId() !== options.accountUserId) {
    throw new Error('Active account changed during golf route');
  }
}

const offlineGatewayClient = {
  request: () => Promise.reject(new Error('Gateway client is unavailable')),
} as unknown as Pick<GatewayClient, 'request'>;
