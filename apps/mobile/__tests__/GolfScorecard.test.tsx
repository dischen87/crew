import type {
  GolfOfflineStore,
  GolfScoreEnqueueResult,
  MobileSyncEngine,
  OutboxItem,
  SyncStatus,
} from '@crew/mobile-data';
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import { Button } from '../src/design/primitives';
import {
  GolfScorecardController,
  previewGolfDraft,
  type GolfScorecardRole,
  type GolfScorecardViewModel,
} from '../src/golf/GolfScorecardController';
import {
  GolfScorecardView,
  type GolfScorecardDraftViewModel,
} from '../src/screens/GolfScorecardView';

const accountUserId = `usr_${'1'.repeat(32)}`;
const otherUserId = `usr_${'2'.repeat(32)}`;
const rootEventId = 'evt_golf-tour';
const eventId = 'evt_carya-round';
const deviceId = 'dvc_00000000-0000-4000-8000-000000000001';
const metrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 47 },
};

async function render(
  model: GolfScorecardViewModel,
  draft: GolfScorecardDraftViewModel = draftModel(),
) {
  const callbacks = {
    onBack: jest.fn(),
    onChangePutts: jest.fn(),
    onChangeStrokes: jest.fn(),
    onClear: jest.fn(),
    onResolveConflict: jest.fn(),
    onRetry: jest.fn(),
    onSave: jest.fn(),
    onSelectHole: jest.fn(),
    onSync: jest.fn(),
  };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={metrics}>
        <GolfScorecardView
          draft={draft}
          model={{ ...model, phase: 'ready' }}
          selectedHole={18}
          {...callbacks}
        />
      </SafeAreaProvider>,
    );
  });
  return { callbacks, renderer: renderer! };
}

test('participant controller projects exactly 18 holes, local Stableford, one outbox seam, and caller-stable replay identity', async () => {
  const { controller, store, sync } = controllerFixture('participant');
  const model = await controller.load('Carya Golf Club');
  expect(model).toMatchObject({
    access: 'edit',
    eventTitle: 'Carya Golf Club',
  });
  expect(model?.holes).toHaveLength(18);
  expect(model?.holes.map(hole => hole.hole)).toEqual(
    Array.from({ length: 18 }, (_, index) => index + 1),
  );
  expect(previewGolfDraft({ putts: 1, strokes: 4 }, 4, 1)).toEqual({
    error: null,
    netStrokes: 3,
    stablefordPoints: 3,
    valid: true,
  });

  const command = {
    baseVersion: 0,
    clientIntentId: 'gsi_caller_stable_hole_18',
    hole: 18,
    putts: 1,
    strokes: 4,
  };
  await controller.saveScore(command);
  await controller.saveScore(command);
  expect(sync.enqueueGolfScore).toHaveBeenCalledTimes(2);
  expect(sync.enqueueGolfScore).toHaveBeenNthCalledWith(
    1,
    {
      accountUserId,
      baseVersion: 0,
      clientIntentId: 'gsi_caller_stable_hole_18',
      eventId,
      hole: 18,
      putts: 1,
      rootEventId,
      strokes: 4,
    },
    deviceId,
  );
  expect(store.getRound).toHaveBeenCalled();
  expect('enqueueScore' in store).toBe(false);
});

test('restart reads queued state from the existing scorecard and outbox without inventing a second model', async () => {
  const pending = golfOutbox({ state: 'pending' });
  const { controller } = controllerFixture('participant', {
    outbox: [pending],
    scorecard: scorecard({ pending: true, strokes: 4 }),
    status: syncStatus('pending', 1),
  });
  const firstProcess = await controller.load('Carya Golf Club');
  const restarted = controllerFixture('participant', {
    outbox: [pending],
    scorecard: scorecard({ pending: true, strokes: 4 }),
    status: syncStatus('pending', 1),
  });
  const secondProcess = await restarted.controller.load('Carya Golf Club');
  expect(firstProcess?.holes[17]).toMatchObject({
    deliveryState: 'queued',
    isPending: true,
    strokes: 4,
  });
  expect(secondProcess?.holes[17]).toEqual(firstProcess?.holes[17]);
});

test('participant controller fails closed when the local 18-hole scorecard is incomplete', async () => {
  const incomplete = controllerFixture('participant', { scorecard: [] });
  expect(await incomplete.controller.load('Carya Golf Club')).toBeNull();
});

