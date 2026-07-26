import type { FeedbackSubmissionReceipt } from '@crew/mobile-data';
import React from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  quiesceAttachmentMedia,
  resumeAttachmentMedia,
} from '../src/media/attachmentMedia';
import { FeedbackComposeScreen } from '../src/screens/FeedbackComposeScreen';

const mockAccountUserId = `usr_${'1'.repeat(32)}`;
const mockDatabase = {};
const mockClient = {};
const mockController = {
  drain: jest.fn(),
  enqueue: jest.fn(),
  get: jest.fn(),
  resumeAndDrain: jest.fn(),
};
const mockDuplicateSuggestions = {
  search: jest.fn(),
};
const mockComposeRuntime = {
  canSendWithoutScreenshot: jest.fn(),
  cleanup: jest.fn(),
  controller: mockController,
  discard: jest.fn(),
  duplicateSuggestions: mockDuplicateSuggestions,
  restore: jest.fn(),
  sendWithoutScreenshot: jest.fn(),
};
let mockLifecycle = {
  accountId: mockAccountUserId as string | null,
  reloadSession: jest.fn(() => Promise.resolve()),
  status: 'ready' as const,
};
let mockDatabaseAccountId = mockAccountUserId;
let mockOnline = false;

jest.mock('@crew/mobile-data', () => {
  const actual = jest.requireActual('@crew/mobile-data');
  return {
    ...actual,
    FeedbackSubmissionController: jest.fn(() => mockController),
  };
});

jest.mock('../src/screens/FeedbackComposeRuntime', () => ({
  FeedbackComposeRuntime: jest.fn(() => mockComposeRuntime),
}));

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockDatabaseAccountId,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

jest.mock('../src/screens/useOnlineState', () => ({
  useOnlineState: () => mockOnline,
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
}));

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = false;
  mockDatabaseAccountId = mockAccountUserId;
  mockLifecycle = {
    accountId: mockAccountUserId,
    reloadSession: jest.fn(() => Promise.resolve()),
    status: 'ready',
  };
  mockController.enqueue.mockResolvedValue(receipt('pending'));
  mockController.drain.mockResolvedValue([receipt('delivered')]);
  mockController.get.mockResolvedValue(receipt('delivered'));
  mockController.resumeAndDrain.mockResolvedValue([receipt('delivered')]);
  mockDuplicateSuggestions.search.mockResolvedValue({
    items: [],
    refreshedAt: null,
    source: 'cache',
  });
  mockComposeRuntime.canSendWithoutScreenshot.mockResolvedValue(false);
  mockComposeRuntime.cleanup.mockResolvedValue(undefined);
  mockComposeRuntime.discard.mockResolvedValue(undefined);
  mockComposeRuntime.restore.mockResolvedValue(null);
  mockComposeRuntime.sendWithoutScreenshot.mockResolvedValue(
    receipt('pending'),
  );
});

