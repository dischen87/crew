import {
  GatewayClientError,
  type GatewayRequest,
  type GatewaySessionSubject,
} from '@crew/mobile-client';
import type {
  CapabilityRecord,
  DraftRecord,
  EventPlaceRecord,
  EventTreeNode,
  MembershipRecord,
} from '@crew/mobile-data';
import {
  approvedSearchMissCandidate,
  EventSetupRecoveryAccountChangedError,
  EventSetupRecoveryConflictError,
  EventSetupRecoveryEnrichmentUnavailableError,
  EventSetupRecoveryOnlineRequiredError,
  EventSetupRecoveryRuntime,
  EventSetupRecoveryUnavailableError,
  type EventSetupPlaceCandidate,
  type EventSetupRecoveryIntent,
} from '../src/screens/EventSetupRecoveryRuntime';

const mockListEventTree = jest.fn();
const mockListMemberships = jest.fn();
const mockListCapabilities = jest.fn();
const mockListEventPlaces = jest.fn();
const mockListDrafts = jest.fn();
const mockPutDraft = jest.fn();
const mockSha256 = jest.fn(async (value: string) =>
  value.includes('2026-07-20')
    ? 'c'.repeat(64)
    : value.includes('evt_setup_round_two')
    ? 'd'.repeat(64)
    : value.includes('candidate_golf')
    ? 'a'.repeat(64)
    : 'b'.repeat(64),
);
const mockSecureUuid = jest.fn(() => '11111111-1111-4111-8111-111111111111');

jest.mock('@crew/mobile-data', () => ({
  MobileDataStore: class {
    listCapabilities = mockListCapabilities;
    listEventPlaces = mockListEventPlaces;
    listEventTree = mockListEventTree;
    listMemberships = mockListMemberships;
    listDrafts = mockListDrafts;
    putDraft = mockPutDraft;
  },
  sha256Hex: (value: string) => mockSha256(value),
}));

jest.mock('../src/storage/secureRandom', () => ({
  secureUuidV4: () => mockSecureUuid(),
}));

const accountA = `usr_${'a'.repeat(32)}`;
const accountB = `usr_${'b'.repeat(32)}`;
const rootEventId = 'evt_setup_root';
const roundEventId = 'evt_setup_round';
const subject = { userId: accountA } as GatewaySessionSubject;
const capabilityIntent: EventSetupRecoveryIntent = {
  capabilityType: 'golf',
  code: 'EVENT_CAPABILITY_REQUIRED',
  eventId: roundEventId,
  rootEventId,
};
const placeIntent: EventSetupRecoveryIntent = {
  capabilityType: 'golf',
  code: 'EVENT_CAPABILITY_PLACE_REQUIRED',
  eventId: roundEventId,
  rootEventId,
};
const templateIntent: EventSetupRecoveryIntent = {
  code: 'EVENT_TEMPLATE_REQUIRED',
  rootEventId,
};

let activeAccount: string | null;
let cachedReadiness: string | null;
let localCapabilities: CapabilityRecord[];
let localEvents: EventTreeNode[];
let localDrafts: DraftRecord[];
let localMemberships: MembershipRecord[];
let localPlaces: EventPlaceRecord[];

beforeEach(() => {
  jest.clearAllMocks();
  activeAccount = accountA;
  cachedReadiness = JSON.stringify(readiness('12', placeIntent));
  localCapabilities = [localGolfCapability()];
  localDrafts = [];
  localEvents = [localRoot(), localRound()];
  localMemberships = [localMembership()];
  localPlaces = [];
  mockListCapabilities.mockImplementation(async () => localCapabilities);
  mockListDrafts.mockImplementation(async () => localDrafts);
  mockListEventPlaces.mockImplementation(async () => localPlaces);
  mockListEventTree.mockImplementation(async () => localEvents);
  mockListMemberships.mockImplementation(async () => localMemberships);
  mockPutDraft.mockImplementation(async (draft: DraftRecord) => {
    localDrafts = [...localDrafts.filter(item => item.id !== draft.id), draft];
  });
});

test('loads only a live exact-root manager cache and treats corrupted readiness as unknown', async () => {
  cachedReadiness = JSON.stringify({
    ...readiness('12', placeIntent),
    reasons: [null],
  });
  const runtime = makeRuntime({ online: false });
  await expect(runtime.loadCached(placeIntent)).resolves.toMatchObject({
    blockerActive: null,
    role: 'owner',
    source: 'cached',
    target: { eventId: roundEventId, type: 'golf' },
  });

  localEvents = [{ ...localRoot(), deletedAt: '2026-01-01T00:00:00.000Z' }];
  await expect(runtime.loadCached(placeIntent)).rejects.toBeInstanceOf(
    EventSetupRecoveryUnavailableError,
  );

  localEvents = [localRoot(), localRound()];
  localCapabilities = [
    { ...localGolfCapability(), rootEventId: 'evt_other_root' },
  ];
  await expect(runtime.loadCached(placeIntent)).resolves.toMatchObject({
    target: { capability: null },
  });

  localMemberships = [{ ...localMembership(), role: 'participant' }];
  await expect(runtime.loadCached(placeIntent)).rejects.toThrow(
    'requires an owner or organizer',
  );
});

