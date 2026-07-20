import type {
  MobileSyncEngine,
  OutboxItem,
  TeamAssignmentReadModel,
  TeamDecisionReadModel,
  TeamOfflineStore,
} from '@crew/mobile-data';
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import { TeamAssignmentsView } from '../src/screens/TeamAssignmentsView';
import { TeamDecisionView } from '../src/screens/TeamDecisionView';
import {
  TeamCollaborationController,
  type TeamAssignmentsViewModel,
  type TeamDecisionViewModel,
} from '../src/team/TeamCollaborationController';

const accountUserId = `usr_${'1'.repeat(32)}`;
const otherUserId = `usr_${'2'.repeat(32)}`;
const rootEventId = 'evt_team-root';
const eventId = 'evt_team-session';
const decisionId = 'tdc_dinner';
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

async function render(node: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>,
    );
  });
  return renderer!;
}

test('manager assignments expose one publish action and accessible non-gesture moves', async () => {
  const onMoveMember = jest.fn();
  const onPrimaryAction = jest.fn();
  const model = managerAssignments();
  const renderer = await render(
    <TeamAssignmentsView
      model={model}
      onBack={jest.fn()}
      onMoveMember={onMoveMember}
      onPrimaryAction={onPrimaryAction}
    />,
  );

  const primary = renderer.root
    .findAllByType(Button)
    .filter(node => node.props.testID === 'team-assignments-primary-action');
  expect(primary).toHaveLength(1);
  expect(primary[0].props.label).toBe('Einteilung veröffentlichen');

  const move = renderer.root.find(
    node =>
      node.props.testID === `move-${accountUserId}` &&
      node.props.accessibilityRole === 'button',
  );
  expect(move.props.accessibilityLabel).toContain(
    'aktuelles Team Lavendel, Teambelegung 1 von 2',
  );
  expect(move.props.accessibilityHint).toBe('Verschiebt nach Mint.');
  expect(
    renderer.root.findAll(
      node =>
        Array.isArray(node.props.children) &&
        node.props.children.join('') === 'nach Mint',
    ).length,
  ).toBeGreaterThan(0);
  expect(
    renderer.root.findAll(node => node.props.children === 'L').length,
  ).toBeGreaterThan(0);
  await ReactTestRenderer.act(() => move.props.onPress());
  expect(onMoveMember).toHaveBeenCalledWith(accountUserId, 'ttm_mint');

  await ReactTestRenderer.act(() => primary[0].props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  expectSafeScrollViewport(renderer);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('viewer runtime guard never renders foreign roster or management controls', async () => {
  const invalidViewerModel = {
    ...managerAssignments(),
    access: 'manage',
    role: 'viewer',
  } as unknown as TeamAssignmentsViewModel;
  const renderer = await render(
    <TeamAssignmentsView
      model={invalidViewerModel}
      onBack={jest.fn()}
      onMoveMember={jest.fn()}
      onPrimaryAction={jest.fn()}
    />,
  );

  expect(
    renderer.root.findAllByProps({ testID: `move-${otherUserId}` }),
  ).toHaveLength(0);
  expect(
    renderer.root.findAll(node => node.props.children === 'Fremde Person'),
  ).toHaveLength(0);
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Nur ansehen' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({ testID: 'team-assignments-primary-action' })
      .props.label,
  ).toBe('Zurück zum Event');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('open decision announces selected and delivery state without color alone', async () => {
  const onSelectOption = jest.fn();
  const onPrimaryAction = jest.fn();
  const model = openDecision();
  const renderer = await render(
    <TeamDecisionView
      model={model}
      onBack={jest.fn()}
      onPrimaryAction={onPrimaryAction}
      onSelectOption={onSelectOption}
    />,
  );

  const selected = renderer.root.find(
    node =>
      node.props.testID === 'team-decision-option-tdo_fish' &&
      node.props.accessibilityRole === 'radio',
  );
  expect(selected.props.accessibilityState).toEqual({
    checked: true,
    disabled: false,
  });
  expect(selected.props.accessibilityLabel).toContain('ausgewählt');
  await ReactTestRenderer.act(() => selected.props.onPress());
  expect(onSelectOption).toHaveBeenCalledWith('tdo_fish');

  const primary = renderer.root
    .findAllByType(Button)
    .filter(node => node.props.testID === 'team-decision-primary-action');
  expect(primary).toHaveLength(1);
  expect(primary[0].props.label).toBe('Antwort senden');
  await ReactTestRenderer.act(() => primary[0].props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  expectSafeScrollViewport(renderer);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('closed during outage keeps local choice visible and strictly read-only', async () => {
  const onSelectOption = jest.fn();
  const model: TeamDecisionViewModel = {
    ...openDecision(),
    canRespond: false,
    deliveryLabel: 'Aktion erforderlich',
    deliveryState: 'needs_attention',
    lifecycle: 'closed',
    responseMutationId: 'queued-response',
  };
  const renderer = await render(
    <TeamDecisionView
      model={model}
      onBack={jest.fn()}
      onPrimaryAction={jest.fn()}
      onSelectOption={onSelectOption}
    />,
  );

  const selected = renderer.root.findByProps({
    testID: 'team-decision-option-tdo_fish',
  });
  expect(selected.props.accessibilityState).toEqual({
    checked: true,
    disabled: true,
  });
  expect(selected.props.accessibilityLabel).toContain('Aktion erforderlich');
  expect(
    renderer.root.findByProps({ testID: 'team-decision-primary-action' }).props
      .label,
  ).toBe('Zurück zur Session');
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Aktion erforderlich' }),
  ).toBeTruthy();
  expect(onSelectOption).not.toHaveBeenCalled();

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('needs-attention decision CTA accurately returns instead of promising a review action', async () => {
  const onPrimaryAction = jest.fn();
  const model: TeamDecisionViewModel = {
    ...openDecision(),
    canRespond: false,
    deliveryLabel: 'Aktion erforderlich',
    deliveryState: 'needs_attention',
    responseMutationId: 'queued-response',
  };
  const renderer = await render(
    <TeamDecisionView
      model={model}
      onBack={jest.fn()}
      onPrimaryAction={onPrimaryAction}
      onSelectOption={jest.fn()}
    />,
  );

  const primary = renderer.root.findByProps({
    testID: 'team-decision-primary-action',
  });
  expect(primary.props.label).toBe('Zurück zur Session');
  expect(primary.props.accessibilityHint).toContain('Kehrt zur Session zurück');
  await ReactTestRenderer.act(() => primary.props.onPress());
  expect(onPrimaryAction).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('controller reduces roster by role and never returns foreign responses', async () => {
  const assignment = assignmentReadModel();
  const decision = decisionReadModel();
  const store = {
    getAssignments: jest.fn(async () => assignment),
    getDecision: jest.fn(async () => decision),
  } satisfies Pick<TeamOfflineStore, 'getAssignments' | 'getDecision'>;
  const sync = syncMock();
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id =>
      id === accountUserId
        ? { id, name: 'Lena' }
        : { id, name: 'Fremde Person' },
    role: 'viewer',
    store,
    sync,
  });

  const assignments = await controller.loadAssignments({
    capacityPerTeam: 2,
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat',
    rootEventId,
  });
  expect(assignments).toEqual(
    expect.objectContaining({ access: 'read', ownTeam: null, role: 'viewer' }),
  );
  expect(JSON.stringify(assignments)).not.toContain('memberUserIds');
  expect(JSON.stringify(assignments)).not.toContain(otherUserId);

  const decisionModel = await controller.loadDecision({
    decisionId,
    eventTitle: 'Team Retreat',
    rootEventId,
  });
  expect(decisionModel).toEqual(
    expect.objectContaining({
      canRespond: false,
      selectedOptionId: null,
      role: 'viewer',
    }),
  );
  expect(JSON.stringify(decisionModel)).not.toContain('userId');
  await expect(
    controller.submitResponse({
      decisionId,
      optionId: 'tdo_fish',
      rootEventId,
    }),
  ).rejects.toThrow('Viewers cannot answer');
});

test('participant projection contains only the own assignment', async () => {
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id => ({ id, name: 'Lena' }),
    role: 'participant',
    store: {
      getAssignments: jest.fn(async () => assignmentReadModel()),
      getDecision: jest.fn(async () => decisionReadModel()),
    },
    sync: syncMock(),
  });

  const model = await controller.loadAssignments({
    capacityPerTeam: 2,
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat',
    rootEventId,
  });
  expect(model).toEqual(
    expect.objectContaining({
      access: 'read',
      ownTeam: { color: '#D5C2E8', id: 'ttm_lavender', name: 'Lavendel' },
      role: 'participant',
    }),
  );
  expect(JSON.stringify(model)).not.toContain('members');
  expect(JSON.stringify(model)).not.toContain(otherUserId);
});

test('manager keeps stable user IDs while nullable directory names get generic accessible labels', async () => {
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: async id =>
      id === accountUserId ? { id, name: '  Lena Graf  ' } : null,
    role: 'owner',
    store: {
      getAssignments: jest.fn(async () => assignmentReadModel()),
      getDecision: jest.fn(async () => decisionReadModel()),
    },
    sync: syncMock(),
  });

  const model = await controller.loadAssignments({
    capacityPerTeam: null,
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat',
    rootEventId,
  });
  expect(model?.access).toBe('manage');
  if (!model || model.access !== 'manage') throw new Error('manager model');
  expect(model.teams[0]?.members).toEqual([
    { id: accountUserId, name: 'Lena Graf' },
  ]);
  expect(model.teams[1]?.members).toEqual([
    { id: otherUserId, name: 'Teilnehmende Person 2' },
  ]);
  expect(model.teams[1]?.members[0]?.id).toBe(otherUserId);
});

test('manager adapter sends assignments and decision through the typed outbox seams', async () => {
  const sync = syncMock();
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id => ({
      id,
      name: id === accountUserId ? 'Lena' : 'Marco',
    }),
    role: 'organizer',
    store: {
      getAssignments: jest.fn(async () => assignmentReadModel()),
      getDecision: jest.fn(async () => decisionReadModel()),
    },
    sync,
  });

  await controller.publishAssignments({
    eventId,
    rootEventId,
    teams: [
      {
        color: '#D5C2E8',
        id: 'ttm_lavender',
        memberUserIds: [accountUserId, otherUserId],
        name: 'Lavendel',
      },
    ],
  });
  expect(sync.enqueueTeamAssignments).toHaveBeenCalledWith(
    accountUserId,
    rootEventId,
    'device-team-ui',
    expect.objectContaining({ baseVersion: 3, eventId }),
  );

  await controller.replaceDecision({
    decisionId,
    eventId,
    options: [
      { id: 'tdo_fish', label: 'Fischrestaurant' },
      { id: 'tdo_rooftop', label: 'Rooftop Dinner' },
    ],
    rootEventId,
    state: 'open',
    title: 'Wo essen wir heute Abend?',
  });
  expect(sync.enqueueTeamDecision).toHaveBeenCalledWith(
    accountUserId,
    rootEventId,
    'device-team-ui',
    expect.objectContaining({ baseVersion: 2, decisionId, eventId }),
  );
});

test('pre-write account guard runs after each async read and before either outbox enqueue', async () => {
  let activeAccount: string | null = accountUserId;
  const assertActive = () => {
    if (activeAccount !== accountUserId) throw new Error('account switched');
  };
  const sync = syncMock();
  const store = {
    getAssignments: jest.fn(async () => {
      activeAccount = otherUserId;
      return assignmentReadModel();
    }),
    getDecision: jest.fn(async () => {
      activeAccount = otherUserId;
      return decisionReadModel();
    }),
  } satisfies Pick<TeamOfflineStore, 'getAssignments' | 'getDecision'>;
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id => ({ id, name: 'Lena' }),
    role: 'owner',
    store,
    sync,
  });

  await expect(
    controller.publishAssignments(
      {
        eventId,
        rootEventId,
        teams: [
          {
            color: '#D5C2E8',
            id: 'ttm_lavender',
            memberUserIds: [accountUserId],
            name: 'Lavendel',
          },
        ],
      },
      assertActive,
    ),
  ).rejects.toThrow('account switched');
  expect(sync.enqueueTeamAssignments).not.toHaveBeenCalled();

  activeAccount = accountUserId;
  await expect(
    controller.submitResponse(
      { decisionId, optionId: 'tdo_fish', rootEventId },
      assertActive,
    ),
  ).rejects.toThrow('account switched');
  expect(sync.enqueueTeamResponse).not.toHaveBeenCalled();
});

