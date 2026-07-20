import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import ReactTestRenderer from 'react-test-renderer';
import {
  AvatarStack,
  BottomNavigationItem,
  BottomNavigationShell,
  Button,
  Card,
  FeedUpdateRow,
  IconButton,
  StatusChip,
  SyncStatus,
  TextField,
  TimelineRow,
} from '../src/design/primitives';
import { borders, colors, componentMetrics } from '../src/design/theme';

async function render(node: React.ReactElement) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(node);
  });
  return renderer!;
}

test('controls expose labels, disabled state and the 48-point touch target', async () => {
  const renderer = await render(
    <View>
      <Button label="Route öffnen" loading testID="route-button" />
      <IconButton
        accessibilityLabel="Offline-Status öffnen"
        disabled
        icon={<View testID="cloud-icon" />}
        testID="offline-button"
        tone="action"
      />
    </View>,
  );

  const button = renderer.root.find(
    node =>
      node.props.testID === 'route-button' &&
      node.props.accessibilityRole === 'button',
  );
  const buttonStyle = StyleSheet.flatten(
    typeof button.props.style === 'function'
      ? button.props.style({ pressed: false })
      : button.props.style,
  );
  expect(button.props.accessibilityRole).toBe('button');
  expect(button.props.accessibilityState).toMatchObject({
    busy: true,
    disabled: true,
  });
  expect(buttonStyle.minHeight).toBe(componentMetrics.control.minimumTouchSize);

  const iconButton = renderer.root.find(
    node =>
      node.props.testID === 'offline-button' &&
      node.props.accessibilityRole === 'button',
  );
  const iconStyle = StyleSheet.flatten(
    typeof iconButton.props.style === 'function'
      ? iconButton.props.style({ pressed: false })
      : iconButton.props.style,
  );
  expect(iconButton.props.accessibilityLabel).toBe('Offline-Status öffnen');
  expect(iconButton.props.accessibilityState).toEqual({ disabled: true });
  expect(iconStyle.height).toBe(componentMetrics.control.minimumTouchSize);
  expect(iconStyle.width).toBe(componentMetrics.control.minimumTouchSize);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('status, card, avatars and timeline keep information beyond color', async () => {
  const onPress = jest.fn();
  const renderer = await render(
    <View>
      <StatusChip label="Belek" tone="lavender" />
      <SyncStatus
        label="Offline bereit · vor 2 Min. synchronisiert"
        state="ready"
      />
      <Card elevated testID="brand-card" tone="brand">
        <Text>Welcome Dinner</Text>
      </Card>
      <AvatarStack
        accessibilityLabel="3 Teilnehmende: Marco, Nina, Sam"
        avatars={[
          { id: '1', name: 'Marco' },
          {
            id: '2',
            name: 'Nina',
            source: { uri: 'https://example.test/nina.jpg' },
          },
          { id: '3', name: 'Sam' },
        ]}
        maxVisible={2}
      />
      <TimelineRow
        onPress={onPress}
        subtitle="Hotellobby"
        time="13:30"
        title="Transfer zum Club"
      />
    </View>,
  );

  expect(
    renderer.root.findByProps({ accessibilityLabel: 'Belek' }),
  ).toBeTruthy();
  expect(
    renderer.root.findByProps({
      accessibilityLabel: 'Offline bereit · vor 2 Min. synchronisiert',
    }).props.role,
  ).toBe('status');
  expect(
    StyleSheet.flatten(
      renderer.root
        .findAllByType(View)
        .find(node => node.props.testID === 'brand-card')!.props.style,
    ).backgroundColor,
  ).toBe(colors.surfaceBrand);
  expect(
    renderer.root.find(
      node =>
        node.props.accessibilityLabel === '3 Teilnehmende: Marco, Nina, Sam' &&
        node.props.accessibilityRole === 'summary',
    ).props.accessibilityRole,
  ).toBe('summary');
  expect(
    renderer.root
      .findAllByType(Text)
      .map(node =>
        Array.isArray(node.props.children)
          ? node.props.children.join('')
          : String(node.props.children),
      ),
  ).toContain('+1');

  const timeline = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel?.includes('Transfer zum Club'),
  );
  expect(timeline.props.accessibilityLabel).toBe(
    '13:30, Transfer zum Club, Hotellobby',
  );
  await ReactTestRenderer.act(() =>
    renderer.root.findByType(TimelineRow).props.onPress(),
  );
  expect(onPress).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('bottom navigation is tab-semantic and respects the safe-area floor', async () => {
  const renderer = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 844, width: 390, x: 0, y: 0 },
        insets: { bottom: 34, left: 0, right: 0, top: 47 },
      }}
    >
      <BottomNavigationShell testID="bottom-navigation">
        <BottomNavigationItem
          icon={<View testID="plan-icon" />}
          label="Plan"
          onPress={jest.fn()}
          selected
          testID="plan-tab"
        />
        <BottomNavigationItem
          icon={<View testID="feed-icon" />}
          label="Feed"
          onPress={jest.fn()}
          selected={false}
          testID="feed-tab"
        />
      </BottomNavigationShell>
    </SafeAreaProvider>,
  );

  const navigation = renderer.root
    .findAllByType(View)
    .find(node => node.props.testID === 'bottom-navigation')!;
  expect(navigation.props.accessibilityRole).toBe('tablist');
  expect(StyleSheet.flatten(navigation.props.style).paddingBottom).toBe(34);
  expect(
    renderer.root.find(
      node =>
        node.props.testID === 'plan-tab' &&
        node.props.accessibilityRole === 'tab',
    ).props.accessibilityState,
  ).toMatchObject({ selected: true });
  expect(
    renderer.root.find(
      node =>
        node.props.testID === 'feed-tab' &&
        node.props.accessibilityRole === 'tab',
    ).props.accessibilityState,
  ).toMatchObject({ selected: false });
  expect(renderer.root.findByProps({ children: 'Plan' }).props).toMatchObject({
    maxFontSizeMultiplier: 2,
    numberOfLines: 1,
  });

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('text fields expose label, help, error, disabled and visible focus states', async () => {
  const onBlur = jest.fn();
  const onFocus = jest.fn();
  const renderer = await render(
    <View>
      <TextField
        helpText="So finden dich andere Crew-Mitglieder."
        label="Anzeigename"
        onBlur={onBlur}
        onFocus={onFocus}
        testID="name-field"
      />
      <TextField
        disabled
        error="Bitte einen Ort eingeben."
        label="Treffpunkt"
        testID="place-field"
      />
    </View>,
  );

  const nameField = renderer.root.find(
    node => node.type === TextInput && node.props.testID === 'name-field',
  );
  expect(nameField.props.accessibilityLabel).toBe('Anzeigename');
  expect(nameField.props.accessibilityHint).toBe(
    'So finden dich andere Crew-Mitglieder.',
  );
  expect(nameField.props.accessibilityState).toEqual({ disabled: false });
  expect(nameField.props.editable).toBe(true);
  expect(
    renderer.root.findAllByType(Text).map(node => node.props.children),
  ).toContain('Anzeigename');

  await ReactTestRenderer.act(() => nameField.props.onFocus({}));
  const focusedStyle = StyleSheet.flatten(
    renderer.root.find(
      node => node.type === TextInput && node.props.testID === 'name-field',
    ).props.style,
  );
  expect(focusedStyle.borderColor).toBe(colors.focus);
  expect(focusedStyle.borderWidth).toBe(borders.strong);
  expect(onFocus).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(() =>
    renderer.root
      .find(
        node => node.type === TextInput && node.props.testID === 'name-field',
      )
      .props.onBlur({}),
  );
  expect(onBlur).toHaveBeenCalledTimes(1);

  const placeField = renderer.root.find(
    node => node.type === TextInput && node.props.testID === 'place-field',
  );
  expect(placeField.props.accessibilityHint).toBe(
    'Fehler: Bitte einen Ort eingeben.',
  );
  expect(placeField.props.accessibilityState).toEqual({ disabled: true });
  expect(placeField.props.editable).toBe(false);
  expect(StyleSheet.flatten(placeField.props.style).borderColor).toBe(
    colors.error,
  );
  const error = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'alert' &&
      node.props.children === 'Fehler: Bitte einen Ort eingeben.',
  );
  expect(error.props.accessibilityLiveRegion).toBe('polite');

  await ReactTestRenderer.act(() => renderer.unmount());
});

