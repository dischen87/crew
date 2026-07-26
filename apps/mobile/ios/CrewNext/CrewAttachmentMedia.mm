#import "CrewAttachmentMedia.h"

#import <CommonCrypto/CommonDigest.h>
#import <ImageIO/ImageIO.h>
#import <PhotosUI/PhotosUI.h>
#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <cerrno>
#include <sys/stat.h>
#include <utility>

namespace {

NSString *const CrewAttachmentMediaErrorDomain = @"CrewAttachmentMedia";
constexpr long long MaxInputBytes = 64LL * 1024 * 1024;
constexpr long long MaxRetainedBytes = 20LL * 1024 * 1024;
constexpr NSInteger MaxPixelDimension = 4096;
constexpr long long MaxDecodedPixels = 4096LL * 4096;
constexpr NSInteger MaxCapturePixelDimension = 2048;
constexpr long long MaxCapturePixels = 16LL * 1024 * 1024;
constexpr NSInteger MaxPreviewPixelDimension = 512;
constexpr NSUInteger MaxPreviewBytes = 512 * 1024;
constexpr NSInteger MaxSourceDimension = 20000;
constexpr long long MaxSourcePixels = 100LL * 1000 * 1000;
constexpr CGFloat JpegQuality = 0.82;
constexpr NSTimeInterval ReconcileFinalGraceSeconds = 5 * 60;
constexpr NSUInteger MaxGrantURLCharacters = 8192;
constexpr NSUInteger MaxGrantFields = 64;
constexpr NSUInteger MaxGrantFieldNameBytes = 128;
constexpr NSUInteger MaxGrantFieldValueBytes = 16 * 1024;
constexpr NSUInteger MaxGrantFieldBytes = 64 * 1024;
constexpr NSUInteger MaxPurgeBatch = 64;

typedef NS_ENUM(NSInteger, CrewAttachmentMediaErrorCode) {
  CrewAttachmentMediaInvalidSource = 1,
  CrewAttachmentMediaUnsupportedType = 2,
  CrewAttachmentMediaUnsafeImage = 3,
  CrewAttachmentMediaConversionFailed = 4,
  CrewAttachmentMediaStorageFailed = 5,
  CrewAttachmentMediaCaptureUnavailable = 6,
  CrewAttachmentMediaCaptureFailed = 7,
  CrewAttachmentMediaInvalidArgument = 8,
  CrewAttachmentMediaMissingFile = 9,
  CrewAttachmentMediaUploadRetryable = 10,
  CrewAttachmentMediaUploadUnavailable = 11,
  CrewAttachmentMediaUploadFailed = 12,
  CrewAttachmentMediaPreviewUnavailable = 13,
  CrewAttachmentMediaPreviewFailed = 14,
  CrewAttachmentMediaPickerUnavailable = 15,
  CrewAttachmentMediaPickerFailed = 16,
};

typedef NS_ENUM(NSInteger, CrewAttachmentMediaKind) {
  CrewAttachmentMediaUnknown = 0,
  CrewAttachmentMediaJPEG,
  CrewAttachmentMediaPNG,
  CrewAttachmentMediaWebP,
  CrewAttachmentMediaHEIF,
};

NSError *CrewMediaError(CrewAttachmentMediaErrorCode code, NSString *message) {
  return [NSError errorWithDomain:CrewAttachmentMediaErrorDomain
                             code:code
                         userInfo:@{NSLocalizedDescriptionKey : message}];
}

CrewAttachmentMediaKind CrewMediaKindForType(UTType *type) {
  if ([type conformsToType:UTTypeJPEG]) return CrewAttachmentMediaJPEG;
  if ([type conformsToType:UTTypePNG]) return CrewAttachmentMediaPNG;
  if ([type conformsToType:UTTypeWebP]) return CrewAttachmentMediaWebP;
  if ([type conformsToType:UTTypeHEIC] || [type conformsToType:UTTypeHEIF]) {
    return CrewAttachmentMediaHEIF;
  }
  return CrewAttachmentMediaUnknown;
}

NSString *CrewMediaContentType(CrewAttachmentMediaKind kind) {
  switch (kind) {
    case CrewAttachmentMediaJPEG:
    case CrewAttachmentMediaHEIF:
      return @"image/jpeg";
    case CrewAttachmentMediaPNG:
      return @"image/png";
    case CrewAttachmentMediaWebP:
      return @"image/webp";
    case CrewAttachmentMediaUnknown:
      return nil;
  }
}

NSString *CrewMediaExtension(CrewAttachmentMediaKind kind) {
  switch (kind) {
    case CrewAttachmentMediaJPEG:
    case CrewAttachmentMediaHEIF:
      return @"jpg";
    case CrewAttachmentMediaPNG:
      return @"png";
    case CrewAttachmentMediaWebP:
      return @"webp";
    case CrewAttachmentMediaUnknown:
      return nil;
  }
}

CrewAttachmentMediaKind CrewMediaKindForExtension(NSString *extension) {
  if ([extension isEqualToString:@"jpg"]) return CrewAttachmentMediaJPEG;
  if ([extension isEqualToString:@"png"]) return CrewAttachmentMediaPNG;
  if ([extension isEqualToString:@"webp"]) return CrewAttachmentMediaWebP;
  return CrewAttachmentMediaUnknown;
}

BOOL CrewReadDimensions(CGImageSourceRef source,
                        NSInteger *pixelWidth,
                        NSInteger *pixelHeight,
                        NSInteger *orientation,
                        NSError **error) {
  NSDictionary *properties = CFBridgingRelease(
      CGImageSourceCopyPropertiesAtIndex(source, 0, nullptr));
  NSNumber *width = properties[(__bridge NSString *)kCGImagePropertyPixelWidth];
  NSNumber *height = properties[(__bridge NSString *)kCGImagePropertyPixelHeight];
  NSNumber *imageOrientation =
      properties[(__bridge NSString *)kCGImagePropertyOrientation];
  NSInteger orientationValue =
      imageOrientation ? imageOrientation.integerValue : 1;
  if (width.integerValue < 1 || height.integerValue < 1 ||
      orientationValue < 1 || orientationValue > 8) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"The selected image has invalid dimensions.");
    }
    return NO;
  }
  *pixelWidth = width.integerValue;
  *pixelHeight = height.integerValue;
  *orientation = orientationValue;
  return YES;
}

void CrewApplyOrientation(NSInteger orientation,
                          NSInteger *pixelWidth,
                          NSInteger *pixelHeight) {
  if (orientation >= 5 && orientation <= 8) {
    std::swap(*pixelWidth, *pixelHeight);
  }
}

BOOL CrewFileSize(NSURL *url, long long *size, NSError **error) {
  NSNumber *fileSize = nil;
  if (![url getResourceValue:&fileSize forKey:NSURLFileSizeKey error:error]) {
    return NO;
  }
  *size = fileSize.longLongValue;
  return YES;
}

NSString *CrewSHA256(NSURL *url, NSError **error) {
  NSFileHandle *handle = [NSFileHandle fileHandleForReadingFromURL:url error:error];
  if (!handle) return nil;

  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  while (true) {
    @autoreleasepool {
      NSData *chunk = [handle readDataUpToLength:1024 * 1024 error:error];
      if (!chunk) {
        [handle closeAndReturnError:nil];
        return nil;
      }
      if (chunk.length == 0) break;
      CC_SHA256_Update(&context, chunk.bytes, (CC_LONG)chunk.length);
    }
  }
  if (![handle closeAndReturnError:error]) return nil;

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(digest, &context);
  NSMutableString *hex =
      [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

NSString *CrewSHA256Data(NSData *data) {
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
  NSMutableString *hex =
      [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
    [hex appendFormat:@"%02x", digest[index]];
  }
  return hex;
}

BOOL CrewSynchronizeFile(NSURL *url, NSError **error) {
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingToURL:url error:error];
  if (!handle) return NO;
  if (![handle synchronizeAndReturnError:error]) {
    [handle closeAndReturnError:nil];
    return NO;
  }
  return [handle closeAndReturnError:error];
}

BOOL CrewRefreshRetainedFile(NSURL *url, NSError **error) {
  return [NSFileManager.defaultManager
      setAttributes:@{ NSFileModificationDate : NSDate.date }
       ofItemAtPath:url.path
              error:error];
}

BOOL CrewIsValidAccountUserId(NSString *accountUserId) {
  if (accountUserId.length != 36 ||
      ![accountUserId hasPrefix:@"usr_"]) {
    return NO;
  }
  NSString *suffix = [accountUserId substringFromIndex:4];
  NSCharacterSet *nonHex =
      [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]
          invertedSet];
  return [suffix rangeOfCharacterFromSet:nonHex].location == NSNotFound;
}

