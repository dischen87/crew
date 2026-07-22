#!/usr/bin/env bun

const PUBLIC_URL = 'http://127.0.0.1:3000';
const CONTROL_URL = requiredLoopbackUrl(
  process.env.NATIVE_E2E_CONTROL_URL,
  'NATIVE_E2E_CONTROL_URL',
);
const CONTROL_BEARER = requiredSecret(
  process.env.NATIVE_E2E_CONTROL_BEARER,
  'NATIVE_E2E_CONTROL_BEARER',
);
const FIXTURE_BEARER = requiredSecret(
  process.env.NATIVE_E2E_FIXTURE_BEARER,
  'NATIVE_E2E_FIXTURE_BEARER',
);
const OWNER_EMAIL = 'crew.local@example.test';
const DEVICE = process.env.IOS_DEVICE_UDID;

const ROOTS = Object.freeze({
  basics: 'evt_publish_basics_final',
  capability: 'evt_publish_capability_final',
  place: 'evt_publish_place_final',
  template: 'evt_publish_template_final',
});

try {
  const command = process.argv[2];
  if (command === 'setup') await setup();
  else if (command === 'redeem-native') await redeemNative();
  else if (command === 'prepare') await prepare();
  else if (command === 'reset-capability') await resetCapability();
  else if (command === 'bump-basics') await bumpBasics();
  else if (command === 'state') await state();
  else if (command === 'detach' || command === 'attach') {
    print(
      await control(`/v1/transport/${command}`, { body: '', method: 'POST' }),
    );
  } else if (command === 'status') print(await control('/v1/status'));
  else throw new Error('Unsupported command');
} catch {
  process.stderr.write('Sanitized publish evidence command failed.\n');
  process.exitCode = 1;
}

async function setup() {
  const value = await control(
    '/v1/setup',
    { body: JSON.stringify({ scenario: 'golf-tour' }), method: 'POST' },
    201,
  );
  if (
    value?.scenario !== 'golf-tour' ||
    value?.owner?.email !== OWNER_EMAIL ||
    typeof value?.owner?.userId !== 'string'
  ) {
    throw new Error('Invalid fixture setup');
  }
  print({ ownerPresent: true, scenario: 'golf-tour', setup: 'ready' });
}