test('server-consumed conflict keeps both versions, then enqueues a fresh mutation before removing only the old dead letter', async () => {
  const oldMutationId = '11111111-1111-4111-8111-111111111111';
  const replacementMutationId = '22222222-2222-4222-8222-222222222222';
  const conflict = golfOutbox({
    clientMutationId: oldMutationId,
    currentVersion: 2,
    serverConsumed: true,
    state: 'dead_letter',
  });
  const order: string[] = [];
  const fixture = controllerFixture('participant', {
    outbox: [conflict],
    scorecard: scorecard({
      authoritativeStablefordPoints: 3,
      authoritativeStrokes: 4,
      pending: true,
      strokes: 5,
      version: 2,
    }),
    status: syncStatus('needs_attention', 0, 1),
  });
  fixture.sync.enqueueGolfScore.mockImplementation(async input => {
    order.push('enqueue');
    return enqueueResult(input.clientIntentId, replacementMutationId);
  });
  fixture.sync.discardDeadLetter.mockImplementation(async () => {
    order.push('discard');
  });
  const model = await fixture.controller.load('Carya Golf Club');
  expect(model?.holes[17].conflict).toEqual({
    clientMutationId: oldMutationId,
    currentVersion: 2,
    local: { putts: 1, stablefordPoints: 2, strokes: 5 },
    server: { putts: 1, stablefordPoints: 3, strokes: 4 },
  });

  const result = await fixture.controller.requeueConflict({
    clientIntentId: 'gsi_fresh_conflict_requeue',
    clientMutationId: oldMutationId,
    hole: 18,
  });
  expect(result.outbox?.clientMutationId).toBe(replacementMutationId);
  expect(result.outbox?.clientMutationId).not.toBe(oldMutationId);
  expect(order).toEqual(['enqueue', 'discard']);
  expect(fixture.sync.enqueueGolfScore).toHaveBeenCalledWith(
    expect.objectContaining({
      baseVersion: 2,
      clientIntentId: 'gsi_fresh_conflict_requeue',
      putts: 1,
      strokes: 5,
    }),
    deviceId,
  );
});

test('failed conflict replacement leaves the authoritative dead letter intact', async () => {
  const conflict = golfOutbox({
    serverConsumed: true,
    state: 'dead_letter',
  });
  const fixture = controllerFixture('participant', { outbox: [conflict] });
  fixture.sync.enqueueGolfScore.mockRejectedValue(
    new Error('disk unavailable'),
  );
  await expect(
    fixture.controller.requeueConflict({
      clientIntentId: 'gsi_failed_requeue',
      clientMutationId: conflict.clientMutationId,
      hole: 18,
    }),
  ).rejects.toThrow('disk unavailable');
  expect(fixture.sync.discardDeadLetter).not.toHaveBeenCalled();

  const unconsumed = controllerFixture('participant', {
    outbox: [{ ...conflict, serverConsumed: false }],
  });
  await expect(
    unconsumed.controller.requeueConflict({
      clientIntentId: 'gsi_unconsumed_requeue',
      clientMutationId: conflict.clientMutationId,
      hole: 18,
    }),
  ).rejects.toThrow('conflict is unavailable');
  expect(unconsumed.sync.enqueueGolfScore).not.toHaveBeenCalled();
});

test('account switch after conflict enqueue retains the old dead letter for safe recovery', async () => {
  let active: string | null = accountUserId;
  const conflict = golfOutbox({ serverConsumed: true, state: 'dead_letter' });
  const fixture = controllerFixture('participant', {
    active: () => active,
    outbox: [conflict],
  });
  fixture.sync.enqueueGolfScore.mockImplementation(async input => {
    active = otherUserId;
    return enqueueResult(input.clientIntentId);
  });
  await expect(
    fixture.controller.requeueConflict({
      clientIntentId: 'gsi_switch_after_enqueue',
      clientMutationId: conflict.clientMutationId,
      hole: 18,
    }),
  ).rejects.toThrow('Active account changed');
  expect(fixture.sync.discardDeadLetter).not.toHaveBeenCalled();
});

