import React from 'react';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { PrivateUnavailableScreen } from '../src/screens/PrivateAccessScreen';

const mockLifecycle = {
  accountId: null,
  continueSignedOut: jest.fn(async () => undefined),
  reloadSession: jest.fn(async () => undefined),
  replaceSession: jest.fn(async () => undefined),
  status: 'unavailable' as 'loading' | 'ready' | 'signedOut' | 'unavailable',
  unavailableReason: 'privateData' as 'privateData' | 'secureStorage' | null,
};

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateSessionLifecycle: () => mockLifecycle,
}));

const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLifecycle.status = 'unavailable';
  mockLifecycle.unavailableReason = 'privateData';
  mockLifecycle.continueSignedOut.mockReset().mockResolvedValue(undefined);
  mockLifecycle.reloadSession.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

test('keeps Retry direct and primary without opening confirmation', async () => {
  const renderer = await renderScreen();

  await ReactTestRenderer.act(() =>
    renderer.root
      .findByProps({ testID: 'private-access-retry' })
      .props.onPress(),
  );

  expect(mockLifecycle.reloadSession).toHaveBeenCalledTimes(1);
  expect(mockLifecycle.continueSignedOut).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('cancels native confirmation without touching the lifecycle', async () => {
  const renderer = await renderScreen();
  const safeExit = renderer.root.findByProps({
    testID: 'private-access-safe-exit',
  });

  safeExit.props.onPress();
  safeExit.props.onPress();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  await ReactTestRenderer.act(() => alertButton(0, 'Abbrechen').onPress?.());

  expect(mockLifecycle.continueSignedOut).not.toHaveBeenCalled();
  safeExit.props.onPress();
  expect(Alert.alert).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(jest.mocked(Alert.alert).mock.calls[1])).not.toMatch(
    /usr_|evt_|keychain|defekt|korrupt/i,
  );
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('confirms safe exit exactly once despite repeated taps', async () => {
  const renderer = await renderScreen();
  const safeExit = renderer.root.findByProps({
    testID: 'private-access-safe-exit',
  });

  safeExit.props.onPress();
  safeExit.props.onPress();
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  const confirmation = alertButton(0, 'Zur Anmeldung');
  await ReactTestRenderer.act(async () => {
    confirmation.onPress?.();
    confirmation.onPress?.();
    await flush();
  });

  expect(mockLifecycle.continueSignedOut).toHaveBeenCalledTimes(1);
  expect(mockLifecycle.continueSignedOut).toHaveBeenCalledWith();
  expect(
    renderer.root.findByProps({ testID: 'private-access-safe-exit' }).props
      .loading,
  ).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('shows a concealed failure and permits one newly confirmed retry', async () => {
  mockLifecycle.continueSignedOut
    .mockRejectedValueOnce(new Error('/private/usr_secret'))
    .mockResolvedValueOnce(undefined);
  const renderer = await renderScreen();

  renderer.root
    .findByProps({ testID: 'private-access-safe-exit' })
    .props.onPress();
  await ReactTestRenderer.act(async () => {
    alertButton(0, 'Zur Anmeldung').onPress?.();
    await flush();
  });
  expect(JSON.stringify(renderer.toJSON())).not.toContain(
    '/private/usr_secret',
  );
  expect(
    renderer.root.findByProps({ testID: 'private-access-safe-exit-error' }),
  ).toBeTruthy();

  renderer.root
    .findByProps({ testID: 'private-access-safe-exit' })
    .props.onPress();
  await ReactTestRenderer.act(async () => {
    alertButton(1, 'Zur Anmeldung').onPress?.();
    await flush();
  });
  expect(mockLifecycle.continueSignedOut).toHaveBeenCalledTimes(2);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function renderScreen() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <PrivateUnavailableScreen />
      </SafeAreaProvider>,
    );
  });
  return renderer;
}

function alertButton(call: number, text: string) {
  const buttons = jest.mocked(Alert.alert).mock.calls[call]?.[2] ?? [];
  const button = buttons.find(candidate => candidate.text === text);
  if (!button) throw new Error(`Missing alert button: ${text}`);
  return button;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}
