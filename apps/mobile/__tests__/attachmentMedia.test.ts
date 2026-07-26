import type {
  LocalAttachmentStore,
  RetainedLocalAttachment,
} from '@crew/mobile-data';
import { FeedbackAttachmentUploadError } from '@crew/mobile-data';
import type { Session } from '@crew/mobile-client';
import {
  bootstrapPrivateDatabase,
  type ClosableSqlDatabase,
} from '../src/app/PrivateBootstrapGate';
import {
  captureCurrentScreenAttachment,
  createFeedbackAttachmentUploadTransport,
  discardFeedPhotoAttachment,
  normalizeAndRetainAttachment,
  pickAndRetainAttachment,
  previewRetainedAttachment,
  purgeRetainedAttachmentFiles,
  quiesceAttachmentMedia,
  reconcileFeedPhotoAttachments,
  reconcileRetainedAttachmentFiles,
  resumeAttachmentMedia,
  uploadRetainedAttachment,
  verifiedAttachmentCommit,
} from '../src/media/attachmentMedia';

const draft = {
  accountUserId: `usr_${'a'.repeat(32)}`,
  attachmentId: 'att_camera',
  rootEventId: 'evt_trip',
  targetEntryId: 'fed_pending',
  sourceUri: 'file:///private/tmp/IMG_0042.HEIC',
};
const retainedAt = new Date('2026-07-18T12:00:00.000Z');

function fakeStore() {
  return {
    listRetainedFileKeys: jest.fn(async () => []),
    retain: jest.fn(async (attachment: RetainedLocalAttachment) => attachment),
  } satisfies Pick<LocalAttachmentStore, 'listRetainedFileKeys' | 'retain'>;
}

