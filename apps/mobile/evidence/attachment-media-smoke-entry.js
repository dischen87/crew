import React from 'react';
import {
  AppRegistry,
  NativeModules,
  TurboModuleRegistry,
  View,
} from 'react-native';

const media = TurboModuleRegistry.getEnforcing('CrewAttachmentMedia');
const bundleUrl = NativeModules.SourceCode.getConstants().scriptURL;
const accountUserId = `usr_${'7'.repeat(32)}`;

async function smoke() {
  const [normalized, passThrough, orphan] = await Promise.all([
    media.normalizeAndRetain(
      accountUserId,
      bundleUrl.replace(/main\.jsbundle$/, 'smoke.heic'),
    ),
    media.normalizeAndRetain(
      accountUserId,
      bundleUrl.replace(/main\.jsbundle$/, 'smoke.jpg'),
    ),
    media.normalizeAndRetain(
      accountUserId,
      bundleUrl.replace(/main\.jsbundle$/, 'smoke-orphan.jpg'),
    ),
  ]);
  await media.reconcileRetained(accountUserId, [
    normalized.retainedFileKey,
    passThrough.retainedFileKey,
  ]);
  console.log(
    'CREW_ATTACHMENT_MEDIA_SMOKE_OK',
    JSON.stringify({ normalized, passThrough, orphanCandidate: orphan }),
  );
}

smoke().catch(error =>
  console.error('CREW_ATTACHMENT_MEDIA_SMOKE_FAILED', error),
);

function SmokeApp() {
  return <View />;
}

AppRegistry.registerComponent('CrewNext', () => SmokeApp);