test('controller coalesces concurrent response taps and replays the same choice as a no-op', async () => {
  let release!: (value: OutboxItem) => void;
  const queued = new Promise<OutboxItem>(resolve => {
    release = resolve;
  });
  const store = {
    getAssignments: jest.fn(async () => assignmentReadModel()),
    getDecision: jest.fn(async () => decisionReadModel()),
  } satisfies Pick<TeamOfflineStore, 'getAssignments' | 'getDecision'>;
  const sync = syncMock();
  sync.enqueueTeamResponse.mockReturnValue(queued);
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id => ({ id, name: 'Lena' }),
    role: 'participant',
    store,
    sync,
  });
  const input = { decisionId, optionId: 'tdo_fish', rootEventId };
  const first = controller.submitResponse(input);
  const second = controller.submitResponse(input);
  expect(first).toBe(second);
  await Promise.resolve();
  expect(sync.enqueueTeamResponse).toHaveBeenCalledTimes(1);
  release(outboxItem());
  await expect(first).resolves.toEqual(outboxItem());

  store.getDecision.mockResolvedValue({
    ...decisionReadModel(),
    authoritativeOptionId: 'tdo_fish',
    selectedOptionId: 'tdo_fish',
    responseSyncState: 'synced',
  });
  await expect(controller.submitResponse(input)).resolves.toBeNull();
  expect(sync.enqueueTeamResponse).toHaveBeenCalledTimes(1);
});

