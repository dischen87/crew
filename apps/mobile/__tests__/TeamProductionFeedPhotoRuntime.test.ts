import {
  MobileDataStore,
  type FeedPhotoLifecycle,
  type MembershipRecord,
  type RetainedLocalAttachment,
} from '@crew/mobile-data';
import {
  quiesceAttachmentMedia,
  resumeAttachmentMedia,
} from '../src/media/attachmentMedia';
import { TeamProductionRuntime } from '../src/team/TeamProductionRuntime';

const mockReconcileFeedPhotos = jest.fn();

jest.mock('../src/media/attachmentMedia', () => ({
  ...jest.requireActual('../src/media/attachmentMedia'),
  reconcileFeedPhotoAttachments: (...args: unknown[]) =>
    mockReconcileFeedPhotos(...args),
}));

const accountUserId = `usr_${'a'.repeat(32)}`;
const rootEventId = 'evt_photo-root';
const eventId = 'evt_photo-day';
const attachment: RetainedLocalAttachment = {
  accountUserId,
  attachmentId: 'att_photo',
  rootEventId,
  targetEntryId: 'fed_photo',
  retainedFileKey: `${'b'.repeat(64)}.jpg`,
  contentType: 'image/jpeg',
  byteCount: 1234,
  sha256: 'b'.repeat(64),
  pixelWidth: 640,
  pixelHeight: 480,
  wasNormalized: true,
  retainedAt: '2026-07-20T12:00:00.000Z',
};

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest
    .spyOn(MobileDataStore.prototype, 'listMemberships')
    .mockResolvedValue([membership()]);
});

test('logout quiescence drains deferred feed-photo reconciliation before close', async () => {
  const actions: string[] = [];
  let closed = false;
  let releaseReconciliation: (
    photos: readonly FeedPhotoLifecycle[],
  ) => void = () => {};
  const reconciliation = new Promise<readonly FeedPhotoLifecycle[]>(resolve => {
    releaseReconciliation = resolve;
  });
  mockReconcileFeedPhotos.mockImplementationOnce(async () => {
    const photos = await reconciliation;
    expect(closed).toBe(false);
    actions.push('reconcile-finish');
    return photos;
  });
  const runtime = await TeamProductionRuntime.create({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: null,
    database: {} as never,
    deviceIdStore: { getOrCreate: async () => 'dvc_photo' },
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    rootEventId,
  });
  if (!runtime) throw new Error('Team runtime missing');

  const recovery = runtime.recoverFeedPhoto(eventId);
  const close = quiesceAttachmentMedia(accountUserId, {
    nativeModule: { cancelPending: async () => undefined },
  }).then(() => {
    closed = true;
    actions.push('close');
  });
  await Promise.resolve();
  expect(closed).toBe(false);

  const photo = lifecycle();
  releaseReconciliation([photo]);
  await expect(recovery).resolves.toBe(photo);
  await close;

  expect(actions).toEqual(['reconcile-finish', 'close']);
  resumeAttachmentMedia(accountUserId);
});

function membership(): MembershipRecord {
  return {
    accountUserId,
    createdAt: '2026-07-20T12:00:00.000Z',
    memberUserId: accountUserId,
    role: 'participant',
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-20T12:00:00.000Z',
    version: 1,
  };
}

function lifecycle(): FeedPhotoLifecycle {
  return {
    attachment,
    eventId,
    state: 'feed_queued',
    uploadGeneration: 1,
    uploadId: null,
    createdAt: attachment.retainedAt,
    updatedAt: attachment.retainedAt,
  };
}
