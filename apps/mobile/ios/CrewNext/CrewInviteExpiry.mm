#import "CrewInviteExpiry.h"

#import <UIKit/UIKit.h>

namespace {

NSString *const CrewInviteExpiryInvalid = @"invite_expiry_picker_invalid";
NSString *const CrewInviteExpiryUnavailable =
    @"invite_expiry_picker_unavailable";

NSISO8601DateFormatter *CrewInviteExpiryFormatter(void) {
  NSISO8601DateFormatter *formatter = [NSISO8601DateFormatter new];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  return formatter;
}

NSDate *CrewInviteExpiryDate(NSString *value) {
  NSISO8601DateFormatter *formatter = CrewInviteExpiryFormatter();
  NSDate *date = [formatter dateFromString:value];
  return date && [[formatter stringFromDate:date] isEqualToString:value]
             ? date
             : nil;
}

UIViewController *CrewInviteExpiryPresenter(UIViewController *controller) {
  if (controller.presentedViewController) {
    return CrewInviteExpiryPresenter(controller.presentedViewController);
  }
  if ([controller isKindOfClass:UINavigationController.class]) {
    return CrewInviteExpiryPresenter(
        ((UINavigationController *)controller).visibleViewController);
  }
  if ([controller isKindOfClass:UITabBarController.class]) {
    return CrewInviteExpiryPresenter(
        ((UITabBarController *)controller).selectedViewController);
  }
  return controller;
}

UIWindow *CrewInviteExpiryKeyWindow(void) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive ||
        ![scene isKindOfClass:UIWindowScene.class]) {
      continue;
    }
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (window.isKeyWindow) return window;
    }
  }
  return nil;
}

void CrewInviteExpiryReject(RCTPromiseRejectBlock reject, NSString *code) {
  reject(code, code, nil);
}

}  // namespace

@interface CrewInviteExpiryViewController : UIViewController

@property(nonatomic, copy) void (^cancelHandler)(void);
@property(nonatomic, copy) void (^doneHandler)(NSDate *);
@property(nonatomic, strong) UIDatePicker *datePicker;
@property(nonatomic, strong) NSDate *initialDate;
@property(nonatomic, strong) NSDate *minimumDate;
@property(nonatomic, strong) NSTimeZone *timeZone;

@end

@implementation CrewInviteExpiryViewController