test('controller retains a queued choice when the pulled decision closes', async () => {
  const store = {
    getAssignments: jest.fn(async () => assignmentReadModel()),
    getDecision: jest.fn(async () => ({
      ...decisionReadModel(),
      canRespond: false,
      responseMutationId: 'mutation-local',
      responseSyncState: 'needs_attention' as const,
      selectedOptionId: 'tdo_fish',
      state: 'closed' as const,
    })),
  } satisfies Pick<TeamOfflineStore, 'getAssignments' | 'getDecision'>;
  const controller = new TeamCollaborationController({
    accountUserId,
    deviceId: 'device-team-ui',
    resolvePerson: id => ({ id, name: 'Lena' }),
    role: 'participant',
    store,
    sync: syncMock(),
  });

  await expect(
    controller.loadDecision({
      decisionId,
      eventTitle: 'Team Retreat',
      rootEventId,
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      canRespond: false,
      deliveryState: 'needs_attention',
      lifecycle: 'closed',
      selectedOptionId: 'tdo_fish',
    }),
  );
});

function expectSafeScrollViewport(
  renderer: ReactTestRenderer.ReactTestRenderer,
) {
  const scroller = renderer.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scroller.props.style)).toMatchObject({
    flex: 1,
    marginTop: metrics.insets.top,
  });
  expect(StyleSheet.flatten(scroller.props.contentContainerStyle)).toMatchObject(
    { paddingTop: 0 },
  );
}

