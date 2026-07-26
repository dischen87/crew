import {
  GatewayClientError,
  type GatewayRequest,
  type GatewayResponseData,
  type GatewaySessionSubject,
} from '@crew/mobile-client';
import {
  MobileDataStore,
  sha256Hex,
  type CapabilityRecord,
  type DraftRecord,
  type EventPlaceRecord,
  type EventTreeNode,
  type SqlDatabase,
} from '@crew/mobile-data';
import type { MobileGatewayClient } from '../app/GatewayProvider';
import { secureUuidV4 } from '../storage/secureRandom';

export type EventSetupRecoveryCode =
  | 'EVENT_CAPABILITY_PLACE_REQUIRED'
  | 'EVENT_CAPABILITY_REQUIRED'
  | 'EVENT_TEMPLATE_REQUIRED';

export type EventSetupCapabilityType =
  | 'golf'
  | 'lodging'
  | 'team'
  | 'transport'
  | 'travel';

export type EventSetupTemplateId = 'golf-tour' | 'team-event' | 'travel';

export type EventSetupRecoveryIntent = {
  capabilityType?: EventSetupCapabilityType;
  code: EventSetupRecoveryCode;
  eventId?: string;
  rootEventId: string;
};

type EventTree = GatewayResponseData<'eventsTreeGet'>;
type RemoteCapability = EventTree['capabilities'][number];
type CapabilityInput = GatewayRequest<'eventCapabilitiesReplace'>['body']['capability'];
type RemotePlace = GatewayResponseData<'eventPlacesList'>['items'][number];
type Readiness = GatewayResponseData<'eventPublishReadinessGet'>;
type Template = GatewayResponseData<'eventTemplatesList'>['templates'][number];
type TemplateAdoptionExpectation = {
  eventIds: Readonly<Record<string, string>>;
  templateId: EventSetupTemplateId;
  templateVersion: 1;
};

export type EventSetupPlaceCandidate =
  GatewayResponseData<'placesSearch'>['items'][number];

export type EventSetupPlaceEnrichment =
  GatewayResponseData<'placeEnrichmentJobsCreate'>;

export type EventSetupTemplateChoice = Pick<
  Template,
  'id' | 'summary' | 'title' | 'version'
> & { logicalKeys: readonly string[] };

export type EventSetupRecoveryTarget = {
  capability: CapabilityInput | null;
  capabilityVersion: number;
  currentPlaceName: string | null;
  defaultCapability: CapabilityInput | null;
  eventId: string;
  eventTitle: string;
  type: EventSetupCapabilityType;
};

export type EventSetupRecoverySnapshot = {
  blockerActive: boolean | null;
  checkedAt: string | null;
  eventTitle: string;
  intent: EventSetupRecoveryIntent;
  role: 'organizer' | 'owner';
  rootRevision: string | null;
  rootVersion: number;
  source: 'cached' | 'online';
  target: EventSetupRecoveryTarget | null;
  template: EventSetupTemplateId | null;
  templates: readonly EventSetupTemplateChoice[];
};

export type EventSetupPlaceSearch = {
  results: readonly EventSetupPlaceCandidate[];
  snapshot: EventSetupRecoverySnapshot;
};

export type EventSetupRecoveryRuntimeOptions = {
  accountUserId: string;
  activeAccountUserId(): string | null | Promise<string | null>;
  client: MobileGatewayClient | null;
  database: SqlDatabase;
  isOnline(): boolean;
  newUuid?: () => string;
  now?: () => Date;
};

type CachedReadinessRow = {
  refreshed_at: string;
  snapshot_json: string;
};

const accountPattern = /^usr_[a-f0-9]{32}$/;
const eventPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const enrichmentJobPattern = /^pej_[a-f0-9]{64}$/;
const globalPlacePattern = /^gpl_[a-f0-9]{64}$/;
const revisionPattern = /^[1-9][0-9]*$/;
const capabilityTypes = new Set<EventSetupCapabilityType>([
  'golf',
  'lodging',
  'team',
  'transport',
  'travel',
]);
const readinessCodes = new Set([
  'EVENT_CAPABILITY_PLACE_REQUIRED',
  'EVENT_CAPABILITY_REQUIRED',
  'EVENT_DESCRIPTION_REQUIRED',
  'EVENT_END_REQUIRED',
  'EVENT_START_REQUIRED',
  'EVENT_STATUS_NOT_DRAFT',
  'EVENT_TEMPLATE_REQUIRED',
  'EVENT_TITLE_REQUIRED',
]);
const commandLocks = new WeakMap<SqlDatabase, Set<string>>();

export class EventSetupRecoveryAccountChangedError extends Error {
  constructor() {
    super('Active account changed during event setup recovery');
    this.name = 'EventSetupRecoveryAccountChangedError';
  }
}

export class EventSetupRecoveryBusyError extends Error {
  constructor() {
    super('Event setup recovery is already running');
    this.name = 'EventSetupRecoveryBusyError';
  }
}

export class EventSetupRecoveryConflictError extends Error {
  constructor() {
    super('Event setup changed during recovery');
    this.name = 'EventSetupRecoveryConflictError';
  }
}

export class EventSetupRecoveryConnectionError extends Error {
  constructor() {
    super('Event setup recovery could not reach the Gateway');
    this.name = 'EventSetupRecoveryConnectionError';
  }
}

export class EventSetupRecoveryEnrichmentUnavailableError extends Error {
  constructor() {
    super('Place enrichment is unavailable');
    this.name = 'EventSetupRecoveryEnrichmentUnavailableError';
  }
}

export class EventSetupRecoveryManagerRequiredError extends Error {
  constructor() {
    super('Event setup recovery requires an owner or organizer');
    this.name = 'EventSetupRecoveryManagerRequiredError';
  }
}

export class EventSetupRecoveryOnlineRequiredError extends Error {
  constructor() {
    super('Event setup recovery requires a connection');
    this.name = 'EventSetupRecoveryOnlineRequiredError';
  }
}

export class EventSetupRecoveryUnavailableError extends Error {
  constructor() {
    super('Event setup recovery is unavailable');
    this.name = 'EventSetupRecoveryUnavailableError';
  }
}

export class EventSetupRecoveryRuntime {
  readonly #accountUserId: string;
  readonly #activeAccountUserId: EventSetupRecoveryRuntimeOptions['activeAccountUserId'];
  readonly #client: MobileGatewayClient | null;
  readonly #data: MobileDataStore;
  readonly #database: SqlDatabase;
  readonly #isOnline: EventSetupRecoveryRuntimeOptions['isOnline'];
  readonly #newUuid: () => string;
  readonly #now: () => Date;

