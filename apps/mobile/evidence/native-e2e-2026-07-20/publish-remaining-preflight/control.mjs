#!/usr/bin/env bun

const PUBLIC_URL = 'http://127.0.0.1:3000';
const CONTROL_URL = requiredLoopbackUrl(
  process.env.NATIVE_E2E_CONTROL_URL,
  'NATIVE_E2E_CONTROL_URL',
);
const FIXTURE_BEARER = requiredSecret(
  process.env.NATIVE_E2E_FIXTURE_BEARER,
  'NATIVE_E2E_FIXTURE_BEARER',
);
const DEVICE = process.env.IOS_DEVICE_UDID;

const ROOTS = Object.freeze({
  basics: 'evt_publish_basics_final',
  setup: 'evt_publish_role_setup_final',
});
const ACTORS = Object.freeze({
  owner: { email: 'crew.local@example.test', role: 'owner' },
  organizer: {
    email: 'crew.golf.organizer.local@example.test',
    role: 'organizer',
  },
  participant: {
    email: 'crew.golf.participant.local@example.test',
    role: 'participant',
  },
  viewer: {
    email: 'crew.team.participant.local@example.test',
    role: 'viewer',
  },
});

try {
  const command = process.argv[2];
  if (command === 'prepare-roles') await prepareRoles();
  else if (command === 'bump-basics-conflict') await bumpBasicsConflict();
  else if (command === 'block-publish') await blockPublish();
  else if (command === 'arm-publish-barrier') await armPublishBarrier();
  else if (command === 'drift-publish-conflict') await driftPublishConflict();
  else if (command === 'cancel-publish-barrier') await cancelPublishBarrier();
  else if (command === 'remove-organizer') await removeOrganizer();
  else if (command === 'role-oracle') await roleOracle(process.argv[3]);
  else if (command === 'open-delivered') await openDelivered(process.argv[3]);
  else if (command === 'state') await state();
  else throw new Error('Unsupported command');
} catch {
  process.stderr.write('Sanitized remaining-acceptance command failed.\n');
  process.exitCode = 1;
}

async function prepareRoles() {
  const sessions = Object.fromEntries(
    await Promise.all(
      Object.entries(ACTORS).map(async ([name, actor]) => [
        name,
        await sessionFor(actor.email),
      ]),
    ),
  );
  await ensureRoleSetupRoot(sessions.owner.accessToken);
  for (const rootEventId of Object.values(ROOTS)) {
    for (const name of ['organizer', 'participant', 'viewer']) {
      await inviteAndRedeem(
        sessions.owner.accessToken,
        sessions[name],
        name,
        rootEventId,
      );
    }
  }
  print({ memberships: 6, roles: ['organizer', 'participant', 'viewer'] });
}

async function ensureRoleSetupRoot(ownerToken) {
  const value = await api(
    '/core/v1/event-roots',
    {
      body: JSON.stringify({
        description: 'Native role denial matrix.',
        endsAt: '2026-10-05T17:00:00.000Z',
        id: ROOTS.setup,
        kind: 'other',
        startsAt: '2026-10-01T09:00:00.000Z',
        status: 'draft',
        timeZone: 'Europe/Zurich',
        title: 'Native Role Setup',
      }),
      headers: { 'idempotency-key': 'remaining.role.setup.create.v1' },
      method: 'POST',
    },
    201,
    ownerToken,
  );
  if (value?.event?.id !== ROOTS.setup) throw new Error('Role root mismatch');
}

async function inviteAndRedeem(ownerToken, session, name, rootEventId) {
  const invitationId = `inv_remaining_${rootEventId.slice(4)}_${name}`;
  const created = await api(
    `/core/v1/event-roots/${rootEventId}/invitations`,
    {
      body: JSON.stringify({
        expiresAt: '2027-01-01T00:00:00.000Z',
        id: invitationId,
        maxUses: 1,
        normalizedEmailHint: ACTORS[name].email,
        role: ACTORS[name].role,
      }),
      headers: {
        'idempotency-key': `remaining.invite.${rootEventId}.${name}.v1`,
      },
      method: 'POST',
    },
    201,
    ownerToken,
  );
  let token = created?.token;
  if (typeof token !== 'string') throw new Error('Invitation token missing');
  const redeemed = await api(
    '/core/v1/invitations/redeem',
    {
      body: JSON.stringify({ token }),
      headers: {
        'idempotency-key': `remaining.redeem.${rootEventId}.${name}.v1`,
      },
      method: 'POST',
    },
    200,
    session.accessToken,
  );
  token = undefined;
  if (
    redeemed?.membership?.rootEventId !== rootEventId ||
    redeemed.membership.userId !== session.userId ||
    redeemed.membership.role !== ACTORS[name].role ||
    redeemed.membership.status !== 'active'
  ) {
    throw new Error('Redeemed membership mismatch');
  }
}