test('picker cancel returns null without durable identity or a source URI', async () => {
  const store = fakeStore();
  const nativeModule = {
    pickImageAndRetain: jest.fn(async () => null),
  };

  await expect(
    pickAndRetainAttachment(
      store,
      {
        accountUserId: draft.accountUserId,
        attachmentId: draft.attachmentId,
        rootEventId: draft.rootEventId,
        targetEntryId: draft.targetEntryId,
      },
      { nativeModule },
    ),
  ).resolves.toBeNull();
  expect(nativeModule.pickImageAndRetain).toHaveBeenCalledWith(
    draft.accountUserId,
  );
  expect(store.retain).not.toHaveBeenCalled();
  expect(
    JSON.stringify(nativeModule.pickImageAndRetain.mock.calls),
  ).not.toMatch(/(?:content|file):\/\//);
});

test('picker retains only normalized metadata and hides native causes', async () => {
  const sha256 = '4'.repeat(64);
  const store = fakeStore();
  const prepared = await pickAndRetainAttachment(
    store,
    {
      accountUserId: draft.accountUserId,
      attachmentId: draft.attachmentId,
      rootEventId: draft.rootEventId,
      targetEntryId: draft.targetEntryId,
    },
    {
      nativeModule: {
        pickImageAndRetain: async () => ({
          retainedFileKey: `${sha256}.jpg`,
          contentType: 'image/jpeg',
          byteCount: 4096,
          sha256,
          pixelWidth: 3024,
          pixelHeight: 4032,
          wasNormalized: true,
        }),
      },
      now: () => retainedAt,
    },
  );

  expect(prepared?.attachment).toMatchObject({
    retainedFileKey: `${sha256}.jpg`,
    contentType: 'image/jpeg',
    wasNormalized: true,
    retainedAt: retainedAt.toISOString(),
  });
  expect(JSON.stringify(prepared)).not.toMatch(/(?:content|file):\/\//);

  await expect(
    pickAndRetainAttachment(
      store,
      {
        accountUserId: draft.accountUserId,
        attachmentId: draft.attachmentId,
        rootEventId: draft.rootEventId,
        targetEntryId: draft.targetEntryId,
      },
      {
        nativeModule: {
          pickImageAndRetain: async () =>
            Promise.reject(new Error('content://private/provider/42')),
        },
      },
    ),
  ).rejects.toThrow(/^attachment_media_picker_failed$/);
});

test('quiesce cancels a presented picker, blocks new work, and is idempotent', async () => {
  let resolvePicker: (value: null) => void = () => {};
  const pickerResult = new Promise<null>(resolve => {
    resolvePicker = resolve;
  });
  const store = fakeStore();
  const nativeModule = {
    pickImageAndRetain: jest.fn(() => pickerResult),
    cancelPending: jest.fn(async () => {
      resolvePicker(null);
    }),
  };
  const operation = pickAndRetainAttachment(
    store,
    {
      accountUserId: draft.accountUserId,
      attachmentId: draft.attachmentId,
      rootEventId: draft.rootEventId,
      targetEntryId: draft.targetEntryId,
    },
    { nativeModule },
  );

  const first = quiesceAttachmentMedia(draft.accountUserId, { nativeModule });
  const second = quiesceAttachmentMedia(draft.accountUserId, { nativeModule });

  expect(second).toBe(first);
  await expect(operation).resolves.toBeNull();
  await expect(first).resolves.toBeUndefined();
  expect(nativeModule.cancelPending).toHaveBeenCalledTimes(1);
  await expect(
    pickAndRetainAttachment(
      store,
      {
        accountUserId: draft.accountUserId,
        attachmentId: 'att_blocked',
        rootEventId: draft.rootEventId,
        targetEntryId: draft.targetEntryId,
      },
      { nativeModule },
    ),
  ).rejects.toThrow(/^attachment_media_picker_unavailable$/);

  resumeAttachmentMedia(draft.accountUserId);
});

test('quiesce drains the durable retain before private data can close', async () => {
  const sha256 = '5'.repeat(64);
  let releaseRetain: () => void = () => {};
  let announceRetain: () => void = () => {};
  const retainGate = new Promise<void>(resolve => {
    releaseRetain = resolve;
  });
  const retainStarted = new Promise<void>(resolve => {
    announceRetain = resolve;
  });
  const store = fakeStore();
  jest
    .mocked(store.retain)
    .mockImplementation(async (attachment: RetainedLocalAttachment) => {
      announceRetain();
      await retainGate;
      return attachment;
    });
  const nativeModule = {
    pickImageAndRetain: jest.fn(async () => ({
      retainedFileKey: `${sha256}.jpg`,
      contentType: 'image/jpeg' as const,
      byteCount: 4096,
      sha256,
      pixelWidth: 3024,
      pixelHeight: 4032,
      wasNormalized: true,
    })),
    cancelPending: jest.fn(async () => undefined),
  };
  const operation = pickAndRetainAttachment(
    store,
    {
      accountUserId: draft.accountUserId,
      attachmentId: 'att_drain',
      rootEventId: draft.rootEventId,
      targetEntryId: draft.targetEntryId,
    },
    { nativeModule, now: () => retainedAt },
  );
  await retainStarted;

  let drained = false;
  const quiescence = quiesceAttachmentMedia(draft.accountUserId, {
    nativeModule,
  }).then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);

  releaseRetain();
  await expect(operation).resolves.toMatchObject({
    attachment: { attachmentId: 'att_drain' },
  });
  await quiescence;
  expect(drained).toBe(true);

  resumeAttachmentMedia(draft.accountUserId);
});

test('quiesce also drains legacy normalize through its SQLite retain', async () => {
  const sha256 = '6'.repeat(64);
  let releaseRetain: () => void = () => {};
  let announceRetain: () => void = () => {};
  const retainGate = new Promise<void>(resolve => {
    releaseRetain = resolve;
  });
  const retainStarted = new Promise<void>(resolve => {
    announceRetain = resolve;
  });
  const store = fakeStore();
  jest
    .mocked(store.retain)
    .mockImplementation(async (attachment: RetainedLocalAttachment) => {
      announceRetain();
      await retainGate;
      return attachment;
    });
  const nativeModule = {
    reconcileRetained: jest.fn(async () => undefined),
    normalizeAndRetain: jest.fn(async () => ({
      retainedFileKey: `${sha256}.jpg`,
      contentType: 'image/jpeg' as const,
      byteCount: 4096,
      sha256,
      pixelWidth: 1200,
      pixelHeight: 800,
      wasNormalized: true,
    })),
    cancelPending: jest.fn(async () => undefined),
  };
  const operation = normalizeAndRetainAttachment(store, draft, {
    nativeModule,
    now: () => retainedAt,
  });
  await retainStarted;

  let drained = false;
  const quiescence = quiesceAttachmentMedia(draft.accountUserId, {
    nativeModule,
  }).then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);

  releaseRetain();
  await operation;
  await quiescence;
  expect(drained).toBe(true);

  resumeAttachmentMedia(draft.accountUserId);
});

test('captures only on an explicit call and accepts a bounded normalized PNG', async () => {
  const sha256 = '9'.repeat(64);
  const nativeModule = {
    captureCurrentScreen: jest.fn(async () => ({
      retainedFileKey: `${sha256}.png`,
      contentType: 'image/png',
      byteCount: 4096,
      sha256,
      pixelWidth: 1170,
      pixelHeight: 2048,
      wasNormalized: true,
    })),
  };

  expect(nativeModule.captureCurrentScreen).not.toHaveBeenCalled();
  await expect(
    captureCurrentScreenAttachment(draft.accountUserId, { nativeModule }),
  ).resolves.toEqual({
    retainedFileKey: `${sha256}.png`,
    contentType: 'image/png',
    byteCount: 4096,
    sha256,
    pixelWidth: 1170,
    pixelHeight: 2048,
    wasNormalized: true,
  });
  expect(nativeModule.captureCurrentScreen).toHaveBeenCalledWith(
    draft.accountUserId,
  );
});

