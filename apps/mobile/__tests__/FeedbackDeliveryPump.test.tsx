import {
  FeedbackSubmissionAuthenticationError,
  FeedbackSubmissionController,
  type FeedbackSubmissionReceipt,
} from '@crew/mobile-data';
import { focusManager, onlineManager } from '@tanstack/react-query';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { FeedbackDeliveryPump } from '../src/app/FeedbackDeliveryPump';
import {
  createFeedbackAttachmentUploadTransport,
  quiesceAttachmentMedia,
  resumeAttachmentMedia,
} from '../src/media/attachmentMedia';
import { secureUuidV4 } from '../src/storage/secureRandom';

const mockAccountId = `usr_${'a'.repeat(32)}`;
const mockClient = { requestAsUser: jest.fn() };
const mockDatabase = { name: 'private-feedback-database' };
const mockController = {
  drain: jest.fn(async () => [] as FeedbackSubmissionReceipt[]),
  resumeAndDrain: jest.fn(async () => [] as FeedbackSubmissionReceipt[]),
};
const mockAttachmentUploadTransport = { upload: jest.fn() };
const mockLifecycle = {
  accountId: mockAccountId,
  reloadSession: jest.fn(async () => undefined),
  status: 'ready' as const,
};

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    FeedbackSubmissionController: jest.fn(() => mockController),
  };
});

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockClient,
}));

jest.mock('../src/media/attachmentMedia', () => {
  const actual = jest.requireActual('../src/media/attachmentMedia');
  return {
    ...actual,
    createFeedbackAttachmentUploadTransport: jest.fn(
      () => mockAttachmentUploadTransport,
    ),
  };
});

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockAccountId,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  mockController.drain.mockResolvedValue([]);
  mockController.resumeAndDrain.mockResolvedValue([]);
});

afterEach(() => {
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
});

test('drains once globally on mount, reconnect and app resume', async () => {
  onlineManager.setOnline(false);
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<FeedbackDeliveryPump />);
    await flush();
  });

  expect(FeedbackSubmissionController).toHaveBeenCalledWith(
    mockDatabase,
    mockClient,
    expect.objectContaining({
      activeAccountUserId: expect.any(Function),
      attachmentUploadTransport: mockAttachmentUploadTransport,
      randomUUID: secureUuidV4,
    }),
  );
  expect(createFeedbackAttachmentUploadTransport).toHaveBeenCalledTimes(1);
  expect(mockController.resumeAndDrain).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    onlineManager.setOnline(true);
    await flush();
  });
  expect(mockController.resumeAndDrain).toHaveBeenCalledTimes(1);
  expect(mockController.resumeAndDrain).toHaveBeenLastCalledWith(mockAccountId);

  await ReactTestRenderer.act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await flush();
  });
  expect(mockController.resumeAndDrain).toHaveBeenCalledTimes(1);
  expect(mockController.drain).toHaveBeenCalledTimes(1);
  expect(mockController.drain).toHaveBeenLastCalledWith(mockAccountId);

  await ReactTestRenderer.act(async () => renderer!.unmount());
  onlineManager.setOnline(false);
  onlineManager.setOnline(true);
  expect(mockController.resumeAndDrain).toHaveBeenCalledTimes(1);
  expect(mockController.drain).toHaveBeenCalledTimes(1);
});

test('never blocks rendering and reloads a failed authentication asynchronously', async () => {
  let rejectDelivery = (_error: Error) => {};
  mockController.drain.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectDelivery = reject;
    }),
  );

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<FeedbackDeliveryPump />);
    await flush();
  });
  expect(renderer!.toJSON()).toBeNull();
  expect(mockController.drain).toHaveBeenCalledTimes(1);
  expect(mockLifecycle.reloadSession).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    rejectDelivery(new FeedbackSubmissionAuthenticationError());
    await flush();
  });
  expect(mockLifecycle.reloadSession).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(async () => renderer!.unmount());
});

