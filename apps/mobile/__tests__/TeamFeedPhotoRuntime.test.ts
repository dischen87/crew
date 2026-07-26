import {
  GatewayClientError,
  type GatewaySessionSubject,
} from '@crew/mobile-client';
import {
  type FeedPhotoLifecycle,
  LocalAttachmentStore,
  MobileDataStore,
  type RetainedLocalAttachment,
  type SqlDatabase,
} from '@crew/mobile-data';
import {
  discardFeedPhotoAttachment,
  pickAndRetainAttachment,
  previewRetainedAttachment,
  purgeRetainedAttachmentFiles,
  quiesceAttachmentMedia,
  resumeAttachmentMedia,
  uploadRetainedAttachment,
} from '../src/media/attachmentMedia';
import {
  discardTeamFeedPhoto,
  loadTeamFeedPhotoSource,
  markTeamFeedPhotoQueued,
  pickTeamFeedPhoto,
  prepareAndUploadTeamFeedPhoto,
  previewTeamFeedPhoto,
  recoverTeamFeedPhotoDescription,
  saveTeamFeedPhotoDescription,
  type TeamFeedPhotoDescription,
  type TeamFeedPhotoSelection,
} from '../src/screens/TeamFeedPhotoRuntime';
import { secureUuidV4 } from '../src/storage/secureRandom';
import type { TeamFeedPhotoViewModel } from '../src/team/TeamProductionRuntime';

jest.mock('../src/media/attachmentMedia', () => ({
  ...jest.requireActual('../src/media/attachmentMedia'),
  discardFeedPhotoAttachment: jest.fn(),
  pickAndRetainAttachment: jest.fn(),
  previewRetainedAttachment: jest.fn(),
  purgeRetainedAttachmentFiles: jest.fn(),
  uploadRetainedAttachment: jest.fn(),
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: jest.fn(),
}));

const accountUserId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_photo-root';
const eventId = 'evt_photo-day';
const feedEntryId = 'fed_00000000-0000-4000-8000-000000000001';
const attachmentId = 'att_00000000-0000-4000-8000-000000000002';
const sha256 = 'b'.repeat(64);
const retainedFileKey = `${sha256}.jpg`;
const attachment: RetainedLocalAttachment = {
  accountUserId,
  attachmentId,
  rootEventId,
  targetEntryId: feedEntryId,
  retainedFileKey,
  contentType: 'image/jpeg',
  byteCount: 1234,
  sha256,
  pixelWidth: 640,
  pixelHeight: 480,
  wasNormalized: true,
  retainedAt: '2026-07-20T12:00:00.000Z',
};
const prepared = {
  attachment,
  uploadPreparation: {
    attachmentId,
    targetEntryId: feedEntryId,
    contentType: 'image/jpeg' as const,
    byteCount: 1234,
    sha256,
  },
};
const selection: TeamFeedPhotoSelection = {
  eventId,
  feedEntryId,
  lifecycleState: 'feed_queued',
  prepared,
  uploadGeneration: 1,
  uploadId: null,
};
const database = {} as SqlDatabase;
const subject = { userId: accountUserId } as GatewaySessionSubject;

let persisted: FeedPhotoLifecycle;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  persisted = lifecycle(null);
  jest
    .spyOn(LocalAttachmentStore.prototype, 'getFeedPhoto')
    .mockImplementation(async () => persisted);
  jest
    .spyOn(LocalAttachmentStore.prototype, 'bindFeedPhotoUpload')
    .mockImplementation(async (_account, _attachment, generation, uploadId) => {
      persisted = {
        ...persisted,
        state: 'feed_queued',
        uploadGeneration: generation,
        uploadId,
      };
      return persisted;
    });
  jest
    .spyOn(LocalAttachmentStore.prototype, 'resetExpiredFeedPhotoUpload')
    .mockImplementation(async () => {
      persisted = {
        ...persisted,
        state: 'feed_queued',
        uploadGeneration: persisted.uploadGeneration + 1,
        uploadId: null,
      };
      return persisted;
    });
  jest
    .spyOn(LocalAttachmentStore.prototype, 'planConfirmedFeedPhotoCleanup')
    .mockResolvedValue({
      attachmentIds: [attachmentId],
      purgeFileKeys: [retainedFileKey],
    });
  jest
    .spyOn(LocalAttachmentStore.prototype, 'finalizeFeedPhotoCleanup')
    .mockResolvedValue();
  jest
    .spyOn(MobileDataStore.prototype, 'listDrafts')
    .mockResolvedValue([descriptionDraft({ kind: 'decorative' })]);
  jest.spyOn(MobileDataStore.prototype, 'putDraft').mockResolvedValue();
  jest.mocked(uploadRetainedAttachment).mockResolvedValue();
  jest.mocked(discardFeedPhotoAttachment).mockResolvedValue();
  jest
    .mocked(previewRetainedAttachment)
    .mockResolvedValue('data:image/png;base64,QUJDRA==');
  jest.mocked(purgeRetainedAttachmentFiles).mockResolvedValue();
});

