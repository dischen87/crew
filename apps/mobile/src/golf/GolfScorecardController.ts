import type {
  GolfOfflineStore,
  GolfRankingEntry,
  GolfRoundReadModel,
  GolfScorecardHole,
  GolfScoreEnqueueResult,
  MobileSyncEngine,
  OutboxItem,
  SyncMutation,
  SyncStatus,
} from '@crew/mobile-data';
import {
  calculateStableford,
  strokesReceivedOnHole,
} from '@crew/shared/stableford';

export type GolfScorecardRole =
  | 'organizer'
  | 'owner'
  | 'participant'
  | 'viewer';

export type GolfDraft = {
  putts: number | null;
  strokes: number | null;
};

export type GolfDraftPreview = {
  error: string | null;
  netStrokes: number | null;
  stablefordPoints: number;
  valid: boolean;
};

export type GolfHoleDeliveryState =
  | 'attention'
  | 'conflict'
  | 'queued'
  | 'synced'
  | 'syncing'
  | 'untouched';

export type GolfHoleConflict = {
  clientMutationId: string;
  currentVersion: number;
  local: {
    putts: number | null;
    stablefordPoints: number;
    strokes: number | null;
  };
  server: {
    putts: number | null;
    stablefordPoints: number | null;
    strokes: number | null;
  };
};

export type GolfScorecardHoleModel = GolfScorecardHole & {
  conflict: GolfHoleConflict | null;
  deliveryState: GolfHoleDeliveryState;
};

export type GolfLeaderboardRow = {
  holesCompleted: number;
  isSelf: boolean;
  name: string;
  rank: number;
  stablefordPoints: number;
  teamName: string | null;
};

export type GolfScorecardViewModel = {
  access: 'edit' | 'read';
  eventTitle: string;
  holes: readonly GolfScorecardHoleModel[];
  leaderboard: readonly GolfLeaderboardRow[];
  role: GolfScorecardRole;
  roundVersion: number;
  syncStatus: SyncStatus;
};

type GolfReader = Pick<
  GolfOfflineStore,
  'getRound' | 'listRanking' | 'listScorecard'
>;

type GolfSync = Pick<
  MobileSyncEngine,
  'discardDeadLetter' | 'enqueueGolfScore' | 'getStatus' | 'listOutbox'
>;

type GolfScorecardControllerOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null;
  deviceId: string;
  eventId: string;
  resolvePerson(userId: string): Promise<string | null> | string | null;
  role: GolfScorecardRole;
  rootEventId: string;
  store: GolfReader;
  sync: GolfSync;
};

type GolfMutation = Extract<SyncMutation, { kind: 'golf.score.set' }>;
type GolfOutboxItem = OutboxItem & { command: GolfMutation };

export class GolfScorecardController {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: () => string | null;
  readonly #deviceId: string;
  readonly #eventId: string;
  readonly #resolvePerson: GolfScorecardControllerOptions['resolvePerson'];
  readonly #role: GolfScorecardRole;
  readonly #rootEventId: string;
  readonly #store: GolfReader;
  readonly #sync: GolfSync;

  constructor(options: GolfScorecardControllerOptions) {
    this.#accountUserId = options.accountUserId;
    this.#activeAccountUserId = options.activeAccountUserId;
    this.#deviceId = options.deviceId;
    this.#eventId = options.eventId;
    this.#resolvePerson = options.resolvePerson;
    this.#role = options.role;
    this.#rootEventId = options.rootEventId;
    this.#store = options.store;
    this.#sync = options.sync;
  }

