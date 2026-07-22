import { useState } from 'react';
import type { PropsWithChildren, ReactNode } from 'react';
import type {
  ImageSourcePropType,
  PressableProps,
  StyleProp,
  TextInputProps,
  TextStyle,
  ViewProps,
  ViewStyle,
} from 'react-native';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  borders,
  colors,
  componentMetrics,
  elevations,
  motion,
  radii,
  spacing,
  typography,
} from './theme';

type SurfaceTone = 'action' | 'brand' | 'lavender' | 'surface';

const surfaceColors: Record<SurfaceTone, string> = {
  action: colors.surfaceAction,
  brand: colors.surfaceBrand,
  lavender: colors.surfaceAccent,
  surface: colors.surface,
};

type ButtonVariant = 'action' | 'brand' | 'dark' | 'surface';

const buttonColors: Record<ButtonVariant, string> = {
  action: colors.surfaceAction,
  brand: colors.surfaceBrand,
  dark: colors.text,
  surface: colors.surface,
};

type CrewButtonProps = Omit<
  PressableProps,
  'accessibilityLabel' | 'children' | 'disabled' | 'style'
> & {
  accessibilityLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: ButtonVariant;
};

export function Button({
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  icon,
  label,
  loading = false,
  style,
  variant = 'action',
  ...props
}: CrewButtonProps) {
  const inactive = disabled || loading;
  const inverse = variant === 'dark';
  const usesLargeTextLayout = useWindowDimensions().fontScale >= 2;

  return (
    <Pressable
      {...props}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        busy: loading || accessibilityState?.busy,
        disabled: inactive || accessibilityState?.disabled,
      }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: buttonColors[variant] },
        elevations.control,
        style,
        usesLargeTextLayout && styles.buttonLargeText,
        pressed && styles.controlPressed,
        pressed && elevations.pressed,
        inactive && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={inverse ? colors.textInverse : colors.text}
          size="small"
        />
      ) : (
        icon
      )}
      <Text style={[styles.buttonLabel, inverse && styles.inverseText]}>
        {label}
      </Text>
    </Pressable>
  );
}

type IconButtonProps = Omit<
  PressableProps,
  'accessibilityLabel' | 'children' | 'style'
> & {
  accessibilityLabel: string;
  icon: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: SurfaceTone;
};

export function IconButton({
  accessibilityLabel,
  disabled,
  icon,
  style,
  tone = 'surface',
  ...props
}: IconButtonProps) {
  return (
    <Pressable
      {...props}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={spacing.xs}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: surfaceColors[tone] },
        elevations.compact,
        style,
        pressed && styles.controlPressed,
        pressed && elevations.pressed,
        disabled && styles.disabled,
      ]}
    >
      {icon}
    </Pressable>
  );
}

type StatusChipProps = {
  accessibilityLiveRegion?: ViewProps['accessibilityLiveRegion'];
  icon?: ReactNode;
  label: string;
  testID?: string;
  tone?: SurfaceTone;
};

export function StatusChip({
  accessibilityLiveRegion,
  icon,
  label,
  testID,
  tone = 'lavender',
}: StatusChipProps) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion={accessibilityLiveRegion}
      accessibilityRole="text"
      style={[styles.statusChip, { backgroundColor: surfaceColors[tone] }]}
      testID={testID}
    >
      {icon}
      <Text style={styles.statusChipLabel}>{label}</Text>
    </View>
  );
}

export type SyncState = 'attention' | 'offline' | 'ready' | 'syncing';

const syncTone: Record<SyncState, SurfaceTone> = {
  attention: 'brand',
  offline: 'lavender',
  ready: 'action',
  syncing: 'surface',
};

type SyncStatusProps = {
  icon?: ReactNode;
  label: string;
  state: SyncState;
};

export function SyncStatus({ icon, label, state }: SyncStatusProps) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      role="status"
      style={styles.syncStatus}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.syncIndicator,
          { backgroundColor: surfaceColors[syncTone[state]] },
        ]}
      >
        {icon}
      </View>
      <Text style={styles.syncLabel}>{label}</Text>
    </View>
  );
}