test('feed update rows group a real icon node and communicate unread state as text', async () => {
  const onPress = jest.fn();
  const renderer = await render(
    <View role="list">
      <FeedUpdateRow
        actor="Nina"
        body="Die Abfahrt ist neu um 13:30 Uhr."
        icon={<View testID="feed-update-icon-node" />}
        onPress={onPress}
        timestamp="Vor 2 Min."
        title="Transfer aktualisiert"
        trailing={<View testID="feed-update-trailing-node" />}
        unread
      />
      <FeedUpdateRow
        actor="Marco"
        icon={<View testID="feed-list-icon-node" />}
        timestamp="Gestern"
        title="Welcome Dinner bestätigt"
      />
    </View>,
  );

  const interactiveRow = renderer.root.find(
    node =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel?.includes('Transfer aktualisiert'),
  );
  expect(interactiveRow.props.accessibilityLabel).toBe(
    'Nina, Transfer aktualisiert, Die Abfahrt ist neu um 13:30 Uhr., Vor 2 Min., Neu',
  );
  expect(
    StyleSheet.flatten(interactiveRow.props.style({ pressed: false }))
      .minHeight,
  ).toBe(componentMetrics.timeline.minimumRowHeight);
  await ReactTestRenderer.act(() => interactiveRow.props.onPress());
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(renderer.root.findByProps({ accessibilityLabel: 'Neu' })).toBeTruthy();

  const iconWrapper = renderer.root.find(
    node =>
      node.props.importantForAccessibility === 'no-hide-descendants' &&
      node.findAll(child => child.props.testID === 'feed-update-icon-node')
        .length > 0,
  );
  expect(iconWrapper.props.accessibilityElementsHidden).toBe(true);
  expect(
    renderer.root.find(
      node =>
        node.props.role === 'listitem' &&
        node.props.accessibilityLabel?.includes('Welcome Dinner bestätigt'),
    ).props.accessible,
  ).toBe(true);

  await ReactTestRenderer.act(() => renderer.unmount());
});
