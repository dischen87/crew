import type { GatewayClient } from '@crew/mobile-client';
import {
  CommunityFeedbackController,
  LocalAttachmentStore,
  MobileDataStore,
  MobileSyncEngine,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureUuidV4 } from '../storage/secureRandom';

export type CommunityFeedbackRuntimeOptions = {
  activeAccountUserId(): string | null;
  client: MobileGatewayClient;
  database: SqlDatabase;
};

/**
 * Keeps community reads behind the same crash-safe root verification used by
 * Event Hub. Community endpoints never decide whether an entire root is
 * purged; only the authoritative root sync may do that.
 */
export class CommunityFeedbackRuntime {
  readonly controller: CommunityFeedbackController;
  readonly #data: MobileDataStore;
  readonly #sync: MobileSyncEngine;

  constructor(options: CommunityFeedbackRuntimeOptions) {
    this.controller = new CommunityFeedbackController(
      options.database,
      options.client as GatewayClient,
    );
    this.#data = new MobileDataStore(options.database);
    this.#sync = new MobileSyncEngine(options.database, options.client, {
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
    });
  }

  async hasCachedMembership(
    accountUserId: string,
    rootEventId: string,
  ): Promise<boolean> {
    return (await this.#data.listMemberships(accountUserId, rootEventId)).some(
      membership =>
        membership.memberUserId === accountUserId &&
        membership.rootEventId === rootEventId &&
        membership.status === 'active',
    );
  }

  async verifyRoot(
    accountUserId: string,
    rootEventId: string,
    force = false,
  ): Promise<void> {
    await this.#sync.syncRoot(accountUserId, rootEventId, { force });
  }
}
