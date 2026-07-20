export type BoundedFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export class BoundedFetchError extends Error {}

export async function boundedFetch(
	fetcher: BoundedFetch,
	input: string | URL,
	init: RequestInit,
	options: { timeoutMs: number; maxResponseBytes: number },
) {
	let response: Response;
	try {
		response = await fetcher(input, {
			...init,
			signal: init.signal
				? AbortSignal.any([init.signal, AbortSignal.timeout(options.timeoutMs)])
				: AbortSignal.timeout(options.timeoutMs),
		});
	} catch {
		throw new BoundedFetchError("Dependency request failed");
	}

	const declaredLength = response.headers.get("content-length");
	if (
		declaredLength !== null &&
		/^\d+$/.test(declaredLength) &&
		Number(declaredLength) > options.maxResponseBytes
	) {
		await response.body?.cancel().catch(() => undefined);
		throw new BoundedFetchError("Dependency response exceeded its byte limit");
	}

	const reader = response.body?.getReader();
	if (!reader) return { response, text: "" };
	const chunks: Uint8Array[] = [];
	let byteCount = 0;
	for (;;) {
		const next = await reader.read().catch(() => {
			throw new BoundedFetchError("Dependency response could not be read");
		});
		if (next.done) break;
		byteCount += next.value.byteLength;
		if (byteCount > options.maxResponseBytes) {
			await reader.cancel().catch(() => undefined);
			throw new BoundedFetchError(
				"Dependency response exceeded its byte limit",
			);
		}
		chunks.push(next.value);
	}
	const bytes = new Uint8Array(byteCount);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { response, text: new TextDecoder().decode(bytes) };
}

export function dependencyUrl(baseUrl: string, path: string) {
	return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
}