  async load(eventTitle: string): Promise<GolfScorecardViewModel | null> {
    this.#assertActive();
    const round = await this.#store.getRound(
      this.#accountUserId,
      this.#eventId,
    );
    if (!round || round.rootEventId !== this.#rootEventId) return null;
    this.#assertActive();

    const canEdit =
      this.#role === 'participant' &&
      round.players.some(player => player.userId === this.#accountUserId);
    const [scorecard, ranking, outbox, syncStatus] = await Promise.all([
      canEdit
        ? this.#store.listScorecard(this.#accountUserId, this.#eventId)
        : Promise.resolve([] as readonly GolfScorecardHole[]),
      this.#store.listRanking(this.#accountUserId, this.#eventId),
      canEdit
        ? this.#sync.listOutbox(this.#accountUserId, this.#rootEventId)
        : Promise.resolve([] as readonly OutboxItem[]),
      this.#sync.getStatus(this.#accountUserId, this.#rootEventId),
    ]);
    this.#assertActive();

    if (
      canEdit &&
      (scorecard.length !== 18 ||
        scorecard.some((hole, index) => hole.hole !== index + 1))
    ) {
      return null;
    }

    const leaderboard = await this.#leaderboard(round, ranking);
    this.#assertActive();
    return {
      access: canEdit ? 'edit' : 'read',
      eventTitle: eventTitle.trim() || 'Golfrunde',
      holes: scorecard.map(hole =>
        holeModel(
          hole,
          latestGolfOutboxForHole(outbox, this.#eventId, hole.hole),
        ),
      ),
      leaderboard,
      role: this.#role,
      roundVersion: round.version,
      syncStatus,
    };
  }

  async saveScore(input: {
    baseVersion: number;
    clientIntentId: string;
    hole: number;
    putts: number | null;
    strokes: number | null;
  }): Promise<GolfScoreEnqueueResult> {
    this.#assertActive();
    const round = await this.#requiredEditableRound(input.hole);
    const hole = round.holes.find(candidate => candidate.hole === input.hole);
    if (!hole) throw new Error('Golf hole is unavailable');
    const player = round.players.find(
      candidate => candidate.userId === this.#accountUserId,
    );
    if (!player) throw new Error('Golf player is unavailable');
    const handicapStrokes = strokesReceivedOnHole(
      player.playingHandicap,
      hole.strokeIndex,
    );
    const preview = previewGolfDraft(
      { putts: input.putts, strokes: input.strokes },
      hole.par,
      handicapStrokes,
    );
    if (!preview.valid)
      throw new Error(preview.error ?? 'Golf score is invalid');
    this.#assertActive();
    return this.#sync.enqueueGolfScore(
      {
        accountUserId: this.#accountUserId,
        baseVersion: input.baseVersion,
        clientIntentId: input.clientIntentId,
        eventId: this.#eventId,
        hole: input.hole,
        putts: input.putts,
        rootEventId: this.#rootEventId,
        strokes: input.strokes,
      },
      this.#deviceId,
    );
  }

  async requeueConflict(input: {
    clientIntentId: string;
    clientMutationId: string;
    hole: number;
  }): Promise<GolfScoreEnqueueResult> {
    this.#assertActive();
    await this.#requiredEditableRound(input.hole);
    const outbox = await this.#sync.listOutbox(
      this.#accountUserId,
      this.#rootEventId,
    );
    const conflict = outbox.find(
      item =>
        item.clientMutationId === input.clientMutationId &&
        isGolfOutbox(item, this.#eventId) &&
        item.command.payload.hole === input.hole &&
        item.state === 'dead_letter' &&
        item.lastError?.code === 'conflict' &&
        item.serverConsumed,
    );
    if (!conflict || !isGolfOutbox(conflict, this.#eventId)) {
      throw new Error('Golf score conflict is unavailable');
    }
    const currentVersion = Math.max(
      conflict.lastError?.currentVersion ?? conflict.command.baseVersion,
      conflict.command.baseVersion,
    );
    const result = await this.saveScore({
      baseVersion: currentVersion,
      clientIntentId: input.clientIntentId,
      hole: input.hole,
      putts: conflict.command.payload.putts,
      strokes: conflict.command.payload.strokes,
    });
    this.#assertActive();
    await this.#sync.discardDeadLetter(
      this.#accountUserId,
      conflict.clientMutationId,
    );
    return result;
  }

  async #leaderboard(
    round: GolfRoundReadModel,
    entries: readonly GolfRankingEntry[],
  ): Promise<readonly GolfLeaderboardRow[]> {
    const teamNames = new Map(round.teams.map(team => [team.id, team.name]));
    return Promise.all(
      entries.map(async (entry, index) => {
        const isSelf = entry.userId === this.#accountUserId;
        const resolved = isSelf
          ? null
          : await this.#resolvePerson(entry.userId);
        return {
          holesCompleted: entry.holesCompleted,
          isSelf,
          name: isSelf ? 'Du' : resolved?.trim() || `Spieler:in ${index + 1}`,
          rank: entry.rank,
          stablefordPoints: entry.stablefordPoints,
          teamName: entry.teamId ? teamNames.get(entry.teamId) ?? null : null,
        };
      }),
    );
  }

