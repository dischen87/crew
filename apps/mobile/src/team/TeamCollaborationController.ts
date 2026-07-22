import type {
  MobileSyncEngine,
  OutboxItem,
  TeamDecisionReadModel,
  TeamOfflineStore,
} from '@crew/mobile-data';
import type { ImageSourcePropType } from 'react-native';

export type TeamRole = 'owner' | 'organizer' | 'participant' | 'viewer';
export type TeamDeliveryState =
  | 'needs_attention'
  | 'pending'
  | 'synced'
  | 'unpublished';

export type TeamPerson = {
  avatar?: ImageSourcePropType;
  id: string;
  name: string;
};

export type TeamAssignmentPublicTeam = {
  color: string | null;
  id: string;
  name: string;
};

export type TeamAssignmentManagerTeam = TeamAssignmentPublicTeam & {
  capacity: number | null;
  members: readonly TeamPerson[];
};

type TeamAssignmentsBaseModel = {
  deliveryLabel: string;
  deliveryState: TeamDeliveryState;
  eventId: string;
  eventTitle: string;
  rootEventId: string;
  role: TeamRole;
  version: number;
};

export type TeamAssignmentsViewModel =
  | (TeamAssignmentsBaseModel & {
      access: 'manage';
      hasLocalChanges: boolean;
      role: 'organizer' | 'owner';
      teams: readonly TeamAssignmentManagerTeam[];
    })
  | (TeamAssignmentsBaseModel & {
      access: 'read';
      ownTeam: TeamAssignmentPublicTeam | null;
      teams: readonly TeamAssignmentPublicTeam[];
    });

export type TeamDecisionViewModel = {
  authoritativeOptionId: string | null;
  canRespond: boolean;
  createdAt: string;
  decisionId: string;
  deliveryLabel: string;
  deliveryState: TeamDeliveryState;
  eventId: string;
  eventTitle: string;
  lifecycle: TeamDecisionReadModel['state'];
  options: TeamDecisionReadModel['options'];
  responseCount: number;
  responseMutationId: string | null;
  role: TeamRole;
  rootEventId: string;
  selectedOptionId: string | null;
  title: string;
  version: number;
};

type TeamReader = Pick<TeamOfflineStore, 'getAssignments' | 'getDecision'>;
type TeamWriter = Pick<
  MobileSyncEngine,
  'enqueueTeamAssignments' | 'enqueueTeamDecision' | 'enqueueTeamResponse'
>;

type TeamCollaborationControllerOptions = {
  accountUserId: string;
  deviceId: string | (() => Promise<string>);
  resolvePerson(userId: string): Promise<TeamPerson | null> | TeamPerson | null;
  role: TeamRole | (() => TeamRole);
  store: TeamReader;
  sync: TeamWriter;
};

export class TeamCollaborationController {
  readonly #accountUserId: string;
  readonly #deviceId: () => Promise<string>;
  readonly #resolvePerson: TeamCollaborationControllerOptions['resolvePerson'];
  readonly #role: () => TeamRole;
  readonly #store: TeamReader;
  readonly #sync: TeamWriter;
  readonly #responseInFlight = new Map<string, Promise<OutboxItem | null>>();

  constructor(options: TeamCollaborationControllerOptions) {
    this.#accountUserId = options.accountUserId;
    const deviceId = options.deviceId;
    this.#deviceId =
      typeof deviceId === 'string' ? async () => deviceId : deviceId;
    this.#resolvePerson = options.resolvePerson;
    const role = options.role;
    this.#role = typeof role === 'function' ? role : () => role;
    this.#store = options.store;
    this.#sync = options.sync;
  }

  async loadAssignments(input: {
    capacityPerTeam: number | null;
    deliveryState: TeamDeliveryState;
    eventId: string;
    eventTitle: string;
    hasLocalChanges?: boolean;
    rootEventId: string;
  }): Promise<TeamAssignmentsViewModel | null> {
    const assignment = await this.#store.getAssignments(
      this.#accountUserId,
      input.rootEventId,
      input.eventId,
    );
    if (!assignment) return null;

