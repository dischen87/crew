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

test('keeps debug signing out of the release build type', () => {
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
  expect(releaseBlock[1]).not.toMatch(
    /signingConfig\s+signingConfigs\.debug|debug\.keystore/,
  );
});