test.each(['owner', 'organizer', 'viewer'] as const)(
  '%s receives the real leaderboard and no score-write model',
  async role => {
    const { controller, store, sync } = controllerFixture(role);
    const model = await controller.load('Carya Golf Club');
    expect(model).toMatchObject({ access: 'read', role });
    expect(model?.leaderboard).toEqual([
      {
        holesCompleted: 18,
        isSelf: true,
        name: 'Du',
        rank: 1,
        stablefordPoints: 38,
        teamName: 'Mint',
      },
      {
        holesCompleted: 17,
        isSelf: false,
        name: 'Marco',
        rank: 2,
        stablefordPoints: 35,
        teamName: null,
      },
    ]);
    expect(store.listScorecard).not.toHaveBeenCalled();
    await expect(
      controller.saveScore({
        baseVersion: 0,
        clientIntentId: `gsi_${role}_forbidden`,
        hole: 18,
        putts: 1,
        strokes: 4,
      }),
    ).rejects.toThrow('read-only');
    expect(sync.enqueueGolfScore).not.toHaveBeenCalled();
  },
);

test('non-player participant is read-only and an account switch prevents every outbox write', async () => {
  const nonPlayer = controllerFixture('participant', { eligible: false });
  expect(await nonPlayer.controller.load('Carya Golf Club')).toMatchObject({
    access: 'read',
  });
  await expect(
    nonPlayer.controller.saveScore({
      baseVersion: 0,
      clientIntentId: 'gsi_non_player',
      hole: 18,
      putts: 1,
      strokes: 4,
    }),
  ).rejects.toThrow('read-only');

  let active: string | null = accountUserId;
  const switched = controllerFixture('participant', { active: () => active });
  active = otherUserId;
  await expect(
    switched.controller.saveScore({
      baseVersion: 0,
      clientIntentId: 'gsi_account_switch',
      hole: 18,
      putts: 1,
      strokes: 4,
    }),
  ).rejects.toThrow('Active account changed');
  expect(switched.sync.enqueueGolfScore).not.toHaveBeenCalled();
});

