import { FeedbackComposeRuntime } from '../src/screens/FeedbackComposeRuntime';

const accountUserId = `usr_${'1'.repeat(32)}`;
const rootEventId = 'evt_trip';
const database = {};
const client = {};
const mockScreenshotStore = {
  discard: jest.fn(),
  get: jest.fn(),
  retain: jest.fn(),
};
const mockController = {
  sendWithoutScreenshot: jest.fn(),
};
const mockAttachmentStore = {};
const mockCapture = jest.fn();
const mockPreview = jest.fn();
const mockReconcile = jest.fn();
const mockRunAttachmentOperation = jest.fn();
const mockUploadTransport = {};
const mockControllerConstructor = jest.fn();

jest.mock('@crew/mobile-data', () => ({
  FeedbackDuplicateSuggestionController: class {},
  FeedbackScreenshotStore: class {
    constructor() {
      return mockScreenshotStore;
    }
  },
  FeedbackSubmissionAccountChangedError: class extends Error {},
  FeedbackSubmissionController: class {
    constructor(
      databaseValue: unknown,
      clientValue: unknown,
      options: unknown,
    ) {
      mockControllerConstructor(databaseValue, clientValue, options);
      return mockController;
    }
  },
  LocalAttachmentStore: class {
    constructor() {
      return mockAttachmentStore;
    }
  },
}));

jest.mock('../src/media/attachmentMedia', () => ({
  captureCurrentScreenAttachment: (...args: unknown[]) => mockCapture(...args),
  createFeedbackAttachmentUploadTransport: () => mockUploadTransport,
  previewRetainedAttachment: (...args: unknown[]) => mockPreview(...args),
  reconcileRetainedAttachmentFiles: (...args: unknown[]) =>
    mockReconcile(...args),
  runAttachmentMediaOperation: (...args: unknown[]) =>
    mockRunAttachmentOperation(...args),
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: () => '00000000-0000-4000-8000-000000000099',
}));

const captured = {
  byteCount: 12_000,
  contentType: 'image/png' as const,
  pixelHeight: 844,
  pixelWidth: 390,
  retainedFileKey: `${'a'.repeat(64)}.png`,
  sha256: 'a'.repeat(64),
  wasNormalized: true as const,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCapture.mockResolvedValue(captured);
  mockPreview.mockResolvedValue('data:image/png;base64,QUJDRA==');
  mockScreenshotStore.retain.mockResolvedValue({ state: 'retained' });
  mockScreenshotStore.discard.mockResolvedValue(true);
  mockScreenshotStore.get.mockResolvedValue(null);
  mockReconcile.mockResolvedValue(undefined);
  mockRunAttachmentOperation.mockImplementation(
    async (_accountUserId: string, operation: () => Promise<unknown>) =>
      operation(),
  );
  mockController.sendWithoutScreenshot.mockResolvedValue({
    feedbackId: 'fbk_test',
    state: 'pending',
  });
});

test('captures only after the caller invokes the explicit source action and persists no preview bytes', async () => {
  const randomUUID = jest
    .fn()
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
    .mockReturnValueOnce('00000000-0000-4000-8000-000000000002');
  const runtime = createRuntime({ randomUUID });

  expect(mockCapture).not.toHaveBeenCalled();
  const result = await runtime.capture(rootEventId);

  expect(mockCapture).toHaveBeenCalledWith(accountUserId);
  expect(mockRunAttachmentOperation).toHaveBeenCalledWith(
    accountUserId,
    expect.any(Function),
  );
  expect(mockPreview).toHaveBeenCalledWith(
    accountUserId,
    captured.retainedFileKey,
  );
  expect(mockScreenshotStore.retain).toHaveBeenCalledWith({
    accountUserId,
    attachmentId: 'att_00000000-0000-4000-8000-000000000002',
    byteCount: captured.byteCount,
    contentType: 'image/png',
    feedbackId: 'fbk_00000000-0000-4000-8000-000000000001',
    pixelHeight: captured.pixelHeight,
    pixelWidth: captured.pixelWidth,
    retainedAt: '2026-07-19T12:00:00.000Z',
    retainedFileKey: captured.retainedFileKey,
    rootEventId,
    sha256: captured.sha256,
    wasNormalized: true,
  });
  expect(JSON.stringify(mockScreenshotStore.retain.mock.calls)).not.toContain(
    'data:image',
  );
  expect(result.previewDataUri).toBe('data:image/png;base64,QUJDRA==');
});

test('rejects malformed root and generated identities before native capture', async () => {
  await expect(createRuntime().capture('not-a-root')).rejects.toThrow(
    'Invalid feedback screenshot root',
  );
  expect(mockCapture).not.toHaveBeenCalled();

  await expect(
    createRuntime({ randomUUID: () => 'not-a-uuid' }).capture(rootEventId),
  ).rejects.toThrow('Invalid feedback screenshot identity');
  expect(mockCapture).not.toHaveBeenCalled();
});

