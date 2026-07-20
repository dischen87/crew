import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '../design/primitives';
import { colors, spacing, typography } from '../design/theme';
import { ScreenFrame, ScreenIcon } from './ScreenFrame';

const arrowRight = require('../assets/icons/arrow-right.png');
const cloudOffline = require('../assets/icons/cloud-offline.png');
const crew = require('../assets/icons/crew.png');

type Props = {
  description: string;
  kind: 'concealed' | 'loading';
  onBack(): void;
  onRetry(): void;
  testID: string;
  title: string;
};

export function TeamRouteStateView({
  description,
  kind,
  onBack,
  onRetry,
  testID,
  title,
}: Props) {
  const loading = kind === 'loading';

  return (
    <ScreenFrame
      description={description}
      eyebrow="TEAM"
      icon={loading ? crew : cloudOffline}
      liveRegion={loading ? 'polite' : 'assertive'}
      statusLabel={loading ? 'WIRD GELADEN' : 'NICHT VERFÜGBAR'}
      testID={testID}
      title={title}
      tone={loading ? 'lavender' : 'brand'}
    >
      {loading ? (
        <ActivityIndicator
          accessibilityLabel="Team-Inhalt wird geladen"
          color={colors.textSecondary}
          size="large"
        />
      ) : (
        <Text accessibilityRole="alert" style={styles.message}>
          Geschützte Eventdaten bleiben verborgen.
        </Text>
      )}
      <View style={styles.actions}>
        <Button
          icon={<ScreenIcon source={arrowRight} />}
          label={loading ? 'Laden neu starten' : 'Erneut versuchen'}
          onPress={onRetry}
          testID={`${testID}-retry`}
          variant="action"
        />
        <Button
          accessibilityHint="Kehrt zur vorherigen Crew-Ansicht zurück."
          label="Zurück"
          onPress={onBack}
          testID={`${testID}-back`}
          variant="surface"
        />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  message: {
    ...typography.body,
    color: colors.text,
  },
});