BOOL CrewIsRetainedFileKey(NSString *fileKey) {
  if (![fileKey isKindOfClass:NSString.class] ||
      [fileKey containsString:@"/"] || [fileKey containsString:@"\\"]) {
    return NO;
  }
  NSString *extension = fileKey.pathExtension.lowercaseString;
  if (![fileKey.pathExtension isEqualToString:extension] ||
      ![@[ @"jpg", @"png", @"webp" ] containsObject:extension]) {
    return NO;
  }
  NSString *digest = fileKey.stringByDeletingPathExtension;
  if (digest.length != 64) return NO;
  NSCharacterSet *nonHex =
      [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]
          invertedSet];
  return [digest rangeOfCharacterFromSet:nonHex].location == NSNotFound;
}

BOOL CrewValidatePrivateDirectory(NSURL *directory,
                                  NSURL *expectedParent,
                                  NSError **error) {
  NSNumber *isDirectory = nil;
  NSNumber *isSymbolicLink = nil;
  NSError *resourceError = nil;
  if (![directory getResourceValue:&isDirectory
                            forKey:NSURLIsDirectoryKey
                             error:&resourceError] ||
      ![directory getResourceValue:&isSymbolicLink
                            forKey:NSURLIsSymbolicLinkKey
                             error:&resourceError]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Retained image storage is unavailable.");
    }
    return NO;
  }
  NSURL *resolvedDirectory =
      directory.URLByResolvingSymlinksInPath.standardizedURL;
  NSURL *resolvedParent =
      expectedParent.URLByResolvingSymlinksInPath.standardizedURL;
  if (!isDirectory.boolValue || isSymbolicLink.boolValue ||
      ![resolvedDirectory.URLByDeletingLastPathComponent.path
          isEqualToString:resolvedParent.path]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image storage is unsafe.");
    }
    return NO;
  }
  return YES;
}

BOOL CrewValidateRetainedFile(NSURL *file,
                              NSURL *directory,
                              long long *fileSize,
                              NSError **error) {
  NSNumber *isRegular = nil;
  NSNumber *isSymbolicLink = nil;
  NSError *resourceError = nil;
  if (![file getResourceValue:&isRegular
                       forKey:NSURLIsRegularFileKey
                        error:&resourceError] ||
      ![file getResourceValue:&isSymbolicLink
                       forKey:NSURLIsSymbolicLinkKey
                        error:&resourceError] ||
      !CrewFileSize(file, fileSize, &resourceError)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Retained image storage is unavailable.");
    }
    return NO;
  }
  NSURL *resolvedDirectory =
      directory.URLByResolvingSymlinksInPath.standardizedURL;
  NSURL *resolvedFile = file.URLByResolvingSymlinksInPath.standardizedURL;
  if (!isRegular.boolValue || isSymbolicLink.boolValue ||
      ![resolvedFile.URLByDeletingLastPathComponent.path
          isEqualToString:resolvedDirectory.path]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image is unsafe.");
    }
    return NO;
  }
  return YES;
}

NSURL *CrewAttachmentDirectory(NSString *accountUserId, NSError **error) {
  if (!CrewIsValidAccountUserId(accountUserId)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidSource,
                              @"The active account is invalid.");
    }
    return nil;
  }
  NSFileManager *manager = NSFileManager.defaultManager;
  NSURL *applicationSupport =
      [manager URLForDirectory:NSApplicationSupportDirectory
                      inDomain:NSUserDomainMask
             appropriateForURL:nil
                        create:YES
                         error:error];
  if (!applicationSupport) return nil;
  NSURL *rootDirectory =
      [applicationSupport URLByAppendingPathComponent:@"CrewAttachments"
                                          isDirectory:YES];
  if (![manager createDirectoryAtURL:rootDirectory
         withIntermediateDirectories:YES
                          attributes:@{
                            NSFileProtectionKey : NSFileProtectionComplete
                          }
                               error:error]) {
    return nil;
  }
  if (!CrewValidatePrivateDirectory(rootDirectory, applicationSupport,
                                    error)) {
    return nil;
  }
  if (![rootDirectory setResourceValue:@YES
                            forKey:NSURLIsExcludedFromBackupKey
                             error:error]) {
    return nil;
  }
  NSURL *directory =
      [rootDirectory URLByAppendingPathComponent:accountUserId isDirectory:YES];
  if (![manager createDirectoryAtURL:directory
         withIntermediateDirectories:YES
                          attributes:@{
                            NSFileProtectionKey : NSFileProtectionComplete
                          }
                               error:error]) {
    return nil;
  }
  if (!CrewValidatePrivateDirectory(directory, rootDirectory, error)) {
    return nil;
  }
  return directory;
}

BOOL CrewReconcileRetained(NSString *accountUserId,
                           NSArray<NSString *> *retainedFileKeys,
                           NSError **error) {
  NSMutableSet<NSString *> *referenced = [NSMutableSet set];
  for (id fileKey in retainedFileKeys) {
    if (!CrewIsRetainedFileKey(fileKey)) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidSource,
                                @"A retained file identity is invalid.");
      }
      return NO;
    }
    [referenced addObject:fileKey];
  }

  NSURL *directory = CrewAttachmentDirectory(accountUserId, error);
  if (!directory) return NO;
  NSFileManager *manager = NSFileManager.defaultManager;
  NSArray<NSURL *> *children = [manager
      contentsOfDirectoryAtURL:directory
    includingPropertiesForKeys:@[ NSURLIsRegularFileKey,
                                  NSURLIsSymbolicLinkKey ]
                       options:0
                         error:error];
  if (!children) return NO;
  for (NSURL *url in children) {
    NSString *fileKey = url.lastPathComponent;
    BOOL isTemporary = [fileKey hasPrefix:@"."] &&
                       [fileKey hasSuffix:@".tmp"];
    BOOL isOrphan = CrewIsRetainedFileKey(fileKey) &&
                    ![referenced containsObject:fileKey];
    if (!isTemporary && !isOrphan) continue;

    if (isOrphan) {
      NSDate *modifiedAt = nil;
      if (![url getResourceValue:&modifiedAt
                          forKey:NSURLContentModificationDateKey
                           error:nil] ||
          !modifiedAt ||
          [NSDate.date timeIntervalSinceDate:modifiedAt] <
              ReconcileFinalGraceSeconds) {
        continue;
      }
    }

    NSNumber *isRegular = nil;
    NSNumber *isSymbolicLink = nil;
    if (![url getResourceValue:&isRegular
                        forKey:NSURLIsRegularFileKey
                         error:error] ||
        ![url getResourceValue:&isSymbolicLink
                        forKey:NSURLIsSymbolicLinkKey
                         error:error]) {
      return NO;
    }
    if (!isRegular.boolValue && !isSymbolicLink.boolValue) continue;
    if (![manager removeItemAtURL:url error:error]) return NO;
  }
  return YES;
}

BOOL CrewValidatePurgeTarget(NSURL *file,
                             NSURL *directory,
                             BOOL *exists,
                             NSError **error) {
  struct stat attributes;
  if (lstat(file.fileSystemRepresentation, &attributes) != 0) {
    if (errno == ENOENT) {
      *exists = NO;
      return YES;
    }
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Retained image storage is unavailable.");
    }
    return NO;
  }
  *exists = YES;
  NSURL *resolvedDirectory =
      directory.URLByResolvingSymlinksInPath.standardizedURL;
  NSURL *resolvedFile = file.URLByResolvingSymlinksInPath.standardizedURL;
  if (!S_ISREG(attributes.st_mode) || attributes.st_nlink != 1 ||
      ![resolvedFile.URLByDeletingLastPathComponent.path
          isEqualToString:resolvedDirectory.path] ||
      ![resolvedFile.lastPathComponent isEqualToString:file.lastPathComponent]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image is unsafe.");
    }
    return NO;
  }
  return YES;
}