function managerAssignments(): TeamAssignmentsViewModel {
  return {
    access: 'manage',
    deliveryLabel: 'Änderungen offen · noch nicht veröffentlicht',
    deliveryState: 'unpublished',
    eventId,
    eventTitle: 'Team Retreat · Belek',
    hasLocalChanges: true,
    role: 'organizer',
    rootEventId,
    teams: [
      {
        capacity: 2,
        color: '#D5C2E8',
        id: 'ttm_lavender',
        members: [{ id: accountUserId, name: 'Lena' }],
        name: 'Lavendel',
      },
      {
        capacity: 2,
        color: '#C2E8D5',
        id: 'ttm_mint',
        members: [{ id: otherUserId, name: 'Fremde Person' }],
        name: 'Mint',
      },
    ],
    version: 3,
  };
}

function openDecision(): TeamDecisionViewModel {
  return {
    authoritativeOptionId: null,
    canRespond: true,
    createdAt: '2026-07-19T08:00:00.000Z',
    decisionId,
    deliveryLabel: 'Synchronisiert',
    deliveryState: 'synced',
    eventId,
    eventTitle: 'Team Retreat · Belek',
    lifecycle: 'open',
    options: [
      { id: 'tdo_fish', label: 'Fischrestaurant', responseCount: 3 },
      { id: 'tdo_rooftop', label: 'Rooftop Dinner', responseCount: 2 },
      { id: 'tdo_beach', label: 'Beach BBQ', responseCount: 1 },
    ],
    responseCount: 6,
    responseMutationId: null,
    role: 'participant',
    rootEventId,
    selectedOptionId: 'tdo_fish',
    title: 'Wo essen wir heute Abend?',
    version: 2,
  };
}

