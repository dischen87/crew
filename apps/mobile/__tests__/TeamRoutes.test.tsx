import React from 'react';
import { MobileDataStore, type OutboxItem } from '@crew/mobile-data';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { TeamDecisionScreen } from '../src/screens/TeamDecisionScreen';
import { TeamSetupScreen } from '../src/screens/TeamSetupScreen';
import type {
  TeamAssignmentsViewModel,
  TeamDecisionViewModel,
} from '../src/team/TeamCollaborationController';
import { TeamCollaborationController } from '../src/team/TeamCollaborationController';
import { TeamProductionRuntime } from '../src/team/TeamProductionRuntime';

const mockAccountUserId = `usr_${'1'.repeat(32)}`;
const otherUserId = `usr_${'2'.repeat(32)}`;
const rootEventId = 'evt_team-root';
const eventId = 'evt_team-session';
const decisionId = 'tdc_dinner';
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
  usePrivateDatabase: () => ({ accountId: mockAccountUserId, database: mockDatabase }),
  usePrivateSessionLifecycle: () => ({
    accountId: mockAccountUserId,
    status: 'ready',
  }),
}));

async function render(node: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
  });
  return renderer!;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

test('TeamSetup route loads the exact root/event runtime and publishes stable user IDs through the outbox seam', async () => {
  const model = assignmentsModel();
  const runtime = {
    loadAssignments: jest.fn(async () => model),
    publishAssignments: jest.fn(async () => ({ state: 'pending' })),
    refresh: jest.fn(async () => undefined),
  } as unknown as TeamProductionRuntime;
  const create = jest
    .spyOn(TeamProductionRuntime, 'create')
    .mockResolvedValue(runtime);
  const goBack = jest.fn();
  const renderer = await render(
    <TeamSetupScreen
      navigation={{ goBack } as never}
      route={{
        key: 'team-setup',
        name: 'TeamSetup',
        params: { rootEventId, eventId },
      }}
    />,
  );

  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      accountUserId: mockAccountUserId,
      client: mockGatewayClient,
      database: mockDatabase,
      rootEventId,
    }),
  );
  expect(runtime.loadAssignments).toHaveBeenCalledWith(eventId);
  const move = renderer.root.findByProps({ testID: `move-${mockAccountUserId}` });
  await ReactTestRenderer.act(() => move.props.onPress());
  const primary = renderer.root
    .findAllByType(Button)
    .find(node => node.props.testID === 'team-assignments-primary-action');
  if (!primary) throw new Error('Team primary action missing');
  await ReactTestRenderer.act(async () => primary.props.onPress());
  expect(runtime.publishAssignments).toHaveBeenCalledWith(
    expect.objectContaining({
      access: 'manage',
      teams: [
        expect.objectContaining({ members: [] }),
        expect.objectContaining({
          members: expect.arrayContaining([
            expect.objectContaining({ id: mockAccountUserId }),
          ]),
        }),
      ],
    }),
  );
  expect(goBack).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('Decision route queues one selected option and viewer/read-only states remain guarded by the production model', async () => {
  const model = decisionModel();
  const queued = { ...model, responseMutationId: 'mutation-response' };
  const runtime = {
    loadDecision: jest
      .fn()
      .mockResolvedValueOnce(model)
      .mockResolvedValueOnce(model)
      .mockResolvedValueOnce(queued),
    refresh: jest.fn(async () => undefined),
    submitResponse: jest.fn(async () => ({ state: 'pending' })),
  } as unknown as TeamProductionRuntime;
  jest.spyOn(TeamProductionRuntime, 'create').mockResolvedValue(runtime);
  const goBack = jest.fn();
  const renderer = await render(
    <TeamDecisionScreen
      navigation={{ goBack } as never}
      route={{
        key: 'decision',
        name: 'Decision',
        params: { rootEventId, decisionId },
      }}
    />,
  );

  const option = renderer.root.findByProps({
    testID: 'team-decision-option-tdo_fish',
  });
  await ReactTestRenderer.act(() => option.props.onPress());
  const primary = renderer.root
    .findAllByType(Button)
    .find(node => node.props.testID === 'team-decision-primary-action');
  if (!primary) throw new Error('Decision primary action missing');
  await ReactTestRenderer.act(async () => primary.props.onPress());
  expect(runtime.submitResponse).toHaveBeenCalledTimes(1);
  expect(runtime.submitResponse).toHaveBeenCalledWith(
    decisionId,
    'tdo_fish',
  );
  expect(goBack).not.toHaveBeenCalled();
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('production runtime rechecks the active account after async reads and performs zero outbox writes after a switch', async () => {
  jest.spyOn(MobileDataStore.prototype, 'listMemberships').mockResolvedValue([
    {
      accountUserId: mockAccountUserId,
      createdAt: '2026-07-19T08:00:00.000Z',
      memberUserId: mockAccountUserId,
      role: 'owner',
      rootEventId,
      status: 'active',
      updatedAt: '2026-07-19T08:00:00.000Z',
      version: 1,
    },
  ]);
  let activeAccount: string | null = mockAccountUserId;
  const createRuntime = () =>
    TeamProductionRuntime.create({
      accountUserId: mockAccountUserId,
      activeAccountUserId: () => activeAccount,
      client: null,
      database: mockDatabase as never,
      deviceIdStore: {
        getOrCreate: async () => 'dvc_00000000-0000-4000-8000-000000000001',
      },
      rootEventId,
    });
  const outboxWrite = jest.fn();

  const assignmentRuntime = await createRuntime();
  if (!assignmentRuntime) throw new Error('Assignment runtime missing');
  const assignmentController = jest
    .spyOn(TeamCollaborationController.prototype, 'publishAssignments')
    .mockImplementation(async (_input, assertBeforeWrite) => {
      await Promise.resolve();
      activeAccount = otherUserId;
      assertBeforeWrite?.();
      outboxWrite();
      return {} as OutboxItem;
    });
  await expect(
    assignmentRuntime.publishAssignments(assignmentsModel()),
  ).rejects.toThrow('Active account changed');
  expect(outboxWrite).not.toHaveBeenCalled();
  assignmentController.mockRestore();

  activeAccount = mockAccountUserId;
  const decisionRuntime = await createRuntime();
  if (!decisionRuntime) throw new Error('Decision runtime missing');
  jest
    .spyOn(TeamCollaborationController.prototype, 'submitResponse')
    .mockImplementation(async (_input, assertBeforeWrite) => {
      await Promise.resolve();
      activeAccount = otherUserId;
      assertBeforeWrite?.();
      outboxWrite();
      return {} as OutboxItem;
    });
  await expect(
    decisionRuntime.submitResponse(decisionId, 'tdo_fish'),
  ).rejects.toThrow('Active account changed');
  expect(outboxWrite).not.toHaveBeenCalled();
});

function assignmentsModel(): Extract<TeamAssignmentsViewModel, { access: 'manage' }> {
  return {
    access: 'manage',
    deliveryLabel: 'Synchronisiert',
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat',
    hasLocalChanges: false,
    role: 'owner',
    rootEventId,
    teams: [
      {
        capacity: null,
        color: '#D5C2E8',
        id: 'ttm_lavender',
        members: [{ id: mockAccountUserId, name: 'Lena' }],
        name: 'Lavendel',
      },
      {
        capacity: null,
        color: '#C2E8D5',
        id: 'ttm_mint',
        members: [{ id: otherUserId, name: 'Teilnehmende Person 2' }],
        name: 'Mint',
      },
    ],
    version: 3,
  };
}

function decisionModel(): TeamDecisionViewModel {
  return {
    authoritativeOptionId: null,
    canRespond: true,
    createdAt: '2026-07-19T08:00:00.000Z',
    decisionId,
    deliveryLabel: 'Synchronisiert',
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat',
    lifecycle: 'open',
    options: [
      { id: 'tdo_fish', label: 'Fischrestaurant', responseCount: 3 },
      { id: 'tdo_rooftop', label: 'Rooftop Dinner', responseCount: 2 },
    ],
    responseCount: 5,
    responseMutationId: null,
    role: 'participant',
    rootEventId,
    selectedOptionId: null,
    title: 'Wo essen wir heute Abend?',
    version: 2,
  };
}
