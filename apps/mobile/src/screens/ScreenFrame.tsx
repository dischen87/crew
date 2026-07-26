import type { ComponentProps, PropsWithChildren } from 'react';
import type { ImageSourcePropType } from 'react-native';
import {
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, StatusChip } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';

const boardBackground = require('../assets/crew-board-background.png');
const crewLogo = require('../assets/crew-logo.png');

type ScreenFrameProps = PropsWithChildren<{
  description: string;
  eyebrow?: string;
  icon?: ImageSourcePropType;
  liveRegion?: 'assertive' | 'none' | 'polite';
  statusLabel?: string;
  testID?: string;
  title: string;
  tone?: ComponentProps<typeof Card>['tone'];
}>;

export function ScreenFrame({
  children,
  description,
  eyebrow = 'CREW NEXT',
  icon,
  liveRegion = 'none',
  statusLabel,
  testID = 'screen-frame',
  title,
  tone = 'surface',
}: ScreenFrameProps) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const usesLargeTextLayout = fontScale >= 2;
  const hasPanel = Boolean(statusLabel || children);

  return (
    <ImageBackground
      resizeMode="cover"
      source={boardBackground}
      style={styles.screen}
      testID={testID}
    >
      <KeyboardAvoidingView
        behavior="padding"
        enabled={Platform.OS === 'android'}
        style={styles.keyboardAvoidingView}
      >
        <ScrollView
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[
            styles.content,
            usesLargeTextLayout && styles.contentLargeText,
            {
              paddingBottom: Math.max(insets.bottom, spacing.xl),
              paddingTop: Math.max(spacing.md - insets.top, 0),
            },
          ]}
          contentInsetAdjustmentBehavior="never"
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={Keyboard.dismiss}
          showsVerticalScrollIndicator={false}
          style={[styles.scroll, { marginTop: insets.top }]}
        >
          <View style={styles.brandLockup}>
            <Image
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              resizeMode="contain"
              source={crewLogo}
              style={styles.logo}
            />
            <Text style={styles.brandName}>CREW</Text>
          </View>

          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text
            accessibilityRole="header"
            lineBreakStrategyIOS="push-out"
            style={styles.title}
          >
            {title}
          </Text>
          <Text
            lineBreakStrategyIOS="push-out"
            style={styles.description}
            testID="screen-frame-description"
          >
            {description}
          </Text>

          {hasPanel ? (
            <Card
              accessibilityLiveRegion={liveRegion}
              elevated
              style={styles.panel}
              tone={tone}
            >
              {statusLabel ? (
                <StatusChip
                  icon={
                    icon ? <ScreenIcon size={17} source={icon} /> : undefined
                  }
                  label={statusLabel}
                  tone="surface"
                />
              ) : null}
              {children}
            </Card>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

export function ScreenIcon({
  size = 22,
  source,
}: {
  size?: number;
  source: ImageSourcePropType;
}) {
  return (
    <Image
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      resizeMode="contain"
      source={source}
      style={{ height: size, width: size }}
    />
  );
}

const styles = StyleSheet.create({
  brandLockup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandName: {
    ...typography.heading,
    color: colors.text,
    fontSize: 22,
    lineHeight: 26,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  contentLargeText: {
    paddingHorizontal: spacing.xs,
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  eyebrow: {
    ...typography.overline,
    color: colors.textSecondary,
    marginTop: spacing.xxl,
  },
  logo: {
    height: 52,
    width: 52,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  panel: {
    gap: spacing.md,
    marginBottom: spacing.xl,
    marginTop: spacing.xl,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  title: {
    ...typography.title,
    color: colors.text,
    marginTop: spacing.sm,
  },
});
