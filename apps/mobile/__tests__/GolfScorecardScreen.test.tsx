import React from 'react';
import { TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import type { GolfScorecardViewModel } from '../src/golf/GolfScorecardController';
import { GolfScorecardRuntime } from '../src/golf/GolfScorecardRuntime';
import { GolfScorecardScreen } from '../src/screens/GolfScorecardScreen';

const mockAccountUserId = `usr_${'1'.repeat(32)}`;
const rootEventId = 'evt_golf-tour';
const eventId = 'evt_carya-round';
const mockDatabase = {};
const mockGatewayClient = { request: jest.fn() };
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

jest.mock('../src/app/GatewayProvider', () => ({
  useGatewayClient: () => mockGatewayClient,
}));

jest.mock('../src/app/PrivateBootstrapGate', () => ({
  usePrivateDatabase: () => ({
    accountId: mockAccountUserId,
    database: mockDatabase,
  }),
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountUserId,
    status: 'ready',
  }),
}));

beforeEach(() => {
  jest.restoreAllMocks();
});

test('production screen retries a failed local save with the same caller-owned intent ID and no direct data path', async () => {
  const model = participantModel();
  const runtime = {
    load: jest.fn(async () => model),
    refresh: jest.fn(async () => undefined),
    requeueConflict: jest.fn(),
    saveScore: jest
      .fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockResolvedValueOnce({ outbox: { state: 'pending' } }),
  } as unknown as GolfScorecardRuntime;
  const create = jest
    .spyOn(GolfScorecardRuntime, 'create')
    .mockResolvedValue(runtime);
  const renderer = await render(
    <GolfScorecardScreen
      eventId={eventId}
      onBack={jest.fn()}
      rootEventId={rootEventId}
    />,
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountUserId: mockAccountUserId,
      client: mockGatewayClient,
      database: mockDatabase,
      eventId,
      rootEventId,
    }),
  );
  expect(runtime.refresh).toHaveBeenCalledTimes(1);

  const inputs = renderer.root.findAllByType(TextInput);
  const strokes = inputs.find(
    input => input.props.testID === 'golf-strokes-input',
  );
  const putts = inputs.find(input => input.props.testID === 'golf-putts-input');
  if (!strokes || !putts) throw new Error('Golf score inputs are missing');
  await ReactTestRenderer.act(() => strokes.props.onChangeText('4'));
  await ReactTestRenderer.act(() => putts.props.onChangeText('1'));

  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'golf-save-action' }).props.onPress(),
  );
  expect(runtime.saveScore).toHaveBeenCalledTimes(1);
  expect(
    renderer.root
      .findAllByType(TextInput)
      .find(input => input.props.testID === 'golf-strokes-input')?.props.value,
  ).toBe('4');

  await ReactTestRenderer.act(async () =>
    renderer.root.findByProps({ testID: 'golf-save-action' }).props.onPress(),
  );
  expect(runtime.saveScore).toHaveBeenCalledTimes(2);
  const first = (runtime.saveScore as jest.Mock).mock.calls[0][0];
  const second = (runtime.saveScore as jest.Mock).mock.calls[1][0];
  expect(first.clientIntentId).toMatch(/^gsi_/);
  expect(second.clientIntentId).toBe(first.clientIntentId);
  expect(second).toMatchObject({
    baseVersion: 0,
    hole: 1,
    putts: 1,
    strokes: 4,
  });
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('sync is visibly busy and a rapid double tap starts only one refresh', async () => {
  const model = participantModel();
  let finishRefresh = () => {};
  const refresh = new Promise<void>(resolve => {
    finishRefresh = resolve;
  });
  const runtime = {
    load: jest.fn(async () => model),
    refresh: jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(refresh),
    requeueConflict: jest.fn(),
    saveScore: jest.fn(),
  } as unknown as GolfScorecardRuntime;
  jest.spyOn(GolfScorecardRuntime, 'create').mockResolvedValue(runtime);
  const renderer = await render(
    <GolfScorecardScreen
      eventId={eventId}
      onBack={jest.fn()}
      rootEventId={rootEventId}
    />,
  );
  expect(runtime.refresh).toHaveBeenCalledTimes(1);

  const onPress = renderer.root.findByProps({
    testID: 'golf-sync-action',
  }).props.onPress;
  let first: Promise<void> | undefined;
  let second: Promise<void> | undefined;
  await ReactTestRenderer.act(async () => {
    first = onPress();
    second = onPress();
    await Promise.resolve();
  });
  expect(runtime.refresh).toHaveBeenCalledTimes(2);
  const busy = renderer.root.findByProps({ testID: 'golf-sync-action' });
  expect(busy.props.loading).toBe(true);
  expect(busy.props.disabled).toBe(true);

  await ReactTestRenderer.act(async () => {
    finishRefresh();
    await Promise.all([first, second]);
  });
  expect(runtime.refresh).toHaveBeenCalledTimes(2);
  expect(
    renderer.root.findByProps({ testID: 'golf-sync-action' }).props.loading,
  ).toBe(false);
  await ReactTestRenderer.act(() => renderer.unmount());
});

async function render(node: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
  });
  return renderer!;
}

function participantModel(): GolfScorecardViewModel {
  return {
    access: 'edit',
    eventTitle: 'Carya Golf Club',
    holes: Array.from({ length: 18 }, (_, index) => ({
      authoritativePutts: null,
      authoritativeStablefordPoints: null,
      authoritativeStrokes: null,
      conflict: null,
      deliveryState: 'untouched',
      handicapStrokes: 1,
      hole: index + 1,
      isPending: false,
      netStrokes: null,
      par: index % 2 === 0 ? 4 : 5,
      putts: null,
      stablefordPoints: 0,
      strokeIndex: index + 1,
      strokes: null,
      version: 0,
    })),
    leaderboard: [
      {
        holesCompleted: 0,
        isSelf: true,
        name: 'Du',
        rank: 1,
        stablefordPoints: 0,
        teamName: 'Mint',
      },
    ],
    role: 'participant',
    roundVersion: 1,
    syncStatus: {
      attentionCount: 0,
      nextAttemptAt: null,
      pendingCount: 0,
      state: 'synced',
      summary: 'All changes saved',
    },
  };
}
