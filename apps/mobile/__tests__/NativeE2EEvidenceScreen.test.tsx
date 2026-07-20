import { MobileSyncEngine, type OutboxEvidence } from '@crew/mobile-data';
import type React from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Card } from '../src/design/primitives';
import {
  NativeE2EEvidenceRouteScreen,
  NativeE2EEvidenceScreen,
  NativeE2EEvidenceView,
} from '../src/screens/NativeE2EEvidenceScreen';

const accountA = `usr_${'1'.repeat(32)}`;
const accountB = `usr_${'2'.repeat(32)}`;
const mockClient = { request: jest.fn() };
const mockDatabase = {};
let mockAccountId: string | null = accountA;
let mockDatabaseAccountId = accountA;
let mockLifecycleStatus = 'ready';
let mockRequestId: string | null = 'crew-e2e.ios';
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockClient,
  useNativeE2ERequestId: () => mockRequestId,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockDatabaseAccountId,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountId,
    status: mockLifecycleStatus,
  }),
}));

beforeEach(() => {
  jest.restoreAllMocks();
  mockAccountId = accountA;
  mockDatabaseAccountId = accountA;
  mockLifecycleStatus = 'ready';
  mockRequestId = 'crew-e2e.ios';
  mockClient.request.mockReset();
});