async function redeemNative() {
  if (!DEVICE) throw new Error('IOS_DEVICE_UDID is required');
  const response = await fetch(
    new URL('/internal/magic-links/consume', CONTROL_URL),
    {
      body: JSON.stringify({ email: OWNER_EMAIL }),
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
  print({ opened: true, role: 'owner' });
}

async function prepare() {
  const token = await ownerToken();
  const templates = await api('/core/v1/event-templates', {}, 200, token);
  const copy = templates?.templates?.map(template => ({
    eventTitles: template.events?.map(event => event.title),
    summary: template.summary,
    title: template.title,
    travelReference:
      template.events?.[0]?.capabilities?.find(
        capability => capability.type === 'travel',
      )?.config?.travelerReferenceLabel ?? null,
  }));
  if (
    JSON.stringify(copy) !==
    JSON.stringify([
      {
        eventTitles: ['Trip', 'Arrival', 'Lodging'],
        summary: 'Arrival, lodging and participant transport.',
        title: 'Travel',
        travelReference: 'Travel reference',
      },
      {
        eventTitles: ['Golf tour', 'Arrival', 'Lodging', 'Golf round'],
        summary: 'Travel, lodging, transport, courses and golf rounds.',
        title: 'Golf tour',
        travelReference: 'Travel reference',
      },
      {
        eventTitles: ['Team event', 'Agenda', 'Team activity'],
        summary: 'Venue, agenda, activities and team assignment.',
        title: 'Team event',
        travelReference: null,
      },
    ])
  ) {
    throw new Error('Template copy mismatch');
  }
  await createRoot(token, {
    description: 'Template recovery API evidence.',
    endsAt: '2026-10-05T17:00:00.000Z',
    id: ROOTS.template,
    kind: 'other',
    startsAt: '2026-10-01T09:00:00.000Z',
    status: 'draft',
    timeZone: 'Europe/Zurich',
    title: 'Native Template Recovery',
  });
  const templatePlace = 'plc_publish_template_home';
  await createPlace(token, ROOTS.template, templatePlace, 'Zürich HB');
  await replaceCapability(token, ROOTS.template, ROOTS.template, 'travel', 0, {
    type: 'travel',
    schemaVersion: 1,
    config: {
      homePlaceId: templatePlace,
      travelerReferenceLabel: 'Native evidence',
    },
  });

  const capabilityEvents = golfEventIds(ROOTS.capability, 'cap');
  await createRoot(
    token,
    golfRoot(ROOTS.capability, capabilityEvents, 'Native Capability Recovery'),
  );
  await removeCapability(
    token,
    ROOTS.capability,
    capabilityEvents.root,
    'travel',
  );
  await removeCapability(
    token,
    ROOTS.capability,
    capabilityEvents.arrival,
    'transport',
  );
  await removeCapability(
    token,
    ROOTS.capability,
    capabilityEvents.lodging,
    'lodging',
  );
  await removeCapability(
    token,
    ROOTS.capability,
    capabilityEvents.round,
    'golf',
  );

  const placeEvents = golfEventIds(ROOTS.place, 'place');
  await createRoot(
    token,
    golfRoot(ROOTS.place, placeEvents, 'Native Place Recovery'),
  );
  const sharedPlace = 'plc_publish_place_shared';
  await createPlace(token, ROOTS.place, sharedPlace, 'Belek Treffpunkt');
  await replaceCapability(token, ROOTS.place, placeEvents.root, 'travel', 1, {
    type: 'travel',
    schemaVersion: 1,
    config: {
      homePlaceId: sharedPlace,
      travelerReferenceLabel: 'Native evidence',
    },
  });
  await replaceCapability(
    token,
    ROOTS.place,
    placeEvents.arrival,
    'transport',
    1,
    {
      type: 'transport',
      schemaVersion: 1,
      config: { meetingPlaceId: sharedPlace, participantMode: 'mixed' },
    },
  );
  await replaceCapability(
    token,
    ROOTS.place,
    placeEvents.lodging,
    'lodging',
    1,
    {
      type: 'lodging',
      schemaVersion: 1,
      config: {
        propertyPlaceId: sharedPlace,
        checkInPolicy: 'flexible',
        checkOutPolicy: 'flexible',
        roomAssignmentMode: 'organizer',
      },
    },
  );

  const basicsEvents = {
    root: ROOTS.basics,
    agenda: 'evt_publish_basics_agenda',
    activity: 'evt_publish_basics_activity',
  };
  await createRoot(token, {
    description: null,
    endsAt: null,
    id: ROOTS.basics,
    kind: 'team_event',
    startsAt: null,
    status: 'draft',
    template: { id: 'team-event', version: 1, eventIds: basicsEvents },
    timeZone: 'Europe/Zurich',
    title: 'Native Publish Journey',
  });
  const basicsPlace = 'plc_publish_basics_venue';
  await createPlace(token, ROOTS.basics, basicsPlace, 'Zürich Workshop');
  await replaceCapability(token, ROOTS.basics, ROOTS.basics, 'team', 1, {
    type: 'team',
    schemaVersion: 1,
    config: {
      venuePlaceId: basicsPlace,
      assignmentMode: 'organizer',
      capacityPerTeam: null,
      facilitator: null,
    },
  });

  const snapshot = await readinessSnapshot(token);
  assertCodes(snapshot.template, ['EVENT_TEMPLATE_REQUIRED']);
  assertCodes(snapshot.capability, ['EVENT_CAPABILITY_REQUIRED']);
  if (snapshot.capability.targets[0]?.capabilityVersion !== 2) {
    throw new Error('Capability tombstone version missing');
  }
  assertCodes(snapshot.place, ['EVENT_CAPABILITY_PLACE_REQUIRED']);
  assertCodes(snapshot.basics, [
    'EVENT_DESCRIPTION_REQUIRED',
    'EVENT_START_REQUIRED',
    'EVENT_END_REQUIRED',
  ]);
  print({ copy, readiness: snapshot });
}

async function bumpBasics() {
  const token = await ownerToken();
  const tree = await api(
    `/core/v1/event-roots/${ROOTS.basics}`,
    {},
    200,
    token,
  );
  const root = tree?.events?.find(event => event.id === ROOTS.basics);
  if (!Number.isInteger(root?.version)) throw new Error('Root version missing');
  const response = await api(
    `/core/v1/event-roots/${ROOTS.basics}/events/${ROOTS.basics}`,
    {
      body: JSON.stringify({
        baseVersion: root.version,
        changes: { title: 'Serverstand Native Publish' },
      }),
      headers: { 'idempotency-key': 'publish.native.basics.external.v1' },
      method: 'PATCH',
    },
    200,
    token,
  );
  if (response?.event?.title !== 'Serverstand Native Publish') {
    throw new Error('External update missing');
  }
  print({
    basics: { title: response.event.title, version: response.event.version },
  });
}

async function resetCapability() {
  const token = await ownerToken();
  const tree = await api(
    `/core/v1/event-roots/${ROOTS.capability}`,
    {},
    200,
    token,
  );
  const capability = tree?.capabilities?.find(
    item => item.eventId === ROOTS.capability && item.type === 'travel',
  );
  if (!Number.isSafeInteger(capability?.version)) {
    throw new Error('Live capability version missing');
  }
  await removeCapability(
    token,
    ROOTS.capability,
    ROOTS.capability,
    'travel',
    capability.version,
  );
  const snapshot = await readinessSnapshot(token);
  assertCodes(snapshot.capability, ['EVENT_CAPABILITY_REQUIRED']);
  if (
    snapshot.capability.targets[0]?.capabilityVersion !==
    capability.version + 1
  ) {
    throw new Error('Reset capability version missing');
  }
  print({
    capability: {
      blocker: snapshot.capability.codes[0],
      version: snapshot.capability.targets[0].capabilityVersion,
    },
  });
}

async function state() {
  const token = await ownerToken();
  const readiness = await readinessSnapshot(token);
  const roots = {};
  for (const [name, rootEventId] of Object.entries(ROOTS)) {
    const tree = await api(
      `/core/v1/event-roots/${rootEventId}`,
      {},
      200,
      token,
    );
    const root = tree?.events?.find(event => event.id === rootEventId);
    if (!root) throw new Error('Root missing');
    roots[name] = {
      capabilities: tree.capabilities.length,
      rootRevision: tree.rootRevision,
      status: root.status,
      version: root.version,
    };
  }
  print({ readiness, roots });
}

async function readinessSnapshot(token) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(ROOTS).map(async ([name, rootEventId]) => {
        const value = await api(
          `/core/v1/event-roots/${rootEventId}/publish-readiness`,
          {},
          200,
          token,
        );
        if (
          !Array.isArray(value?.reasons) ||
          typeof value?.ready !== 'boolean'
        ) {
          throw new Error('Invalid readiness');
        }
        return [
          name,
          {
            codes: value.reasons.map(reason => reason.code),
            ready: value.ready,
            rootRevision: value.rootRevision,
            rootVersion: value.rootVersion,
            targets: value.reasons.map(reason => ({
              capabilityType: reason.meta?.capabilityType ?? null,
              capabilityVersion: reason.meta?.capabilityVersion ?? null,
              code: reason.code,
              eventId: reason.meta?.eventId ?? null,
              path: reason.path ?? null,
            })),
            template: value.template?.id ?? null,
          },
        ];
      }),
    ),
  );
}

