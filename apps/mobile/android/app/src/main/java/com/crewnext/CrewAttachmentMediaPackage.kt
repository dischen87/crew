package com.crewnext

import com.facebook.fbreact.specs.NativeCrewAttachmentMediaSpec
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class CrewAttachmentMediaPackage : BaseReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext,
  ): NativeModule? = if (name == NativeCrewAttachmentMediaSpec.NAME) {
    CrewAttachmentMediaModule(reactContext)
  } else {
    null
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      NativeCrewAttachmentMediaSpec.NAME to ReactModuleInfo(
        name = NativeCrewAttachmentMediaSpec.NAME,
        className = CrewAttachmentMediaModule::class.java.name,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
    )
  }
}
