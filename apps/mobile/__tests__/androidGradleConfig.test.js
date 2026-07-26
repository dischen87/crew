const { readFileSync, realpathSync } = require('fs');
const path = require('path');

const androidDirectory = path.resolve(__dirname, '../android');
const workspaceNodeModules = path.resolve(__dirname, '../../../node_modules');
const settingsSource = readFileSync(
  path.join(androidDirectory, 'settings.gradle'),
  'utf8',
);
const appBuildSource = readFileSync(
  path.join(androidDirectory, 'app/build.gradle'),
  'utf8',
);
const mobileGitignore = readFileSync(
  path.resolve(androidDirectory, '../.gitignore'),
  'utf8',
);

test('resolves React Native Gradle tooling from Bun-hoisted node_modules', () => {
  const pluginPath = '../../../node_modules/@react-native/gradle-plugin';
  const includedBuilds = [
    ...settingsSource.matchAll(/includeBuild\(['"]([^'"]+)['"]\)/g),
  ].map(match => match[1]);

  expect(includedBuilds).toEqual([pluginPath, pluginPath]);
  expect(realpathSync(path.resolve(androidDirectory, pluginPath))).toBe(
    realpathSync(
      path.join(workspaceNodeModules, '@react-native/gradle-plugin'),
    ),
  );

  for (const [property, packagePath] of [
    ['reactNativeDir', '../../../../node_modules/react-native'],
    ['codegenDir', '../../../../node_modules/@react-native/codegen'],
  ]) {
    expect(appBuildSource).toContain(`${property} = file("${packagePath}")`);
    expect(
      realpathSync(path.resolve(androidDirectory, 'app', packagePath)),
    ).toBe(
      realpathSync(
        path.join(workspaceNodeModules, packagePath.split('node_modules/')[1]),
      ),
    );
  }
});

test('requires complete external signing and never reuses debug signing for Release', () => {
  const buildTypesSource = appBuildSource.slice(
    appBuildSource.indexOf('buildTypes {'),
  );
  const releaseBlock = buildTypesSource.match(
    /release\s*\{([\s\S]*?)\n\s{8}\}/,
  );

  expect(buildTypesSource).toMatch(
    /debug\s*\{[\s\S]*?signingConfig signingConfigs\.debug/,
  );
  expect(releaseBlock).not.toBeNull();
  expect(releaseBlock[1]).toContain('signingConfig signingConfigs.release');
  expect(releaseBlock[1]).not.toMatch(/signingConfigs\.debug|debug\.keystore/);
  for (const property of [
    'crewReleaseStoreFile',
    'crewReleaseStorePassword',
    'crewReleaseKeyAlias',
    'crewReleaseKeyPassword',
  ]) {
    expect(appBuildSource).toContain(`gradleProperty("${property}")`);
  }
  expect(appBuildSource).toContain(
    'crewReleaseSigningValueCount != 0 && crewReleaseSigningValueCount != crewReleaseSigning.size()',
  );
  expect(appBuildSource).toContain(
    'throw new GradleException("Crew release signing requires all four external Gradle properties")',
  );
  expect(appBuildSource).toContain(
    'crewReleaseSigning.keyAlias.equalsIgnoreCase("androiddebugkey")',
  );
  expect(appBuildSource).toContain(
    'crewReleaseStoreFile == file("debug.keystore").canonicalFile',
  );
  expect(appBuildSource).toContain('storeFile crewReleaseStoreFile');
  for (const message of [
    'Crew release signing cannot use the Android debug key alias',
    'Crew release signing cannot use the repository debug keystore',
  ]) {
    expect(appBuildSource).toContain(`throw new GradleException("${message}")`);
  }
});

test('keeps evidence unsigned and release key material outside Git', () => {
  const evidenceBlock = appBuildSource.match(
    /releaseEvidence\s*\{([\s\S]*?)\n\s{8}\}/,
  );

  expect(evidenceBlock).not.toBeNull();
  expect(evidenceBlock[1]).toContain('initWith release');
  expect(evidenceBlock[1]).toContain('signingConfig null');
  expect(evidenceBlock[1]).not.toContain('signingConfigs.release');
  for (const pattern of ['*.keystore', '*.jks', '*.p12', 'key.properties']) {
    expect(mobileGitignore).toContain(pattern);
  }
});