async function ownerToken() {
  const suffix = crypto.randomUUID();
  await api(
    '/core/v1/auth/magic-links',
    {
      body: JSON.stringify({ email: OWNER_EMAIL }),
      headers: { 'idempotency-key': `publish.native.auth.${suffix}` },
      method: 'POST',
    },
    202,
  );
  const delivered = await fetch(
    new URL('/internal/magic-links/consume', CONTROL_URL),
    {
      body: JSON.stringify({ email: OWNER_EMAIL }),
      headers: {
        Authorization: `Bearer ${FIXTURE_BEARER}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );
  if (!delivered.ok) throw new Error('Magic delivery unavailable');
  const delivery = await delivered.json();
  let magicToken = delivery?.token;
  if (typeof magicToken !== 'string') throw new Error('Magic token missing');
  const session = await api(
    '/core/v1/auth/magic-links/redeem',
    {
      body: JSON.stringify({ token: magicToken }),
      headers: { 'idempotency-key': `publish.native.redeem.${suffix}` },
      method: 'POST',
    },
    200,
  );
  magicToken = undefined;
  if (typeof session?.accessToken !== 'string')
    throw new Error('Session missing');
  return session.accessToken;
}

function golfRoot(id, eventIds, title) {
  return {
    description: `${title} API evidence.`,
    endsAt: '2026-10-05T17:00:00.000Z',
    id,
    kind: 'trip',
    startsAt: '2026-10-01T09:00:00.000Z',
    status: 'draft',
    template: { id: 'golf-tour', version: 1, eventIds },
    timeZone: 'Europe/Zurich',
    title,
  };
}

function golfEventIds(root, suffix) {
  return {
    root,
    arrival: `evt_publish_${suffix}_arrival`,
    lodging: `evt_publish_${suffix}_lodging`,
    round: `evt_publish_${suffix}_round`,
  };
}

async function createRoot(token, body) {
  const value = await api(
    '/core/v1/event-roots',
    {
      body: JSON.stringify(body),
      headers: { 'idempotency-key': `publish.native.create.${body.id}` },
      method: 'POST',
    },
    201,
    token,
  );
  if (value?.event?.id !== body.id) throw new Error('Root create mismatch');
}

async function createPlace(token, rootEventId, id, name) {
  const value = await api(
    `/core/v1/event-roots/${rootEventId}/places`,
    {
      body: JSON.stringify({
        countryCode: 'CH',
        id,
        latitude: 47.3769,
        locality: 'Zürich',
        longitude: 8.5417,
        name,
      }),
      headers: { 'idempotency-key': `publish.native.place.${id}` },
      method: 'POST',
    },
    201,
    token,
  );
  if (value?.place?.id !== id) throw new Error('Place create mismatch');
}

async function replaceCapability(
  token,
  rootEventId,
  eventId,
  type,
  baseVersion,
  capability,
) {
  const value = await api(
    `/core/v1/event-roots/${rootEventId}/events/${eventId}/capabilities/${type}`,
    {
      body: JSON.stringify({ baseVersion, capability }),
      headers: {
        'idempotency-key': `publish.native.capability.${rootEventId}.${eventId}.${baseVersion}`,
      },
      method: 'PUT',
    },
    200,
    token,
  );
  if (value?.capability?.type !== type) throw new Error('Capability mismatch');
}

async function removeCapability(
  token,
  rootEventId,
  eventId,
  type,
  baseVersion = 1,
) {
  const value = await api(
    `/core/v1/event-roots/${rootEventId}/events/${eventId}/capabilities/${type}?baseVersion=${baseVersion}`,
    {
      headers: {
        'idempotency-key': `publish.native.remove.${rootEventId}.${eventId}.${type}.${baseVersion}`,
      },
      method: 'DELETE',
    },
    200,
    token,
  );
  if (value?.deleted !== true) throw new Error('Capability remove mismatch');
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

async function control(path, init = {}, expectedStatus = 200) {
  const response = await fetch(new URL(path, CONTROL_URL), {
    ...init,
    headers: {
      Authorization: `Bearer ${CONTROL_BEARER}`,
      ...(init.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
  });
  if (response.status !== expectedStatus)
    throw new Error('Unexpected control status');
  return expectedStatus === 204 ? null : response.json();
}

function assertCodes(value, expected) {
  if (JSON.stringify(value?.codes) !== JSON.stringify(expected)) {
    throw new Error('Unexpected readiness reasons');
  }
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