function assignmentReadModel(): TeamAssignmentReadModel {
  return {
    canManage: true,
    eventId,
    ownTeam: { color: '#D5C2E8', id: 'ttm_lavender', name: 'Lavendel' },
    rootEventId,
    roster: [
      {
        color: '#D5C2E8',
        id: 'ttm_lavender',
        memberUserIds: [accountUserId],
        name: 'Lavendel',
      },
      {
        color: '#C2E8D5',
        id: 'ttm_mint',
        memberUserIds: [otherUserId],
        name: 'Mint',
      },
    ],
    teams: [
      { color: '#D5C2E8', id: 'ttm_lavender', name: 'Lavendel' },
      { color: '#C2E8D5', id: 'ttm_mint', name: 'Mint' },
    ],
    version: 3,
  };
}

function decisionReadModel(): TeamDecisionReadModel {
  return {
    aggregateVersion: 4,
    authoritativeOptionId: null,
    canManage: false,
    canRespond: true,
    createdAt: '2026-07-19T08:00:00.000Z',
    eventId,
    id: decisionId,
    options: [
      { id: 'tdo_fish', label: 'Fischrestaurant', responseCount: 3 },
      { id: 'tdo_rooftop', label: 'Rooftop Dinner', responseCount: 2 },
    ],
    responseCount: 5,
    responseMutationId: null,
    responseSyncState: null,
    rootEventId,
    selectedOptionId: null,
    state: 'open',
    title: 'Wo essen wir heute Abend?',
    updatedAt: '2026-07-19T08:10:00.000Z',
    version: 2,
  };
}

function syncMock() {
  return {
    enqueueTeamAssignments: jest.fn(async () => outboxItem()),
    enqueueTeamDecision: jest.fn(async () => outboxItem()),
    enqueueTeamResponse: jest.fn(async () => outboxItem()),
  } satisfies Pick<
    MobileSyncEngine,
    'enqueueTeamAssignments' | 'enqueueTeamDecision' | 'enqueueTeamResponse'
  >;
}

function outboxItem(): OutboxItem {
  return {
    accountUserId,
    appliedRootRevision: null,
    attempts: 0,
    clientMutationId: 'mutation-team-response',
    clientSequence: 1,
    command: {
      baseVersion: 0,
      clientMutationId: 'mutation-team-response',
      clientSequence: 1,
      entityId: `trp_${decisionId}:${accountUserId}`,
      kind: 'team.response.set',
      payload: { decisionId, eventId, optionId: 'tdo_fish' },
    },
    createdAt: '2026-07-19T08:00:00.000Z',
    deviceId: 'device-team-ui',
    lastError: null,
    nextAttemptAt: null,
    operationId: 'syncMutationsApply',
    optimisticOverlay: null,
    rootEventId,
    serverConsumed: false,
    state: 'pending',
    updatedAt: '2026-07-19T08:00:00.000Z',
  };
}