test.each([
  'attachment_media_capture_unavailable',
  'attachment_media_capture_failed',
  'attachment_media_unsafe',
  'attachment_media_storage',
  'attachment_media_invalid',
])('preserves the safe capture error %s without a native cause', async code => {
  const error = Object.assign(new Error('/private/leaked/path'), { code });
  await expect(
    captureCurrentScreenAttachment(draft.accountUserId, {
      nativeModule: { captureCurrentScreen: async () => Promise.reject(error) },
    }),
  ).rejects.toThrow(new RegExp(`^${code}$`));
});

test('maps malformed native capture output and unknown causes to a fixed failure', async () => {
  const sha256 = '8'.repeat(64);
  await expect(
    captureCurrentScreenAttachment(draft.accountUserId, {
      nativeModule: {
        captureCurrentScreen: async () => ({
          retainedFileKey: `${sha256}.jpg`,
          contentType: 'image/jpeg',
          byteCount: 4096,
          sha256,
          pixelWidth: 1200,
          pixelHeight: 800,
          wasNormalized: true,
        }),
      },
    }),
  ).rejects.toThrow(/^attachment_media_capture_failed$/);

  await expect(
    captureCurrentScreenAttachment(draft.accountUserId, {
      nativeModule: {
        captureCurrentScreen: async () => {
          throw new Error('/private/leaked/path');
        },
      },
    }),
  ).rejects.toThrow(/^attachment_media_capture_failed$/);
});

test('fails before native capture for an invalid account or missing module', async () => {
  const nativeModule = { captureCurrentScreen: jest.fn() };
  await expect(
    captureCurrentScreenAttachment('usr_wrong', { nativeModule }),
  ).rejects.toThrow(/^attachment_media_invalid$/);
  expect(nativeModule.captureCurrentScreen).not.toHaveBeenCalled();
  await expect(
    captureCurrentScreenAttachment(draft.accountUserId, { nativeModule: null }),
  ).rejects.toThrow(/^attachment_media_capture_unavailable$/);
});

test('returns only a bounded ephemeral retained screenshot preview', async () => {
  const preview = 'data:image/png;base64,Ym91bmRlZCBwbmc=';
  const nativeModule = { previewRetained: jest.fn(async () => preview) };

  await expect(
    previewRetainedAttachment(draft.accountUserId, `${'7'.repeat(64)}.png`, {
      nativeModule,
    }),
  ).resolves.toBe(preview);
  expect(nativeModule.previewRetained).toHaveBeenCalledWith(
    draft.accountUserId,
    `${'7'.repeat(64)}.png`,
  );
  expect(preview).not.toContain('file://');
});

test.each(['jpg', 'png', 'webp'])(
  'previews a retained %s without exposing its private path',
  async extension => {
    const preview = 'data:image/png;base64,Ym91bmRlZCBwbmc=';
    const nativeModule = { previewRetained: jest.fn(async () => preview) };
    const retainedFileKey = `${'6'.repeat(64)}.${extension}`;

    await expect(
      previewRetainedAttachment(draft.accountUserId, retainedFileKey, {
        nativeModule,
      }),
    ).resolves.toBe(preview);
    expect(nativeModule.previewRetained).toHaveBeenCalledWith(
      draft.accountUserId,
      retainedFileKey,
    );
  },
);

test.each([
  ['usr_wrong', `${'7'.repeat(64)}.png`],
  [draft.accountUserId, '../private.png'],
])(
  'rejects an invalid preview account or key before native access',
  async (accountUserId, retainedFileKey) => {
    const nativeModule = { previewRetained: jest.fn() };

    await expect(
      previewRetainedAttachment(accountUserId, retainedFileKey, {
        nativeModule,
      }),
    ).rejects.toThrow(/^attachment_media_invalid$/);
    expect(nativeModule.previewRetained).not.toHaveBeenCalled();
  },
);

