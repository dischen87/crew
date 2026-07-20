# Release runtime configuration evidence

Captured on 2026-07-19 for `crew-paq.9.5.2` from the shared `crew-new`
workspace. The configured builds use
`https://gateway.staging.example.invalid`, a documentation-only reserved origin.
No live Gateway or authenticated network smoke is claimed.

## Contract exercised

- Native code passes only `gatewayBaseUrl`, `appVersion`, `buildNumber`, and
  `platform` as the immutable React Native root configuration.
- Release accepts only a canonical non-loopback HTTPS origin. Empty or invalid
  values create no Gateway client. Development remains pinned to local loopback.
- Neither native binary carries a token, credential, device identifier, nor a
  remotely mutable configuration channel.
- Release manifests disallow cleartext traffic. Feedback diagnostics remain
  behind the separate default-off consent and preview boundary.

## iOS Release builds

Both builds used `CrewNext.xcworkspace`, scheme `CrewNext`, configuration
`Release`, generic iOS Simulator destination, and an isolated DerivedData path.
Both `xcodebuild` invocations exited 0.

| Build | Embedded Gateway | Version/build | Info.plist SHA-256 | JS bundle SHA-256 | Executable SHA-256 |
| --- | --- | --- | --- | --- | --- |
| Configured | `https://gateway.staging.example.invalid` | `1.0.0` / `100` | `e28df70927fe264dcc4121e46a0137149b7004a7c78a1a5be732bce3ed85ca82` | `a4248ac6e85868e6d52b17d3d3720af7d67d4fd4d084c4340d77cbf1d7f5e584` | `885b6f87061734a5d9015d19b866847ea0f63e56b80de366d8d82869930c9882` |
| Unconfigured | empty, length 0 | `1.0.0` / `101` | `af25b1d69a2d8c5c9eefcdbb961cf0c45763aecae254fa50cfa91197abb6e8aa` | `43901e7393b50415a08d57a8540adcd0fdaad9bd0e2e0e07651db52c0343c0ab` | `33541ebe8a9a525fdbd4455753964cd638be5e857d23a34464574c5bb201db33` |

Values were read from the built app's `Info.plist`, not inferred from source.
The build emitted only known third-party React Native/dependency warnings.
`xcodebuild clean` completed afterward; the isolated cache residue was 288 MiB.

## Android Release builds

Both arm64 builds ran `app:assembleRelease` with Gradle 9.3.1 and Java 17 and
exited 0. The generated `BuildConfig.java`, merged manifest, packaged APK
metadata, and unsigned APK were inspected directly.

| Build | BuildConfig Gateway | Version/build | Cleartext | Unsigned APK SHA-256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| Configured | `https://gateway.staging.example.invalid` | `1.0.0` / `100` | `false` | `b0e2288939cfa72d7027e83946a05b3f676bacc47694ad9cd0fdda1e9aea3b4d` | `33,621,093` |
| Unconfigured | empty string | `1.0.0` / `101` | `false` | `72e3ae6dc3b5429f3e46588b181b115a057fcd835fc11db56d27110a919229c7` | `33,626,533` |

The production-shaped APKs remain intentionally unsigned until Crew-owned
release credentials exist. For launch proof only, copies were signed locally
with the repository's Android debug key. This is not release signing and no
release credential was introduced. Each copy installed with `adb install -r`,
cold-launched with `Status: ok`, became the resumed activity, and produced no
fatal Android/React Native log entry. The configured smoke used build 100; the
unconfigured fail-closed smoke used build 101.

- [Configured launch screenshot](android-configured-release-runtime.png)
- [Unconfigured launch screenshot](android-unconfigured-release-runtime.png)

`app:clean` completed after inspection. The emulator intentionally retains the
locally test-signed unconfigured `1.0.0` / `101` smoke build.

## Regression gates

- Runtime-config Jest: 3 suites, 38 tests passed.
- Full mobile Jest: 45 suites, 294 tests passed.
- Mobile TypeScript and ESLint passed.
- The `.invalid` origin was not contacted, so deployment and live Gateway smoke
  remain explicitly out of scope for this evidence.