- (void)viewDidLoad {
  [super viewDidLoad];
  self.title = @"Gültig bis";
  self.view.backgroundColor = UIColor.systemBackgroundColor;
  self.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc]
      initWithBarButtonSystemItem:UIBarButtonSystemItemCancel
                          target:self
                          action:@selector(cancel)];
  self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc]
      initWithBarButtonSystemItem:UIBarButtonSystemItemDone
                          target:self
                          action:@selector(done)];

  UIDatePicker *picker = [UIDatePicker new];
  picker.translatesAutoresizingMaskIntoConstraints = NO;
  picker.datePickerMode = UIDatePickerModeDateAndTime;
  picker.preferredDatePickerStyle = UIDatePickerStyleWheels;
  picker.locale = NSLocale.autoupdatingCurrentLocale;
  picker.timeZone = self.timeZone;
  picker.minimumDate = self.minimumDate;
  picker.date = self.initialDate;
  picker.accessibilityLabel = @"Gültig bis";
  [self.view addSubview:picker];
  [NSLayoutConstraint activateConstraints:@[
    [picker.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
    [picker.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
    [picker.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],
  ]];
  self.datePicker = picker;
}

- (void)cancel {
  if (self.cancelHandler) self.cancelHandler();
}

- (void)done {
  if (self.doneHandler) self.doneHandler(self.datePicker.date);
}

@end

@interface CrewInviteExpiry () <UIAdaptivePresentationControllerDelegate>
@end

@implementation CrewInviteExpiry {
  CrewInviteExpiryViewController *_controller;
  BOOL _invalidated;
  NSDate *_minimumDate;
  UINavigationController *_navigationController;
  RCTPromiseRejectBlock _reject;
  RCTPromiseResolveBlock _resolve;
  NSTimeZone *_timeZone;
}

+ (NSString *)moduleName {
  return @"CrewInviteExpiry";
}

- (void)pickExpiry:(NSString *)initialExpiresAt
    minimumExpiresAt:(NSString *)minimumExpiresAt
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject {
  NSDate *initialDate = CrewInviteExpiryDate(initialExpiresAt);
  NSDate *minimumDate = CrewInviteExpiryDate(minimumExpiresAt);
  if (!initialDate || !minimumDate) {
    CrewInviteExpiryReject(reject, CrewInviteExpiryInvalid);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    UIWindow *window = CrewInviteExpiryKeyWindow();
    UIViewController *presenter =
        window ? CrewInviteExpiryPresenter(window.rootViewController) : nil;
    if (self->_invalidated || self->_resolve || !presenter ||
        !presenter.view.window) {
      CrewInviteExpiryReject(reject, CrewInviteExpiryUnavailable);
      return;
    }

    NSTimeZone *timeZone = NSTimeZone.localTimeZone;
    CrewInviteExpiryViewController *controller =
        [CrewInviteExpiryViewController new];
    controller.initialDate =
        [initialDate compare:minimumDate] == NSOrderedAscending
            ? minimumDate
            : initialDate;
    controller.minimumDate = minimumDate;
    controller.timeZone = timeZone;
    __weak CrewInviteExpiry *weakSelf = self;
    controller.cancelHandler = ^{
      [weakSelf finishWithDate:nil dismiss:YES];
    };
    controller.doneHandler = ^(NSDate *date) {
      [weakSelf finishWithDate:date dismiss:YES];
    };

    UINavigationController *navigationController =
        [[UINavigationController alloc] initWithRootViewController:controller];
    navigationController.modalPresentationStyle =
        UIModalPresentationPageSheet;
    navigationController.presentationController.delegate = self;
    self->_controller = controller;
    self->_minimumDate = minimumDate;
    self->_navigationController = navigationController;
    self->_reject = [reject copy];
    self->_resolve = [resolve copy];
    self->_timeZone = timeZone;
    [presenter presentViewController:navigationController
                            animated:YES
                          completion:nil];
  });
}

- (void)finishWithDate:(NSDate *)date dismiss:(BOOL)dismiss {
  NSAssert(NSThread.isMainThread, @"Invite expiry picker must finish on main.");
  if (!_resolve) return;
  RCTPromiseResolveBlock resolve = _resolve;
  RCTPromiseRejectBlock reject = _reject;
  UINavigationController *navigationController = _navigationController;
  NSDate *minimumDate = _minimumDate;
  NSTimeZone *timeZone = _timeZone;
  _controller.cancelHandler = nil;
  _controller.doneHandler = nil;
  _controller = nil;
  _minimumDate = nil;
  _navigationController = nil;
  _reject = nil;
  _resolve = nil;
  _timeZone = nil;

  void (^complete)(void) = ^{
    if (date && [date compare:minimumDate] != NSOrderedAscending) {
      NSString *expiresAt = [CrewInviteExpiryFormatter() stringFromDate:date];
      if (CrewInviteExpiryDate(expiresAt)) {
        resolve(@{
          @"expiresAt" : expiresAt,
          @"timeZone" : timeZone.name,
        });
        return;
      }
      CrewInviteExpiryReject(reject, CrewInviteExpiryInvalid);
      return;
    }
    if (date) {
      CrewInviteExpiryReject(reject, CrewInviteExpiryInvalid);
    } else {
      resolve(nil);
    }
  };
  if (dismiss && navigationController.presentingViewController) {
    [navigationController dismissViewControllerAnimated:YES
                                             completion:complete];
  } else {
    complete();
  }
}

- (void)presentationControllerDidDismiss:
    (__unused UIPresentationController *)presentationController {
  [self finishWithDate:nil dismiss:NO];
}

- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_invalidated) return;
    self->_invalidated = YES;
    [self finishWithDate:nil dismiss:YES];
  });
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeCrewInviteExpirySpecJSI>(
      params);
}

@end
