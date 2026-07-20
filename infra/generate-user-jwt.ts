import { generateKeyPairSync, randomUUID } from "node:crypto";
import { chmod, chown, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [outputDirectory = "/run/crew-jwt"] = Bun.argv.slice(2);
const privateKeyPath = join(outputDirectory, "user-jwt-private.pem");
const publicKeyPath = join(outputDirectory, "user-jwt-public.pem");
const runtimeUid = Number(Bun.env.BUN_RUNTIME_UID ?? "1000");
const runtimeGid = Number(Bun.env.BUN_RUNTIME_GID ?? "1000");

await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

if (!(await exists(privateKeyPath)) || !(await exists(publicKeyPath))) {
	const { privateKey, publicKey } = generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicExponent: 0x10001,
		privateKeyEncoding: { type: "pkcs8", format: "pem" },
		publicKeyEncoding: { type: "spki", format: "pem" },
	});
	const suffix = randomUUID();
	const privateKeyTemp = `${privateKeyPath}.${suffix}`;
	const publicKeyTemp = `${publicKeyPath}.${suffix}`;
	await writeFile(privateKeyTemp, privateKey, { mode: 0o600 });
	await writeFile(publicKeyTemp, publicKey, { mode: 0o644 });
	await rename(privateKeyTemp, privateKeyPath);
	await rename(publicKeyTemp, publicKeyPath);
	console.info("Generated local user-service JWT key pair");
} else {
	console.info("Reusing local user-service JWT key pair");
}

const runningAsRoot =
	typeof process.getuid === "function" && process.getuid() === 0;
if (runningAsRoot) {
	await Promise.all([chown(privateKeyPath, 0, 0), chown(publicKeyPath, 0, 0)]);
}
await chmod(privateKeyPath, 0o600);
await chmod(publicKeyPath, 0o644);
if (runningAsRoot) {
	await Promise.all([
		chown(privateKeyPath, runtimeUid, runtimeGid),
		chown(publicKeyPath, runtimeUid, runtimeGid),
	]);
}

async function exists(path: string) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
