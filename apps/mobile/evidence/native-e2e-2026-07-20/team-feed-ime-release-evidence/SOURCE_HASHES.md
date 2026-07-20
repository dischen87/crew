# Source and artifact provenance

Repository HEAD while capturing: `d63b54bd5a95a9168bd2a77833a15df27f217c7c`

## Current source

```text
f480c16eee266eeebabc465ddb3a2de69732b9804b75cc941322390034132afb  apps/mobile/src/screens/ScreenFrame.tsx
8f9687929b896a0ffe01ac15458b6323fbb6ef9ebeaa3961433724014abc1108  apps/mobile/__tests__/RootNavigator.test.tsx
d355a4df3011b41a59c585357d8bfffd41a2a347d3190aaf3963d5acfd13c138  apps/mobile/src/screens/TeamFeedScreen.tsx
36a379cf91e4adb7b556a29618c6ad316c4edcb18c6298ce1a413e8f22387355  apps/mobile/src/design/primitives.tsx
019b426cc55d066d6d1897e289723b7069be59e7067a2a14a187ce22a85707bc  apps/mobile/android/app/src/main/AndroidManifest.xml
d844682fc73244fc67e1e1df148342250d3152416baade12d442a86a863c2cda  apps/mobile/evidence/golf-scorecard-android-release-entry.js
```

## ReleaseEvidence artifact

```text
86fa7a53559fe6125cbd878d72b51bf1de701e258d4352f4633c14fa0c1d8c70  generated Hermes bundle embedded for this build
42547db20835c60a03200b5ba22aad823bce8910dbb5514c28a08af314ac1ffb  teamfeed-ime-releaseEvidence-signed.apk
```

The 93 MB APK remains outside the repository evidence directory. The hash ties
these captures to the locally debug-signed APK that was installed only on the
isolated emulator. APK Signature Scheme v2 and v3 verification both passed.