  constructor(options: EventSetupRecoveryRuntimeOptions) {
    if (!accountPattern.test(options.accountUserId)) {
      throw new TypeError('Invalid event setup account ID');
    }
    this.#accountUserId = options.accountUserId;
    this.#activeAccountUserId = options.activeAccountUserId;
    this.#client = options.client;
    this.#data = new MobileDataStore(options.database);
    this.#database = options.database;
    this.#isOnline = options.isOnline;
    this.#newUuid = options.newUuid ?? secureUuidV4;
    this.#now = options.now ?? (() => new Date());
  }

  async loadCached(
    rawIntent: EventSetupRecoveryIntent,
  ): Promise<EventSetupRecoverySnapshot> {
    const intent = validateIntent(rawIntent);
    await this.#assertActive();
    const [events, memberships, capabilities, places, readinessRow] =
      await Promise.all([
        this.#data.listEventTree(this.#accountUserId, intent.rootEventId),
        this.#data.listMemberships(this.#accountUserId, intent.rootEventId),
        this.#data.listCapabilities(this.#accountUserId, intent.rootEventId),
        this.#data.listEventPlaces(this.#accountUserId, intent.rootEventId),
        this.#database.first<CachedReadinessRow>(
          `SELECT snapshot_json, refreshed_at
FROM event_publish_readiness_cache
WHERE account_user_id = ? AND root_event_id = ?`,
          [this.#accountUserId, intent.rootEventId],
        ),
      ]);
    await this.#assertActive();
    const root = cachedRoot(events, intent.rootEventId);
    const role = cachedManagerRole(
      memberships,
      this.#accountUserId,
      intent.rootEventId,
    );
    const cachedReadiness = parseCachedReadiness(
      readinessRow?.snapshot_json,
      intent.rootEventId,
    );
    const blockerActive = cachedReadiness
      ? readinessHasIntent(cachedReadiness, intent)
      : null;
    return {
      blockerActive,
      checkedAt: cachedReadiness ? readinessRow?.refreshed_at ?? null : null,
      eventTitle: root.title.trim() || 'Dein Event',
      intent,
      role,
      rootRevision: cachedReadiness?.rootRevision ?? null,
      rootVersion: root.version,
      source: 'cached',
      target: cachedTarget(intent, events, capabilities, places),
      template: parseTemplateId(cachedReadiness?.template?.id),
      templates: [],
    };
  }

  async refresh(
    rawIntent: EventSetupRecoveryIntent,
  ): Promise<EventSetupRecoverySnapshot> {
    const intent = validateIntent(rawIntent);
    return this.#online(subject => this.#refresh(subject, intent));
  }