test('accepts the exact preview byte ceiling and rejects one byte over or malformed padding', async () => {
  const prefix = 'data:image/png;base64,';
  const exactEncoded = `${'A'.repeat(699_051)}=`;
  const nativeModule = {
    previewRetained: jest
      .fn()
      .mockResolvedValueOnce(prefix + exactEncoded)
      .mockResolvedValueOnce(prefix + 'A'.repeat(699_052))
      .mockResolvedValueOnce(`${prefix}AA=A`),
  };
  const preview = () =>
    previewRetainedAttachment(draft.accountUserId, `${'7'.repeat(64)}.png`, {
      nativeModule,
    });

  await expect(preview()).resolves.toBe(prefix + exactEncoded);
  await expect(preview()).rejects.toThrow(/^attachment_media_preview_failed$/);
  await expect(preview()).rejects.toThrow(/^attachment_media_preview_failed$/);
});

test('rejects malformed previews and hides native preview causes', async () => {
  await expect(
    previewRetainedAttachment(draft.accountUserId, `${'7'.repeat(64)}.png`, {
      nativeModule: {
        previewRetained: async () => 'file:///private/full-resolution.png',
      },
    }),
  ).rejects.toThrow(/^attachment_media_preview_failed$/);
  await expect(
    previewRetainedAttachment(draft.accountUserId, `${'7'.repeat(64)}.png`, {
      nativeModule: {
        previewRetained: async () => {
          throw Object.assign(new Error('/private/leak'), {
            code: 'attachment_media_unsafe',
          });
        },
      },
    }),
  ).rejects.toThrow(/^attachment_media_unsafe$/);
});

const uploadInput = {
  accountUserId: draft.accountUserId,
  attachmentId: draft.attachmentId,
  retainedFileKey: `${'7'.repeat(64)}.png`,
  contentType: 'image/png' as const,
  byteCount: 4096,
  sha256: '7'.repeat(64),
  grant: {
    method: 'POST' as const,
    url: 'https://objects.example.test/upload',
    fields: {
      key: 'feedback/private.png',
      policy: 'signed-policy',
      'x-amz-signature': 'signed-value',
    },
    expiresAt: '2026-07-18T12:10:00.000Z',
  },
};

test('adapts a bounded POST grant to native fields without exposing a file URI', async () => {
  const nativeModule = { uploadRetained: jest.fn(async () => undefined) };
  await createFeedbackAttachmentUploadTransport({
    nativeModule,
    now: () => retainedAt,
  }).upload(uploadInput);

  expect(nativeModule.uploadRetained).toHaveBeenCalledWith(
    uploadInput.accountUserId,
    uploadInput.retainedFileKey,
    uploadInput.grant.url,
    [
      { name: 'key', value: 'feedback/private.png' },
      { name: 'policy', value: 'signed-policy' },
      { name: 'x-amz-signature', value: 'signed-value' },
    ],
    'image/png',
    4096,
    uploadInput.sha256,
  );
  expect(JSON.stringify(nativeModule.uploadRetained.mock.calls)).not.toContain(
    'file://',
  );
});

test('uploads a normalized JPEG with its verified retained identity', async () => {
  const sha256 = '5'.repeat(64);
  const nativeModule = { uploadRetained: jest.fn(async () => undefined) };
  await uploadRetainedAttachment(
    {
      ...uploadInput,
      retainedFileKey: `${sha256}.jpg`,
      contentType: 'image/jpeg',
      sha256,
    },
    { nativeModule, now: () => retainedAt },
  );

  expect(nativeModule.uploadRetained).toHaveBeenCalledWith(
    uploadInput.accountUserId,
    `${sha256}.jpg`,
    uploadInput.grant.url,
    expect.any(Array),
    'image/jpeg',
    uploadInput.byteCount,
    sha256,
  );
});

test('fails closed before native upload for expired, non-HTTPS, or mismatched grants', async () => {
  const nativeModule = { uploadRetained: jest.fn(async () => undefined) };
  for (const input of [
    {
      ...uploadInput,
      grant: { ...uploadInput.grant, expiresAt: retainedAt.toISOString() },
    },
    {
      ...uploadInput,
      grant: {
        ...uploadInput.grant,
        url: 'http://objects.example.test/upload',
      },
    },
    {
      ...uploadInput,
      grant: { ...uploadInput.grant, fields: { FILE: 'reserved' } },
    },
    { ...uploadInput, retainedFileKey: `${'6'.repeat(64)}.png` },
  ]) {
    await expect(
      uploadRetainedAttachment(input, {
        nativeModule,
        now: () => retainedAt,
      }),
    ).rejects.toThrow(/^attachment_media_invalid$/);
  }
  expect(nativeModule.uploadRetained).not.toHaveBeenCalled();
});

test('preserves only safe native upload codes and hides unknown causes', async () => {
  for (const [nativeError, expected] of [
    [
      Object.assign(new Error('private grant leaked'), {
        code: 'attachment_media_upload_retryable',
      }),
      'attachment_media_upload_retryable',
    ],
    [
      new Error('https://signed.example/private'),
      'attachment_media_upload_failed',
    ],
  ] as const) {
    await expect(
      uploadRetainedAttachment(uploadInput, {
        now: () => retainedAt,
        nativeModule: {
          uploadRetained: async () => Promise.reject(nativeError),
        },
      }),
    ).rejects.toThrow(new RegExp(`^${expected}$`));
  }
});

