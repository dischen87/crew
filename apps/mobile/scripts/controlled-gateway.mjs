import { createApp } from '../../../services/api-gateway/src/app.ts';
import { loadConfig } from '../../../services/api-gateway/src/config.ts';

const PORT = 3000;
const ACTOR_ID = `usr_${'a'.repeat(32)}`;
const ACCESS_TOKEN = 'crew-evidence-access-token';
const MAGIC_TOKEN = `ml_${'m'.repeat(43)}`;
const INVITE_TOKEN = 'crew_evidence_invite_01';
const ROOT_A = 'evt_evidence_alpha';
const ROOT_B = 'evt_evidence_beta';
const NOW = '2026-07-18T12:00:00.000Z';

const evidence = {
  invitePreviewCalls: 0,
  inviteRedeemKeys: [],
  magicCreateKeys: [],
  magicRedeemKeys: [],
  operations: [],
  joined: false,
};
let rejectFirstInviteRedeem = true;

const config = loadConfig({
  HOST: '127.0.0.1',
  PORT: String(PORT),
  USER_SERVICE_URL: 'http://user.evidence',
  EVENT_SERVICE_URL: 'http://event.evidence',
  USER_SERVICE_JWKS_URL: 'http://jwks.evidence/.well-known/jwks.json',
  USER_TOKEN_ISSUER: 'crew-evidence',
  USER_TOKEN_AUDIENCE: 'crew-mobile',
  RATE_LIMIT_MAX: '1000',
});

const gateway = createApp({
  config,
  async verifyUserToken(token) {
    if (token !== ACCESS_TOKEN) throw new Error('Invalid evidence token');
    return { id: ACTOR_ID };
  },
  fetch: controlledDownstream,
});

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__evidence') return Response.json(summary());
    return gateway.fetch(request);
  },
});

console.info(`Controlled Crew Gateway listening on ${server.url.origin}`);

async function controlledDownstream(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const requestId = request.headers.get('X-Request-ID');
  if (!requestId) return new Response(null, { status: 500 });
  const operation = `${request.method} ${url.pathname}`;
  evidence.operations.push(operation);

  if (operation === 'POST /v1/auth/magic-links') {
    const body = await request.json();
    if (typeof body.email !== 'string') return invalid(requestId);
    evidence.magicCreateKeys.push(idempotencyKey(request));
    return json(requestId, 202, { accepted: true });
  }

  if (operation === 'POST /v1/auth/magic-links/redeem') {
    const body = await request.json();
    if (body.token !== MAGIC_TOKEN) return unauthenticated(requestId);
    evidence.magicRedeemKeys.push(idempotencyKey(request));
    return json(requestId, 200, session());
  }

  if (operation === 'POST /v1/invitations/preview') {
    const body = await request.json();
    if (body.token !== INVITE_TOKEN) return notFound(requestId);
    evidence.invitePreviewCalls += 1;
    return json(requestId, 200, {
      emailBound: false,
      endsAt: '2026-07-20T18:00:00.000Z',
      role: 'participant',
      rootEventId: ROOT_A,
      startsAt: '2026-07-20T08:00:00.000Z',
      title: 'Weekend',
      usable: true,
    });
  }

  if (operation === 'POST /v1/invitations/redeem') {
    const body = await request.json();
    if (body.token !== INVITE_TOKEN) return notFound(requestId);
    evidence.inviteRedeemKeys.push(idempotencyKey(request));
    if (rejectFirstInviteRedeem) {
      rejectFirstInviteRedeem = false;
      return serviceUnavailable(requestId);
    }
    evidence.joined = true;
    return json(requestId, 200, {
      membership: membership(ROOT_A),
    });
  }

  if (operation === 'GET /v1/event-roots') {
    return json(requestId, 200, {
      items: evidence.joined ? [root(ROOT_A), root(ROOT_B)] : [root(ROOT_B)],
      pageInfo: { hasMore: false, nextCursor: null },
    });
  }

  const eventMatch = /^\/v1\/event-roots\/([^/]+)\/events\/([^/]+)$/.exec(
    url.pathname,
  );
  if (request.method === 'GET' && eventMatch) {
    const rootEventId = decodeURIComponent(eventMatch[1]);
    const eventId = decodeURIComponent(eventMatch[2]);
    if (
      rootEventId !== eventId ||
      (rootEventId !== ROOT_B && !(rootEventId === ROOT_A && evidence.joined))
    ) {
      return notFound(requestId);
    }
    return json(requestId, 200, { event: event(rootEventId) });
  }

  return notFound(requestId);
}