test('rejects decoded deep-link metadata outside the exact setup contract', async () => {
  const runtime = makeRuntime({ online: false });
  await expect(
    runtime.loadCached({
      ...placeIntent,
      capabilityType: 'concert' as EventSetupRecoveryIntent['capabilityType'],
    }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  await expect(
    runtime.loadCached({
      ...placeIntent,
      eventId: 'evt_round/other',
    }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  await expect(
    runtime.loadCached({
      ...templateIntent,
      eventId: roundEventId,
    }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
});

test('restores the exact template capability with baseVersion zero and refetches readiness', async () => {
  let restored = false;
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventCapabilitiesReplace') {
      expect(options).toMatchObject({
        body: {
          baseVersion: 0,
          capability: {
            config: {
              coursePlaceId: null,
              handicapMode: 'optional',
              roundState: 'planned',
              scoringMode: 'stableford',
              teeFormat: 'individual',
            },
            schemaVersion: 1,
            type: 'golf',
          },
        },
        path: {
          capabilityType: 'golf',
          eventId: roundEventId,
          rootEventId,
        },
      });
      restored = true;
      return response({ capability: remoteGolfCapability(1) });
    }
    return onlineResponse(operationId, {
      blocker: restored ? null : capabilityIntent,
      capabilities: restored ? [remoteGolfCapability(1)] : [],
      revision: restored ? '13' : '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });

  await expect(
    runtime.restoreCapability(capabilityIntent),
  ).resolves.toMatchObject({
    blockerActive: false,
    source: 'online',
  });
  expect(requestAsUser).toHaveBeenCalledWith(
    subject,
    'eventCapabilitiesReplace',
    expect.objectContaining({
      headers: {
        'idempotency-key': expect.stringMatching(/^capability-[a-f0-9]{48}$/),
      },
    }),
  );
});

test('restores a tombstoned server-targeted capability from its authoritative readiness version', async () => {
  const rootCapabilityIntent: EventSetupRecoveryIntent = {
    capabilityType: 'travel',
    code: 'EVENT_CAPABILITY_REQUIRED',
    eventId: rootEventId,
    rootEventId,
  };
  let restored = false;
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventCapabilitiesReplace') {
      expect(options).toMatchObject({
        body: { baseVersion: 2, capability: travelInput(null) },
        path: {
          capabilityType: 'travel',
          eventId: rootEventId,
          rootEventId,
        },
      });
      restored = true;
      return response({ capability: remoteTravelCapability(3) });
    }
    return onlineResponse(operationId, {
      blocker: restored ? null : rootCapabilityIntent,
      capabilities: restored ? [remoteTravelCapability(3)] : [],
      capabilityVersion: restored ? undefined : 2,
      revision: restored ? '13' : '12',
    });
  });

  await expect(
    makeRuntime({ requestAsUser }).restoreCapability(rootCapabilityIntent),
  ).resolves.toMatchObject({ blockerActive: false, source: 'online' });
});

test('replays the same place identity after capability conflict and finishes safely after restart', async () => {
  let revision = 12;
  let placeCreated = false;
  let capabilityBound = false;
  let capabilityAttempts = 0;
  const placeRequests: Array<{ body: { id: string }; headers: object }> = [];
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventPlacesCreate') {
      placeRequests.push(options);
      placeCreated = true;
      revision = 13;
      return response({
        place: remotePlace(options.body.id, options.body.name),
      });
    }
    if (operationId === 'eventCapabilitiesReplace') {
      capabilityAttempts += 1;
      if (capabilityAttempts === 1) throw conflict(operationId);
      capabilityBound = true;
      revision = 14;
      return response({
        capability: remoteGolfCapability(4, `plc_${'a'.repeat(40)}`),
      });
    }
    return onlineResponse(operationId, {
      blocker: capabilityBound ? null : placeIntent,
      capabilities: [
        remoteGolfCapability(
          capabilityBound ? 4 : 3,
          capabilityBound ? `plc_${'a'.repeat(40)}` : null,
        ),
      ],
      places: placeCreated
        ? [remotePlace(`plc_${'a'.repeat(40)}`, 'Alpine Golf Club')]
        : [],
      revision: String(revision),
    });
  });

  await expect(
    makeRuntime({ requestAsUser }).bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  await expect(
    makeRuntime({ requestAsUser }).bindPrimaryPlace(placeIntent, candidate()),
  ).resolves.toMatchObject({ blockerActive: false, rootRevision: '14' });

  expect(placeRequests).toHaveLength(2);
  expect(placeRequests[0]?.body.id).toBe(`plc_${'a'.repeat(40)}`);
  expect(placeRequests[1]?.body.id).toBe(placeRequests[0]?.body.id);
  expect(placeRequests[1]?.headers).toEqual(placeRequests[0]?.headers);
});

test('reuses manager-gated search and deterministic place creation outside setup recovery', async () => {
  const venue = {
    ...candidate(),
    id: 'candidate_venue',
    kind: 'venue' as const,
    name: 'Kongresshaus Zürich',
  };
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placesSearch') {
      return response({
        items: [venue],
        pageInfo: { hasMore: false, nextCursor: null },
      });
    }
    if (operationId === 'eventPlacesCreate') {
      return response({
        place: remotePlace(options.body.id, options.body.name),
      });
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });

  await expect(
    runtime.searchEventPlaces(rootEventId, 'venue', '  Zürich  '),
  ).resolves.toEqual([venue]);
  await expect(
    runtime.createEventPlace(rootEventId, venue),
  ).resolves.toMatchObject({
    id: `plc_${'b'.repeat(40)}`,
    name: 'Kongresshaus Zürich',
    rootEventId,
  });

  expect(requestAsUser).toHaveBeenCalledWith(subject, 'placesSearch', {
    query: { kind: 'venue', limit: 20, q: 'Zürich' },
  });
  expect(requestAsUser).toHaveBeenCalledWith(
    subject,
    'eventPlacesCreate',
    expect.objectContaining({
      body: expect.objectContaining({
        id: `plc_${'b'.repeat(40)}`,
        name: 'Kongresshaus Zürich',
      }),
      headers: { 'idempotency-key': `place-${'b'.repeat(48)}` },
      path: { rootEventId },
    }),
  );
});

test('uses one stable enrichment command and accepts pending facts before confirmed details', async () => {
  const createRequests: Array<GatewayRequest<'placeEnrichmentJobsCreate'>> = [];
  const getRequests: Array<GatewayRequest<'placeEnrichmentJobsGet'>> = [];
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placeEnrichmentJobsCreate') {
      createRequests.push(options);
      return response(enrichmentProjection('pending', null));
    }
    if (operationId === 'placeEnrichmentJobsGet') {
      getRequests.push(options);
      return response(enrichmentProjection('succeeded', enrichedPlace()));
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });

  const first = await runtime.createPlaceEnrichment(placeIntent, candidate());
  await runtime.createPlaceEnrichment(placeIntent, candidate());
  await runtime.createPlaceEnrichment(placeIntent, {
    ...candidate(),
    retrievedAt: '2026-07-20T08:00:00.000Z',
    version: 2,
  });
  expect(first).toMatchObject({
    enrichment: { pollAfterSeconds: 2, status: 'pending' },
    place: null,
  });
  expect(createRequests).toHaveLength(3);
  expect(createRequests[0]?.body).toEqual({
    rootEventId,
    eventId: roundEventId,
    capabilityType: 'golf',
    candidateId: candidate().id,
    target: 'candidate',
  });
  expect(createRequests[1]?.headers).toEqual(createRequests[0]?.headers);
  expect(createRequests[2]?.headers).not.toEqual(createRequests[0]?.headers);
  expect(mockSha256).toHaveBeenCalledWith(
    JSON.stringify([
      accountA,
      rootEventId,
      roundEventId,
      'golf',
      candidate().id,
      candidate().version,
      candidate().retrievedAt,
    ]),
  );
  await expect(
    runtime.getPlaceEnrichment(placeIntent, candidate(), first.enrichment.id),
  ).resolves.toMatchObject({
    enrichment: { pollAfterSeconds: null, status: 'succeeded' },
    place: { name: 'Alpine Golf Club' },
  });
  expect(getRequests[0]?.query).toEqual({ rootEventId });
});