test('purges exact screenshot keys through bounded sequential native batches', async () => {
  const retainedFileKeys = Array.from(
    { length: 130 },
    (_, index) => `${index.toString(16).padStart(64, '0')}.png`,
  );
  const calls: readonly string[][] = [];
  const nativeModule = {
    purgeRetained: jest.fn(async (_accountId, keys: readonly string[]) => {
      (calls as string[][]).push([...keys]);
    }),
  };

  await purgeRetainedAttachmentFiles(
    draft.accountUserId,
    [...retainedFileKeys, retainedFileKeys[0]],
    { nativeModule },
  );

  expect(calls.map(batch => batch.length)).toEqual([64, 64, 2]);
  expect(calls.flat()).toEqual(retainedFileKeys);
  expect(
    nativeModule.purgeRetained.mock.calls.every(([, keys]) => keys.length > 0),
  ).toBe(true);
});

test('skips an empty purge allow-list and validates every key before native deletion', async () => {
  const nativeModule = { purgeRetained: jest.fn(async () => undefined) };
  await purgeRetainedAttachmentFiles(draft.accountUserId, [], {
    nativeModule,
  });
  expect(nativeModule.purgeRetained).not.toHaveBeenCalled();

  await expect(
    purgeRetainedAttachmentFiles(
      draft.accountUserId,
      [`${'7'.repeat(64)}.png`, '../private.png'],
      { nativeModule },
    ),
  ).rejects.toThrow(/^attachment_media_invalid$/);
  expect(nativeModule.purgeRetained).not.toHaveBeenCalled();
});

test('purges retained JPEG, PNG, and WebP identities', async () => {
  const keys = ['jpg', 'png', 'webp'].map(
    (extension, index) => `${String(index + 4).repeat(64)}.${extension}`,
  );
  const nativeModule = { purgeRetained: jest.fn(async () => undefined) };

  await purgeRetainedAttachmentFiles(draft.accountUserId, keys, {
    nativeModule,
  });

  expect(nativeModule.purgeRetained).toHaveBeenCalledWith(
    draft.accountUserId,
    keys,
  );
});

test('preserves only safe native purge codes and hides private causes', async () => {
  const retainedFileKey = `${'7'.repeat(64)}.png`;
  for (const [failure, expected] of [
    [
      Object.assign(new Error(`/private/${retainedFileKey}`), {
        code: 'attachment_media_unsafe',
      }),
      'attachment_media_unsafe',
    ],
    [new Error(`/private/${retainedFileKey}`), 'attachment_media_purge_failed'],
  ] as const) {
    await expect(
      purgeRetainedAttachmentFiles(draft.accountUserId, [retainedFileKey], {
        nativeModule: {
          purgeRetained: async () => Promise.reject(failure),
        },
      }),
    ).rejects.toThrow(new RegExp(`^${expected}$`));
  }
});

test('feed photo discard purges native data before finalizing its durable row', async () => {
  const calls: string[] = [];
  const retainedFileKey = `${'7'.repeat(64)}.jpg`;
  const store = {
    planFeedPhotoDiscard: jest.fn(async () => {
      calls.push('plan');
      return {
        attachmentIds: ['att_feed'],
        purgeFileKeys: [retainedFileKey],
      };
    }),
    finalizeFeedPhotoCleanup: jest.fn(async () => {
      calls.push('finalize');
    }),
  };
  const nativeModule = {
    purgeRetained: jest.fn(async () => {
      calls.push('purge');
    }),
  };

  await discardFeedPhotoAttachment(store, draft.accountUserId, 'att_feed', {
    nativeModule,
    now: () => retainedAt,
  });

  expect(calls).toEqual(['plan', 'purge', 'finalize']);
  expect(store.planFeedPhotoDiscard).toHaveBeenCalledWith(
    draft.accountUserId,
    'att_feed',
    retainedAt.toISOString(),
  );
  expect(store.finalizeFeedPhotoCleanup).toHaveBeenCalledWith(
    draft.accountUserId,
    ['att_feed'],
  );
});

