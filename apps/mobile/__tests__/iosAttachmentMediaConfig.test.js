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

  expect(packageJson.codegenConfig.ios.modulesProvider).toMatchObject({
    CrewAttachmentMedia: 'CrewAttachmentMedia',
  });
  expect(project).toContain('CrewAttachmentMedia.mm in Sources');
  expect(project).toContain('PhotosUI.framework in Frameworks');
  expect(native).toContain('kCGImageSourceCreateThumbnailWithTransform');
  expect(native).toContain('kCGImageSourceThumbnailMaxPixelSize');
  expect(native).toContain('kCGImageDestinationLossyCompressionQuality');
  expect(native).toContain('UTTypeHEIC');
  expect(native).toContain('UTTypeHEIF');
  expect(native).toContain('UTTypeJPEG');
  expect(native).toContain('UTTypePNG');
  expect(native).toContain('UTTypeWebP');
  expect(native).toContain('CGImageSourceGetCount(source) != 1');
  expect(native).toContain('orientationValue < 1 || orientationValue > 8');
  expect(native).toContain('PHPickerViewControllerDelegate');
  expect(native).toContain('PHPickerFilter.imagesFilter');
  expect(native).toContain('configuration.selectionLimit = 1');
  expect(native).toContain(
    'PHPickerConfigurationAssetRepresentationModeCurrent',
  );
  expect(native).toContain('loadFileRepresentationForTypeIdentifier');
  expect(native).toContain(
    '[self finishImagePicker:generation result:nil error:nil]',
  );
  expect(native).toContain('- (void)cancelPending:(NSString *)accountUserId');
  expect(native).toContain('- (void)invalidate');
  expect(native).toContain('_pickerGeneration');
  expect(native).toContain('_pickerLoadProgress');
  expect(native).toContain('_pickerWorkInFlight');
  expect(native).toContain('_pickerCancelWaiters');
  expect(native).toContain('dispatch_sync(_mediaQueue');
  expect(native).toContain('[progress cancel]');
  expect(native).toContain('CrewAttachmentMediaPickerUnavailable');
  expect(native).toContain('CrewAttachmentMediaPickerFailed');
  expect(native).not.toContain(
    'reject(CrewErrorCode(safeError), safeError.localizedDescription, nil)',
  );
  expect(native).not.toContain('requestAuthorization');
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
  expect(native.match(/CrewRefreshRetainedFile\(retainedURL/g)).toHaveLength(2);
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
  expect(native).toContain('CrewPreviewRetainedImage');
  expect(native).toContain('MaxPreviewPixelDimension = 512');
  expect(native).toContain('MaxPreviewBytes = 512 * 1024');
  expect(native).toContain('!CrewIsValidAccountUserId(accountUserId)');
  expect(native).toContain('!CrewIsRetainedFileKey(retainedFileKey)');
  expect(native).toContain('![CrewSHA256Data(data) isEqualToString:sha256]');
  expect(native).toContain(
    'URLByAppendingPathComponent:fileKey\n                                                isDirectory:NO',
  );
  expect(native).toContain(
    'CrewValidatePurgeTarget(target, directory, &exists, error)',
  );
  expect(native).not.toContain('removeItemAtURL:directory');
  expect(native).toContain(
    'NSURLSessionConfiguration.ephemeralSessionConfiguration',
  );
  expect(native).toContain('HTTPShouldHandleCookies = NO');
  expect(native).toContain('configuration.URLCache = nil');
  expect(native).toContain('configuration.HTTPCookieStorage = nil');
  expect(native).toContain(
    'configuration.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyNever',
  );
  expect(native).toContain('NSURLRequestReloadIgnoringLocalAndRemoteCacheData');
  expect(native).toContain(
    '[uploadRequest setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"]',
  );
  expect(native).toContain(
    '[uploadRequest setValue:@"no-cache" forHTTPHeaderField:@"Pragma"]',
  );
  expect(native).toContain('completionHandler(nil)');
  expect(native).toContain('didReceiveData:(__unused NSData *)data');
  expect(native).not.toContain('completionHandler:^(__unused NSData *data');
  expect(native).toContain('[manager removeItemAtURL:retainedURL error:nil]');
  expect(native).not.toMatch(/NSLog|os_log|RCTLog/);
});