test('suggests a country only when every same-root place agrees', async () => {
  localPlaces = [localPlace('plc_one', 'CH'), localPlace('plc_two', 'CH')];
  const runtime = makeRuntime({ online: false });
  await expect(runtime.loadCached(placeIntent)).resolves.toMatchObject({
    suggestedCountryCode: 'CH',
  });

  localPlaces = [...localPlaces, localPlace('plc_three', 'DE')];
  await expect(runtime.loadCached(placeIntent)).resolves.toMatchObject({
    suggestedCountryCode: null,
  });

  const requestAsUser = jest.fn(async (_subject, operationId) =>
    onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      places: [
        remotePlace('plc_one', 'Swiss course'),
        { ...remotePlace('plc_two', 'German course'), countryCode: 'DE' },
      ],
      revision: '12',
    }),
  );
  await expect(
    makeRuntime({ requestAsUser }).refresh(placeIntent),
  ).resolves.toMatchObject({ suggestedCountryCode: null });
});

test('creates one caller-stable search miss, validates cited review and approves idempotently', async () => {
  const createRequests: Array<GatewayRequest<'placeEnrichmentJobsCreate'>> = [];
  const reviewRequests: Array<GatewayRequest<'placeEnrichmentJobsReview'>> = [];
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placeEnrichmentJobsCreate') {
      createRequests.push(options);
      return response(searchMissProjection('pending'));
    }
    if (operationId === 'placeEnrichmentJobsGet') {
      return response(searchMissProjection('succeeded', 'pending'));
    }
    if (operationId === 'placeEnrichmentJobsReview') {
      reviewRequests.push(options);
      return response(searchMissProjection('succeeded', 'approved'));
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });

  const first = await runtime.createSearchMissEnrichment(
    placeIntent,
    '  Ocean Dunes  ',
    'ch',
  );
  await runtime.createSearchMissEnrichment(placeIntent, 'Ocean Dunes', 'CH');
  expect(first).toMatchObject({
    enrichment: { pollAfterSeconds: 2, status: 'pending' },
    place: null,
    review: null,
  });
  expect(createRequests).toHaveLength(2);
  expect(createRequests[0]?.body).toEqual({
    capabilityType: 'golf',
    countryCode: 'CH',
    eventId: roundEventId,
    kind: 'golf_course',
    query: 'Ocean Dunes',
    rootEventId,
    target: 'search_miss',
  });
  expect(createRequests[1]?.headers).toEqual(createRequests[0]?.headers);

  const reviewable = await runtime.getSearchMissEnrichment(
    placeIntent,
    first.enrichment.id,
  );
  expect(reviewable).toMatchObject({
    enrichment: { status: 'succeeded' },
    review: {
      fields: expect.arrayContaining([
        expect.objectContaining({
          name: 'name',
          provenance: expect.objectContaining({
            sourceKind: 'exa_llm',
            sourceUrl: 'https://example.com/ocean-dunes',
          }),
          value: 'Ocean Dunes Golf Club',
        }),
      ]),
      state: 'pending',
    },
  });

  const approved = await runtime.reviewSearchMissEnrichment(
    placeIntent,
    reviewable,
    'approve',
  );
  await runtime.reviewSearchMissEnrichment(placeIntent, reviewable, 'approve');
  expect(reviewRequests).toHaveLength(2);
  expect(reviewRequests[0]).toMatchObject({
    body: {
      capabilityType: 'golf',
      decision: 'approve',
      eventId: roundEventId,
      rootEventId,
    },
    path: { jobId: first.enrichment.id },
  });
  expect(reviewRequests[1]?.headers).toEqual(reviewRequests[0]?.headers);
  expect(approvedSearchMissCandidate(approved)).toMatchObject({
    countryCode: 'CH',
    id: `gpl_${'d'.repeat(64)}`,
    kind: 'golf_course',
    name: 'Ocean Dunes Golf Club',
    sourceRecordUrl: 'https://example.com/ocean-dunes',
  });
});

test('rejects one-character place queries before any Gateway request', async () => {
  const requestAsUser = jest.fn();
  const runtime = makeRuntime({ requestAsUser });

  await expect(runtime.searchPlaces(placeIntent, ' A ')).rejects.toThrow(
    '2 to 120 characters',
  );
  await expect(
    runtime.createSearchMissEnrichment(placeIntent, ' A ', 'CH'),
  ).rejects.toThrow('2 to 120 characters');
  expect(requestAsUser).not.toHaveBeenCalled();
});

test('scopes review idempotency to event and capability for one shared job', async () => {
  const secondRoundEventId = 'evt_setup_round_two';
  const secondIntent: EventSetupRecoveryIntent = {
    ...placeIntent,
    eventId: secondRoundEventId,
  };
  const requests: Array<GatewayRequest<'placeEnrichmentJobsReview'>> = [];
  let activeIntent = placeIntent;
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placeEnrichmentJobsReview') {
      requests.push(options);
      return response(searchMissProjection('succeeded', 'approved'));
    }
    return onlineResponse(operationId, {
      blocker: activeIntent,
      capabilities: [
        remoteGolfCapability(3),
        remoteGolfCapability(1, null, secondRoundEventId),
      ],
      events: [
        remoteRoot(),
        remoteRound(),
        remoteEvent(secondRoundEventId, rootEventId, 'golf', 'Second round', 1),
      ],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });
  const pending = searchMissProjection('succeeded', 'pending');

  await runtime.reviewSearchMissEnrichment(placeIntent, pending, 'approve');
  activeIntent = secondIntent;
  await runtime.reviewSearchMissEnrichment(secondIntent, pending, 'approve');

  expect(requests).toHaveLength(2);
  expect(requests[0]?.body.eventId).toBe(roundEventId);
  expect(requests[1]?.body.eventId).toBe(secondRoundEventId);
  expect(requests[0]?.headers).not.toEqual(requests[1]?.headers);
  expect(mockSha256).toHaveBeenCalledWith(
    JSON.stringify([
      accountA,
      rootEventId,
      roundEventId,
      'golf',
      pending.enrichment.id,
      'approve',
    ]),
  );
  expect(mockSha256).toHaveBeenCalledWith(
    JSON.stringify([
      accountA,
      rootEventId,
      secondRoundEventId,
      'golf',
      pending.enrichment.id,
      'approve',
    ]),
  );
});