BOOL CrewPurgeRetained(NSString *accountUserId,
                       NSArray<NSString *> *retainedFileKeys,
                       NSError **error) {
  if (!CrewIsValidAccountUserId(accountUserId) ||
      retainedFileKeys.count < 1 ||
      retainedFileKeys.count > MaxPurgeBatch) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Retained image purge request is invalid.");
    }
    return NO;
  }
  NSMutableOrderedSet<NSString *> *keys = [NSMutableOrderedSet orderedSet];
  for (id fileKey in retainedFileKeys) {
    if (!CrewIsRetainedFileKey(fileKey)) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                @"Retained image purge request is invalid.");
      }
      return NO;
    }
    [keys addObject:fileKey];
  }

  NSURL *directory = CrewAttachmentDirectory(accountUserId, error);
  if (!directory) return NO;
  NSMutableArray<NSURL *> *targets = [NSMutableArray array];
  for (NSString *fileKey in keys) {
    NSURL *target = [directory URLByAppendingPathComponent:fileKey
                                                isDirectory:NO];
    BOOL exists = NO;
    if (!CrewValidatePurgeTarget(target, directory, &exists, error)) return NO;
    if (exists) [targets addObject:target];
  }

  NSFileManager *manager = NSFileManager.defaultManager;
  for (NSURL *target in targets) {
    BOOL exists = NO;
    if (!CrewValidatePurgeTarget(target, directory, &exists, error)) return NO;
    if (!exists) continue;
    NSError *removeError = nil;
    if (![manager removeItemAtURL:target error:&removeError]) {
      BOOL stillExists = NO;
      NSError *validationError = nil;
      if (CrewValidatePurgeTarget(target, directory, &stillExists,
                                  &validationError) &&
          !stillExists) {
        continue;
      }
      if (error) {
        *error = validationError ?: CrewMediaError(
            CrewAttachmentMediaStorageFailed,
            @"Retained image storage is unavailable.");
      }
      return NO;
    }
  }
  return YES;
}

BOOL CrewValidateSourceURL(NSURL *url, long long *fileSize, NSError **error) {
  NSNumber *isRegular = nil;
  NSNumber *isSymbolicLink = nil;
  if (![url getResourceValue:&isRegular forKey:NSURLIsRegularFileKey error:error] ||
      ![url getResourceValue:&isSymbolicLink
                      forKey:NSURLIsSymbolicLinkKey
                       error:error] ||
      !CrewFileSize(url, fileSize, error)) {
    return NO;
  }
  if (!isRegular.boolValue || isSymbolicLink.boolValue || *fileSize < 1 ||
      *fileSize > MaxInputBytes) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidSource,
                              @"The selected file cannot be processed safely.");
    }
    return NO;
  }
  return YES;
}

BOOL CrewCreateBoundedJPEG(CGImageSourceRef source,
                           NSURL *destinationURL,
                           NSInteger *pixelWidth,
                           NSInteger *pixelHeight,
                           NSError **error) {
  NSDictionary *thumbnailOptions = @{
    (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
    (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
    (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize :
        @(MaxPixelDimension),
    (__bridge NSString *)kCGImageSourceShouldCacheImmediately : @YES,
  };
  CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(
      source, 0, (__bridge CFDictionaryRef)thumbnailOptions);
  if (!thumbnail) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaConversionFailed,
                              @"The selected HEIF image could not be decoded.");
    }
    return NO;
  }

  *pixelWidth = CGImageGetWidth(thumbnail);
  *pixelHeight = CGImageGetHeight(thumbnail);
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)destinationURL,
      (__bridge CFStringRef)UTTypeJPEG.identifier, 1, nullptr);
  if (!destination) {
    CGImageRelease(thumbnail);
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaConversionFailed,
                              @"The normalized image could not be created.");
    }
    return NO;
  }
  NSDictionary *properties = @{
    (__bridge NSString *)kCGImageDestinationLossyCompressionQuality :
        @(JpegQuality),
    (__bridge NSString *)kCGImagePropertyOrientation : @1,
  };
  CGImageDestinationAddImage(destination, thumbnail,
                             (__bridge CFDictionaryRef)properties);
  BOOL finalized = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  CGImageRelease(thumbnail);
  if (!finalized && error) {
    *error = CrewMediaError(CrewAttachmentMediaConversionFailed,
                            @"The normalized image could not be encoded.");
  }
  return finalized;
}

NSDictionary *CrewNormalizeAndRetain(NSString *accountUserId,
                                     NSString *sourceUri,
                                     NSError **error) {
  NSURL *sourceURL = [NSURL URLWithString:sourceUri];
  if (!sourceURL.isFileURL) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidSource,
                              @"Only local image files are supported.");
    }
    return nil;
  }
  sourceURL = sourceURL.standardizedURL;
  BOOL hasSecurityScope = [sourceURL startAccessingSecurityScopedResource];
  @try {
    long long sourceBytes = 0;
    if (!CrewValidateSourceURL(sourceURL, &sourceBytes, error)) return nil;
    NSURL *directory = CrewAttachmentDirectory(accountUserId, error);
    if (!directory) return nil;
    NSFileManager *manager = NSFileManager.defaultManager;
    NSString *operationId = NSUUID.UUID.UUIDString;
    NSURL *sourceSnapshotURL = [directory
        URLByAppendingPathComponent:[NSString
                                        stringWithFormat:@".%@.source.tmp",
                                                         operationId]];
    NSURL *normalizedTemporaryURL = [directory
        URLByAppendingPathComponent:[NSString
                                        stringWithFormat:@".%@.output.tmp",
                                                         operationId]];
    @try {
      if (![manager copyItemAtURL:sourceURL
                            toURL:sourceSnapshotURL
                            error:error]) {
        return nil;
      }
      long long snapshotBytes = 0;
      if (!CrewValidateSourceURL(sourceSnapshotURL, &snapshotBytes, error)) {
        return nil;
      }
      if (![manager setAttributes:@{
                     NSFileProtectionKey : NSFileProtectionComplete
                   }
                   ofItemAtPath:sourceSnapshotURL.path
                          error:error]) {
        return nil;
      }

      NSDictionary *sourceOptions = @{
        (__bridge NSString *)kCGImageSourceShouldCache : @NO,
      };
      CGImageSourceRef source = CGImageSourceCreateWithURL(
          (__bridge CFURLRef)sourceSnapshotURL,
          (__bridge CFDictionaryRef)sourceOptions);
      if (!source) {
        if (error) {
          *error = CrewMediaError(CrewAttachmentMediaUnsupportedType,
                                  @"The selected file is not a supported image.");
        }
        return nil;
      }
      NSDictionary *result = nil;
      @try {
        if (CGImageSourceGetCount(source) != 1) {
          if (error) {
            *error = CrewMediaError(
                CrewAttachmentMediaUnsafeImage,
                @"Animated or multi-frame images are not supported.");
          }
          return nil;
        }
        CFStringRef sourceTypeIdentifier = CGImageSourceGetType(source);
        UTType *sourceType = sourceTypeIdentifier
                                 ? [UTType typeWithIdentifier:
                                               (__bridge NSString *)
                                                   sourceTypeIdentifier]
                                 : nil;
        CrewAttachmentMediaKind kind = sourceType
                                            ? CrewMediaKindForType(sourceType)
                                            : CrewAttachmentMediaUnknown;
        if (kind == CrewAttachmentMediaUnknown) {
          if (error) {
            *error = CrewMediaError(
                CrewAttachmentMediaUnsupportedType,
                @"Only HEIF, JPEG, PNG, and WebP images are supported.");
          }
          return nil;
        }

        NSInteger sourceWidth = 0;
        NSInteger sourceHeight = 0;
        NSInteger orientation = 1;
        if (!CrewReadDimensions(source, &sourceWidth, &sourceHeight,
                                &orientation, error)) {
          return nil;
        }
        if (sourceWidth > MaxSourceDimension ||
            sourceHeight > MaxSourceDimension ||
            sourceWidth > MaxSourcePixels / sourceHeight) {
          if (error) {
            *error = CrewMediaError(
                CrewAttachmentMediaUnsafeImage,
                @"The selected image exceeds the safe decode limit.");
          }
          return nil;
        }

        BOOL shouldNormalize = kind == CrewAttachmentMediaHEIF;
        NSInteger retainedWidth = sourceWidth;
        NSInteger retainedHeight = sourceHeight;
        if (!shouldNormalize) {
          CrewApplyOrientation(orientation, &retainedWidth, &retainedHeight);
          if (snapshotBytes > MaxRetainedBytes ||
              retainedWidth > MaxPixelDimension ||
              retainedHeight > MaxPixelDimension ||
              retainedWidth > MaxDecodedPixels / retainedHeight) {
            if (error) {
              *error = CrewMediaError(
                  CrewAttachmentMediaUnsafeImage,
                  @"The selected image exceeds the safe pass-through limit.");
            }
            return nil;
          }
        }

        NSURL *temporaryURL =
            shouldNormalize ? normalizedTemporaryURL : sourceSnapshotURL;
        if (shouldNormalize) {
          if (!CrewCreateBoundedJPEG(source, temporaryURL, &retainedWidth,
                                     &retainedHeight, error)) {
            return nil;
          }
        }

        if (!CrewSynchronizeFile(temporaryURL, error)) return nil;
        if (![manager setAttributes:@{
                       NSFileProtectionKey : NSFileProtectionComplete,
                       NSFileModificationDate : NSDate.date
                     }
                     ofItemAtPath:temporaryURL.path
                            error:error]) {
          return nil;
        }

        long long retainedBytes = 0;
        if (!CrewFileSize(temporaryURL, &retainedBytes, error)) return nil;
        if (retainedBytes < 1 || retainedBytes > MaxRetainedBytes) {
          if (error) {
            *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                                    @"The normalized image exceeds the upload limit.");
          }
          return nil;
        }
        NSString *sha256 = CrewSHA256(temporaryURL, error);
        if (!sha256) return nil;
        NSString *extension = CrewMediaExtension(kind);
        NSString *fileKey =
            [NSString stringWithFormat:@"%@.%@", sha256, extension];
        NSURL *retainedURL =
            [directory URLByAppendingPathComponent:fileKey isDirectory:NO];

        if ([manager fileExistsAtPath:retainedURL.path]) {
          long long existingBytes = 0;
          NSString *existingDigest = nil;
          if (!CrewValidateRetainedFile(retainedURL, directory,
                                         &existingBytes, error) ||
              !(existingDigest = CrewSHA256(retainedURL, error))) {
            return nil;
          }
          if (existingBytes != retainedBytes ||
              ![existingDigest isEqualToString:sha256]) {
            if (error) {
              *error = CrewMediaError(
                  CrewAttachmentMediaStorageFailed,
                  @"A retained image failed its integrity check.");
            }
            return nil;
          }
        } else if (![manager moveItemAtURL:temporaryURL
                                      toURL:retainedURL
                                      error:error]) {
          return nil;
        }
        if (!CrewRefreshRetainedFile(retainedURL, error)) return nil;

        result = @{
          @"retainedFileKey" : fileKey,
          @"contentType" : CrewMediaContentType(kind),
          @"byteCount" : @(retainedBytes),
          @"sha256" : sha256,
          @"pixelWidth" : @(retainedWidth),
          @"pixelHeight" : @(retainedHeight),
          @"wasNormalized" : @(shouldNormalize),
        };
      } @finally {
        CFRelease(source);
      }
      return result;
    } @finally {
      [manager removeItemAtURL:sourceSnapshotURL error:nil];
      [manager removeItemAtURL:normalizedTemporaryURL error:nil];
    }
  } @finally {
    if (hasSecurityScope) [sourceURL stopAccessingSecurityScopedResource];
  }
}

