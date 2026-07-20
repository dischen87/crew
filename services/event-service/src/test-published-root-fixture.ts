import type { Sql } from "postgres";
import type { EventService } from "./service";

export function installPublishedRootFixtures(service: EventService, sql: Sql) {
	// ponytail: Legacy integration seed only; delete as suites adopt explicit publish fixtures.
	const createRoot = service.createRoot.bind(service);
	service.createRoot = async (actor, input, template) => {
		if (input.status !== "published") return createRoot(actor, input, template);
		const created = await createRoot(
			actor,
			{ ...input, status: "draft" },
			template,
		);
		await sql`
			UPDATE events SET status = 'published'
			WHERE root_event_id = ${input.id}
		`;
		await sql`
			UPDATE event_root_changes
			SET data = jsonb_set(data, '{status}', '"published"'::jsonb)
			WHERE root_event_id = ${input.id} AND entity_type = 'event'
		`;
		await sql`
			UPDATE event_roots SET authorization_scope_version = 1
			WHERE root_event_id = ${input.id}
		`;
		return { ...created, status: "published" };
	};
}
