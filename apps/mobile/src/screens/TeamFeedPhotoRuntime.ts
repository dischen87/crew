import {
  GatewayClientError,
  type GatewayResponseData,
  type GatewaySessionSubject,
} from '@crew/mobile-client';
import {
  type FeedPhotoLifecycle,
  type FeedPhotoLifecycleState,
  LocalAttachmentStore,
  MobileDataStore,
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
import type { TeamFeedPhotoViewModel } from '../team/TeamProductionRuntime';

type PreparedUpload = GatewayResponseData<'eventAttachmentUploadsPrepare'>;
type CommittedAttachment = Extract<
  GatewayResponseData<'eventAttachmentUploadsFinalize'>,
  { attachment: unknown }
>['attachment'];

export type TeamFeedPhotoSelection = {
  eventId: string | null;
  feedEntryId: string;
  lifecycleState: FeedPhotoLifecycleState;
  prepared: PreparedAttachmentMedia;
  uploadGeneration: number;
  uploadId: string | null;
};

export const TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH = 1_000;

export type TeamFeedPhotoDescription =
  | { kind: 'decorative' }
  | { caption: string; kind: 'informative' };

export type TeamFeedPhotoSource = {
  expiresAt: string;
  headers: Readonly<Record<string, string>>;
  uri: string;
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
        eventId,
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
    eventId: lifecycle.eventId,
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
  return runAttachmentMediaOperation(attachment.accountUserId, async () => {
    await discardFeedPhotoAttachment(
      new LocalAttachmentStore(database),
      attachment.accountUserId,
      attachment.attachmentId,
    );
    await writeTeamFeedPhotoDescription(database, selection, null);
  });
}

export function saveTeamFeedPhotoDescription(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
  description: TeamFeedPhotoDescription,
): Promise<TeamFeedPhotoDescription> {
  const attachment = selection.prepared.attachment;
  const normalized = normalizeTeamFeedPhotoDescription(description);
  return runAttachmentMediaOperation(attachment.accountUserId, async () => {
    await writeTeamFeedPhotoDescription(database, selection, normalized);
    return normalized;
  });
}

export function recoverTeamFeedPhotoDescription(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
): Promise<TeamFeedPhotoDescription | null> {
  const attachment = selection.prepared.attachment;
  return runAttachmentMediaOperation(attachment.accountUserId, () =>
    readTeamFeedPhotoDescription(database, selection),
  );
}

export function loadTeamFeedPhotoSource(input: {
  activeAccountUserId(): string | null;
  accountUserId: string;
  client: MobileGatewayClient;
  photo: TeamFeedPhotoViewModel;
  rootEventId: string;
}): Promise<TeamFeedPhotoSource> {
  return runAttachmentMediaOperation(input.accountUserId, async () => {
    assertActive(input.activeAccountUserId, input.accountUserId);
    const subject = await input.client.sessionSubject();
    assertActive(input.activeAccountUserId, input.accountUserId);
    if (!subject || subject.userId !== input.accountUserId) {
      throw new Error('team_feed_photo_auth_required');
    }
    await input.client.assertSessionSubject(subject);
    assertActive(input.activeAccountUserId, input.accountUserId);
    const response = await input.client.requestAsUser(
      subject,
      'eventAttachmentsDownload',
      {
        path: {
          attachmentId: input.photo.id,
          rootEventId: input.rootEventId,
        },
      },
    );
    await input.client.assertSessionSubject(subject);
    assertActive(input.activeAccountUserId, input.accountUserId);
    if (response.status !== 200) {
      throw new Error('team_feed_photo_invalid_response');
    }
    return validPhotoSource(response.data, input.photo, input.rootEventId);
  });
}

export async function prepareAndUploadTeamFeedPhoto(input: {
  activeAccountUserId(): string | null;
  client: MobileGatewayClient;
  database: SqlDatabase;
  description: TeamFeedPhotoDescription;
  selection: TeamFeedPhotoSelection;
}): Promise<string> {
  const attachment = input.selection.prepared.attachment;
  if (input.selection.feedEntryId !== attachment.targetEntryId) {
    throw new Error('team_feed_photo_invalid_binding');
  }
  return runAttachmentMediaOperation(attachment.accountUserId, async () => {
    const description = normalizeTeamFeedPhotoDescription(input.description);
    const persistedDescription = await readTeamFeedPhotoDescription(
      input.database,
      input.selection,
    );
    if (!sameDescription(description, persistedDescription)) {
      throw new Error('team_feed_photo_description_changed');
    }
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
          await writeTeamFeedPhotoDescription(
            input.database,
            input.selection,
            null,
          ).catch(() => {
            // The authoritative attachment is committed. Local caption
            // minimization must not turn that success into an unsafe replay.
          });
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
    description: TeamFeedPhotoDescription;
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
        body: { caption: descriptionCaption(input.description) },
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
      committed.caption !== descriptionCaption(input.description) ||
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

async function readTeamFeedPhotoDescription(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
): Promise<TeamFeedPhotoDescription | null> {
  assertDescriptionBinding(selection);
  const attachment = selection.prepared.attachment;
  const drafts = await new MobileDataStore(database).listDrafts(
    attachment.accountUserId,
    attachment.rootEventId,
  );
  const draft = drafts.find(
    candidate =>
      candidate.id === descriptionDraftId(attachment.attachmentId) &&
      candidate.entityType === 'team_feed_photo_description' &&
      candidate.eventId === selection.eventId,
  );
  if (!draft) return null;
  try {
    const value = JSON.parse(draft.contentJson) as {
      description?: unknown;
      schemaVersion?: unknown;
      state?: unknown;
    };
    if (value.schemaVersion !== 1 || value.state !== 'active') return null;
    return normalizeTeamFeedPhotoDescription(value.description);
  } catch {
    return null;
  }
}

async function writeTeamFeedPhotoDescription(
  database: SqlDatabase,
  selection: TeamFeedPhotoSelection,
  description: TeamFeedPhotoDescription | null,
): Promise<void> {
  assertDescriptionBinding(selection);
  const attachment = selection.prepared.attachment;
  const store = new MobileDataStore(database);
  const id = descriptionDraftId(attachment.attachmentId);
  const existing = (
    await store.listDrafts(attachment.accountUserId, attachment.rootEventId)
  ).find(
    candidate =>
      candidate.id === id &&
      candidate.entityType === 'team_feed_photo_description' &&
      candidate.eventId === selection.eventId,
  );
  const now = new Date().toISOString();
  await store.putDraft({
    accountUserId: attachment.accountUserId,
    contentJson: JSON.stringify(
      description
        ? {
            description: normalizeTeamFeedPhotoDescription(description),
            schemaVersion: 1,
            state: 'active',
          }
        : { schemaVersion: 1, state: 'cleared' },
    ),
    createdAt: existing?.createdAt ?? now,
    entityType: 'team_feed_photo_description',
    eventId: selection.eventId,
    id,
    rootEventId: attachment.rootEventId,
    updatedAt: now,
  });
}

function normalizeTeamFeedPhotoDescription(
  value: unknown,
): TeamFeedPhotoDescription {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    throw new Error('team_feed_photo_description_required');
  }
  if (value.kind === 'decorative') return { kind: 'decorative' };
  if (
    value.kind !== 'informative' ||
    !('caption' in value) ||
    typeof value.caption !== 'string'
  ) {
    throw new Error('team_feed_photo_description_invalid');
  }
  const caption = value.caption.trim();
  if (
    caption.length < 1 ||
    caption.length > TEAM_FEED_PHOTO_CAPTION_MAX_LENGTH
  ) {
    throw new Error('team_feed_photo_description_invalid');
  }
  return { caption, kind: 'informative' };
}

function descriptionCaption(
  description: TeamFeedPhotoDescription,
): string | null {
  const normalized = normalizeTeamFeedPhotoDescription(description);
  return normalized.kind === 'informative' ? normalized.caption : null;
}

function sameDescription(
  left: TeamFeedPhotoDescription,
  right: TeamFeedPhotoDescription | null,
): boolean {
  if (!right || left.kind !== right.kind) return false;
  return (
    left.kind === 'decorative' ||
    (right.kind === 'informative' &&
      left.caption.trim() === right.caption.trim())
  );
}

function assertDescriptionBinding(selection: TeamFeedPhotoSelection): void {
  const attachment = selection.prepared.attachment;
  if (
    selection.feedEntryId !== attachment.targetEntryId ||
    !/^att_[A-Za-z0-9._:-]{1,96}$/.test(attachment.attachmentId) ||
    (selection.eventId !== null &&
      !/^evt_[A-Za-z0-9._:-]{1,96}$/.test(selection.eventId))
  ) {
    throw new Error('team_feed_photo_invalid_binding');
  }
}

function descriptionDraftId(attachmentId: string): string {
  return `team-feed-photo-description:${attachmentId}`;
}

function validPhotoSource(
  value: GatewayResponseData<'eventAttachmentsDownload'>,
  photo: TeamFeedPhotoViewModel,
  rootEventId: string,
): TeamFeedPhotoSource {
  const { attachment, download } = value;
  if (
    attachment.id !== photo.id ||
    attachment.rootEventId !== rootEventId ||
    attachment.target.kind !== 'feedEntry' ||
    attachment.target.entryId !== photo.targetEntryId ||
    attachment.targetEntryId !== photo.targetEntryId ||
    attachment.contentType !== photo.contentType ||
    attachment.byteCount !== photo.byteCount ||
    attachment.sha256 !== photo.sha256 ||
    attachment.caption !== photo.caption ||
    attachment.version !== photo.version ||
    attachment.integrityStatus !== 'integrity_verified' ||
    download.method !== 'GET' ||
    !Number.isFinite(Date.parse(download.expiresAt)) ||
    Date.parse(download.expiresAt) <= Date.now() ||
    download.url.length > 8_192
  ) {
    throw new Error('team_feed_photo_invalid_response');
  }
  let url: URL;
  try {
    url = new URL(download.url);
  } catch {
    throw new Error('team_feed_photo_invalid_response');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new Error('team_feed_photo_invalid_response');
  }
  const headers: Record<string, string> = {};
  let headerBytes = 0;
  let hasNoCachePragma = false;
  let hasNoStoreCacheControl = false;
  for (const [name, headerValue] of Object.entries(download.headers)) {
    if (
      !/^[A-Za-z0-9-]{1,128}$/.test(name) ||
      typeof headerValue !== 'string' ||
      headerValue.length > 16_384 ||
      hasUnsafeHeaderValue(headerValue)
    ) {
      throw new Error('team_feed_photo_invalid_response');
    }
    headerBytes += name.length + headerValue.length;
    headers[name] = headerValue;
    if (name.toLowerCase() === 'cache-control') {
      if (
        !headerValue
          .toLowerCase()
          .split(',')
          .map(directive => directive.trim())
          .includes('no-store')
      ) {
        throw new Error('team_feed_photo_invalid_response');
      }
      hasNoStoreCacheControl = true;
    }
    if (name.toLowerCase() === 'pragma') {
      if (headerValue.trim().toLowerCase() !== 'no-cache') {
        throw new Error('team_feed_photo_invalid_response');
      }
      hasNoCachePragma = true;
    }
  }
  if (headerBytes > 65_536) {
    throw new Error('team_feed_photo_invalid_response');
  }
  if (!hasNoStoreCacheControl) headers['Cache-Control'] = 'no-store';
  if (!hasNoCachePragma) headers.Pragma = 'no-cache';
  return {
    expiresAt: download.expiresAt,
    headers,
    uri: download.url,
  };
}

function hasUnsafeHeaderValue(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9) || code === 127) return true;
  }
  return false;
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