test('picker binds one retained image to the exact future feed identity', async () => {
  jest
    .mocked(secureUuidV4)
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  jest.mocked(pickAndRetainAttachment).mockResolvedValue(prepared);

  await expect(
    pickTeamFeedPhoto(database, accountUserId, rootEventId, eventId),
  ).resolves.toEqual({
    ...selection,
    lifecycleState: 'selected',
  });
  expect(pickAndRetainAttachment).toHaveBeenCalledWith(expect.any(Object), {
    accountUserId,
    attachmentId,
    rootEventId,
    targetEntryId: feedEntryId,
  });
});

test('bounded preview reads only the retained account key', async () => {
  await expect(previewTeamFeedPhoto(selection)).resolves.toBe(
    'data:image/png;base64,QUJDRA==',
  );

  expect(previewRetainedAttachment).toHaveBeenCalledWith(
    accountUserId,
    retainedFileKey,
  );
});

test('caption draft is normalized and recovered inside the exact account, root and event scope', async () => {
  const description = {
    caption: '  Treffpunkt beim roten Eingang.  ',
    kind: 'informative',
  } as const;
  jest
    .mocked(MobileDataStore.prototype.listDrafts)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      descriptionDraft({
        caption: 'Treffpunkt beim roten Eingang.',
        kind: 'informative',
      }),
    ]);

  await expect(
    saveTeamFeedPhotoDescription(database, selection, description),
  ).resolves.toEqual({
    caption: 'Treffpunkt beim roten Eingang.',
    kind: 'informative',
  });
  expect(MobileDataStore.prototype.putDraft).toHaveBeenCalledWith(
    expect.objectContaining({
      accountUserId,
      entityType: 'team_feed_photo_description',
      eventId,
      id: `team-feed-photo-description:${attachmentId}`,
      rootEventId,
    }),
  );
  expect(
    JSON.parse(
      jest.mocked(MobileDataStore.prototype.putDraft).mock.calls[0]?.[0]
        .contentJson ?? '',
    ),
  ).toEqual({
    description: {
      caption: 'Treffpunkt beim roten Eingang.',
      kind: 'informative',
    },
    schemaVersion: 1,
    state: 'active',
  });
  await expect(
    recoverTeamFeedPhotoDescription(database, selection),
  ).resolves.toEqual({
    caption: 'Treffpunkt beim roten Eingang.',
    kind: 'informative',
  });
  expect(MobileDataStore.prototype.listDrafts).toHaveBeenLastCalledWith(
    accountUserId,
    rootEventId,
  );
});

test('discard removes retained media before replacing its caption with a content-free tombstone', async () => {
  const order: string[] = [];
  jest.mocked(discardFeedPhotoAttachment).mockImplementationOnce(async () => {
    order.push('media');
  });
  jest
    .mocked(MobileDataStore.prototype.putDraft)
    .mockImplementationOnce(async draft => {
      order.push('caption');
      expect(JSON.parse(draft.contentJson)).toEqual({
        schemaVersion: 1,
        state: 'cleared',
      });
    });

  await discardTeamFeedPhoto(database, selection);

  expect(order).toEqual(['media', 'caption']);
});

test('logout quiescence waits for a deferred retained preview before close', async () => {
  let releasePreview: (value: string) => void = () => {};
  const deferredPreview = new Promise<string>(resolve => {
    releasePreview = resolve;
  });
  jest
    .mocked(previewRetainedAttachment)
    .mockImplementationOnce(async () => deferredPreview);
  const operation = previewTeamFeedPhoto(selection);
  let closed = false;
  const close = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    closed = true;
  });

  await Promise.resolve();
  expect(closed).toBe(false);
  releasePreview('data:image/png;base64,QUJDRA==');
  await expect(operation).resolves.toBe('data:image/png;base64,QUJDRA==');
  await close;
  expect(closed).toBe(true);
  resumeAttachmentMedia(accountUserId);
});

