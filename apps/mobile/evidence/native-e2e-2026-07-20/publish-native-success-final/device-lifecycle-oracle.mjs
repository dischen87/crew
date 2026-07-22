#!/usr/bin/env bun

import postgres from 'postgres';

const value = process.env.NATIVE_E2E_EVENT_DATABASE_URL;
if (!value) throw new Error('NATIVE_E2E_EVENT_DATABASE_URL is required');
const url = new URL(value);
if (
  url.protocol !== 'postgres:' ||
  !['127.0.0.1', 'localhost'].includes(url.hostname) ||
  url.pathname !== '/crew_native_e2e_event_test_publish_success_final_0720'
) {
  throw new Error('Database URL is outside the isolated evidence scope');
}
const stage = process.argv[2];
if (stage !== 'first' && stage !== 'second') {
  throw new Error('Expected first or second lifecycle stage');
}

const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
try {
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
  const expected = stage === 'first' ? 1 : 2;
  if (
    streams.length !== expected ||
    receipts.length !== expected ||
    new Set(streams.map(stream => stream.deviceFingerprint)).size !==
      expected ||
    streams.some(stream => stream.nextClientSequence !== 2) ||
    receipts.some(
      receipt => receipt.clientSequence !== 1 || receipt.outcome !== 'applied',
    )
  ) {
    throw new Error('Mutation stream lifecycle evidence mismatch');
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        stage,
        distinctStreams: new Set(
          streams.map(stream => stream.deviceFingerprint),
        ).size,
        nextClientSequences: streams.map(stream => stream.nextClientSequence),
        receiptClientSequences: receipts.map(
          receipt => receipt.clientSequence,
        ),
        receiptOutcomes: receipts.map(receipt => receipt.outcome),
        receipts: receipts.length,
        stableDeviceIdentifiersPersisted: false,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await sql.end();
}