    const role = this.#role();
    const base = {
      deliveryLabel: assignmentDeliveryLabel(input.deliveryState),
      deliveryState: input.deliveryState,
      eventId: assignment.eventId,
      eventTitle: input.eventTitle,
      rootEventId: assignment.rootEventId,
      role,
      version: assignment.version,
    };
    if (manager(role) && assignment.canManage && assignment.roster) {
      const people = new Map<string, TeamPerson>();
      const userIds = [
        ...new Set(assignment.roster.flatMap(team => [...team.memberUserIds])),
      ].sort(compareText);
      await Promise.all(
        userIds.map(async (userId, index) => {
          const resolved = await this.#resolvePerson(userId);
          const name = resolved?.name.trim();
          people.set(
            userId,
            resolved?.id === userId && name
              ? { ...resolved, id: userId, name }
              : {
                  id: userId,
                  name: `Teilnehmende Person ${index + 1}`,
                },
          );
        }),
      );
      const currentRole = this.#role();
      if (!manager(currentRole)) {
        return {
          ...base,
          access: 'read',
          ownTeam:
            currentRole === 'viewer' || assignment.ownTeam === null
              ? null
              : publicTeam(assignment.ownTeam),
          role: currentRole,
          teams: assignment.teams.map(publicTeam),
        };
      }
      return {
        ...base,
        access: 'manage',
        hasLocalChanges: input.hasLocalChanges ?? false,
        role: currentRole,
        teams: assignment.roster.map(team => ({
          ...publicTeam(team),
          capacity: input.capacityPerTeam,
          members: team.memberUserIds.map(userId => required(people, userId)),
        })),
      };
    }
    return {
      ...base,
      access: 'read',
      ownTeam:
        role === 'viewer' || assignment.ownTeam === null
          ? null
          : publicTeam(assignment.ownTeam),
      teams: assignment.teams.map(publicTeam),
    };
  }

  async loadDecision(input: {
    decisionId: string;
    eventTitle: string;
    rootEventId: string;
  }): Promise<TeamDecisionViewModel | null> {
    const decision = await this.#store.getDecision(
      this.#accountUserId,
      input.rootEventId,
      input.decisionId,
    );
    if (!decision) return null;
    const delivery = decisionDelivery(decision);
    const role = this.#role();
    return {
      authoritativeOptionId: decision.authoritativeOptionId,
      canRespond:
        role !== 'viewer' &&
        decision.canRespond &&
        decision.authoritativeOptionId === null &&
        decision.responseMutationId === null,
      createdAt: decision.createdAt,
      decisionId: decision.id,
      deliveryLabel: delivery.label,
      deliveryState: delivery.state,
      eventId: decision.eventId,
      eventTitle: input.eventTitle,
      lifecycle: decision.state,
      options: decision.options,
      responseCount: decision.responseCount,
      responseMutationId: decision.responseMutationId,
      role,
      rootEventId: decision.rootEventId,
      selectedOptionId: decision.selectedOptionId,
      title: decision.title,
      version: decision.version,
    };
  }

  async publishAssignments(
    input: {
      eventId: string;
      rootEventId: string;
      teams: readonly {
        color: string | null;
        id: string;
        memberUserIds: readonly string[];
        name: string;
      }[];
    },
    assertBeforeWrite?: () => void,
  ): Promise<OutboxItem> {
    this.#assertManager();
    const current = await this.#requiredAssignments(
      input.rootEventId,
      input.eventId,
    );
    const deviceId = await this.#deviceId();
    assertBeforeWrite?.();
    this.#assertManager();
    return this.#sync.enqueueTeamAssignments(
      this.#accountUserId,
      input.rootEventId,
      deviceId,
      {
        baseVersion: current.version,
        eventId: input.eventId,
        teams: input.teams.map(team => ({
          ...team,
          memberUserIds: [...team.memberUserIds],
        })),
      },
    );
  }

  async replaceDecision(
    input: {
      decisionId: string;
      eventId: string;
      options: readonly { id: string; label: string }[];
      rootEventId: string;
      state: TeamDecisionReadModel['state'];
      title: string;
    },
    assertBeforeWrite?: () => void,
  ): Promise<OutboxItem> {
    this.#assertManager();
    const current = await this.#store.getDecision(
      this.#accountUserId,
      input.rootEventId,
      input.decisionId,
    );
    const deviceId = await this.#deviceId();
    assertBeforeWrite?.();
    this.#assertManager();
    return this.#sync.enqueueTeamDecision(
      this.#accountUserId,
      input.rootEventId,
      deviceId,
      {
        baseVersion: current?.version ?? 0,
        decisionId: input.decisionId,
        eventId: input.eventId,
        options: [...input.options],
        state: input.state,
        title: input.title,
      },
    );
  }

  submitResponse(
    input: {
      decisionId: string;
      optionId: string;
      rootEventId: string;
    },
    assertBeforeWrite?: () => void,
  ): Promise<OutboxItem | null> {
    if (this.#role() === 'viewer') {
      return Promise.reject(new Error('Viewers cannot answer team decisions'));
    }
    const key = `${input.rootEventId}:${input.decisionId}`;
    const existing = this.#responseInFlight.get(key);
    if (existing) return existing;

    const pending = this.#submitResponse(input, assertBeforeWrite).finally(
      () => {
        if (this.#responseInFlight.get(key) === pending) {
          this.#responseInFlight.delete(key);
        }
      },
    );
    this.#responseInFlight.set(key, pending);
    return pending;
  }

  async #submitResponse(
    input: {
      decisionId: string;
      optionId: string;
      rootEventId: string;
    },
    assertBeforeWrite?: () => void,
  ): Promise<OutboxItem | null> {
    const current = await this.#store.getDecision(
      this.#accountUserId,
      input.rootEventId,
      input.decisionId,
    );
    if (!current) throw new Error('Team decision is unavailable');
    if (current.state !== 'open' || !current.canRespond) {
      throw new Error('Team decision is not open for responses');
    }
    if (!current.options.some(option => option.id === input.optionId)) {
      throw new Error('Team decision option is unavailable');
    }
    if (current.authoritativeOptionId !== null) {
      if (current.authoritativeOptionId === input.optionId) return null;
      throw new Error('Team decision already has a response');
    }
    if (current.responseMutationId !== null) {
      if (current.selectedOptionId === input.optionId) return null;
      throw new Error('Team response is already queued');
    }
    const deviceId = await this.#deviceId();
    assertBeforeWrite?.();
    this.#assertResponder();
    return this.#sync.enqueueTeamResponse(
      this.#accountUserId,
      input.rootEventId,
      deviceId,
      {
        baseVersion: 0,
        decisionId: current.id,
        eventId: current.eventId,
        optionId: input.optionId,
      },
    );
  }

  async #requiredAssignments(rootEventId: string, eventId: string) {
    const current = await this.#store.getAssignments(
      this.#accountUserId,
      rootEventId,
      eventId,
    );
    if (!current || !current.canManage) {
      throw new Error('Team assignments are unavailable for management');
    }
    return current;
  }

  #assertManager() {
    if (!manager(this.#role())) {
      throw new Error('Team management requires an owner or organizer');
    }
  }

  #assertResponder() {
    if (this.#role() === 'viewer') {
      throw new Error('Viewers cannot answer team decisions');
    }
  }
}