test('maps event sharing to generated public visibility and keeps exact source return', async () => {
  const onReturn = jest.fn();
  const renderer = await renderScreen({ onReturn });
  await fill(renderer, 'ÖV verbessern 🎉', 'Bitte den Plan klarer machen.');

  const submit = renderer.root.findByProps({
    testID: 'feedback-compose-submit',
  });
  await ReactTestRenderer.act(() => submit.props.onPress());

  expect(mockController.enqueue).toHaveBeenCalledWith(mockAccountUserId, {
    body: 'Bitte den Plan klarer machen.',
    diagnostics: null,
    eventId: 'evt_day-one',
    id: 'fbk_00000000-0000-4000-8000-000000000001',
    rootEventId: 'evt_trip',
    screenKey: null,
    title: 'ÖV verbessern 🎉',
    visibility: 'public',
  });
  expect(mockController.drain).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-return' })
      .props.onPress(),
  );
  expect(onReturn).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('forces private visibility without event scope', async () => {
  const renderer = await renderScreen({
    source: {
      eventId: null,
      rootEventId: null,
      screenKey: 'events',
      sourceLabel: 'Event-Liste',
    },
  });
  await fill(renderer, 'Allgemeine Idee', 'Gilt für die ganze App.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    diagnostics: null,
    eventId: null,
    rootEventId: null,
    screenKey: null,
    visibility: 'private',
  });
  expect(
    renderer.root.findAllByProps({ testID: 'feedback-visibility-event' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('malformed root conceals event visibility and cannot bind event, screenshot or route context', async () => {
  const renderer = await renderScreen({
    source: {
      eventId: 'evt_day-one',
      feedbackId: screenshotSource.feedbackId,
      rootEventId: 'malformed-root',
      screenKey: `bad\u0000screen`,
      sourceLabel: `  Plan\u0000${' sehr lang'.repeat(30)}  `,
    },
  });

  expect(
    renderer.root.findAllByProps({ testID: 'feedback-visibility-event' }),
  ).toHaveLength(0);
  expect(mockComposeRuntime.restore).not.toHaveBeenCalled();
  expect(textInside(renderer)).not.toContain('\u0000');
  await fill(renderer, 'Sicher privat', 'Keine ungültige Event-Bindung.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    eventId: null,
    rootEventId: null,
    visibility: 'private',
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('adds only previewed bounded diagnostics after explicit offline opt-in', async () => {
  const renderer = await renderScreen({
    availableDiagnostics: {
      appVersion: '2.3.0',
      buildNumber: '81',
      deviceId: 'device-secret',
      locale: 'de-CH',
      osVersion: '18.5',
      platform: 'ios',
      token: 'token-secret',
    } as never,
  });
  await fill(renderer, 'Technische Idee', 'Bitte offline erhalten.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-diagnostics-consent' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    diagnostics: {
      appVersion: '2.3.0',
      buildNumber: '81',
      platform: 'ios',
    },
    eventId: 'evt_day-one',
    rootEventId: 'evt_trip',
    screenKey: 'event-context',
    visibility: 'public',
  });
  expect(
    mockController.enqueue.mock.calls[0][1].diagnostics,
  ).not.toHaveProperty('deviceId');
  expect(
    mockController.enqueue.mock.calls[0][1].diagnostics,
  ).not.toHaveProperty('locale');
  expect(
    mockController.enqueue.mock.calls[0][1].diagnostics,
  ).not.toHaveProperty('osVersion');
  expect(
    mockController.enqueue.mock.calls[0][1].diagnostics,
  ).not.toHaveProperty('token');
  expect(mockController.drain).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('explicit opt-out returns to diagnostics null while event assignment remains', async () => {
  const renderer = await renderScreen({
    availableDiagnostics: {
      appVersion: '2.3.0',
      buildNumber: '81',
      platform: 'ios',
    },
  });
  await fill(renderer, 'Ohne Diagnose', 'Die Auswahl wird zurückgenommen.');
  const consent = renderer.root.findByProps({
    testID: 'feedback-diagnostics-consent',
  });
  await ReactTestRenderer.act(() => consent.props.onPress());
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-diagnostics-consent' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    diagnostics: null,
    eventId: 'evt_day-one',
    rootEventId: 'evt_trip',
    screenKey: null,
    visibility: 'public',
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('keeps private feedback free of raw event IDs and raw screen keys', async () => {
  const renderer = await renderScreen({
    availableDiagnostics: {
      appVersion: '2.3.0',
      buildNumber: '81',
      platform: 'android',
    },
  });
  await fill(renderer, 'Privat', 'Nur an das Produktteam.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-visibility-private' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-diagnostics-consent' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    eventId: null,
    rootEventId: null,
    screenKey: 'event-context',
    visibility: 'private',
  });
  expect(mockController.enqueue.mock.calls[0][1].screenKey).not.toBe(
    defaultSource.screenKey,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('metadata failure leaves diagnostics off and never blocks text persistence', async () => {
  const renderer = await renderScreen({
    availableDiagnostics: {
      appVersion: '2.3.0',
      buildNumber: 'iPhone16,1',
      platform: 'ios',
    },
  });
  expect(
    renderer.root.findAllByProps({ testID: 'feedback-diagnostics-consent' }),
  ).toHaveLength(0);
  await fill(renderer, 'Ohne Metadaten', 'Der Text bleibt sendbar.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    diagnostics: null,
    screenKey: null,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('a source change clears the old bound draft and resets diagnostics consent', async () => {
  const availableDiagnostics = {
    appVersion: '2.3.0',
    buildNumber: '81',
    platform: 'ios' as const,
  };
  const renderer = await renderScreen({ availableDiagnostics });
  await fill(renderer, 'Alter Kontext', 'Darf nicht neu gebunden werden.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-diagnostics-consent' })
      .props.onPress(),
  );

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          availableDiagnostics={availableDiagnostics}
          onReturn={jest.fn()}
          source={{
            eventId: 'evt_day-two',
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/team',
            sourceLabel: 'Event · Team',
          }}
        />
      </SafeAreaProvider>,
    );
  });

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-body' }).props.value,
  ).toBe('');
  expect(
    renderer.root.findByProps({ testID: 'feedback-diagnostics-consent' }).props
      .accessibilityState,
  ).toMatchObject({ checked: false });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('a source change during enqueue cannot publish the old receipt into the new form', async () => {
  let resolveEnqueue!: (value: FeedbackSubmissionReceipt) => void;
  mockController.enqueue.mockReturnValue(
    new Promise(resolve => {
      resolveEnqueue = resolve;
    }),
  );
  const renderer = await renderScreen();
  await fill(renderer, 'Alter Flug', 'Bleibt an die alte Quelle gebunden.');
  let flight!: Promise<void>;
  await ReactTestRenderer.act(() => {
    flight = renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress();
  });

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          onReturn={jest.fn()}
          source={{
            eventId: 'evt_day-two',
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/team',
            sourceLabel: 'Event · Team',
          }}
        />
      </SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    resolveEnqueue(receipt('pending'));
    await flight;
  });

  expect(textInside(renderer)).not.toContain('Alter Flug');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('');
  expect(mockController.drain).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('a source change during drain cannot restore an old delivered receipt', async () => {
  mockOnline = true;
  let resolveDrain!: (value: FeedbackSubmissionReceipt[]) => void;
  mockController.drain.mockReturnValue(
    new Promise(resolve => {
      resolveDrain = resolve;
    }),
  );
  const renderer = await renderScreen();
  await fill(renderer, 'Alter Drain', 'Die neue Quelle bleibt leer.');
  await ReactTestRenderer.act(async () =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(mockController.drain).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          onReturn={jest.fn()}
          source={{
            eventId: 'evt_day-two',
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/team',
            sourceLabel: 'Event · Team',
          }}
        />
      </SafeAreaProvider>,
    );
  });
  await ReactTestRenderer.act(async () => {
    resolveDrain([receipt('delivered')]);
    await Promise.resolve();
  });

  expect(textInside(renderer)).not.toContain('Alter Drain');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('');
  expect(mockController.get).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('quiesce drains the compose controller flight and rejects a retry', async () => {
  mockOnline = true;
  let resolveDrain: (value: FeedbackSubmissionReceipt[]) => void = () => {};
  mockController.drain.mockReturnValueOnce(
    new Promise(resolve => {
      resolveDrain = resolve;
    }),
  );
  const renderer = await renderScreen();
  try {
    await fill(renderer, 'Drain', 'Der terminale DB-Stand bleibt geschützt.');
    await ReactTestRenderer.act(async () =>
      renderer.root
        .findByProps({ testID: 'feedback-compose-submit' })
        .props.onPress(),
    );
    expect(mockController.drain).toHaveBeenCalledTimes(1);

    let drained = false;
    const quiescence = quiesceAttachmentMedia(mockAccountUserId, {
      nativeModule: { cancelPending: async () => undefined },
    }).then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    await ReactTestRenderer.act(async () => {
      resolveDrain([
        { ...receipt('attention'), failure: 'auth_required', attempts: 1 },
      ]);
      await Promise.resolve();
    });
    await quiescence;
    expect(drained).toBe(true);

    await ReactTestRenderer.act(async () =>
      renderer.root
        .findByProps({ testID: 'feedback-compose-retry' })
        .props.onPress(),
    );
    expect(mockController.resumeAndDrain).not.toHaveBeenCalled();
  } finally {
    resumeAttachmentMedia(mockAccountUserId);
    await ReactTestRenderer.act(() => renderer.unmount());
  }
});

test('a direct ready account switch conceals the old receipt and starts blank', async () => {
  const availableDiagnostics = {
    appVersion: '2.3.0',
    buildNumber: '81',
    platform: 'ios' as const,
  };
  const renderer = await renderScreen({ availableDiagnostics });
  await fill(renderer, 'Konto A Titel', 'Konto A Text.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-diagnostics-consent' })
      .props.onPress(),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(textInside(renderer)).toContain('Konto A Titel');

  const nextAccount = `usr_${'2'.repeat(32)}`;
  mockDatabaseAccountId = nextAccount;
  mockLifecycle = { ...mockLifecycle, accountId: nextAccount };
  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          availableDiagnostics={availableDiagnostics}
          onReturn={jest.fn()}
          source={defaultSource}
        />
      </SafeAreaProvider>,
    );
  });

  expect(textInside(renderer)).not.toContain('Konto A Titel');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('');
  expect(
    renderer.root.findByProps({ testID: 'feedback-diagnostics-consent' }).props
      .accessibilityState,
  ).toMatchObject({ checked: false });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('deduplicates rapid submit while local persistence is in flight', async () => {
  let resolveEnqueue!: (value: FeedbackSubmissionReceipt) => void;
  mockController.enqueue.mockReturnValue(
    new Promise(resolve => {
      resolveEnqueue = resolve;
    }),
  );
  const renderer = await renderScreen();
  await fill(renderer, 'Einmal senden', 'Nicht doppelt speichern.');
  const submit = renderer.root.findByProps({
    testID: 'feedback-compose-submit',
  });

  await ReactTestRenderer.act(async () => {
    const first = submit.props.onPress();
    const second = submit.props.onPress();
    expect(mockController.enqueue).toHaveBeenCalledTimes(1);
    resolveEnqueue(receipt('pending'));
    await Promise.all([first, second]);
  });
  expect(mockController.enqueue).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('accepts exact 160/10000 Unicode boundaries and rejects programmatic overflow', async () => {
  const renderer = await renderScreen();
  const exactTitle = 'ü'.repeat(160);
  const exactBody = '🎉'.repeat(5_000);
  await fill(renderer, exactTitle, exactBody);
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    body: exactBody,
    title: exactTitle,
  });

  await ReactTestRenderer.act(() => renderer.unmount());
  jest.clearAllMocks();
  mockController.enqueue.mockResolvedValue(receipt('pending'));
  const overflow = await renderScreen();
  await fill(overflow, 'x'.repeat(161), 'gültig');
  await ReactTestRenderer.act(() =>
    overflow.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );
  expect(mockController.enqueue).not.toHaveBeenCalled();
  expect(
    overflow.root.findByProps({ accessibilityRole: 'alert' }).props.children,
  ).toContain('160');
  await ReactTestRenderer.act(() => overflow.unmount());
});

test('conceals an account transition without publishing the old receipt', async () => {
  let resolveEnqueue!: (value: FeedbackSubmissionReceipt) => void;
  mockController.enqueue.mockReturnValue(
    new Promise(resolve => {
      resolveEnqueue = resolve;
    }),
  );
  const renderer = await renderScreen();
  await fill(renderer, 'Konto-Wechsel', 'Alter Text bleibt geschützt.');
  let flight!: Promise<void>;
  await ReactTestRenderer.act(() => {
    flight = renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress();
  });
  mockLifecycle = { ...mockLifecycle, accountId: `usr_${'2'.repeat(32)}` };
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen onReturn={jest.fn()} source={defaultSource} />
      </SafeAreaProvider>,
    );
    resolveEnqueue(receipt('pending'));
    await flight;
  });

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-view' }),
  ).toBeTruthy();
  expect(
    renderer.root.findAllByProps({ accessibilityLabel: 'ZUGESTELLT' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('restores a source-bound screenshot with consent off and submits it only after opt-in', async () => {
  mockComposeRuntime.restore.mockResolvedValue(sourceScreenshot);
  const renderer = await renderScreen({ source: screenshotSource });
  await flushEffects();

  expect(
    renderer.root.findByProps({ testID: 'feedback-screenshot-consent' }).props
      .accessibilityState,
  ).toMatchObject({ checked: false });
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .label,
  ).toBe('Text ohne Screenshot senden');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-screenshot-consent' })
      .props.onPress(),
  );
  await fill(renderer, 'Mit Bild', 'Nur nach klarer Auswahl.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockController.enqueue).toHaveBeenCalledWith(
    mockAccountUserId,
    expect.objectContaining({
      attachmentId: sourceScreenshot.attachmentId,
      id: sourceScreenshot.feedbackId,
      rootEventId: screenshotSource.rootEventId,
    }),
  );
  expect(mockComposeRuntime.discard).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('explicit text-only submission discards the retained screenshot before enqueue', async () => {
  mockComposeRuntime.restore.mockResolvedValue(sourceScreenshot);
  const renderer = await renderScreen({ source: screenshotSource });
  await flushEffects();
  await fill(renderer, 'Nur Text', 'Der Screenshot wird bewusst weggelassen.');
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress(),
  );

  expect(mockComposeRuntime.discard).toHaveBeenCalledWith(
    sourceScreenshot.feedbackId,
  );
  expect(mockController.enqueue.mock.calls[0][1]).not.toHaveProperty(
    'attachmentId',
  );
  expect(mockController.enqueue.mock.calls[0][1]).toMatchObject({
    id: sourceScreenshot.feedbackId,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('unmount defers draft cleanup until a failed screenshot enqueue settles', async () => {
  mockComposeRuntime.restore.mockResolvedValue(sourceScreenshot);
  let rejectEnqueue!: (error: Error) => void;
  mockController.enqueue.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectEnqueue = reject;
    }),
  );
  const renderer = await renderScreen({ source: screenshotSource });
  await flushEffects();
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-screenshot-consent' })
      .props.onPress(),
  );
  await fill(renderer, 'Race', 'Die Datei darf nicht zu früh verschwinden.');
  let flight!: Promise<void>;
  await ReactTestRenderer.act(() => {
    flight = renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress();
  });
  await ReactTestRenderer.act(() => renderer.unmount());
  expect(mockComposeRuntime.cleanup).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    rejectEnqueue(new Error('local write failed'));
    await flight;
  });
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith(
    sourceScreenshot.feedbackId,
  );
});

test('a successful screenshot enqueue takes ownership before deferred unmount cleanup', async () => {
  mockComposeRuntime.restore.mockResolvedValue(sourceScreenshot);
  let resolveEnqueue!: (value: FeedbackSubmissionReceipt) => void;
  mockController.enqueue.mockReturnValue(
    new Promise(resolve => {
      resolveEnqueue = resolve;
    }),
  );
  const renderer = await renderScreen({ source: screenshotSource });
  await flushEffects();
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-screenshot-consent' })
      .props.onPress(),
  );
  await fill(
    renderer,
    'Owned',
    'Nach Enqueue bleibt die Datei durable gebunden.',
  );
  let flight!: Promise<void>;
  await ReactTestRenderer.act(() => {
    flight = renderer.root
      .findByProps({ testID: 'feedback-compose-submit' })
      .props.onPress();
  });
  await ReactTestRenderer.act(() => renderer.unmount());

  await ReactTestRenderer.act(async () => {
    resolveEnqueue(receipt('pending'));
    await flight;
  });
  expect(mockComposeRuntime.cleanup).not.toHaveBeenCalled();
});

test('a late source preview is discarded and can never reappear after source change', async () => {
  let resolveRestore!: (value: typeof sourceScreenshot) => void;
  mockComposeRuntime.restore.mockReturnValue(
    new Promise(resolve => {
      resolveRestore = resolve;
    }),
  );
  const renderer = await renderScreen({ source: screenshotSource });

  await ReactTestRenderer.act(() => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          onReturn={jest.fn()}
          source={{
            eventId: 'evt_day-two',
            rootEventId: 'evt_trip',
            screenKey: 'event-hub/team',
            sourceLabel: 'Event · Team',
          }}
        />
      </SafeAreaProvider>,
    );
  });
  expect(
    renderer.root.findAllByProps({ testID: 'feedback-screenshot-preview' }),
  ).toHaveLength(0);

  await ReactTestRenderer.act(async () => {
    resolveRestore(sourceScreenshot);
    await Promise.resolve();
  });
  expect(
    renderer.root.findAllByProps({ testID: 'feedback-screenshot-preview' }),
  ).toHaveLength(0);
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith(
    sourceScreenshot.feedbackId,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('a late old-account preview only cleans the old draft and never publishes into the new account', async () => {
  let resolveOldRestore!: (value: typeof sourceScreenshot) => void;
  mockComposeRuntime.restore
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveOldRestore = resolve;
      }),
    )
    .mockResolvedValueOnce(null);
  const renderer = await renderScreen({ source: screenshotSource });

  const nextAccount = `usr_${'2'.repeat(32)}`;
  mockDatabaseAccountId = nextAccount;
  mockLifecycle = { ...mockLifecycle, accountId: nextAccount };
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen onReturn={jest.fn()} source={screenshotSource} />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });

  await ReactTestRenderer.act(async () => {
    resolveOldRestore(sourceScreenshot);
    await Promise.resolve();
  });
  expect(
    renderer.root.findAllByProps({ testID: 'feedback-screenshot-preview' }),
  ).toHaveLength(0);
  expect(mockComposeRuntime.cleanup).toHaveBeenCalledWith(
    sourceScreenshot.feedbackId,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('debounces generated duplicate suggestions without blocking typing or submit and opens the selected canonical route callback', async () => {
  jest.useFakeTimers();
  mockOnline = true;
  const onOpenDuplicateSuggestion = jest.fn();
  mockDuplicateSuggestions.search.mockResolvedValue({
    items: [
      {
        id: 'fbk_check_in',
        status: 'open',
        title: 'Check-in verbessern',
        voteCount: 3,
      },
    ],
    refreshedAt: '2026-07-19T12:00:00.000Z',
    source: 'network',
  });
  const renderer = await renderScreen({ onOpenDuplicateSuggestion });
  await fill(
    renderer,
    'ＣＨＥＣＫ Check-in',
    'Check-in für Gruppen klarer machen.',
  );

  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-title' }).props.value,
  ).toBe('ＣＨＥＣＫ Check-in');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(false);
  expect(mockDuplicateSuggestions.search).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(450);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(mockDuplicateSuggestions.search).toHaveBeenCalledWith(
    mockAccountUserId,
    'evt_trip',
    'check in',
    true,
    expect.any(AbortSignal),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-duplicate-fbk_check_in' })
      .props.onPress(),
  );
  expect(onOpenDuplicateSuggestion).toHaveBeenCalledWith('fbk_check_in');
  await ReactTestRenderer.act(() => renderer.unmount());
  jest.useRealTimers();
});

test('publishes only the latest debounced query result across rapid Unicode edits', async () => {
  jest.useFakeTimers();
  mockOnline = true;
  const resolutions: Array<(value: unknown) => void> = [];
  mockDuplicateSuggestions.search.mockImplementation(
    () =>
      new Promise(resolve => {
        resolutions.push(resolve);
      }),
  );
  const renderer = await renderScreen({
    onOpenDuplicateSuggestion: jest.fn(),
  });
  await fill(renderer, 'Erste Suche', 'Alter Entwurf');
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(450);
    await Promise.resolve();
  });
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-body' })
      .props.onChangeText('Neuer Entwurf'),
  );
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(450);
    await Promise.resolve();
  });
  expect(resolutions).toHaveLength(2);

  await ReactTestRenderer.act(async () => {
    resolutions[1]?.({
      items: [
        {
          id: 'fbk_new',
          status: 'planned',
          title: 'Neues Ergebnis',
          voteCount: 2,
        },
      ],
      refreshedAt: '2026-07-19T12:00:00.000Z',
      source: 'network',
    });
    await Promise.resolve();
  });
  await ReactTestRenderer.act(async () => {
    resolutions[0]?.({
      items: [
        {
          id: 'fbk_old',
          status: 'open',
          title: 'Altes Ergebnis',
          voteCount: 9,
        },
      ],
      refreshedAt: '2026-07-19T11:00:00.000Z',
      source: 'network',
    });
    await Promise.resolve();
  });

  expect(textInside(renderer)).toContain('Neues Ergebnis');
  expect(textInside(renderer)).not.toContain('Altes Ergebnis');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-body' }).props.value,
  ).toBe('Neuer Entwurf');
  await ReactTestRenderer.act(() => renderer.unmount());
  jest.useRealTimers();
});

