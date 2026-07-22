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

const rootEventId = 'evt_publish_basics_final';
const sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
try {
  const [result] = await sql`
    SELECT event.status,
      event.version::int AS "eventVersion",
      root.revision::int AS "rootRevision",
      (SELECT count(*)::int FROM event_root_changes change
        WHERE change.root_event_id = ${rootEventId}
          AND change.entity_type = 'event'
          AND change.entity_id = ${rootEventId}
          AND change.data->>'status' = 'published') AS "publishedEventChanges",
      (SELECT count(*)::int FROM event_root_changes change
        WHERE change.root_event_id = ${rootEventId}
          AND change.entity_type = 'feedEntry'
          AND change.data::text LIKE '%event.published%') AS "publishedFeedChanges",
      (SELECT count(*)::int FROM event_idempotency_records record
        WHERE record.operation_id = 'eventsPublish'
          AND record.state = 'complete'
          AND record.response_status = 200
          AND record.response_body::text LIKE ${`%${rootEventId}%`}) AS "completedPublishRecords"
    FROM events event
    JOIN event_roots root ON root.root_event_id = event.root_event_id
    WHERE event.id = ${rootEventId}
  `;
  if (
    result?.status !== 'published' ||
    result.eventVersion !== 3 ||
    result.rootRevision !== 5 ||
    result.publishedEventChanges !== 1 ||
    result.publishedFeedChanges !== 1 ||
    result.completedPublishRecords !== 1
  ) {
    throw new Error('Read-only reopen changed the single-publish evidence');
  }
  process.stdout.write(
    `${JSON.stringify({ rootEventId, ...result }, null, 2)}\n`,
  );
} finally {
  await sql.end();
}