type CardProps = PropsWithChildren<
  ViewProps & {
    elevated?: boolean;
    tone?: SurfaceTone;
  }
>;

export function Card({
  children,
  elevated = false,
  style,
  tone = 'surface',
  ...props
}: CardProps) {
  return (
    <View
      {...props}
      style={[
        styles.card,
        { backgroundColor: surfaceColors[tone] },
        elevated && elevations.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type AvatarStackItem = {
  id: string;
  name: string;
  source?: ImageSourcePropType;
};

type AvatarStackProps = {
  accessibilityLabel: string;
  avatars: readonly AvatarStackItem[];
  maxVisible?: number;
};

export function AvatarStack({
  accessibilityLabel,
  avatars,
  maxVisible = componentMetrics.avatar.maxVisible,
}: AvatarStackProps) {
  const visible = avatars.slice(0, Math.max(0, maxVisible));
  const overflow = avatars.length - visible.length;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="summary"
      style={styles.avatarStack}
    >
      {visible.map((avatar, index) => (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          key={avatar.id}
          style={[
            styles.avatar,
            index > 0 && { marginLeft: -componentMetrics.avatar.overlap },
          ]}
        >
          {avatar.source ? (
            <Image source={avatar.source} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarInitial}>
              {avatar.name.trim().charAt(0).toLocaleUpperCase()}
            </Text>
          )}
        </View>
      ))}
      {overflow > 0 ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.avatar, styles.avatarOverflow]}
        >
          <Text style={styles.avatarInitial}>+{overflow}</Text>
        </View>
      ) : null}
    </View>
  );
}

type TimelineRowProps = {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  icon?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  subtitle?: string;
  time: string;
  title: string;
  trailing?: ReactNode;
};

