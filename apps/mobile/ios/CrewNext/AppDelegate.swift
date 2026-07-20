import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    var runtimeConfig = [
      "gatewayBaseUrl": Bundle.main.object(forInfoDictionaryKey: "CrewGatewayBaseURL") as? String ?? "",
      "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
      "buildNumber": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
      "platform": "ios",
    ]
#if DEBUG
    runtimeConfig["nativeE2ERequestId"] = Bundle.main.object(forInfoDictionaryKey: "CrewNativeE2ERequestID") as? String ?? ""
#else
    runtimeConfig["nativeE2ERequestId"] = ""
#endif
    factory.startReactNative(
      withModuleName: "CrewNext",
      in: window,
      initialProperties: ["runtimeConfig": runtimeConfig],
      launchOptions: launchOptions
    )

    return true
  }

  func application(
    _ application: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    RCTLinkingManager.application(application, open: url, options: options)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
