import type { GatewayRequest } from '@crew/mobile-client';
import {
  FeedbackAttachmentUploadError,
  type AttachmentContentType,
  type FeedbackAttachmentUploadInput,
  type FeedbackAttachmentUploadTransport,
  type LocalAttachmentStore,
  type RetainedLocalAttachment,
  type SyncMutationDraft,
} from '@crew/mobile-data';
import NativeCrewAttachmentMedia, {
  type NativeRetainedAttachment,
  type Spec as NativeAttachmentMedia,
} from '../specs/NativeCrewAttachmentMedia';

type UploadPreparation =
  GatewayRequest<'eventAttachmentUploadsPrepare'>['body'];
type AttachmentCommit = Extract<
  SyncMutationDraft,
  { kind: 'attachment.commit' }
>;

export interface AttachmentMediaDraft {
  accountUserId: string;
  attachmentId: string;
  rootEventId: string;
  targetEntryId: string;
  sourceUri: string;
}

export interface PreparedAttachmentMedia {
  attachment: RetainedLocalAttachment;
  uploadPreparation: UploadPreparation;
}

export interface AttachmentMediaOptions {
  nativeModule?: Pick<
    NativeAttachmentMedia,
    'normalizeAndRetain' | 'reconcileRetained'
  > | null;
  now?: () => Date;
}

export interface AttachmentReconciliationOptions {
  nativeModule?: Pick<NativeAttachmentMedia, 'reconcileRetained'> | null;
}

export interface ScreenCaptureOptions {
  nativeModule?: Pick<NativeAttachmentMedia, 'captureCurrentScreen'> | null;
}

export interface RetainedAttachmentPreviewOptions {
  nativeModule?: Pick<NativeAttachmentMedia, 'previewRetained'> | null;
}

export interface RetainedAttachmentUploadOptions {
  nativeModule?: Pick<NativeAttachmentMedia, 'uploadRetained'> | null;
  now?: () => Date;
}

export interface RetainedAttachmentPurgeOptions {
  nativeModule?: Pick<NativeAttachmentMedia, 'purgeRetained'> | null;
}

const contentTypes = new Set<AttachmentContentType>([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const extensionByContentType: Record<AttachmentContentType, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const captureErrorCodes = new Set([
  'attachment_media_capture_unavailable',
  'attachment_media_capture_failed',
  'attachment_media_unsafe',
  'attachment_media_storage',
  'attachment_media_invalid',
]);
const uploadErrorCodes = new Set([
  'attachment_media_missing',
  'attachment_media_unsafe',
  'attachment_media_invalid',
  'attachment_media_storage',
  'attachment_media_upload_retryable',
  'attachment_media_upload_unavailable',
  'attachment_media_upload_failed',
]);
const previewErrorCodes = new Set([
  'attachment_media_preview_unavailable',
  'attachment_media_preview_failed',
  'attachment_media_missing',
  'attachment_media_unsafe',
  'attachment_media_invalid',
  'attachment_media_storage',
]);
const purgeErrorCodes = new Set([
  'attachment_media_invalid',
  'attachment_media_unsafe',
  'attachment_media_storage',
]);
const retainedScreenshotKeyPattern = /^[a-f0-9]{64}\.png$/;
const purgeBatchSize = 64;

export async function captureCurrentScreenAttachment(
  accountUserId: string,
  options: ScreenCaptureOptions = {},
): Promise<NativeRetainedAttachment> {
  if (!/^usr_[a-f0-9]{32}$/.test(accountUserId)) {
    throw new Error('attachment_media_invalid');
  }
  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) {
    throw new Error('attachment_media_capture_unavailable');
  }
  try {
    const result = validateNativeResult(
      await nativeModule.captureCurrentScreen(accountUserId),
    );
    if (
      result.contentType !== 'image/png' ||
      result.wasNormalized !== true ||
      result.pixelWidth > 2048 ||
      result.pixelHeight > 2048 ||
      result.pixelWidth * result.pixelHeight > 16 * 1024 * 1024
    ) {
      throw new Error('invalid capture result');
    }
    return result;
  } catch (error) {
    const code = captureErrorCode(error);
    throw new Error(code);
  }
}

export async function previewRetainedAttachment(
  accountUserId: string,
  retainedFileKey: string,
  options: RetainedAttachmentPreviewOptions = {},
): Promise<string> {
  if (
    !/^usr_[a-f0-9]{32}$/.test(accountUserId) ||
    !/^[a-f0-9]{64}\.png$/.test(retainedFileKey)
  ) {
    throw new Error('attachment_media_invalid');
  }
  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) {
    throw new Error('attachment_media_preview_unavailable');
  }
  try {
    const preview = await nativeModule.previewRetained(
      accountUserId,
      retainedFileKey,
    );
    const prefix = 'data:image/png;base64,';
    const encoded = preview.startsWith(prefix)
      ? preview.slice(prefix.length)
      : '';
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    const decodedBytes = (encoded.length / 4) * 3 - padding;
    if (
      encoded.length < 4 ||
      encoded.length > 699_052 ||
      encoded.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
      !Number.isSafeInteger(decodedBytes) ||
      decodedBytes < 1 ||
      decodedBytes > 512 * 1024
    ) {
      throw new Error('invalid preview');
    }
    return preview;
  } catch (error) {
    throw new Error(
      safeErrorCode(
        error,
        previewErrorCodes,
        'attachment_media_preview_failed',
      ),
    );
  }
}