BOOL CrewIsSHA256(NSString *value) {
  if (![value isKindOfClass:NSString.class] || value.length != 64) return NO;
  NSCharacterSet *nonHex =
      [[NSCharacterSet characterSetWithCharactersInString:@"0123456789abcdef"]
          invertedSet];
  return [value rangeOfCharacterFromSet:nonHex].location == NSNotFound;
}

UIWindow *CrewActiveKeyWindow(void) {
  UIApplication *application = UIApplication.sharedApplication;
  if (application.applicationState != UIApplicationStateActive) return nil;
  for (UIScene *scene in application.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class] ||
        scene.activationState != UISceneActivationStateForegroundActive) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (window.isKeyWindow && !window.isHidden && window.alpha > 0 &&
          window.windowLevel == UIWindowLevelNormal && window.rootViewController &&
          !CGRectIsEmpty(window.bounds)) {
        return window;
      }
    }
  }
  return nil;
}

UIViewController *CrewVisibleViewController(UIViewController *controller) {
  if (controller.presentedViewController) {
    return CrewVisibleViewController(controller.presentedViewController);
  }
  if ([controller isKindOfClass:UINavigationController.class]) {
    return CrewVisibleViewController(
        ((UINavigationController *)controller).visibleViewController);
  }
  if ([controller isKindOfClass:UITabBarController.class]) {
    return CrewVisibleViewController(
        ((UITabBarController *)controller).selectedViewController);
  }
  return controller;
}

NSString *CrewPickerTypeIdentifier(NSItemProvider *provider) {
  NSArray<UTType *> *supported =
      @[ UTTypeHEIC, UTTypeHEIF, UTTypeJPEG, UTTypePNG, UTTypeWebP ];
  for (UTType *preferred in supported) {
    for (NSString *identifier in provider.registeredTypeIdentifiers) {
      UTType *registered = [UTType typeWithIdentifier:identifier];
      if ([registered conformsToType:preferred]) return identifier;
    }
  }
  return nil;
}

UIImage *CrewCaptureCurrentScreen(NSError **error) {
  if (!NSThread.isMainThread) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaCaptureFailed,
                              @"Screen capture failed.");
    }
    return nil;
  }
  UIWindow *window = CrewActiveKeyWindow();
  if (!window) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaCaptureUnavailable,
                              @"Screen capture is unavailable.");
    }
    return nil;
  }
  CGRect captureBounds = window.bounds;
  CGFloat longestEdge = MAX(CGRectGetWidth(captureBounds),
                            CGRectGetHeight(captureBounds));
  if (!isfinite(longestEdge) || longestEdge <= 0) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaCaptureFailed,
                              @"Screen capture failed.");
    }
    return nil;
  }
  UIGraphicsImageRendererFormat *format =
      [UIGraphicsImageRendererFormat preferredFormat];
  format.scale = MIN(window.screen.scale,
                     MaxCapturePixelDimension / longestEdge);
  format.opaque = window.opaque;
  if (!isfinite(format.scale) || format.scale <= 0) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaCaptureFailed,
                              @"Screen capture failed.");
    }
    return nil;
  }

  __block BOOL rendered = NO;
  UIImage *image = nil;
  @try {
    UIGraphicsImageRenderer *renderer =
        [[UIGraphicsImageRenderer alloc] initWithSize:captureBounds.size
                                               format:format];
    image = [renderer imageWithActions:^(UIGraphicsImageRendererContext *context) {
      rendered = [window drawViewHierarchyInRect:captureBounds
                              afterScreenUpdates:YES];
    }];
  } @catch (__unused NSException *exception) {
    rendered = NO;
  }
  if (!rendered || !image.CGImage || CrewActiveKeyWindow() != window ||
      !CGRectEqualToRect(window.bounds, captureBounds)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaCaptureFailed,
                              @"Screen capture failed.");
    }
    return nil;
  }
  NSInteger pixelWidth = CGImageGetWidth(image.CGImage);
  NSInteger pixelHeight = CGImageGetHeight(image.CGImage);
  if (pixelWidth < 1 || pixelHeight < 1 ||
      pixelWidth > MaxCapturePixelDimension ||
      pixelHeight > MaxCapturePixelDimension ||
      pixelWidth > MaxCapturePixels / pixelHeight) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Screen capture is unsafe.");
    }
    return nil;
  }
  return image;
}

NSDictionary *CrewRetainCapturedPNG(NSString *accountUserId,
                                    UIImage *image,
                                    NSError **error) {
  if (!CrewIsValidAccountUserId(accountUserId)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Screen capture request is invalid.");
    }
    return nil;
  }
  NSData *png = UIImagePNGRepresentation(image);
  NSInteger pixelWidth = image.CGImage ? CGImageGetWidth(image.CGImage) : 0;
  NSInteger pixelHeight = image.CGImage ? CGImageGetHeight(image.CGImage) : 0;
  if (!png || png.length < 1 || png.length > MaxRetainedBytes ||
      pixelWidth < 1 || pixelHeight < 1 ||
      pixelWidth > MaxCapturePixelDimension ||
      pixelHeight > MaxCapturePixelDimension ||
      pixelWidth > MaxCapturePixels / pixelHeight) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Screen capture is unsafe.");
    }
    return nil;
  }
  NSError *directoryError = nil;
  NSURL *directory = CrewAttachmentDirectory(accountUserId, &directoryError);
  if (!directory) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Screen capture could not be retained.");
    }
    return nil;
  }
  NSString *sha256 = CrewSHA256Data(png);
  NSString *fileKey = [sha256 stringByAppendingString:@".png"];
  NSURL *retainedURL =
      [directory URLByAppendingPathComponent:fileKey isDirectory:NO];
  NSFileManager *manager = NSFileManager.defaultManager;
  if ([manager fileExistsAtPath:retainedURL.path]) {
    long long existingBytes = 0;
    NSString *existingDigest = nil;
    NSError *integrityError = nil;
    if (!CrewValidateRetainedFile(retainedURL, directory, &existingBytes,
                                  &integrityError) ||
        !(existingDigest = CrewSHA256(retainedURL, &integrityError)) ||
        existingBytes != (long long)png.length ||
        ![existingDigest isEqualToString:sha256]) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                                @"Screen capture could not be retained.");
      }
      return nil;
    }
  } else {
    NSError *storageError = nil;
    NSDataWritingOptions options =
        NSDataWritingAtomic | NSDataWritingFileProtectionComplete;
    if (![png writeToURL:retainedURL options:options error:&storageError] ||
        ![manager setAttributes:@{
          NSFileProtectionKey : NSFileProtectionComplete,
          NSFileModificationDate : NSDate.date
        }
                     ofItemAtPath:retainedURL.path
                            error:&storageError] ||
        !CrewSynchronizeFile(retainedURL, &storageError)) {
      [manager removeItemAtURL:retainedURL error:nil];
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                                @"Screen capture could not be retained.");
      }
      return nil;
    }
  }
  NSError *refreshError = nil;
  if (!CrewRefreshRetainedFile(retainedURL, &refreshError)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Screen capture could not be retained.");
    }
    return nil;
  }
  return @{
    @"retainedFileKey" : fileKey,
    @"contentType" : @"image/png",
    @"byteCount" : @(png.length),
    @"sha256" : sha256,
    @"pixelWidth" : @(pixelWidth),
    @"pixelHeight" : @(pixelHeight),
    @"wasNormalized" : @YES,
  };
}