test('feed photo cleanup never finalizes when native purge fails', async () => {
  const store = {
    planFeedPhotoDiscard: jest.fn(async () => ({
      attachmentIds: ['att_feed'],
      purgeFileKeys: [`${'7'.repeat(64)}.jpg`],
    })),
    finalizeFeedPhotoCleanup: jest.fn(async () => undefined),
  };

  await expect(
    discardFeedPhotoAttachment(store, draft.accountUserId, 'att_feed', {
      nativeModule: {
        purgeRetained: async () =>
          Promise.reject(new Error('private purge failure')),
      },
    }),
  ).rejects.toThrow(/^attachment_media_purge_failed$/);
  expect(store.finalizeFeedPhotoCleanup).not.toHaveBeenCalled();
});

test('feed photo reconciliation directly finalizes an empty native purge plan', async () => {
  const attachment: RetainedLocalAttachment = {
    accountUserId: draft.accountUserId,
    attachmentId: 'att_feed',
    rootEventId: draft.rootEventId,
    targetEntryId: draft.targetEntryId,
    retainedFileKey: `${'7'.repeat(64)}.jpg`,
    contentType: 'image/jpeg',
    byteCount: 4096,
    sha256: '7'.repeat(64),
    pixelWidth: 1200,
    pixelHeight: 800,
    wasNormalized: false,
    retainedAt: retainedAt.toISOString(),
  };
  const photos = [
    {
      attachment,
      eventId: null,
      state: 'selected' as const,
      uploadGeneration: 0,
      uploadId: null,
      createdAt: retainedAt.toISOString(),
      updatedAt: retainedAt.toISOString(),
    },
  ];
  const store = {
    reconcileFeedPhotos: jest.fn(async () => ({
      photos,
      cleanup: { attachmentIds: [], purgeFileKeys: [] },
    })),
    finalizeFeedPhotoCleanup: jest.fn(async () => undefined),
  };
  const nativeModule = { purgeRetained: jest.fn(async () => undefined) };

  await expect(
    reconcileFeedPhotoAttachments(
      store,
      draft.accountUserId,
      draft.rootEventId,
      { nativeModule, now: () => retainedAt },
    ),
  ).resolves.toBe(photos);
  expect(nativeModule.purgeRetained).not.toHaveBeenCalled();
  expect(store.finalizeFeedPhotoCleanup).toHaveBeenCalledWith(
    draft.accountUserId,
    [],
  );
});

test.each([
  ['attachment_media_missing', 'missing_file', false],
  ['attachment_media_unsafe', 'unsafe', false],
  ['attachment_media_invalid', 'unsafe', false],
  ['attachment_media_storage', 'storage', false],
  ['attachment_media_upload_retryable', 'unavailable', true],
  ['attachment_media_upload_unavailable', 'unavailable', false],
  ['attachment_media_upload_failed', 'unavailable', false],
] as const)(
  'maps native transport code %s to %s (retryable=%s)',
  async (code, failure, retryable) => {
    const error = Object.assign(new Error('private native cause'), { code });
    const transport = createFeedbackAttachmentUploadTransport({
      now: () => retainedAt,
      nativeModule: {
        uploadRetained: async () => Promise.reject(error),
      },
    });

    await expect(transport.upload(uploadInput)).rejects.toMatchObject({
      name: 'FeedbackAttachmentUploadError',
      failure,
      retryable,
    });
    await transport.upload(uploadInput).catch(caught => {
      expect(caught).toBeInstanceOf(FeedbackAttachmentUploadError);
      expect(String(caught)).not.toContain('private native cause');
    });
  },
);

test('normalizes HEIF before retaining identity and upload metadata', async () => {
  const sha256 = 'b'.repeat(64);
  const nativeModule = {
    reconcileRetained: jest.fn(async () => undefined),
    normalizeAndRetain: jest.fn(async () => ({
      retainedFileKey: `${sha256}.jpg`,
      contentType: 'image/jpeg',
      byteCount: 1_024_000,
      sha256,
      pixelWidth: 3024,
      pixelHeight: 4032,
      wasNormalized: true,
    })),
  };
  const store = fakeStore();

  const prepared = await normalizeAndRetainAttachment(store, draft, {
    nativeModule,
    now: () => retainedAt,
  });

  expect(nativeModule.normalizeAndRetain).toHaveBeenCalledWith(
    draft.accountUserId,
    draft.sourceUri,
  );
  expect(store.retain).toHaveBeenCalledWith({
    accountUserId: draft.accountUserId,
    attachmentId: draft.attachmentId,
    rootEventId: draft.rootEventId,
    targetEntryId: draft.targetEntryId,
    retainedFileKey: `${sha256}.jpg`,
    contentType: 'image/jpeg',
    byteCount: 1_024_000,
    sha256,
    pixelWidth: 3024,
    pixelHeight: 4032,
    wasNormalized: true,
    retainedAt: retainedAt.toISOString(),
  });
  expect(prepared.uploadPreparation).toEqual({
    attachmentId: draft.attachmentId,
    targetEntryId: draft.targetEntryId,
    contentType: 'image/jpeg',
    byteCount: 1_024_000,
    sha256,
  });
  expect(JSON.stringify(prepared.uploadPreparation)).not.toContain('file://');
  expect(JSON.stringify(prepared.uploadPreparation)).not.toContain(
    'retainedFileKey',
  );
});

