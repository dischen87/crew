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

  expect(infoPlist).toContain('<string>crewnext</string>');
  expect(appDelegate).toContain('RCTLinkingManager.application(');
  expect(appDelegate).toContain('open url: URL');
  expect(entitlements).toContain('<key>keychain-access-groups</key>');
  expect(entitlements).toContain(
    '<string>$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)</string>',
  );
  expect(project.match(/CODE_SIGN_ENTITLEMENTS/g)).toHaveLength(2);
});