function decisionDelivery(decision: TeamDecisionReadModel): {
  label: string;
  state: TeamDeliveryState;
} {
  switch (decision.responseSyncState) {
    case 'pending':
      return { label: 'Wartet auf Verbindung', state: 'pending' };
    case 'awaiting_pull':
      return { label: 'Wartet auf Serverbestätigung', state: 'pending' };
    case 'needs_attention':
      return { label: 'Aktion erforderlich', state: 'needs_attention' };
    case 'synced':
      return { label: 'Synchronisiert', state: 'synced' };
    case null:
      return { label: 'Synchronisiert', state: 'synced' };
  }
}

function assignmentDeliveryLabel(state: TeamDeliveryState) {
  switch (state) {
    case 'needs_attention':
      return 'Aktion erforderlich';
    case 'pending':
      return 'Wartet auf Verbindung';
    case 'synced':
      return 'Synchronisiert';
    case 'unpublished':
      return 'Änderungen offen · noch nicht veröffentlicht';
  }
}

function manager(role: TeamRole): role is 'organizer' | 'owner' {
  return role === 'owner' || role === 'organizer';
}

function publicTeam(team: {
  color: string | null;
  id: string;
  name: string;
}): TeamAssignmentPublicTeam {
  return { color: team.color, id: team.id, name: team.name };
}

function required(people: ReadonlyMap<string, TeamPerson>, userId: string) {
  const person = people.get(userId);
  if (!person) throw new Error('Team member identity is unavailable');
  return person;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}