test('logout quiescence drains mark-queued and discard DB lifecycles', async () => {
  let releaseQueued: (value: FeedPhotoLifecycle) => void = () => {};
  const queued = new Promise<FeedPhotoLifecycle>(resolve => {
    releaseQueued = resolve;
  });
  jest
    .spyOn(LocalAttachmentStore.prototype, 'markFeedPhotoQueued')
    .mockImplementationOnce(async () => queued);
  const mark = markTeamFeedPhotoQueued(database, {
    ...selection,
    lifecycleState: 'selected',
  });
  let markClosed = false;
  const markClose = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    markClosed = true;
  });

  await Promise.resolve();
  expect(markClosed).toBe(false);
  releaseQueued(lifecycle(null));
  await mark;
  await markClose;
  expect(markClosed).toBe(true);
  resumeAttachmentMedia(accountUserId);

  let releaseDiscard: () => void = () => {};
  const discarded = new Promise<void>(resolve => {
    releaseDiscard = resolve;
  });
  jest
    .mocked(discardFeedPhotoAttachment)
    .mockImplementationOnce(async () => discarded);
  const discard = discardTeamFeedPhoto(database, selection);
  let discardClosed = false;
  const discardClose = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    discardClosed = true;
  });

  await Promise.resolve();
  expect(discardClosed).toBe(false);
  releaseDiscard();
  await discard;
  await discardClose;
  expect(discardClosed).toBe(true);
  resumeAttachmentMedia(accountUserId);
});

test('replacement picker reuses the feed identity and creates a new attachment identity', async () => {
  jest
    .mocked(secureUuidV4)
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  jest.mocked(pickAndRetainAttachment).mockResolvedValue(prepared);

  await expect(
    pickTeamFeedPhoto(
      database,
      accountUserId,
      rootEventId,
      eventId,
      feedEntryId,
    ),
  ).resolves.toEqual({
    ...selection,
    lifecycleState: 'selected',
  });

  expect(secureUuidV4).toHaveBeenCalledTimes(1);
  expect(pickAndRetainAttachment).toHaveBeenCalledWith(expect.any(Object), {
    accountUserId,
    attachmentId,
    rootEventId,
    targetEntryId: feedEntryId,
  });
});

test('orders generated prepare, native upload and authoritative finalize before success', async () => {
  const order: string[] = [];
  const client = clientWith(async operationId => {
    order.push(
      operationId === 'eventAttachmentUploadsPrepare' ? 'prepare' : 'finalize',
    );
    return operationId === 'eventAttachmentUploadsPrepare'
      ? preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z')
      : committedResponse();
  });
  jest.mocked(uploadRetainedAttachment).mockImplementation(async () => {
    order.push('upload');
  });

  await expect(run(client)).resolves.toBe('upl_photo');

  expect(order).toEqual(['prepare', 'upload', 'finalize']);
  expect(client.requestAsUser.mock.calls.map(call => call[2])).toEqual([
    {
      path: { rootEventId },
      headers: {
        'idempotency-key': `feed-photo-p-1-${attachmentId}`,
      },
      body: prepared.uploadPreparation,
    },
    {
      path: { rootEventId, uploadId: 'upl_photo' },
      headers: {
        'idempotency-key': `feed-photo-f-1-${attachmentId}`,
      },
      body: { caption: null },
    },
  ]);
  expect(JSON.stringify(client.requestAsUser.mock.calls)).not.toMatch(
    /retained|file|uri|source|grant/i,
  );
  expect(
    LocalAttachmentStore.prototype.planConfirmedFeedPhotoCleanup,
  ).toHaveBeenCalledWith(
    accountUserId,
    attachmentId,
    1,
    'upl_photo',
    expect.any(String),
  );
  expect(purgeRetainedAttachmentFiles).toHaveBeenCalledWith(accountUserId, [
    retainedFileKey,
  ]);
  expect(
    LocalAttachmentStore.prototype.finalizeFeedPhotoCleanup,
  ).toHaveBeenCalledWith(accountUserId, [attachmentId]);
});