test('rejects a worldwide suggestion without creating or binding anything and conceals unsafe citations', async () => {
  const pending = searchMissProjection('succeeded', 'pending');
  const requestAsUser = jest.fn(async (_subject, operationId) => {
    if (operationId === 'placeEnrichmentJobsReview') {
      return response(searchMissProjection('succeeded', 'rejected'));
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });
  await expect(
    runtime.reviewSearchMissEnrichment(placeIntent, pending, 'reject'),
  ).resolves.toMatchObject({
    place: null,
    review: { state: 'rejected' },
  });
  expect(
    requestAsUser.mock.calls.some(call =>
      ['eventPlacesCreate', 'eventCapabilitiesReplace'].includes(call[1]),
    ),
  ).toBe(false);

  await expect(
    runtime.reviewSearchMissEnrichment(
      placeIntent,
      {
        ...pending,
        review: {
          ...pending.review!,
          fields: [
            {
              ...pending.review!.fields[0]!,
              provenance: {
                ...pending.review!.fields[0]!.provenance,
                sourceUrl: 'ftp://unsafe.example/review',
              },
            },
          ],
        },
      },
      'approve',
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryEnrichmentUnavailableError);
});

test('retries only an explicitly retryable enrichment with one stable command identity', async () => {
  const retryRequests: Array<GatewayRequest<'placeEnrichmentJobsRetry'>> = [];
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placeEnrichmentJobsRetry') {
      retryRequests.push(options);
      return response(enrichmentProjection('pending', null));
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });
  const retryable = enrichmentProjection('retry', null);

  await runtime.retryPlaceEnrichment(placeIntent, candidate(), retryable);
  await runtime.retryPlaceEnrichment(placeIntent, candidate(), retryable);
  await runtime.retryPlaceEnrichment(placeIntent, candidate(), {
    ...retryable,
    enrichment: {
      ...retryable.enrichment,
      updatedAt: '2026-07-20T20:01:00.000Z',
    },
  });
  expect(retryRequests).toHaveLength(3);
  expect(retryRequests[1]?.headers).toEqual(retryRequests[0]?.headers);
  expect(retryRequests[2]?.headers).not.toEqual(retryRequests[0]?.headers);
  expect(retryRequests[0]?.query).toEqual({ rootEventId });
  await expect(
    runtime.retryPlaceEnrichment(
      placeIntent,
      candidate(),
      enrichmentProjection('pending', null),
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
});

test('keeps candidate binding available when enrichment capacity is exhausted', async () => {
  let placeCreated = false;
  let capabilityBound = false;
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'placeEnrichmentJobsCreate') {
      throw enrichmentCapacity(operationId);
    }
    if (operationId === 'eventPlacesCreate') {
      placeCreated = true;
      return response({
        place: remotePlace(options.body.id, options.body.name),
      });
    }
    if (operationId === 'eventCapabilitiesReplace') {
      capabilityBound = true;
      return response({
        capability: remoteGolfCapability(
          4,
          options.body.capability.config.coursePlaceId,
        ),
      });
    }
    return onlineResponse(operationId, {
      blocker: capabilityBound ? null : placeIntent,
      capabilities: [
        remoteGolfCapability(
          capabilityBound ? 4 : 3,
          capabilityBound ? `plc_${'a'.repeat(40)}` : null,
        ),
      ],
      places: placeCreated
        ? [remotePlace(`plc_${'a'.repeat(40)}`, candidate().name)]
        : [],
      revision: capabilityBound ? '14' : '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });

  await expect(
    runtime.createPlaceEnrichment(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryEnrichmentUnavailableError);
  await expect(
    runtime.bindPrimaryPlace(placeIntent, candidate()),
  ).resolves.toMatchObject({ blockerActive: false });
});

test('persists caller-stable template child IDs and command identity across a conflict and restart', async () => {
  const adoptedRoundId = 'evt_11111111-1111-4111-8111-111111111111';
  let adopted = false;
  let attempts = 0;
  let revision = '12';
  const adoptionRequests: Array<{
    body: GatewayRequest<'eventTemplateAdopt'>['body'];
    headers: object;
  }> = [];
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventTemplateAdopt') {
      adoptionRequests.push(options);
      attempts += 1;
      if (attempts === 1) throw conflict(operationId);
      adopted = true;
      revision = '13';
      return response({
        event: { ...remoteRoot(), version: 8 },
        rootRevision: revision,
        template: { id: 'golf-tour', version: 1 },
      });
    }
    return onlineResponse(operationId, {
      blocker: adopted ? null : templateIntent,
      capabilities: adopted
        ? [
            remoteTravelCapability(1),
            remoteGolfCapability(1, null, adoptedRoundId),
          ]
        : [],
      events: adopted
        ? [
            remoteEvent(rootEventId, null, 'trip', 'Golf Weekend', 8),
            remoteEvent(adoptedRoundId, rootEventId, 'golf', 'First round', 1),
            remoteEvent(
              'evt_unrelated_content',
              rootEventId,
              'trip',
              'Preserved custom event',
              4,
            ),
          ]
        : undefined,
      revision,
      rootVersion: adopted ? 8 : 7,
    });
  });

  await expect(
    makeRuntime({ requestAsUser }).adoptTemplate(templateIntent, 'golf-tour'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  expect(localDrafts).toHaveLength(1);
  expect(mockSecureUuid).toHaveBeenCalledTimes(1);

  await expect(
    makeRuntime({ requestAsUser }).adoptTemplate(templateIntent, 'golf-tour'),
  ).resolves.toMatchObject({
    blockerActive: false,
    template: 'golf-tour',
  });
  expect(adoptionRequests).toHaveLength(2);
  expect(adoptionRequests[1]?.body).toEqual(adoptionRequests[0]?.body);
  expect(adoptionRequests[1]?.headers).toEqual(adoptionRequests[0]?.headers);
  expect(adoptionRequests[0]?.body.template.eventIds).toEqual({
    root: rootEventId,
    round: adoptedRoundId,
  });
  expect(mockSecureUuid).toHaveBeenCalledTimes(1);
  expect(localDrafts).toEqual([]);
});

test('keeps the template draft when adoption confirmation is not the exact next version and revision', async () => {
  const requestAsUser = jest.fn(async (_subject, operationId) => {
    if (operationId === 'eventTemplateAdopt') {
      return response({
        event: { ...remoteRoot(), version: 8 },
        rootRevision: '14',
        template: { id: 'golf-tour', version: 1 },
      });
    }
    return onlineResponse(operationId, {
      blocker: templateIntent,
      capabilities: [],
      revision: '12',
    });
  });

  await expect(
    makeRuntime({ requestAsUser }).adoptTemplate(templateIntent, 'golf-tour'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  expect(localDrafts).toHaveLength(1);
});

test('keeps the template draft when the refreshed adopted tree violates any blueprint invariant', async () => {
  const adoptedRoundId = 'evt_11111111-1111-4111-8111-111111111111';
  for (const defect of ['id', 'parent', 'kind', 'capability'] as const) {
    localDrafts = [];
    let adopted = false;
    const requestAsUser = jest.fn(async (_subject, operationId) => {
      if (operationId === 'eventTemplateAdopt') {
        adopted = true;
        return response({
          event: { ...remoteRoot(), version: 8 },
          rootRevision: '13',
          template: { id: 'golf-tour', version: 1 },
        });
      }
      let child = remoteEvent(
        adoptedRoundId,
        rootEventId,
        'golf',
        'First round',
        1,
      );
      let golf = remoteGolfCapability(1, null, adoptedRoundId);
      if (defect === 'id') child = { ...child, id: 'evt_wrong_child' };
      if (defect === 'parent') child = { ...child, parentEventId: null };
      if (defect === 'kind') child = { ...child, kind: 'trip' };
      if (defect === 'capability') {
        golf = {
          ...golf,
          config: { ...golf.config, scoringMode: 'none' },
        };
      }
      return onlineResponse(operationId, {
        blocker: adopted ? null : templateIntent,
        capabilities: adopted ? [remoteTravelCapability(1), golf] : [],
        events: adopted
          ? [remoteEvent(rootEventId, null, 'trip', 'Golf Weekend', 8), child]
          : undefined,
        revision: adopted ? '13' : '12',
        rootVersion: adopted ? 8 : 7,
      });
    });

    await expect(
      makeRuntime({ requestAsUser }).adoptTemplate(templateIntent, 'golf-tour'),
    ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
    expect(localDrafts).toHaveLength(1);
  }
});

test('fails closed when account changes after any authoritative refresh boundary', async () => {
  for (let boundary = 1; boundary <= 5; boundary += 1) {
    activeAccount = accountA;
    let calls = 0;
    const requestAsUser = jest.fn(async (_subject, operationId) => {
      calls += 1;
      const result = onlineResponse(operationId, {
        blocker: placeIntent,
        capabilities: [remoteGolfCapability(3)],
        revision: '12',
      });
      if (calls === boundary) activeAccount = accountB;
      return result;
    });
    await expect(
      makeRuntime({ requestAsUser }).refresh(placeIntent),
    ).rejects.toBeInstanceOf(EventSetupRecoveryAccountChangedError);
    expect(
      requestAsUser.mock.calls.some(
        call =>
          call[1] === 'eventPlacesCreate' ||
          call[1] === 'eventCapabilitiesReplace',
      ),
    ).toBe(false);
  }
});

test('stops between place creation and capability write after an account switch', async () => {
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventPlacesCreate') {
      activeAccount = accountB;
      return response({
        place: remotePlace(options.body.id, options.body.name),
      });
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  await expect(
    makeRuntime({ requestAsUser }).bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryAccountChangedError);
  expect(
    requestAsUser.mock.calls.filter(
      call => call[1] === 'eventCapabilitiesReplace',
    ),
  ).toHaveLength(0);
});

test('rejects a session switch, two stale tree/readiness pairs, and cross-root data', async () => {
  const sessionFailure = jest.fn(async (_subject, operationId) => {
    throw new GatewayClientError({
      code: 'session_changed',
      operationId,
      requestId: 'req_session',
      retryAfterSeconds: null,
      retryable: false,
      status: null,
    });
  });
  await expect(
    makeRuntime({ requestAsUser: sessionFailure }).refresh(placeIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryAccountChangedError);

  let treeCalls = 0;
  const stale = jest.fn(async (_subject, operationId) => {
    if (operationId === 'eventsTreeGet') treeCalls += 1;
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      readinessRevision: String(20 + treeCalls),
      revision: String(10 + treeCalls),
    });
  });
  await expect(
    makeRuntime({ requestAsUser: stale }).refresh(placeIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  expect(
    stale.mock.calls.filter(call => call[1] === 'eventsTreeGet'),
  ).toHaveLength(2);

  const crossRoot = jest.fn(async (_subject, operationId) => {
    const result = onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
    if (operationId === 'eventsTreeGet') {
      result.data.events[1].rootEventId = 'evt_other_root';
    }
    return result;
  });
  await expect(
    makeRuntime({ requestAsUser: crossRoot }).refresh(placeIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);

  const crossRootPlace = jest.fn(async (_subject, operationId) => {
    const result = onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      places: [remotePlace('plc_cross_root', 'Wrong root')],
      revision: '12',
    });
    if (operationId === 'eventPlacesList') {
      result.data.items[0].rootEventId = 'evt_other_root';
    }
    return result;
  });
  await expect(
    makeRuntime({ requestAsUser: crossRootPlace }).refresh(placeIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
});

test('rejects malformed authoritative readiness and non-exact capability confirmation', async () => {
  const malformedReadiness = jest.fn(async (_subject, operationId) => {
    const result = onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
    if (operationId === 'eventPublishReadinessGet') {
      result.data.ready = true;
    }
    return result;
  });
  await expect(
    makeRuntime({ requestAsUser: malformedReadiness }).refresh(placeIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);

  const wrongConfirmation = jest.fn(async (_subject, operationId) => {
    if (operationId === 'eventCapabilitiesReplace') {
      return response({ capability: remoteGolfCapability(2) });
    }
    return onlineResponse(operationId, {
      blocker: capabilityIntent,
      capabilities: [],
      revision: '12',
    });
  });
  await expect(
    makeRuntime({ requestAsUser: wrongConfirmation }).restoreCapability(
      capabilityIntent,
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
});

test('rejects malformed place confirmation and invalid candidates before capability write', async () => {
  const requestAsUser = jest.fn(async (_subject, operationId, options) => {
    if (operationId === 'eventPlacesCreate') {
      return response({
        place: remotePlace('plc_wrong_confirmation', options.body.name),
      });
    }
    return onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    });
  });
  const runtime = makeRuntime({ requestAsUser });
  await expect(
    runtime.bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  expect(
    requestAsUser.mock.calls.filter(
      call => call[1] === 'eventCapabilitiesReplace',
    ),
  ).toHaveLength(0);

  await expect(
    runtime.bindPrimaryPlace(placeIntent, { ...candidate(), latitude: 91 }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  await expect(
    runtime.createPlaceEnrichment(placeIntent, {
      ...candidate(),
      retrievedAt: 'not-a-timestamp',
    }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
  await expect(
    runtime.createPlaceEnrichment(placeIntent, {
      ...candidate(),
      version: 0,
    }),
  ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);

  for (const malformed of [
    { locality: 'Bern' },
    { latitude: 46.95 },
    { longitude: 7.45 },
    { version: 2 },
  ]) {
    const malformedRequest = jest.fn(async (_subject, operationId, options) => {
      if (operationId === 'eventPlacesCreate') {
        return response({
          place: {
            ...remotePlace(options.body.id, options.body.name),
            ...malformed,
          },
        });
      }
      return onlineResponse(operationId, {
        blocker: placeIntent,
        capabilities: [remoteGolfCapability(3)],
        revision: '12',
      });
    });
    await expect(
      makeRuntime({ requestAsUser: malformedRequest }).bindPrimaryPlace(
        placeIntent,
        candidate(),
      ),
    ).rejects.toBeInstanceOf(EventSetupRecoveryUnavailableError);
    expect(
      malformedRequest.mock.calls.filter(
        call => call[1] === 'eventCapabilitiesReplace',
      ),
    ).toHaveLength(0);
  }
});

test('does not create another place when the blocker capability already has a primary place', async () => {
  const requestAsUser = jest.fn(async (_subject, operationId) =>
    onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3, 'plc_existing_course')],
      places: [remotePlace('plc_existing_course', 'Existing course')],
      revision: '12',
    }),
  );

  await expect(
    makeRuntime({ requestAsUser }).bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  expect(
    requestAsUser.mock.calls.filter(
      call =>
        call[1] === 'eventPlacesCreate' ||
        call[1] === 'eventCapabilitiesReplace',
    ),
  ).toHaveLength(0);
});

test('treats another client resolving template, capability or place as conflict without deleting the draft', async () => {
  localDrafts = [templateDraftRecord()];
  const requestAsUser = jest.fn(async (_subject, operationId) =>
    onlineResponse(operationId, {
      blocker: null,
      capabilities: [remoteGolfCapability(3, 'plc_existing_course')],
      places: [remotePlace('plc_existing_course', 'Existing course')],
      revision: '12',
    }),
  );
  const runtime = makeRuntime({ requestAsUser });

  await expect(
    runtime.restoreCapability(capabilityIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  await expect(
    runtime.searchPlaces(placeIntent, 'Existing course'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  await expect(
    runtime.bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  await expect(
    runtime.adoptTemplate(templateIntent, 'golf-tour'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryConflictError);
  expect(localDrafts).toEqual([templateDraftRecord()]);
  expect(
    requestAsUser.mock.calls.filter(call =>
      [
        'eventCapabilitiesReplace',
        'eventPlacesCreate',
        'eventTemplateAdopt',
        'placesSearch',
      ].includes(call[1]),
    ),
  ).toHaveLength(0);
});

test('never searches, creates, replaces or queues while offline', async () => {
  const requestAsUser = jest.fn();
  const runtime = makeRuntime({ online: false, requestAsUser });
  await expect(
    runtime.searchPlaces(placeIntent, 'Golf'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.createPlaceEnrichment(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.createSearchMissEnrichment(placeIntent, 'Ocean Dunes', 'CH'),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.getPlaceEnrichment(
      placeIntent,
      candidate(),
      `pej_${'b'.repeat(64)}`,
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.retryPlaceEnrichment(
      placeIntent,
      candidate(),
      enrichmentProjection('retry', null),
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.getSearchMissEnrichment(placeIntent, `pej_${'d'.repeat(64)}`),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.retrySearchMissEnrichment(
      placeIntent,
      searchMissProjection('retry'),
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.reviewSearchMissEnrichment(
      placeIntent,
      searchMissProjection('succeeded', 'pending'),
      'approve',
    ),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.restoreCapability(capabilityIntent),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  await expect(
    runtime.bindPrimaryPlace(placeIntent, candidate()),
  ).rejects.toBeInstanceOf(EventSetupRecoveryOnlineRequiredError);
  expect(requestAsUser).not.toHaveBeenCalled();
});

function makeRuntime({
  online = true,
  requestAsUser = jest.fn(async (_subject, operationId) =>
    onlineResponse(operationId, {
      blocker: placeIntent,
      capabilities: [remoteGolfCapability(3)],
      revision: '12',
    }),
  ),
}: {
  online?: boolean;
  requestAsUser?: jest.Mock;
} = {}) {
  const database = {
    first: jest.fn(async () =>
      cachedReadiness
        ? {
            refreshed_at: '2026-07-19T10:00:00.000Z',
            snapshot_json: cachedReadiness,
          }
        : null,
    ),
    run: jest.fn(async (_sql: string, values: readonly unknown[]) => {
      const id = values[2];
      localDrafts = localDrafts.filter(item => item.id !== id);
    }),
  };
  return new EventSetupRecoveryRuntime({
    accountUserId: accountA,
    activeAccountUserId: () => activeAccount,
    client: {
      assertSessionSubject: jest.fn(async () => undefined),
      request: jest.fn(),
      requestAsUser,
      sessionSubject: jest.fn(async () => subject),
    },
    database: database as never,
    isOnline: () => online,
    now: () => new Date('2026-07-19T12:00:00.000Z'),
  });
}

function onlineResponse(
  operationId: string,
  options: {
    blocker: EventSetupRecoveryIntent | null;
    capabilities: Array<
      | ReturnType<typeof remoteGolfCapability>
      | ReturnType<typeof remoteTravelCapability>
    >;
    events?: ReturnType<typeof remoteEvent>[];
    places?: ReturnType<typeof remotePlace>[];
    readinessRevision?: string;
    revision: string;
    rootVersion?: number;
    templates?: ReturnType<typeof templates>;
    capabilityVersion?: number;
  },
) {
  if (operationId === 'eventTemplatesList') {
    return response({ templates: options.templates ?? templates() });
  }
  if (operationId === 'eventMembershipsList') {
    return response({
      items: [remoteMembership()],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }
  if (operationId === 'eventsTreeGet') {
    return response({
      capabilities: options.capabilities,
      events: options.events ?? [remoteRoot(), remoteRound()],
      rootEventId,
      rootRevision: options.revision,
    });
  }
  if (operationId === 'eventPublishReadinessGet') {
    return response(
      readiness(
        options.readinessRevision ?? options.revision,
        options.blocker,
        options.rootVersion,
        options.capabilityVersion,
      ),
    );
  }
  if (operationId === 'eventPlacesList') {
    return response({
      items: options.places ?? [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }
  if (operationId === 'placesSearch') {
    return response({
      items: [candidate()],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }
  throw new Error(`Unexpected operation ${operationId}`);
}

function response(data: any) {
  return { data, requestId: 'req_setup', status: 200 };
}

function conflict(operationId: string) {
  return new GatewayClientError({
    code: 'VERSION_CONFLICT',
    operationId: operationId as 'eventCapabilitiesReplace',
    requestId: 'req_conflict',
    retryAfterSeconds: null,
    retryable: false,
    status: 409,
  });
}

function enrichmentCapacity(operationId: string) {
  return new GatewayClientError({
    code: 'PLACE_ENRICHMENT_CAPACITY',
    operationId: operationId as 'placeEnrichmentJobsCreate',
    requestId: 'req_enrichment_unavailable',
    retryAfterSeconds: 60,
    retryable: true,
    status: 409,
  });
}

function readiness(
  revision: string,
  blocker: EventSetupRecoveryIntent | null,
  rootVersion = 7,
  capabilityVersion?: number,
) {
  return {
    ready: blocker === null,
    reasons: blocker
      ? [
          {
            code: blocker.code,
            message: 'Setup blocker',
            meta:
              blocker.code === 'EVENT_TEMPLATE_REQUIRED'
                ? undefined
                : {
                    capabilityType: blocker.capabilityType,
                    eventId: blocker.eventId,
                    ...(capabilityVersion === undefined
                      ? {}
                      : { capabilityVersion }),
                  },
            path: 'setup',
          },
        ]
      : [],
    rootEventId,
    rootRevision: revision,
    rootStatus: 'draft',
    rootVersion,
    schemaVersion: 1,
    template:
      blocker?.code === 'EVENT_TEMPLATE_REQUIRED'
        ? null
        : { id: 'golf-tour', version: 1 },
  };
}

function templates() {
  return [
    {
      events: [
        {
          capabilities: [travelInput(null)],
          kind: 'trip',
          logicalKey: 'root',
          parentLogicalKey: null,
          title: 'Golf tour',
        },
        {
          capabilities: [golfInput(null)],
          kind: 'golf',
          logicalKey: 'round',
          parentLogicalKey: 'root',
          title: 'Golf round',
        },
      ],
      id: 'golf-tour',
      summary: 'Golf trip',
      title: 'Golf tour',
      version: 1,
    },
  ];
}

function golfInput(coursePlaceId: string | null) {
  return {
    config: {
      coursePlaceId,
      handicapMode: 'optional',
      roundState: 'planned',
      scoringMode: 'stableford',
      teeFormat: 'individual',
    },
    schemaVersion: 1,
    type: 'golf',
  };
}

function remoteGolfCapability(
  version: number,
  placeId: string | null = null,
  eventId = roundEventId,
) {
  return {
    ...golfInput(placeId),
    createdAt: '2026-07-19T08:00:00.000Z',
    eventId,
    rootEventId,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version,
  };
}

function travelInput(homePlaceId: string | null) {
  return {
    config: {
      homePlaceId,
      travelerReferenceLabel: 'Travel reference',
    },
    schemaVersion: 1,
    type: 'travel',
  };
}

function remoteTravelCapability(version: number) {
  return {
    ...travelInput(null),
    createdAt: '2026-07-19T08:00:00.000Z',
    eventId: rootEventId,
    rootEventId,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version,
  };
}

function remoteRoot() {
  return remoteEvent(rootEventId, null, 'trip', 'Golf Weekend');
}

function remoteRound() {
  return remoteEvent(roundEventId, rootEventId, 'golf', 'First round');
}

function remoteEvent(
  id: string,
  parentEventId: string | null,
  kind: 'golf' | 'trip',
  title: string,
  version = id === rootEventId ? 7 : 2,
) {
  return {
    childOrderVersion: 1,
    createdAt: '2026-07-19T08:00:00.000Z',
    description: 'Description',
    endsAt: '2026-09-21T18:00:00.000Z',
    id,
    itineraryOrderVersion: 1,
    kind,
    parentEventId,
    rootEventId,
    sortKey: id === rootEventId ? 'a' : 'b',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version,
  };
}

function remoteMembership() {
  return {
    createdAt: '2026-07-19T08:00:00.000Z',
    role: 'owner',
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-19T08:00:00.000Z',
    userId: accountA,
    version: 1,
  };
}

function remotePlace(id: string, name: string) {
  return {
    countryCode: 'CH',
    createdAt: '2026-07-19T08:00:00.000Z',
    id,
    latitude: 47.37,
    locality: 'Zürich',
    longitude: 8.54,
    name,
    rootEventId,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function candidate(): EventSetupPlaceCandidate {
  return {
    attribution: 'Crew places',
    confidence: 0.9,
    countryCode: 'CH',
    id: 'candidate_golf',
    kind: 'golf_course',
    latitude: 47.37,
    licenseCode: 'first-party',
    licenseUrl: null,
    locality: 'Zürich',
    longitude: 8.54,
    name: 'Alpine Golf Club',
    region: 'ZH',
    retrievedAt: '2026-07-19T08:00:00.000Z',
    source: 'crew',
    sourceRecordUrl: null,
    status: 'enriched',
    version: 1,
  };
}

function enrichmentProjection(
  status: 'pending' | 'retry' | 'succeeded',
  place: ReturnType<typeof enrichedPlace> | null,
) {
  const active = status !== 'succeeded';
  return {
    enrichment: {
      completedAt: active ? null : '2026-07-19T10:01:00.000Z',
      createdAt: '2026-07-19T10:00:00.000Z',
      id: `pej_${'b'.repeat(64)}`,
      pollAfterSeconds: active ? (status === 'retry' ? 5 : 2) : null,
      retryAllowed: status === 'retry',
      status,
      updatedAt: active
        ? '2026-07-19T10:00:00.000Z'
        : '2026-07-19T10:01:00.000Z',
    },
    place,
    review: null,
  };
}

function searchMissProjection(
  status: 'pending' | 'retry' | 'succeeded',
  reviewState?: 'pending' | 'approved' | 'rejected',
) {
  const active = status !== 'succeeded';
  const state = status === 'succeeded' ? reviewState ?? 'pending' : null;
  return {
    enrichment: {
      completedAt: active ? null : '2026-07-19T10:01:00.000Z',
      createdAt: '2026-07-19T10:00:00.000Z',
      id: `pej_${'d'.repeat(64)}`,
      pollAfterSeconds: active ? (status === 'retry' ? 5 : 2) : null,
      retryAllowed: status === 'retry',
      status,
      updatedAt: active
        ? '2026-07-19T10:00:00.000Z'
        : '2026-07-19T10:01:00.000Z',
    },
    place: state === 'approved' ? worldwidePlace() : null,
    review:
      state === null
        ? null
        : {
            fields: [
              {
                name: 'name' as const,
                provenance: {
                  observedAt: '2026-07-19T09:59:00.000Z',
                  sourceKind: 'exa_llm' as const,
                  sourceUrl: 'https://example.com/ocean-dunes',
                },
                value: 'Ocean Dunes Golf Club',
              },
              {
                name: 'countryCode' as const,
                provenance: {
                  observedAt: '2026-07-19T09:59:00.000Z',
                  sourceKind: 'exa_llm' as const,
                  sourceUrl: 'https://example.com/ocean-dunes',
                },
                value: 'CH',
              },
            ],
            state,
          },
  };
}

function worldwidePlace() {
  return {
    address: 'Ocean Road 1',
    countryCode: 'CH',
    id: `gpl_${'d'.repeat(64)}`,
    kind: 'golf_course' as const,
    latitude: 46.9,
    locality: 'Laax',
    longitude: 9.2,
    name: 'Ocean Dunes Golf Club',
    region: 'GR',
    sourceCandidateId: `pcd_${'e'.repeat(64)}`,
    summary: 'A reviewed golf course.',
    websiteUrl: 'https://example.com/ocean-dunes',
  };
}

function enrichedPlace() {
  return {
    address: 'Alpine Way 1',
    countryCode: candidate().countryCode,
    id: `gpl_${'c'.repeat(64)}`,
    kind: candidate().kind,
    latitude: candidate().latitude,
    locality: candidate().locality,
    longitude: candidate().longitude,
    name: candidate().name,
    region: candidate().region,
    sourceCandidateId: candidate().id,
    summary: null,
    websiteUrl: null,
  };
}

function localRoot(): EventTreeNode {
  return localEvent(rootEventId, null, 'trip', 'Golf Weekend', 0);
}

function localRound(): EventTreeNode {
  return localEvent(roundEventId, rootEventId, 'golf', 'First round', 1);
}

function localEvent(
  id: string,
  parentEventId: string | null,
  kind: 'golf' | 'trip',
  title: string,
  depth: number,
): EventTreeNode {
  return {
    accountUserId: accountA,
    childOrderVersion: '1',
    createdAt: '2026-07-19T08:00:00.000Z',
    deletedAt: null,
    depth,
    description: 'Description',
    endsAt: '2026-09-21T18:00:00.000Z',
    id,
    itineraryOrderVersion: '1',
    kind,
    parentEventId,
    rootEventId,
    sortKey: id === rootEventId ? 'a' : 'b',
    startsAt: '2026-09-20T08:00:00.000Z',
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: id === rootEventId ? 7 : 2,
  };
}

function localMembership(): MembershipRecord {
  return {
    accountUserId: accountA,
    createdAt: '2026-07-19T08:00:00.000Z',
    memberUserId: accountA,
    role: 'owner',
    rootEventId,
    status: 'active',
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function localPlace(id: string, countryCode: string): EventPlaceRecord {
  return {
    accountUserId: accountA,
    countryCode,
    createdAt: '2026-07-19T08:00:00.000Z',
    deletedAt: null,
    id,
    latitude: 47.37,
    locality: 'Zürich',
    longitude: 8.54,
    name: id,
    rootEventId,
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 1,
  };
}

function localGolfCapability(): CapabilityRecord {
  return {
    accountUserId: accountA,
    configJson: JSON.stringify(golfInput(null).config),
    createdAt: '2026-07-19T08:00:00.000Z',
    deletedAt: null,
    entityId: `${roundEventId}:golf`,
    eventId: roundEventId,
    rootEventId,
    schemaVersion: 1,
    type: 'golf',
    updatedAt: '2026-07-19T08:00:00.000Z',
    version: 3,
  };
}

function templateDraftRecord(): DraftRecord {
  return {
    accountUserId: accountA,
    contentJson: JSON.stringify({
      eventIds: {
        root: rootEventId,
        round: 'evt_11111111-1111-4111-8111-111111111111',
      },
      schemaVersion: 1,
      templateId: 'golf-tour',
      templateVersion: 1,
    }),
    createdAt: '2026-07-19T08:00:00.000Z',
    entityType: 'event.template-adoption',
    eventId: rootEventId,
    id: `event-template-adopt:${rootEventId}:golf-tour`,
    rootEventId,
    updatedAt: '2026-07-19T08:00:00.000Z',
  };
}