test('quiesce drains the complete controller flight and rejects new drains', async () => {
  let completeDrain: (receipts: FeedbackSubmissionReceipt[]) => void = () => {};
  mockController.drain.mockReturnValueOnce(
    new Promise(resolve => {
      completeDrain = resolve;
    }),
  );
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<FeedbackDeliveryPump />);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(1);

    let drained = false;
    const quiescence = quiesceAttachmentMedia(mockAccountId, {
      nativeModule: { cancelPending: async () => undefined },
    }).then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false);

    await ReactTestRenderer.act(async () => {
      completeDrain([]);
      await flush();
    });
    await quiescence;
    expect(drained).toBe(true);

    focusManager.setFocused(false);
    await ReactTestRenderer.act(async () => {
      focusManager.setFocused(true);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(1);
  } finally {
    resumeAttachmentMedia(mockAccountId);
    if (renderer) {
      await ReactTestRenderer.act(async () => renderer?.unmount());
    }
  }
});

test('injects the getRandomValues UUID provider for Release feedback replay', async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'crypto',
  );
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      },
    },
  });

  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<FeedbackDeliveryPump />);
      await flush();
    });
    const options = (FeedbackSubmissionController as jest.Mock).mock
      .calls[0][2];
    expect(globalThis.crypto.randomUUID).toBeUndefined();
    expect(options.randomUUID).toBe(secureUuidV4);
    expect(options.randomUUID()).toBe('00000000-0000-4000-8000-000000000000');
    expect(mockController.drain).toHaveBeenCalledWith(mockAccountId);
  } finally {
    if (renderer) {
      await ReactTestRenderer.act(async () => renderer?.unmount());
    }
    if (cryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  }
});

test('uses the earliest due retry and cancels stale foreground work', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-07-20T12:00:00.000Z'));
  mockController.drain
    .mockResolvedValueOnce([
      pendingReceipt('2026-07-20T12:00:10.000Z'),
      pendingReceipt('2026-07-20T12:00:03.000Z'),
    ])
    .mockResolvedValueOnce([pendingReceipt('2026-07-20T12:00:08.000Z')])
    .mockResolvedValueOnce([pendingReceipt('2026-07-20T12:00:10.000Z')]);
  mockController.resumeAndDrain.mockResolvedValueOnce([
    pendingReceipt('2026-07-20T12:00:12.000Z'),
  ]);

  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  try {
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<FeedbackDeliveryPump />);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2_999);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(1);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(2);

    focusManager.setFocused(false);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(5_000);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(2);

    focusManager.setFocused(true);
    await ReactTestRenderer.act(async () => {
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(3);

    onlineManager.setOnline(false);
    await ReactTestRenderer.act(async () => {
      jest.advanceTimersByTime(2_000);
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(3);

    onlineManager.setOnline(true);
    await ReactTestRenderer.act(async () => {
      await flush();
    });
    expect(mockController.resumeAndDrain).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => renderer?.unmount());
    await ReactTestRenderer.act(async () => {
      jest.runOnlyPendingTimers();
      await flush();
    });
    expect(mockController.drain).toHaveBeenCalledTimes(3);
    expect(mockController.resumeAndDrain).toHaveBeenCalledTimes(1);
  } finally {
    if (renderer) {
      await ReactTestRenderer.act(async () => renderer?.unmount());
    }
    jest.useRealTimers();
  }
});

function pendingReceipt(nextAttemptAt: string): FeedbackSubmissionReceipt {
  return {
    accountUserId: mockAccountId,
    attempts: 1,
    createdAt: '2026-07-20T11:59:00.000Z',
    deliveredAt: null,
    failure: 'service_unavailable',
    feedbackId: 'fbk_due_retry',
    nextAttemptAt,
    state: 'pending',
    updatedAt: '2026-07-20T12:00:00.000Z',
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
