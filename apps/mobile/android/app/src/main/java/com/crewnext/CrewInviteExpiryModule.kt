package com.crewnext

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.os.Handler
import android.os.Looper
import android.text.format.DateFormat
import com.facebook.fbreact.specs.NativeCrewInviteExpirySpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.common.LifecycleState
import com.facebook.react.module.annotations.ReactModule
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@ReactModule(name = NativeCrewInviteExpirySpec.NAME)
class CrewInviteExpiryModule(
  reactContext: ReactApplicationContext,
) : NativeCrewInviteExpirySpec(reactContext) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var dateDialog: DatePickerDialog? = null
  private var invalidated = false
  private var pending: Pending? = null
  private var timeDialog: TimePickerDialog? = null

  override fun pickExpiry(
    initialExpiresAt: String,
    minimumExpiresAt: String,
    promise: Promise,
  ) {
    val initial = parseIso(initialExpiresAt)
    val minimum = parseIso(minimumExpiresAt)
    if (initial == null || minimum == null) {
      promise.rejectSafe(INVALID)
      return
    }
    mainHandler.post {
      val activity = reactApplicationContext.currentActivity
      if (
        invalidated || pending != null ||
        reactApplicationContext.lifecycleState != LifecycleState.RESUMED ||
        activity == null || activity.isFinishing || activity.isDestroyed
      ) {
        promise.rejectSafe(UNAVAILABLE)
        return@post
      }
      val timeZone = TimeZone.getDefault()
      val request = Pending(
        initial = if (initial.before(minimum)) minimum else initial,
        minimum = minimum,
        promise = promise,
        timeZone = timeZone,
      )
      pending = request
      val initialCalendar = Calendar.getInstance(timeZone).apply {
        time = request.initial
      }
      val dialog = DatePickerDialog(
        activity,
        { _, year, month, day ->
          dateDialog = null
          showTimePicker(request, year, month, day)
        },
        initialCalendar.get(Calendar.YEAR),
        initialCalendar.get(Calendar.MONTH),
        initialCalendar.get(Calendar.DAY_OF_MONTH),
      )
      dialog.datePicker.minDate = request.minimum.time
      dialog.setOnCancelListener { resolve(request, null) }
      dateDialog = dialog
      try {
        dialog.show()
      } catch (_: Throwable) {
        reject(request, UNAVAILABLE)
      }
    }
  }

  private fun showTimePicker(
    request: Pending,
    year: Int,
    month: Int,
    day: Int,
  ) {
    if (pending !== request) return
    val activity = reactApplicationContext.currentActivity
    if (
      invalidated ||
      reactApplicationContext.lifecycleState != LifecycleState.RESUMED ||
      activity == null || activity.isFinishing || activity.isDestroyed
    ) {
      reject(request, UNAVAILABLE)
      return
    }
    val initialCalendar = Calendar.getInstance(request.timeZone).apply {
      time = request.initial
    }
    val dialog = TimePickerDialog(
      activity,
      { _, hour, minute ->
        timeDialog = null
        finishSelection(request, year, month, day, hour, minute)
      },
      initialCalendar.get(Calendar.HOUR_OF_DAY),
      initialCalendar.get(Calendar.MINUTE),
      DateFormat.is24HourFormat(activity),
    )
    dialog.setOnCancelListener { resolve(request, null) }
    timeDialog = dialog
    try {
      dialog.show()
    } catch (_: Throwable) {
      reject(request, UNAVAILABLE)
    }
  }

  private fun finishSelection(
    request: Pending,
    year: Int,
    month: Int,
    day: Int,
    hour: Int,
    minute: Int,
  ) {
    if (pending !== request) return
    val calendar = Calendar.getInstance(request.timeZone).apply {
      isLenient = false
      clear()
      set(year, month, day, hour, minute, 0)
      set(Calendar.MILLISECOND, 0)
    }
    val selected = try {
      Date(calendar.timeInMillis)
    } catch (_: IllegalArgumentException) {
      reject(request, INVALID)
      return
    }
    if (
      selected.before(request.minimum) ||
      calendar.get(Calendar.YEAR) != year ||
      calendar.get(Calendar.MONTH) != month ||
      calendar.get(Calendar.DAY_OF_MONTH) != day ||
      calendar.get(Calendar.HOUR_OF_DAY) != hour ||
      calendar.get(Calendar.MINUTE) != minute
    ) {
      reject(request, INVALID)
      return
    }
    val expiresAt = formatIso(selected)
    val roundTrip = parseIso(expiresAt)
    if (roundTrip?.time != selected.time) {
      reject(request, INVALID)
      return
    }
    resolve(
      request,
      Arguments.createMap().apply {
        putString("expiresAt", expiresAt)
        putString("timeZone", request.timeZone.id)
      },
    )
  }

  private fun resolve(request: Pending, value: Any?) {
    if (pending !== request) return
    pending = null
    dateDialog = null
    timeDialog = null
    request.promise.resolve(value)
  }

  private fun reject(request: Pending, code: String) {
    if (pending !== request) return
    pending = null
    dateDialog = null
    timeDialog = null
    request.promise.rejectSafe(code)
  }

  override fun invalidate() {
    mainHandler.post {
      invalidated = true
      dateDialog?.dismiss()
      timeDialog?.dismiss()
      pending?.let { resolve(it, null) }
    }
    super.invalidate()
  }

  private data class Pending(
    val initial: Date,
    val minimum: Date,
    val promise: Promise,
    val timeZone: TimeZone,
  )

  companion object {
    private const val INVALID = "invite_expiry_picker_invalid"
    private const val UNAVAILABLE = "invite_expiry_picker_unavailable"
    private val UTC = TimeZone.getTimeZone("UTC")

    private fun isoFormatter() =
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        isLenient = false
        timeZone = UTC
      }

    private fun parseIso(value: String): Date? {
      val formatter = isoFormatter()
      val parsed = runCatching { formatter.parse(value) }.getOrNull()
      return parsed?.takeIf { formatter.format(it) == value }
    }

    private fun formatIso(value: Date): String = isoFormatter().format(value)

    private fun Promise.rejectSafe(code: String) {
      reject(code, code)
    }
  }
}
