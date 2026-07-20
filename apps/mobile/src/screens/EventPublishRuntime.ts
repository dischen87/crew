import type { GatewayClient } from '@crew/mobile-client';
import {
  EventPublishController,
  LocalAttachmentStore,
  MobileSyncEngine,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { reconcileRetainedAttachmentFiles } from '../media/attachmentMedia';
import { deniedRootRegistry } from '../storage/deniedRoots';
import { secureUuidV4 } from '../storage/secureRandom';

export type EventPublishRuntimeOptions = {
  activeAccountUserId(): string | null;
  client: MobileGatewayClient;
  database: SqlDatabase;
  isOnline(): boolean;
};

export class EventPublishRuntime {
  readonly controller: EventPublishController;

  constructor(options: EventPublishRuntimeOptions) {
    const onRootReadStarted = (accountUserId: string, rootEventId: string) =>
      deniedRootRegistry.arm(accountUserId, rootEventId);
    const onRootReadFinished = (
      accountUserId: string,
      rootEventId: string,
      verificationId: string,
    ) => deniedRootRegistry.finish(accountUserId, rootEventId, verificationId);
    const onRootPurged = (accountUserId: string) =>
      reconcileRetainedAttachmentFiles(
        new LocalAttachmentStore(options.database),
        accountUserId,
      );
    const sync = new MobileSyncEngine(options.database, options.client, {
      activeAccountUserId: options.activeAccountUserId,
      onRootPurged,
      onRootReadFinished,
      onRootReadStarted,
      randomUUID: secureUuidV4,
    });
    this.controller = new EventPublishController(
      options.database,
      options.client as GatewayClient,
      sync,
      {
        idempotencyKey: secureUuidV4,
        isOnline: options.isOnline,
        onRootPurged,
        onRootReadFinished,
        onRootReadStarted,
      },
    );
  }
}
