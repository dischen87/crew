/* global Response, globalThis */

import 'react-native-get-random-values';
import 'react-native-gesture-handler';

import { GatewayClient } from '@crew/mobile-client';
import { LocalAttachmentStore, migrate, sha256Hex } from '@crew/mobile-data';
import { NavigationContainer } from '@react-navigation/native';
import React from 'react';
import { AppRegistry, Settings } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GatewayProvider } from '../src/app/GatewayProvider';
import { PrivateBootstrapGate } from '../src/app/PrivateBootstrapGate';
import { reconcileRetainedAttachmentFiles } from '../src/media/attachmentMedia';
import { RootNavigator } from '../src/navigation/RootNavigator';
import { deniedRootRegistry } from '../src/storage/deniedRoots';
import { openAccountDatabase } from '../src/storage/opSqliteAdapter';

const accountUserId = 'usr_11111111111111111111111111111111';
const databaseKey = 'c'.repeat(64);
const now = '2026-07-19T12:00:00.000Z';
const uuidV4Pattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const rootEventIdPattern =
  /^evt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const releaseCryptoShape = {
  randomUuidAbsent: typeof globalThis.crypto?.randomUUID !== 'function',
  secureRandomPresent: typeof globalThis.crypto?.getRandomValues === 'function',
  subtleAbsent: typeof globalThis.crypto?.subtle?.digest !== 'function',
};
if (Object.values(releaseCryptoShape).some(value => !value)) {
  throw new Error('Unexpected React Native Release crypto shape');
}
const evidenceSession = {
  accessToken: 'evidence-access-token',
  expiresInSeconds: 300,
  refreshToken: 'evidence-refresh-token',
  tokenType: 'Bearer',
  user: {
    email: 'lena@example.test',
    id: accountUserId,
    profile: {
      avatarUrl: null,
      displayName: 'Lena Graf',
      eventReminders: true,
      locale: 'de-CH',
      productUpdates: false,
      reduceMotion: false,
      timeZone: 'Europe/Zurich',
      updatedAt: now,
      version: 1,
    },
  },
};

let createdRoot = null;
let pullRevision = 1;
let requestSequence = 0;

const sessionStore = {
  async compareAndSet() {
    return true;
  },
  async get() {
    return evidenceSession;
  },
};

const gatewayClient = new GatewayClient({
  baseUrl: 'https://gateway.evidence',
  fetch: evidenceFetch,
  idempotencyKey: () => 'evidence-idempotency-key',
  requestId: () => `req_evidence_${String(++requestSequence).padStart(6, '0')}`,
  sessionStore,
});

const privateDependencies = {
  clearPrivateState() {},
  getDatabaseKey: async () => databaseKey,
  migrateDatabase: migrate,
  openDatabase: () => openAccountDatabase(accountUserId, databaseKey),
  purgeDeniedRoots(accountId, database) {
    return deniedRootRegistry.purgeRecorded(accountId, database);
  },
  reconcileAttachments(accountId, database) {
    return reconcileRetainedAttachmentFiles(
      new LocalAttachmentStore(database),
      accountId,
    );
  },
  sessionStore,
};

function EventCreationProductionEvidenceApp() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <GatewayProvider client={gatewayClient}>
          <PrivateBootstrapGate dependencies={privateDependencies}>
            {privateStatus => (
              <NavigationContainer>
                <RootNavigator privateStatus={privateStatus} />
              </NavigationContainer>
            )}
          </PrivateBootstrapGate>
        </GatewayProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