test('a stale prepare sweep preserves a fresh final until its DB row commits', async () => {
  const dbKeys = new Set<string>();
  const retainedFiles = new Set<string>();
  const events: string[] = [];
  let releaseFirstRetain: () => void = () => {};
  let announceFirstRetain: () => void = () => {};
  const firstRetainGate = new Promise<void>(resolve => {
    releaseFirstRetain = resolve;
  });
  const firstRetainStarted = new Promise<void>(resolve => {
    announceFirstRetain = resolve;
  });
  const nativeModule = {
    reconcileRetained: jest.fn(
      async (_accountId, referenced: readonly string[]) => {
        events.push('reconcile');
        for (const fileKey of retainedFiles) {
          if (!referenced.includes(fileKey)) {
            // Native mtime grace preserves every fresh in-flight final here.
            continue;
          }
        }
      },
    ),
    normalizeAndRetain: jest.fn(async (_accountId, sourceUri: string) => {
      events.push('normalize');
      const sha256 = sourceUri.includes('first')
        ? '1'.repeat(64)
        : '2'.repeat(64);
      retainedFiles.add(`${sha256}.jpg`);
      return {
        retainedFileKey: `${sha256}.jpg`,
        contentType: 'image/jpeg',
        byteCount: 2048,
        sha256,
        pixelWidth: 1200,
        pixelHeight: 800,
        wasNormalized: true,
      };
    }),
  };
  const store = {
    listRetainedFileKeys: jest.fn(async () => [...dbKeys]),
    retain: jest.fn(async (attachment: RetainedLocalAttachment) => {
      if (attachment.attachmentId === 'att_first') {
        announceFirstRetain();
        await firstRetainGate;
      }
      dbKeys.add(attachment.retainedFileKey);
      return attachment;
    }),
  };

  const first = normalizeAndRetainAttachment(
    store,
    {
      ...draft,
      attachmentId: 'att_first',
      sourceUri: 'file:///private/first.HEIC',
    },
    { nativeModule, now: () => retainedAt },
  );
  await firstRetainStarted;
  const second = await normalizeAndRetainAttachment(
    store,
    {
      ...draft,
      attachmentId: 'att_second',
      sourceUri: 'file:///private/second.HEIC',
    },
    { nativeModule, now: () => retainedAt },
  );

  expect(dbKeys).toEqual(new Set([second.attachment.retainedFileKey]));
  expect(retainedFiles).toContain(`${'1'.repeat(64)}.jpg`);
  releaseFirstRetain();
  await first;
  expect(dbKeys).toEqual(retainedFiles);
  expect(events).toEqual(['reconcile', 'normalize', 'reconcile', 'normalize']);
});

test.each([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])('passes bounded %s bytes through', async (contentType, extension) => {
  const sha256 = 'c'.repeat(64);
  const store = fakeStore();
  const prepared = await normalizeAndRetainAttachment(store, draft, {
    nativeModule: {
      reconcileRetained: async () => undefined,
      normalizeAndRetain: async () => ({
        retainedFileKey: `${sha256}.${extension}`,
        contentType,
        byteCount: 2048,
        sha256,
        pixelWidth: 1200,
        pixelHeight: 800,
        wasNormalized: false,
      }),
    },
    now: () => retainedAt,
  });

  expect(prepared.attachment).toMatchObject({
    retainedFileKey: `${sha256}.${extension}`,
    contentType,
    wasNormalized: false,
  });
});

test('does not create durable identity when native conversion fails', async () => {
  const store = fakeStore();

  await expect(
    normalizeAndRetainAttachment(store, draft, {
      nativeModule: {
        reconcileRetained: async () => undefined,
        normalizeAndRetain: async () => {
          throw new Error('attachment_media_conversion');
        },
      },
    }),
  ).rejects.toThrow('attachment_media_conversion');

  expect(store.retain).not.toHaveBeenCalled();
});