  async #requiredEditableRound(hole: number) {
    if (this.#role !== 'participant') {
      throw new Error('This golf scorecard is read-only');
    }
    if (!Number.isSafeInteger(hole) || hole < 1 || hole > 18) {
      throw new Error('Golf hole is outside the supported range');
    }
    const round = await this.#store.getRound(
      this.#accountUserId,
      this.#eventId,
    );
    if (
      !round ||
      round.rootEventId !== this.#rootEventId ||
      !round.players.some(player => player.userId === this.#accountUserId)
    ) {
      throw new Error('This golf scorecard is read-only');
    }
    return round;
  }

  #assertActive() {
    if (this.#activeAccountUserId() !== this.#accountUserId) {
      throw new Error('Active account changed during golf route');
    }
  }
}

export function previewGolfDraft(
  draft: GolfDraft,
  par: number,
  handicapStrokes: number,
): GolfDraftPreview {
  if (draft.strokes === null && draft.putts === null) {
    return {
      error: null,
      netStrokes: null,
      stablefordPoints: 0,
      valid: true,
    };
  }
  if (
    !Number.isSafeInteger(draft.strokes) ||
    draft.strokes === null ||
    draft.strokes < 1 ||
    draft.strokes > 99
  ) {
    return {
      error: 'Schläge müssen zwischen 1 und 99 liegen.',
      netStrokes: null,
      stablefordPoints: 0,
      valid: false,
    };
  }
  if (
    draft.putts !== null &&
    (!Number.isSafeInteger(draft.putts) || draft.putts < 0 || draft.putts > 99)
  ) {
    return {
      error: 'Putts müssen zwischen 0 und 99 liegen.',
      netStrokes: null,
      stablefordPoints: 0,
      valid: false,
    };
  }
  return {
    error: null,
    netStrokes: draft.strokes - handicapStrokes,
    stablefordPoints: calculateStableford(draft.strokes, par, handicapStrokes),
    valid: true,
  };
}

function holeModel(
  hole: GolfScorecardHole,
  outbox: GolfOutboxItem | null,
): GolfScorecardHoleModel {
  const conflict =
    outbox?.state === 'dead_letter' && outbox.lastError?.code === 'conflict'
      ? {
          clientMutationId: outbox.clientMutationId,
          currentVersion: outbox.lastError.currentVersion ?? hole.version,
          local: {
            putts: outbox.command.payload.putts,
            stablefordPoints: hole.stablefordPoints,
            strokes: outbox.command.payload.strokes,
          },
          server: {
            putts: hole.authoritativePutts,
            stablefordPoints: hole.authoritativeStablefordPoints,
            strokes: hole.authoritativeStrokes,
          },
        }
      : null;
  return {
    ...hole,
    conflict,
    deliveryState: conflict ? 'conflict' : deliveryState(hole, outbox),
  };
}

function deliveryState(
  hole: GolfScorecardHole,
  outbox: GolfOutboxItem | null,
): GolfHoleDeliveryState {
  if (outbox?.state === 'dead_letter') return 'attention';
  if (outbox?.state === 'sending' || outbox?.state === 'awaiting_pull') {
    return 'syncing';
  }
  if (outbox || hole.isPending) return 'queued';
  return hole.strokes === null ? 'untouched' : 'synced';
}

function latestGolfOutboxForHole(
  outbox: readonly OutboxItem[],
  eventId: string,
  hole: number,
): GolfOutboxItem | null {
  let latest: GolfOutboxItem | null = null;
  for (const item of outbox) {
    if (!isGolfOutbox(item, eventId) || item.command.payload.hole !== hole) {
      continue;
    }
    if (!latest || item.clientSequence > latest.clientSequence) latest = item;
  }
  return latest;
}

function isGolfOutbox(
  item: OutboxItem,
  eventId: string,
): item is GolfOutboxItem {
  return (
    'kind' in item.command &&
    item.command.kind === 'golf.score.set' &&
    item.command.payload.eventId === eventId
  );
}
