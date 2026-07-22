#!/usr/bin/env bun

import postgres from 'postgres';

const phase = process.argv[2];
if (
  ![
    'roles-active',
    'organizer-removed',
    'basics-conflict',
    'basics-recovered',
    'publish-conflict',
    'publish-recovered',
  ].includes(phase)
) {
  throw new Error('Oracle phase is invalid');
}
const databaseUrl = requiredDatabaseUrl(
  process.env.NATIVE_E2E_EVENT_DATABASE_URL,
);
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const rootEventId = 'evt_publish_basics_final';

try {
  const [root] = await sql`
    SELECT event.status, event.version::int AS version,
      event.title, event.description,
      event.starts_at AS "startsAt", event.ends_at AS "endsAt",
      aggregate.revision::int AS "rootRevision",
      (SELECT count(*)::int FROM event_root_changes change
        WHERE change.root_event_id = ${rootEventId}
          AND change.entity_type = 'event'
          AND change.entity_id = ${rootEventId}
          AND change.data->>'status' = 'published') AS "publishedChanges",
      (SELECT count(*)::int FROM event_idempotency_records record
        WHERE record.operation_id = 'eventsPublish'
          AND record.response_status = 200
          AND record.response_body::text LIKE ${`%${rootEventId}%`}) AS "successfulPublishRecords"
    FROM events event
    JOIN event_roots aggregate ON aggregate.root_event_id = event.root_event_id
    WHERE event.id = ${rootEventId}
  `;
  const receipts = await sql`
    SELECT client_sequence::int AS "clientSequence", outcome,
      result #>> '{error,code}' AS "errorCode"
    FROM event_sync_mutation_receipts
    WHERE root_event_id = ${rootEventId}
    ORDER BY client_sequence
  `;
  const streams = await sql`
    SELECT next_client_sequence::int AS "nextClientSequence"
    FROM event_sync_streams
    WHERE root_event_id = ${rootEventId}
  `;
  const memberships = await sql`
    SELECT root_event_id AS "rootEventId", role, status, count(*)::int AS count
    FROM event_memberships
    WHERE root_event_id IN (
      ${rootEventId}, 'evt_publish_role_setup_final'
    )
    GROUP BY root_event_id, role, status
    ORDER BY root_event_id, role, status
  `;

  if (phase === 'roles-active' || phase === 'organizer-removed') {
    assertRoleMatrix(memberships, phase === 'organizer-removed');
  }
  if (phase.includes('conflict') || phase.includes('recovered')) {
    assertRootPhase(root, receipts, streams, phase);
  }
  process.stdout.write(
    `${JSON.stringify(
      { memberships, phase, receipts, root, streams },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end();
}

function assertRootPhase(root, receipts, streams, currentPhase) {
  const expected = {
    'basics-conflict': {
      applied: 0,
      description: null,
      nextSequence: 2,
      receipts: 1,
      revision: 4,
      title: 'Serverstand Native Konflikt',
      version: 2,
    },
    'basics-recovered': {
      applied: 1,
      description: 'Lokal erhaltener Konfliktversuch',
      nextSequence: 3,
      receipts: 2,
      revision: 5,
      title: 'Lokaler Native Konflikt',
      version: 3,
    },
    'publish-conflict': {
      applied: 1,
      description: null,
      nextSequence: 3,
      receipts: 2,
      revision: 6,
      title: 'Lokaler Native Konflikt',
      version: 4,
    },
    'publish-recovered': {
      applied: 2,
      description: 'Konflikt sicher aufgelöst',
      nextSequence: 4,
      receipts: 3,
      revision: 7,
      title: 'Lokaler Native Konflikt',
      version: 5,
    },
  }[currentPhase];
  if (
    !root ||
    root.status !== 'draft' ||
    root.version !== expected.version ||
    root.rootRevision !== expected.revision ||
    root.title !== expected.title ||
    root.description !== expected.description ||
    root.publishedChanges !== 0 ||
    root.successfulPublishRecords !== 0 ||
    receipts.length !== expected.receipts ||
    receipts.filter(item => item.outcome === 'applied').length !==
      expected.applied ||
    receipts.filter(
      item =>
        item.outcome === 'rejected' && item.errorCode === 'VERSION_CONFLICT',
    ).length !== 1 ||
    streams.length !== 1 ||
    streams[0].nextClientSequence !== expected.nextSequence
  ) {
    throw new Error('Conflict phase evidence mismatch');
  }
  if (
    currentPhase !== 'basics-conflict' &&
    (new Date(root.startsAt).toISOString() !== '2026-10-01T07:00:00.000Z' ||
      new Date(root.endsAt).toISOString() !== '2026-10-05T16:00:00.000Z')
  ) {
    throw new Error('Recovered schedule mismatch');
  }
}

function assertRoleMatrix(rows, organizerRemoved) {
  for (const rootEventId of [
    'evt_publish_basics_final',
    'evt_publish_role_setup_final',
  ]) {
    for (const role of ['owner', 'participant', 'viewer']) {
      if (!hasRole(rows, rootEventId, role, 'active')) {
        throw new Error('Active role evidence mismatch');
      }
    }
    if (
      !hasRole(
        rows,
        rootEventId,
        'organizer',
        organizerRemoved ? 'removed' : 'active',
      )
    ) {
      throw new Error('Organizer role evidence mismatch');
    }
  }
}

function hasRole(rows, rootEventId, role, status) {
  return rows.some(
    row =>
      row.rootEventId === rootEventId &&
      row.role === role &&
      row.status === status &&
      row.count === 1,
  );
}

function requiredDatabaseUrl(value) {
  if (!value) throw new Error('NATIVE_E2E_EVENT_DATABASE_URL is required');
  const url = new URL(value);
  if (
    url.protocol !== 'postgres:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/crew_native_e2e_event_test_publish_remaining_0720'
  ) {
    throw new Error('Database URL is outside the isolated evidence scope');
  }
  return url.toString();
}
