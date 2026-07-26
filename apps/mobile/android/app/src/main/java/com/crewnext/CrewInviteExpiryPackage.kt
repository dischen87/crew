package com.crewnext

import com.facebook.fbreact.specs.NativeCrewInviteExpirySpec
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class CrewInviteExpiryPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? = if (name == NativeCrewInviteExpirySpec.NAME) {
    CrewInviteExpiryModule(reactContext)
  } else {
    null
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      NativeCrewInviteExpirySpec.NAME to ReactModuleInfo(
        name = NativeCrewInviteExpirySpec.NAME,
        className = CrewInviteExpiryModule::class.java.name,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
    )
  }
}
