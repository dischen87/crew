package com.crewnext

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Rect
import android.media.ExifInterface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import android.util.Base64
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import com.facebook.fbreact.specs.NativeCrewAttachmentMediaSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.common.LifecycleState
import com.facebook.react.module.annotations.ReactModule
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.CookieHandler
import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLException
import kotlin.math.max
import kotlin.math.roundToInt

@ReactModule(name = NativeCrewAttachmentMediaSpec.NAME)
class CrewAttachmentMediaModule(
  reactContext: ReactApplicationContext,
) : NativeCrewAttachmentMediaSpec(reactContext) {

  // PURGE_SINGLE_WRITER_INVARIANT: every attachment file mutation uses this executor.
  private val mediaExecutor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun invalidate() {
    mediaExecutor.shutdownNow()
    super.invalidate()
  }

  override fun captureCurrentScreen(accountUserId: String, promise: Promise) {
    if (!ACCOUNT.matches(accountUserId)) {
      promise.rejectSafe(INVALID)
      return
    }
    mainHandler.post {
      val target = captureTarget(promise) ?: return@post
      val (activity, content) = target
      val window = activity.window
      val size = boundedSize(content.width, content.height, MAX_CAPTURE_EDGE)
        ?: run {
          promise.rejectSafe(CAPTURE_FAILED)
          return@post
        }
      val bitmap = try {
        Bitmap.createBitmap(size.first, size.second, Bitmap.Config.ARGB_8888)
      } catch (_: Throwable) {
        promise.rejectSafe(CAPTURE_FAILED)
        return@post
      }
      val location = IntArray(2)
      content.getLocationInWindow(location)
      val source = Rect(
        location[0],
        location[1],
        location[0] + content.width,
        location[1] + content.height,
      )
      val decor = window.decorView
      if (
        source.left < 0 || source.top < 0 ||
        source.right > decor.width || source.bottom > decor.height
      ) {
        bitmap.recycle()
        promise.rejectSafe(CAPTURE_FAILED)
        return@post
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        PixelCopy.request(
          window,
          source,
          bitmap,
          { result ->
            val failure = captureFailure(
              activity,
              window,
              content,
              source,
              bitmap,
            )
            if (failure != null) {
              bitmap.recycle()
              promise.rejectSafe(failure)
            } else if (result == PixelCopy.SUCCESS) {
              retainCaptured(accountUserId, bitmap, promise)
            } else if (!containsSurface(content) && drawContent(content, bitmap)) {
              retainCaptured(accountUserId, bitmap, promise)
            } else {
              bitmap.recycle()
              promise.rejectSafe(
                if (result == PixelCopy.ERROR_SOURCE_NO_DATA) CAPTURE_UNAVAILABLE
                else CAPTURE_FAILED,
              )
            }
          },
          mainHandler,
        )
      } else if (!containsSurface(content) && drawContent(content, bitmap)) {
        retainCaptured(accountUserId, bitmap, promise)
      } else {
        bitmap.recycle()
        promise.rejectSafe(CAPTURE_UNAVAILABLE)
      }
    }
  }

  override fun previewRetained(
    accountUserId: String,
    retainedFileKey: String,
    promise: Promise,
  ) {
    runMedia(promise, PREVIEW_FAILED) {
      previewRetainedPng(accountUserId, retainedFileKey)
    }
  }

  override fun uploadRetained(
    accountUserId: String,
    retainedFileKey: String,
    grantUrl: String,
    grantFields: ReadableArray,
    contentType: String,
    byteCount: Double,
    sha256: String,
    promise: Promise,
  ) {
    runMedia(promise, UPLOAD_FAILED) {
      uploadRetainedPng(
        accountUserId,
        retainedFileKey,
        grantUrl,
        grantFields,
        contentType,
        byteCount,
        sha256,
      )
      null
    }
  }

  override fun reconcileRetained(
    accountUserId: String,
    retainedFileKeys: ReadableArray,
    promise: Promise,
  ) {
    runMedia(promise, STORAGE) {
      val referenced = mutableSetOf<String>()
      for (index in 0 until retainedFileKeys.size()) {
        if (retainedFileKeys.getType(index) != ReadableType.String) fail(INVALID_SOURCE)
        val key = retainedFileKeys.getString(index) ?: fail(INVALID_SOURCE)
        if (!RETAINED_KEY.matches(key)) fail(INVALID_SOURCE)
        referenced += key
      }
      val directory = attachmentDirectory(accountUserId)
      val cutoff = System.currentTimeMillis() - RECONCILE_GRACE_MS
      for (file in directory.listFiles() ?: fail(STORAGE)) {
        val temporary = file.name.startsWith('.') && file.name.endsWith(".tmp")
        val orphan = RETAINED_KEY.matches(file.name) && file.name !in referenced &&
          file.lastModified() <= cutoff
        if ((temporary || orphan) && !file.delete()) fail(STORAGE)
      }
      null
    }
  }

  override fun purgeRetained(
    accountUserId: String,
    retainedFileKeys: ReadableArray,
    promise: Promise,
  ) {
    runMedia(promise, STORAGE) {
      if (
        !ACCOUNT.matches(accountUserId) ||
        retainedFileKeys.size() !in 1..MAX_PURGE_BATCH
      ) fail(INVALID)
      val keys = LinkedHashSet<String>(retainedFileKeys.size())
      for (index in 0 until retainedFileKeys.size()) {
        if (retainedFileKeys.getType(index) != ReadableType.String) fail(INVALID)
        val key = retainedFileKeys.getString(index) ?: fail(INVALID)
        if (!PNG_KEY.matches(key)) fail(INVALID)
        keys += key
      }

      val directory = attachmentDirectory(accountUserId)
      val targets = keys.mapNotNull { purgeTarget(directory, it) }
      for (target in targets) {
        val current = purgeTarget(directory, target.name) ?: continue
        if (!current.delete() && purgeTarget(directory, target.name) != null) {
          fail(STORAGE)
        }
      }
      null
    }
  }

  override fun normalizeAndRetain(
    accountUserId: String,
    sourceUri: String,
    promise: Promise,
  ) {
    runMedia(promise, CONVERSION) {
      normalizeAndRetainImage(accountUserId, sourceUri)
    }
  }

  private fun captureTarget(promise: Promise): Pair<Activity, View>? {
    val activity = reactApplicationContext.currentActivity
    if (
      reactApplicationContext.lifecycleState != LifecycleState.RESUMED ||
      activity == null || activity.isFinishing || activity.isDestroyed ||
      !activity.hasWindowFocus()
    ) {
      promise.rejectSafe(CAPTURE_UNAVAILABLE)
      return null
    }
    if (activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
      promise.rejectSafe(UNSAFE)
      return null
    }
    val content = activity.window.decorView.findViewById<View>(android.R.id.content)
    if (
      content == null || !content.isShown || content.windowToken == null ||
      content.width < 1 || content.height < 1
    ) {
      promise.rejectSafe(CAPTURE_UNAVAILABLE)
      return null
    }
    return activity to content
  }

  private fun captureFailure(
    activity: Activity,
    window: android.view.Window,
    content: View,
    expectedSource: Rect,
    destination: Bitmap,
  ): String? {
    if (window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0) {
      return UNSAFE
    }
    if (
      reactApplicationContext.lifecycleState != LifecycleState.RESUMED ||
      reactApplicationContext.currentActivity !== activity ||
      activity.isFinishing || activity.isDestroyed || !activity.hasWindowFocus() ||
      activity.window !== window ||
      window.decorView.findViewById<View>(android.R.id.content) !== content ||
      !content.isShown || content.windowToken == null
    ) return CAPTURE_UNAVAILABLE
    val location = IntArray(2)
    content.getLocationInWindow(location)
    val currentSource = Rect(
      location[0],
      location[1],
      location[0] + content.width,
      location[1] + content.height,
    )
    val currentSize = boundedSize(content.width, content.height, MAX_CAPTURE_EDGE)
      ?: return CAPTURE_FAILED
    return if (
      currentSource != expectedSource || destination.width != currentSize.first ||
      destination.height != currentSize.second ||
      currentSource.left < 0 || currentSource.top < 0 ||
      currentSource.right > window.decorView.width ||
      currentSource.bottom > window.decorView.height
    ) CAPTURE_FAILED else null
  }

  private fun drawContent(content: View, destination: Bitmap): Boolean = try {
    val canvas = Canvas(destination)
    canvas.scale(
      destination.width.toFloat() / content.width,
      destination.height.toFloat() / content.height,
    )
    content.draw(canvas)
    true
  } catch (_: Throwable) {
    false
  }

  private fun containsSurface(view: View): Boolean {
    if (view is SurfaceView || view is TextureView) return true
    if (view !is ViewGroup) return false
    for (index in 0 until view.childCount) {
      if (containsSurface(view.getChildAt(index))) return true
    }
    return false
  }

  private fun retainCaptured(accountUserId: String, bitmap: Bitmap, promise: Promise) {
    try {
      mediaExecutor.execute {
        try {
          promise.resolve(retainBitmap(accountUserId, bitmap))
        } catch (failure: MediaFailure) {
          promise.rejectSafe(failure.safeCode)
        } catch (_: Throwable) {
          promise.rejectSafe(CAPTURE_FAILED)
        } finally {
          bitmap.recycle()
        }
      }
    } catch (_: Throwable) {
      bitmap.recycle()
      promise.rejectSafe(CAPTURE_UNAVAILABLE)
    }
  }

  private fun retainBitmap(accountUserId: String, bitmap: Bitmap): Any {
    if (
      bitmap.width < 1 || bitmap.height < 1 ||
      bitmap.width > MAX_CAPTURE_EDGE || bitmap.height > MAX_CAPTURE_EDGE ||
      bitmap.width.toLong() * bitmap.height > MAX_PIXELS
    ) fail(UNSAFE)
    val directory = attachmentDirectory(accountUserId)
    val temporary = File.createTempFile(".capture-", ".tmp", directory)
    try {
      FileOutputStream(temporary).use { output ->
        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) fail(CAPTURE_FAILED)
        output.fd.sync()
      }
      return retainTemporary(
        temporary,
        "png",
        "image/png",
        bitmap.width,
        bitmap.height,
        true,
      )
    } finally {
      temporary.delete()
    }
  }

  private fun normalizeAndRetainImage(accountUserId: String, sourceUri: String): Any {
    val directory = attachmentDirectory(accountUserId)
    val source = File.createTempFile(".source-", ".tmp", directory)
    try {
      copySource(sourceUri, source)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(source.path, bounds)
      val width = bounds.outWidth
      val height = bounds.outHeight
      val mime = bounds.outMimeType ?: fail(UNSUPPORTED)
      if (
        width < 1 || height < 1 || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE ||
        width.toLong() * height > MAX_SOURCE_PIXELS || mime !in SUPPORTED_MIME ||
        isAnimated(source, mime)
      ) fail(UNSAFE)
      val orientation = readOrientation(source)
      val retainedWidth = if (orientation in ROTATED_ORIENTATIONS) height else width
      val retainedHeight = if (orientation in ROTATED_ORIENTATIONS) width else height
      val heif = mime == "image/heif" || mime == "image/heic"
      if (!heif) {
        if (
          source.length() < 1 || source.length() > MAX_RETAINED_BYTES ||
          retainedWidth > MAX_IMAGE_EDGE || retainedHeight > MAX_IMAGE_EDGE ||
          retainedWidth.toLong() * retainedHeight > MAX_PIXELS
        ) fail(UNSAFE)
        val extension = when (mime) {
          "image/jpeg" -> "jpg"
          "image/png" -> "png"
          "image/webp" -> "webp"
          else -> fail(UNSUPPORTED)
        }
        return retainTemporary(
          source,
          extension,
          mime,
          retainedWidth,
          retainedHeight,
          false,
        )
      }

      val decoded = decodeBoundedBitmap(source, width, height, MAX_IMAGE_EDGE)
      val oriented = orientBitmap(decoded, orientation)
      val bounded = scaleBitmap(oriented, MAX_IMAGE_EDGE)
      val output = File.createTempFile(".normalized-", ".tmp", directory)
      try {
        FileOutputStream(output).use { stream ->
          if (!bounded.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)) {
            fail(CONVERSION)
          }
          stream.fd.sync()
        }
        return retainTemporary(
          output,
          "jpg",
          "image/jpeg",
          bounded.width,
          bounded.height,
          true,
        )
      } finally {
        output.delete()
        if (bounded !== oriented) bounded.recycle()
        if (oriented !== decoded) oriented.recycle()
        decoded.recycle()
      }
    } finally {
      source.delete()
    }
  }

  private fun copySource(sourceUri: String, destination: File) {
    val uri = try {
      Uri.parse(sourceUri)
    } catch (_: Throwable) {
      fail(INVALID_SOURCE)
    }
    val input = when (uri.scheme?.lowercase()) {
      "content" -> reactApplicationContext.contentResolver.openInputStream(uri)
      "file" -> {
        val file = uri.path?.let(::File) ?: fail(INVALID_SOURCE)
        if (!file.isFile || isSymlink(file)) fail(INVALID_SOURCE)
        FileInputStream(file)
      }
      else -> fail(INVALID_SOURCE)
    } ?: fail(INVALID_SOURCE)
    input.use { source ->
      FileOutputStream(destination).use { output ->
        val buffer = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val count = source.read(buffer)
          if (count < 0) break
          total += count
          if (total > MAX_INPUT_BYTES) fail(UNSAFE)
          output.write(buffer, 0, count)
        }
        if (total < 1) fail(INVALID_SOURCE)
        output.fd.sync()
      }
    }
  }

  private fun retainTemporary(
    temporary: File,
    extension: String,
    contentType: String,
    pixelWidth: Int,
    pixelHeight: Int,
    wasNormalized: Boolean,
  ): Any {
    val bytes = temporary.length()
    if (bytes < 1 || bytes > MAX_RETAINED_BYTES) fail(UNSAFE)
    val sha256 = sha256(temporary)
    val finalFile = File(temporary.parentFile, "$sha256.$extension")
    var created = false
    if (finalFile.exists()) {
      if (
        !finalFile.isFile || isSymlink(finalFile) || finalFile.length() != bytes ||
        sha256(finalFile) != sha256
      ) fail(STORAGE)
    } else {
      if (!temporary.renameTo(finalFile)) {
        if (
          !finalFile.isFile || isSymlink(finalFile) || finalFile.length() != bytes ||
          sha256(finalFile) != sha256
        ) fail(STORAGE)
      } else {
        created = true
      }
    }
    if (!finalFile.setLastModified(System.currentTimeMillis())) {
      if (created) finalFile.delete()
      fail(STORAGE)
    }
    return Arguments.createMap().apply {
      putString("retainedFileKey", finalFile.name)
      putString("contentType", contentType)
      putDouble("byteCount", bytes.toDouble())
      putString("sha256", sha256)
      putDouble("pixelWidth", pixelWidth.toDouble())
      putDouble("pixelHeight", pixelHeight.toDouble())
      putBoolean("wasNormalized", wasNormalized)
    }
  }

  private fun previewRetainedPng(accountUserId: String, retainedFileKey: String): String {
    val file = resolveRetainedPng(accountUserId, retainedFileKey)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (
      bounds.outMimeType != "image/png" || bounds.outWidth < 1 || bounds.outHeight < 1 ||
      bounds.outWidth > MAX_CAPTURE_EDGE || bounds.outHeight > MAX_CAPTURE_EDGE ||
      bounds.outWidth.toLong() * bounds.outHeight > MAX_PIXELS ||
      isAnimated(file, "image/png")
    ) fail(UNSAFE)
    val decoded = decodeBoundedBitmap(
      file,
      bounds.outWidth,
      bounds.outHeight,
      MAX_PREVIEW_EDGE,
    )
    var current = orientBitmap(decoded, readOrientation(file))
    if (current !== decoded) decoded.recycle()
    val scaled = scaleBitmap(current, MAX_PREVIEW_EDGE)
    if (scaled !== current) current.recycle()
    current = scaled
    try {
      while (true) {
        val output = ByteArrayOutputStream()
        if (!current.compress(Bitmap.CompressFormat.PNG, 100, output)) fail(PREVIEW_FAILED)
        val png = output.toByteArray()
        if (png.isNotEmpty() && png.size <= MAX_PREVIEW_BYTES) {
          return "data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP)
        }
        if (current.width == 1 && current.height == 1) fail(PREVIEW_FAILED)
        val scaled = Bitmap.createScaledBitmap(
          current,
          max(1, current.width * 3 / 4),
          max(1, current.height * 3 / 4),
          true,
        )
        if (scaled !== current) current.recycle()
        current = scaled
      }
    } finally {
      current.recycle()
      if (!decoded.isRecycled) decoded.recycle()
    }
  }

  private fun uploadRetainedPng(
    accountUserId: String,
    retainedFileKey: String,
    grantUrl: String,
    grantFields: ReadableArray,
    contentType: String,
    byteCount: Double,
    expectedSha256: String,
  ) {
    if (
      !SHA256.matches(expectedSha256) || retainedFileKey != "$expectedSha256.png" ||
      contentType != "image/png" || byteCount < 1 || byteCount > MAX_RETAINED_BYTES ||
      byteCount != byteCount.toLong().toDouble()
    ) fail(INVALID)
    val file = resolveRetainedPng(accountUserId, retainedFileKey)
    if (file.length().toDouble() != byteCount) fail(UNSAFE)
    val fields = validateUploadFields(grantFields)
    val uri = try {
      URI(grantUrl)
    } catch (_: Throwable) {
      fail(INVALID)
    }
    if (
      grantUrl.isEmpty() || grantUrl.length > MAX_GRANT_URL_CHARS ||
      uri.scheme?.lowercase() != "https" || uri.host.isNullOrEmpty() ||
      uri.rawUserInfo != null || uri.rawFragment != null
    ) fail(INVALID)
    val boundary = "CrewBoundary" + UUID.randomUUID().toString().replace("-", "")
    val prefix = ByteArrayOutputStream()
    for (field in fields) {
      prefix.writeUtf8("--$boundary\r\n")
      prefix.writeUtf8("Content-Disposition: form-data; name=\"${field.name}\"\r\n\r\n")
      prefix.writeUtf8(field.value)
      prefix.writeUtf8("\r\n")
    }
    prefix.writeUtf8("--$boundary\r\n")
    prefix.writeUtf8(
      "Content-Disposition: form-data; name=\"file\"; filename=\"$retainedFileKey\"\r\n",
    )
    prefix.writeUtf8("Content-Type: image/png\r\n\r\n")
    val suffix = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
    val contentLength = prefix.size().toLong() + file.length() + suffix.size
    if (CookieHandler.getDefault() != null) fail(UPLOAD_UNAVAILABLE)
    val connection = try {
      uri.toURL().openConnection() as HttpsURLConnection
    } catch (_: Throwable) {
      fail(INVALID)
    }
    try {
      connection.requestMethod = "POST"
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.defaultUseCaches = false
      connection.doInput = true
      connection.doOutput = true
      connection.connectTimeout = 30_000
      connection.readTimeout = 60_000
      connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
      connection.setRequestProperty("Cache-Control", "no-store")
      connection.setRequestProperty("Pragma", "no-cache")
      connection.setRequestProperty("Cookie", "")
      connection.setRequestProperty("Cookie2", "")
      connection.setFixedLengthStreamingMode(contentLength)
      connection.outputStream.use { output ->
        prefix.writeTo(output)
        FileInputStream(file).use { input -> input.copyTo(output, 64 * 1024) }
        output.write(suffix)
        output.flush()
      }
      val status = connection.responseCode
      when {
        status in 200..299 -> return
        status == 408 || status == 425 || status == 429 || status >= 500 ->
          fail(UPLOAD_RETRYABLE)
        else -> fail(UPLOAD_UNAVAILABLE)
      }
    } catch (_: SSLException) {
      fail(UPLOAD_UNAVAILABLE)
    } catch (_: IOException) {
      fail(UPLOAD_RETRYABLE)
    } finally {
      try {
        connection.disconnect()
      } catch (_: Throwable) {
        // The upload result is already fixed; disconnect cannot expose a new cause.
      }
    }
  }

  private fun validateUploadFields(grantFields: ReadableArray): List<UploadField> {
    if (grantFields.size() !in 1..MAX_GRANT_FIELDS) fail(INVALID)
    val fields = ArrayList<UploadField>(grantFields.size())
    val names = mutableSetOf<String>()
    var totalBytes = 0
    for (index in 0 until grantFields.size()) {
      if (grantFields.getType(index) != ReadableType.Map) fail(INVALID)
      val map = grantFields.getMap(index) ?: fail(INVALID)
      if (
        !map.hasKey("name") || !map.hasKey("value") ||
        map.getType("name") != ReadableType.String ||
        map.getType("value") != ReadableType.String
      ) fail(INVALID)
      val name = map.getString("name") ?: fail(INVALID)
      val value = map.getString("value") ?: fail(INVALID)
      val nameBytes = name.toByteArray(StandardCharsets.UTF_8)
      val valueBytes = value.toByteArray(StandardCharsets.UTF_8)
      if (
        !FIELD_NAME.matches(name) || name.equals("file", ignoreCase = true) ||
        name in names || nameBytes.size > MAX_GRANT_FIELD_NAME_BYTES ||
        valueBytes.size > MAX_GRANT_FIELD_VALUE_BYTES
      ) fail(INVALID)
      totalBytes += nameBytes.size + valueBytes.size
      if (totalBytes > MAX_GRANT_FIELD_BYTES) fail(INVALID)
      names += name
      fields += UploadField(name, value)
    }
    return fields
  }

  private fun resolveRetainedPng(accountUserId: String, retainedFileKey: String): File {
    if (
      !ACCOUNT.matches(accountUserId) || !PNG_KEY.matches(retainedFileKey) ||
      retainedFileKey != "${retainedFileKey.removeSuffix(".png")}.png"
    ) fail(INVALID)
    val directory = attachmentDirectory(accountUserId)
    val file = File(directory, retainedFileKey)
    if (!file.exists()) fail(MISSING)
    if (
      !file.isFile || isSymlink(file) ||
      file.canonicalFile.parentFile != directory.canonicalFile ||
      file.canonicalFile.name != retainedFileKey ||
      file.length() !in 1..MAX_RETAINED_BYTES
    ) fail(UNSAFE)
    FileInputStream(file).use { input ->
      val signature = ByteArray(PNG_SIGNATURE.size)
      if (input.read(signature) != signature.size || !signature.contentEquals(PNG_SIGNATURE)) {
        fail(UNSAFE)
      }
    }
    if (sha256(file) != retainedFileKey.removeSuffix(".png")) fail(UNSAFE)
    return file
  }

  private fun purgeTarget(directory: File, retainedFileKey: String): File? {
    val file = File(directory, retainedFileKey)
    val stat = try {
      Os.lstat(file.absolutePath)
    } catch (error: ErrnoException) {
      if (error.errno == OsConstants.ENOENT) return null
      fail(STORAGE)
    } catch (_: Throwable) {
      fail(STORAGE)
    }
    if (
      (stat.st_mode and OsConstants.S_IFMT) != OsConstants.S_IFREG ||
      stat.st_nlink != 1L
    ) fail(UNSAFE)
    val canonical = try {
      file.canonicalFile
    } catch (_: Throwable) {
      fail(STORAGE)
    }
    if (
      canonical.parentFile != directory.canonicalFile ||
      canonical.name != retainedFileKey
    ) fail(UNSAFE)
    return file
  }

  private fun attachmentDirectory(accountUserId: String): File {
    if (!ACCOUNT.matches(accountUserId)) fail(INVALID)
    val privateRoot = reactApplicationContext.noBackupFilesDir.canonicalFile
    val root = File(privateRoot, "CrewAttachments")
    if ((!root.exists() && !root.mkdirs()) || !root.isDirectory || isSymlink(root)) fail(STORAGE)
    if (root.canonicalFile.parentFile != privateRoot) fail(UNSAFE)
    val directory = File(root, accountUserId)
    if (
      (!directory.exists() && !directory.mkdirs()) || !directory.isDirectory ||
      isSymlink(directory) || directory.canonicalFile.parentFile != root.canonicalFile
    ) fail(STORAGE)
    return directory.canonicalFile
  }

  private fun decodeBoundedBitmap(
    file: File,
    width: Int,
    height: Int,
    maxEdge: Int,
  ): Bitmap {
    var sample = 1
    while (width / sample > maxEdge || height / sample > maxEdge) sample *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeFile(file.path, options) ?: fail(CONVERSION)
  }

  private fun scaleBitmap(bitmap: Bitmap, maxEdge: Int): Bitmap {
    val size = boundedSize(bitmap.width, bitmap.height, maxEdge) ?: fail(UNSAFE)
    return if (size.first == bitmap.width && size.second == bitmap.height) bitmap
    else Bitmap.createScaledBitmap(bitmap, size.first, size.second, true)
  }

  private fun orientBitmap(bitmap: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        matrix.setRotate(90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        matrix.setRotate(-90f)
        matrix.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return bitmap
    }
    return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
  }

  private fun readOrientation(file: File): Int = try {
    ExifInterface(file.path).getAttributeInt(
      ExifInterface.TAG_ORIENTATION,
      ExifInterface.ORIENTATION_NORMAL,
    )
  } catch (_: Throwable) {
    ExifInterface.ORIENTATION_NORMAL
  }

  private fun isAnimated(file: File, mime: String): Boolean = try {
    when (mime) {
      "image/png" -> pngHasAnimation(file)
      "image/webp" -> webpHasAnimation(file)
      else -> false
    }
  } catch (_: Throwable) {
    true
  }

  private fun pngHasAnimation(file: File): Boolean {
    RandomAccessFile(file, "r").use { input ->
      if (input.length() < 20) return true
      input.seek(8)
      repeat(128) {
        if (input.filePointer + 12 > input.length()) return true
        val size = input.readInt().toLong() and 0xffffffffL
        val type = ByteArray(4).also(input::readFully).toString(StandardCharsets.US_ASCII)
        if (size > input.length() - input.filePointer - 4) return true
        if (type == "acTL") return true
        if (type == "IDAT" || type == "IEND") return false
        input.seek(input.filePointer + size + 4)
      }
      return true
    }
  }

  private fun webpHasAnimation(file: File): Boolean {
    RandomAccessFile(file, "r").use { input ->
      if (input.length() < 20) return true
      val header = ByteArray(12).also(input::readFully)
      if (
        header.copyOfRange(0, 4).toString(StandardCharsets.US_ASCII) != "RIFF" ||
        header.copyOfRange(8, 12).toString(StandardCharsets.US_ASCII) != "WEBP"
      ) return true
      repeat(128) {
        if (input.filePointer + 8 > input.length()) return true
        val type = ByteArray(4).also(input::readFully).toString(StandardCharsets.US_ASCII)
        val sizeBytes = ByteArray(4).also(input::readFully)
        val size = (sizeBytes[0].toLong() and 0xff) or
          ((sizeBytes[1].toLong() and 0xff) shl 8) or
          ((sizeBytes[2].toLong() and 0xff) shl 16) or
          ((sizeBytes[3].toLong() and 0xff) shl 24)
        if (size > input.length() - input.filePointer) return true
        if (type == "ANIM" || type == "ANMF") return true
        if (type == "VP8 " || type == "VP8L") return false
        input.seek(input.filePointer + size + (size and 1))
      }
      return true
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  private fun isSymlink(file: File): Boolean = try {
    val mode = Os.lstat(file.absolutePath).st_mode
    mode and OsConstants.S_IFMT == OsConstants.S_IFLNK
  } catch (_: Throwable) {
    fail(STORAGE)
  }

  private fun runMedia(promise: Promise, fallback: String, block: () -> Any?) {
    try {
      mediaExecutor.execute {
        try {
          promise.resolve(block())
        } catch (failure: MediaFailure) {
          promise.rejectSafe(failure.safeCode)
        } catch (_: Throwable) {
          promise.rejectSafe(fallback)
        }
      }
    } catch (_: Throwable) {
      promise.rejectSafe(fallback)
    }
  }

  private data class UploadField(val name: String, val value: String)

  private class MediaFailure(val safeCode: String) : RuntimeException()

  private fun fail(code: String): Nothing = throw MediaFailure(code)

  private fun Promise.rejectSafe(code: String) = reject(code, code)

  private fun ByteArrayOutputStream.writeUtf8(value: String) {
    write(value.toByteArray(StandardCharsets.UTF_8))
  }

  private fun boundedSize(width: Int, height: Int, maxEdge: Int): Pair<Int, Int>? {
    if (width < 1 || height < 1 || width.toLong() * height > MAX_PIXELS) return null
    val scale = minOf(1.0, maxEdge.toDouble() / max(width, height))
    return max(1, (width * scale).roundToInt()) to
      max(1, (height * scale).roundToInt())
  }

  companion object {
    private const val MAX_INPUT_BYTES = 64L * 1024 * 1024
    private const val MAX_RETAINED_BYTES = 20L * 1024 * 1024
    private const val MAX_SOURCE_EDGE = 20_000
    private const val MAX_SOURCE_PIXELS = 100L * 1000 * 1000
    private const val MAX_IMAGE_EDGE = 4096
    private const val MAX_CAPTURE_EDGE = 2048
    private const val MAX_PREVIEW_EDGE = 512
    private const val MAX_PREVIEW_BYTES = 512 * 1024
    private const val MAX_PIXELS = 16L * 1024 * 1024
    private const val JPEG_QUALITY = 82
    private const val RECONCILE_GRACE_MS = 5L * 60 * 1000
    private const val MAX_GRANT_URL_CHARS = 8192
    private const val MAX_GRANT_FIELDS = 64
    private const val MAX_GRANT_FIELD_NAME_BYTES = 128
    private const val MAX_GRANT_FIELD_VALUE_BYTES = 16 * 1024
    private const val MAX_GRANT_FIELD_BYTES = 64 * 1024
    private const val MAX_PURGE_BATCH = 64

    private const val INVALID_SOURCE = "attachment_media_invalid_source"
    private const val UNSUPPORTED = "attachment_media_unsupported"
    private const val UNSAFE = "attachment_media_unsafe"
    private const val CONVERSION = "attachment_media_conversion"
    private const val STORAGE = "attachment_media_storage"
    private const val INVALID = "attachment_media_invalid"
    private const val MISSING = "attachment_media_missing"
    private const val CAPTURE_UNAVAILABLE = "attachment_media_capture_unavailable"
    private const val CAPTURE_FAILED = "attachment_media_capture_failed"
    private const val PREVIEW_FAILED = "attachment_media_preview_failed"
    private const val UPLOAD_RETRYABLE = "attachment_media_upload_retryable"
    private const val UPLOAD_UNAVAILABLE = "attachment_media_upload_unavailable"
    private const val UPLOAD_FAILED = "attachment_media_upload_failed"

    private val ACCOUNT = Regex("^usr_[a-f0-9]{32}$")
    private val SHA256 = Regex("^[a-f0-9]{64}$")
    private val PNG_KEY = Regex("^[a-f0-9]{64}\\.png$")
    private val RETAINED_KEY = Regex("^[a-f0-9]{64}\\.(?:jpg|png|webp)$")
    private val FIELD_NAME = Regex("^[A-Za-z0-9_.-]{1,128}$")
    private val SUPPORTED_MIME = setOf(
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heif",
      "image/heic",
    )
    private val ROTATED_ORIENTATIONS = setOf(
      ExifInterface.ORIENTATION_TRANSPOSE,
      ExifInterface.ORIENTATION_ROTATE_90,
      ExifInterface.ORIENTATION_TRANSVERSE,
      ExifInterface.ORIENTATION_ROTATE_270,
    )
    private val PNG_SIGNATURE = byteArrayOf(
      0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    )
  }
}
