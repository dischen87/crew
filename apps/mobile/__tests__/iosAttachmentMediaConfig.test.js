const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');

test('registers bounded native iOS attachment processing', () => {
  const native = readFileSync(
    resolve(appRoot, 'ios/CrewNext/CrewAttachmentMedia.mm'),
    'utf8',
  );
  const project = readFileSync(
    resolve(appRoot, 'ios/CrewNext.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const packageJson = JSON.parse(
    readFileSync(resolve(appRoot, 'package.json'), 'utf8'),
  );

  expect(packageJson.codegenConfig.ios.modulesProvider).toEqual({
    CrewAttachmentMedia: 'CrewAttachmentMedia',
  });
  expect(project).toContain('CrewAttachmentMedia.mm in Sources');
  expect(native).toContain('kCGImageSourceCreateThumbnailWithTransform');
  expect(native).toContain('kCGImageSourceThumbnailMaxPixelSize');
  expect(native).toContain('kCGImageDestinationLossyCompressionQuality');
  expect(native).toContain('UTTypeHEIC');
  expect(native).toContain('UTTypeHEIF');
  expect(native).toContain('UTTypeJPEG');
  expect(native).toContain('UTTypePNG');
  expect(native).toContain('UTTypeWebP');
  expect(native).toContain('copyItemAtURL:sourceURL');
  expect(native.indexOf('copyItemAtURL:sourceURL')).toBeLessThan(
    native.indexOf('CGImageSourceCreateWithURL('),
  );
  expect(native).toContain('(__bridge CFURLRef)sourceSnapshotURL');
  expect(native).toContain('CrewSHA256(temporaryURL');
  expect(native).toContain('moveItemAtURL:temporaryURL');
  expect(native).toContain('CrewReconcileRetained');
  expect(native).toContain('CrewPurgeRetained');
  expect(native).toContain('MaxPurgeBatch = 64');
  expect(native).toContain('retainedFileKeys.count < 1');
  expect(native).toContain('lstat(file.fileSystemRepresentation');
  expect(native).toContain('S_ISREG(attributes.st_mode)');
  expect(native).toContain('attributes.st_nlink != 1');
  expect(native).toContain('PURGE_SINGLE_WRITER_INVARIANT');
  expect(native).toContain('ReconcileFinalGraceSeconds = 5 * 60');
  expect(native).toContain('timeIntervalSinceDate:modifiedAt');
  expect(native).toContain('NSFileModificationDate : NSDate.date');
  expect(native).toContain('removeItemAtURL:url');
  expect(native).toContain('NSFileProtectionComplete');
  expect(native).toContain('DISPATCH_QUEUE_SERIAL');
  expect(native).toContain('URLByAppendingPathComponent:accountUserId');
  expect(native).toContain('CrewValidatePrivateDirectory(rootDirectory');
  expect(native).toContain('CrewValidatePrivateDirectory(directory');
  expect(native).toContain('CrewValidateRetainedFile(retainedURL');
  expect(native).toContain('NSURLIsSymbolicLinkKey');
  expect(native).toContain('CrewCaptureCurrentScreen');
  expect(native).toContain('MaxCapturePixelDimension = 2048');
  expect(native).toContain('CrewPreviewRetainedPNG');
  expect(native).toContain('MaxPreviewPixelDimension = 512');
  expect(native).toContain(
    'NSURLSessionConfiguration.ephemeralSessionConfiguration',
  );
  expect(native).toContain('HTTPShouldHandleCookies = NO');
  expect(native).toContain('completionHandler(nil)');
  expect(native).toContain('didReceiveData:(__unused NSData *)data');
  expect(native).not.toContain('completionHandler:^(__unused NSData *data');
  expect(native).toContain('[manager removeItemAtURL:retainedURL error:nil]');
  expect(native).not.toMatch(/NSLog|os_log|RCTLog/);
});