test('restart reconciliation removes a DB-failure orphan and preserves references', async () => {
  const orphanSha = 'd'.repeat(64);
  const referencedKey = `${'e'.repeat(64)}.jpg`;
  const retainedFiles = new Set([referencedKey]);
  const retainedTimes = new Map([[referencedKey, -1_000]]);
  let elapsedSeconds = 0;
  const nativeModule = {
    normalizeAndRetain: jest.fn(async () => {
      retainedFiles.add(`${orphanSha}.jpg`);
      retainedTimes.set(`${orphanSha}.jpg`, elapsedSeconds);
      return {
        retainedFileKey: `${orphanSha}.jpg`,
        contentType: 'image/jpeg',
        byteCount: 2048,
        sha256: orphanSha,
        pixelWidth: 1200,
        pixelHeight: 800,
        wasNormalized: true,
      };
    }),
    reconcileRetained: jest.fn(
      async (_accountId, referenced: readonly string[]) => {
        for (const fileKey of retainedFiles) {
          if (
            !referenced.includes(fileKey) &&
            elapsedSeconds - (retainedTimes.get(fileKey) ?? elapsedSeconds) >=
              300
          ) {
            retainedFiles.delete(fileKey);
          }
        }
      },
    ),
  };
  const failedStore = {
    listRetainedFileKeys: jest.fn(async () => [referencedKey]),
    retain: jest.fn(async () => {
      throw new Error('database write failed');
    }),
  };

  await expect(
    normalizeAndRetainAttachment(failedStore, draft, { nativeModule }),
  ).rejects.toThrow('database write failed');
  expect(retainedFiles).toEqual(new Set([referencedKey, `${orphanSha}.jpg`]));

  await reconcileRetainedAttachmentFiles(failedStore, draft.accountUserId, {
    nativeModule,
  });
  expect(retainedFiles).toEqual(new Set([referencedKey, `${orphanSha}.jpg`]));
  elapsedSeconds = 301;

  const restartedStore = {
    listRetainedFileKeys: jest.fn(async () => [referencedKey]),
  };
  const database = {
    close: jest.fn(async () => undefined),
  } as unknown as ClosableSqlDatabase;
  const bootstrapped = await bootstrapPrivateDatabase({
    sessionStore: {
      get: jest.fn(
        async () =>
          ({ user: { id: draft.accountUserId } } as unknown as Session),
      ),
      compareAndSet: jest.fn(async () => true),
    },
    getDatabaseKey: jest.fn(async () => 'f'.repeat(64)),
    openDatabase: jest.fn(() => database),
    migrateDatabase: jest.fn(async () => undefined),
    initializeDeviceIdentities: jest.fn(async () => undefined),
    purgeDeniedRoots: jest.fn(async () => undefined),
    purgePrivateData: jest.fn(async () => undefined),
    listRetainedFileKeysForPurge: jest.fn(async () => []),
    purgeRetainedFiles: jest.fn(async () => undefined),
    quiesceAttachmentMedia: jest.fn(async () => undefined),
    reconcileAttachments: jest.fn(async accountId => {
      await reconcileRetainedAttachmentFiles(restartedStore, accountId, {
        nativeModule,
      });
    }),
    resumeAttachmentMedia: jest.fn(),
    clearPrivateState: jest.fn(async () => undefined),
  });

  expect(bootstrapped).toMatchObject({
    status: 'ready',
    accountId: draft.accountUserId,
  });
  expect(nativeModule.reconcileRetained).toHaveBeenCalledWith(
    draft.accountUserId,
    [referencedKey],
  );
  expect(retainedFiles).toEqual(new Set([referencedKey]));
});

test('rejects malformed native output before durable identity', async () => {
  const store = fakeStore();

  await expect(
    normalizeAndRetainAttachment(store, draft, {
      nativeModule: {
        reconcileRetained: async () => undefined,
        normalizeAndRetain: async () => ({
          retainedFileKey: `${'d'.repeat(64)}.jpg`,
          contentType: 'image/jpeg',
          byteCount: 2048,
          sha256: 'e'.repeat(64),
          pixelWidth: 1200,
          pixelHeight: 800,
          wasNormalized: false,
        }),
      },
    }),
  ).rejects.toThrow('invalid file identity');
  expect(store.retain).not.toHaveBeenCalled();
});

test('attachment commit payload contains only verified server identity', () => {
  const sha256 = 'f'.repeat(64);
  const attachment: RetainedLocalAttachment = {
    accountUserId: draft.accountUserId,
    attachmentId: draft.attachmentId,
    rootEventId: draft.rootEventId,
    targetEntryId: draft.targetEntryId,
    retainedFileKey: `${sha256}.jpg`,
    contentType: 'image/jpeg',
    byteCount: 2048,
    sha256,
    pixelWidth: 1200,
    pixelHeight: 800,
    wasNormalized: true,
    retainedAt: retainedAt.toISOString(),
  };

  expect(
    verifiedAttachmentCommit(attachment, 'upl_verified', 'Great day'),
  ).toEqual({
    kind: 'attachment.commit',
    entityId: draft.attachmentId,
    payload: { uploadId: 'upl_verified', caption: 'Great day' },
  });
});