BOOL CrewValidateUploadURL(NSString *grantUrl, NSURL **url, NSError **error) {
  if (![grantUrl isKindOfClass:NSString.class] || grantUrl.length < 1 ||
      grantUrl.length > MaxGrantURLCharacters) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Upload request is invalid.");
    }
    return NO;
  }
  NSURLComponents *components = [NSURLComponents componentsWithString:grantUrl];
  if (!components.URL ||
      ![components.scheme.lowercaseString isEqualToString:@"https"] ||
      components.host.length < 1 || components.user.length > 0 ||
      components.password.length > 0 || components.fragment.length > 0) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Upload request is invalid.");
    }
    return NO;
  }
  *url = components.URL;
  return YES;
}

BOOL CrewValidateUploadFields(NSArray *grantFields,
                              NSMutableArray<NSDictionary *> **fields,
                              NSError **error) {
  if (![grantFields isKindOfClass:NSArray.class] || grantFields.count < 1 ||
      grantFields.count > MaxGrantFields) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Upload request is invalid.");
    }
    return NO;
  }
  NSCharacterSet *invalidName =
      [[NSCharacterSet characterSetWithCharactersInString:
                           @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-"]
          invertedSet];
  NSMutableSet<NSString *> *names = [NSMutableSet set];
  NSMutableArray<NSDictionary *> *validated = [NSMutableArray array];
  NSUInteger totalBytes = 0;
  for (id item in grantFields) {
    if (![item isKindOfClass:NSDictionary.class]) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                @"Upload request is invalid.");
      }
      return NO;
    }
    id nameValue = ((NSDictionary *)item)[@"name"];
    id fieldValue = ((NSDictionary *)item)[@"value"];
    if (![nameValue isKindOfClass:NSString.class] ||
        ![fieldValue isKindOfClass:NSString.class]) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                @"Upload request is invalid.");
      }
      return NO;
    }
    NSString *name = nameValue;
    NSString *value = fieldValue;
    NSData *nameBytes = [name dataUsingEncoding:NSUTF8StringEncoding];
    NSData *valueBytes = [value dataUsingEncoding:NSUTF8StringEncoding];
    if (!nameBytes || !valueBytes || nameBytes.length < 1 ||
        nameBytes.length > MaxGrantFieldNameBytes ||
        valueBytes.length > MaxGrantFieldValueBytes ||
        [name rangeOfCharacterFromSet:invalidName].location != NSNotFound ||
        [name.lowercaseString isEqualToString:@"file"] ||
        [names containsObject:name]) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                @"Upload request is invalid.");
      }
      return NO;
    }
    totalBytes += nameBytes.length + valueBytes.length;
    if (totalBytes > MaxGrantFieldBytes) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                @"Upload request is invalid.");
      }
      return NO;
    }
    [names addObject:name];
    [validated addObject:@{ @"name" : name, @"value" : value }];
  }
  *fields = validated;
  return YES;
}

NSData *CrewReadRetainedImage(NSString *accountUserId,
                              NSString *retainedFileKey,
                              NSError **error) {
  NSString *sha256 = retainedFileKey.stringByDeletingPathExtension;
  if (!CrewIsValidAccountUserId(accountUserId) ||
      !CrewIsRetainedFileKey(retainedFileKey) || !CrewIsSHA256(sha256)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Retained image request is invalid.");
    }
    return nil;
  }
  NSURL *directory = CrewAttachmentDirectory(accountUserId, nil);
  if (!directory) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Retained image storage is unavailable.");
    }
    return nil;
  }
  NSURL *retainedURL =
      [directory URLByAppendingPathComponent:retainedFileKey isDirectory:NO];
  NSFileManager *manager = NSFileManager.defaultManager;
  if (![manager fileExistsAtPath:retainedURL.path]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaMissingFile,
                              @"Retained image is missing.");
    }
    return nil;
  }
  NSError *resourceError = nil;
  long long retainedBytes = 0;
  if (!CrewValidateRetainedFile(retainedURL, directory, &retainedBytes,
                                error)) return nil;
  NSData *data = [NSData dataWithContentsOfURL:retainedURL
                                       options:NSDataReadingMappedIfSafe
                                         error:&resourceError];
  if (!data) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaStorageFailed,
                              @"Retained image storage is unavailable.");
    }
    return nil;
  }
  if (retainedBytes != (long long)data.length ||
      data.length < 1 || data.length > MaxRetainedBytes ||
      ![CrewSHA256Data(data) isEqualToString:sha256]) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image is unsafe.");
    }
    return nil;
  }
  CGImageSourceRef source = CGImageSourceCreateWithData(
      (__bridge CFDataRef)data,
      (__bridge CFDictionaryRef)@{
        (__bridge NSString *)kCGImageSourceShouldCache : @NO,
      });
  CrewAttachmentMediaKind expectedKind =
      CrewMediaKindForExtension(retainedFileKey.pathExtension.lowercaseString);
  CrewAttachmentMediaKind actualKind = CrewAttachmentMediaUnknown;
  NSInteger width = 0;
  NSInteger height = 0;
  NSInteger orientation = 1;
  if (source) {
    CFStringRef identifier = CGImageSourceGetType(source);
    UTType *type = identifier
                       ? [UTType typeWithIdentifier:
                                     (__bridge NSString *)identifier]
                       : nil;
    actualKind = type ? CrewMediaKindForType(type) : CrewAttachmentMediaUnknown;
  }
  BOOL valid = source && CGImageSourceGetCount(source) == 1 &&
               actualKind == expectedKind &&
               CrewReadDimensions(source, &width, &height, &orientation, error) &&
               width <= MaxPixelDimension && height <= MaxPixelDimension &&
               width <= MaxDecodedPixels / height;
  if (source) CFRelease(source);
  if (!valid) {
    if (error && !*error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image is unsafe.");
    }
    return nil;
  }
  return data;
}