  async searchPlaces(
    rawIntent: EventSetupRecoveryIntent,
    value: string,
  ): Promise<EventSetupPlaceSearch> {
    const intent = validateIntent(rawIntent);
    if (intent.code !== 'EVENT_CAPABILITY_PLACE_REQUIRED') {
      throw new EventSetupRecoveryUnavailableError();
    }
    const query = value.trim();
    if (query.length < 1 || query.length > 120) {
      throw new TypeError('Place search must contain 1 to 120 characters');
    }
    return this.#online(async subject => {
      const snapshot = await this.#refresh(subject, intent);
      if (!snapshot.blockerActive) throw new EventSetupRecoveryConflictError();
      if (!snapshot.target) throw new EventSetupRecoveryUnavailableError();
      const response = await this.#request(subject, 'placesSearch', {
        query: {
          kind: searchKind(snapshot.target.type),
          limit: 20,
          q: query,
        },
      });
      const results = response.data.items;
      if (results.length > 20 || !results.every(validCandidate)) {
        throw new EventSetupRecoveryUnavailableError();
      }
      return { results, snapshot };
    });
  }

  async createPlaceEnrichment(
    rawIntent: EventSetupRecoveryIntent,
    candidate: EventSetupPlaceCandidate,
  ): Promise<EventSetupPlaceEnrichment> {
    const intent = validatePlaceIntent(rawIntent, candidate);
    return this.#command(intent, async subject => {
      const snapshot = await this.#refresh(subject, intent);
      if (!snapshot.blockerActive) throw new EventSetupRecoveryConflictError();
      if (
        !snapshot.target ||
        candidate.kind !== searchKind(snapshot.target.type)
      ) {
        throw new EventSetupRecoveryUnavailableError();
      }
      const digest = await sha256Hex(
        JSON.stringify([
          this.#accountUserId,
          intent.rootEventId,
          candidate.id,
          candidate.version,
          candidate.retrievedAt,
        ]),
      );
      const response = await this.#request(
        subject,
        'placeEnrichmentJobsCreate',
        {
          body: { candidateId: candidate.id, target: 'candidate' },
          headers: {
            'idempotency-key': `place-enrichment-${digest.slice(0, 40)}`,
          },
        },
      );
      return placeEnrichmentProjection(response.data, candidate);
    });
  }

  async getPlaceEnrichment(
    rawIntent: EventSetupRecoveryIntent,
    candidate: EventSetupPlaceCandidate,
    jobId: string,
  ): Promise<EventSetupPlaceEnrichment> {
    validatePlaceIntent(rawIntent, candidate);
    if (!enrichmentJobPattern.test(jobId)) {
      throw new EventSetupRecoveryUnavailableError();
    }
    return this.#online(async subject => {
      const response = await this.#request(subject, 'placeEnrichmentJobsGet', {
        path: { jobId },
      });
      return placeEnrichmentProjection(response.data, candidate, jobId);
    });
  }

  async retryPlaceEnrichment(
    rawIntent: EventSetupRecoveryIntent,
    candidate: EventSetupPlaceCandidate,
    current: EventSetupPlaceEnrichment,
  ): Promise<EventSetupPlaceEnrichment> {
    const intent = validatePlaceIntent(rawIntent, candidate);
    const projection = placeEnrichmentProjection(current, candidate);
    if (!projection.enrichment.retryAllowed) {
      throw new EventSetupRecoveryUnavailableError();
    }
    return this.#command(intent, async subject => {
      const digest = await sha256Hex(
        JSON.stringify([
          this.#accountUserId,
          intent.rootEventId,
          projection.enrichment.id,
          projection.enrichment.updatedAt,
        ]),
      );
      const response = await this.#request(
        subject,
        'placeEnrichmentJobsRetry',
        {
          headers: {
            'idempotency-key': `place-enrichment-${digest.slice(0, 40)}`,
          },
          path: { jobId: projection.enrichment.id },
        },
      );
      return placeEnrichmentProjection(
        response.data,
        candidate,
        projection.enrichment.id,
      );
    });
  }

  async restoreCapability(
    rawIntent: EventSetupRecoveryIntent,
  ): Promise<EventSetupRecoverySnapshot> {
    const intent = validateIntent(rawIntent);
    if (intent.code !== 'EVENT_CAPABILITY_REQUIRED') {
      throw new EventSetupRecoveryUnavailableError();
    }
    return this.#command(intent, async subject => {
      const snapshot = await this.#refresh(subject, intent);
      if (!snapshot.blockerActive) throw new EventSetupRecoveryConflictError();
      const target = snapshot.target;
      if (!target?.defaultCapability || target.capability) {
        throw new EventSetupRecoveryUnavailableError();
      }
      await this.#replaceCapability(
        subject,
        intent,
        target.capabilityVersion,
        target.defaultCapability,
      );
      return this.#refresh(subject, intent);
    });
  }

  async adoptTemplate(
    rawIntent: EventSetupRecoveryIntent,
    templateId: EventSetupTemplateId,
  ): Promise<EventSetupRecoverySnapshot> {
    const intent = validateIntent(rawIntent);
    if (intent.code !== 'EVENT_TEMPLATE_REQUIRED') {
      throw new EventSetupRecoveryUnavailableError();
    }
    return this.#command(intent, async subject => {
      const snapshot = await this.#refresh(subject, intent);
      if (!snapshot.blockerActive) throw new EventSetupRecoveryConflictError();
      const template = snapshot.templates.find(item => item.id === templateId);
      if (
        !template ||
        !snapshot.rootRevision ||
        snapshot.rootVersion >= Number.MAX_SAFE_INTEGER
      ) {
        throw new EventSetupRecoveryUnavailableError();
      }
      const eventIds = await this.#templateEventIds(intent.rootEventId, template);
      const body: GatewayRequest<'eventTemplateAdopt'>['body'] = {
        baseRevision: snapshot.rootRevision,
        baseVersion: snapshot.rootVersion,
        template: {
          eventIds,
          id: template.id,
          version: template.version,
        },
      };
      const digest = await sha256Hex(
        JSON.stringify([
          this.#accountUserId,
          intent.rootEventId,
          body.baseVersion,
          body.baseRevision,
          body.template.id,
          body.template.version,
          body.template.eventIds,
        ]),
      );
      await this.#assertActive();
      const response = await this.#request(subject, 'eventTemplateAdopt', {
        body,
        headers: { 'idempotency-key': `template-${digest.slice(0, 48)}` },
        path: { rootEventId: intent.rootEventId },
      });
      if (
        response.data.event.id !== intent.rootEventId ||
        response.data.event.rootEventId !== intent.rootEventId ||
        response.data.event.parentEventId !== null ||
        response.data.event.status !== 'draft' ||
        response.data.event.version !== snapshot.rootVersion + 1 ||
        response.data.template.id !== template.id ||
        response.data.template.version !== template.version ||
        response.data.rootRevision !== incrementRevision(snapshot.rootRevision)
      ) {
        throw new EventSetupRecoveryUnavailableError();
      }
      const refreshed = await this.#refresh(subject, intent, {
        eventIds,
        templateId: template.id,
        templateVersion: template.version,
      });
      if (refreshed.blockerActive) {
        throw new EventSetupRecoveryUnavailableError();
      }
      await this.#deleteTemplateDraft(intent.rootEventId, templateId);
      return refreshed;
    });
  }

  async bindPrimaryPlace(
    rawIntent: EventSetupRecoveryIntent,
    candidate: EventSetupPlaceCandidate,
  ): Promise<EventSetupRecoverySnapshot> {
    const intent = validateIntent(rawIntent);
    if (
      intent.code !== 'EVENT_CAPABILITY_PLACE_REQUIRED' ||
      !validCandidate(candidate)
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    return this.#command(intent, async subject => {
      const snapshot = await this.#refresh(subject, intent);
      if (!snapshot.blockerActive) throw new EventSetupRecoveryConflictError();
      const target = snapshot.target;
      if (!target?.capability) {
        throw new EventSetupRecoveryUnavailableError();
      }
      if (candidate.kind !== searchKind(target.type)) {
        throw new EventSetupRecoveryUnavailableError();
      }
      if (primaryPlaceId(target.capability) !== null) {
        throw new EventSetupRecoveryConflictError();
      }
      const digest = await sha256Hex(
        JSON.stringify([
          this.#accountUserId,
          intent.rootEventId,
          candidate.id,
        ]),
      );
      await this.#assertActive();
      const placeId = `plc_${digest.slice(0, 40)}`;
      const placeBody = {
        countryCode: candidate.countryCode,
        id: placeId,
        latitude: candidate.latitude,
        locality: candidate.locality,
        longitude: candidate.longitude,
        name: candidate.name,
      };
      const placeKey = `place-${digest.slice(0, 48)}`;
      const placeResponse = await this.#request(subject, 'eventPlacesCreate', {
        body: placeBody,
        headers: { 'idempotency-key': placeKey },
        path: { rootEventId: intent.rootEventId },
      });
      const confirmedPlace = placeResponse.data.place;
      if (
        confirmedPlace.id !== placeId ||
        confirmedPlace.rootEventId !== intent.rootEventId ||
        confirmedPlace.name !== placeBody.name ||
        confirmedPlace.countryCode !== placeBody.countryCode ||
        confirmedPlace.locality !== placeBody.locality ||
        confirmedPlace.latitude !== placeBody.latitude ||
        confirmedPlace.longitude !== placeBody.longitude ||
        confirmedPlace.version !== 1
      ) {
        throw new EventSetupRecoveryUnavailableError();
      }
      const capability = withPrimaryPlace(target.capability, placeId);
      await this.#replaceCapability(
        subject,
        intent,
        target.capabilityVersion,
        capability,
      );
      return this.#refresh(subject, intent);
    });
  }

  async #replaceCapability(
    subject: GatewaySessionSubject,
    intent: EventSetupRecoveryIntent,
    baseVersion: number,
    capability: CapabilityInput,
  ): Promise<void> {
    if (
      capability.type !== intent.capabilityType ||
      !Number.isSafeInteger(baseVersion) ||
      baseVersion < 0 ||
      baseVersion >= Number.MAX_SAFE_INTEGER ||
      !intent.eventId
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    const digest = await sha256Hex(
      JSON.stringify([
        this.#accountUserId,
        intent.rootEventId,
        intent.eventId,
        capability.type,
        baseVersion,
        capability,
      ]),
    );
    await this.#assertActive();
    const response = await this.#request(subject, 'eventCapabilitiesReplace', {
      body: { baseVersion, capability },
      headers: { 'idempotency-key': `capability-${digest.slice(0, 48)}` },
      path: {
        capabilityType: capability.type,
        eventId: intent.eventId,
        rootEventId: intent.rootEventId,
      },
    });
    const confirmed = response.data.capability;
    const confirmedInput = capabilityInput(confirmed);
    if (
      confirmed.rootEventId !== intent.rootEventId ||
      confirmed.eventId !== intent.eventId ||
      confirmed.type !== capability.type ||
      confirmed.version !== baseVersion + 1 ||
      capabilityFingerprint(confirmedInput) !== capabilityFingerprint(capability)
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
  }

  async #templateEventIds(
    rootEventId: string,
    template: EventSetupTemplateChoice,
  ): Promise<Record<string, string>> {
    const draftId = templateDraftId(rootEventId, template.id);
    const existing = (await this.#data.listDrafts(this.#accountUserId, rootEventId))
      .find(item => item.id === draftId);
    await this.#assertActive();
    if (existing) return parseTemplateDraft(existing, template, rootEventId);
    const eventIds: Record<string, string> = {};
    for (const logicalKey of [...template.logicalKeys].sort()) {
      const eventId =
        logicalKey === 'root' ? rootEventId : `evt_${this.#newUuid()}`;
      if (!eventPattern.test(eventId)) {
        throw new EventSetupRecoveryUnavailableError();
      }
      eventIds[logicalKey] = eventId;
    }
    if (new Set(Object.values(eventIds)).size !== template.logicalKeys.length) {
      throw new EventSetupRecoveryUnavailableError();
    }
    const timestamp = this.#now().toISOString();
    await this.#data.putDraft({
      accountUserId: this.#accountUserId,
      contentJson: JSON.stringify({
        eventIds,
        schemaVersion: 1,
        templateId: template.id,
        templateVersion: template.version,
      }),
      createdAt: timestamp,
      entityType: 'event.template-adoption',
      eventId: rootEventId,
      id: draftId,
      rootEventId,
      updatedAt: timestamp,
    });
    await this.#assertActive();
    return eventIds;
  }

  async #deleteTemplateDraft(
    rootEventId: string,
    templateId: EventSetupTemplateId,
  ): Promise<void> {
    await this.#database.run(
      `DELETE FROM local_drafts
WHERE account_user_id = ? AND root_event_id = ? AND id = ?
  AND entity_type = 'event.template-adoption'`,
      [this.#accountUserId, rootEventId, templateDraftId(rootEventId, templateId)],
    );
    await this.#assertActive();
  }

  async #refresh(
    subject: GatewaySessionSubject,
    intent: EventSetupRecoveryIntent,
    adoption?: TemplateAdoptionExpectation,
  ): Promise<EventSetupRecoverySnapshot> {
    const [templatesResponse, membership] = await Promise.all([
      this.#request(subject, 'eventTemplatesList', {}),
      this.#managerRole(subject, intent.rootEventId),
    ]);
    const templates = validateTemplates(templatesResponse.data.templates);
    let tree: EventTree | null = null;
    let readiness: Readiness | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      tree = (
        await this.#request(subject, 'eventsTreeGet', {
          path: { rootEventId: intent.rootEventId },
        })
      ).data;
      const readinessData = (
        await this.#request(subject, 'eventPublishReadinessGet', {
          path: { rootEventId: intent.rootEventId },
        })
      ).data;
      if (!validReadiness(readinessData, intent.rootEventId)) {
        throw new EventSetupRecoveryUnavailableError();
      }
      readiness = readinessData;
      const root = tree.events.find(
        event =>
          event.id === intent.rootEventId && event.parentEventId === null,
      );
      if (
        tree.rootRevision === readiness.rootRevision &&
        root?.version === readiness.rootVersion
      ) {
        break;
      }
      tree = null;
      readiness = null;
    }
    if (!tree || !readiness) throw new EventSetupRecoveryConflictError();
    const places = await this.#allPlaces(subject, intent.rootEventId);
    const snapshot = remoteSnapshot(
      intent,
      membership,
      tree,
      readiness,
      templates,
      places,
      this.#now(),
    );
    if (adoption) validateAdoptedTemplate(tree, templates, adoption);
    return snapshot;
  }

  async #allPlaces(
    subject: GatewaySessionSubject,
    rootEventId: string,
  ): Promise<readonly RemotePlace[]> {
    const places: RemotePlace[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const response = await this.#request(subject, 'eventPlacesList', {
        path: { rootEventId },
        query: { cursor, limit: 200 },
      });
      places.push(...response.data.items);
      if (!response.data.pageInfo.hasMore) return places;
      cursor = response.data.pageInfo.nextCursor ?? undefined;
      if (!cursor) break;
    }
    throw new EventSetupRecoveryUnavailableError();
  }

  async #managerRole(
    subject: GatewaySessionSubject,
    rootEventId: string,
  ): Promise<'organizer' | 'owner'> {
    let cursor: string | undefined;
    for (let page = 0; page < 3; page += 1) {
      const response = await this.#request(subject, 'eventMembershipsList', {
        path: { rootEventId },
        query: { cursor, limit: 200 },
      });
      const membership = response.data.items.find(
        item => item.userId === this.#accountUserId,
      );
      if (membership) {
        if (
          membership.rootEventId !== rootEventId ||
          membership.status !== 'active'
        ) {
          throw new EventSetupRecoveryUnavailableError();
        }
        if (membership.role !== 'owner' && membership.role !== 'organizer') {
          throw new EventSetupRecoveryManagerRequiredError();
        }
        return membership.role;
      }
      if (!response.data.pageInfo.hasMore) break;
      cursor = response.data.pageInfo.nextCursor ?? undefined;
      if (!cursor) break;
    }
    throw new EventSetupRecoveryUnavailableError();
  }

  async #command<Result>(
    intent: EventSetupRecoveryIntent,
    work: (subject: GatewaySessionSubject) => Promise<Result>,
  ): Promise<Result> {
    const key = `${this.#accountUserId}\u0000${intent.rootEventId}`;
    let locks = commandLocks.get(this.#database);
    if (!locks) {
      locks = new Set();
      commandLocks.set(this.#database, locks);
    }
    if (locks.has(key)) throw new EventSetupRecoveryBusyError();
    locks.add(key);
    try {
      return await this.#online(work);
    } finally {
      locks.delete(key);
    }
  }

  async #online<Result>(
    work: (subject: GatewaySessionSubject) => Promise<Result>,
  ): Promise<Result> {
    if (!this.#client || !this.#isOnline()) {
      throw new EventSetupRecoveryOnlineRequiredError();
    }
    try {
      await this.#assertActive();
      const subject = await this.#client.sessionSubject();
      if (!subject || subject.userId !== this.#accountUserId) {
        throw new EventSetupRecoveryAccountChangedError();
      }
      await this.#client.assertSessionSubject(subject);
      await this.#assertActive();
      const result = await work(subject);
      await this.#client.assertSessionSubject(subject);
      await this.#assertActive();
      return result;
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  async #request<Id extends Parameters<MobileGatewayClient['requestAsUser']>[1]>(
    subject: GatewaySessionSubject,
    operationId: Id,
    options: GatewayRequest<Id>,
  ) {
    if (!this.#client) throw new EventSetupRecoveryOnlineRequiredError();
    await this.#assertActive();
    const response = await this.#client.requestAsUser(
      subject,
      operationId,
      options,
    );
    await this.#assertActive();
    return response;
  }

  async #assertActive(): Promise<void> {
    if ((await this.#activeAccountUserId()) !== this.#accountUserId) {
      throw new EventSetupRecoveryAccountChangedError();
    }
  }
}

function validateIntent(
  intent: EventSetupRecoveryIntent,
): EventSetupRecoveryIntent {
  if (!eventPattern.test(intent.rootEventId)) {
    throw new TypeError('Invalid event setup root ID');
  }
  if (intent.code === 'EVENT_TEMPLATE_REQUIRED') {
    if (intent.eventId || intent.capabilityType) {
      throw new EventSetupRecoveryUnavailableError();
    }
    return intent;
  }
  if (
    intent.code !== 'EVENT_CAPABILITY_REQUIRED' &&
    intent.code !== 'EVENT_CAPABILITY_PLACE_REQUIRED'
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  if (
    !intent.eventId ||
    !eventPattern.test(intent.eventId) ||
    !intent.capabilityType ||
    !capabilityTypes.has(intent.capabilityType)
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  return intent;
}

function validatePlaceIntent(
  rawIntent: EventSetupRecoveryIntent,
  candidate: EventSetupPlaceCandidate,
): EventSetupRecoveryIntent {
  const intent = validateIntent(rawIntent);
  if (
    intent.code !== 'EVENT_CAPABILITY_PLACE_REQUIRED' ||
    !validCandidate(candidate)
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  return intent;
}

function cachedRoot(
  events: readonly EventTreeNode[],
  rootEventId: string,
): EventTreeNode {
  const root = events.find(
    event =>
      event.id === rootEventId &&
      event.rootEventId === rootEventId &&
      event.parentEventId === null &&
      event.deletedAt === null,
  );
  if (!root || root.status !== 'draft') {
    throw new EventSetupRecoveryUnavailableError();
  }
  return root;
}

function cachedManagerRole(
  memberships: readonly {
    memberUserId: string;
    role: string;
    rootEventId: string;
    status: string;
  }[],
  accountUserId: string,
  rootEventId: string,
): 'organizer' | 'owner' {
  const membership = memberships.find(
    item =>
      item.memberUserId === accountUserId &&
      item.rootEventId === rootEventId &&
      item.status === 'active',
  );
  if (!membership) throw new EventSetupRecoveryUnavailableError();
  if (membership.role !== 'owner' && membership.role !== 'organizer') {
    throw new EventSetupRecoveryManagerRequiredError();
  }
  return membership.role;
}

function parseCachedReadiness(
  value: string | undefined,
  rootEventId: string,
): Readiness | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return validReadiness(parsed, rootEventId) ? parsed : null;
  } catch {
    return null;
  }
}

function readinessHasIntent(
  readiness: Readiness,
  intent: EventSetupRecoveryIntent,
): boolean {
  return readiness.reasons.some(reason => {
    if (reason.code !== intent.code) return false;
    if (intent.code === 'EVENT_TEMPLATE_REQUIRED') return true;
    return (
      reason.meta?.eventId === intent.eventId &&
      reason.meta?.capabilityType === intent.capabilityType
    );
  });
}

function cachedTarget(
  intent: EventSetupRecoveryIntent,
  events: readonly EventTreeNode[],
  capabilities: readonly CapabilityRecord[],
  places: readonly EventPlaceRecord[],
): EventSetupRecoveryTarget | null {
  if (!intent.eventId || !intent.capabilityType) return null;
  const event = events.find(
    item =>
      item.id === intent.eventId &&
      item.rootEventId === intent.rootEventId &&
      item.deletedAt === null,
  );
  if (!event) {
    throw new EventSetupRecoveryUnavailableError();
  }
  const record = capabilities.find(
    item =>
      item.accountUserId === event.accountUserId &&
      item.rootEventId === intent.rootEventId &&
      item.eventId === intent.eventId &&
      item.type === intent.capabilityType &&
      item.deletedAt === null,
  );
  const capability = record ? parseLocalCapability(record) : null;
  const placeId = capability ? primaryPlaceId(capability) : null;
  return {
    capability,
    capabilityVersion: record?.version ?? 0,
    currentPlaceName: placeId
      ? places.find(
          place =>
            place.accountUserId === event.accountUserId &&
            place.rootEventId === intent.rootEventId &&
            place.id === placeId &&
            place.deletedAt === null,
        )?.name ?? null
      : null,
    defaultCapability: null,
    eventId: event.id,
    eventTitle: event.title,
    type: intent.capabilityType,
  };
}

function remoteSnapshot(
  intent: EventSetupRecoveryIntent,
  role: 'organizer' | 'owner',
  tree: EventTree,
  readiness: Readiness,
  templates: readonly Template[],
  places: readonly RemotePlace[],
  now: Date,
): EventSetupRecoverySnapshot {
  if (
    tree.rootEventId !== intent.rootEventId ||
    readiness.rootEventId !== intent.rootEventId ||
    tree.events.length > 500 ||
    tree.capabilities.length > 500 ||
    places.length > 600 ||
    tree.events.some(event => event.rootEventId !== intent.rootEventId) ||
    tree.capabilities.some(item => item.rootEventId !== intent.rootEventId) ||
    places.some(place => place.rootEventId !== intent.rootEventId)
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  const root = tree.events.find(
    event =>
      event.id === intent.rootEventId && event.parentEventId === null,
  );
  if (!root || root.status !== 'draft') {
    throw new EventSetupRecoveryUnavailableError();
  }
  const template = templateForReadiness(templates, readiness);
  const target = remoteTarget(intent, tree, readiness, template, places);
  return {
    blockerActive: readinessHasIntent(readiness, intent),
    checkedAt: now.toISOString(),
    eventTitle: root.title.trim() || 'Dein Event',
    intent,
    role,
    rootRevision: readiness.rootRevision,
    rootVersion: readiness.rootVersion,
    source: 'online',
    target,
    template: parseTemplateId(readiness.template?.id),
    templates: templates.map(item => ({
      id: item.id,
      logicalKeys: item.events.map(event => event.logicalKey),
      summary: item.summary,
      title: item.title,
      version: item.version,
    })),
  };
}

function remoteTarget(
  intent: EventSetupRecoveryIntent,
  tree: EventTree,
  readiness: Readiness,
  template: Template | null,
  places: readonly RemotePlace[],
): EventSetupRecoveryTarget | null {
  if (!intent.eventId || !intent.capabilityType) return null;
  const event = tree.events.find(item => item.id === intent.eventId);
  if (!event) throw new EventSetupRecoveryUnavailableError();
  const capability = tree.capabilities.find(
    item => item.eventId === intent.eventId && item.type === intent.capabilityType,
  );
  if (
    capability &&
    (!Number.isSafeInteger(capability.version) || capability.version < 1)
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  const input = capability ? capabilityInput(capability) : null;
  const placeId = input ? primaryPlaceId(input) : null;
  const readinessCapabilityVersion = readiness.reasons.find(
    reason =>
      reason.code === 'EVENT_CAPABILITY_REQUIRED' &&
      reason.meta?.eventId === intent.eventId &&
      reason.meta?.capabilityType === intent.capabilityType,
  )?.meta?.capabilityVersion;
  return {
    capability: input,
    capabilityVersion: capability?.version ?? readinessCapabilityVersion ?? 0,
    currentPlaceName: placeId
      ? places.find(place => place.id === placeId)?.name ?? null
      : null,
    defaultCapability: template
      ? templateCapability(template, intent.capabilityType)
      : null,
    eventId: event.id,
    eventTitle: event.title,
    type: intent.capabilityType,
  };
}

function validateTemplates(value: readonly Template[]): readonly Template[] {
  if (value.length < 1 || value.length > 8) {
    throw new EventSetupRecoveryUnavailableError();
  }
  const ids = new Set<string>();
  for (const template of value) {
    for (const event of template.events) {
      for (const capability of event.capabilities) {
        validateCapabilityInput(capability);
      }
    }
    const keys = template.events.map(event => event.logicalKey);
    const keySet = new Set(keys);
    const root = template.events.find(event => event.logicalKey === 'root');
    if (
      parseTemplateId(template.id) === null ||
      ids.has(template.id) ||
      template.version !== 1 ||
      keys.length < 1 ||
      keys.length > 16 ||
      new Set(keys).size !== keys.length ||
      !root ||
      root.parentLogicalKey !== null ||
      template.events.filter(event => event.parentLogicalKey === null).length !== 1 ||
      template.events.some(
        event =>
          event.logicalKey.length < 1 ||
          event.logicalKey.length > 96 ||
          (event.parentLogicalKey !== null &&
            !keySet.has(event.parentLogicalKey)) ||
          new Set(event.capabilities.map(capability => capability.type)).size !==
            event.capabilities.length,
      ) ||
      template.events.some(event => templateEventCycles(event, template.events))
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    ids.add(template.id);
  }
  return value;
}

function validateAdoptedTemplate(
  tree: EventTree,
  templates: readonly Template[],
  expectation: TemplateAdoptionExpectation,
): void {
  const template = templates.find(
    item =>
      item.id === expectation.templateId &&
      item.version === expectation.templateVersion,
  );
  if (!template) throw new EventSetupRecoveryUnavailableError();
  const logicalKeys = template.events.map(event => event.logicalKey).sort();
  const suppliedKeys = Object.keys(expectation.eventIds).sort();
  if (
    logicalKeys.length !== suppliedKeys.length ||
    logicalKeys.some((key, index) => key !== suppliedKeys[index])
  ) {
    throw new EventSetupRecoveryUnavailableError();
  }
  for (const blueprint of template.events) {
    const eventId = expectation.eventIds[blueprint.logicalKey];
    const parentEventId = blueprint.parentLogicalKey
      ? expectation.eventIds[blueprint.parentLogicalKey]
      : null;
    const matches = tree.events.filter(event => event.id === eventId);
    if (
      !eventId ||
      parentEventId === undefined ||
      matches.length !== 1 ||
      matches[0]?.rootEventId !== tree.rootEventId ||
      matches[0]?.parentEventId !== parentEventId ||
      matches[0]?.kind !== blueprint.kind
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    for (const expectedCapability of blueprint.capabilities) {
      const capabilities = tree.capabilities.filter(
        capability =>
          capability.eventId === eventId &&
          capability.type === expectedCapability.type,
      );
      const confirmed = capabilities[0];
      if (
        capabilities.length !== 1 ||
        !confirmed ||
        confirmed.version !== 1 ||
        capabilityFingerprint(capabilityInput(confirmed)) !==
          capabilityFingerprint(expectedCapability)
      ) {
        throw new EventSetupRecoveryUnavailableError();
      }
    }
  }
}

function templateForReadiness(
  templates: readonly Template[],
  readiness: Readiness,
): Template | null {
  if (!readiness.template) return null;
  const template = templates.find(
    item =>
      item.id === readiness.template?.id &&
      item.version === readiness.template.version,
  );
  if (!template) throw new EventSetupRecoveryUnavailableError();
  return template;
}

function templateCapability(
  template: Template,
  type: EventSetupCapabilityType,
): CapabilityInput {
  const matches = template.events.flatMap(event =>
    event.capabilities.filter(capability => capability.type === type),
  );
  if (matches.length !== 1) throw new EventSetupRecoveryUnavailableError();
  return matches[0];
}

function parseLocalCapability(record: CapabilityRecord): CapabilityInput {
  if (record.schemaVersion !== 1) {
    throw new EventSetupRecoveryUnavailableError();
  }
  try {
    return localCapability(record.type, JSON.parse(record.configJson));
  } catch {
    throw new EventSetupRecoveryUnavailableError();
  }
}

function localCapability(
  type: EventSetupCapabilityType,
  value: unknown,
): CapabilityInput {
  if (!isRecord(value)) throw new EventSetupRecoveryUnavailableError();
  switch (type) {
    case 'travel':
      if (
        !nullableId(value.homePlaceId) ||
        !nullableString(value.travelerReferenceLabel)
      ) {
        break;
      }
      return {
        config: {
          homePlaceId: value.homePlaceId,
          travelerReferenceLabel: value.travelerReferenceLabel,
        },
        schemaVersion: 1,
        type,
      };
    case 'lodging':
      if (
        !nullableId(value.propertyPlaceId) ||
        (value.checkInPolicy !== 'fixed' &&
          value.checkInPolicy !== 'flexible') ||
        (value.checkOutPolicy !== 'fixed' &&
          value.checkOutPolicy !== 'flexible') ||
        (value.roomAssignmentMode !== 'organizer' &&
          value.roomAssignmentMode !== 'self_service')
      ) {
        break;
      }
      return {
        config: {
          checkInPolicy: value.checkInPolicy,
          checkOutPolicy: value.checkOutPolicy,
          propertyPlaceId: value.propertyPlaceId,
          roomAssignmentMode: value.roomAssignmentMode,
        },
        schemaVersion: 1,
        type,
      };
    case 'transport':
      if (
        !nullableId(value.meetingPlaceId) ||
        (value.participantMode !== 'self_arranged' &&
          value.participantMode !== 'shared' &&
          value.participantMode !== 'mixed')
      ) {
        break;
      }
      return {
        config: {
          meetingPlaceId: value.meetingPlaceId,
          participantMode: value.participantMode,
        },
        schemaVersion: 1,
        type,
      };
    case 'golf':
      if (
        !nullableId(value.coursePlaceId) ||
        (value.handicapMode !== 'none' &&
          value.handicapMode !== 'optional' &&
          value.handicapMode !== 'required') ||
        (value.roundState !== 'planned' &&
          value.roundState !== 'open' &&
          value.roundState !== 'closed') ||
        (value.scoringMode !== 'none' &&
          value.scoringMode !== 'stroke_play' &&
          value.scoringMode !== 'stableford') ||
        (value.teeFormat !== 'individual' &&
          value.teeFormat !== 'pairs' &&
          value.teeFormat !== 'fourball')
      ) {
        break;
      }
      return {
        config: {
          coursePlaceId: value.coursePlaceId,
          handicapMode: value.handicapMode,
          roundState: value.roundState,
          scoringMode: value.scoringMode,
          teeFormat: value.teeFormat,
        },
        schemaVersion: 1,
        type,
      };
    case 'team':
      if (
        !nullableId(value.venuePlaceId) ||
        (value.assignmentMode !== 'organizer' &&
          value.assignmentMode !== 'self_select' &&
          value.assignmentMode !== 'random') ||
        (value.capacityPerTeam !== null &&
          (typeof value.capacityPerTeam !== 'number' ||
            !Number.isSafeInteger(value.capacityPerTeam) ||
            Number(value.capacityPerTeam) < 1)) ||
        !nullableString(value.facilitator)
      ) {
        break;
      }
      return {
        config: {
          assignmentMode: value.assignmentMode,
          capacityPerTeam: value.capacityPerTeam,
          facilitator: value.facilitator,
          venuePlaceId: value.venuePlaceId,
        },
        schemaVersion: 1,
        type,
      };
  }
  throw new EventSetupRecoveryUnavailableError();
}

function capabilityInput(value: RemoteCapability): CapabilityInput {
  return validateCapabilityInput(value);
}

function validateCapabilityInput(value: CapabilityInput): CapabilityInput {
  if (value.schemaVersion !== 1) {
    throw new EventSetupRecoveryUnavailableError();
  }
  return localCapability(value.type, value.config);
}

function capabilityFingerprint(value: CapabilityInput): string {
  return JSON.stringify([
    value.schemaVersion,
    value.type,
    Object.entries(value.config).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
}

function nullableId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^plc_[A-Za-z0-9._:-]{1,96}$/.test(value))
  );
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function primaryPlaceId(capability: CapabilityInput): string | null {
  switch (capability.type) {
    case 'travel':
      return capability.config.homePlaceId;
    case 'lodging':
      return capability.config.propertyPlaceId;
    case 'transport':
      return capability.config.meetingPlaceId;
    case 'golf':
      return capability.config.coursePlaceId;
    case 'team':
      return capability.config.venuePlaceId;
  }
}

function withPrimaryPlace(
  capability: CapabilityInput,
  placeId: string,
): CapabilityInput {
  switch (capability.type) {
    case 'travel':
      return {
        ...capability,
        config: { ...capability.config, homePlaceId: placeId },
      };
    case 'lodging':
      return {
        ...capability,
        config: { ...capability.config, propertyPlaceId: placeId },
      };
    case 'transport':
      return {
        ...capability,
        config: { ...capability.config, meetingPlaceId: placeId },
      };
    case 'golf':
      return {
        ...capability,
        config: { ...capability.config, coursePlaceId: placeId },
      };
    case 'team':
      return {
        ...capability,
        config: { ...capability.config, venuePlaceId: placeId },
      };
  }
}

function searchKind(type: EventSetupCapabilityType): 'golf_course' | 'venue' {
  return type === 'golf' ? 'golf_course' : 'venue';
}

function validCandidate(value: EventSetupPlaceCandidate): boolean {
  const hasLatitude = value.latitude !== null;
  const hasLongitude = value.longitude !== null;
  return (
    typeof value.id === 'string' &&
    value.id.length >= 1 &&
    value.id.length <= 128 &&
    Number.isSafeInteger(value.version) &&
    value.version >= 1 &&
    validTimestamp(value.retrievedAt) &&
    typeof value.name === 'string' &&
    value.name.trim().length >= 1 &&
    value.name.length <= 200 &&
    (value.locality === null ||
      (typeof value.locality === 'string' && value.locality.length <= 200)) &&
    /^[A-Z]{2}$/.test(value.countryCode) &&
    hasLatitude === hasLongitude &&
    (value.latitude === null ||
      (Number.isFinite(value.latitude) &&
        value.latitude >= -90 &&
        value.latitude <= 90)) &&
    (value.longitude === null ||
      (Number.isFinite(value.longitude) &&
        value.longitude >= -180 &&
        value.longitude <= 180))
  );
}

function placeEnrichmentProjection(
  value: EventSetupPlaceEnrichment,
  candidate: EventSetupPlaceCandidate,
  expectedJobId?: string,
): EventSetupPlaceEnrichment {
  const { enrichment, place } = value;
  const active =
    enrichment.status === 'pending' ||
    enrichment.status === 'processing' ||
    enrichment.status === 'retry';
  if (
    !enrichmentJobPattern.test(enrichment.id) ||
    (expectedJobId !== undefined && enrichment.id !== expectedJobId) ||
    !validTimestamp(enrichment.createdAt) ||
    !validTimestamp(enrichment.updatedAt) ||
    (enrichment.completedAt !== null &&
      !validTimestamp(enrichment.completedAt)) ||
    (active
      ? !Number.isSafeInteger(enrichment.pollAfterSeconds) ||
        Number(enrichment.pollAfterSeconds) < 1 ||
        Number(enrichment.pollAfterSeconds) > 30 ||
        enrichment.completedAt !== null
      : enrichment.pollAfterSeconds !== null ||
        enrichment.completedAt === null) ||
    enrichment.retryAllowed !== (enrichment.status === 'retry') ||
    (place === null
      ? enrichment.status === 'succeeded'
      : !globalPlacePattern.test(place.id) ||
        place.sourceCandidateId !== candidate.id ||
        place.kind !== candidate.kind ||
        !validPlaceFacts(place))
  ) {
    throw new EventSetupRecoveryEnrichmentUnavailableError();
  }
  return value;
}

function validPlaceFacts(value: {
  countryCode: string;
  latitude: number | null;
  locality: string | null;
  longitude: number | null;
  name: string;
}): boolean {
  return (
    value.name.trim().length >= 1 &&
    value.name.length <= 200 &&
    (value.locality === null || value.locality.length <= 200) &&
    /^[A-Z]{2}$/.test(value.countryCode) &&
    (value.latitude === null) === (value.longitude === null) &&
    (value.latitude === null ||
      (Number.isFinite(value.latitude) &&
        value.latitude >= -90 &&
        value.latitude <= 90)) &&
    (value.longitude === null ||
      (Number.isFinite(value.longitude) &&
        value.longitude >= -180 &&
        value.longitude <= 180))
  );
}

function validTimestamp(value: string): boolean {
  return (
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validCachedTemplate(value: unknown): boolean {
  return (
    value === null ||
    (isRecord(value) && parseTemplateId(value.id) !== null && value.version === 1)
  );
}

function validReadiness(
  value: unknown,
  rootEventId: string,
): value is Readiness {
  if (!isRecord(value)) return false;
  const reasons = value.reasons;
  return (
    value.schemaVersion === 1 &&
    value.rootEventId === rootEventId &&
    (value.rootStatus === 'draft' ||
      value.rootStatus === 'published' ||
      value.rootStatus === 'cancelled' ||
      value.rootStatus === 'archived') &&
    typeof value.ready === 'boolean' &&
    Number.isSafeInteger(value.rootVersion) &&
    Number(value.rootVersion) >= 1 &&
    typeof value.rootRevision === 'string' &&
    value.rootRevision.length <= 20 &&
    revisionPattern.test(value.rootRevision) &&
    Array.isArray(reasons) &&
    reasons.length <= 500 &&
    value.ready === (reasons.length === 0) &&
    validCachedTemplate(value.template) &&
    reasons.every(validCachedReason)
  );
}

function validCachedReason(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.code !== 'string' ||
    !readinessCodes.has(value.code) ||
    typeof value.message !== 'string' ||
    value.message.length < 1 ||
    value.message.length > 1_024 ||
    typeof value.path !== 'string' ||
    value.path.length < 1 ||
    value.path.length > 1_024
  ) {
    return false;
  }
  if (value.meta === undefined) return true;
  if (!isRecord(value.meta)) return false;
  return (
    (value.meta.eventId === undefined ||
      (typeof value.meta.eventId === 'string' &&
        eventPattern.test(value.meta.eventId))) &&
    (value.meta.capabilityType === undefined ||
      value.meta.capabilityType === 'travel' ||
      value.meta.capabilityType === 'lodging' ||
      value.meta.capabilityType === 'transport' ||
      value.meta.capabilityType === 'golf' ||
      value.meta.capabilityType === 'team') &&
    (value.meta.capabilityVersion === undefined ||
      (Number.isSafeInteger(value.meta.capabilityVersion) &&
        Number(value.meta.capabilityVersion) >= 0))
  );
}

function templateEventCycles(
  event: Template['events'][number],
  events: Template['events'],
): boolean {
  const byKey = new Map(events.map(item => [item.logicalKey, item]));
  const visited = new Set<string>();
  let current: Template['events'][number] | undefined = event;
  while (current?.parentLogicalKey) {
    if (visited.has(current.logicalKey)) return true;
    visited.add(current.logicalKey);
    current = byKey.get(current.parentLogicalKey);
  }
  return current === undefined;
}

function templateDraftId(
  rootEventId: string,
  templateId: EventSetupTemplateId,
) {
  return `event-template-adopt:${rootEventId}:${templateId}`;
}

function parseTemplateDraft(
  draft: DraftRecord,
  template: EventSetupTemplateChoice,
  rootEventId: string,
): Record<string, string> {
  try {
    const value: unknown = JSON.parse(draft.contentJson);
    if (
      draft.rootEventId !== rootEventId ||
      draft.eventId !== rootEventId ||
      draft.entityType !== 'event.template-adoption' ||
      !isRecord(value) ||
      value.schemaVersion !== 1 ||
      value.templateId !== template.id ||
      value.templateVersion !== template.version ||
      !isRecord(value.eventIds)
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    const eventIds = value.eventIds;
    const expected = [...template.logicalKeys].sort();
    const supplied = Object.keys(eventIds).sort();
    const ids = supplied.map(key => eventIds[key]);
    if (
      expected.length !== supplied.length ||
      expected.some((key, index) => key !== supplied[index]) ||
      ids.some(id => typeof id !== 'string' || !eventPattern.test(id)) ||
      new Set(ids).size !== ids.length ||
      eventIds.root !== rootEventId
    ) {
      throw new EventSetupRecoveryUnavailableError();
    }
    const result: Record<string, string> = {};
    for (const key of supplied) {
      const id = eventIds[key];
      if (typeof id !== 'string') {
        throw new EventSetupRecoveryUnavailableError();
      }
      result[key] = id;
    }
    return result;
  } catch (error) {
    if (error instanceof EventSetupRecoveryUnavailableError) throw error;
    throw new EventSetupRecoveryUnavailableError();
  }
}

function parseTemplateId(value: unknown): EventSetupTemplateId | null {
  return value === 'golf-tour' || value === 'team-event' || value === 'travel'
    ? value
    : null;
}

function mapGatewayError(error: unknown): Error {
  if (
    error instanceof EventSetupRecoveryAccountChangedError ||
    error instanceof EventSetupRecoveryBusyError ||
    error instanceof EventSetupRecoveryConflictError ||
    error instanceof EventSetupRecoveryConnectionError ||
    error instanceof EventSetupRecoveryEnrichmentUnavailableError ||
    error instanceof EventSetupRecoveryManagerRequiredError ||
    error instanceof EventSetupRecoveryOnlineRequiredError ||
    error instanceof EventSetupRecoveryUnavailableError ||
    error instanceof TypeError
  ) {
    return error;
  }
  if (error instanceof GatewayClientError) {
    if (error.code === 'session_changed' || error.code === 'unauthenticated') {
      return new EventSetupRecoveryAccountChangedError();
    }
    if (error.status === 403) return new EventSetupRecoveryManagerRequiredError();
    if (error.status === 404) return new EventSetupRecoveryUnavailableError();
    if (error.status === 409) return new EventSetupRecoveryConflictError();
    if (
      error.status === 503 &&
      (error.operationId === 'placeEnrichmentJobsCreate' ||
        error.operationId === 'placeEnrichmentJobsGet' ||
        error.operationId === 'placeEnrichmentJobsRetry')
    ) {
      return new EventSetupRecoveryEnrichmentUnavailableError();
    }
    if (error.retryable || error.status === null || error.status >= 500) {
      return new EventSetupRecoveryConnectionError();
    }
  }
  return new EventSetupRecoveryUnavailableError();
}

function incrementRevision(value: string): string {
  if (!revisionPattern.test(value)) {
    throw new EventSetupRecoveryUnavailableError();
  }
  const digits = value.split('');
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry; index -= 1) {
    const next = Number(digits[index]) + carry;
    digits[index] = String(next % 10);
    carry = next > 9 ? 1 : 0;
  }
  if (carry) digits.unshift('1');
  return digits.join('');
}
