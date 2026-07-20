'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const read = relativePath =>
  readFileSync(resolve(appRoot, relativePath), 'utf8');

test('passes the iOS release build contract as immutable root properties', () => {
  const info = read('ios/CrewNext/Info.plist');
  const project = read('ios/CrewNext.xcodeproj/project.pbxproj');
  const delegate = read('ios/CrewNext/AppDelegate.swift');

  expect(info).toMatch(
    /<key>CrewGatewayBaseURL<\/key>\s*<string>\$\(CREW_GATEWAY_BASE_URL\)<\/string>/,
  );
  expect(info).toMatch(
    /<key>CrewNativeE2ERequestID<\/key>\s*<string>\$\(CREW_NATIVE_E2E_REQUEST_ID\)<\/string>/,
  );
  expect(project.match(/CREW_GATEWAY_BASE_URL = "";/g)).toHaveLength(2);
  expect(project.match(/CREW_NATIVE_E2E_REQUEST_ID = "";/g)).toHaveLength(2);
  expect(delegate).toContain(
    'initialProperties: ["runtimeConfig": runtimeConfig]',
  );
  for (const value of [
    'CrewGatewayBaseURL',
    'CrewNativeE2ERequestID',
    'CFBundleShortVersionString',
    'CFBundleVersion',
    '"platform": "ios"',
  ]) {
    expect(delegate).toContain(value);
  }
});

test('passes the Android Gradle contract as the same immutable root properties', () => {
  const gradle = read('android/app/build.gradle');
  const activity = read(
    'android/app/src/main/java/com/crewnext/MainActivity.kt',
  );

  expect(gradle).toContain('gradleProperty("crewGatewayBaseUrl")');
  expect(gradle).toContain('gradleProperty("crewNativeE2ERequestId")');
  expect(gradle).toContain('gradleProperty("crewVersionName")');
  expect(gradle).toContain('gradleProperty("crewVersionCode")');
  expect(gradle).toContain(
    'buildConfigField "String", "CREW_GATEWAY_BASE_URL", JsonOutput.toJson(crewGatewayBaseUrl)',
  );
  expect(gradle).toContain(
    'release {\n            // Intentionally unsigned until Crew-owned release credentials are configured.\n            buildConfigField "String", "CREW_NATIVE_E2E_REQUEST_ID", JsonOutput.toJson("")\n            manifestPlaceholders.usesCleartextTraffic = "false"',
  );
  expect(gradle).toContain(
    'debug {\n            signingConfig signingConfigs.debug\n            buildConfigField "String", "CREW_NATIVE_E2E_REQUEST_ID", JsonOutput.toJson(crewNativeE2ERequestId)\n            manifestPlaceholders.usesCleartextTraffic = "true"',
  );
  expect(gradle).toContain(
    'buildConfigField "String", "CREW_NATIVE_E2E_REQUEST_ID", JsonOutput.toJson(crewNativeE2ERequestId)',
  );
  expect(gradle).toContain(
    'buildConfigField "String", "CREW_NATIVE_E2E_REQUEST_ID", JsonOutput.toJson("")',
  );
  expect(activity).toContain('"runtimeConfig"');
  for (const value of [
    'BuildConfig.CREW_GATEWAY_BASE_URL',
    'BuildConfig.CREW_NATIVE_E2E_REQUEST_ID',
    'BuildConfig.VERSION_NAME',
    'BuildConfig.VERSION_CODE.toString()',
    '"platform", "android"',
  ]) {
    expect(activity).toContain(value);
  }
});

test('keeps Release cleartext closed and scopes Release evidence to loopback', () => {
  const gradle = read('android/app/build.gradle');
  const releaseEvidenceManifest = read(
    'android/app/src/releaseEvidence/AndroidManifest.xml',
  );
  const releaseEvidenceNetworkSecurity = read(
    'android/app/src/releaseEvidence/res/xml/crew_release_evidence_network_security_config.xml',
  );

  expect(gradle).toContain(
    'releaseEvidence {\n            initWith release\n            applicationIdSuffix ".evidence"\n            matchingFallbacks = ["release"]',
  );
  expect(gradle).toContain(
    'release {\n            // Intentionally unsigned until Crew-owned release credentials are configured.\n            buildConfigField "String", "CREW_NATIVE_E2E_REQUEST_ID", JsonOutput.toJson("")\n            manifestPlaceholders.usesCleartextTraffic = "false"',
  );
  expect(releaseEvidenceManifest).toContain(
    'android:networkSecurityConfig="@xml/crew_release_evidence_network_security_config"',
  );
  expect(releaseEvidenceNetworkSecurity).toContain(
    '<base-config cleartextTrafficPermitted="false" />',
  );
  expect(releaseEvidenceNetworkSecurity).toContain(
    '<domain includeSubdomains="false">127.0.0.1</domain>',
  );
  expect(releaseEvidenceNetworkSecurity).toContain(
    '<domain includeSubdomains="false">localhost</domain>',
  );
  expect(releaseEvidenceNetworkSecurity).not.toContain(
    '<base-config cleartextTrafficPermitted="true"',
  );
});

test('keeps Android Release evidence on the unmodified production golf runtime', () => {
  const entry = read('evidence/golf-scorecard-android-release-entry.js');
  const runtime = read('src/golf/GolfScorecardRuntime.ts');

  for (const productionBoundary of [
    '<GatewayProvider client={gatewayClient}>',
    '<PrivateBootstrapGate>',
    '<RootNavigator privateStatus={privateStatus} />',
    'secureDeviceIdStore.getOrCreate()',
  ]) {
    expect(entry).toContain(productionBoundary);
  }
  for (const forbiddenSeam of [
    'GolfScorecardRuntime.create =',
    'GolfScorecardRuntime.create.bind',
    'randomUUID:',
    'sha256:',
  ]) {
    expect(entry).not.toContain(forbiddenSeam);
  }
  expect(runtime).toContain('randomUUID: secureUuidV4');
  expect(runtime).not.toMatch(/MobileSyncEngine\([\s\S]*?sha256:/);
});

test('does not define a native credential or device identifier channel', () => {
  const sources = [
    read('ios/CrewNext/AppDelegate.swift'),
    read('android/app/src/main/java/com/crewnext/MainActivity.kt'),
  ].join('\n');

  for (const forbiddenKey of [
    '"token"',
    '"password"',
    '"credential"',
    '"deviceId"',
  ]) {
    expect(sources).not.toContain(forbiddenKey);
  }
});