test('restores only an exact retained root binding and cleans a failed preview', async () => {
  const feedbackId = 'fbk_existing';
  mockScreenshotStore.get.mockResolvedValue({
    ...captured,
    accountUserId,
    attachmentId: 'att_existing',
    feedbackId,
    feedbackSendStartedAt: null,
    rootEventId,
    state: 'retained',
  });
  const runtime = createRuntime();

  await expect(runtime.restore(feedbackId, 'evt_other')).resolves.toBeNull();
  expect(mockPreview).not.toHaveBeenCalled();

  mockPreview.mockRejectedValueOnce(
    new Error('attachment_media_preview_failed'),
  );
  await expect(runtime.restore(feedbackId, rootEventId)).rejects.toThrow();
  expect(mockScreenshotStore.discard).toHaveBeenCalledWith(
    accountUserId,
    feedbackId,
  );
  expect(mockReconcile).toHaveBeenCalledWith(
    mockAttachmentStore,
    accountUserId,
  );
});

test('registers screenshot reads, cleanup, and fallback delivery with the account media lifecycle', async () => {
  const feedbackId = 'fbk_existing';
  mockScreenshotStore.get.mockResolvedValue({
    ...captured,
    accountUserId,
    attachmentId: 'att_existing',
    feedbackId,
    feedbackSendStartedAt: null,
    rootEventId,
    state: 'retained',
  });
  const runtime = createRuntime();

  await runtime.restore(feedbackId, rootEventId);
  await runtime.discard(feedbackId);
  await runtime.cleanup(feedbackId);
  mockScreenshotStore.get.mockResolvedValue({
    feedbackSendStartedAt: null,
    state: 'attention',
  });
  await runtime.canSendWithoutScreenshot(feedbackId);
  await runtime.sendWithoutScreenshot(feedbackId);

  expect(mockRunAttachmentOperation).toHaveBeenCalledTimes(5);
  expect(
    mockRunAttachmentOperation.mock.calls.every(
      ([registeredAccount]) => registeredAccount === accountUserId,
    ),
  ).toBe(true);
});

test('account change during capture deletes the unbound retained file', async () => {
  let activeAccount: string | null = accountUserId;
  mockCapture.mockImplementation(async () => {
    activeAccount = `usr_${'2'.repeat(32)}`;
    return captured;
  });
  const runtime = createRuntime({
    activeAccountUserId: () => activeAccount,
    randomUUID: jest
      .fn()
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002'),
  });

  await expect(runtime.capture(rootEventId)).rejects.toThrow();
  expect(mockScreenshotStore.discard).toHaveBeenCalled();
  expect(mockReconcile).toHaveBeenCalledWith(
    mockAttachmentStore,
    accountUserId,
  );
  expect(mockPreview).not.toHaveBeenCalled();
});

test.each([
  ['preview', 2, 0],
  ['retention', 3, 1],
] as const)(
  'account change after awaited %s discards the retained screenshot',
  async (_boundary, activeChecks, expectedRetains) => {
    let checks = 0;
    const runtime = createRuntime({
      activeAccountUserId: () =>
        ++checks <= activeChecks ? accountUserId : `usr_${'2'.repeat(32)}`,
      randomUUID: jest
        .fn()
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
        .mockReturnValueOnce('00000000-0000-4000-8000-000000000002'),
    });

    await expect(runtime.capture(rootEventId)).rejects.toThrow();
    expect(mockPreview).toHaveBeenCalledWith(
      accountUserId,
      captured.retainedFileKey,
    );
    expect(mockScreenshotStore.retain).toHaveBeenCalledTimes(expectedRetains);
    expect(mockScreenshotStore.discard).toHaveBeenCalledWith(
      accountUserId,
      'fbk_00000000-0000-4000-8000-000000000001',
    );
    expect(mockReconcile).toHaveBeenCalledWith(
      mockAttachmentStore,
      accountUserId,
    );
  },
);

test('account change after an awaited restore preview discards the old-account screenshot', async () => {
  const feedbackId = 'fbk_existing';
  mockScreenshotStore.get.mockResolvedValue({
    ...captured,
    accountUserId,
    attachmentId: 'att_existing',
    feedbackId,
    feedbackSendStartedAt: null,
    rootEventId,
    state: 'retained',
  });
  let checks = 0;
  const runtime = createRuntime({
    activeAccountUserId: () =>
      ++checks <= 2 ? accountUserId : `usr_${'2'.repeat(32)}`,
  });

  await expect(runtime.restore(feedbackId, rootEventId)).rejects.toThrow();
  expect(mockPreview).toHaveBeenCalledWith(
    accountUserId,
    captured.retainedFileKey,
  );
  expect(mockScreenshotStore.discard).toHaveBeenCalledWith(
    accountUserId,
    feedbackId,
  );
  expect(mockReconcile).toHaveBeenCalledWith(
    mockAttachmentStore,
    accountUserId,
  );
});

function createRuntime(
  overrides: Partial<
    ConstructorParameters<typeof FeedbackComposeRuntime>[0]
  > = {},
) {
  return new FeedbackComposeRuntime({
    accountUserId,
    activeAccountUserId: () => accountUserId,
    client: client as never,
    database: database as never,
    now: () => new Date('2026-07-19T12:00:00.000Z'),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    ...overrides,
  });
}