function session() {
  return {
    accessToken: ACCESS_TOKEN,
    expiresInSeconds: 900,
    refreshToken: `rt_${'r'.repeat(43)}`,
    tokenType: 'Bearer',
    user: {
      email: 'crew-evidence@example.test',
      id: ACTOR_ID,
      profile: {
        avatarUrl: null,
        displayName: 'Evidence Crew',
        eventReminders: true,
        locale: 'de-CH',
        productUpdates: false,
        reduceMotion: false,
        timeZone: 'Europe/Zurich',
        updatedAt: NOW,
        version: 1,
      },
    },
  };
}

function root(rootEventId) {
  return {
    createdAt: NOW,
    endsAt: '2026-07-20T18:00:00.000Z',
    kind: 'trip',
    membershipStatus: 'active',
    role: rootEventId === ROOT_A ? 'participant' : 'owner',
    rootEventId,
    startsAt: '2026-07-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: 'Weekend',
    updatedAt: NOW,
    version: 1,
  };
}

function membership(rootEventId) {
  return {
    createdAt: NOW,
    role: 'participant',
    rootEventId,
    status: 'active',
    updatedAt: NOW,
    userId: ACTOR_ID,
    version: 1,
  };
}

function event(rootEventId) {
  return {
    childOrderVersion: 1,
    createdAt: NOW,
    description: null,
    endsAt: '2026-07-20T18:00:00.000Z',
    id: rootEventId,
    itineraryOrderVersion: 1,
    kind: 'trip',
    parentEventId: null,
    rootEventId,
    sortKey: '1',
    startsAt: '2026-07-20T08:00:00.000Z',
    status: 'published',
    timeZone: 'Europe/Zurich',
    title: 'Weekend',
    updatedAt: NOW,
    version: 1,
  };
}

function summary() {
  return {
    duplicateTitlesByDistinctRootIds: evidence.joined,
    invitePreviewCalls: evidence.invitePreviewCalls,
    inviteRedeemAttempts: evidence.inviteRedeemKeys.length,
    inviteRedeemKeyStable:
      evidence.inviteRedeemKeys.length > 1 &&
      new Set(evidence.inviteRedeemKeys).size === 1,
    joined: evidence.joined,
    magicCreateAttempts: evidence.magicCreateKeys.length,
    magicRedeemAttempts: evidence.magicRedeemKeys.length,
    magicRedeemKeyStable:
      evidence.magicRedeemKeys.length > 1 &&
      new Set(evidence.magicRedeemKeys).size === 1,
    operations: evidence.operations,
    rawSecretsRecorded: false,
  };
}

function idempotencyKey(request) {
  return request.headers.get('Idempotency-Key') ?? 'missing';
}

function json(requestId, status, body) {
  return Response.json(body, {
    status,
    headers: { 'X-Request-ID': requestId },
  });
}

function error(requestId, status, code, message, retryable) {
  return json(requestId, status, {
    error: { code, message, requestId, retryable },
  });
}

function invalid(requestId) {
  return error(requestId, 400, 'VALIDATION_FAILED', 'Invalid request.', false);
}

function unauthenticated(requestId) {
  return error(
    requestId,
    401,
    'MAGIC_LINK_INVALID',
    'Authentication is required.',
    false,
  );
}

function notFound(requestId) {
  return error(requestId, 404, 'NOT_FOUND', 'Resource not found.', false);
}

function serviceUnavailable(requestId) {
  return error(
    requestId,
    503,
    'SERVICE_UNAVAILABLE',
    'Service unavailable.',
    true,
  );
}
