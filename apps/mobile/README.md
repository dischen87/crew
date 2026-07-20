This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.

## Release runtime configuration

Release binaries do not guess a Gateway host. Native build settings pass one
immutable `runtimeConfig` root property to React Native:

| Field            | Rule                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `gatewayBaseUrl` | Explicit canonical HTTPS origin; no credentials, path, query, or hash |
| `appVersion`     | Bounded structured version from the platform build                    |
| `buildNumber`    | Bounded numeric build value from the platform build                   |
| `platform`       | Exactly `ios` or `android`                                            |

If the Release Gateway value is absent or invalid, the app keeps its Gateway
client `null` and network features fail closed. Development ignores this value
and remains pinned to `http://127.0.0.1:3000`; Release also rejects localhost,
loopback names, and loopback addresses. No token, credential, device ID, or
remote configuration channel is part of this contract.

The examples below use documentation-only origins. They are not claims about a
deployed or smoke-tested endpoint.

### iOS staging or production injection

Pass the exact environment origin and release metadata as Xcode build settings:

```sh
xcodebuild \
  -workspace ios/CrewNext.xcworkspace \
  -scheme CrewNext \
  -configuration Release \
  CREW_GATEWAY_BASE_URL=https://gateway.staging.example.invalid \
  MARKETING_VERSION=1.0.0 \
  CURRENT_PROJECT_VERSION=100 \
  archive
```

Use the separately approved production origin for a production archive. The
same values expand into `CrewGatewayBaseURL`,
`CFBundleShortVersionString`, and `CFBundleVersion` in the signed app bundle.

### Android staging or production injection

Pass the equivalent Gradle project properties:

```sh
cd android
./gradlew app:bundleRelease \
  -PcrewGatewayBaseUrl=https://gateway.staging.example.invalid \
  -PcrewVersionName=1.0.0 \
  -PcrewVersionCode=100
```

Gradle JSON-escapes the Gateway value before generating
`BuildConfig.CREW_GATEWAY_BASE_URL`. `VERSION_NAME` and `VERSION_CODE` provide
the other two values.

### Verification and rollback

Before promotion, inspect the built Info.plist or BuildConfig values and smoke
one authenticated Gateway request against the approved environment. Do not
claim an endpoint live from a successful compile alone.

Rollback means redistributing the last known-good signed artifact. If a rebuild
is required, use the prior exact origin, version, and build inputs; do not patch
app storage, inject a runtime override, or fall back to a guessed host. An empty
Gateway setting is the explicit emergency network-off build.

The feedback composer previews the bounded version/build/platform projection
and an abstract context category, with diagnostics off by default. Only an
explicit per-feedback opt-in attaches those allow-listed values; account or
source changes reset that choice. Missing or malformed metadata leaves
`diagnostics: null` and never blocks text feedback. Opening or sending text
feedback alone is not consent to attach diagnostics.