async function evidenceFetch(input, init) {
  const rawUrl =
    typeof input === 'string'
      ? input
      : typeof input?.url === 'string'
      ? input.url
      : String(input);
  const url = new URL(rawUrl);
  const method = init?.method ?? input?.method ?? 'GET';
  const requestId =
    new Headers(init?.headers).get('x-request-id') ?? 'req_evidence_fallback';
  const respond = (status, body) =>
    new Response(JSON.stringify(body), {
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      status,
    });

  if (method === 'GET' && url.pathname === '/core/v1/event-roots') {
    if (Settings.get('CrewEvidenceState') === 'roots-offline') {
      return respond(503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Evidence outage',
          requestId,
          retryable: true,
        },
      });
    }
    return respond(200, {
      items: createdRoot
        ? [
            {
              createdAt: createdRoot.createdAt,
              endsAt: createdRoot.endsAt,
              kind: createdRoot.kind,
              membershipStatus: 'active',
              role: 'owner',
              rootEventId: createdRoot.rootEventId,
              startsAt: createdRoot.startsAt,
              status: createdRoot.status,
              timeZone: createdRoot.timeZone,
              title: createdRoot.title,
              updatedAt: createdRoot.updatedAt,
              version: createdRoot.version,
            },
          ]
        : [],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }

  if (method === 'GET' && url.pathname === '/core/v1/event-templates') {
    if (Settings.get('CrewEvidenceState') === 'templates-offline') {
      return respond(503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Evidence outage',
          requestId,
          retryable: true,
        },
      });
    }
    return respond(200, { templates: eventTemplates() });
  }

  if (method === 'POST' && url.pathname === '/core/v1/event-roots') {
    const bodyJson = String(init?.body);
    const body = JSON.parse(bodyJson);
    const idempotencyKey = new Headers(init?.headers).get('idempotency-key');
    const templateEventIds = Object.values(body.template?.eventIds ?? {});
    const eventIds = [body.id, ...templateEventIds];
    const secureIds =
      templateEventIds.length === new Set(templateEventIds).size &&
      eventIds.every(
        id => typeof id === 'string' && rootEventIdPattern.test(id),
      ) &&
      (!body.template || body.template.eventIds.root === body.id) &&
      typeof idempotencyKey === 'string' &&
      idempotencyKey.startsWith('root-') &&
      uuidV4Pattern.test(idempotencyKey.slice(5));
    const cryptoProof = {
      bodySha256: await sha256Hex(bodyJson),
      idempotencyKeySha256: idempotencyKey
        ? await sha256Hex(idempotencyKey)
        : null,
      releaseCryptoShape,
      secureIds,
    };
    await publishReleaseCryptoProof(cryptoProof);
    console.info(
      '[crew-release-root-create-proof]',
      JSON.stringify(cryptoProof),
    );
    if (!secureIds) {
      return respond(422, {
        error: {
          code: 'INVALID_CRYPTO_IDENTITY',
          message: 'Release crypto identity proof failed',
          requestId,
          retryable: false,
        },
      });
    }
    if (Settings.get('CrewEvidenceState') === 'create-offline') {
      return respond(503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Evidence transport detached',
          requestId,
          retryable: true,
        },
      });
    }
    createdRoot = {
      childOrderVersion: 1,
      createdAt: now,
      description: body.description ?? null,
      endsAt: body.endsAt ?? null,
      id: body.id,
      itineraryOrderVersion: 1,
      kind: body.kind,
      parentEventId: null,
      rootEventId: body.id,
      sortKey: '1',
      startsAt: body.startsAt ?? null,
      status: 'draft',
      timeZone: body.timeZone,
      title: body.title,
      updatedAt: now,
      version: 1,
    };
    return respond(201, { event: createdRoot });
  }

  if (method === 'GET' && url.pathname === '/core/v1/sync/bootstrap') {
    if (
      !createdRoot ||
      url.searchParams.get('rootEventId') !== createdRoot.id
    ) {
      return notFound(respond, requestId);
    }
    return respond(200, bootstrapPage(createdRoot));
  }

  if (method === 'GET' && url.pathname === '/core/v1/sync/pull') {
    if (
      !createdRoot ||
      url.searchParams.get('rootEventId') !== createdRoot.id
    ) {
      return notFound(respond, requestId);
    }
    pullRevision += 1;
    return respond(200, {
      authorizationScopeVersion: '1',
      changes: [],
      checkpointCursor: `evidence-pull-cursor-${String(pullRevision).padStart(
        4,
        '0',
      )}`,
      pageInfo: { hasMore: false, nextCursor: null },
      protocolVersion: 1,
      rootEventId: createdRoot.id,
    });
  }

  if (
    method === 'GET' &&
    createdRoot &&
    url.pathname === `/core/v1/event-roots/${createdRoot.id}/member-directory`
  ) {
    return respond(200, {
      items: [{ displayName: 'Lena Graf', userId: accountUserId }],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }

  return respond(500, {
    error: {
      code: 'UNEXPECTED_EVIDENCE_REQUEST',
      message: `${method} ${url.pathname}`,
      requestId,
      retryable: false,
    },
  });
}

async function publishReleaseCryptoProof(proof) {
  if (Settings.get('CrewEvidenceCryptoProof') !== 'enabled') return;
  const response = await fetch('http://127.0.0.1:3199/proof', {
    body: JSON.stringify(proof),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error('Release crypto proof sink rejected data');
}

function notFound(respond, requestId) {
  return respond(404, {
    error: {
      code: 'NOT_FOUND',
      message: 'Evidence root not found',
      requestId,
      retryable: false,
    },
  });
}

function bootstrapPage(root) {
  return {
    authorizationScopeVersion: '1',
    pageInfo: { hasMore: false, nextCursor: null },
    protocolVersion: 1,
    records: [
      {
        data: { ...root, deletedAt: null },
        entityId: root.id,
        entityType: 'event',
        entityVersion: 1,
      },
      {
        data: {
          createdAt: now,
          role: 'owner',
          rootEventId: root.id,
          status: 'active',
          updatedAt: now,
          userId: accountUserId,
          version: 1,
        },
        entityId: accountUserId,
        entityType: 'membership',
        entityVersion: 1,
      },
    ],
    rootEventId: root.id,
    snapshotId: `snp_${root.id.slice(4)}`,
    snapshotRevision: '1',
    syncCursor: 'evidence-bootstrap-cursor-0001',
  };
}

function eventTemplates() {
  return [
    template(
      'travel',
      'Travel',
      'Arrival, lodging and participant transport.',
      [
        event('root', null, 'trip', 'Trip'),
        event('arrival', 'root', 'day', 'Arrival'),
        event('lodging', 'root', 'day', 'Lodging'),
      ],
    ),
    template(
      'golf-tour',
      'Golf tour',
      'Travel, lodging, transport, courses and golf rounds.',
      [
        event('root', null, 'trip', 'Golf tour'),
        event('arrival', 'root', 'day', 'Arrival'),
        event('lodging', 'root', 'day', 'Lodging'),
        event('round', 'root', 'golf', 'Golf round'),
      ],
    ),
    template(
      'team-event',
      'Team event',
      'Venue, agenda, activities and team assignment.',
      [
        event('root', null, 'team_event', 'Team event'),
        event('agenda', 'root', 'session', 'Agenda'),
        event('activity', 'root', 'activity', 'Team activity'),
      ],
    ),
  ];
}

function template(id, title, summary, events) {
  return { events, id, summary, title, version: 1 };
}

function event(logicalKey, parentLogicalKey, kind, title) {
  return { capabilities: [], kind, logicalKey, parentLogicalKey, title };
}

AppRegistry.registerComponent(
  'CrewNext',
  () => EventCreationProductionEvidenceApp,
);