async function bumpBasicsConflict() {
  const owner = await sessionFor(ACTORS.owner.email);
  const tree = await rootTree(owner.accessToken, ROOTS.basics);
  const root = rootFromTree(tree, ROOTS.basics);
  if (root.title === 'Serverstand Native Konflikt') {
    print({ phase: 'basics-conflict', version: root.version });
    return;
  }
  const value = await updateRoot(
    owner.accessToken,
    root.version,
    { title: 'Serverstand Native Konflikt' },
    'remaining.basics.external-conflict.v1',
  );
  print({ phase: 'basics-conflict', version: value.event.version });
}

async function blockPublish(emit = true) {
  const owner = await sessionFor(ACTORS.owner.email);
  const tree = await rootTree(owner.accessToken, ROOTS.basics);
  const root = rootFromTree(tree, ROOTS.basics);
  if (
    tree.rootRevision !== '5' ||
    root.version !== 3 ||
    root.status !== 'draft' ||
    root.title !== 'Lokaler Native Konflikt' ||
    root.description !== 'Lokal erhaltener Konfliktversuch'
  ) {
    throw new Error('Publish drift precondition mismatch');
  }
  const value = await updateRoot(
    owner.accessToken,
    root.version,
    { description: null },
    'remaining.publish.external-blocker.v1',
  );
  const confirmedTree = await rootTree(owner.accessToken, ROOTS.basics);
  const confirmed = rootFromTree(confirmedTree, ROOTS.basics);
  if (
    confirmedTree.rootRevision !== '6' ||
    confirmed.version !== 4 ||
    confirmed.description !== null
  ) {
    throw new Error('Publish drift confirmation mismatch');
  }
  const result = {
    blocker: 'EVENT_DESCRIPTION_REQUIRED',
    rootRevision: confirmedTree.rootRevision,
    version: value.event.version,
  };
  if (emit) print(result);
  return result;
}

async function armPublishBarrier() {
  await controlApi(
    '/v1/traces/allow',
    {
      body: JSON.stringify({ requestIds: ['crew-e2e.ios'] }),
      method: 'POST',
    },
    200,
  );
  await controlApi(
    '/v1/barriers/events-publish-once',
    {
      body: JSON.stringify({
        requestId: 'crew-e2e.ios',
        rootEventId: ROOTS.basics,
      }),
      method: 'POST',
    },
    201,
  );
  print({ publishBarrier: 'armed', rootEventId: ROOTS.basics });
}

async function driftPublishConflict() {
  await waitForPublishBarrier();
  try {
    const drift = await blockPublish(false);
    await controlApi(
      '/v1/barriers/events-publish-once/release',
      { method: 'POST' },
      200,
    );
    print({ ...drift, publishBarrier: 'released' });
  } catch (error) {
    await cancelPublishBarrier(false);
    throw error;
  }
}

async function waitForPublishBarrier() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await controlApi('/v1/barriers/events-publish-once', {}, 200);
    if (value?.publishBarrier === 'reached') return;
    if (value?.publishBarrier !== 'armed') {
      throw new Error('Publish barrier is not armed');
    }
    await Bun.sleep(100);
  }
  throw new Error('Publish barrier was not reached');
}

async function cancelPublishBarrier(emit = true) {
  await controlApi(
    '/v1/barriers/events-publish-once',
    { method: 'DELETE' },
    204,
  );
  if (emit) print({ publishBarrier: 'idle' });
}

async function updateRoot(token, baseVersion, changes, idempotencyKey) {
  const value = await api(
    `/core/v1/event-roots/${ROOTS.basics}/events/${ROOTS.basics}`,
    {
      body: JSON.stringify({ baseVersion, changes }),
      headers: { 'idempotency-key': idempotencyKey },
      method: 'PATCH',
    },
    200,
    token,
  );
  if (value?.event?.id !== ROOTS.basics)
    throw new Error('Root update mismatch');
  return value;
}

async function removeOrganizer() {
  const owner = await sessionFor(ACTORS.owner.email);
  const organizer = await sessionFor(ACTORS.organizer.email);
  let removed = 0;
  for (const rootEventId of Object.values(ROOTS)) {
    const page = await api(
      `/core/v1/event-roots/${rootEventId}/memberships`,
      {},
      200,
      owner.accessToken,
    );
    const membership = page?.items?.find(
      item => item.userId === organizer.userId && item.role === 'organizer',
    );
    if (!membership) throw new Error('Organizer membership missing');
    if (membership.status === 'removed') continue;
    const value = await api(
      `/core/v1/event-roots/${rootEventId}/memberships/${organizer.userId}`,
      {
        body: JSON.stringify({
          baseVersion: membership.version,
          reason: 'Native authorization-loss acceptance.',
          role: 'organizer',
          status: 'removed',
        }),
        headers: {
          'idempotency-key': `remaining.organizer.remove.${rootEventId}.v1`,
        },
        method: 'PATCH',
      },
      200,
      owner.accessToken,
    );
    if (value?.membership?.status !== 'removed') {
      throw new Error('Organizer removal mismatch');
    }
    removed += 1;
  }
  print({ removed });
}