test('pure participant view exposes all 18 accessible holes, bounded 48-point inputs, local preview, and queued state', async () => {
  const base = viewModel('participant', 'edit');
  const holes = [...base.holes];
  holes[17] = {
    ...holes[17],
    deliveryState: 'queued',
    isPending: true,
    strokes: 4,
  };
  const model = { ...base, holes };
  const { callbacks, renderer } = await render(model, {
    dirty: false,
    preview: previewGolfDraft({ putts: 1, strokes: 4 }, 4, 1),
    putts: '1',
    saving: false,
    strokes: '4',
  });
  expect(
    Array.from({ length: 18 }, (_, index) =>
      renderer.root.findByProps({ testID: `golf-hole-${index + 1}` }),
    ),
  ).toHaveLength(18);
  const selected = renderer.root.findByProps({ testID: 'golf-hole-18' });
  expect(selected.props.accessibilityLabel).toContain('lokal gespeichert');
  expect(
    StyleSheet.flatten(selected.props.style({ pressed: false })),
  ).toMatchObject({
    minHeight: 48,
    minWidth: 48,
  });
  const inputs = renderer.root.findAllByType(TextInput);
  expect(inputs).toHaveLength(2);
  expect(inputs.map(input => input.props.maxLength)).toEqual([3, 3]);
  expect(
    inputs.map(input => StyleSheet.flatten(input.props.style).minHeight),
  ).toEqual([60, 60]);
  expect(
    renderer.root.findByProps({ accessibilityLabel: 'LOKAL GESPEICHERT' }),
  ).toBeTruthy();
  expect(text(renderer)).toContain('3 Punkte');
  await ReactTestRenderer.act(() => selected.props.onPress());
  expect(callbacks.onSelectHole).toHaveBeenCalledWith(18);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('invalid and conflict pure states are explicit, while read-only state contains no disabled write controls', async () => {
  const invalid = await render(viewModel('participant', 'edit'), {
    dirty: true,
    preview: previewGolfDraft({ putts: 1, strokes: 100 }, 4, 1),
    putts: '1',
    saving: false,
    strokes: '100',
  });
  expect(
    invalid.renderer.root.findByProps({ accessibilityLabel: 'EINGABE PRÜFEN' }),
  ).toBeTruthy();
  expect(
    invalid.renderer.root.findByProps({ testID: 'golf-save-action' }).props
      .disabled,
  ).toBe(true);
  await ReactTestRenderer.act(() => invalid.renderer.unmount());

  const conflictBase = viewModel('participant', 'edit');
  const conflictHoles = [...conflictBase.holes];
  conflictHoles[17] = {
    ...conflictHoles[17],
    conflict: {
      clientMutationId: 'old-conflict',
      currentVersion: 2,
      local: { putts: 1, stablefordPoints: 2, strokes: 5 },
      server: { putts: 1, stablefordPoints: 3, strokes: 4 },
    },
    deliveryState: 'conflict',
  };
  const conflictModel = { ...conflictBase, holes: conflictHoles };
  const conflict = await render(conflictModel);
  expect(text(conflict.renderer)).toContain('DEIN STAND 5 Schläge');
  expect(text(conflict.renderer)).toContain('SERVER-STAND 4 Schläge');
  expect(
    conflict.renderer.root.findByProps({ testID: 'golf-resolve-conflict' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => conflict.renderer.unmount());

  const readOnly = await render(viewModel('viewer', 'read'));
  expect(text(readOnly.renderer)).toContain('Live mitfiebern');
  expect(text(readOnly.renderer)).toContain('Marco');
  expect(
    readOnly.renderer.root.findAllByProps({ testID: 'golf-save-action' }),
  ).toHaveLength(0);
  expect(readOnly.renderer.root.findAllByType(TextInput)).toHaveLength(0);
  expect(
    readOnly.renderer.root
      .findAllByType(Button)
      .some(button => button.props.disabled),
  ).toBe(false);
  await ReactTestRenderer.act(() => readOnly.renderer.unmount());
});

test('an impossible editable model without holes never masquerades as read-only', async () => {
  const model = { ...viewModel('participant', 'edit'), holes: [] };
  const { callbacks, renderer } = await render(model);
  expect(text(renderer)).toContain('Scorekarte noch nicht verfügbar');
  expect(text(renderer)).not.toContain('Live mitfiebern');
  const retry = renderer.root.findByProps({ testID: 'golf-scorecard-retry' });
  await ReactTestRenderer.act(() => retry.props.onPress());
  expect(callbacks.onSync).toHaveBeenCalledTimes(1);
  expect(
    renderer.root.findAllByProps({ testID: 'golf-save-action' }),
  ).toHaveLength(0);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('saving locks score inputs and hole navigation until the queued snapshot reloads', async () => {
  const { renderer } = await render(viewModel('participant', 'edit'), {
    dirty: true,
    preview: previewGolfDraft({ putts: 1, strokes: 4 }, 4, 1),
    putts: '1',
    saving: true,
    strokes: '4',
  });
  for (const input of renderer.root.findAllByType(TextInput)) {
    expect(input.props.editable).toBe(false);
    expect(input.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  }
  const hole = renderer.root.findByProps({ testID: 'golf-hole-1' });
  expect(hole.props.disabled).toBe(true);
  expect(hole.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  expect(
    renderer.root.findByProps({ testID: 'golf-save-action' }).props.loading,
  ).toBe(true);
  const sync = renderer.root.findByProps({ testID: 'golf-sync-action' });
  expect(sync.props.loading).toBe(true);
  expect(sync.props.disabled).toBe(true);
  await ReactTestRenderer.act(() => renderer.unmount());
});

test('pure score state labels distinguish untouched, partial, and synced without color alone', async () => {
  const untouched = await render(viewModel('participant', 'edit'));
  expect(
    untouched.renderer.root.findByProps({ accessibilityLabel: 'NOCH OFFEN' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => untouched.renderer.unmount());

  const partial = await render(viewModel('participant', 'edit'), {
    dirty: true,
    preview: previewGolfDraft({ putts: null, strokes: 4 }, 4, 1),
    putts: '',
    saving: false,
    strokes: '4',
  });
  expect(
    partial.renderer.root.findByProps({ accessibilityLabel: 'ENTWURF' }),
  ).toBeTruthy();
  expect(
    partial.renderer.root.findByProps({ testID: 'golf-save-action' }).props
      .disabled,
  ).toBe(false);
  await ReactTestRenderer.act(() => partial.renderer.unmount());

  const syncedBase = viewModel('participant', 'edit');
  const syncedHoles = [...syncedBase.holes];
  syncedHoles[17] = {
    ...syncedHoles[17],
    deliveryState: 'synced',
    stablefordPoints: 3,
    strokes: 4,
  };
  const synced = await render(
    { ...syncedBase, holes: syncedHoles },
    {
      dirty: false,
      preview: previewGolfDraft({ putts: null, strokes: 4 }, 4, 1),
      putts: '',
      saving: false,
      strokes: '4',
    },
  );
  expect(
    synced.renderer.root.findByProps({ accessibilityLabel: 'SYNCHRON' }),
  ).toBeTruthy();
  await ReactTestRenderer.act(() => synced.renderer.unmount());
});

test('390x844 surface remains vertically scrollable for near-200-percent text', async () => {
  const { renderer } = await render(viewModel('participant', 'edit'));
  const vertical = renderer.root
    .findAllByType(ScrollView)
    .find(node => node.props.horizontal !== true);
  if (!vertical) throw new Error('Vertical scorecard scroll is missing');
  expect(StyleSheet.flatten(vertical.props.style)).toMatchObject({
    flex: 1,
    marginTop: 47,
  });
  expect(
    StyleSheet.flatten(vertical.props.contentContainerStyle),
  ).toMatchObject({
    flexGrow: 1,
    paddingBottom: 34,
    paddingTop: 0,
  });
  expect(
    renderer.root.findByProps({ accessibilityRole: 'header' }).props
      .accessibilityLabel,
  ).toBe('Scorekarte');
  expect(
    renderer.root.findByProps({ testID: 'golf-save-action' }).props
      .accessibilityHint,
  ).toContain('sicher auf dem Gerät');
  await ReactTestRenderer.act(() => renderer.unmount());
});

function controllerFixture(
  role: GolfScorecardRole,
  overrides: {
    active?: () => string | null;
    eligible?: boolean;
    outbox?: readonly OutboxItem[];
    scorecard?: ReturnType<typeof scorecard>;
    status?: SyncStatus;
  } = {},
) {
  const store = {
    getRound: jest.fn(async () => round(overrides.eligible ?? true)),
    listRanking: jest.fn(async () => ranking()),
    listScorecard: jest.fn(async () => overrides.scorecard ?? scorecard()),
  } satisfies Pick<
    GolfOfflineStore,
    'getRound' | 'listRanking' | 'listScorecard'
  >;
  const sync = {
    discardDeadLetter: jest.fn(async () => undefined),
    enqueueGolfScore: jest.fn(async input =>
      enqueueResult(input.clientIntentId),
    ),
    getStatus: jest.fn(async () => overrides.status ?? syncStatus('synced')),
    listOutbox: jest.fn(async () => overrides.outbox ?? []),
  } satisfies Pick<
    MobileSyncEngine,
    'discardDeadLetter' | 'enqueueGolfScore' | 'getStatus' | 'listOutbox'
  >;
  return {
    controller: new GolfScorecardController({
      accountUserId,
      activeAccountUserId: overrides.active ?? (() => accountUserId),
      deviceId,
      eventId,
      resolvePerson: id => (id === otherUserId ? 'Marco' : null),
      role,
      rootEventId,
      store,
      sync,
    }),
    store,
    sync,
  };
}

function round(eligible = true) {
  return {
    accountUserId,
    eventId,
    holes: Array.from({ length: 18 }, (_, index) => ({
      hole: index + 1,
      par: index === 17 ? 4 : 3 + (index % 3),
      strokeIndex: index + 1,
    })),
    players: eligible
      ? [
          {
            eventId,
            playingHandicap: 18,
            rootEventId,
            userId: accountUserId,
            version: 1,
          },
        ]
      : [],
    rootEventId,
    teams: [
      {
        color: '#C2E8D5',
        id: 'gtm_mint',
        memberUserIds: [accountUserId],
        name: 'Mint',
      },
    ],
    updatedAt: '2026-09-24T18:00:00.000Z',
    version: 1,
  };
}

function scorecard(
  last: {
    authoritativeStablefordPoints?: number | null;
    authoritativeStrokes?: number | null;
    pending?: boolean;
    strokes?: number | null;
    version?: number;
  } = {},
) {
  return Array.from({ length: 18 }, (_, index) => ({
    authoritativePutts: index === 17 ? 1 : null,
    authoritativeStablefordPoints:
      index === 17 ? last.authoritativeStablefordPoints ?? null : null,
    authoritativeStrokes:
      index === 17 ? last.authoritativeStrokes ?? null : null,
    handicapStrokes: 1,
    hole: index + 1,
    isPending: index === 17 && Boolean(last.pending),
    netStrokes:
      index === 17 && last.strokes !== undefined && last.strokes !== null
        ? last.strokes - 1
        : null,
    par: index === 17 ? 4 : 3 + (index % 3),
    putts: index === 17 && last.strokes !== undefined ? 1 : null,
    stablefordPoints: index === 17 && last.strokes === 5 ? 2 : 0,
    strokeIndex: index + 1,
    strokes: index === 17 ? last.strokes ?? null : null,
    version: index === 17 ? last.version ?? 0 : 0,
  }));
}

function ranking() {
  return [
    {
      holesCompleted: 18,
      rank: 1,
      stablefordPoints: 38,
      teamId: 'gtm_mint',
      userId: accountUserId,
    },
    {
      holesCompleted: 17,
      rank: 2,
      stablefordPoints: 35,
      teamId: null,
      userId: otherUserId,
    },
  ];
}

function golfOutbox(input: {
  clientMutationId?: string;
  currentVersion?: number | null;
  serverConsumed?: boolean;
  state: OutboxItem['state'];
}) {
  return {
    accountUserId,
    appliedRootRevision: null,
    attempts: 0,
    clientMutationId:
      input.clientMutationId ?? '11111111-1111-4111-8111-111111111111',
    clientSequence: 1,
    command: {
      baseVersion: 1,
      clientMutationId:
        input.clientMutationId ?? '11111111-1111-4111-8111-111111111111',
      clientSequence: 1,
      entityId: `gsc_${eventId}:${accountUserId}:18`,
      kind: 'golf.score.set',
      payload: { eventId, hole: 18, putts: 1, strokes: 5 },
    },
    createdAt: '2026-09-24T18:00:00.000Z',
    deviceId,
    lastError:
      input.state === 'dead_letter'
        ? {
            authoritativeOrder: null,
            code: 'conflict',
            currentVersion: input.currentVersion ?? 2,
            requestId: 'request-golf-conflict',
          }
        : null,
    nextAttemptAt: null,
    operationId: 'syncMutationsApply',
    optimisticOverlay: { kind: 'golfScoreIntent' },
    rootEventId,
    serverConsumed: input.serverConsumed ?? false,
    state: input.state,
    updatedAt: '2026-09-24T18:00:00.000Z',
  } as OutboxItem;
}

function enqueueResult(
  clientIntentId: string,
  clientMutationId = '33333333-3333-4333-8333-333333333333',
): GolfScoreEnqueueResult {
  return {
    intent: {
      accountUserId,
      appliedEntityVersion: null,
      baseVersion: 0,
      clientIntentId,
      clientSequence: 1,
      createdAt: '2026-09-24T18:00:00.000Z',
      eventId,
      handicapStrokes: 1,
      hole: 18,
      netStrokes: 3,
      outboxClientMutationId: clientMutationId,
      playingHandicap: 18,
      putts: 1,
      rootEventId,
      scoreId: `gsc_${eventId}:${accountUserId}:18`,
      stablefordPoints: 3,
      state: 'pending',
      strokes: 4,
      updatedAt: '2026-09-24T18:00:00.000Z',
    },
    outbox: {
      ...golfOutbox({ clientMutationId, state: 'pending' }),
      clientMutationId,
    },
  };
}

function syncStatus(
  state: SyncStatus['state'],
  pendingCount = 0,
  attentionCount = 0,
): SyncStatus {
  return {
    attentionCount,
    nextAttemptAt: null,
    pendingCount,
    state,
    summary: state,
  };
}

function viewModel(
  role: GolfScorecardRole,
  access: 'edit' | 'read',
): GolfScorecardViewModel {
  return {
    access,
    eventTitle: 'Carya Golf Club',
    holes: scorecard().map(hole => ({
      ...hole,
      conflict: null,
      deliveryState: 'untouched',
    })),
    leaderboard: [
      {
        holesCompleted: 18,
        isSelf: true,
        name: 'Du',
        rank: 1,
        stablefordPoints: 38,
        teamName: 'Mint',
      },
      {
        holesCompleted: 17,
        isSelf: false,
        name: 'Marco',
        rank: 2,
        stablefordPoints: 35,
        teamName: null,
      },
    ],
    role,
    roundVersion: 1,
    syncStatus: syncStatus('synced'),
  };
}

function draftModel(): GolfScorecardDraftViewModel {
  return {
    dirty: false,
    preview: previewGolfDraft({ putts: null, strokes: null }, 4, 1),
    putts: '',
    saving: false,
    strokes: '',
  };
}

function text(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat(Infinity)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
