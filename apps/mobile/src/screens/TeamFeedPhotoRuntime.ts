import {
  GatewayClientError,
  type GatewayResponseData,
  type GatewaySessionSubject,
} from '@crew/mobile-client';
import {
  type FeedPhotoLifecycle,
  type FeedPhotoLifecycleState,
  LocalAttachmentStore,
  type RetainedLocalAttachment,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import {
  discardFeedPhotoAttachment,
  pickAndRetainAttachment,
  type PreparedAttachmentMedia,
  previewRetainedAttachment,
  purgeRetainedAttachmentFiles,
  runAttachmentMediaOperation,
  uploadRetainedAttachment,
} from '../media/attachmentMedia';
import { secureUuidV4 } from '../storage/secureRandom';

type PreparedUpload = GatewayResponseData<'eventAttachmentUploadsPrepare'>;
type CommittedAttachment = Extract<
  GatewayResponseData<'eventAttachmentUploadsFinalize'>,
  { attachment: unknown }
>['attachment'];

export type TeamFeedPhotoSelection = {
  feedEntryId: string;
  lifecycleState: FeedPhotoLifecycleState;
  prepared: PreparedAttachmentMedia;
  uploadGeneration: number;
  uploadId: string | null;
};

export async function pickTeamFeedPhoto(
  database: SqlDatabase,
  accountUserId: string,
  rootEventId: string,
  eventId: string | null,
  existingFeedEntryId?: string,
): Promise<TeamFeedPhotoSelection | null> {
  if (
    existingFeedEntryId !== undefined &&
    !/^fed_[A-Za-z0-9._:-]{1,96}$/.test(existingFeedEntryId)
  ) {
    throw new Error('team_feed_photo_invalid_binding');
  }
  const feedEntryId = existingFeedEntryId ?? `fed_${secureUuidV4()}`;
  const attachmentId = `att_${secureUuidV4()}`;
  const store = new LocalAttachmentStore(database);
  const prepared = await pickAndRetainAttachment(
    {
      retain: async attachment =>
        (
          await store.retainFeedPhoto(attachment, eventId)
        ).attachment,
    },
    { accountUserId, attachmentId, rootEventId, targetEntryId: feedEntryId },
  );
  return prepared
    ? {
        feedEntryId,
        lifecycleState: 'selected',
        prepared,
        uploadGeneration: 1,
        uploadId: null,
      }
    : null;
}

export function previewTeamFeedPhoto(
  selection: TeamFeedPhotoSelection,
): Promise<string> {
  const attachment = selection.prepared.attachment;
  return runAttachmentMediaOperation(attachment.accountUserId, () =>
    previewRetainedAttachment(
      attachment.accountUserId,
      attachment.retainedFileKey,
    ),
  );
}

export function recoveredTeamFeedPhoto(
  lifecycle: FeedPhotoLifecycle,
): TeamFeedPhotoSelection {
  const { attachment } = lifecycle;
  return {
    feedEntryId: attachment.targetEntryId,
    lifecycleState: lifecycle.state,
    prepared: {
      attachment,
      uploadPreparation: {
        attachmentId: attachment.attachmentId,
        targetEntryId: attachment.targetEntryId,
        contentType: attachment.contentType,
        byteCount: attachment.byteCount,
        sha256: attachment.sha256,
      },
    },
    uploadGeneration: lifecycle.uploadGeneration,
    uploadId: lifecycle.uploadId,
  };
}

export async function markTeamFeedPhotoQueued(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
): Promise<TeamFeedPhotoSelection> {
  const attachment = selection.prepared.attachment;
  return runAttachmentMediaOperation(attachment.accountUserId, async () => {
    const lifecycle = await new LocalAttachmentStore(
      database,
    ).markFeedPhotoQueued(
      attachment.accountUserId,
      attachment.attachmentId,
      new Date().toISOString(),
    );
    return recoveredTeamFeedPhoto(lifecycle);
  });
}

export function discardTeamFeedPhoto(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
): Promise<void> {
  const attachment = selection.prepared.attachment;
  return runAttachmentMediaOperation(attachment.accountUserId, () =>
    discardFeedPhotoAttachment(
      new LocalAttachmentStore(database),
      attachment.accountUserId,
      attachment.attachmentId,
    ),
  );
}

export async function prepareAndUploadTeamFeedPhoto(input: {
  activeAccountUserId(): string | null;
  client: MobileGatewayClient;
  database: SqlDatabase;
  selection: TeamFeedPhotoSelection;
}): Promise<string> {
  const attachment = input.selection.prepared.attachment;
  if (input.selection.feedEntryId !== attachment.targetEntryId) {
    throw new Error('team_feed_photo_invalid_binding');
  }
  return runAttachmentMediaOperation(attachment.accountUserId, async () => {
    assertActive(input.activeAccountUserId, attachment.accountUserId);
    const subject = await input.client.sessionSubject();
    assertActive(input.activeAccountUserId, attachment.accountUserId);
    if (!subject || subject.userId !== attachment.accountUserId) {
      throw new Error('team_feed_photo_auth_required');
    }
    await input.client.assertSessionSubject(subject);
    assertActive(input.activeAccountUserId, attachment.accountUserId);
    const store = new LocalAttachmentStore(input.database);
    let lifecycle = await store.getFeedPhoto(
      attachment.accountUserId,
      attachment.attachmentId,
    );
    assertActive(input.activeAccountUserId, attachment.accountUserId);
    if (!lifecycle) throw new Error('team_feed_photo_lifecycle_missing');
    if (lifecycle.state === 'selected') {
      throw new Error('team_feed_photo_feed_not_queued');
    }

    while (lifecycle.uploadGeneration <= 20) {
      if (lifecycle.uploadId) {
        const outcome = await finalizeUpload(input, subject, lifecycle);
        if (outcome === 'committed') {
          await cleanupConfirmedPhoto(input, subject, store, lifecycle);
          return lifecycle.uploadId;
        }
        if (outcome === 'pending') {
          throw new Error('team_feed_photo_finalize_pending');
        }
        lifecycle = await store.resetExpiredFeedPhotoUpload(
          attachment.accountUserId,
          attachment.attachmentId,
          lifecycle.uploadGeneration,
          lifecycle.uploadId,
          new Date().toISOString(),
        );
        await assertSessionActive(input, subject, attachment.accountUserId);
        continue;
      }

      const response = await input.client.requestAsUser(
        subject,
        'eventAttachmentUploadsPrepare',
        {
          path: { rootEventId: attachment.rootEventId },
          headers: {
            'idempotency-key': prepareIdempotencyKey(
              attachment.attachmentId,
              lifecycle.uploadGeneration,
            ),
          },
          body: input.selection.prepared.uploadPreparation,
        },
      );
      await assertSessionActive(input, subject, attachment.accountUserId);
      if (response.status !== 201) {
        throw new Error('team_feed_photo_invalid_response');
      }
      const upload = validPreparedUpload(response.data, attachment);

      if (Date.parse(upload.grant.expiresAt) <= Date.now()) {
        lifecycle = await store.bindFeedPhotoUpload(
          attachment.accountUserId,
          attachment.attachmentId,
          lifecycle.uploadGeneration,
          upload.uploadId,
          new Date().toISOString(),
        );
        await assertSessionActive(input, subject, attachment.accountUserId);
        continue;
      }

      await uploadRetainedAttachment({
        accountUserId: attachment.accountUserId,
        attachmentId: attachment.attachmentId,
        retainedFileKey: attachment.retainedFileKey,
        contentType: attachment.contentType,
        byteCount: attachment.byteCount,
        sha256: attachment.sha256,
        grant: upload.grant,
      });
      await assertSessionActive(input, subject, attachment.accountUserId);
      lifecycle = await store.bindFeedPhotoUpload(
        attachment.accountUserId,
        attachment.attachmentId,
        lifecycle.uploadGeneration,
        upload.uploadId,
        new Date().toISOString(),
      );
      await assertSessionActive(input, subject, attachment.accountUserId);
    }
    throw new Error('team_feed_photo_retry_exhausted');
  });
}

function validPreparedUpload(
  value: PreparedUpload,
  attachment: RetainedLocalAttachment,
): { grant: PreparedUpload['grant']; uploadId: string } {
  const { grant, upload } = value;
  if (
    !/^upl_[A-Za-z0-9._:-]{1,96}$/.test(upload.id) ||
    upload.attachmentId !== attachment.attachmentId ||
    upload.rootEventId !== attachment.rootEventId ||
    upload.target.kind !== 'feedEntry' ||
    upload.target.entryId !== attachment.targetEntryId ||
    upload.targetEntryId !== attachment.targetEntryId ||
    upload.contentType !== attachment.contentType ||
    upload.byteCount !== attachment.byteCount ||
    upload.sha256 !== attachment.sha256 ||
    upload.state !== 'prepared' ||
    grant.method !== 'POST' ||
    !Number.isFinite(Date.parse(grant.expiresAt))
  ) {
    throw new Error('team_feed_photo_invalid_response');
  }
  return { grant, uploadId: upload.id };
}

async function finalizeUpload(
  input: {
    activeAccountUserId(): string | null;
    client: MobileGatewayClient;
    selection: TeamFeedPhotoSelection;
  },
  subject: GatewaySessionSubject,
  lifecycle: FeedPhotoLifecycle,
): Promise<'committed' | 'expired' | 'pending'> {
  const attachment = lifecycle.attachment;
  const uploadId = lifecycle.uploadId;
  if (!uploadId) throw new Error('team_feed_photo_lifecycle_invalid');
  try {
    const response = await input.client.requestAsUser(
      subject,
      'eventAttachmentUploadsFinalize',
      {
        path: { rootEventId: attachment.rootEventId, uploadId },
        headers: {
          'idempotency-key': finalizeIdempotencyKey(
            attachment.attachmentId,
            lifecycle.uploadGeneration,
          ),
        },
        body: { caption: null },
      },
    );
    await assertSessionActive(input, subject, attachment.accountUserId);
    if (response.status === 202) {
      const pending = response.data as {
        uploadId?: unknown;
        verification?: { retryable?: unknown; state?: unknown };
      };
      if (
        pending.uploadId !== uploadId ||
        pending.verification?.retryable !== true ||
        !['pending', 'processing', 'retry'].includes(
          String(pending.verification?.state),
        )
      ) {
        throw new Error('team_feed_photo_invalid_response');
      }
      return 'pending';
    }
    if (response.status !== 200) {
      throw new Error('team_feed_photo_invalid_response');
    }
    const committed = (response.data as { attachment?: CommittedAttachment })
      .attachment;
    if (
      !committed ||
      committed.id !== attachment.attachmentId ||
      committed.rootEventId !== attachment.rootEventId ||
      committed.target.kind !== 'feedEntry' ||
      committed.target.entryId !== attachment.targetEntryId ||
      committed.targetEntryId !== attachment.targetEntryId ||
      committed.contentType !== attachment.contentType ||
      committed.byteCount !== attachment.byteCount ||
      committed.sha256 !== attachment.sha256 ||
      committed.integrityStatus !== 'integrity_verified'
    ) {
      throw new Error('team_feed_photo_invalid_response');
    }
    return 'committed';
  } catch (error) {
    assertActive(input.activeAccountUserId, attachment.accountUserId);
    if (
      error instanceof GatewayClientError &&
      error.code === 'UPLOAD_EXPIRED'
    ) {
      return 'expired';
    }
    throw error;
  }
}

async function cleanupConfirmedPhoto(
  input: {
    activeAccountUserId(): string | null;
    client: MobileGatewayClient;
  },
  subject: GatewaySessionSubject,
  store: LocalAttachmentStore,
  lifecycle: FeedPhotoLifecycle,
): Promise<void> {
  const attachment = lifecycle.attachment;
  const uploadId = lifecycle.uploadId;
  if (!uploadId) throw new Error('team_feed_photo_lifecycle_invalid');
  const cleanup = await store.planConfirmedFeedPhotoCleanup(
    attachment.accountUserId,
    attachment.attachmentId,
    lifecycle.uploadGeneration,
    uploadId,
    new Date().toISOString(),
  );
  try {
    await assertSessionActive(input, subject, attachment.accountUserId);
    await purgeRetainedAttachmentFiles(
      attachment.accountUserId,
      cleanup.purgeFileKeys,
    );
    await assertSessionActive(input, subject, attachment.accountUserId);
    await store.finalizeFeedPhotoCleanup(
      attachment.accountUserId,
      cleanup.attachmentIds,
    );
    await assertSessionActive(input, subject, attachment.accountUserId);
  } catch {
    // cleanup_pending remains durable for the next scoped reconciliation
  }
}

async function assertSessionActive(
  input: {
    activeAccountUserId(): string | null;
    client: MobileGatewayClient;
  },
  subject: GatewaySessionSubject,
  accountUserId: string,
): Promise<void> {
  assertActive(input.activeAccountUserId, accountUserId);
  await input.client.assertSessionSubject(subject);
  assertActive(input.activeAccountUserId, accountUserId);
}

function prepareIdempotencyKey(
  attachmentId: string,
  uploadGeneration: number,
): string {
  return `feed-photo-p-${uploadGeneration}-${attachmentId}`;
}

function finalizeIdempotencyKey(
  attachmentId: string,
  uploadGeneration: number,
): string {
  return `feed-photo-f-${uploadGeneration}-${attachmentId}`;
}

function assertActive(
  activeAccountUserId: () => string | null,
  accountUserId: string,
): void {
  if (activeAccountUserId() !== accountUserId) {
    throw new Error('team_feed_photo_account_changed');
  }
}