test('removes a rendered stale suggestion in the same edit before the next debounce', async () => {
  jest.useFakeTimers();
  mockOnline = true;
  mockDuplicateSuggestions.search.mockResolvedValue({
    items: [
      {
        id: 'fbk_stale',
        status: 'open',
        title: 'Altes Ergebnis',
        voteCount: 1,
      },
    ],
    refreshedAt: '2026-07-19T12:00:00.000Z',
    source: 'network',
  });
  const renderer = await renderScreen({
    onOpenDuplicateSuggestion: jest.fn(),
  });
  await fill(renderer, 'Erste Suche', 'Alter Entwurf');
  await ReactTestRenderer.act(async () => {
    jest.advanceTimersByTime(450);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(textInside(renderer)).toContain('Altes Ergebnis');

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-body' })
      .props.onChangeText('Neuer Entwurf'),
  );
  expect(textInside(renderer)).not.toContain('Altes Ergebnis');
  expect(
    renderer.root.findByProps({ testID: 'feedback-compose-submit' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
  jest.useRealTimers();
});

const defaultSource = {
  eventId: 'evt_day-one',
  rootEventId: 'evt_trip',
  screenKey: 'event-hub/plan',
  sourceLabel: 'Event · Plan',
};

const screenshotSource = {
  ...defaultSource,
  feedbackId: 'fbk_00000000-0000-4000-8000-000000000010',
};

const sourceScreenshot = {
  attachmentId: 'att_00000000-0000-4000-8000-000000000011',
  feedbackId: screenshotSource.feedbackId,
  pixelHeight: 844,
  pixelWidth: 390,
  previewDataUri: 'data:image/png;base64,QUJDRA==',
};

async function renderScreen(
  overrides: Partial<React.ComponentProps<typeof FeedbackComposeScreen>> = {},
) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <FeedbackComposeScreen
          onReturn={jest.fn()}
          source={defaultSource}
          {...overrides}
        />
      </SafeAreaProvider>,
    );
    await Promise.resolve();
  });
  return renderer!;
}

async function fill(
  renderer: ReactTestRenderer.ReactTestRenderer,
  title: string,
  body: string,
) {
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-title' })
      .props.onChangeText(title),
  );
  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'feedback-compose-body' })
      .props.onChangeText(body),
  );
}

async function flushEffects() {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
  });
}

function receipt(
  state: FeedbackSubmissionReceipt['state'],
): FeedbackSubmissionReceipt {
  return {
    accountUserId: mockAccountUserId,
    attempts: state === 'delivered' ? 1 : 0,
    createdAt: '2026-07-19T10:00:00.000Z',
    deliveredAt: state === 'delivered' ? '2026-07-19T10:00:01.000Z' : null,
    failure: null,
    feedbackId: 'fbk_00000000-0000-4000-8000-000000000001',
    nextAttemptAt: null,
    state,
    updatedAt: '2026-07-19T10:00:00.000Z',
  };
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .flat(Infinity)
    .join(' ');
}
