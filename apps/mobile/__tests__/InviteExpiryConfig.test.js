const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const read = relativePath =>
  readFileSync(resolve(appRoot, relativePath), 'utf8');

test('registers system-native invite expiry pickers on iOS and Android', () => {
  const packageJson = JSON.parse(read('package.json'));
  const spec = read('src/specs/NativeCrewInviteExpiry.ts');
  const editor = read('src/screens/InviteEditorScreen.tsx');
  const ios = read('ios/CrewNext/CrewInviteExpiry.mm');
  const project = read('ios/CrewNext.xcodeproj/project.pbxproj');
  const android = read(
    'android/app/src/main/java/com/crewnext/CrewInviteExpiryModule.kt',
  );
  const androidPackage = read(
    'android/app/src/main/java/com/crewnext/CrewInviteExpiryPackage.kt',
  );
  const application = read(
    'android/app/src/main/java/com/crewnext/MainApplication.kt',
  );

  expect(packageJson.dependencies).not.toHaveProperty(
    '@react-native-community/datetimepicker',
  );
  expect(packageJson.codegenConfig.ios.modulesProvider).toMatchObject({
    CrewInviteExpiry: 'CrewInviteExpiry',
  });
  expect(spec).toContain("TurboModuleRegistry.get<Spec>('CrewInviteExpiry')");
  expect(editor).toContain('}, [selectedRole]);');
  expect(editor).toContain(
    'setInviteAccessibilityFocus(findNodeHandle(triggerRef.current))',
  );
  expect(project).toContain('CrewInviteExpiry.mm in Sources');

  expect(ios).toContain('UIDatePickerModeDateAndTime');
  expect(ios).toContain('UIDatePickerStyleWheels');
  expect(ios).toContain('NSTimeZone.localTimeZone');
  expect(ios).toContain('NSISO8601DateFormatWithFractionalSeconds');
  expect(ios).toContain('UIBarButtonSystemItemCancel');
  expect(ios).toContain('presentationControllerDidDismiss');
  expect(ios).toContain('[weakSelf finishWithDate:nil dismiss:YES]');

  expect(android).toContain('DatePickerDialog(');
  expect(android).toContain('TimePickerDialog(');
  expect(android).toContain('TimeZone.getDefault()');
  expect(android).toContain('isLenient = false');
  expect(android).toContain('calendar.get(Calendar.HOUR_OF_DAY) != hour');
  expect(android).toContain('setOnCancelListener { resolve(request, null) }');
  expect(android).toContain(`SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"`);
  expect(androidPackage).toContain('NativeCrewInviteExpirySpec.NAME');
  expect(application).toContain('add(CrewInviteExpiryPackage())');
});
