# Native-capture and post-hardening source binding

The final native frames were captured after the stale-role refresh fix from a
fresh `assembleReleaseEvidence` build. The installed APK was locally signed
with the repository debug certificate only for emulator installation; APK
Signature Schemes v2 and v3 verified. The APK is not retained and is not a
distribution artifact.

```text
87c04e3230bf529d4998aaeae5b629849898510b19ac8eac7c07fcef27a5ff7d  installed temporary releaseEvidence APK
5744d3120c1ce22313f28ca5547203c8c982af9aa771bdb134d92ae82ce371aa  embedded assets/index.android.bundle
```

The embedded bundle hash matched the generated Release-evidence Hermes bundle
byte-for-byte. Binding source hashes at native-capture time:

```text
f1fa8f3e7a3b3ad909bb6f7c62deed5253c0422b7de2a5fe55aff4fa83fa6ed7  apps/mobile/src/team/TeamProductionRuntime.ts
c223e792041c05aeff0f2f8edc11f7a6b3b7c014bbbeaf88b88f7b1a77ad880f  apps/mobile/src/team/TeamCollaborationController.ts
d355a4df3011b41a59c585357d8bfffd41a2a347d3190aaf3963d5acfd13c138  apps/mobile/src/screens/TeamFeedScreen.tsx
f480c16eee266eeebabc465ddb3a2de69732b9804b75cc941322390034132afb  apps/mobile/src/screens/ScreenFrame.tsx
9e9451e86652261e7f9f48d79c998cc07919e73e0d7a8cf46fc9de2b2d1dcdeb  apps/mobile/__tests__/TeamFeed.test.tsx
1e4d0c3930e9accadb3b32df43f41f2bf7987c7c28bcea73d537704ca2a86364  packages/mobile-data/src/outbox.ts
2c6288b16337b74f648cada47ac0f16194a2be85c752831b32b886eef101e8e7  packages/mobile-data/test/mobile-data.test.ts
01bcc610b42da4ea195b3c804cbf438cbf75ab36bb1e9033756bec01d12498a9  services/event-service/src/sync.ts
6e540ef0460a68b7bd52ab2fb2ef263a83e54aac26b28a752a2f328d046298a7  services/event-service/src/sync.integration.test.ts
f73d67a59a204afab6f033e78c1a2dd3189c4cd8a2615eb7f292b09279d5eaad  infra/native-e2e-runner.ts
d844682fc73244fc67e1e1df148342250d3152416baade12d442a86a863c2cda  apps/mobile/evidence/golf-scorecard-android-release-entry.js
b8015fadb9ecdf1fc012988201af2846c8fc72de38f784a9c11bb444f2b525c5  apps/mobile/android/app/build.gradle
b74787c206c9c200934403dc8cafe7e9795048dd2f54e0a3e7e7adf96dc5f4f1  apps/mobile/android/app/src/releaseEvidence/AndroidManifest.xml
9187f485f22fde712aea8de5243664710440a9ee08e9f1b172978eef96a15001  apps/mobile/android/app/src/releaseEvidence/res/xml/crew_release_evidence_network_security_config.xml
```

## Post-capture write-fence hardening

The native frames above predate the final time-of-check/time-of-use fix and do
not prove it. The change only adds a synchronous active-account and dynamic-role
fence after asynchronous reads and immediately before the three outbox enqueue
calls; it does not change UI, accessibility, navigation, storage schema, native
code, or the sync contract.

A fresh current-source `assembleReleaseEvidence` completed after the hardening.
The output below was unsigned, was not installed, and was removed after hashing.
The embedded APK bundle matched the generated Hermes bundle byte-for-byte.

```text
075d3b13c819c4716a1973a2b4b23e1f57562c98a13a1cf4ad45e21a63b19ac6  post-hardening temporary unsigned releaseEvidence APK
5a5b71a823b40518bd00a5b449994fc91b0ef758d2e6bbd295dd2b9b4eb8b3ad  post-hardening embedded assets/index.android.bundle
```

Current source/test hashes after the three deterministic interleaving
regressions passed:

```text
6ed2061a79dfb923ea96237bfe500de5df5c1d66253b1daa5923de6de4db2a04  apps/mobile/src/team/TeamProductionRuntime.ts
dad24532cc24f5679188f4b82ab3de3b0d7a6cc3051a5c9507948a1ba6c0f25b  apps/mobile/src/team/TeamCollaborationController.ts
17fa51d2a8374b48d6a9289343621eace159423b2e6bb11e3024ea041e13b4bd  apps/mobile/__tests__/TeamFeed.test.tsx
414b59f82e25bb14f4c9899fabccfc8c464a103b4f6fa3aaf4fbf9bcfaec5f70  apps/mobile/__tests__/TeamCollaboration.test.tsx
d355a4df3011b41a59c585357d8bfffd41a2a347d3190aaf3963d5acfd13c138  apps/mobile/src/screens/TeamFeedScreen.tsx
f480c16eee266eeebabc465ddb3a2de69732b9804b75cc941322390034132afb  apps/mobile/src/screens/ScreenFrame.tsx
```

## Final source-level authority-race hardening

An independent source-level interleaving audit subsequently found two narrower
authority windows in assignment loading and decision replacement. This is not a
claim that the retained native run reproduced or induced either race. The
native frames remain UI, accessibility, offline-status and lifecycle evidence
only.

The current implementation rechecks the active account across every relevant
read/return boundary, rechecks the current role after all asynchronous person
reads before exposing assignment data, returns only the identifier-free
read-only projection after a downgrade, and applies the final account plus
dynamic-manager fence after the device read before decision enqueue. The
adversarial Team Feed + Team Collaboration gate passed 35/35.

A fresh current-source `assembleReleaseEvidence --rerun-tasks` build completed
after these fixes. The unsigned APK was not installed. Its embedded Hermes
bundle matched both generated and merged Release-evidence bundles
byte-for-byte. The APK is a temporary build-binding artifact, not a
distribution artifact.

```text
54cf73144f9279aebb52059955c419f089237ef0545c173994e9ed8abd47217d  final current-source temporary unsigned releaseEvidence APK
ac2adf2af6790ab7cae574f5e20b39e926d0abe18729548820cdd11b971d93f7  final current-source embedded/generated/merged Hermes bundle
```

Final current source/test hashes:

```text
adbed5ce79dfb392408f724e73c51bd26c5d92e070d3df7fd09ed176b5b77957  apps/mobile/src/team/TeamProductionRuntime.ts
bc1eba49753c8c3077f1ea2f56735b5b4c4b455fbc7dd3a1a4d3000ab0c5f481  apps/mobile/src/team/TeamCollaborationController.ts
b086b13d11075c488a1ad6b22f2d0b9c9a1c76b7f14c8cbfb4f8a648eda82642  apps/mobile/__tests__/TeamCollaboration.test.tsx
17fa51d2a8374b48d6a9289343621eace159423b2e6bb11e3024ea041e13b4bd  apps/mobile/__tests__/TeamFeed.test.tsx
d355a4df3011b41a59c585357d8bfffd41a2a347d3190aaf3963d5acfd13c138  apps/mobile/src/screens/TeamFeedScreen.tsx
f480c16eee266eeebabc465ddb3a2de69732b9804b75cc941322390034132afb  apps/mobile/src/screens/ScreenFrame.tsx
```