NSString *CrewPreviewRetainedImage(NSString *accountUserId,
                                   NSString *retainedFileKey,
                                   NSError **error) {
  NSData *sourceData =
      CrewReadRetainedImage(accountUserId, retainedFileKey, error);
  if (!sourceData) return nil;
  NSDictionary *sourceOptions = @{
    (__bridge NSString *)kCGImageSourceShouldCache : @NO,
  };
  CGImageSourceRef source = CGImageSourceCreateWithData(
      (__bridge CFDataRef)sourceData,
      (__bridge CFDictionaryRef)sourceOptions);
  if (!source) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaPreviewFailed,
                              @"Screenshot preview failed.");
    }
    return nil;
  }
  NSString *result = nil;
  @try {
    if (CGImageSourceGetCount(source) != 1) {
      if (error) {
        *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                                @"Retained image is unsafe.");
      }
      return nil;
    }
    NSInteger sourceWidth = 0;
    NSInteger sourceHeight = 0;
    NSInteger orientation = 1;
    if (!CrewReadDimensions(source, &sourceWidth, &sourceHeight, &orientation,
                            error) ||
        sourceWidth > MaxPixelDimension ||
        sourceHeight > MaxPixelDimension ||
        sourceWidth > MaxDecodedPixels / sourceHeight) {
      if (error && !*error) {
        *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                                @"Retained image is unsafe.");
      }
      return nil;
    }
    NSInteger target = MIN(MaxPreviewPixelDimension,
                           MAX(sourceWidth, sourceHeight));
    while (target >= 1) {
      NSDictionary *thumbnailOptions = @{
        (__bridge NSString *)kCGImageSourceCreateThumbnailFromImageAlways : @YES,
        (__bridge NSString *)kCGImageSourceCreateThumbnailWithTransform : @YES,
        (__bridge NSString *)kCGImageSourceThumbnailMaxPixelSize : @(target),
        (__bridge NSString *)kCGImageSourceShouldCacheImmediately : @YES,
      };
      CGImageRef thumbnail = CGImageSourceCreateThumbnailAtIndex(
          source, 0, (__bridge CFDictionaryRef)thumbnailOptions);
      if (!thumbnail) break;
      UIImage *image = [UIImage imageWithCGImage:thumbnail];
      NSData *png = UIImagePNGRepresentation(image);
      NSInteger width = CGImageGetWidth(thumbnail);
      NSInteger height = CGImageGetHeight(thumbnail);
      CGImageRelease(thumbnail);
      if (png.length >= 1 && png.length <= MaxPreviewBytes && width >= 1 &&
          height >= 1 && width <= MaxPreviewPixelDimension &&
          height <= MaxPreviewPixelDimension) {
        result = [@"data:image/png;base64," stringByAppendingString:
            [png base64EncodedStringWithOptions:0]];
        break;
      }
      if (target == 1) break;
      target = MAX(1, target * 3 / 4);
    }
  } @finally {
    CFRelease(source);
  }
  if (!result && error) {
    *error = CrewMediaError(CrewAttachmentMediaPreviewFailed,
                            @"Screenshot preview failed.");
  }
  return result;
}

NSData *CrewReadUploadFile(NSString *accountUserId,
                           NSString *retainedFileKey,
                           NSString *contentType,
                           double byteCount,
                           NSString *sha256,
                           NSError **error) {
  if (!CrewIsSHA256(sha256) ||
      !CrewIsRetainedFileKey(retainedFileKey) ||
      ![retainedFileKey.stringByDeletingPathExtension isEqualToString:sha256] ||
      ![CrewMediaContentType(
          CrewMediaKindForExtension(retainedFileKey.pathExtension.lowercaseString))
          isEqualToString:contentType] ||
      byteCount < 1 ||
      byteCount > MaxRetainedBytes ||
      byteCount != (double)((long long)byteCount)) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaInvalidArgument,
                              @"Upload request is invalid.");
    }
    return nil;
  }
  NSData *data = CrewReadRetainedImage(accountUserId, retainedFileKey, error);
  if (!data) return nil;
  if (data.length != (NSUInteger)byteCount) {
    if (error) {
      *error = CrewMediaError(CrewAttachmentMediaUnsafeImage,
                              @"Retained image is unsafe.");
    }
    return nil;
  }
  return data;
}

void CrewAppendMultipartString(NSMutableData *body, NSString *value) {
  [body appendData:[value dataUsingEncoding:NSUTF8StringEncoding]];
}

BOOL CrewPrepareRetainedUpload(NSString *accountUserId,
                               NSString *retainedFileKey,
                               NSString *grantUrl,
                               NSArray *grantFields,
                               NSString *contentType,
                               double byteCount,
                               NSString *sha256,
                               NSMutableURLRequest **request,
                               NSData **body,
                               NSError **error) {
  NSURL *url = nil;
  NSMutableArray<NSDictionary *> *fields = nil;
  if (!CrewValidateUploadURL(grantUrl, &url, error) ||
      !CrewValidateUploadFields(grantFields, &fields, error)) {
    return NO;
  }
  NSData *fileData = CrewReadUploadFile(accountUserId, retainedFileKey,
                                        contentType, byteCount, sha256, error);
  if (!fileData) return NO;

  NSString *boundary = [@"CrewBoundary" stringByAppendingString:
      [NSUUID.UUID.UUIDString stringByReplacingOccurrencesOfString:@"-"
                                                        withString:@""]];
  NSMutableData *multipart =
      [NSMutableData dataWithCapacity:fileData.length + MaxGrantFieldBytes + 4096];
  for (NSDictionary *field in fields) {
    CrewAppendMultipartString(multipart,
                              [NSString stringWithFormat:@"--%@\r\n", boundary]);
    CrewAppendMultipartString(
        multipart,
        [NSString stringWithFormat:
                      @"Content-Disposition: form-data; name=\"%@\"\r\n\r\n",
                      field[@"name"]]);
    CrewAppendMultipartString(multipart, field[@"value"]);
    CrewAppendMultipartString(multipart, @"\r\n");
  }
  CrewAppendMultipartString(multipart,
                            [NSString stringWithFormat:@"--%@\r\n", boundary]);
  CrewAppendMultipartString(
      multipart,
      [NSString stringWithFormat:
                    @"Content-Disposition: form-data; name=\"file\"; filename=\"%@\"\r\n",
                    retainedFileKey]);
  CrewAppendMultipartString(
      multipart,
      [NSString stringWithFormat:@"Content-Type: %@\r\n\r\n", contentType]);
  [multipart appendData:fileData];
  CrewAppendMultipartString(multipart,
                            [NSString stringWithFormat:@"\r\n--%@--\r\n", boundary]);

  NSMutableURLRequest *uploadRequest =
      [NSMutableURLRequest requestWithURL:url
                              cachePolicy:NSURLRequestReloadIgnoringLocalAndRemoteCacheData
                          timeoutInterval:30];
  uploadRequest.HTTPMethod = @"POST";
  uploadRequest.HTTPShouldHandleCookies = NO;
  [uploadRequest setValue:
                     [NSString stringWithFormat:@"multipart/form-data; boundary=%@",
                                                boundary]
       forHTTPHeaderField:@"Content-Type"];
  [uploadRequest setValue:@"no-store" forHTTPHeaderField:@"Cache-Control"];
  [uploadRequest setValue:@"no-cache" forHTTPHeaderField:@"Pragma"];
  *request = uploadRequest;
  *body = multipart;
  return YES;
}

BOOL CrewIsRetryableNetworkError(NSError *error) {
  if (![error.domain isEqualToString:NSURLErrorDomain]) return NO;
  switch (error.code) {
    case NSURLErrorTimedOut:
    case NSURLErrorCannotFindHost:
    case NSURLErrorCannotConnectToHost:
    case NSURLErrorNetworkConnectionLost:
    case NSURLErrorDNSLookupFailed:
    case NSURLErrorNotConnectedToInternet:
    case NSURLErrorInternationalRoamingOff:
    case NSURLErrorCallIsActive:
    case NSURLErrorDataNotAllowed:
    case NSURLErrorResourceUnavailable:
      return YES;
    default:
      return NO;
  }
}

NSString *CrewErrorCode(NSError *error) {
  if (![error.domain isEqualToString:CrewAttachmentMediaErrorDomain]) {
    return @"attachment_media_io";
  }
  switch ((CrewAttachmentMediaErrorCode)error.code) {
    case CrewAttachmentMediaInvalidSource:
      return @"attachment_media_invalid_source";
    case CrewAttachmentMediaUnsupportedType:
      return @"attachment_media_unsupported";
    case CrewAttachmentMediaUnsafeImage:
      return @"attachment_media_unsafe";
    case CrewAttachmentMediaConversionFailed:
      return @"attachment_media_conversion";
    case CrewAttachmentMediaStorageFailed:
      return @"attachment_media_storage";
    case CrewAttachmentMediaCaptureUnavailable:
      return @"attachment_media_capture_unavailable";
    case CrewAttachmentMediaCaptureFailed:
      return @"attachment_media_capture_failed";
    case CrewAttachmentMediaInvalidArgument:
      return @"attachment_media_invalid";
    case CrewAttachmentMediaMissingFile:
      return @"attachment_media_missing";
    case CrewAttachmentMediaUploadRetryable:
      return @"attachment_media_upload_retryable";
    case CrewAttachmentMediaUploadUnavailable:
      return @"attachment_media_upload_unavailable";
    case CrewAttachmentMediaUploadFailed:
      return @"attachment_media_upload_failed";
    case CrewAttachmentMediaPreviewUnavailable:
      return @"attachment_media_preview_unavailable";
    case CrewAttachmentMediaPreviewFailed:
      return @"attachment_media_preview_failed";
    case CrewAttachmentMediaPickerUnavailable:
      return @"attachment_media_picker_unavailable";
    case CrewAttachmentMediaPickerFailed:
      return @"attachment_media_picker_failed";
  }
  return @"attachment_media_io";
}

void CrewRejectSafe(RCTPromiseRejectBlock reject, NSError *error) {
  NSString *code = CrewErrorCode(error);
  reject(code, code, nil);
}

}  // namespace