test('finalize sends the normalized informative caption and requires its authoritative echo', async () => {
  const description = {
    caption: '  Treffpunkt beim roten Eingang.  ',
    kind: 'informative',
  } as const;
  jest.mocked(MobileDataStore.prototype.listDrafts).mockResolvedValue([
    descriptionDraft({
      caption: 'Treffpunkt beim roten Eingang.',
      kind: 'informative',
    }),
  ]);
  const client = clientWith(async operationId =>
    operationId === 'eventAttachmentUploadsPrepare'
      ? preparedResponse('upl_caption', '2099-07-20T12:00:00.000Z')
      : committedResponse('Treffpunkt beim roten Eingang.'),
  );

  await expect(run(client, description)).resolves.toBe('upl_caption');

  expect(client.requestAsUser.mock.calls[1]?.[2]).toMatchObject({
    body: { caption: 'Treffpunkt beim roten Eingang.' },
  });
});

test('finalize rejects an authoritative caption that differs from the persisted contract', async () => {
  const description = {
    caption: 'Treffpunkt beim roten Eingang.',
    kind: 'informative',
  } as const;
  jest
    .mocked(MobileDataStore.prototype.listDrafts)
    .mockResolvedValue([descriptionDraft(description)]);
  const client = clientWith(async operationId =>
    operationId === 'eventAttachmentUploadsPrepare'
      ? preparedResponse('upl_caption', '2099-07-20T12:00:00.000Z')
      : committedResponse('Andere Beschreibung.'),
  );

  await expect(run(client, description)).rejects.toThrow(
    'team_feed_photo_invalid_response',
  );
  expect(
    LocalAttachmentStore.prototype.planConfirmedFeedPhotoCleanup,
  ).not.toHaveBeenCalled();
});

test('a failed local caption tombstone never converts an authoritative commit into a replay', async () => {
  jest
    .mocked(MobileDataStore.prototype.putDraft)
    .mockRejectedValueOnce(new Error('local caption cleanup unavailable'));
  const client = clientWith(async operationId =>
    operationId === 'eventAttachmentUploadsPrepare'
      ? preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z')
      : committedResponse(),
  );

  await expect(run(client)).resolves.toBe('upl_photo');
  expect(client.requestAsUser).toHaveBeenCalledTimes(2);
});

test('changed caption fails before session or upload work can start', async () => {
  const client = clientWith(async () =>
    preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z'),
  );

  await expect(
    run(client, {
      caption: 'Nicht die gespeicherte Beschreibung',
      kind: 'informative',
    }),
  ).rejects.toThrow('team_feed_photo_description_changed');
  expect(client.sessionSubject).not.toHaveBeenCalled();
  expect(uploadRetainedAttachment).not.toHaveBeenCalled();
});

