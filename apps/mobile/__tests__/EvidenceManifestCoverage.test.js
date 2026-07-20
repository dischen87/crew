import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import coverage from '../evidence/manifest-coverage.json';

const mobileDirectory = path.resolve(__dirname, '..');
const repositoryDirectory = path.resolve(mobileDirectory, '../..');
const requiredGroupNames = [
  'entry',
  'evidencePolicy',
  'views',
  'screens',
  'frame',
  'primitives',
  'theme',
  'visibleAssets',
];
const staleDigest = '0'.repeat(64);

test.each(coverage.sets)(
  '$name manifest covers rendering inputs and every final evidence file',
  evidenceSet => {
    expect(['current', 'stale']).toContain(evidenceSet.status);
    const manifest = parseManifest(evidenceSet.manifest);

    for (const groupName of requiredGroupNames) {
      const requiredPaths = evidenceSet.requiredGroups[groupName];
      expect(requiredPaths?.length).toBeGreaterThan(0);
      for (const requiredPath of requiredPaths) {
        expect(existsSync(resolveRepositoryPath(requiredPath))).toBe(true);
        expect(manifest.paths).toContain(requiredPath);
      }
    }

    for (const finalPath of filesInside(evidenceSet.directory)) {
      if (finalPath === evidenceSet.manifest) continue;
      expect(manifest.paths).toContain(finalPath);
    }

    if (evidenceSet.status === 'stale') {
      expect(manifest.entries.some(entry => entry.digest === staleDigest)).toBe(
        true,
      );
      return;
    }

    for (const entry of manifest.entries) {
      expect(entry.digest).not.toBe(staleDigest);
      expect(sha256(resolveRepositoryPath(entry.path))).toBe(entry.digest);
    }
  },
);

function parseManifest(manifestPath) {
  const absolutePath = resolveRepositoryPath(manifestPath);
  expect(existsSync(absolutePath)).toBe(true);
  const entries = readFileSync(absolutePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const parsed = /^([0-9a-f]{64}) ([ *])(.+)$/.exec(line);
      expect(parsed).not.toBeNull();
      const entry = { digest: parsed[1], path: parsed[3] };
      expect(path.isAbsolute(entry.path)).toBe(false);
      expect(entry.path.split('/')).not.toContain('..');
      expect(existsSync(resolveRepositoryPath(entry.path))).toBe(true);
      return entry;
    });
  const paths = entries.map(entry => entry.path);
  expect(new Set(paths).size).toBe(paths.length);
  return { entries, paths };
}

function filesInside(directory) {
  const absoluteDirectory = resolveRepositoryPath(directory);
  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap(
    entry => {
      const relativePath = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesInside(relativePath) : [relativePath];
    },
  );
}

function resolveRepositoryPath(relativePath) {
  return path.resolve(repositoryDirectory, relativePath);
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}