async function roleOracle(phase) {
  if (phase !== 'active' && phase !== 'organizer-removed') {
    throw new Error('Role oracle phase is invalid');
  }
  const statuses = {};
  for (const [name, actor] of Object.entries(ACTORS)) {
    const session = await sessionFor(actor.email);
    const expected =
      name === 'owner' || (name === 'organizer' && phase === 'active')
        ? 200
        : name === 'organizer'
        ? 404
        : 403;
    statuses[name] = {};
    for (const [rootName, rootEventId] of Object.entries(ROOTS)) {
      const response = await fetch(
        new URL(
          `/core/v1/event-roots/${rootEventId}/publish-readiness`,
          PUBLIC_URL,
        ),
        { headers: { Authorization: `Bearer ${session.accessToken}` } },
      );
      if (response.status !== expected) throw new Error('Role status mismatch');
      statuses[name][rootName] = response.status;
    }
  }
  print({ phase, statuses });
}

async function openDelivered(name) {
  if (!DEVICE || !/^[A-F0-9-]{36}$/.test(DEVICE)) {
    throw new Error('IOS_DEVICE_UDID is required');
  }
  const actor = ACTORS[name];
  if (!actor) throw new Error('Unknown role');
  const response = await fetch(
    new URL('/internal/magic-links/consume', CONTROL_URL),
    {
      body: JSON.stringify({ email: actor.email }),
      headers: {
        Authorization: `Bearer ${FIXTURE_BEARER}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!response.ok) throw new Error('Magic link unavailable');
  const body = await response.json();
  let token = body?.token;
  if (typeof token !== 'string' || !/^ml_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid magic link');
  }
  const child = Bun.spawn(
    [
      '/usr/bin/xcrun',
      'simctl',
      'openurl',
      DEVICE,
      `crewnext://auth/redeem?token=${encodeURIComponent(token)}`,
    ],
    { stderr: 'ignore', stdout: 'ignore' },
  );
  token = undefined;
  if ((await child.exited) !== 0) throw new Error('Open URL failed');
  print({ opened: true, role: name });
}

async function state() {
  const owner = await sessionFor(ACTORS.owner.email);
  const tree = await rootTree(owner.accessToken, ROOTS.basics);
  const root = rootFromTree(tree, ROOTS.basics);
  const readiness = await api(
    `/core/v1/event-roots/${ROOTS.basics}/publish-readiness`,
    {},
    200,
    owner.accessToken,
  );
  print({
    basics: {
      descriptionPresent: Boolean(root.description),
      rootRevision: tree.rootRevision,
      status: root.status,
      title: root.title,
      version: root.version,
    },
    readiness: {
      codes: readiness.reasons.map(reason => reason.code),
      ready: readiness.ready,
    },
  });
}

async function sessionFor(email) {
  const suffix = crypto.randomUUID();
  await api(
    '/core/v1/auth/magic-links',
    {
      body: JSON.stringify({ email }),
      headers: { 'idempotency-key': `remaining.auth.${suffix}` },
      method: 'POST',
    },
    202,
  );
  const delivered = await fetch(
    new URL('/internal/magic-links/consume', CONTROL_URL),
    {
      body: JSON.stringify({ email }),
      headers: {
        Authorization: `Bearer ${FIXTURE_BEARER}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!delivered.ok) throw new Error('Magic delivery unavailable');
  const delivery = await delivered.json();
  let token = delivery?.token;
  if (typeof token !== 'string') throw new Error('Magic token missing');
  const session = await api(
    '/core/v1/auth/magic-links/redeem',
    {
      body: JSON.stringify({ token }),
      headers: { 'idempotency-key': `remaining.redeem-auth.${suffix}` },
      method: 'POST',
    },
    200,
  );
  token = undefined;
  if (
    typeof session?.accessToken !== 'string' ||
    !/^usr_[a-f0-9]{32}$/.test(session?.user?.id)
  ) {
    throw new Error('Session missing');
  }
  return { accessToken: session.accessToken, userId: session.user.id };
}

async function rootTree(token, rootEventId) {
  return api(`/core/v1/event-roots/${rootEventId}`, {}, 200, token);
}

function rootFromTree(tree, rootEventId) {
  const root = tree?.events?.find(event => event.id === rootEventId);
  if (!root || !Number.isSafeInteger(root.version)) {
    throw new Error('Root missing');
  }
  return root;
}

async function api(path, init = {}, expectedStatus = 200, token) {
  const response = await fetch(new URL(path, PUBLIC_URL), {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  if (response.status !== expectedStatus)
    throw new Error('Unexpected API status');
  return response.json();
}

async function controlApi(path, init, expectedStatus) {
  const response = await fetch(new URL(path, CONTROL_URL), {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredSecret(
        process.env.NATIVE_E2E_CONTROL_BEARER,
        'NATIVE_E2E_CONTROL_BEARER',
      )}`,
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
  });
  if (response.status !== expectedStatus) {
    throw new Error('Unexpected control status');
  }
  return response.status === 204 ? null : response.json();
}

function requiredLoopbackUrl(value, name) {
  const url = new URL(required(value, name));
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !/^31\d\d$/.test(url.port) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an isolated loopback control URL`);
  }
  return url;
}

function requiredSecret(value, name) {
  const secret = required(value, name);
  if (secret.length < 32) throw new Error(`${name} is too short`);
  return secret;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