export async function uploadRetainedAttachment(
  input: FeedbackAttachmentUploadInput,
  options: RetainedAttachmentUploadOptions = {},
): Promise<void> {
  const fields = validateUploadInput(input, options.now?.() ?? new Date());
  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) {
    throw new Error('attachment_media_upload_unavailable');
  }
  try {
    await nativeModule.uploadRetained(
      input.accountUserId,
      input.retainedFileKey,
      input.grant.url,
      fields,
      input.contentType,
      input.byteCount,
      input.sha256,
    );
  } catch (error) {
    throw new Error(
      safeErrorCode(error, uploadErrorCodes, 'attachment_media_upload_failed'),
    );
  }
}

export async function purgeRetainedAttachmentFiles(
  accountUserId: string,
  retainedFileKeys: readonly string[],
  options: RetainedAttachmentPurgeOptions = {},
): Promise<void> {
  if (!/^usr_[a-f0-9]{32}$/.test(accountUserId)) {
    throw new Error('attachment_media_invalid');
  }
  const keys = [...new Set(retainedFileKeys)];
  if (keys.some(key => !retainedScreenshotKeyPattern.test(key))) {
    throw new Error('attachment_media_invalid');
  }
  if (keys.length === 0) return;

  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) throw new Error('attachment_media_purge_unavailable');
  try {
    for (let offset = 0; offset < keys.length; offset += purgeBatchSize) {
      await nativeModule.purgeRetained(
        accountUserId,
        keys.slice(offset, offset + purgeBatchSize),
      );
    }
  } catch (error) {
    throw new Error(
      safeErrorCode(error, purgeErrorCodes, 'attachment_media_purge_failed'),
    );
  }
}

export function createFeedbackAttachmentUploadTransport(
  options: RetainedAttachmentUploadOptions = {},
): FeedbackAttachmentUploadTransport {
  return {
    async upload(input) {
      try {
        await uploadRetainedAttachment(input, options);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (code === 'attachment_media_missing') {
          throw new FeedbackAttachmentUploadError('missing_file');
        }
        if (
          code === 'attachment_media_unsafe' ||
          code === 'attachment_media_invalid'
        ) {
          throw new FeedbackAttachmentUploadError('unsafe');
        }
        if (code === 'attachment_media_storage') {
          throw new FeedbackAttachmentUploadError('storage');
        }
        throw new FeedbackAttachmentUploadError(
          'unavailable',
          code === 'attachment_media_upload_retryable',
        );
      }
    },
  };
}

export async function normalizeAndRetainAttachment(
  store: Pick<LocalAttachmentStore, 'listRetainedFileKeys' | 'retain'>,
  draft: AttachmentMediaDraft,
  options: AttachmentMediaOptions = {},
): Promise<PreparedAttachmentMedia> {
  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) {
    throw new Error('Native attachment media processing is unavailable');
  }
  await reconcileRetainedAttachmentFiles(store, draft.accountUserId, {
    nativeModule,
  });

  const native = validateNativeResult(
    await nativeModule.normalizeAndRetain(draft.accountUserId, draft.sourceUri),
  );
  const attachment = await store.retain({
    accountUserId: draft.accountUserId,
    attachmentId: draft.attachmentId,
    rootEventId: draft.rootEventId,
    targetEntryId: draft.targetEntryId,
    retainedFileKey: native.retainedFileKey,
    contentType: native.contentType,
    byteCount: native.byteCount,
    sha256: native.sha256,
    pixelWidth: native.pixelWidth,
    pixelHeight: native.pixelHeight,
    wasNormalized: native.wasNormalized,
    retainedAt: (options.now ?? (() => new Date()))().toISOString(),
  });

  return {
    attachment,
    uploadPreparation: {
      attachmentId: attachment.attachmentId,
      targetEntryId: attachment.targetEntryId,
      contentType: attachment.contentType,
      byteCount: attachment.byteCount,
      sha256: attachment.sha256,
    },
  };
}

