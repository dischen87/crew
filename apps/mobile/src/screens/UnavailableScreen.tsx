import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text } from 'react-native';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import type { RootStackParamList } from '../navigation/types';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');

type Props = NativeStackScreenProps<RootStackParamList, 'Unavailable'>;

export function UnavailableScreen({ navigation }: Props) {
  return <UnavailableView onEvents={() => navigation.navigate('Events')} />;
}

export function UnavailableView({ onEvents }: { onEvents(): void }) {
  return (
    <ScreenFrame
      description="Gehe zurück zu deinen Events und wähle dort einen verfügbaren Inhalt."
      eyebrow="GESCHÜTZTER INHALT"
      icon={cloudOffline}
      liveRegion="assertive"
      statusLabel="ZUGRIFF NICHT VERFÜGBAR"
      testID="unavailable-view"
      title="Inhalt nicht verfügbar"
      tone="brand"
    >
      <Text accessibilityRole="alert" style={styles.message}>
        Es werden keine Angaben zum geschützten Ziel bestätigt.
      </Text>
      <Button
        icon={<ScreenIcon source={arrowRight} />}
        label="Zu Events"
        onPress={onEvents}
        style={styles.action}
        testID="unavailable-events"
        variant="action"
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'stretch',
    marginTop: spacing.xs,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
});
