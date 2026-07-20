type ProviderSinkOptions = {
	deliveryBearer: string;
	fixtureBearer: string;
	now?: () => number;
	log?: (message: string, details: Record<string, string | undefined>) => void;
};

type StoredMagicLink = {
	token: string;
	expiresAt: number;
};

const MAX_BODY_BYTES = 65_536;
const MAX_MAGIC_LINKS = 64;
const MAGIC_LINK_TOKEN = /^ml_[A-Za-z0-9_-]{43}$/;

export function createProviderSinkHandler(options: ProviderSinkOptions) {
	if (options.deliveryBearer.length < 16 || options.fixtureBearer.length < 16) {
		throw new Error(
			"Provider sink bearers must contain at least 16 characters",
		);
	}
	if (options.deliveryBearer === options.fixtureBearer) {
		throw new Error("Delivery and fixture bearers must be different");
	}
	const now = options.now ?? Date.now;
	const log = options.log ?? console.info;
	const magicLinks = new Map<string, StoredMagicLink>();

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/internal/live") {
			return Response.json({ service: "local-provider-sink", status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/internal/ready") {
			return Response.json({
				service: "local-provider-sink",
				status: "ready",
			});
		}
		if (
			request.method === "POST" &&
			url.pathname === "/internal/magic-links/consume"
		) {
			return consumeMagicLink(
				request,
				options.fixtureBearer,
				magicLinks,
				now(),
			);
		}
		if (
			request.method !== "POST" ||
			(url.pathname !== "/magic-links" && url.pathname !== "/push")
		) {
			return Response.json({ error: "not_found" }, { status: 404 });
		}
		if (!authorized(request, options.deliveryBearer)) {
			return Response.json({ error: "unauthorized" }, { status: 401 });
		}
		const idempotencyKey = request.headers.get("idempotency-key");
		if (!idempotencyKey || idempotencyKey.length > 256) {
			return Response.json(
				{ error: "invalid_idempotency_key" },
				{ status: 400 },
			);
		}
		const payload = await readJsonObject(request, MAX_BODY_BYTES);
		if (payload instanceof Response) return payload;

		if (url.pathname === "/magic-links") {
			const delivery = parseMagicLink(payload, now());
			if (!delivery) {
				return Response.json({ error: "invalid_magic_link" }, { status: 400 });
			}
			removeExpired(magicLinks, now());
			magicLinks.delete(delivery.email);
			magicLinks.set(delivery.email, {
				token: delivery.token,
				expiresAt: delivery.expiresAt,
			});
			while (magicLinks.size > MAX_MAGIC_LINKS) {
				const oldest = magicLinks.keys().next().value;
				if (oldest === undefined) break;
				magicLinks.delete(oldest);
			}
		}

		log("Local provider delivery accepted", {
			kind: url.pathname === "/magic-links" ? "magic_link" : "push",
		});
		return new Response(null, { status: 202 });
	};
}

async function consumeMagicLink(
	request: Request,
	fixtureBearer: string,
	magicLinks: Map<string, StoredMagicLink>,
	now: number,
): Promise<Response> {
	if (!authorized(request, fixtureBearer)) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}
	const payload = await readJsonObject(request, 1_024);
	if (payload instanceof Response) return payload;
	if (
		Object.keys(payload).sort().join(",") !== "email" ||
		typeof payload.email !== "string"
	) {
		return Response.json({ error: "invalid_request" }, { status: 400 });
	}
	const email = normalizeEmail(payload.email);
	if (!email) {
		return Response.json({ error: "invalid_request" }, { status: 400 });
	}
	removeExpired(magicLinks, now);
	const delivery = magicLinks.get(email);
	if (!delivery) {
		return Response.json({ error: "not_ready" }, { status: 404 });
	}
	magicLinks.delete(email);
	return Response.json(
		{ token: delivery.token },
		{ headers: { "Cache-Control": "no-store" } },
	);
}

function parseMagicLink(payload: Record<string, unknown>, now: number) {
	if (
		Object.keys(payload).sort().join(",") !== "email,expiresAt,link" ||
		typeof payload.email !== "string" ||
		typeof payload.link !== "string" ||
		typeof payload.expiresAt !== "string"
	) {
		return;
	}
	const email = normalizeEmail(payload.email);
	const expiresAt = Date.parse(payload.expiresAt);
	if (!email || !Number.isFinite(expiresAt) || expiresAt <= now) return;
	let token: string | null;
	try {
		token = new URL(payload.link).searchParams.get("token");
	} catch {
		return;
	}
	if (!token || !MAGIC_LINK_TOKEN.test(token)) return;
	return { email, token, expiresAt };
}

function normalizeEmail(value: string): string | undefined {
	const email = value.trim().toLowerCase();
	return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
		? email
		: undefined;
}

function removeExpired(magicLinks: Map<string, StoredMagicLink>, now: number) {
	for (const [email, delivery] of magicLinks) {
		if (delivery.expiresAt <= now) magicLinks.delete(email);
	}
}

function authorized(request: Request, bearer: string) {
	return request.headers.get("authorization") === `Bearer ${bearer}`;
}

async function readJsonObject(
	request: Request,
	maximumBytes: number,
): Promise<Record<string, unknown> | Response> {
	const declared = request.headers.get("content-length");
	if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
		return Response.json({ error: "payload_too_large" }, { status: 413 });
	}
	const body = await readBoundedBody(request, maximumBytes);
	if (body === null) {
		return Response.json({ error: "payload_too_large" }, { status: 413 });
	}
	try {
		const payload: unknown = JSON.parse(body);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new Error("invalid payload");
		}
		return payload as Record<string, unknown>;
	} catch {
		return Response.json({ error: "invalid_json" }, { status: 400 });
	}
}

async function readBoundedBody(request: Request, maximumBytes: number) {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bytesRead = 0;
	let body = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesRead += value.byteLength;
			if (bytesRead > maximumBytes) {
				await reader.cancel();
				return null;
			}
			body += decoder.decode(value, { stream: true });
		}
		return body + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

if (import.meta.main) {
	const deliveryBearer = Bun.env.PROVIDER_SINK_BEARER;
	const fixtureBearer = Bun.env.PROVIDER_SINK_FIXTURE_BEARER;
	if (!deliveryBearer || !fixtureBearer) {
		throw new Error("Provider sink bearers are required");
	}
	const port = Number(Bun.env.PORT ?? "3010");
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error("PORT must be a valid TCP port");
	}
	const server = Bun.serve({
		hostname: Bun.env.HOST ?? "0.0.0.0",
		port,
		fetch: createProviderSinkHandler({ deliveryBearer, fixtureBearer }),
	});
	console.info(
		`Local provider sink listening on ${server.hostname}:${server.port}`,
	);
}