export function TimelineRow({
  accessibilityHint,
  accessibilityLabel,
  icon,
  onPress,
  style,
  subtitle,
  time,
  title,
  trailing,
}: TimelineRowProps) {
  const content = (
    <>
      <Text style={styles.timelineTime}>{time}</Text>
      <View style={styles.timelineDivider} />
      {icon ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.timelineIcon}
        >
          {icon}
        </View>
      ) : null}
      <View style={styles.timelineCopy}>
        <Text style={styles.timelineTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.timelineSubtitle}>{subtitle}</Text>
        ) : null}
      </View>
      {trailing ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {trailing}
        </View>
      ) : null}
    </>
  );
  const combinedLabel =
    accessibilityLabel ?? [time, title, subtitle].filter(Boolean).join(', ');

  if (!onPress) {
    return <View style={[styles.timelineRow, style]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={combinedLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.timelineRow,
        style,
        pressed && styles.rowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

export type TextFieldProps = Omit<
  TextInputProps,
  'accessibilityLabel' | 'editable' | 'onBlur' | 'onFocus' | 'style'
> & {
  disabled?: boolean;
  error?: string;
  helpText?: string;
  inputStyle?: StyleProp<TextStyle>;
  label: string;
  onBlur?: TextInputProps['onBlur'];
  onFocus?: TextInputProps['onFocus'];
  style?: StyleProp<ViewStyle>;
};

export function TextField({
  accessibilityHint,
  disabled = false,
  error,
  helpText,
  inputStyle,
  label,
  onBlur,
  onFocus,
  style,
  ...props
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const errorMessage = error ? `Fehler: ${error}` : undefined;

  return (
    <View style={[styles.textField, style]}>
      <Text style={styles.textFieldLabel}>{label}</Text>
      <TextInput
        {...props}
        accessibilityHint={
          errorMessage ?? accessibilityHint ?? helpText ?? undefined
        }
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        editable={!disabled}
        onBlur={event => {
          setFocused(false);
          onBlur?.(event);
        }}
        onFocus={event => {
          setFocused(true);
          onFocus?.(event);
        }}
        placeholderTextColor={colors.textSecondary}
        selectionColor={colors.focus}
        style={[
          styles.textFieldInput,
          focused && styles.textFieldInputFocused,
          error && styles.textFieldInputError,
          disabled && styles.textFieldInputReadOnly,
          inputStyle,
        ]}
      />
      {errorMessage ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={styles.textFieldError}
        >
          {errorMessage}
        </Text>
      ) : helpText ? (
        <Text style={styles.textFieldHelp}>{helpText}</Text>
      ) : null}
    </View>
  );
}

export type FeedUpdateRowProps = {
  accessibilityHint?: string;
  accessibilityLabel?: string;
  actor: string;
  body?: string;
  icon: ReactNode;
  onPress?: () => void;
  statusLabel?: string;
  style?: StyleProp<ViewStyle>;
  timestamp: string;
  title: string;
  trailing?: ReactNode;
  unread?: boolean;
};

export function FeedUpdateRow({
  accessibilityHint,
  accessibilityLabel,
  actor,
  body,
  icon,
  onPress,
  statusLabel,
  style,
  timestamp,
  title,
  trailing,
  unread = false,
}: FeedUpdateRowProps) {
  const visibleStatus = statusLabel ?? (unread ? 'Neu' : undefined);
  const combinedLabel =
    accessibilityLabel ??
    [actor, title, body, timestamp, visibleStatus].filter(Boolean).join(', ');
  const content = (
    <>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.feedUpdateIcon}
      >
        {icon}
      </View>
      <View style={styles.feedUpdateCopy}>
        <View style={styles.feedUpdateMeta}>
          <Text style={styles.feedUpdateActor}>{actor}</Text>
          <Text style={styles.feedUpdateTimestamp}>{timestamp}</Text>
        </View>
        <Text style={styles.feedUpdateTitle}>{title}</Text>
        {body ? <Text style={styles.feedUpdateBody}>{body}</Text> : null}
        {visibleStatus ? <StatusChip label={visibleStatus} /> : null}
      </View>
      {trailing ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {trailing}
        </View>
      ) : null}
    </>
  );
  const rowStyle = [
    styles.feedUpdateRow,
    unread && styles.feedUpdateRowUnread,
    style,
  ];

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityLabel={combinedLabel}
        role="listitem"
        style={rowStyle}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={combinedLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && styles.rowPressed]}
    >
      {content}
    </Pressable>
  );
}

type BottomNavigationShellProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