test('download grant stays ephemeral and is accepted only for the exact synchronized photo', async () => {
  const client = clientWith(async operationId => {
    expect(operationId).toBe('eventAttachmentsDownload');
    return downloadResponse();
  });
  jest.mocked(MobileDataStore.prototype.putDraft).mockClear();

  await expect(
    loadTeamFeedPhotoSource({
      accountUserId,
      activeAccountUserId: () => accountUserId,
      client: client as never,
      photo: synchronizedPhoto(),
      rootEventId,
    }),
  ).resolves.toEqual({
    expiresAt: '2099-07-20T12:00:00.000Z',
    headers: {
      Authorization: 'Bearer short-lived',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
    uri: 'https://private.example.test/photo?grant=short-lived',
  });
  expect(client.requestAsUser).toHaveBeenCalledWith(
    subject,
    'eventAttachmentsDownload',
    {
      path: { attachmentId, rootEventId },
    },
  );
  expect(MobileDataStore.prototype.putDraft).not.toHaveBeenCalled();
});

test('download grant rejects a metadata mismatch and a late account switch', async () => {
  const mismatched = clientWith(async () =>
    downloadResponse({ caption: 'Andere Beschreibung' }),
  );
  await expect(
    loadTeamFeedPhotoSource({
      accountUserId,
      activeAccountUserId: () => accountUserId,
      client: mismatched as never,
      photo: synchronizedPhoto(),
      rootEventId,
    }),
  ).rejects.toThrow('team_feed_photo_invalid_response');

  const unsafeHeader = clientWith(async () => {
    const response = downloadResponse();
    response.data.download.headers.Authorization =
      'Bearer short-lived\nX-Injected: true';
    return response;
  });
  await expect(
    loadTeamFeedPhotoSource({
      accountUserId,
      activeAccountUserId: () => accountUserId,
      client: unsafeHeader as never,
      photo: synchronizedPhoto(),
      rootEventId,
    }),
  ).rejects.toThrow('team_feed_photo_invalid_response');

  let active: string | null = accountUserId;
  const switched = clientWith(async () => {
    active = `usr_${'c'.repeat(32)}`;
    return downloadResponse();
  });
  await expect(
    loadTeamFeedPhotoSource({
      accountUserId,
      activeAccountUserId: () => active,
      client: switched as never,
      photo: synchronizedPhoto(),
      rootEventId,
    }),
  ).rejects.toThrow('team_feed_photo_account_changed');
});

test('logout quiescence drains a deferred synchronized photo grant request', async () => {
  let releaseDownload!: (value: ReturnType<typeof downloadResponse>) => void;
  const deferred = new Promise<ReturnType<typeof downloadResponse>>(resolve => {
    releaseDownload = resolve;
  });
  const client = clientWith(async () => deferred);
  const operation = loadTeamFeedPhotoSource({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: client as never,
    photo: synchronizedPhoto(),
    rootEventId,
  });
  let closed = false;
  const close = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    closed = true;
  });

  await Promise.resolve();
  expect(closed).toBe(false);
  releaseDownload(downloadResponse());
  await expect(operation).resolves.toMatchObject({
    uri: 'https://private.example.test/photo?grant=short-lived',
  });
  await close;
  expect(closed).toBe(true);
  resumeAttachmentMedia(accountUserId);
});

test('logout quiescence drains upload, finalize, purge and final DB cleanup before close', async () => {
  const order: string[] = [];
  let closed = false;
  let announceUpload: () => void = () => {};
  let releaseUpload: () => void = () => {};
  let announcePurge: () => void = () => {};
  let releasePurge: () => void = () => {};
  const uploadStarted = new Promise<void>(resolve => {
    announceUpload = resolve;
  });
  const uploadGate = new Promise<void>(resolve => {
    releaseUpload = resolve;
  });
  const purgeStarted = new Promise<void>(resolve => {
    announcePurge = resolve;
  });
  const purgeGate = new Promise<void>(resolve => {
    releasePurge = resolve;
  });
  const client = clientWith(async operationId => {
    order.push(
      operationId === 'eventAttachmentUploadsPrepare'
        ? 'network-prepare'
        : 'network-finalize',
    );
    return operationId === 'eventAttachmentUploadsPrepare'
      ? preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z')
      : committedResponse();
  });
  jest.mocked(uploadRetainedAttachment).mockImplementationOnce(async () => {
    order.push('native-upload');
    announceUpload();
    await uploadGate;
  });
  jest.mocked(purgeRetainedAttachmentFiles).mockImplementationOnce(async () => {
    order.push('native-purge');
    announcePurge();
    await purgeGate;
  });
  jest
    .mocked(LocalAttachmentStore.prototype.finalizeFeedPhotoCleanup)
    .mockImplementationOnce(async () => {
      expect(closed).toBe(false);
      order.push('db-finalize');
    });

  const operation = run(client);
  await uploadStarted;
  const close = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    closed = true;
    order.push('close');
  });
  await Promise.resolve();
  expect(closed).toBe(false);

  releaseUpload();
  await purgeStarted;
  expect(closed).toBe(false);
  releasePurge();
  await expect(operation).resolves.toBe('upl_photo');
  await close;

  expect(order).toEqual([
    'network-prepare',
    'native-upload',
    'network-finalize',
    'native-purge',
    'db-finalize',
    'close',
  ]);
  resumeAttachmentMedia(accountUserId);
});

