const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');

test('registers and forwards the Crew Next custom URL scheme', () => {
  const appDelegate = readFileSync(
    resolve(appRoot, 'ios/CrewNext/AppDelegate.swift'),
    'utf8',
  );
  const infoPlist = readFileSync(
    resolve(appRoot, 'ios/CrewNext/Info.plist'),
    'utf8',
  );
  const entitlements = readFileSync(
    resolve(appRoot, 'ios/CrewNext/CrewNext.entitlements'),
    'utf8',
  );
  const project = readFileSync(
    resolve(appRoot, 'ios/CrewNext.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const androidManifest = readFileSync(
    resolve(appRoot, 'android/app/src/main/AndroidManifest.xml'),
    'utf8',
  );

  expect(infoPlist).toContain('<string>crewnext</string>');
  expect(appDelegate).toContain('RCTLinkingManager.application(');
  expect(appDelegate).toContain('open url: URL');
  expect(appDelegate).toContain('continue userActivity: NSUserActivity');
  expect(appDelegate).toContain('restorationHandler: restorationHandler');
  expect(entitlements).toContain('<key>keychain-access-groups</key>');
  expect(entitlements).toContain(
    '<string>$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
  );
  expect(entitlements).toContain('<string>applinks:crew-haus.com</string>');
  expect(androidManifest).toContain('android:autoVerify="true"');
  expect(androidManifest).toContain('android:host="crew-haus.com"');
  expect(androidManifest).toContain('android:path="/auth/redeem"');
  expect(androidManifest).toContain('android:pathPrefix="/join/"');
  expect(androidManifest).toContain('android:path="/events"');
  expect(androidManifest).toContain('android:pathPrefix="/events/"');
  expect(androidManifest).toContain('android:pathPrefix="/feedback/"');
  expect(project.match(/CODE_SIGN_ENTITLEMENTS/g)).toHaveLength(2);
  expect(project.match(/CODE_SIGN_STYLE = Automatic;/g)).toHaveLength(2);
  expect(project.match(/DEVELOPMENT_TEAM = WFSHGY54TA;/g)).toHaveLength(2);
  expect(
    project.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.crew\.next;/g),
  ).toHaveLength(2);
  expect(project).toContain('DevelopmentTeam = WFSHGY54TA;');
  expect(project).toContain('ProvisioningStyle = Automatic;');
});