@interface CrewAttachmentMedia () <NSURLSessionDataDelegate,
                                    PHPickerViewControllerDelegate>
@end

@implementation CrewAttachmentMedia {
  dispatch_queue_t _mediaQueue;
  NSMapTable<NSURLSessionTask *, NSDictionary *> *_uploadCallbacks;
  NSString *_pickerAccountUserId;
  RCTPromiseResolveBlock _pickerResolve;
  RCTPromiseRejectBlock _pickerReject;
  PHPickerViewController *_pickerViewController;
  NSProgress *_pickerLoadProgress;
  NSMutableArray *_pickerCancelWaiters;
  NSUInteger _pickerGeneration;
  BOOL _pickerWorkInFlight;
  BOOL _invalidated;
}

+ (NSString *)moduleName {
  return @"CrewAttachmentMedia";
}

- (instancetype)init {
  self = [super init];
  if (self) {
    // PURGE_SINGLE_WRITER_INVARIANT: every attachment file mutation uses this queue.
    _mediaQueue = dispatch_queue_create(
        "app.crew.next.attachment-media", DISPATCH_QUEUE_SERIAL);
    _uploadCallbacks = [NSMapTable strongToStrongObjectsMapTable];
    _pickerCancelWaiters = [NSMutableArray array];
  }
  return self;
}

- (void)pickImageAndRetain:(NSString *)accountUserId
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  if (!CrewIsValidAccountUserId(accountUserId)) {
    CrewRejectSafe(reject,
                   CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                  @"Image picker request is invalid."));
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = CrewActiveKeyWindow();
    UIViewController *presenter =
        window ? CrewVisibleViewController(window.rootViewController) : nil;
    @synchronized(self) {
      if (self->_invalidated || self->_pickerResolve) {
        CrewRejectSafe(reject,
                       CrewMediaError(CrewAttachmentMediaPickerUnavailable,
                                      @"Image picker is unavailable."));
        return;
      }
    }
    if (!presenter || !presenter.view.window) {
      CrewRejectSafe(reject,
                     CrewMediaError(CrewAttachmentMediaPickerUnavailable,
                                    @"Image picker is unavailable."));
      return;
    }
    PHPickerConfiguration *configuration =
        [[PHPickerConfiguration alloc] init];
    configuration.filter = PHPickerFilter.imagesFilter;
    configuration.selectionLimit = 1;
    configuration.preferredAssetRepresentationMode =
        PHPickerConfigurationAssetRepresentationModeCurrent;
    PHPickerViewController *picker =
        [[PHPickerViewController alloc] initWithConfiguration:configuration];
    picker.delegate = self;
    @synchronized(self) {
      if (self->_invalidated || self->_pickerResolve) {
        CrewRejectSafe(reject,
                       CrewMediaError(CrewAttachmentMediaPickerUnavailable,
                                      @"Image picker is unavailable."));
        return;
      }
      self->_pickerGeneration += 1;
      self->_pickerAccountUserId = [accountUserId copy];
      self->_pickerResolve = [resolve copy];
      self->_pickerReject = [reject copy];
      self->_pickerViewController = picker;
      self->_pickerLoadProgress = nil;
      self->_pickerWorkInFlight = NO;
    }
    [presenter presentViewController:picker animated:YES completion:nil];
  });
}

- (void)finishImagePicker:(NSUInteger)generation
                   result:(NSDictionary *)result
                    error:(NSError *)error {
  RCTPromiseResolveBlock resolve = nil;
  RCTPromiseRejectBlock reject = nil;
  NSArray *cancelWaiters = nil;
  @synchronized(self) {
    if (_invalidated || generation != _pickerGeneration || !_pickerResolve) {
      return;
    }
    resolve = _pickerResolve;
    reject = _pickerReject;
    cancelWaiters = [_pickerCancelWaiters copy];
    [_pickerCancelWaiters removeAllObjects];
    _pickerAccountUserId = nil;
    _pickerResolve = nil;
    _pickerReject = nil;
    _pickerViewController = nil;
    _pickerLoadProgress = nil;
    _pickerWorkInFlight = NO;
  }
  if (!resolve || !reject) return;
  if (error) {
    CrewRejectSafe(reject, error);
  } else {
    resolve(result);
  }
  for (RCTPromiseResolveBlock waiter in cancelWaiters) waiter(nil);
}

- (void)picker:(PHPickerViewController *)picker
    didFinishPicking:(NSArray<PHPickerResult *> *)results {
  [picker dismissViewControllerAnimated:YES completion:nil];
  __block NSUInteger generation = 0;
  __block NSString *accountUserId = nil;
  @synchronized(self) {
    if (_invalidated || picker != _pickerViewController || !_pickerResolve) {
      return;
    }
    generation = _pickerGeneration;
    accountUserId = [_pickerAccountUserId copy];
    _pickerViewController = nil;
  }
  if (results.count == 0) {
    [self finishImagePicker:generation result:nil error:nil];
    return;
  }
  if (results.count != 1) {
    [self finishImagePicker:generation
                     result:nil
                      error:CrewMediaError(CrewAttachmentMediaPickerFailed,
                                           @"Image picker failed.")];
    return;
  }
  NSItemProvider *provider = results.firstObject.itemProvider;
  NSString *typeIdentifier = CrewPickerTypeIdentifier(provider);
  if (!typeIdentifier) {
    [self finishImagePicker:generation
                     result:nil
                      error:CrewMediaError(CrewAttachmentMediaUnsupportedType,
                                           @"Image type is unsupported.")];
    return;
  }
  NSProgress *progress = [provider
      loadFileRepresentationForTypeIdentifier:typeIdentifier
                            completionHandler:^(NSURL *url, NSError *providerError) {
    @synchronized(self) {
      if (self->_invalidated || generation != self->_pickerGeneration ||
          !self->_pickerResolve) {
        return;
      }
      self->_pickerWorkInFlight = YES;
    }
    __block NSDictionary *result = nil;
    __block NSError *error = nil;
    if (!url || providerError) {
      error = CrewMediaError(CrewAttachmentMediaPickerFailed,
                             @"Image picker failed.");
    } else {
      dispatch_sync(self->_mediaQueue, ^{
        @autoreleasepool {
          result = CrewNormalizeAndRetain(accountUserId,
                                          url.absoluteString, &error);
        }
      });
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      [self finishImagePicker:generation
                       result:result
                        error:error ?: (result ? nil : CrewMediaError(
                            CrewAttachmentMediaPickerFailed,
                            @"Image picker failed."))];
    });
  }];
  @synchronized(self) {
    if (_invalidated || generation != _pickerGeneration || !_pickerResolve) {
      [progress cancel];
    } else {
      _pickerLoadProgress = progress;
    }
  }
}

- (void)cancelPending:(NSString *)accountUserId
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  if (!CrewIsValidAccountUserId(accountUserId)) {
    CrewRejectSafe(reject,
                   CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                  @"Image picker cancellation is invalid."));
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    RCTPromiseResolveBlock pickerResolve = nil;
    PHPickerViewController *picker = nil;
    NSProgress *progress = nil;
    BOOL waitForWork = NO;
    @synchronized(self) {
      if (self->_invalidated ||
          ![self->_pickerAccountUserId isEqualToString:accountUserId]) {
        resolve(nil);
        return;
      }
      if (self->_pickerWorkInFlight) {
        [self->_pickerCancelWaiters addObject:[resolve copy]];
        waitForWork = YES;
      } else {
        pickerResolve = self->_pickerResolve;
        picker = self->_pickerViewController;
        progress = self->_pickerLoadProgress;
        self->_pickerGeneration += 1;
        self->_pickerAccountUserId = nil;
        self->_pickerResolve = nil;
        self->_pickerReject = nil;
        self->_pickerViewController = nil;
        self->_pickerLoadProgress = nil;
      }
    }
    if (waitForWork) return;
    [progress cancel];
    [picker dismissViewControllerAnimated:YES completion:nil];
    if (pickerResolve) pickerResolve(nil);
    dispatch_async(self->_mediaQueue, ^{
      dispatch_async(dispatch_get_main_queue(), ^{
        resolve(nil);
      });
    });
  });
}