export function BottomNavigationShell({
  children,
  style,
  testID,
}: BottomNavigationShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bottomNavigation,
        { paddingBottom: Math.max(insets.bottom, spacing.sm) },
        style,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

type BottomNavigationItemProps = Omit<
  PressableProps,
  'accessibilityLabel' | 'children' | 'style'
> & {
  icon: ReactNode;
  label: string;
  selected: boolean;
  style?: StyleProp<ViewStyle>;
};

export function BottomNavigationItem({
  disabled,
  icon,
  label,
  selected,
  style,
  ...props
}: BottomNavigationItemProps) {
  return (
    <Pressable
      {...props}
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ disabled: Boolean(disabled), selected }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.bottomNavigationItem,
        selected && styles.bottomNavigationItemSelected,
        style,
        pressed && styles.rowPressed,
        disabled && styles.disabled,
      ]}
    >
      {icon}
      <Text
        maxFontSizeMultiplier={2}
        numberOfLines={1}
        style={styles.bottomNavigationLabel}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.strong,
    height: componentMetrics.avatar.size,
    justifyContent: 'center',
    overflow: 'hidden',
    width: componentMetrics.avatar.size,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarInitial: {
    ...typography.label,
    color: colors.text,
  },
  avatarOverflow: {
    backgroundColor: colors.surfaceAccent,
    marginLeft: -componentMetrics.avatar.overlap,
  },
  avatarStack: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  bottomNavigation: {
    alignItems: 'stretch',
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.navigation,
    borderWidth: borders.strong,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  bottomNavigationItem: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radii.compact,
    borderWidth: borders.strong,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: componentMetrics.navigation.minimumItemHeight,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bottomNavigationItemSelected: {
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
  },
  bottomNavigationLabel: {
    ...typography.caption,
    color: colors.text,
  },
  button: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.strong,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  buttonLabel: {
    ...typography.bodyStrong,
    color: colors.text,
    flexShrink: 1,
    textAlign: 'center',
  },
  buttonLargeText: {
    flexDirection: 'column',
    paddingHorizontal: spacing.md,
  },
  card: {
    borderColor: colors.border,
    borderRadius: radii.card,
    borderWidth: borders.strong,
    padding: spacing.lg,
  },
  controlPressed: {
    transform: [
      { translateX: motion.press.controlOffset },
      { translateY: motion.press.controlOffset },
    ],
  },
  disabled: {
    opacity: componentMetrics.control.disabledOpacity,
  },
  feedUpdateActor: {
    ...typography.label,
    color: colors.text,
    flex: 1,
  },
  feedUpdateBody: {
    ...typography.body,
    color: colors.text,
  },
  feedUpdateCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  feedUpdateIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceBrand,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.timeline.iconSize,
    justifyContent: 'center',
    width: componentMetrics.timeline.iconSize,
  },
  feedUpdateMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  feedUpdateRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomColor: colors.divider,
    borderBottomWidth: borders.subtle,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: componentMetrics.timeline.minimumRowHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  feedUpdateRowUnread: {
    backgroundColor: colors.surfaceAccent,
  },
  feedUpdateTimestamp: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  feedUpdateTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
  iconButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.strong,
    height: componentMetrics.control.minimumTouchSize,
    justifyContent: 'center',
    width: componentMetrics.control.minimumTouchSize,
  },
  inverseText: {
    color: colors.textInverse,
  },
  rowPressed: {
    backgroundColor: colors.backgroundPressed,
  },
  statusChip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: componentMetrics.status.chipMinimumHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  statusChipLabel: {
    ...typography.caption,
    color: colors.text,
  },
  syncIndicator: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.status.indicatorSize,
    justifyContent: 'center',
    width: componentMetrics.status.indicatorSize,
  },
  syncLabel: {
    ...typography.body,
    color: colors.text,
    flexShrink: 1,
  },
  syncStatus: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: componentMetrics.control.minimumTouchSize,
  },
  textField: {
    gap: spacing.xs,
  },
  textFieldError: {
    ...typography.caption,
    color: colors.error,
  },
  textFieldHelp: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textFieldInput: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.control,
    borderWidth: borders.chip,
    color: colors.text,
    minHeight: componentMetrics.control.minimumTouchSize,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  textFieldInputError: {
    borderColor: colors.error,
  },
  textFieldInputFocused: {
    borderColor: colors.focus,
    borderWidth: borders.strong,
  },
  textFieldInputReadOnly: {
    backgroundColor: colors.surfaceAction,
    color: colors.text,
  },
  textFieldLabel: {
    ...typography.label,
    color: colors.text,
  },
  timelineCopy: {
    flex: 1,
    gap: spacing.xxs,
  },
  timelineDivider: {
    alignSelf: 'stretch',
    backgroundColor: colors.divider,
    width: borders.subtle,
  },
  timelineIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAction,
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: borders.chip,
    height: componentMetrics.timeline.iconSize,
    justifyContent: 'center',
    width: componentMetrics.timeline.iconSize,
  },
  timelineRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: borders.subtle,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: componentMetrics.timeline.minimumRowHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  timelineSubtitle: {
    ...typography.body,
    color: colors.text,
  },
  timelineTime: {
    ...typography.subheading,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    width: componentMetrics.timeline.timeColumnWidth,
  },
  timelineTitle: {
    ...typography.bodyStrong,
    color: colors.text,
  },
});