test('replays a lost finalize with the same generation without uploading twice', async () => {
  let finalizeAttempts = 0;
  const client = clientWith(async operationId => {
    if (operationId === 'eventAttachmentUploadsPrepare') {
      return preparedResponse('upl_lost', '2099-07-20T12:00:00.000Z');
    }
    finalizeAttempts += 1;
    if (finalizeAttempts === 1) throw new Error('response lost');
    return committedResponse();
  });

  await expect(run(client)).rejects.toThrow('response lost');
  expect(persisted.uploadId).toBe('upl_lost');
  await expect(run(client)).resolves.toBe('upl_lost');

  expect(uploadRetainedAttachment).toHaveBeenCalledTimes(1);
  const operations = client.requestAsUser.mock.calls.map(call => call[1]);
  expect(operations).toEqual([
    'eventAttachmentUploadsPrepare',
    'eventAttachmentUploadsFinalize',
    'eventAttachmentUploadsFinalize',
  ]);
  expect(client.requestAsUser.mock.calls[1]?.[2]).toEqual(
    client.requestAsUser.mock.calls[2]?.[2],
  );
});

test('keeps HTTP 202 pending and resumes finalize without a second upload', async () => {
  let finalizeAttempts = 0;
  const client = clientWith(async operationId => {
    if (operationId === 'eventAttachmentUploadsPrepare') {
      return preparedResponse('upl_pending', '2099-07-20T12:00:00.000Z');
    }
    finalizeAttempts += 1;
    return finalizeAttempts === 1
      ? pendingResponse('upl_pending')
      : committedResponse();
  });

  await expect(run(client)).rejects.toThrow('team_feed_photo_finalize_pending');
  await expect(run(client)).resolves.toBe('upl_pending');
  expect(uploadRetainedAttachment).toHaveBeenCalledTimes(1);
  expect(
    LocalAttachmentStore.prototype.planConfirmedFeedPhotoCleanup,
  ).toHaveBeenCalledTimes(1);
});

test('expires the old upload before rotating generation and preparing again', async () => {
  persisted = lifecycle('upl_expired');
  const order: string[] = [];
  const client = clientWith(async (operationId, request) => {
    const key = request.headers['idempotency-key'];
    order.push(key);
    if (key === `feed-photo-f-1-${attachmentId}`) throw uploadExpired();
    if (operationId === 'eventAttachmentUploadsPrepare') {
      return preparedResponse('upl_generation_two', '2099-07-20T12:00:00.000Z');
    }
    return committedResponse();
  });

  await expect(run(client)).resolves.toBe('upl_generation_two');

  expect(order).toEqual([
    `feed-photo-f-1-${attachmentId}`,
    `feed-photo-p-2-${attachmentId}`,
    `feed-photo-f-2-${attachmentId}`,
  ]);
  expect(
    LocalAttachmentStore.prototype.resetExpiredFeedPhotoUpload,
  ).toHaveBeenCalledWith(
    accountUserId,
    attachmentId,
    1,
    'upl_expired',
    expect.any(String),
  );
  expect(uploadRetainedAttachment).toHaveBeenCalledTimes(1);
});

test('an account switch after prepare prevents native upload and finalize', async () => {
  let active: string | null = accountUserId;
  const client = clientWith(async () => {
    active = `usr_${'c'.repeat(32)}`;
    return preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z');
  });

  await expect(
    prepareAndUploadTeamFeedPhoto({
      activeAccountUserId: () => active,
      client: client as never,
      database,
      description: { kind: 'decorative' },
      selection,
    }),
  ).rejects.toThrow('team_feed_photo_account_changed');
  expect(uploadRetainedAttachment).not.toHaveBeenCalled();
  expect(client.requestAsUser).toHaveBeenCalledTimes(1);
});

test('a mismatched prebound feed identity fails before session work', async () => {
  const client = clientWith(async () =>
    preparedResponse('upl_photo', '2099-07-20T12:00:00.000Z'),
  );

  await expect(
    prepareAndUploadTeamFeedPhoto({
      activeAccountUserId: () => accountUserId,
      client: client as never,
      database,
      description: { kind: 'decorative' },
      selection: { ...selection, feedEntryId: 'fed_different' },
    }),
  ).rejects.toThrow('team_feed_photo_invalid_binding');
  expect(client.sessionSubject).not.toHaveBeenCalled();
  expect(uploadRetainedAttachment).not.toHaveBeenCalled();
});

function lifecycle(uploadId: string | null): FeedPhotoLifecycle {
  return {
    attachment,
    eventId,
    state: 'feed_queued',
    uploadGeneration: 1,
    uploadId,
    createdAt: attachment.retainedAt,
    updatedAt: attachment.retainedAt,
  };
}