export async function reconcileRetainedAttachmentFiles(
  store: Pick<LocalAttachmentStore, 'listRetainedFileKeys'>,
  accountUserId: string,
  options: AttachmentReconciliationOptions = {},
): Promise<void> {
  const nativeModule = options.nativeModule ?? NativeCrewAttachmentMedia;
  if (!nativeModule) return;
  await nativeModule.reconcileRetained(
    accountUserId,
    await store.listRetainedFileKeys(accountUserId),
  );
}

export function verifiedAttachmentCommit(
  attachment: RetainedLocalAttachment,
  uploadId: string,
  caption: string | null = null,
): AttachmentCommit {
  if (!/^upl_[A-Za-z0-9._:-]{1,96}$/.test(uploadId)) {
    throw new Error('Invalid attachment upload ID');
  }
  return {
    kind: 'attachment.commit',
    entityId: attachment.attachmentId,
    payload: { uploadId, caption },
  };
}

function validateNativeResult(
  value: NativeRetainedAttachment,
): Omit<RetainedLocalAttachment, keyof AttachmentMediaDraft | 'retainedAt'> {
  if (!contentTypes.has(value.contentType as AttachmentContentType)) {
    throw new Error('Native media processor returned an invalid content type');
  }
  const contentType = value.contentType as AttachmentContentType;
  if (!/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('Native media processor returned an invalid SHA-256');
  }
  if (
    value.retainedFileKey !==
    `${value.sha256}${extensionByContentType[contentType]}`
  ) {
    throw new Error('Native media processor returned an invalid file identity');
  }
  if (
    !Number.isSafeInteger(value.byteCount) ||
    value.byteCount < 1 ||
    value.byteCount > 20 * 1024 * 1024
  ) {
    throw new Error('Native media processor returned an invalid byte count');
  }
  for (const size of [value.pixelWidth, value.pixelHeight]) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 4096) {
      throw new Error('Native media processor returned invalid dimensions');
    }
  }
  if (typeof value.wasNormalized !== 'boolean') {
    throw new Error('Native media processor returned an invalid result');
  }
  return { ...value, contentType };
}

function captureErrorCode(error: unknown): string {
  return safeErrorCode(
    error,
    captureErrorCodes,
    'attachment_media_capture_failed',
  );
}

function safeErrorCode(
  error: unknown,
  allowed: ReadonlySet<string>,
  fallback: string,
): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && allowed.has(code)) return code;
  }
  if (error instanceof Error && allowed.has(error.message)) {
    return error.message;
  }
  return fallback;
}

function validateUploadInput(
  input: FeedbackAttachmentUploadInput,
  now: Date,
): ReadonlyArray<{ name: string; value: string }> {
  const fields = Object.entries(input.grant.fields);
  let url: URL;
  try {
    url = new URL(input.grant.url);
  } catch {
    throw new Error('attachment_media_invalid');
  }
  if (
    !/^usr_[a-f0-9]{32}$/.test(input.accountUserId) ||
    !/^att_[A-Za-z0-9._:-]{1,96}$/.test(input.attachmentId) ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.retainedFileKey !== `${input.sha256}.png` ||
    input.contentType !== 'image/png' ||
    !Number.isSafeInteger(input.byteCount) ||
    input.byteCount < 1 ||
    input.byteCount > 20 * 1024 * 1024 ||
    input.grant.method !== 'POST' ||
    !Number.isFinite(Date.parse(input.grant.expiresAt)) ||
    Date.parse(input.grant.expiresAt) <= now.getTime() ||
    input.grant.url.length > 8192 ||
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    fields.length < 1 ||
    fields.length > 64
  ) {
    throw new Error('attachment_media_invalid');
  }
  let fieldBytes = 0;
  for (const [name, value] of fields) {
    if (
      !/^[A-Za-z0-9_.-]{1,128}$/.test(name) ||
      name.toLowerCase() === 'file' ||
      typeof value !== 'string'
    ) {
      throw new Error('attachment_media_invalid');
    }
    const valueBytes = new TextEncoder().encode(value).length;
    fieldBytes += new TextEncoder().encode(name).length + valueBytes;
    if (valueBytes > 16 * 1024) {
      throw new Error('attachment_media_invalid');
    }
  }
  if (fieldBytes > 64 * 1024) {
    throw new Error('attachment_media_invalid');
  }
  return fields.map(([name, value]) => ({ name, value }));
}
