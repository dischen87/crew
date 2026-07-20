const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const read = relativePath =>
  readFileSync(resolve(appRoot, relativePath), 'utf8');

test('registers the complete bounded Android attachment TurboModule', () => {
  const native = read(
    'android/app/src/main/java/com/crewnext/CrewAttachmentMediaModule.kt',
  );
  const packageSource = read(
    'android/app/src/main/java/com/crewnext/CrewAttachmentMediaPackage.kt',
  );
  const application = read(
    'android/app/src/main/java/com/crewnext/MainApplication.kt',
  );
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  for (const method of [
    'captureCurrentScreen',
    'previewRetained',
    'uploadRetained',
    'purgeRetained',
    'reconcileRetained',
    'normalizeAndRetain',
  ]) {
    expect(native).toContain(`override fun ${method}`);
  }
  expect(packageSource).toContain('NativeCrewAttachmentMediaSpec.NAME');
  expect(packageSource).toContain('isTurboModule');
  expect(application).toContain('add(CrewAttachmentMediaPackage())');

  expect(native).toContain('import com.facebook.react.common.LifecycleState');
  expect(native).not.toContain(
    'import com.facebook.react.bridge.LifecycleState',
  );
  expect(native).toContain('findViewById<View>(android.R.id.content)');
  expect(native).toContain('WindowManager.LayoutParams.FLAG_SECURE');
  expect(native).toContain('PixelCopy.request');
  expect(native).toContain('currentSource != expectedSource');
  expect(native).toContain('view is SurfaceView || view is TextureView');
  expect(native).toContain('MAX_CAPTURE_EDGE = 2048');
  expect(native).toContain('MAX_PREVIEW_EDGE = 512');
  expect(native).toContain('MAX_PREVIEW_BYTES = 512 * 1024');
  expect(native).toContain('MAX_PURGE_BATCH = 64');
  expect(native).toContain('retainedFileKeys.size() !in 1..MAX_PURGE_BATCH');
  expect(native).toContain('Os.lstat(file.absolutePath)');
  expect(native).toContain('OsConstants.S_IFREG');
  expect(native).toContain('stat.st_nlink != 1L');
  expect(native).toContain('if (error.errno == OsConstants.ENOENT) return null');
  expect(native).toContain('PURGE_SINGLE_WRITER_INVARIANT');
  expect(native).toContain('Executors.newSingleThreadExecutor()');

  expect(native).toContain('CookieHandler.getDefault() != null');
  expect(native).toContain('connection.instanceFollowRedirects = false');
  expect(native).toContain('connection.useCaches = false');
  expect(native).toContain('connection.defaultUseCaches = false');
  expect(native).not.toMatch(/connection\.(?:inputStream|errorStream)/);
  expect(native).not.toMatch(/Log\.|println\(|printStackTrace/);
  expect(manifest).not.toMatch(
    /READ_MEDIA_IMAGES|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/,
  );
});