- (void)invalidate {
  __block RCTPromiseRejectBlock pickerReject = nil;
  __block PHPickerViewController *picker = nil;
  __block NSProgress *progress = nil;
  __block NSArray *cancelWaiters = nil;
  void (^invalidatePicker)(void) = ^{
    @synchronized(self) {
      if (self->_invalidated) return;
      self->_invalidated = YES;
      self->_pickerGeneration += 1;
      pickerReject = self->_pickerReject;
      picker = self->_pickerViewController;
      progress = self->_pickerLoadProgress;
      cancelWaiters = [self->_pickerCancelWaiters copy];
      [self->_pickerCancelWaiters removeAllObjects];
      self->_pickerAccountUserId = nil;
      self->_pickerResolve = nil;
      self->_pickerReject = nil;
      self->_pickerViewController = nil;
      self->_pickerLoadProgress = nil;
    }
    [progress cancel];
    [picker dismissViewControllerAnimated:NO completion:nil];
  };
  if (NSThread.isMainThread) {
    invalidatePicker();
  } else {
    dispatch_sync(dispatch_get_main_queue(), invalidatePicker);
  }
  dispatch_sync(_mediaQueue, ^{
    @synchronized(self) {
      self->_pickerWorkInFlight = NO;
    }
  });
  if (pickerReject) {
    CrewRejectSafe(pickerReject,
                   CrewMediaError(CrewAttachmentMediaPickerUnavailable,
                                  @"Image picker is unavailable."));
  }
  for (RCTPromiseResolveBlock waiter in cancelWaiters) waiter(nil);
}

- (void)captureCurrentScreen:(NSString *)accountUserId
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject {
  if (!CrewIsValidAccountUserId(accountUserId)) {
    CrewRejectSafe(reject,
                   CrewMediaError(CrewAttachmentMediaInvalidArgument,
                                  @"Screen capture request is invalid."));
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    NSError *captureError = nil;
    UIImage *image = CrewCaptureCurrentScreen(&captureError);
    if (!image) {
      CrewRejectSafe(reject, captureError ?: CrewMediaError(
          CrewAttachmentMediaCaptureFailed, @"Screen capture failed."));
      return;
    }
    dispatch_async(self->_mediaQueue, ^{
      @autoreleasepool {
        NSError *storageError = nil;
        NSDictionary *result =
            CrewRetainCapturedPNG(accountUserId, image, &storageError);
        if (result) {
          resolve(result);
        } else {
          CrewRejectSafe(reject, storageError ?: CrewMediaError(
              CrewAttachmentMediaStorageFailed,
              @"Screen capture could not be retained."));
        }
      }
    });
  });
}

- (void)previewRetained:(NSString *)accountUserId
         retainedFileKey:(NSString *)retainedFileKey
                  resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_mediaQueue, ^{
    @autoreleasepool {
      NSError *error = nil;
      NSString *preview =
          CrewPreviewRetainedImage(accountUserId, retainedFileKey, &error);
      if (preview) {
        resolve(preview);
      } else {
        CrewRejectSafe(reject, error ?: CrewMediaError(
            CrewAttachmentMediaPreviewFailed, @"Screenshot preview failed."));
      }
    }
  });
}

- (void)uploadRetained:(NSString *)accountUserId
        retainedFileKey:(NSString *)retainedFileKey
               grantUrl:(NSString *)grantUrl
            grantFields:(NSArray *)grantFields
            contentType:(NSString *)contentType
              byteCount:(double)byteCount
                 sha256:(NSString *)sha256
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_mediaQueue, ^{
    @autoreleasepool {
      NSMutableURLRequest *request = nil;
      NSData *body = nil;
      NSError *prepareError = nil;
      if (!CrewPrepareRetainedUpload(
              accountUserId, retainedFileKey, grantUrl, grantFields,
              contentType, byteCount, sha256, &request, &body, &prepareError)) {
        CrewRejectSafe(reject, prepareError ?: CrewMediaError(
            CrewAttachmentMediaUploadFailed, @"Upload failed."));
        return;
      }

      NSURLSessionConfiguration *configuration =
          NSURLSessionConfiguration.ephemeralSessionConfiguration;
      configuration.URLCache = nil;
      configuration.HTTPCookieStorage = nil;
      configuration.HTTPCookieAcceptPolicy = NSHTTPCookieAcceptPolicyNever;
      configuration.requestCachePolicy =
          NSURLRequestReloadIgnoringLocalAndRemoteCacheData;
      configuration.timeoutIntervalForRequest = 30;
      configuration.timeoutIntervalForResource = 60;
      configuration.waitsForConnectivity = NO;
      configuration.discretionary = NO;
      NSURLSession *session =
          [NSURLSession sessionWithConfiguration:configuration
                                        delegate:self
                                   delegateQueue:nil];
      NSURLSessionUploadTask *task =
          [session uploadTaskWithRequest:request fromData:body];
      @synchronized(self) {
        [_uploadCallbacks setObject:@{ @"resolve" : resolve,
                                       @"reject" : reject }
                              forKey:task];
      }
      [task resume];
    }
  });
}

- (void)URLSession:(NSURLSession *)session
                  task:(NSURLSessionTask *)task
willPerformHTTPRedirection:(NSHTTPURLResponse *)response
            newRequest:(NSURLRequest *)request
     completionHandler:(void (^)(NSURLRequest *_Nullable))completionHandler {
  completionHandler(nil);
}

- (void)URLSession:(NSURLSession *)session
          dataTask:(NSURLSessionDataTask *)dataTask
    didReceiveData:(__unused NSData *)data {
  // Intentionally discard every response chunk; object-store bodies are not data.
}

- (void)URLSession:(NSURLSession *)session
                  task:(NSURLSessionTask *)task
didCompleteWithError:(NSError *)networkError {
  NSDictionary *callbacks = nil;
  @synchronized(self) {
    callbacks = [_uploadCallbacks objectForKey:task];
    [_uploadCallbacks removeObjectForKey:task];
  }
  if (!callbacks) {
    [session finishTasksAndInvalidate];
    return;
  }
  RCTPromiseResolveBlock resolve = callbacks[@"resolve"];
  RCTPromiseRejectBlock reject = callbacks[@"reject"];
  NSError *safeError = nil;
  if (networkError) {
    safeError = CrewMediaError(
        CrewIsRetryableNetworkError(networkError)
            ? CrewAttachmentMediaUploadRetryable
            : CrewAttachmentMediaUploadUnavailable,
        @"Upload failed.");
  } else if (![task.response isKindOfClass:NSHTTPURLResponse.class]) {
    safeError = CrewMediaError(CrewAttachmentMediaUploadFailed,
                               @"Upload failed.");
  } else {
    NSInteger status = ((NSHTTPURLResponse *)task.response).statusCode;
    if (status >= 200 && status < 300) {
      resolve(nil);
    } else if (status == 408 || status == 425 || status == 429 ||
               status >= 500) {
      safeError = CrewMediaError(CrewAttachmentMediaUploadRetryable,
                                 @"Upload failed.");
    } else {
      safeError = CrewMediaError(CrewAttachmentMediaUploadUnavailable,
                                 @"Upload failed.");
    }
  }
  if (safeError) CrewRejectSafe(reject, safeError);
  [session finishTasksAndInvalidate];
}

- (void)reconcileRetained:(NSString *)accountUserId
          retainedFileKeys:(NSArray<NSString *> *)retainedFileKeys
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_mediaQueue, ^{
    @autoreleasepool {
      NSError *error = nil;
      if (CrewReconcileRetained(accountUserId, retainedFileKeys, &error)) {
        resolve(nil);
      } else {
        NSError *safeError = error ?: CrewMediaError(
                                          CrewAttachmentMediaStorageFailed,
                                          @"Retained images could not be reconciled.");
        CrewRejectSafe(reject, safeError);
      }
    }
  });
}

- (void)purgeRetained:(NSString *)accountUserId
       retainedFileKeys:(NSArray<NSString *> *)retainedFileKeys
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_mediaQueue, ^{
    @autoreleasepool {
      NSError *error = nil;
      if (CrewPurgeRetained(accountUserId, retainedFileKeys, &error)) {
        resolve(nil);
      } else {
        CrewRejectSafe(reject, error ?: CrewMediaError(
            CrewAttachmentMediaStorageFailed,
            @"Retained images could not be purged."));
      }
    }
  });
}

- (void)normalizeAndRetain:(NSString *)accountUserId
                 sourceUri:(NSString *)sourceUri
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_mediaQueue, ^{
    @autoreleasepool {
      NSError *error = nil;
      NSDictionary *result =
          CrewNormalizeAndRetain(accountUserId, sourceUri, &error);
      if (result) {
        resolve(result);
      } else {
        NSError *safeError = error ?: CrewMediaError(
                                          CrewAttachmentMediaConversionFailed,
                                          @"The selected image could not be processed.");
        CrewRejectSafe(reject, safeError);
      }
    }
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeCrewAttachmentMediaSpecJSI>(
      params);
}

@end