function clientWith(
  response: (
    operationId: string,
    request: {
      headers: Record<string, string>;
      path: Record<string, string>;
    },
  ) => Promise<unknown>,
) {
  return {
    sessionSubject: jest.fn(async () => subject),
    assertSessionSubject: jest.fn(async () => undefined),
    requestAsUser: jest.fn(
      async (
        _subject: GatewaySessionSubject,
        operationId: string,
        request: {
          headers: Record<string, string>;
          path: Record<string, string>;
        },
      ) => response(operationId, request),
    ),
  };
}

function run(
  client: ReturnType<typeof clientWith>,
  description: TeamFeedPhotoDescription = { kind: 'decorative' },
) {
  return prepareAndUploadTeamFeedPhoto({
    activeAccountUserId: () => accountUserId,
    client: client as never,
    database,
    description,
    selection,
  });
}

function preparedResponse(uploadId: string, expiresAt: string) {
  return {
    status: 201,
    requestId: 'req_prepare',
    data: {
      upload: {
        id: uploadId,
        attachmentId,
        rootEventId,
        target: { kind: 'feedEntry', entryId: feedEntryId },
        targetEntryId: feedEntryId,
        contentType: attachment.contentType,
        byteCount: attachment.byteCount,
        sha256: attachment.sha256,
        state: 'prepared',
        expiresAt,
        createdAt: attachment.retainedAt,
      },
      grant: {
        method: 'POST',
        url: 'https://uploads.example.test/photo',
        fields: { key: 'quarantine/photo' },
        expiresAt,
      },
    },
  };
}

function pendingResponse(uploadId: string) {
  return {
    status: 202,
    requestId: 'req_pending',
    data: {
      uploadId,
      verification: { retryable: true, state: 'pending' },
    },
  };
}

function committedResponse(caption: string | null = null) {
  return {
    status: 200,
    requestId: 'req_finalize',
    data: {
      attachment: {
        byteCount: attachment.byteCount,
        caption,
        contentType: attachment.contentType,
        createdAt: attachment.retainedAt,
        id: attachmentId,
        integrityStatus: 'integrity_verified',
        rootEventId,
        rootRevision: '1',
        sha256,
        target: { kind: 'feedEntry', entryId: feedEntryId },
        targetEntryId: feedEntryId,
        version: 1,
      },
    },
  };
}

function descriptionDraft(description: TeamFeedPhotoDescription) {
  return {
    accountUserId,
    contentJson: JSON.stringify({
      description,
      schemaVersion: 1,
      state: 'active',
    }),
    createdAt: '2026-07-20T12:00:00.000Z',
    entityType: 'team_feed_photo_description',
    eventId,
    id: `team-feed-photo-description:${attachmentId}`,
    rootEventId,
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
}

function synchronizedPhoto(): TeamFeedPhotoViewModel {
  return {
    byteCount: attachment.byteCount,
    caption: 'Treffpunkt beim roten Eingang.',
    contentType: attachment.contentType,
    id: attachmentId,
    sha256,
    targetEntryId: feedEntryId,
    version: 1,
  };
}

function downloadResponse(
  attachmentOverrides: Partial<{
    caption: string | null;
    id: string;
    rootEventId: string;
    targetEntryId: string | null;
  }> = {},
) {
  return {
    status: 200 as const,
    requestId: 'req_download',
    data: {
      attachment: {
        byteCount: attachment.byteCount,
        caption: 'Treffpunkt beim roten Eingang.',
        contentType: attachment.contentType,
        createdAt: attachment.retainedAt,
        id: attachmentId,
        integrityStatus: 'integrity_verified' as const,
        rootEventId,
        rootRevision: '1',
        sha256,
        target: { kind: 'feedEntry' as const, entryId: feedEntryId },
        targetEntryId: feedEntryId,
        version: 1,
        ...attachmentOverrides,
      },
      download: {
        expiresAt: '2099-07-20T12:00:00.000Z',
        headers: { Authorization: 'Bearer short-lived' },
        method: 'GET' as const,
        url: 'https://private.example.test/photo?grant=short-lived',
      },
    },
  };
}

function uploadExpired(): GatewayClientError {
  return new GatewayClientError({
    operationId: 'eventAttachmentUploadsFinalize',
    status: 409,
    requestId: 'req_upload_expired',
    code: 'UPLOAD_EXPIRED',
    retryable: false,
    retryAfterSeconds: null,
  });
}
