import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const harnessPath = resolve(
  directory,
  '../private-unavailable-option-2-entry.js',
);
const harness = readFileSync(harnessPath, 'utf8');

assert.equal(
  createHash('sha256').update(harness).digest('hex'),
  'cde22f259868bf3c47e51ac0bedf5d3ad5c8c4442a32714598fb86e1d3c68245',
);
assert.match(harness, /PrivateBootstrapGate/);
assert.match(harness, /PrivateUnavailableScreen/);
assert.doesNotMatch(
  harness,
  /secureSessionStore|openAccountDatabase|getOrCreateDatabaseKey|queryClient/,
);

for (const name of ['android-known-entry.js', 'android-unknown-entry.js']) {
  const wrapper = readFileSync(resolve(directory, name), 'utf8');
  assert.deepEqual(
    [...wrapper.matchAll(/key === '([^']+)'/g)].map(match => match[1]),
    ['CrewEvidencePrivateUnavailableProof', 'CrewEvidenceState'],
  );
  assert.equal(
    wrapper.match(/Settings\.get\s*=/g)?.length,
    1,
    `${name} must override Settings.get exactly once`,
  );
  assert.equal(
    wrapper.match(/require\('\.\.\/private-unavailable-option-2-entry'\)/g)
      ?.length,
    1,
    `${name} must require the unchanged harness exactly once`,
  );
  assert.doesNotMatch(
    wrapper,
    /PrivateBootstrap|Keychain|sessionStore|compareAndSet|openDatabase|getDatabaseKey|clearPrivateState|prototype\.|\.bind\([^)]*Runtime|globalThis/,
  );
}

console.log('Android private-unavailable evidence boundary: PASS');