test('renders only the bounded evidence contract and full SHA-256 fingerprints', async () => {
  const body = 'a'.repeat(64);
  const requestBody = 'b'.repeat(64);
  const key = 'c'.repeat(64);
  const cursor = 'd'.repeat(64);
  const sample = {
    attentionCount: 1,
    pendingCount: 2,
    pullCursorFingerprint: cursor,
    rows: [
      {
        clientSequence: 7,
        commandBodyFingerprint: body,
        idempotencyKeyFingerprint: key,
        mutationKind: 'golf.score.set',
        requestBodyFingerprint: requestBody,
        state: 'pending',
      },
    ],
    truncated: true,
    accountUserId: 'raw-account-must-not-render',
    commandJson: 'raw-body-must-not-render',
    cursor: 'raw-cursor-must-not-render',
    deviceId: 'raw-device-must-not-render',
    requestId: 'raw-request-must-not-render',
    token: 'raw-token-must-not-render',
  } as OutboxEvidence;
  const renderer = await render(
    <NativeE2EEvidenceView
      evidence={sample}
      onBack={jest.fn()}
      onRefresh={jest.fn()}
      status="ready"
    />,
  );
  const text = textInside(renderer);

  expect(text).toContain('LOKAL GEPRÜFT');
  expect(text).toContain('PENDING');
  expect(text).toContain('golf.score.set');
  expect(text).toContain('#7');
  for (const fingerprint of [body, requestBody, key, cursor]) {
    expect(text).toContain(fingerprint);
  }
  for (const raw of [
    'raw-account-must-not-render',
    'raw-body-must-not-render',
    'raw-cursor-must-not-render',
    'raw-device-must-not-render',
    'raw-request-must-not-render',
    'raw-token-must-not-render',
  ]) {
    expect(text).not.toContain(raw);
  }
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('renders the three metrics as readable full-width rows at 390px', async () => {
  const renderer = await render(
    <NativeE2EEvidenceView
      evidence={{
        attentionCount: 3,
        pendingCount: 12,
        pullCursorFingerprint: null,
        rows: [],
        truncated: false,
      }}
      onBack={jest.fn()}
      onRefresh={jest.fn()}
      status="ready"
    />,
  );
  const expectedLabels = [
    'Ausstehend: 12',
    'Aufmerksamkeit: 3',
    'Gekürzt: NEIN',
  ];
  const expectedLabelSet = new Set(expectedLabels);
  const metricCards = renderer.root
    .findAllByType(Card)
    .filter(card => expectedLabelSet.has(card.props.accessibilityLabel));

  expect(metrics.frame.width).toBe(390);
  expect(
    renderer.root.findByProps({ testID: 'native-e2e-evidence-metrics' }).props
      .accessibilityRole,
  ).toBe('summary');
  expect(metricCards.map(card => card.props.accessibilityLabel)).toEqual(
    expectedLabels,
  );
  for (const card of metricCards) {
    expect(card.props).toMatchObject({
      accessible: true,
      accessibilityRole: 'text',
    });
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({
      width: '100%',
    });
  }
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('keeps 390px metric labels and values scalable and unclipped for Accessibility Large', async () => {
  const renderer = await render(
    <NativeE2EEvidenceView
      evidence={{
        attentionCount: 3,
        pendingCount: 12,
        pullCursorFingerprint: null,
        rows: [],
        truncated: false,
      }}
      onBack={jest.fn()}
      onRefresh={jest.fn()}
      status="ready"
    />,
  );
  const metricCards = renderer.root
    .findAllByType(Card)
    .filter(card =>
      String(card.props.accessibilityLabel).match(
        /^(Ausstehend|Aufmerksamkeit|Gekürzt):/,
      ),
    );

  expect(metricCards).toHaveLength(3);
  for (const card of metricCards) {
    const textNodes = card.findAllByType(Text);
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({
      width: '100%',
    });
    expect(textNodes).toHaveLength(2);
    for (const textNode of textNodes) {
      expect(textNode.props.allowFontScaling).not.toBe(false);
      expect(textNode.props.maxFontSizeMultiplier).toBeUndefined();
      expect(textNode.props.numberOfLines).toBeUndefined();
      expect(textNode.props.ellipsizeMode).toBeUndefined();
    }
  }
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('fails closed without the development request ID, active account or exact root', async () => {
  const read = jest.spyOn(MobileSyncEngine.prototype, 'readOutboxEvidence');
  mockRequestId = null;
  const disabled = await renderRoute('evt_native');
  expect(textInside(disabled)).toContain('nicht aktiviert');
  expect(read).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => disabled.unmount());

  mockRequestId = 'crew-e2e.ios';
  mockLifecycleStatus = 'signedOut';
  mockAccountId = null;
  const signedOut = await renderScreen('evt_native');
  expect(textInside(signedOut)).toContain('nicht aktiviert');
  expect(read).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => signedOut.unmount());

  mockLifecycleStatus = 'ready';
  mockAccountId = accountA;
  const invalidRoot = await renderRoute('invalid');
  expect(textInside(invalidRoot)).toContain('nicht aktiviert');
  expect(read).not.toHaveBeenCalled();
  expect(mockClient.request).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => invalidRoot.unmount());
});

test('conceals stale evidence when the root or account changes', async () => {
  const rootA = deferred<OutboxEvidence>();
  const accountChange = deferred<OutboxEvidence>();
  const read = jest
    .spyOn(MobileSyncEngine.prototype, 'readOutboxEvidence')
    .mockImplementation((accountUserId, rootEventId) => {
      if (rootEventId === 'evt_first') return rootA.promise;
      if (accountUserId === accountB) return accountChange.promise;
      return Promise.resolve(evidence('b'));
    });
  const renderer = await renderScreen('evt_first');
  expect(textInside(renderer)).toContain('WIRD GEPRÜFT');

  await updateScreen(renderer, 'evt_second');
  expect(textInside(renderer)).toContain('b'.repeat(64));
  rootA.resolve(evidence('a'));
  await ReactTestRenderer.act(async () => undefined);
  expect(textInside(renderer)).not.toContain('a'.repeat(64));

  mockAccountId = accountB;
  mockDatabaseAccountId = accountB;
  await updateScreen(renderer, 'evt_second');
  expect(textInside(renderer)).toContain('WIRD GEPRÜFT');
  expect(textInside(renderer)).not.toContain('b'.repeat(64));
  accountChange.resolve(evidence('c'));
  await ReactTestRenderer.act(async () => undefined);
  expect(textInside(renderer)).toContain('c'.repeat(64));
  expect(read).toHaveBeenCalledWith(accountA, 'evt_first');
  expect(read).toHaveBeenCalledWith(accountA, 'evt_second');
  expect(read).toHaveBeenCalledWith(accountB, 'evt_second');
  expect(mockClient.request).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

test('keeps loading and read errors generic and refreshes through SELECT-only evidence', async () => {
  const first = deferred<OutboxEvidence>();
  const read = jest
    .spyOn(MobileSyncEngine.prototype, 'readOutboxEvidence')
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce(evidence('e'));
  const renderer = await renderScreen('evt_loading');
  expect(textInside(renderer)).toContain('WIRD GEPRÜFT');
  first.reject(new Error('token raw-error-secret'));
  await ReactTestRenderer.act(async () => undefined);
  expect(textInside(renderer)).toContain(
    'Der lokale Nachweis konnte nicht sicher gelesen werden.',
  );
  expect(textInside(renderer)).not.toContain('raw-error-secret');

  await ReactTestRenderer.act(async () => {
    renderer.root
      .findByProps({
        testID: 'native-e2e-evidence-refresh',
      })
      .props.onPress();
  });
  expect(textInside(renderer)).toContain('e'.repeat(64));
  expect(read).toHaveBeenCalledTimes(2);
  expect(mockClient.request).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => renderer.unmount());
});

function evidence(character: string): OutboxEvidence {
  return {
    attentionCount: 0,
    pendingCount: 1,
    pullCursorFingerprint: character.repeat(64),
    rows: [],
    truncated: false,
  };
}

async function renderRoute(rootEventId: string) {
  return render(
    <NativeE2EEvidenceRouteScreen
      navigation={{ goBack: jest.fn() } as never}
      route={
        {
          key: 'native-e2e',
          name: 'NativeE2EEvidence',
          params: { rootEventId },
        } as never
      }
    />,
  );
}

async function renderScreen(rootEventId: string) {
  return render(
    <NativeE2EEvidenceScreen onBack={jest.fn()} rootEventId={rootEventId} />,
  );
}

async function updateScreen(
  renderer: ReactTestRenderer.ReactTestRenderer,
  rootEventId: string,
) {
  await ReactTestRenderer.act(async () => {
    renderer.update(
      <SafeAreaProvider initialMetrics={metrics}>
        <NativeE2EEvidenceScreen onBack={jest.fn()} rootEventId={rootEventId} />
      </SafeAreaProvider>,
    );
  });
}

async function render(node: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
  });
  return renderer;
}

function textInside(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .join(' ');
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
