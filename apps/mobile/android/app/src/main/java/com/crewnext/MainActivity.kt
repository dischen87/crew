package com.crewnext

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "CrewNext"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle =
            Bundle().apply {
              putBundle(
                  "runtimeConfig",
                  Bundle().apply {
                    putString("gatewayBaseUrl", BuildConfig.CREW_GATEWAY_BASE_URL)
                    putString("appVersion", BuildConfig.VERSION_NAME)
                    putString("buildNumber", BuildConfig.VERSION_CODE.toString())
                    putString("nativeE2ERequestId", BuildConfig.CREW_NATIVE_E2E_REQUEST_ID)
                    putString("platform", "android")
                  },
              )
            }
      }
}
