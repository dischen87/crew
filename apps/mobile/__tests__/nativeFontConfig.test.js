'use strict';

const { Buffer } = require('buffer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const mobileRoot = path.resolve(__dirname, '..');
const read = relativePath =>
  fs.readFileSync(path.join(mobileRoot, relativePath), 'utf8');

test('pins the official DM Sans variable font and license', () => {
  const font = fs.readFileSync(
    path.join(mobileRoot, 'assets/fonts/DM Sans.ttf'),
  );
  const license = fs.readFileSync(
    path.join(mobileRoot, 'assets/fonts/OFL.txt'),
  );
  const provenance = read('assets/fonts/README.md');

  expect(crypto.createHash('sha256').update(font).digest('hex')).toBe(
    '8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d',
  );
  expect(crypto.createHash('sha256').update(license).digest('hex')).toBe(
    '2af94f4fb533be8fa23282eb33e08ca311ddf47c2f32777e2040b282deeec65c',
  );
  expect(provenance).toContain('389b770410cc0b7c21c85673bfa2077420fe7f65');
  expect(font.subarray(0, 4)).toEqual(Buffer.from([0, 1, 0, 0]));
});

test('registers DM Sans as an iOS app resource', () => {
  const project = read('ios/CrewNext.xcodeproj/project.pbxproj');
  const info = read('ios/CrewNext/Info.plist');

  expect(project).toContain('DM Sans.ttf in Resources');
  expect(project).toContain('path = "../assets/fonts/DM Sans.ttf";');
  expect(info).toMatch(
    /<key>UIAppFonts<\/key>\s*<array>\s*<string>DM Sans\.ttf<\/string>\s*<\/array>/,
  );
});

test('packages and registers DM Sans for Android', () => {
  const gradle = read('android/app/build.gradle');
  const application = read(
    'android/app/src/main/java/com/crewnext/MainApplication.kt',
  );

  expect(gradle).toContain('assets.srcDirs += ["../../assets"]');
  expect(application).toContain(
    'ReactFontManager.getInstance().addCustomFont(',
  );
  expect(application).toContain('"DM Sans"');
  expect(application).toContain('"fonts/DM Sans.ttf"');
});
