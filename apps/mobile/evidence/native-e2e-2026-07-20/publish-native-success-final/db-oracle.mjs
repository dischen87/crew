#!/usr/bin/env bun

import postgres from 'postgres';

const databaseUrl = requiredDatabaseUrl(
  process.env.NATIVE_E2E_EVENT_DATABASE_URL,
);
const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const rows = await sql`
    SELECT root.root_event_id AS "rootEventId",
      root.revision::text AS "rootRevision",
      root.template_id AS "templateId",
      event.status,
      event.version,
      (SELECT count(*)::int FROM event_capabilities capability
        WHERE capability.root_event_id = root.root_event_id
          AND capability.deleted_at IS NULL) AS capabilities,
      (SELECT count(*)::int FROM event_capabilities capability
        WHERE capability.root_event_id = root.root_event_id
          AND capability.deleted_at IS NULL
          AND capability.primary_place_id IS NOT NULL) AS "boundCapabilities",
      (SELECT count(*)::int FROM event_places place
        WHERE place.root_event_id = root.root_event_id
          AND place.deleted_at IS NULL) AS places,
      (SELECT count(*)::int FROM event_root_changes change
        WHERE change.root_event_id = root.root_event_id) AS changes
    FROM event_roots root
    JOIN events event ON event.root_event_id = root.root_event_id
      AND event.id = root.root_event_id AND event.parent_event_id IS NULL
    WHERE root.root_event_id IN (
      'evt_publish_template_final',
      'evt_publish_capability_final',
      'evt_publish_place_final',
      'evt_publish_basics_final'
    )
    ORDER BY root.root_event_id
  `;
  const byId = Object.fromEntries(rows.map(row => [row.rootEventId, row]));
  assertRow(byId.evt_publish_template_final, {
    capabilities: 2,
    status: 'draft',
    templateId: 'team-event',
  });
  assertRow(byId.evt_publish_capability_final, {
    capabilities: 1,
    status: 'draft',
    templateId: 'golf-tour',
  });
  assertRow(byId.evt_publish_place_final, {
    boundCapabilities: 4,
    capabilities: 4,
    places: 2,
    status: 'draft',
    templateId: 'golf-tour',
  });
  assertRow(byId.evt_publish_basics_final, {
    boundCapabilities: 1,
    capabilities: 1,
    places: 1,
    status: 'published',
    templateId: 'team-event',
  });
  const streams = await sql`
    SELECT encode(sha256(device_id::bytea), 'hex') AS "deviceFingerprint",
      next_client_sequence::int AS "nextClientSequence"
    FROM event_sync_streams
    WHERE root_event_id = 'evt_publish_basics_final'
    ORDER BY created_at, device_id
  `;
  const receipts = await sql`
    SELECT encode(sha256(device_id::bytea), 'hex') AS "deviceFingerprint",
      client_sequence::int AS "clientSequence", outcome
    FROM event_sync_mutation_receipts
    WHERE root_event_id = 'evt_publish_basics_final'
    ORDER BY created_at, device_id
  `;
  const [basics] = await sql`
    SELECT description, starts_at AS "startsAt", ends_at AS "endsAt"
    FROM events
    WHERE id = 'evt_publish_basics_final'
  `;
  if (
    streams.length !== 2 ||
    new Set(streams.map(stream => stream.deviceFingerprint)).size !== 2 ||
    streams.some(stream => stream.nextClientSequence !== 2) ||
    receipts.length !== 2 ||
    receipts.some(
      receipt => receipt.clientSequence !== 1 || receipt.outcome !== 'applied',
    ) ||
    basics?.description !== 'Final offline erhaltene Beschreibung' ||
    new Date(basics?.startsAt).toISOString() !== '2026-10-01T07:00:00.000Z' ||
    new Date(basics?.endsAt).toISOString() !== '2026-10-05T16:00:00.000Z'
  ) {
    throw new Error('Device lifecycle or final basics evidence mismatch');
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        basics,
        roots: rows,
        deviceLifecycle: {
          distinctStreams: new Set(
            streams.map(stream => stream.deviceFingerprint),
          ).size,
          nextClientSequences: streams.map(
            stream => stream.nextClientSequence,
          ),
          receiptClientSequences: receipts.map(
            receipt => receipt.clientSequence,
          ),
          receiptOutcomes: receipts.map(receipt => receipt.outcome),
          receipts: receipts.length,
          stableDeviceIdentifiersPersisted: false,
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end();
}

function assertRow(row, expected) {
  if (!row) throw new Error('Expected evidence root is missing');
  for (const [key, value] of Object.entries(expected)) {
    if (row[key] !== value) throw new Error('Database evidence mismatch');
  }
  if (!/^\d+$/.test(row.rootRevision) || row.changes < 1) {
    throw new Error('Database revision evidence mismatch');
  }
}

function requiredDatabaseUrl(value) {
  if (!value) throw new Error('NATIVE_E2E_EVENT_DATABASE_URL is required');
  const url = new URL(value);
  if (
    url.protocol !== 'postgres:' ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    url.pathname !== '/crew_native_e2e_event_test_publish_success_final_0720'
  ) {
    throw new Error('Database URL is outside the isolated evidence scope');
  }
  return url.toString();
}
